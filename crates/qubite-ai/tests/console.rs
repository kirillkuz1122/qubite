//! AI-003: что owner и человек меняют кнопками — «сделать мне безлимит»,
//! снятие лимита, защита от зацикливания из Console, свой ключ OpenRouter.
//! Только mock-провайдеры на настоящей PostgreSQL.

use std::{sync::Arc, time::Duration};

use qubite_ai::{
    AiConfig, AiError, AiRequest, Gateway, LoopGuard, MICROS_PER_USD, MockProvider, MockStep,
    Untrusted,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
    secret::SecretBox,
};
use qubite_db::Database;
use qubite_policy::{Authorized, Flags, ModuleId, ModulePatch, OwnerConsole, Subject, UseAi};
use qubite_testkit::TestDb;
use uuid::Uuid;

const MODEL: &str = "mock-60";
const OR_MODEL: &str = "vendor/or-model";

struct Env {
    test_db: TestDb,
    db: Database,
    owner: OwnerConsole,
    docs: ModuleId,
    secret: Arc<SecretBox>,
}

impl Env {
    async fn new() -> Self {
        let (test_db, db) = TestDb::migrated().await;
        let owner = qubite_auth::owner::create(
            db.pool(),
            &qubite_auth::Passwords::default(),
            "owner@qubite.ru",
            "",
            "пароль владельца",
        )
        .await
        .unwrap();
        let owner = qubite_policy::decide_owner(db.pool(), &Subject::account(owner.id, None))
            .await
            .unwrap();
        let docs = ModuleId::new("docs").unwrap();
        qubite_policy::catalog::update(
            db.pool(),
            &owner,
            &docs,
            ModulePatch {
                installed: Some(true),
                readiness: Some("stable".into()),
                ..ModulePatch::default()
            },
        )
        .await
        .unwrap();
        let pool = db.pool();
        for (id, kind) in [("mock", "mock"), ("openrouter", "openrouter")] {
            admin::upsert_provider(
                pool,
                &owner,
                ProviderSpec {
                    id,
                    kind,
                    base_url: "",
                    enabled: true,
                },
            )
            .await
            .unwrap();
        }
        for (id, provider) in [(MODEL, "mock"), (OR_MODEL, "openrouter")] {
            admin::upsert_model(
                pool,
                &owner,
                ModelSpec {
                    id,
                    provider_id: provider,
                    external_id: id,
                    price_in_per_mtok: 0,
                    price_out_per_mtok: 60_000_000,
                    context_tokens: 100_000,
                    enabled: true,
                },
            )
            .await
            .unwrap();
        }
        Self {
            test_db,
            db,
            owner,
            docs,
            secret: Arc::new(SecretBox::from_base64(&SecretBox::generate_key()).unwrap()),
        }
    }

    async fn user(&self, email: &str) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO accounts (id, email, email_verified_at, status) VALUES ($1, $2, now(), 'active')",
        )
        .bind(id)
        .bind(email)
        .execute(self.db.pool())
        .await
        .unwrap();
        let flags = Flags {
            read: true,
            ai: true,
            ..Flags::NONE
        };
        qubite_policy::grants::set(self.db.pool(), &self.owner, id, &self.docs, flags, None)
            .await
            .unwrap();
        id
    }

    async fn auth(&self, account: Uuid) -> Authorized<UseAi> {
        qubite_policy::decide::<UseAi>(self.db.pool(), &Subject::account(account, None), &self.docs)
            .await
            .unwrap()
    }

    fn gateway(&self, mock: &Arc<MockProvider>) -> Gateway {
        let config = AiConfig {
            timeout: Duration::from_millis(300),
            retry_delays: vec![],
            ..AiConfig::default()
        };
        Gateway::new(self.db.pool().clone(), config)
            .with_provider("mock", mock.clone())
            .with_provider("openrouter", mock.clone())
            .with_secrets(self.secret.clone())
    }

    async fn live_limits(&self) -> Vec<(String, Option<Uuid>, String, i64)> {
        sqlx::query_as(
            "SELECT scope_kind, account_id, period, limit_value FROM ai_limits \
             WHERE revoked_at IS NULL ORDER BY scope_kind, period",
        )
        .fetch_all(self.db.pool())
        .await
        .unwrap()
    }

    async fn actions(&self, prefix: &str) -> Vec<String> {
        sqlx::query_scalar("SELECT action FROM audit_log WHERE action LIKE $1 ORDER BY seq")
            .bind(format!("{prefix}%"))
            .fetch_all(self.db.pool())
            .await
            .unwrap()
    }

    async fn finish(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

fn request(id: &str, model: &str) -> AiRequest {
    AiRequest {
        request_id: id.into(),
        model: model.into(),
        prompt: "Разбери мысль".into(),
        untrusted: vec![Untrusted::new("inbox", format!("купить молоко ({id})"))],
        input_tokens: 0,
        max_output_tokens: 1_000,
        job_id: None,
    }
}

fn ok() -> MockStep {
    MockStep::Succeed {
        tokens_in: 0,
        tokens_out: 1_000,
    }
}

#[tokio::test]
async fn make_me_unlimited_removes_personal_cap_and_sets_platform_cap() {
    let env = Env::new().await;
    let mock = Arc::new(MockProvider::new(ok()));
    let gateway = env.gateway(&mock);
    let me = env.owner.account_id();
    // Как у владельца 22.10: личный лимит в $ кончился — режим не помогал.
    admin::set_owner_unlimited(env.db.pool(), &env.owner, true)
        .await
        .unwrap();
    admin::set_limit(
        env.db.pool(),
        &env.owner,
        &LimitScope::User(me),
        Period::Day,
        Metric::Usd,
        1,
    )
    .await
    .unwrap();
    let auth = env.auth(me).await;
    assert!(matches!(
        gateway.complete(&auth, request("before", MODEL)).await,
        Err(AiError::BudgetExhausted { scope, .. }) if scope == "user"
    ));

    let report = admin::make_owner_unlimited(env.db.pool(), &env.owner, 5 * MICROS_PER_USD)
        .await
        .unwrap();
    assert_eq!(report.removed_personal, 1);
    assert_eq!(report.platform_cap_set, Some(5 * MICROS_PER_USD));
    assert_eq!(
        env.live_limits().await,
        [("platform".into(), None, "day".into(), 5 * MICROS_PER_USD)]
    );
    gateway
        .complete(&auth, request("after", MODEL))
        .await
        .unwrap();

    // Второй раз — ничего лишнего: потолок уже есть и не меняется.
    let again = admin::make_owner_unlimited(env.db.pool(), &env.owner, MICROS_PER_USD)
        .await
        .unwrap();
    assert_eq!(again, admin::UnlimitedReport::default());
    assert_eq!(env.live_limits().await[0].3, 5 * MICROS_PER_USD);
    let actions = env.actions("ai.").await;
    assert!(
        actions.contains(&"ai.limit_revoked".to_owned()),
        "{actions:?}"
    );
    assert_eq!(
        actions
            .iter()
            .filter(|a| *a == "ai.owner_unlimited_set")
            .count(),
        3
    );
    env.finish().await;
}

#[tokio::test]
async fn revoked_limit_stops_counting_and_is_audited() {
    let env = Env::new().await;
    let mock = Arc::new(MockProvider::new(ok()));
    let gateway = env.gateway(&mock);
    let user = env.user("u@qubite.ru").await;
    let personal = admin::set_limit(
        env.db.pool(),
        &env.owner,
        &LimitScope::User(user),
        Period::Day,
        Metric::Usd,
        MICROS_PER_USD,
    )
    .await
    .unwrap();
    let auth = env.auth(user).await;
    gateway.complete(&auth, request("r1", MODEL)).await.unwrap();
    admin::revoke_limit(env.db.pool(), &env.owner, personal)
        .await
        .unwrap();
    // Личного лимита больше нет — бюджет снова ноль (D-173).
    assert!(matches!(
        gateway.complete(&auth, request("r2", MODEL)).await,
        Err(AiError::BudgetNotSet)
    ));
    assert!(matches!(
        admin::revoke_limit(env.db.pool(), &env.owner, personal).await,
        Err(AiError::Invalid(_))
    ));
    let (before,): (serde_json::Value,) = sqlx::query_as(
        "SELECT before FROM audit_log WHERE action = 'ai.limit_revoked' AND target_id = $1",
    )
    .bind(personal.to_string())
    .fetch_one(env.db.pool())
    .await
    .unwrap();
    assert_eq!(before["scope"], "user");
    assert_eq!(before["value"], MICROS_PER_USD);
    env.finish().await;
}

#[tokio::test]
async fn loop_guard_from_console_wins_and_resets_to_server_settings() {
    let env = Env::new().await;
    let mock = Arc::new(MockProvider::new(ok()));
    let gateway = env.gateway(&mock);
    let user = env.user("u@qubite.ru").await;
    admin::set_limit(
        env.db.pool(),
        &env.owner,
        &LimitScope::User(user),
        Period::Day,
        Metric::Usd,
        100 * MICROS_PER_USD,
    )
    .await
    .unwrap();
    assert_eq!(
        gateway.loop_guard_now().await.unwrap(),
        LoopGuard::default()
    );
    let strict = LoopGuard {
        user_per_minute: 2,
        job_per_minute: 0,
        repeat_limit: 0,
        repeat_window: Duration::from_secs(60),
    };
    admin::set_loop_guard(env.db.pool(), &env.owner, Some(&strict))
        .await
        .unwrap();
    assert_eq!(gateway.loop_guard_now().await.unwrap(), strict);
    let auth = env.auth(user).await;
    gateway.complete(&auth, request("g1", MODEL)).await.unwrap();
    gateway.complete(&auth, request("g2", MODEL)).await.unwrap();
    assert!(matches!(
        gateway.complete(&auth, request("g3", MODEL)).await,
        Err(AiError::RateLimited { scope }) if scope == "user"
    ));
    // 0 — выключено.
    admin::set_loop_guard(
        env.db.pool(),
        &env.owner,
        Some(&LoopGuard {
            user_per_minute: 0,
            ..strict.clone()
        }),
    )
    .await
    .unwrap();
    gateway.complete(&auth, request("g4", MODEL)).await.unwrap();
    // Окно повторов — от 1 до 86 400 секунд.
    for window in [0, 86_401] {
        assert!(matches!(
            admin::set_loop_guard(
                env.db.pool(),
                &env.owner,
                Some(&LoopGuard {
                    repeat_window: Duration::from_secs(window),
                    ..strict.clone()
                }),
            )
            .await,
            Err(AiError::Invalid(_))
        ));
    }
    admin::set_loop_guard(env.db.pool(), &env.owner, None)
        .await
        .unwrap();
    assert_eq!(
        gateway.loop_guard_now().await.unwrap(),
        LoopGuard::default()
    );
    assert_eq!(
        env.actions("ai.loop_guard").await.len(),
        3,
        "неудачные попытки в журнал не попадают"
    );
    env.finish().await;
}

#[tokio::test]
async fn own_openrouter_key_pays_for_itself_without_owner_money() {
    let env = Env::new().await;
    let mock = Arc::new(MockProvider::new(ok()));
    let gateway = env.gateway(&mock);
    let user = env.user("u@qubite.ru").await;
    let auth = env.auth(user).await;
    // Без личного лимита и без своего ключа — AI нет.
    assert!(matches!(
        gateway.complete(&auth, request("k0", OR_MODEL)).await,
        Err(AiError::BudgetNotSet)
    ));
    admin::set_source(env.db.pool(), user, "own_key", None)
        .await
        .unwrap();
    assert!(matches!(
        gateway.complete(&auth, request("k1", OR_MODEL)).await,
        Err(AiError::SourceNotReady(reason)) if reason.contains("не добавлен")
    ));
    let sealed = env
        .secret
        .seal(&qubite_ai::key_purpose(Some(user)), "sk-or-mine-1234");
    admin::save_key(env.db.pool(), user, Some(user), &sealed, "1234")
        .await
        .unwrap();
    // Денежный потолок платформы его деньги не ограничивает, запросы — да.
    admin::set_limit(
        env.db.pool(),
        &env.owner,
        &LimitScope::Platform,
        Period::Day,
        Metric::Usd,
        1,
    )
    .await
    .unwrap();
    admin::set_limit(
        env.db.pool(),
        &env.owner,
        &LimitScope::EachUser,
        Period::Day,
        Metric::Requests,
        1,
    )
    .await
    .unwrap();
    gateway
        .complete(&auth, request("k2", OR_MODEL))
        .await
        .unwrap();
    let call = mock.last_call().unwrap();
    assert_eq!(
        call.api_key.as_ref().map(|k| k.expose()),
        Some("sk-or-mine-1234")
    );
    assert!(matches!(
        gateway.complete(&auth, request("k3", OR_MODEL)).await,
        Err(AiError::BudgetExhausted { metric, .. }) if metric == "requests"
    ));
    let paid: String = sqlx::query_scalar("SELECT paid_by FROM ai_calls WHERE request_id = 'k2'")
        .fetch_one(env.db.pool())
        .await
        .unwrap();
    assert_eq!(paid, "own_key");

    // Ключ, зашифрованный для другого человека, не подходит.
    let other = env.user("o@qubite.ru").await;
    admin::set_source(env.db.pool(), other, "own_key", None)
        .await
        .unwrap();
    admin::save_key(env.db.pool(), other, Some(other), &sealed, "1234")
        .await
        .unwrap();
    assert!(matches!(
        gateway
            .complete(&env.auth(other).await, request("k4", OR_MODEL))
            .await,
        Err(AiError::SourceNotReady(reason)) if reason.contains("не прочитан")
    ));

    // Ключ убран и выбран owner — снова нужен личный лимит.
    assert!(
        admin::remove_key(env.db.pool(), user, Some(user))
            .await
            .unwrap()
    );
    admin::set_source(env.db.pool(), user, "owner", None)
        .await
        .unwrap();
    assert!(matches!(
        gateway.complete(&auth, request("k5", OR_MODEL)).await,
        Err(AiError::BudgetNotSet)
    ));
    let actions = env.actions("ai.key").await;
    assert_eq!(actions, ["ai.key_set", "ai.key_set", "ai.key_removed"]);
    let leaked: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM audit_log WHERE after::text LIKE '%sk-or-mine%')",
    )
    .fetch_one(env.db.pool())
    .await
    .unwrap();
    assert!(!leaked, "ключа в журнале нет");
    env.finish().await;
}
