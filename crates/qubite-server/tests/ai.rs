//! AI в сервере (AI-002): настройки `QUBITE_AI_*`, запуск (восстановление
//! «зависших» вызовов, каталог OpenRouter, allowlist, лимиты платформы)
//! и команды `qubite ai …`. OpenRouter — поддельный локальный сервер.

mod common;

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
    sqlx::query_scalar(
        "SELECT id FROM ai_models WHERE enabled AND provider_id <> 'elevenlabs' ORDER BY id",
    )
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
        // Голос (ENG-001) — свой провайдер со своими переменными.
        assert!(
            env.starts_with("QUBITE_AI_") || env.starts_with("QUBITE_ELEVENLABS_"),
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
    assert_eq!(
        defaults.data_collection, None,
        "data_collection не навязываем (D-211)"
    );
    assert_eq!(defaults.user_requests_per_minute, 20);
    assert_eq!(defaults.job_requests_per_minute, 10);
    assert_eq!(defaults.repeat_limit, 3);
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

/// Модели выбирает owner (D-210): настройки сервера — только стартовый набор
/// при первом запуске; из каталога можно включить любую модель.
#[tokio::test]
async fn owner_chooses_models_from_catalog_and_restart_keeps_choice() {
    let (test_db, db, _) = setup().await;
    let only_gemini = ["--ai-openrouter-models", GEMINI];
    let model = |id: &str, state: Option<OnOff>| AiCommand::Model {
        id: id.into(),
        state,
        providers: None,
        data_collection: None,
    };

    let fake = fake_openrouter().await;
    ai::start(&db, &with_key(&fake, &only_gemini))
        .await
        .unwrap();
    assert_eq!(
        enabled_models(&db).await,
        [GEMINI],
        "первый запуск — список из настроек"
    );

    // Включить модель из каталога (её не было в allowlist) и выключить стартовую.
    let out = ai::run(
        &db,
        &settings(&[]),
        model("anthropic/claude-opus-5.5", Some(OnOff::On)),
    )
    .await
    .unwrap();
    assert!(out.contains("разрешена"), "{out}");
    ai::run(&db, &settings(&[]), model(GEMINI, Some(OnOff::Off)))
        .await
        .unwrap();
    let price: i64 = sqlx::query_scalar(
        "SELECT price_out_per_mtok FROM ai_models WHERE id = 'anthropic/claude-opus-5.5'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(price, 75_000_000, "цена из каталога");
    let error = ai::run(
        &db,
        &settings(&[]),
        model("nobody/missing", Some(OnOff::On)),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("нет модели"), "{error}");

    // Перезапуск — даже с другим списком в настройках — выбор owner не трогает.
    for extra in [&[][..], &only_gemini[..]] {
        let fake = fake_openrouter().await;
        ai::start(&db, &with_key(&fake, extra)).await.unwrap();
        assert_eq!(enabled_models(&db).await, ["anthropic/claude-opus-5.5"]);
    }
    let catalog = ai::run(
        &db,
        &settings(&[]),
        AiCommand::Catalog {
            search: Some("GEMINI".into()),
        },
    )
    .await
    .unwrap();
    assert!(
        catalog.contains("google/gemini-2.5-flash-lite | $0.100000 / $0.400000 | 1048576 | нет"),
        "{catalog}"
    );

    // Провайдеры и data_collection — у модели.
    let out = ai::run(
        &db,
        &settings(&[]),
        AiCommand::Model {
            id: "anthropic/claude-opus-5.5".into(),
            state: None,
            providers: Some("Anthropic, amazon-bedrock".into()),
            data_collection: Some("deny".into()),
        },
    )
    .await
    .unwrap();
    assert!(
        out.contains("anthropic, amazon-bedrock (без автосмены)"),
        "{out}"
    );
    let (providers, collection): (Vec<String>, Option<String>) = sqlx::query_as(
        "SELECT routing_providers, data_collection FROM ai_models WHERE id = 'anthropic/claude-opus-5.5'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(providers, ["anthropic", "amazon-bedrock"]);
    assert_eq!(collection.as_deref(), Some("deny"));

    // Модель по умолчанию и для задачи.
    let used = |model: &str, task: &str| AiCommand::Use {
        model: model.into(),
        task: task.into(),
    };
    assert!(
        ai::run(&db, &settings(&[]), used(GEMINI, "default"))
            .await
            .is_err(),
        "выключенную нельзя"
    );
    ai::run(
        &db,
        &settings(&[]),
        used("anthropic/claude-opus-5.5", "default"),
    )
    .await
    .unwrap();
    let runtime = ai::start(&db, &settings(&[])).await.unwrap();
    assert_eq!(
        runtime.gateway.model_for("inbox.triage").await.unwrap(),
        "anthropic/claude-opus-5.5"
    );
    let models = ai::run(&db, &settings(&[]), AiCommand::Models)
        .await
        .unwrap();
    assert!(
        models.contains(
            "провайдеры: anthropic, amazon-bedrock | data_collection: deny | задачи: default"
        ),
        "{models}"
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
    let runtime = ai::start(&db, &with_key(&fake, &["--ai-platform-usd-per-day", "1"]))
        .await
        .unwrap();
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
        untrusted: vec![Untrusted::new("inbox", format!("купить молоко ({id})"))],
        input_tokens: 0,
        max_output_tokens: 1_000,
        job_id: None,
    }
}

/// `qubite ai try` — ручной реальный вызов владельцем: тот же шлюз, тот же бюджет.
#[tokio::test]
async fn try_command_goes_through_budget_and_gateway() {
    let (test_db, db, owner) = setup().await;
    owner_ai(&db, owner).await; // модуль docs установлен
    let fake = fake_openrouter().await;
    let args = with_key(&fake, &["--ai-platform-usd-per-day", "1"]);
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

/// API для экрана Owner Console (AI-003): каталог, включение модели с «/»
/// в имени, провайдеры, задачи. Для всех, кроме owner, адресов нет.
#[tokio::test]
async fn owner_console_api_for_models() {
    let (test_db, db, address) = common::setup(Default::default()).await;
    let fake = fake_openrouter().await;
    ai::start(&db, &with_key(&fake, &[])).await.unwrap();
    let mut owner = common::logged_in(address).await;

    let catalog = owner
        .get(address, "/api/owner/ai/catalog?search=opus")
        .await;
    assert_eq!(catalog.status, 200, "{:?}", catalog.body);
    assert_eq!(catalog.body[0]["external_id"], "anthropic/claude-opus-5.5");
    assert_eq!(catalog.body[0]["enabled"], false);

    let changed = owner
        .patch_json(
            address,
            "/api/owner/ai/models/anthropic/claude-opus-5.5",
            serde_json::json!({
                "enabled": true,
                "routing_providers": ["Anthropic"],
                "data_collection": "deny"
            }),
        )
        .await;
    assert_eq!(changed.status, 200, "{:?}", changed.body);
    assert_eq!(changed.body["enabled"], true);
    assert_eq!(
        changed.body["routing_providers"],
        serde_json::json!(["anthropic"])
    );
    assert_eq!(changed.body["data_collection"], "deny");
    assert_eq!(changed.body["price_out_per_mtok"], 75_000_000);

    let bad = owner
        .patch_json(
            address,
            "/api/owner/ai/models/anthropic/claude-opus-5.5",
            serde_json::json!({ "routing_providers": ["Не slug"] }),
        )
        .await;
    assert_eq!(bad.status, 400, "{:?}", bad.body);

    let tasks = owner
        .put_json(
            address,
            "/api/owner/ai/tasks/inbox.triage",
            serde_json::json!({ "model_id": "anthropic/claude-opus-5.5" }),
        )
        .await;
    assert_eq!(tasks.status, 200, "{:?}", tasks.body);
    // Голосовые задачи (voice.stt / voice.tts) заводит миграция ENG-001.
    let text_tasks = |body: &serde_json::Value| -> Vec<serde_json::Value> {
        body.as_array()
            .unwrap()
            .iter()
            .filter(|t| !t["task"].as_str().unwrap().starts_with("voice."))
            .cloned()
            .collect()
    };
    assert_eq!(
        text_tasks(&tasks.body),
        [serde_json::json!({ "task": "inbox.triage", "model_id": "anthropic/claude-opus-5.5" })]
    );
    let models = owner.get(address, "/api/owner/ai/models").await;
    let opus = models
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "anthropic/claude-opus-5.5")
        .unwrap();
    assert_eq!(opus["tasks"], serde_json::json!(["inbox.triage"]));
    let cleared = owner
        .put_json(
            address,
            "/api/owner/ai/tasks/inbox.triage",
            serde_json::json!({ "model_id": null }),
        )
        .await;
    assert!(text_tasks(&cleared.body).is_empty());

    // Без входа (и не owner) — этих адресов нет.
    let mut stranger = common::Browser::default();
    for path in [
        "/api/owner/ai/models",
        "/api/owner/ai/catalog",
        "/api/owner/ai/tasks",
    ] {
        assert_eq!(stranger.get(address, path).await.status, 404, "{path}");
    }
    db.close().await;
    test_db.drop_db().await;
}

/// ChatGPT по подписке — за флагом (выкл. по умолчанию) и только с ключом
/// шифрования и выполненным входом (AI-005).
#[tokio::test]
async fn chatgpt_provider_is_off_unless_flag_key_and_login() {
    let (test_db, db, _) = setup().await;
    assert!(!settings(&[]).chatgpt_enabled, "выключен по умолчанию");

    let off = ai::start(&db, &settings(&[])).await.unwrap();
    assert!(off.chatgpt.is_none());

    let key_line = ai::run(&db, &settings(&[]), AiCommand::SecretKey)
        .await
        .unwrap();
    let key = key_line
        .lines()
        .next()
        .unwrap()
        .strip_prefix("QUBITE_AI_SECRET_KEY=")
        .unwrap()
        .to_owned();
    assert_eq!(key.len(), 44, "base64 от 32 байт");

    // Флаг есть, ключа нет — выключен.
    let no_key = ai::start(&db, &settings(&["--ai-chatgpt-enabled", "true"]))
        .await
        .unwrap();
    assert!(no_key.chatgpt.is_none());
    // Флаг и ключ есть, входа нет — провайдер заведён, но выключен.
    let args = settings(&["--ai-chatgpt-enabled", "true", "--ai-secret-key", &key]);
    let no_login = ai::start(&db, &args).await.unwrap();
    assert!(no_login.chatgpt.is_none());
    let enabled: bool = sqlx::query_scalar("SELECT enabled FROM ai_providers WHERE id = 'chatgpt'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!enabled);
    let status = ai::run(
        &db,
        &args,
        AiCommand::Chatgpt {
            command: ai::ChatgptCommand::Status,
        },
    )
    .await
    .unwrap();
    assert!(status.contains("не подключён"), "{status}");
    // Вход без ключа шифрования не начинается.
    let error = ai::run(
        &db,
        &settings(&[]),
        AiCommand::Chatgpt {
            command: ai::ChatgptCommand::Login {
                port: 0,
                no_browser: true,
            },
        },
    )
    .await
    .unwrap_err();
    assert!(
        error.to_string().contains("QUBITE_AI_SECRET_KEY"),
        "{error}"
    );
    db.close().await;
    test_db.drop_db().await;
}

/// D-287: модели подписки ChatGPT видны в `qubite ai catalog` без запущенного
/// сервера и без флага — команда сама берёт их у OpenAI, если вход выполнен.
#[tokio::test]
async fn chatgpt_catalog_loads_from_cli_without_server() {
    let (test_db, db, owner) = setup().await;
    let models = serde_json::json!({ "models": [
        { "slug": "gpt-6.1-sol", "display_name": "GPT-6.1 Sol", "visibility": "list" }
    ]});
    let api = FakeHttp::start([], Action::Respond(200, models.to_string())).await;
    let key = qubite_ai::secret::SecretBox::generate_key();
    let secret = qubite_ai::secret::SecretBox::from_base64(&key).unwrap();
    let api_url = format!("{}/v1", api.root_url());
    let args = settings(&["--ai-secret-key", &key, "--ai-chatgpt-api-url", &api_url]);

    // До входа — понятная подсказка, а не «ничего».
    let before = ai::run(
        &db,
        &args,
        AiCommand::Catalog {
            search: Some("chatgpt".into()),
        },
    )
    .await
    .unwrap();
    assert!(before.contains("qubite ai chatgpt login"), "{before}");

    sqlx::query(
        "INSERT INTO ai_chatgpt_session (singleton, host_id, client_id, account_id, scopes, \
         access_token_enc, refresh_token_enc, expires_at) \
         VALUES (true, $1, 'oaiapp_test', $2, $3, $4, $5, now() + interval '1 hour')",
    )
    .bind(qubite_ai::chatgpt::new_host_id())
    .bind(owner)
    .bind(qubite_ai::chatgpt::SCOPES)
    .bind(secret.seal("chatgpt.access", "at-1"))
    .bind(secret.seal("chatgpt.refresh", "rt-1"))
    .execute(db.pool())
    .await
    .unwrap();

    let listed = ai::run(
        &db,
        &args,
        AiCommand::Catalog {
            search: Some("chatgpt".into()),
        },
    )
    .await
    .unwrap();
    assert!(
        listed.contains("chatgpt:gpt-6.1-sol | $0.000000 / $0.000000"),
        "{listed}"
    );
    assert!(api.received()[0].line.starts_with("GET /v1/models"));
    let on = ai::run(
        &db,
        &args,
        AiCommand::Model {
            id: "chatgpt:gpt-6.1-sol".into(),
            state: Some(OnOff::On),
            providers: None,
            data_collection: None,
        },
    )
    .await
    .unwrap();
    assert!(on.contains("разрешена"), "{on}");
    // Флага нет — провайдер заведён выключенным: модели видны, запросов нет.
    let enabled: bool = sqlx::query_scalar("SELECT enabled FROM ai_providers WHERE id = 'chatgpt'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!enabled);
    db.close().await;
    test_db.drop_db().await;
}
