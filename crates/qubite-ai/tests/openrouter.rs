//! Адаптер OpenRouter и каталог цен (AI-002) — на поддельном сервере
//! с записанными ответами (`tests/fixtures/openrouter`). В интернет не ходим.

use std::{sync::Arc, time::Duration};

use qubite_ai::{
    AiConfig, AiError, AiRequest, Gateway, MICROS_PER_USD, Untrusted,
    admin::{self, LimitScope, Metric, Period},
    catalog::{self, Allowlist, STARTER_MODELS},
    openrouter::{CatalogEntry, OpenRouter, OpenRouterConfig},
};
use qubite_db::Database;
use qubite_kernel::Secret;
use qubite_policy::{Flags, ModuleId, ModulePatch, OwnerConsole, Subject, UseAi};
use qubite_testkit::{
    TestDb,
    fake_http::{self, Action, FakeHttp},
};
use uuid::Uuid;

const KEY: &str = "sk-or-v1-test-key-not-real";
const GEMINI: &str = "google/gemini-2.5-flash-lite";

fn fixture(name: &str) -> String {
    let path = format!(
        "{}/tests/fixtures/openrouter/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn ok(name: &str) -> Action {
    Action::Respond(200, fixture(name))
}

fn adapter(base_url: String) -> Arc<OpenRouter> {
    Arc::new(
        OpenRouter::new(OpenRouterConfig {
            base_url,
            connect_timeout: Duration::from_secs(2),
            ..OpenRouterConfig::new(Secret::new(KEY))
        })
        .unwrap(),
    )
}

struct Env {
    test_db: TestDb,
    db: Database,
    owner: OwnerConsole,
    docs: ModuleId,
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
        Self {
            test_db,
            db,
            owner,
            docs,
        }
    }

    /// Провайдер `openrouter` и стартовые модели с ценами из записанного каталога.
    async fn with_catalog(self) -> Self {
        catalog::ensure_provider(self.db.pool(), "openrouter", "openrouter", "", true)
            .await
            .unwrap();
        let fake = FakeHttp::start([], ok("models.json")).await;
        let entries = adapter(fake.base_url()).catalog().await.unwrap();
        catalog::apply(
            self.db.pool(),
            "openrouter",
            &entries,
            &Allowlist::Exact(STARTER_MODELS.iter().map(|m| (*m).to_owned()).collect()),
        )
        .await
        .unwrap();
        self
    }

    /// Пользователь с грантом AI в Docs и личным лимитом $1 в день.
    async fn user(&self) -> (Uuid, qubite_policy::Authorized<UseAi>, Uuid) {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO accounts (id, email, email_verified_at, status) VALUES ($1, $2, now(), 'active')",
        )
        .bind(id)
        .bind(format!("{id}@qubite.ru"))
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
        let limit = admin::set_limit(
            self.db.pool(),
            &self.owner,
            &LimitScope::User(id),
            Period::Day,
            Metric::Usd,
            MICROS_PER_USD,
        )
        .await
        .unwrap();
        let auth =
            qubite_policy::decide::<UseAi>(self.db.pool(), &Subject::account(id, None), &self.docs)
                .await
                .unwrap();
        (id, auth, limit)
    }

    fn gateway(&self, provider: Arc<OpenRouter>) -> Gateway {
        let config = AiConfig {
            timeout: Duration::from_millis(500),
            retry_delays: vec![Duration::from_millis(10), Duration::from_millis(20)],
            ..AiConfig::default()
        };
        Gateway::new(self.db.pool().clone(), config).with_provider("openrouter", provider)
    }

    async fn usage(&self, limit: Uuid) -> (i64, i64) {
        sqlx::query_as(
            "SELECT coalesce(sum(reserved), 0)::bigint, coalesce(sum(spent), 0)::bigint \
             FROM ai_usage_counters WHERE limit_id = $1",
        )
        .bind(limit)
        .fetch_one(self.db.pool())
        .await
        .unwrap()
    }

    async fn status(&self, request_id: &str) -> String {
        sqlx::query_scalar("SELECT status FROM ai_calls WHERE request_id = $1")
            .bind(request_id)
            .fetch_one(self.db.pool())
            .await
            .unwrap()
    }

    async fn finish(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

fn request(id: &str) -> AiRequest {
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

// ---------------------------------------------------------------- каталог

#[tokio::test]
async fn catalog_prices_are_exact_and_unpriceable_models_are_skipped() {
    let fake = FakeHttp::start([], ok("models.json")).await;
    let entries = adapter(fake.base_url()).catalog().await.unwrap();
    let ids: Vec<&str> = entries.iter().map(|e| e.external_id.as_str()).collect();
    assert_eq!(
        ids,
        [
            GEMINI,
            "openai/gpt-4.1-nano",
            "mistralai/mistral-small-3.2-24b-instruct",
            "anthropic/claude-opus-5.5"
        ],
        "плавающая цена и плата за запрос — пропущены"
    );
    assert_eq!(
        entries[0],
        CatalogEntry {
            external_id: GEMINI.into(),
            context_tokens: 1_048_576,
            price_in_per_mtok: 100_000,  // $0,10 за миллион
            price_out_per_mtok: 400_000, // $0,40 за миллион
        }
    );
    let sent = &fake.received()[0];
    assert_eq!(sent.line, "GET /api/v1/models HTTP/1.1");
    assert_eq!(
        sent.header("authorization"),
        Some(&*format!("Bearer {KEY}"))
    );

    // Каталог недоступен — понятная ошибка без ключа.
    let error = adapter(fake_http::closed_port_url().await)
        .catalog()
        .await
        .unwrap_err()
        .to_string();
    assert!(
        error.contains("недоступен") && !error.contains(KEY),
        "{error}"
    );
}

#[tokio::test]
async fn catalog_sync_applies_allowlist_and_keeps_owner_choice() {
    let env = Env::new().await.with_catalog().await;
    let pool = env.db.pool();
    let models: Vec<(String, bool, i64, i64)> = sqlx::query_as(
        "SELECT id, enabled, price_in_per_mtok, price_out_per_mtok FROM ai_models ORDER BY id",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    assert_eq!(
        models,
        [
            (GEMINI.into(), true, 100_000, 400_000),
            (
                "mistralai/mistral-small-3.2-24b-instruct".into(),
                true,
                50_000,
                100_000
            ),
            ("openai/gpt-4.1-nano".into(), true, 100_000, 400_000),
        ],
        "дорогая модель из каталога в базу не попала"
    );

    // Точный список: одна модель из стартовых и одна несуществующая.
    let entries = vec![CatalogEntry {
        external_id: GEMINI.into(),
        context_tokens: 1_048_576,
        price_in_per_mtok: 150_000,
        price_out_per_mtok: 600_000,
    }];
    let report = catalog::apply(
        pool,
        "openrouter",
        &entries,
        &Allowlist::Exact(vec![GEMINI.into(), "nobody/missing".into()]),
    )
    .await
    .unwrap();
    assert_eq!(report.enabled, [GEMINI]);
    assert_eq!(report.missing, ["nobody/missing"]);
    let enabled: Vec<String> =
        sqlx::query_scalar("SELECT id FROM ai_models WHERE enabled ORDER BY id")
            .fetch_all(pool)
            .await
            .unwrap();
    assert_eq!(enabled, [GEMINI], "не из списка — выключены");

    // Keep: owner выключил модель вручную — обновление цен её не включит.
    admin::set_model_enabled(pool, &env.owner, GEMINI, false)
        .await
        .unwrap();
    let mut cheaper = entries.clone();
    cheaper[0].price_in_per_mtok = 90_000;
    catalog::apply(pool, "openrouter", &cheaper, &Allowlist::Keep)
        .await
        .unwrap();
    let (enabled, price): (bool, i64) =
        sqlx::query_as("SELECT enabled, price_in_per_mtok FROM ai_models WHERE id = $1")
            .bind(GEMINI)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!((enabled, price), (false, 90_000));

    let synced: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = 'ai.catalog_synced'")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(synced, 3);
    env.finish().await;
}

#[tokio::test]
async fn restart_does_not_rewrite_provider_or_reset_limits() {
    let env = Env::new().await;
    let pool = env.db.pool();
    for _ in 0..3 {
        catalog::ensure_provider(pool, "openrouter", "openrouter", "https://x", true)
            .await
            .unwrap();
    }
    catalog::ensure_provider(pool, "openrouter", "openrouter", "https://x", false)
        .await
        .unwrap();
    let audits: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = 'ai.provider_set'")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(audits, 2, "в аудите только настоящие изменения");

    let cap = 5 * MICROS_PER_USD;
    let scope = LimitScope::Platform;
    assert!(
        admin::ensure_limit(pool, &scope, Period::Month, Metric::Usd, cap)
            .await
            .unwrap()
    );
    let limit: Uuid = sqlx::query_scalar("SELECT id FROM ai_limits WHERE revoked_at IS NULL")
        .fetch_one(pool)
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO ai_usage_counters (limit_id, period_key, spent) VALUES ($1, '2026-10', 123)",
    )
    .bind(limit)
    .execute(pool)
    .await
    .unwrap();
    assert!(
        !admin::ensure_limit(pool, &scope, Period::Month, Metric::Usd, cap)
            .await
            .unwrap(),
        "то же значение — лимит не пересоздаётся, расход не обнуляется"
    );
    assert_eq!(env.usage(limit).await, (0, 123));
    assert!(
        admin::ensure_limit(pool, &scope, Period::Month, Metric::Usd, cap + 1)
            .await
            .unwrap()
    );
    let live: i64 = sqlx::query_scalar("SELECT count(*) FROM ai_limits WHERE revoked_at IS NULL")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(live, 1);
    env.finish().await;
}

// ---------------------------------------------------------------- вызовы

#[tokio::test]
async fn successful_call_sends_guarded_request_and_charges_usage() {
    let env = Env::new().await.with_catalog().await;
    let (_, auth, limit) = env.user().await;
    let fake = FakeHttp::start([], ok("chat_ok.json")).await;
    let gateway = env.gateway(adapter(fake.base_url()));

    let reply = gateway.complete(&auth, request("ok")).await.unwrap();
    assert_eq!(reply.text, "Задача: купить молоко. Срок: сегодня.");
    assert_eq!((reply.tokens_in, reply.tokens_out), (412, 18));
    // 412 × $0,10/M + 18 × $0,40/M = 48,4 микродоллара → 49 (вверх);
    // OpenRouter сообщил $0,0000484 — то же самое.
    assert_eq!(reply.cost_usd, 49);
    assert!(reply.warnings.is_empty());
    assert_eq!(env.usage(limit).await, (0, 49));
    assert_eq!(env.status("ok").await, "succeeded");

    let received = fake.received();
    assert_eq!(received.len(), 1);
    let sent = &received[0];
    assert_eq!(sent.line, "POST /api/v1/chat/completions HTTP/1.1");
    assert_eq!(
        sent.header("authorization"),
        Some(&*format!("Bearer {KEY}"))
    );
    let body: serde_json::Value = serde_json::from_str(&sent.body).unwrap();
    assert_eq!(body["model"], GEMINI);
    assert_eq!(body["max_tokens"], 1_000);
    assert_eq!(body["stream"], false);
    assert_eq!(body["usage"]["include"], true);
    // Провайдеры не закреплены и data_collection не задан — только потолок цены.
    assert_eq!(
        body["provider"],
        serde_json::json!({ "max_price": { "prompt": 0.1, "completion": 0.4 } })
    );
    assert_eq!(body["messages"][0]["role"], "system");
    assert_eq!(body["messages"][1]["role"], "user");
    assert!(
        body["messages"][1]["content"]
            .as_str()
            .unwrap()
            .contains("купить молоко")
    );
    env.finish().await;
}

#[tokio::test]
async fn rate_limit_is_retried_up_to_three_times() {
    let env = Env::new().await.with_catalog().await;
    let (_, auth, limit) = env.user().await;

    // 429, потом успех: вторая попытка.
    let fake = FakeHttp::start(
        [Action::Respond(429, fixture("error_429.json"))],
        ok("chat_ok.json"),
    )
    .await;
    env.gateway(adapter(fake.base_url()))
        .complete(&auth, request("second"))
        .await
        .unwrap();
    assert_eq!(fake.received().len(), 2);

    // Всегда 503 — три попытки, резерв возвращён, предложены другие модели.
    let fake = FakeHttp::start(
        [],
        Action::Respond(
            503,
            r#"{"error":{"code":503,"message":"No allowed providers"}}"#.into(),
        ),
    )
    .await;
    match env
        .gateway(adapter(fake.base_url()))
        .complete(&auth, request("busy"))
        .await
    {
        Err(AiError::ProviderUnavailable { alternatives }) => assert_eq!(
            alternatives,
            [
                "mistralai/mistral-small-3.2-24b-instruct",
                "openai/gpt-4.1-nano"
            ]
        ),
        other => panic!("{other:?}"),
    }
    assert_eq!(fake.received().len(), 3, "не больше трёх попыток");
    assert_eq!(env.status("busy").await, "failed_not_sent");
    let (reserved, _) = env.usage(limit).await;
    assert_eq!(reserved, 0);
    env.finish().await;
}

#[tokio::test]
async fn no_connection_is_proven_not_sent() {
    let env = Env::new().await.with_catalog().await;
    let (_, auth, limit) = env.user().await;
    let error = env
        .gateway(adapter(fake_http::closed_port_url().await))
        .complete(&auth, request("offline"))
        .await
        .unwrap_err();
    assert!(
        matches!(error, AiError::ProviderUnavailable { .. }),
        "{error:?}"
    );
    assert_eq!(env.status("offline").await, "failed_not_sent");
    assert_eq!(env.usage(limit).await, (0, 0));
    let attempts: i32 =
        sqlx::query_scalar("SELECT attempts FROM ai_calls WHERE request_id = 'offline'")
            .fetch_one(env.db.pool())
            .await
            .unwrap();
    assert_eq!(attempts, 3);
    let events: String = sqlx::query_scalar("SELECT json_agg(details)::text FROM ai_call_events")
        .fetch_one(env.db.pool())
        .await
        .unwrap();
    assert!(!events.contains(KEY), "ключа нет в журнале");
    env.finish().await;
}

#[tokio::test]
async fn refusals_are_not_retried_and_cost_nothing() {
    let env = Env::new().await.with_catalog().await;
    let (_, auth, limit) = env.user().await;
    for (status, file) in [(402, "error_402.json"), (401, "error_401.json")] {
        let fake = FakeHttp::start([], Action::Respond(status, fixture(file))).await;
        let id = format!("refused-{status}");
        match env
            .gateway(adapter(fake.base_url()))
            .complete(&auth, request(&id))
            .await
        {
            Err(AiError::ProviderRefused { reason, .. }) => {
                assert!(reason.starts_with(&format!("HTTP {status}")), "{reason}");
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(fake.received().len(), 1, "повтора нет");
        assert_eq!(env.status(&id).await, "failed_not_sent");
    }
    assert_eq!(env.usage(limit).await, (0, 0));
    env.finish().await;
}

/// Всё, после чего модель могла отработать, — «неизвестно»: повтора нет,
/// резерв удерживается.
#[tokio::test]
async fn ambiguous_outcomes_hold_the_reserve() {
    let env = Env::new().await.with_catalog().await;
    let (_, auth, limit) = env.user().await;
    let cases = [
        (
            "bad-gateway",
            Action::Respond(502, fixture("error_502.json")),
        ),
        ("server-error", Action::Respond(500, "oops".into())),
        ("garbage", Action::Respond(200, "{\"choices\": 42".into())),
        ("dropped", Action::Close),
        ("hang", Action::Hang),
    ];
    let mut held = 0;
    for (id, action) in cases {
        let fake = FakeHttp::start([], action).await;
        let error = env
            .gateway(adapter(fake.base_url()))
            .complete(&auth, request(id))
            .await
            .unwrap_err();
        assert!(
            matches!(error, AiError::ResultUnknown { .. }),
            "{id}: {error:?}"
        );
        assert_eq!(fake.received().len(), 1, "{id}: повтора нет");
        assert_eq!(env.status(id).await, "unknown", "{id}");
        let estimate: i64 =
            sqlx::query_scalar("SELECT estimate_usd FROM ai_calls WHERE request_id = $1")
                .bind(id)
                .fetch_one(env.db.pool())
                .await
                .unwrap();
        held += estimate;
        assert_eq!(env.usage(limit).await, (held, 0), "{id}: резерв на месте");
    }
    env.finish().await;
}

#[tokio::test]
async fn missing_usage_is_charged_as_worst_case() {
    let env = Env::new().await.with_catalog().await;
    let (_, auth, limit) = env.user().await;
    let fake = FakeHttp::start([], ok("chat_no_usage.json")).await;
    let reply = env
        .gateway(adapter(fake.base_url()))
        .complete(&auth, request("no-usage"))
        .await
        .unwrap();
    let estimate: i64 =
        sqlx::query_scalar("SELECT estimate_usd FROM ai_calls WHERE request_id = 'no-usage'")
            .fetch_one(env.db.pool())
            .await
            .unwrap();
    assert!(estimate > 0);
    assert_eq!(reply.cost_usd, estimate, "списана вся оценка");
    assert_eq!(reply.tokens_out, 1_000);
    assert_eq!(env.usage(limit).await, (0, estimate));
    let blocked: Option<String> =
        sqlx::query_scalar("SELECT blocked_reason FROM ai_models WHERE id = $1")
            .bind(GEMINI)
            .fetch_one(env.db.pool())
            .await
            .unwrap();
    assert_eq!(blocked, None, "не дороже оценки — модель не блокируется");
    env.finish().await;
}

// ---------------------------------------------------------------- AI-004

/// Закреплённые провайдеры — только они и без автосмены; `data_collection`
/// модели или сервера; потолок цены — из каталога (D-211).
#[tokio::test]
async fn pinned_providers_are_sent_without_fallbacks() {
    let env = Env::new().await.with_catalog().await;
    let (_, auth, _) = env.user().await;
    admin::set_model_routing(
        env.db.pool(),
        &env.owner,
        GEMINI,
        &["google-vertex/us-east5".into(), "google-ai-studio".into()],
        Some("deny"),
    )
    .await
    .unwrap();
    let fake = FakeHttp::start([], ok("chat_ok.json")).await;
    env.gateway(adapter(fake.base_url()))
        .complete(&auth, request("pinned"))
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_str(&fake.received()[0].body).unwrap();
    assert_eq!(
        body["provider"],
        serde_json::json!({
            "order": ["google-vertex/us-east5", "google-ai-studio"],
            "only": ["google-vertex/us-east5", "google-ai-studio"],
            "allow_fallbacks": false,
            "data_collection": "deny",
            "max_price": { "prompt": 0.1, "completion": 0.4 },
        })
    );

    // Модель без своей настройки берёт data_collection сервера.
    let fake = FakeHttp::start([], ok("chat_ok.json")).await;
    let server_deny = Arc::new(
        OpenRouter::new(OpenRouterConfig {
            base_url: fake.base_url(),
            data_collection: Some("deny".into()),
            ..OpenRouterConfig::new(Secret::new(KEY))
        })
        .unwrap(),
    );
    let mut nano = request("nano");
    nano.model = "openai/gpt-4.1-nano".into();
    env.gateway(server_deny)
        .complete(&auth, nano)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_str(&fake.received()[0].body).unwrap();
    assert_eq!(body["provider"]["data_collection"], "deny");
    assert!(body["provider"].get("order").is_none());
    assert!(body["provider"].get("allow_fallbacks").is_none());

    // Неверные имена провайдеров не сохраняются.
    for bad in ["Google Vertex", "", "a\"b"] {
        assert!(
            admin::set_model_routing(env.db.pool(), &env.owner, GEMINI, &[bad.into()], None)
                .await
                .is_err(),
            "{bad:?}"
        );
    }
    assert!(
        admin::set_model_routing(env.db.pool(), &env.owner, GEMINI, &[], Some("maybe"))
            .await
            .is_err()
    );
    env.finish().await;
}

/// Каталог хранится целиком — owner включает любую модель с ценой из каталога.
#[tokio::test]
async fn owner_enables_any_catalog_model() {
    let env = Env::new().await.with_catalog().await;
    let pool = env.db.pool();
    let in_catalog: i64 =
        sqlx::query_scalar("SELECT count(*) FROM ai_catalog WHERE provider_id = 'openrouter'")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        in_catalog, 4,
        "весь каталог, кроме моделей без понятной цены"
    );
    let id =
        admin::enable_from_catalog(pool, &env.owner, "openrouter", "anthropic/claude-opus-5.5")
            .await
            .unwrap();
    let (enabled, price_in, price_out): (bool, i64, i64) = sqlx::query_as(
        "SELECT enabled, price_in_per_mtok, price_out_per_mtok FROM ai_models WHERE id = $1",
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        (enabled, price_in, price_out),
        (true, 15_000_000, 75_000_000)
    );
    assert!(
        admin::enable_from_catalog(pool, &env.owner, "openrouter", "openrouter/auto")
            .await
            .is_err(),
        "модель с плавающей ценой включить нельзя"
    );
    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'ai.model_enabled_set' AND target_id = $1",
    )
    .bind(&id)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audit, 1);
    env.finish().await;
}
