//! Агент раскладывает Входящие через настоящий HTTP-сервер (CMD-004): мысль
//! ставит задачу `agent.triage`, обработчик очереди (как в `qubite serve`, но
//! запускает его тест) раскладывает на поддельной модели, Входящие видят
//! «разложил → …» и откатывают; вопрос «посмотри сам» и ответ владельца.

mod common;

use std::sync::Arc;

use common::logged_in;
use qubite_ai::{
    AiConfig, Gateway, MockProvider, MockStep,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
};
use qubite_notify::deliver::Channels;
use qubite_server::{agent_memory, auth::AuthSettings};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

fn reply(value: Value) -> MockStep {
    MockStep::Reply {
        text: value.to_string(),
        tokens_in: 100,
        tokens_out: 50,
    }
}

async fn gateway(pool: &PgPool, owner: Uuid, steps: Vec<MockStep>) -> (Gateway, Arc<MockProvider>) {
    let console = qubite_policy::decide_owner(pool, &qubite_policy::Subject::account(owner, None))
        .await
        .unwrap();
    admin::upsert_provider(
        pool,
        &console,
        ProviderSpec {
            id: "mock",
            kind: "mock",
            base_url: "",
            enabled: true,
        },
    )
    .await
    .unwrap();
    admin::upsert_model(
        pool,
        &console,
        ModelSpec {
            id: "mock-agent",
            provider_id: "mock",
            external_id: "mock-model",
            price_in_per_mtok: 0,
            price_out_per_mtok: 1_000_000,
            context_tokens: 100_000,
            enabled: true,
        },
    )
    .await
    .unwrap();
    admin::set_task_model(pool, &console, "agent.triage", Some("mock-agent"))
        .await
        .unwrap();
    admin::set_limit(
        pool,
        &console,
        &LimitScope::User(owner),
        Period::Day,
        Metric::Usd,
        10_000_000,
    )
    .await
    .unwrap();
    let mock = Arc::new(
        MockProvider::new(MockStep::Reply {
            text: "{\"kind\": \"archive\", \"confidence\": 0.9}".into(),
            tokens_in: 1,
            tokens_out: 1,
        })
        .script(steps),
    );
    (
        Gateway::new(pool.clone(), AiConfig::default()).with_provider("mock", mock.clone()),
        mock,
    )
}

/// Выполнить задачи агента, не дожидаясь паузы перед разбором.
async fn run_now(pool: &PgPool, gateway: &Gateway) -> usize {
    sqlx::query("UPDATE jobs SET run_at = now() WHERE kind = 'agent.triage' AND status = 'queued'")
        .execute(pool)
        .await
        .unwrap();
    agent_memory::run_ready(pool, gateway, &Channels::default())
        .await
        .unwrap()
}

#[tokio::test]
async fn inbox_shows_what_agent_filed_and_reverts_it() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let pool = db.pool();
    let mut owner = logged_in(address).await;
    let me: Uuid = sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_one(pool)
        .await
        .unwrap();
    let (gateway, mock) = gateway(
        pool,
        me,
        vec![
            reply(json!({"kind": "idea", "title": "Свой сайт", "confidence": 0.9, "why": "без срока"})),
            reply(json!({
                "kind": "unsure",
                "confidence": 0.3,
                "question": "Это дело или идея?",
                "options": ["Дело", "Идея"]
            })),
            reply(json!({"kind": "task", "title": "Купить тетрадь", "confidence": 0.5, "remember": "Тетради — это дела"})),
        ],
    )
    .await;

    let site = owner
        .post_json(
            address,
            "/api/v1/inbox",
            json!({"text": "сделать свой сайт когда-нибудь"}),
        )
        .await;
    assert_eq!(site.status, 201, "{:?}", site.body);
    let site_id = site.body["id"].as_str().unwrap().to_owned();

    // Пока агент не взялся — Элик думает над мыслью.
    let state = owner.get(address, "/api/v1/agent/triage").await;
    assert_eq!(state.status, 200, "{:?}", state.body);
    assert_eq!(state.body["thinking"], json!([site_id]));

    assert_eq!(run_now(pool, &gateway).await, 1);
    assert_eq!(mock.calls(), 1);
    let state = owner.get(address, "/api/v1/agent/triage").await;
    assert_eq!(state.body["thinking"], json!([]));
    let filed = &state.body["filed"][0];
    assert_eq!(filed["item_id"], json!(site_id));
    assert_eq!(filed["label"], "идея");
    assert_eq!(filed["reason"], "без срока");
    let new = owner.get(address, "/api/v1/inbox?view=new").await;
    assert!(new.body.as_array().unwrap().is_empty(), "мысль разложена");

    // «Откатить» — мысль снова во Входящих, пометка пропала.
    let batch = filed["batch_id"].as_str().unwrap().to_owned();
    let undo = owner
        .post_json(
            address,
            &format!("/api/v1/agent/batches/{batch}/revert"),
            json!({"force": false}),
        )
        .await;
    assert_eq!(undo.status, 200, "{:?}", undo.body);
    assert_eq!(undo.body["status"], "reverted");
    let state = owner.get(address, "/api/v1/agent/triage").await;
    assert_eq!(state.body["filed"], json!([]));
    let new = owner.get(address, "/api/v1/inbox?view=new").await;
    assert_eq!(new.body[0]["id"], json!(site_id));

    // Неуверенное — «посмотри сам» с вопросом; ответ — агент раскладывает по нему.
    let book = owner
        .post_json(
            address,
            "/api/v1/inbox",
            json!({"text": "тетрадь в клетку"}),
        )
        .await;
    let book_id = book.body["id"].as_str().unwrap().to_owned();
    run_now(pool, &gateway).await;
    let review = owner.get(address, "/api/v1/inbox?view=review").await;
    assert_eq!(review.body[0]["id"], json!(book_id));
    assert_eq!(review.body[0]["review_reason"], "Это дело или идея?");

    let wrong = owner
        .post_json(
            address,
            &format!("/api/v1/agent/triage/{site_id}/answer"),
            json!({"answer": "дело"}),
        )
        .await;
    assert_eq!(wrong.status, 400, "агент об этой мысли не спрашивал");
    let answered = owner
        .post_json(
            address,
            &format!("/api/v1/agent/triage/{book_id}/answer"),
            json!({"answer": "Дело"}),
        )
        .await;
    assert_eq!(answered.status, 202, "{:?}", answered.body);
    run_now(pool, &gateway).await;
    let state = owner.get(address, "/api/v1/agent/triage").await;
    assert_eq!(state.body["filed"][0]["item_id"], json!(book_id));
    assert_eq!(state.body["filed"][0]["label"], "дело");
    assert_eq!(mock.calls(), 3);

    // Чужой без агента — 403.
    let mut stranger = common::Browser::default();
    qubite_auth::accounts::create(
        pool,
        &qubite_auth::Passwords::default(),
        qubite_auth::accounts::NewAccount {
            email: "student@qubite.ru",
            display_name: "",
            password: "пароль ученика",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    stranger
        .login(address, "student@qubite.ru", "пароль ученика")
        .await;
    assert_eq!(
        stranger.get(address, "/api/v1/agent/triage").await.status,
        403
    );

    db.close().await;
    test_db.drop_db().await;
}
