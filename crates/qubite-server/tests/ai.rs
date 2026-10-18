//! AI в сервере (AI-002): настройки `QUBITE_AI_*`, запуск (восстановление
//! «зависших» вызовов, каталог OpenRouter, allowlist, лимиты платформы)
//! и команды `qubite ai …`. OpenRouter — поддельный локальный сервер.

use std::time::Duration;

use clap::{CommandFactory, Parser};
use qubite_ai::{AiError, AiRequest, Untrusted};
use qubite_db::Database;
use qubite_policy::{ModuleId, ModulePatch, Subject, UseAi};
use qubite_server::ai::{self, AiArgs, AiCommand, MetricArg, OnOff, PeriodArg, Switch};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp},
};
use uuid::Uuid;

const GEMINI: &str = "google/gemini-2.5-flash-lite";
const OWNER: &str = "kirill@qubite.ru";

#[derive(Parser)]
struct Settings {
    #[command(flatten)]
    ai: AiArgs,
}

fn settings(args: &[&str]) -> AiArgs {
    Settings::try_parse_from(std::iter::once("qubite").chain(args.iter().copied()))
        .unwrap()
        .ai
}

fn fixture(name: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/../qubite-ai/tests/fixtures/openrouter/{name}",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

/// Первым запросом при запуске идёт каталог, дальше — чат.
async fn fake_openrouter() -> FakeHttp {
    FakeHttp::start(
        [Action::Respond(200, fixture("models.json"))],
        Action::Respond(200, fixture("chat_ok.json")),
    )
    .await
}

fn with_key(fake: &FakeHttp, extra: &[&str]) -> AiArgs {
    let base = fake.base_url();
    let mut args = vec![
        "--ai-openrouter-api-key",
        "sk-or-test",
        "--ai-openrouter-base-url",
        &base,
    ];
    args.extend_from_slice(extra);
    settings(&args)
}

async fn setup() -> (TestDb, Database, Uuid) {
    let (test_db, db) = TestDb::migrated().await;
    let owner = qubite_auth::owner::create(
        db.pool(),
        &qubite_auth::Passwords::default(),
        OWNER,
        "Кирилл",
        "пароль владельца",
    )
    .await
    .unwrap();
    (test_db, db, owner.id)
}

async fn enabled_models(db: &Database) -> Vec<String> {
    sqlx::query_scalar("SELECT id FROM ai_models WHERE enabled ORDER BY id")
        .fetch_all(db.pool())
        .await
        .unwrap()
}

#[test]
fn every_setting_has_a_qubite_ai_env_var_and_safe_defaults() {
    let command = Settings::command();
    for arg in command
        .get_arguments()
        .filter(|a| !matches!(a.get_id().as_str(), "help" | "version"))
    {
        let env = arg.get_env().and_then(|e| e.to_str()).unwrap_or_default();
        assert!(
            env.starts_with("QUBITE_AI_"),
            "{:?} без QUBITE_AI_*",
            arg.get_id()
        );
    }

    let defaults = settings(&[]);
    assert_eq!(defaults.timezone, "Asia/Yekaterinburg");
    assert!(
        defaults.openrouter_api_key.is_none(),
        "без ключа AI выключен"
    );
    assert!(defaults.deny_data_collection);
    assert!(defaults.openrouter_models.is_none());
    assert!(defaults.platform_usd_per_day.is_none());
    let config = defaults.gateway_config();
    assert_eq!(config.timeout, Duration::from_secs(60));
    assert_eq!(
        config.retry_delays,
        [Duration::from_secs(1), Duration::from_secs(2)],
        "3 попытки, паузы 1 и 2 с"
    );

    let custom = settings(&[
        "--ai-timeout-secs",
        "20",
        "--ai-max-attempts",
        "1",
        "--ai-openrouter-models",
        "a/b, c/d",
        "--ai-platform-usd-per-month",
        "7.25",
    ]);
    let config = custom.gateway_config();
    assert_eq!(config.timeout, Duration::from_secs(20));
    assert!(config.retry_delays.is_empty());
    assert_eq!(
        custom.openrouter_models,
        Some(vec!["a/b".to_owned(), " c/d".to_owned()])
    );
    assert_eq!(custom.platform_usd_per_month, Some(7_250_000));

    for bad in [
        &["--ai-max-attempts", "4"][..],
        &["--ai-timeout-secs", "0"],
        &["--ai-platform-usd-per-day", "-1"],
    ] {
        assert!(
            Settings::try_parse_from(std::iter::once("qubite").chain(bad.iter().copied())).is_err(),
            "{bad:?}"
        );
    }
}

#[tokio::test]
async fn startup_recovers_orphaned_calls_and_syncs_catalog() {
    let (test_db, db, owner) = setup().await;
    let fake = fake_openrouter().await;
    let args = with_key(&fake, &[]);

    let first = ai::start(&db, &args).await.unwrap();
    assert_eq!(first.recovered, 0);
    let report = first.catalog.unwrap();
    assert_eq!(report.missing, Vec::<String>::new());
    assert_eq!(
        enabled_models(&db).await,
        [
            GEMINI,
            "mistralai/mistral-small-3.2-24b-instruct",
            "openai/gpt-4.1-nano"
        ],
        "первый запуск — стартовый набор"
    );

    // Процесс «упал»: один вызов завис давно, другой — только что.
    for (request_id, age) in [("old", "1 hour"), ("fresh", "1 second")] {
        sqlx::query(
            "INSERT INTO ai_calls (id, request_id, account_id, module_id, model_id, status, attempts, \
             estimate_usd, estimate_tokens, updated_at) \
             VALUES ($1, $2, $3, 'docs', $4, 'sending', 1, 10, 10, now() - $5::interval)",
        )
        .bind(Uuid::now_v7())
        .bind(request_id)
        .bind(owner)
        .bind(GEMINI)
        .bind(age)
        .execute(db.pool())
        .await
        .unwrap();
    }
    let fake = fake_openrouter().await;
    let second = ai::start(&db, &with_key(&fake, &[])).await.unwrap();
    assert_eq!(second.recovered, 1);
    let statuses: Vec<(String, String)> =
        sqlx::query_as("SELECT request_id, status FROM ai_calls ORDER BY request_id")
            .fetch_all(db.pool())
            .await
            .unwrap();
    assert_eq!(
        statuses,
        [
            ("fresh".to_owned(), "sending".to_owned()),
            ("old".to_owned(), "unknown".to_owned())
        ],
        "свежий мог ещё идти в другом процессе — его заберёт фоновая проверка"
    );
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn allowlist_from_settings_wins_otherwise_owner_decides() {
    let (test_db, db, _) = setup().await;
    let only_gemini = ["--ai-openrouter-models", GEMINI];

    let fake = fake_openrouter().await;
    ai::start(&db, &with_key(&fake, &only_gemini))
        .await
        .unwrap();
    assert_eq!(enabled_models(&db).await, [GEMINI]);

    // Без списка в настройках: цены обновляются, список сам не расширяется,
    // а выбор owner (`qubite ai model … on|off`) сохраняется между запусками.
    // Новую модель owner добавляет списком в QUBITE_AI_OPENROUTER_MODELS.
    let fake = fake_openrouter().await;
    ai::start(&db, &with_key(&fake, &[])).await.unwrap();
    assert_eq!(
        enabled_models(&db).await,
        [GEMINI],
        "список не расширился сам"
    );
    let error = ai::run(
        &db,
        &settings(&[]),
        AiCommand::Model {
            id: "openai/gpt-4.1-nano".into(),
            state: OnOff::On,
        },
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("нет модели"), "{error}");
    ai::run(
        &db,
        &settings(&[]),
        AiCommand::Model {
            id: GEMINI.into(),
            state: OnOff::Off,
        },
    )
    .await
    .unwrap();
    let fake = fake_openrouter().await;
    ai::start(&db, &with_key(&fake, &[])).await.unwrap();
    assert!(
        enabled_models(&db).await.is_empty(),
        "выбор owner сохранился"
    );

    let fake = fake_openrouter().await;
    ai::start(&db, &with_key(&fake, &only_gemini))
        .await
        .unwrap();
    assert_eq!(
        enabled_models(&db).await,
        [GEMINI],
        "настройки сервера побеждают"
    );
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn without_key_ai_is_off_and_nothing_is_sent() {
    let (test_db, db, owner) = setup().await;
    let fake = fake_openrouter().await;
    ai::start(&db, &with_key(&fake, &[])).await.unwrap();
    let requests_before = fake.received().len();

    let runtime = ai::start(&db, &settings(&[])).await.unwrap();
    assert!(runtime.openrouter.is_none());
    let enabled: bool =
        sqlx::query_scalar("SELECT enabled FROM ai_providers WHERE id = 'openrouter'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert!(!enabled, "провайдер выключен — модели не предлагаются");

    ai::run(
        &db,
        &settings(&[]),
        AiCommand::OwnerUnlimited { state: Switch::On },
    )
    .await
    .unwrap();
    let auth = owner_ai(&db, owner).await;
    let error = runtime
        .gateway
        .complete(&auth, chat("no-key"))
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::ModelNotAllowed), "{error:?}");
    assert_eq!(fake.received().len(), requests_before);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn platform_caps_from_settings_survive_restart() {
    let (test_db, db, _) = setup().await;
    let caps = [
        "--ai-platform-usd-per-day",
        "2",
        "--ai-platform-usd-per-month",
        "20",
    ];
    let live = || async {
        sqlx::query_as::<_, (Uuid, String, i64)>(
            "SELECT id, period, limit_value FROM ai_limits \
             WHERE revoked_at IS NULL AND scope_kind = 'platform' ORDER BY period",
        )
        .fetch_all(db.pool())
        .await
        .unwrap()
    };
    ai::start(&db, &settings(&caps)).await.unwrap();
    let first = live().await;
    assert_eq!(
        first
            .iter()
            .map(|(_, p, v)| (p.as_str(), *v))
            .collect::<Vec<_>>(),
        [("day", 2_000_000), ("month", 20_000_000)]
    );
    ai::start(&db, &settings(&caps)).await.unwrap();
    assert_eq!(live().await, first, "тот же лимит — счётчики не обнулились");
    // Без настройки лимит не трогается.
    ai::start(&db, &settings(&[])).await.unwrap();
    assert_eq!(live().await, first);
    db.close().await;
    test_db.drop_db().await;
}

/// Сценарий владельца: ключ задан, режим «без личного лимита» включён
/// командой, запрос идёт через настроенный шлюз.
#[tokio::test]
async fn owner_unlimited_via_cli_then_real_path_through_gateway() {
    let (test_db, db, owner) = setup().await;
    let fake = fake_openrouter().await;
    let runtime = ai::start(&db, &with_key(&fake, &[])).await.unwrap();
    let auth = owner_ai(&db, owner).await;

    assert!(matches!(
        runtime.gateway.complete(&auth, chat("before")).await,
        Err(AiError::BudgetNotSet)
    ));
    let status = ai::run(
        &db,
        &settings(&[]),
        AiCommand::OwnerUnlimited {
            state: Switch::Status,
        },
    )
    .await
    .unwrap();
    assert!(status.contains("выключено"), "{status}");
    let on = ai::run(
        &db,
        &settings(&[]),
        AiCommand::OwnerUnlimited { state: Switch::On },
    )
    .await
    .unwrap();
    assert!(on.contains("ВКЛЮЧЕНО"), "{on}");

    let reply = runtime
        .gateway
        .complete(&auth, chat("after"))
        .await
        .unwrap();
    assert_eq!(reply.text, "Задача: купить молоко. Срок: сегодня.");
    assert_eq!(reply.cost_usd, 49);
    let chat_requests = fake
        .received()
        .iter()
        .filter(|r| r.line.starts_with("POST /api/v1/chat/completions"))
        .count();
    assert_eq!(chat_requests, 1);

    let actor: Option<Uuid> = sqlx::query_scalar(
        "SELECT actor_id FROM audit_log WHERE action = 'ai.owner_unlimited_set'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(actor, Some(owner));
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn cli_sets_limits_and_lists_models() {
    let (test_db, db, owner) = setup().await;
    let fake = fake_openrouter().await;
    ai::start(&db, &with_key(&fake, &[])).await.unwrap();

    let done = ai::run(
        &db,
        &settings(&[]),
        AiCommand::Limit {
            scope: format!("user:{}", OWNER.to_uppercase()),
            period: PeriodArg::Day,
            metric: MetricArg::Usd,
            value: "1,50".into(),
        },
    )
    .await
    .unwrap();
    assert!(done.contains("$1.500000"), "{done}");
    let (account, value): (Option<Uuid>, i64) = sqlx::query_as(
        "SELECT account_id, limit_value FROM ai_limits WHERE scope_kind = 'user' AND revoked_at IS NULL",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!((account, value), (Some(owner), 1_500_000));

    ai::run(
        &db,
        &settings(&[]),
        AiCommand::Limit {
            scope: "user-module:kirill@qubite.ru/docs".into(),
            period: PeriodArg::Hour,
            metric: MetricArg::Requests,
            value: "30".into(),
        },
    )
    .await
    .unwrap();
    let limits = ai::run(&db, &settings(&[]), AiCommand::Limits)
        .await
        .unwrap();
    assert!(
        limits.contains("user kirill@qubite.ru | day usd | лимит $1.500000"),
        "{limits}"
    );
    assert!(
        limits.contains("user_module kirill@qubite.ru/docs | hour requests | лимит 30"),
        "{limits}"
    );

    for bad in ["user:nobody@x.ru", "galaxy", "module:Not A Module"] {
        assert!(
            ai::run(
                &db,
                &settings(&[]),
                AiCommand::Limit {
                    scope: bad.into(),
                    period: PeriodArg::Day,
                    metric: MetricArg::Usd,
                    value: "1".into(),
                },
            )
            .await
            .is_err(),
            "{bad}"
        );
    }

    let models = ai::run(&db, &settings(&[]), AiCommand::Models)
        .await
        .unwrap();
    assert!(
        models.contains("google/gemini-2.5-flash-lite | openrouter | $0.100000 / $0.400000 | да"),
        "{models}"
    );
    assert!(
        ai::run(
            &db,
            &settings(&[]),
            AiCommand::Unblock { id: "nope".into() }
        )
        .await
        .is_err()
    );
    db.close().await;
    test_db.drop_db().await;
}

async fn owner_ai(db: &Database, owner: Uuid) -> qubite_policy::Authorized<UseAi> {
    let console = qubite_policy::decide_owner(db.pool(), &Subject::account(owner, None))
        .await
        .unwrap();
    let docs = ModuleId::new("docs").unwrap();
    qubite_policy::catalog::update(
        db.pool(),
        &console,
        &docs,
        ModulePatch {
            installed: Some(true),
            readiness: Some("stable".into()),
            ..ModulePatch::default()
        },
    )
    .await
    .unwrap();
    qubite_policy::decide::<UseAi>(db.pool(), &Subject::account(owner, None), &docs)
        .await
        .unwrap()
}

fn chat(id: &str) -> AiRequest {
    AiRequest {
        request_id: id.into(),
        model: GEMINI.into(),
        prompt: "Разбери мысль".into(),
        untrusted: vec![Untrusted::new("inbox", "купить молоко")],
        input_tokens: 0,
        max_output_tokens: 1_000,
    }
}

/// `qubite ai try` — ручной реальный вызов владельцем: тот же шлюз, тот же бюджет.
#[tokio::test]
async fn try_command_goes_through_budget_and_gateway() {
    let (test_db, db, owner) = setup().await;
    owner_ai(&db, owner).await; // модуль docs установлен
    let fake = fake_openrouter().await;
    let args = with_key(&fake, &[]);
    let attempt = || {
        ai::run(
            &db,
            &args,
            AiCommand::Try {
                text: "купить молоко".into(),
                model: GEMINI.into(),
                module: "docs".into(),
                max_tokens: 200,
            },
        )
    };

    let error = attempt().await.unwrap_err();
    assert!(
        format!("{error:#}").contains("AI-бюджет не выдан"),
        "{error:#}"
    );

    ai::run(&db, &args, AiCommand::OwnerUnlimited { state: Switch::On })
        .await
        .unwrap();
    let out = attempt().await.unwrap();
    assert!(out.starts_with("Задача: купить молоко."), "{out}");
    assert!(out.contains("списано $0.000049"), "{out}");

    let without_key = ai::run(
        &db,
        &settings(&[]),
        AiCommand::Try {
            text: "x".into(),
            model: GEMINI.into(),
            module: "docs".into(),
            max_tokens: 10,
        },
    )
    .await
    .unwrap_err();
    assert!(
        without_key
            .to_string()
            .contains("QUBITE_AI_OPENROUTER_API_KEY")
    );
    db.close().await;
    test_db.drop_db().await;
}
