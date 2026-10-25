//! Живой разговор (ENG-005): временный ключ realtime через шлюз — права,
//! подписка человека, свои лимиты (сеансов и минут в день, длина сеанса),
//! защита от зацикливания и журнал. Провайдер — подделка, в интернет не ходим.

use std::{sync::Arc, time::Duration};

use qubite_ai::{
    AiConfig, AiError, Gateway, LoopGuard, MockRealtime, MockRealtimeStep, RealtimeLimits,
    RealtimeRequest, Untrusted, catalog,
    realtime::{DEFAULT_MODEL, DEFAULT_VOICE},
};
use qubite_db::Database;
use qubite_policy::{Authorized, Flags, ModuleId, ModulePatch, OwnerConsole, Subject, UseAi};
use qubite_testkit::TestDb;
use uuid::Uuid;

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
        // Модели realtime — из миграции; провайдер включает запуск с QUBITE_AI_CHATGPT_ENABLED.
        catalog::ensure_provider(db.pool(), "chatgpt", "chatgpt", "", true)
            .await
            .unwrap();
        Self {
            test_db,
            db,
            owner,
            docs,
        }
    }

    /// Человек с доступом к Docs и AI — без личного лимита в $: подписка его не требует.
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

    fn gateway(&self, provider: Arc<MockRealtime>, limits: RealtimeLimits) -> Gateway {
        let config = AiConfig {
            retry_delays: vec![Duration::from_millis(5); 2],
            realtime: limits,
            ..AiConfig::default()
        };
        Gateway::new(self.db.pool().clone(), config).with_realtime("chatgpt", provider)
    }

    async fn finish(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

fn request(id: &str) -> RealtimeRequest {
    RealtimeRequest {
        request_id: id.into(),
        model: DEFAULT_MODEL.into(),
        prompt: "Ты — Нейт, репетитор".into(),
        untrusted: vec![Untrusted::new("lesson", "Present Simple")],
        voice: DEFAULT_VOICE.into(),
        language: None,
    }
}

#[tokio::test]
async fn key_is_issued_through_gateway_and_logged_as_own_subscription() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru").await;
    let provider = Arc::new(MockRealtime::new());
    let gateway = env.gateway(provider.clone(), RealtimeLimits::default());
    assert!(gateway.realtime_ready(DEFAULT_MODEL).await.unwrap());

    let s = gateway
        .realtime_open(&env.auth(me).await, request("rt-1"))
        .await
        .unwrap();
    assert_eq!(s.key, "ek_test_1");
    assert_eq!(s.external_id, "gpt-realtime-1.5");
    assert_eq!(s.max_seconds, 15 * 60);
    assert!(s.calls_url.ends_with("/v1/realtime/calls"));

    let calls = provider.calls();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].account_id, me, "подписка — только своя");
    assert_eq!(calls[0].voice, "marin");
    assert!(calls[0].instructions.contains("Ты — Нейт"));
    // Урок — данными в неподделываемой метке, не инструкцией.
    assert!(calls[0].instructions.contains("source=\"lesson\""));

    let (status, paid, model): (String, String, String) =
        sqlx::query_as("SELECT status, paid_by, model_id FROM ai_calls WHERE id = $1")
            .bind(s.call_id)
            .fetch_one(env.db.pool())
            .await
            .unwrap();
    assert_eq!(
        (status.as_str(), paid.as_str(), model.as_str()),
        ("succeeded", "subscription", DEFAULT_MODEL)
    );

    // Конец: не больше, чем прошло (+5 с), повтор ничего не меняет.
    let counted = gateway.realtime_finish(me, s.call_id, 3600).await.unwrap();
    assert!((5..=6).contains(&counted), "{counted}");
    assert_eq!(
        gateway.realtime_finish(me, s.call_id, 1).await.unwrap(),
        counted
    );
    let tokens: i64 = sqlx::query_scalar("SELECT tokens_in FROM ai_calls WHERE id = $1")
        .bind(s.call_id)
        .fetch_one(env.db.pool())
        .await
        .unwrap();
    assert_eq!(tokens as u64, counted, "секунды — в журнал");
    // Чужой сеанс не закрыть.
    let other = env.user("other@qubite.ru").await;
    assert!(matches!(
        gateway.realtime_finish(other, s.call_id, 1).await,
        Err(AiError::Invalid(_))
    ));
    env.finish().await;
}

#[tokio::test]
async fn day_limits_count_sessions_and_minutes_unclosed_at_worst() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru").await;
    let provider = Arc::new(MockRealtime::new());
    let gateway = env.gateway(
        provider.clone(),
        RealtimeLimits {
            max_session_secs: 600,
            day_sessions: 3,
            day_secs: 1000,
        },
    );
    let auth = env.auth(me).await;

    // Первый не закрыт (вкладку закрыли) — следующий его закроет по часам.
    let first = gateway.realtime_open(&auth, request("a")).await.unwrap();
    assert_eq!(first.max_seconds, 600);
    // Будто прошло 10 минут — засчитается потолок сеанса.
    sqlx::query(
        "UPDATE ai_realtime_sessions SET started_at = now() - interval '20 minutes' WHERE call_id = $1",
    )
    .bind(first.call_id)
    .execute(env.db.pool())
    .await
    .unwrap();
    let usage = gateway.realtime_usage(me).await.unwrap();
    assert_eq!((usage.sessions, usage.seconds), (1, 600));

    // На сегодня осталось 400 с — второй сеанс короче.
    let second = gateway.realtime_open(&auth, request("b")).await.unwrap();
    assert_eq!(second.max_seconds, 400);
    let closed: Option<i32> =
        sqlx::query_scalar("SELECT seconds FROM ai_realtime_sessions WHERE call_id = $1")
            .bind(first.call_id)
            .fetch_one(env.db.pool())
            .await
            .unwrap();
    assert_eq!(closed, Some(600), "не закрытый — по худшему случаю");
    gateway
        .realtime_finish(me, second.call_id, 2)
        .await
        .unwrap();

    // Третий — можно, четвёртый — уже нет (3 в день).
    let third = gateway.realtime_open(&auth, request("c")).await.unwrap();
    gateway.realtime_finish(me, third.call_id, 1).await.unwrap();
    let error = gateway
        .realtime_open(&auth, request("d"))
        .await
        .unwrap_err();
    assert!(
        matches!(&error, AiError::SessionLimit(m) if m.contains("3 из 3")),
        "{error:?}"
    );
    assert_eq!(error.code(), "realtime_limit");
    assert_eq!(provider.calls().len(), 3, "отказ — до провайдера");

    // Минуты: потрачено почти всё — отказ, хотя сеансы ещё есть.
    let other = env.user("other@qubite.ru").await;
    let other_auth = env.auth(other).await;
    let s = gateway
        .realtime_open(&other_auth, request("o1"))
        .await
        .unwrap();
    sqlx::query(
        "UPDATE ai_realtime_sessions SET seconds = 990, ended_at = now() WHERE call_id = $1",
    )
    .bind(s.call_id)
    .execute(env.db.pool())
    .await
    .unwrap();
    assert!(matches!(
        gateway.realtime_open(&other_auth, request("o2")).await,
        Err(AiError::SessionLimit(m)) if m.contains("минут")
    ));
    env.finish().await;
}

#[tokio::test]
async fn subscription_limit_refusal_and_loop_guard_stop_before_a_session() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru").await;
    let provider = Arc::new(MockRealtime::new().script([
        MockRealtimeStep::UsageLimit,
        MockRealtimeStep::Refused("unsupported_country_region_territory".into()),
        MockRealtimeStep::NotSent,
        MockRealtimeStep::Key,
    ]));
    let config = AiConfig {
        retry_delays: vec![Duration::from_millis(5); 2],
        loop_guard: LoopGuard {
            user_per_minute: 4,
            ..LoopGuard::default()
        },
        ..AiConfig::default()
    };
    let gateway =
        Gateway::new(env.db.pool().clone(), config).with_realtime("chatgpt", provider.clone());
    let auth = env.auth(me).await;

    assert!(matches!(
        gateway.realtime_open(&auth, request("l1")).await,
        Err(AiError::SubscriptionLimit { .. })
    ));
    assert!(matches!(
        gateway.realtime_open(&auth, request("l2")).await,
        Err(AiError::ProviderRefused { reason, .. }) if reason.contains("unsupported_country")
    ));
    // «Не ушёл» — повтор, со второй попытки ключ.
    let s = gateway.realtime_open(&auth, request("l3")).await.unwrap();
    assert_eq!(s.key, "ek_test_1");
    let sessions: i64 = sqlx::query_scalar("SELECT count(*) FROM ai_realtime_sessions")
        .fetch_one(env.db.pool())
        .await
        .unwrap();
    assert_eq!(sessions, 1, "отказы сеансом не считаются");
    // Тот же request_id — второй ключ не выдаётся.
    assert!(matches!(
        gateway.realtime_open(&auth, request("l3")).await,
        Err(AiError::DuplicateRequest { .. })
    ));
    // Защита от зацикливания: 4 запроса за минуту — пятый стоп.
    gateway.realtime_open(&auth, request("l4")).await.unwrap();
    assert!(matches!(
        gateway.realtime_open(&auth, request("l5")).await,
        Err(AiError::RateLimited { .. })
    ));
    env.finish().await;
}

#[tokio::test]
async fn provider_off_or_text_model_gives_no_session() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru").await;
    let provider = Arc::new(MockRealtime::new());
    let gateway = env.gateway(provider.clone(), RealtimeLimits::default());
    let auth = env.auth(me).await;
    // Текстовая модель живым разговором не станет.
    let mut text = request("t1");
    text.model = "openai/gpt-4o-mini".into();
    assert!(gateway.realtime_open(&auth, text).await.is_err());

    catalog::ensure_provider(env.db.pool(), "chatgpt", "chatgpt", "", false)
        .await
        .unwrap();
    assert!(!gateway.realtime_ready(DEFAULT_MODEL).await.unwrap());
    assert!(matches!(
        gateway.realtime_open(&auth, request("off")).await,
        Err(AiError::SourceNotReady(_))
    ));
    assert!(provider.calls().is_empty());
    env.finish().await;
}
