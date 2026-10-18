//! AI-шлюз на настоящей PostgreSQL и mock-провайдере (AI_COST_GUARD §4).
//! Здесь же негативные тесты №3 и №4 из AUTH_AND_PERMISSIONS §6.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use qubite_ai::{
    AiConfig, AiError, AiRequest, Gateway, MICROS_PER_USD, MockProvider, MockStep,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
};
use qubite_db::Database;
use qubite_policy::{
    Authorized, DenyReason, Flags, ModuleId, ModulePatch, OwnerConsole, Subject, UseAi,
};
use qubite_testkit::TestDb;
use time::{OffsetDateTime, macros::datetime};
use uuid::Uuid;

const MODEL: &str = "mock-60";
/// 10 000 токенов ответа по $60 за миллион — $0,60.
const OUT_060: u32 = 10_000;
const USD_060: i64 = 600_000;

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
        let pool = db.pool();
        admin::upsert_provider(
            pool,
            &owner,
            ProviderSpec {
                id: "mock",
                kind: "mock",
                base_url: "",
                enabled: true,
            },
        )
        .await
        .unwrap();
        for (id, price) in [(MODEL, 60_000_000), ("mock-cheap", 1_000_000)] {
            admin::upsert_model(
                pool,
                &owner,
                ModelSpec {
                    id,
                    provider_id: "mock",
                    external_id: "mock-model",
                    price_in_per_mtok: 0,
                    price_out_per_mtok: price,
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
        }
    }

    /// Пользователь с грантом AI в Docs (но без бюджета).
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

    async fn limit(&self, scope: LimitScope, period: Period, metric: Metric, value: i64) -> Uuid {
        admin::set_limit(self.db.pool(), &self.owner, &scope, period, metric, value)
            .await
            .unwrap()
    }

    fn gateway(&self, mock: &Arc<MockProvider>, config: AiConfig) -> Gateway {
        Gateway::new(self.db.pool().clone(), config).with_provider("mock", mock.clone())
    }

    /// (резерв, расход) по лимиту во всех периодах.
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

    async fn call_status(&self, request_id: &str) -> String {
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

fn fast() -> AiConfig {
    AiConfig {
        timeout: Duration::from_millis(300),
        retry_delays: vec![Duration::from_millis(10), Duration::from_millis(20)],
        ..AiConfig::default()
    }
}

fn request(id: &str) -> AiRequest {
    AiRequest {
        request_id: id.into(),
        model: MODEL.into(),
        prompt: "разбери мысль: купить молоко".into(),
        input_tokens: 0,
        max_output_tokens: OUT_060,
    }
}

fn succeed(tokens_out: u64) -> MockStep {
    MockStep::Succeed {
        tokens_in: 0,
        tokens_out,
    }
}

// ---------------------------------------------------------------- №3

#[tokio::test]
async fn neg03_zero_or_missing_budget_never_reaches_provider() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    let mock = Arc::new(MockProvider::new(succeed(1)));
    let gateway = env.gateway(&mock, fast());
    let auth = env.auth(user).await;

    // Бюджет по умолчанию — ноль: лимит не задан.
    let error = gateway.complete(&auth, request("r1")).await.unwrap_err();
    assert!(matches!(error, AiError::BudgetNotSet), "{error:?}");

    // Модульный и платформенный лимиты без личного денежного — тоже нет.
    env.limit(
        LimitScope::Module(env.docs.clone()),
        Period::Month,
        Metric::Usd,
        100 * MICROS_PER_USD,
    )
    .await;
    env.limit(
        LimitScope::Platform,
        Period::Month,
        Metric::Usd,
        100 * MICROS_PER_USD,
    )
    .await;
    assert!(matches!(
        gateway.complete(&auth, request("r2")).await,
        Err(AiError::BudgetNotSet)
    ));

    // Личный лимит 0.
    env.limit(LimitScope::User(user), Period::Day, Metric::Usd, 0)
        .await;
    let error = gateway.complete(&auth, request("r3")).await.unwrap_err();
    assert!(
        matches!(error, AiError::BudgetExhausted { .. }),
        "{error:?}"
    );
    assert_eq!(error.code(), "budget_exhausted");

    // Лимит меньше оценки — тоже отказ до вызова.
    env.limit(
        LimitScope::User(user),
        Period::Day,
        Metric::Usd,
        USD_060 - 1,
    )
    .await;
    assert!(matches!(
        gateway.complete(&auth, request("r4")).await,
        Err(AiError::BudgetExhausted { .. })
    ));

    // Owner тоже проходит проверку бюджета.
    let owner_auth = env.auth(env.owner.account_id()).await;
    assert!(matches!(
        gateway.complete(&owner_auth, request("r5")).await,
        Err(AiError::BudgetNotSet)
    ));

    assert_eq!(mock.calls(), 0, "ни одного запроса к провайдеру");
    let calls: i64 = sqlx::query_scalar("SELECT count(*) FROM ai_calls")
        .fetch_one(env.db.pool())
        .await
        .unwrap();
    assert_eq!(calls, 0);
    env.finish().await;
}

// ---------------------------------------------------------------- №4

#[tokio::test]
async fn neg04_hundred_parallel_requests_make_exactly_one_reservation() {
    let env = Env::new().await;
    // Общий лимит модуля $1, оценка $0,60: поместится ровно один запрос.
    let module_limit = env
        .limit(
            LimitScope::Module(env.docs.clone()),
            Period::Month,
            Metric::Usd,
            MICROS_PER_USD,
        )
        .await;
    let mut auths = Vec::new();
    for i in 0..100 {
        let user = env.user(&format!("u{i}@qubite.ru")).await;
        env.limit(
            LimitScope::User(user),
            Period::Day,
            Metric::Usd,
            10 * MICROS_PER_USD,
        )
        .await;
        auths.push(env.auth(user).await);
    }
    // «Разные процессы» — четыре шлюза со своими пулами соединений.
    let mock = Arc::new(MockProvider::new(MockStep::Hang));
    let mut gateways = Vec::new();
    for _ in 0..4 {
        let db = env.test_db.connect().await;
        gateways.push(Arc::new(
            Gateway::new(db.pool().clone(), fast()).with_provider("mock", mock.clone()),
        ));
    }

    let tasks: Vec<_> = auths
        .into_iter()
        .enumerate()
        .map(|(i, auth)| {
            let gateway = gateways[i % 4].clone();
            tokio::spawn(async move { gateway.complete(&auth, request(&format!("p{i}"))).await })
        })
        .collect();
    let (mut unknown, mut exhausted) = (0, 0);
    for task in tasks {
        match task.await.unwrap() {
            // Провайдер «завис» — резерв удерживается и место не освобождается.
            Err(AiError::ResultUnknown { .. }) => unknown += 1,
            Err(AiError::BudgetExhausted { scope, .. }) => {
                assert_eq!(scope, "module");
                exhausted += 1;
            }
            other => panic!("неожиданный результат {other:?}"),
        }
    }
    assert_eq!(unknown, 1, "ровно один резерв");
    assert_eq!(exhausted, 99);
    assert_eq!(mock.calls(), 1);
    assert_eq!(env.usage(module_limit).await, (USD_060, 0));
    env.finish().await;
}

// ---------------------------------------------------------------- путь вызова

#[tokio::test]
async fn success_charges_actual_cost_and_returns_the_rest() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    let limit = env
        .limit(
            LimitScope::User(user),
            Period::Day,
            Metric::Usd,
            MICROS_PER_USD,
        )
        .await;
    let requests = env
        .limit(
            LimitScope::UserModule(user, env.docs.clone()),
            Period::Hour,
            Metric::Requests,
            10,
        )
        .await;
    let tokens = env
        .limit(
            LimitScope::Model(MODEL.into()),
            Period::All,
            Metric::Tokens,
            1_000_000,
        )
        .await;
    let mock = Arc::new(MockProvider::new(succeed(5_000)));
    let gateway = env.gateway(&mock, fast());

    let reply = gateway
        .complete(&env.auth(user).await, request("ok"))
        .await
        .unwrap();
    assert_eq!(reply.cost_usd, 300_000, "5 000 токенов = $0,30");
    assert!(reply.text.starts_with("mock:"));
    assert_eq!(
        env.usage(limit).await,
        (0, 300_000),
        "остаток резерва вернулся"
    );
    assert_eq!(env.usage(requests).await, (0, 1));
    assert_eq!(env.usage(tokens).await, (0, 5_000));
    assert_eq!(env.call_status("ok").await, "succeeded");

    // В журнале нет текста запроса и ответа.
    let journal: String = sqlx::query_scalar(
        "SELECT (SELECT json_agg(c)::text FROM ai_calls c) || (SELECT json_agg(e)::text FROM ai_call_events e)",
    )
    .fetch_one(env.db.pool())
    .await
    .unwrap();
    assert!(!journal.contains("молоко"), "{journal}");
    env.finish().await;
}

#[tokio::test]
async fn request_limit_and_model_allowlist_refuse_before_sending() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    env.limit(
        LimitScope::User(user),
        Period::Day,
        Metric::Usd,
        10 * MICROS_PER_USD,
    )
    .await;
    env.limit(
        LimitScope::UserModule(user, env.docs.clone()),
        Period::Hour,
        Metric::Requests,
        1,
    )
    .await;
    let mock = Arc::new(MockProvider::new(succeed(1)));
    let gateway = env.gateway(&mock, fast());
    let auth = env.auth(user).await;

    gateway.complete(&auth, request("a")).await.unwrap();
    match gateway.complete(&auth, request("b")).await {
        Err(AiError::BudgetExhausted {
            scope,
            period,
            metric,
        }) => {
            assert_eq!(
                (scope.as_str(), period.as_str(), metric.as_str()),
                ("user_module", "hour", "requests")
            );
        }
        other => panic!("{other:?}"),
    }

    // Модели нет в allowlist, модель неизвестна, провайдер выключен.
    let mut unknown = request("c");
    unknown.model = "gpt-unknown".into();
    assert!(matches!(
        gateway.complete(&auth, unknown).await,
        Err(AiError::ModelNotAllowed)
    ));
    admin::upsert_provider(
        env.db.pool(),
        &env.owner,
        ProviderSpec {
            id: "mock",
            kind: "mock",
            base_url: "",
            enabled: false,
        },
    )
    .await
    .unwrap();
    assert!(matches!(
        gateway.complete(&auth, request("d")).await,
        Err(AiError::ModelNotAllowed)
    ));

    assert_eq!(mock.calls(), 1);
    env.finish().await;
}

#[tokio::test]
async fn same_request_id_is_never_charged_twice() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    let limit = env
        .limit(
            LimitScope::User(user),
            Period::Day,
            Metric::Usd,
            10 * MICROS_PER_USD,
        )
        .await;
    let mock = Arc::new(MockProvider::new(succeed(u64::from(OUT_060))));
    let gateway = Arc::new(env.gateway(&mock, fast()));
    let auth = env.auth(user).await;

    gateway.complete(&auth, request("once")).await.unwrap();
    let again = gateway.complete(&auth, request("once")).await.unwrap_err();
    assert!(
        matches!(&again, AiError::DuplicateRequest { status } if status == "succeeded"),
        "{again:?}"
    );

    // Десять одновременных повторов нового запроса — один вызов.
    let tasks: Vec<_> = (0..10)
        .map(|_| {
            let (gateway, auth) = (gateway.clone(), auth.clone());
            tokio::spawn(async move { gateway.complete(&auth, request("burst")).await })
        })
        .collect();
    let mut ok = 0;
    for task in tasks {
        match task.await.unwrap() {
            Ok(_) => ok += 1,
            Err(AiError::DuplicateRequest { .. }) => {}
            other => panic!("{other:?}"),
        }
    }
    assert_eq!(ok, 1);
    assert_eq!(mock.calls(), 2);
    assert_eq!(env.usage(limit).await, (0, 2 * USD_060));
    env.finish().await;
}

#[tokio::test]
async fn not_sent_is_retried_up_to_three_times_then_suggests_other_models() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    let limit = env
        .limit(
            LimitScope::User(user),
            Period::Day,
            Metric::Usd,
            MICROS_PER_USD,
        )
        .await;
    let auth = env.auth(user).await;

    // Две неудачи до отправки, третья попытка — успех.
    let mock = Arc::new(
        MockProvider::new(succeed(1)).script([MockStep::FailBeforeSend, MockStep::FailBeforeSend]),
    );
    env.gateway(&mock, fast())
        .complete(&auth, request("third"))
        .await
        .unwrap();
    assert_eq!(mock.calls(), 3);

    // Всегда отказ — после 3 попыток ошибка, резерв возвращён, тихой замены модели нет.
    let mock = Arc::new(MockProvider::new(MockStep::FailBeforeSend));
    match env
        .gateway(&mock, fast())
        .complete(&auth, request("never"))
        .await
    {
        Err(AiError::ProviderUnavailable { alternatives }) => {
            assert_eq!(alternatives, ["mock-cheap"])
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(mock.calls(), 3);
    assert_eq!(env.call_status("never").await, "failed_not_sent");
    let (reserved, _) = env.usage(limit).await;
    assert_eq!(reserved, 0);
    env.finish().await;
}

#[tokio::test]
async fn revoked_grant_between_attempts_stops_the_next_one() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    let limit = env
        .limit(
            LimitScope::User(user),
            Period::Day,
            Metric::Usd,
            MICROS_PER_USD,
        )
        .await;
    let mock = Arc::new(MockProvider::new(succeed(1)).script([MockStep::FailBeforeSend]));
    let config = AiConfig {
        retry_delays: vec![Duration::from_millis(300), Duration::from_millis(300)],
        ..fast()
    };
    let gateway = Arc::new(env.gateway(&mock, config));
    let auth = env.auth(user).await;

    let call = {
        let gateway = gateway.clone();
        tokio::spawn(async move { gateway.complete(&auth, request("r")).await })
    };
    mock.called.notified().await; // первая попытка не ушла, шлюз ждёт повтора
    qubite_policy::grants::revoke(env.db.pool(), &env.owner, user, &env.docs, Some("тест"))
        .await
        .unwrap();

    let error = call.await.unwrap().unwrap_err();
    assert!(
        matches!(error, AiError::Denied(DenyReason::ModuleNotGranted)),
        "{error:?}"
    );
    assert_eq!(mock.calls(), 1, "вторая попытка не отправлена");
    assert_eq!(env.call_status("r").await, "denied");
    assert_eq!(env.usage(limit).await, (0, 0));
    env.finish().await;
}

#[tokio::test]
async fn unknown_result_holds_reserve_and_is_settled_once() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    let limit = env
        .limit(
            LimitScope::User(user),
            Period::Day,
            Metric::Usd,
            10 * MICROS_PER_USD,
        )
        .await;
    let auth = env.auth(user).await;

    // Обрыв после отправки: повтора нет, резерв держится.
    let mock = Arc::new(MockProvider::new(MockStep::DropAfterSend));
    let call_id = match env
        .gateway(&mock, fast())
        .complete(&auth, request("drop"))
        .await
    {
        Err(AiError::ResultUnknown { call_id }) => call_id,
        other => panic!("{other:?}"),
    };
    assert_eq!(mock.calls(), 1);
    assert_eq!(env.usage(limit).await, (USD_060, 0));

    // Ответ пришёл позже — учитывается один раз.
    assert_eq!(
        qubite_ai::settle_late(env.db.pool(), call_id, 0, 5_000)
            .await
            .unwrap(),
        300_000
    );
    assert!(
        qubite_ai::settle_late(env.db.pool(), call_id, 0, 5_000)
            .await
            .is_err()
    );
    assert_eq!(env.usage(limit).await, (0, 300_000));

    // Таймаут — тоже «неизвестно».
    let mock = Arc::new(MockProvider::new(MockStep::Hang));
    let config = AiConfig {
        timeout: Duration::from_millis(50),
        ..fast()
    };
    assert!(matches!(
        env.gateway(&mock, config)
            .complete(&auth, request("slow"))
            .await,
        Err(AiError::ResultUnknown { .. })
    ));
    assert_eq!(env.call_status("slow").await, "unknown");

    // Процесс упал после отметки «отправляется»: после восстановления — unknown, резерв на месте.
    let mock = Arc::new(MockProvider::new(MockStep::Hang));
    let gateway = Arc::new(env.gateway(&mock, AiConfig::default()));
    let task = {
        let (gateway, auth) = (gateway.clone(), auth.clone());
        tokio::spawn(async move { gateway.complete(&auth, request("crash")).await })
    };
    mock.called.notified().await;
    task.abort();
    let _ = task.await;
    assert_eq!(env.call_status("crash").await, "sending");
    assert_eq!(
        qubite_ai::recover_stale(env.db.pool(), Duration::ZERO)
            .await
            .unwrap(),
        1
    );
    assert_eq!(env.call_status("crash").await, "unknown");
    let (reserved, _) = env.usage(limit).await;
    assert_eq!(
        reserved,
        2 * USD_060,
        "резервы «slow» и «crash» удерживаются"
    );
    env.finish().await;
}

#[tokio::test]
async fn reply_more_expensive_than_estimate_counts_fully_and_blocks_model() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    let limit = env
        .limit(
            LimitScope::User(user),
            Period::Day,
            Metric::Usd,
            10 * MICROS_PER_USD,
        )
        .await;
    let mock = Arc::new(MockProvider::new(succeed(2 * u64::from(OUT_060))));
    let gateway = env.gateway(&mock, fast());
    let auth = env.auth(user).await;

    let reply = gateway.complete(&auth, request("big")).await.unwrap();
    assert_eq!(reply.cost_usd, 2 * USD_060);
    assert_eq!(env.usage(limit).await, (0, 2 * USD_060), "учтено полностью");

    let error = gateway.complete(&auth, request("next")).await.unwrap_err();
    assert!(matches!(error, AiError::ModelBlocked(_)), "{error:?}");
    assert_eq!(mock.calls(), 1);

    admin::unblock_model(env.db.pool(), &env.owner, MODEL)
        .await
        .unwrap();
    gateway.complete(&auth, request("after")).await.unwrap();
    env.finish().await;
}

#[tokio::test]
async fn midnight_and_timezone_change_keep_reserves_and_spending() {
    let env = Env::new().await;
    let user = env.user("u@qubite.ru").await;
    let day = env
        .limit(
            LimitScope::User(user),
            Period::Day,
            Metric::Usd,
            MICROS_PER_USD,
        )
        .await;
    let auth = env.auth(user).await;

    let now = Arc::new(Mutex::new(datetime!(2026-10-18 18:30 UTC))); // 23:30 в Екатеринбурге
    let clock_now = now.clone();
    let config = AiConfig {
        clock: Arc::new(move || *clock_now.lock().unwrap()),
        ..fast()
    };
    let set = |at: OffsetDateTime| *now.lock().unwrap() = at;
    let per_key = |key: &'static str| {
        let pool = env.db.pool().clone();
        async move {
            sqlx::query_as::<_, (i64, i64)>(
                "SELECT reserved, spent FROM ai_usage_counters WHERE limit_id = $1 AND period_key = $2",
            )
            .bind(day)
            .bind(key)
            .fetch_one(&pool)
            .await
            .unwrap()
        }
    };

    // 23:30: ответ потерялся — $0,60 в резерве «вчерашнего» дня.
    let drop = Arc::new(MockProvider::new(MockStep::DropAfterSend));
    let lost = match env
        .gateway(&drop, config.clone())
        .complete(&auth, request("late"))
        .await
    {
        Err(AiError::ResultUnknown { call_id }) => call_id,
        other => panic!("{other:?}"),
    };
    assert_eq!(per_key("2026-10-18").await, (USD_060, 0));

    // 00:30 следующего дня: новый день, свежий лимит; вчерашний резерв на месте.
    set(datetime!(2026-10-18 19:30 UTC));
    let ok = Arc::new(MockProvider::new(succeed(u64::from(OUT_060))));
    let gateway = env.gateway(&ok, config.clone());
    gateway.complete(&auth, request("today")).await.unwrap();
    assert_eq!(per_key("2026-10-19").await, (0, USD_060));
    assert_eq!(per_key("2026-10-18").await, (USD_060, 0));

    // Поздний ответ списывается в тот день, где был резерв.
    qubite_ai::settle_late(env.db.pool(), lost, 0, 5_000)
        .await
        .unwrap();
    assert_eq!(per_key("2026-10-18").await, (0, 300_000));

    // Смена пояса на Москву (22:30, всё ещё 18-е): накопленное за 18-е не обнулилось.
    gateway.set_timezone("Europe/Moscow").await.unwrap();
    gateway.complete(&auth, request("msk-1")).await.unwrap(); // 0,30 + 0,60 ≤ 1
    assert!(matches!(
        gateway.complete(&auth, request("msk-2")).await,
        Err(AiError::BudgetExhausted { .. })
    ));
    assert_eq!(per_key("2026-10-18").await, (0, 300_000 + USD_060));

    assert!(matches!(
        gateway.set_timezone("Mars/Olympus").await,
        Err(AiError::Invalid(_))
    ));
    env.finish().await;
}
