//! Реальные маршруты Command, подставные модели и GitHub.

mod common;

use std::{net::SocketAddr, sync::Arc};

use common::{Browser, EMAIL, PASSWORD, Reply};
use qubite_ai::{
    AiConfig, Gateway, MockProvider, MockStep,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_db::Database;
use qubite_kernel::Secret;
use qubite_server::{AppState, auth::AuthSettings, harness::WorkSettings};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp, Received},
};
use serde_json::json;
use sqlx::PgPool;
use time::{Date, Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

const ROUTE: &str = "/api/command/dispatch";

fn reply(text: impl Into<String>) -> MockStep {
    MockStep::Reply {
        text: text.into(),
        tokens_in: 10,
        tokens_out: 10,
    }
}

fn kind(kind: &str) -> MockStep {
    reply(json!({"kind": kind, "confidence": 0.9}).to_string())
}

async fn fixture_steps(steps: Vec<MockStep>) -> (TestDb, Database, AppState, Arc<MockProvider>) {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    qubite_auth::owner::create(pool, &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let account: Uuid = sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_one(pool)
        .await
        .unwrap();
    let by = qubite_policy::decide_owner(pool, &qubite_policy::Subject::account(account, None))
        .await
        .unwrap();
    admin::upsert_provider(
        pool,
        &by,
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
        &by,
        ModelSpec {
            id: "mock-command",
            provider_id: "mock",
            external_id: "claude-sonnet-4",
            price_in_per_mtok: 0,
            price_out_per_mtok: 1_000_000,
            context_tokens: 100_000,
            enabled: true,
        },
    )
    .await
    .unwrap();
    for task in ["command.dispatch", "command.answer", "agent.chat"] {
        admin::set_task_model(pool, &by, task, Some("mock-command"))
            .await
            .unwrap();
    }
    admin::set_limit(
        pool,
        &by,
        &LimitScope::User(account),
        Period::Day,
        Metric::Usd,
        10_000_000,
    )
    .await
    .unwrap();
    let mock = Arc::new(MockProvider::new(kind("thought")).script(steps));
    let gateway =
        Gateway::new(pool.clone(), AiConfig::default()).with_provider("mock", mock.clone());
    let state = AppState::with_auth(db.clone(), AuthSettings::default()).with_ai(Arc::new(gateway));
    (test_db, db, state, mock)
}

async fn spawn(state: AppState) -> SocketAddr {
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    address
}

async fn send(owner: &mut Browser, address: SocketAddr, text: &str) -> Reply {
    owner
        .post_json(address, ROUTE, json!({"text": text, "source": "web"}))
        .await
}

async fn collector(pool: &PgPool) {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO pult_collectors (id, name, token_hash) VALUES ($1, 'ПК', $2)")
        .bind(id)
        .bind(vec![1_u8; 32])
        .execute(pool)
        .await
        .unwrap();
    let now = OffsetDateTime::now_utc();
    let at = now.format(&Rfc3339).unwrap();
    let reset = (now + Duration::days(2)).format(&Rfc3339).unwrap();
    sqlx::query("INSERT INTO pult_reports (collector_id, body) VALUES ($1, $2)")
        .bind(id)
        .bind(json!({
            "version": 1, "host": "pc", "at": at,
            "limits": {"at": at, "seven_day": {"used": 50, "resets_at": reset}},
            "sessions": [{
                "id": "pult-sample", "title": "Сессия из Пульта",
                "model": "claude-sonnet-4", "started_at": at, "last_at": at,
                "session_url": "https://example.org/session",
                "usage": [{"model": "claude-sonnet-4", "output": 200_000}]
            }],
            "days": [{"date": now.date().to_string(),
                "usage": [{"model": "claude-sonnet-4", "output": 1_000_000}]}]
        }))
        .execute(pool)
        .await
        .unwrap();
}

#[tokio::test]
async fn thought_question_order_and_correction() {
    let (_test_db, db, state, mock) = fixture_steps(vec![
        kind("thought"),
        kind("question"),
        reply("Сегодня повторить графы"),
        reply(r#"{"kind":"order","confidence":0.9,"title":"Разобрать конспект"}"#),
        reply("Переклассифицированный вопрос"),
        kind("question"),
        reply("Уточнение"),
    ])
    .await;
    let pool = db.pool();
    collector(pool).await;
    let address = spawn(state).await;
    let mut owner = common::logged_in(address).await;

    let thought = send(&mut owner, address, "Набросок на завтра").await;
    assert_eq!(thought.status, 200, "{}", thought.body);
    assert_eq!(thought.body["kind"], "thought");
    assert_eq!(thought.body["message"], "✓ записал");
    let inbox = owner.get(address, "/api/v1/inbox").await;
    assert_eq!(inbox.body[0]["body"], "Набросок на завтра");

    let date: Date = sqlx::query_scalar("SELECT (now() AT TIME ZONE 'Asia/Yekaterinburg')::date")
        .fetch_one(pool)
        .await
        .unwrap();
    let seeded = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            json!({
                "device_id": Uuid::now_v7(),
                "ops": [{
                    "op_id": Uuid::now_v7(), "object_id": Uuid::now_v7(),
                    "kind": "create", "object_type": "planner.task", "title": "Повторить графы",
                    "fields": {"due_date": date.to_string()}
                }]
            }),
        )
        .await;
    assert_eq!(
        seeded.body["results"][0]["status"], "applied",
        "{}",
        seeded.body
    );

    let question = send(&mut owner, address, "Что на сегодня?").await;
    assert_eq!(question.status, 200, "{}", question.body);
    assert_eq!(question.body["kind"], "question");
    assert_eq!(question.body["message"], "Сегодня повторить графы");
    assert_eq!(question.body["model"], "mock-command");
    assert_eq!(question.body["cost_usd"], 10);
    assert_eq!(mock.calls(), 3, "сводка не требует вызова модели");
    let call = mock.last_call().unwrap();
    assert!(
        call.messages
            .iter()
            .any(|msg| msg.content.contains("Повторить графы"))
    );
    assert!(
        call.messages
            .iter()
            .any(|msg| msg.content.contains("Сессия из Пульта"))
    );

    let order = send(&mut owner, address, "Добавь дело разобрать конспект").await;
    assert_eq!(order.status, 200, "{}", order.body);
    assert_eq!(order.body["kind"], "order");
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM objects WHERE type = 'planner.task' AND title = 'Разобрать конспект'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(count, 1);

    let id = thought.body["id"].as_str().unwrap();
    let url = format!("{ROUTE}/{id}/reclassify");
    let corrected = owner
        .post_json(address, &url, json!({"kind":"question"}))
        .await;
    assert_eq!(corrected.status, 200, "{}", corrected.body);
    assert_eq!(corrected.body["kind"], "question");
    assert_eq!(corrected.body["message"], "Переклассифицированный вопрос");
    let repeated = owner
        .post_json(address, &url, json!({"kind":"thought"}))
        .await;
    assert_eq!(repeated.body["kind"], "thought");
    assert_eq!(
        owner
            .get(address, "/api/v1/inbox")
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let followup = send(&mut owner, address, "Что ещё?").await;
    assert_eq!(followup.status, 200, "{}", followup.body);
    let call = mock.last_call().unwrap();
    assert!(
        call.messages
            .iter()
            .any(|msg| msg.content.contains("Что на сегодня?"))
    );
    let card = owner
        .get(address, "/api/owner/pult/agents/pc-pult-sample")
        .await;
    assert_eq!(
        card.body["agent"]["session_url"],
        "https://example.org/session"
    );
}

async fn chat_jobs(pool: &PgPool) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = 'agent.chat'")
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn expensive_orders_need_confirmation_and_cannot_be_replayed() {
    let (_test_db, db, state, mock) = fixture_steps(vec![reply(
        r#"{"kind":"order","confidence":0.98,"target":"agent","estimate_percent":0}"#,
    )])
    .await;
    collector(db.pool()).await;
    let address = spawn(state).await;
    let mut owner = common::logged_in(address).await;
    let id = Uuid::now_v7();
    let text = "Поручи агенту собрать сводку";
    let mut body = json!({"id": id, "text": text, "source": "web", "confirm": true});
    let early = owner.post_json(address, ROUTE, body.clone()).await;
    assert_eq!(early.status, 400);
    assert_eq!(mock.calls(), 0);

    body["confirm"] = json!(false);
    let pending = owner.post_json(address, ROUTE, body.clone()).await;
    assert_eq!(pending.status, 200, "{}", pending.body);
    assert_eq!(pending.body["status"], "needs_confirm");
    assert!((pending.body["estimate_percent"].as_f64().unwrap() - 10.0).abs() < 0.001);
    let repeated = owner.post_json(address, ROUTE, body.clone()).await;
    assert_eq!(repeated.body, pending.body);
    assert_eq!(chat_jobs(db.pool()).await, 0);

    body["confirm"] = json!(true);
    let executed = owner.post_json(address, ROUTE, body.clone()).await;
    assert_eq!(executed.status, 200, "{}", executed.body);
    assert_eq!(executed.body["status"], "done");
    assert_eq!(
        owner.post_json(address, ROUTE, body).await.body,
        executed.body
    );
    assert_eq!(chat_jobs(db.pool()).await, 1);
    assert_eq!(mock.calls(), 1);
}

#[tokio::test]
async fn dispatch_is_owner_only() {
    let (_test_db, db, state, mock) = fixture_steps(Vec::new()).await;
    let address = spawn(state).await;
    let email = "other@example.org";
    qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email,
            display_name: "Пользователь",
            password: PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut browser = Browser::default();
    assert_eq!(browser.login(address, email, PASSWORD).await.status, 200);
    assert_eq!(
        send(&mut browser, address, "Что на сегодня?").await.status,
        403
    );
    let response = browser
        .post_json(
            address,
            &format!("{ROUTE}/{}/reclassify", Uuid::now_v7()),
            json!({"kind":"thought"}),
        )
        .await;
    assert_eq!(response.status, 403);
    assert_eq!(mock.calls(), 0);
}

#[tokio::test]
async fn pult_reply_uses_the_original_issue_comment() {
    let respond = Arc::new(|req: &Received| -> (u16, String) {
        let path = "/repos/o/r/issues/7";
        if req.line.starts_with(&format!("GET {path} ")) {
            return (
                200,
                json!({
                    "number": 7, "title": "Вопрос", "html_url": "https://example.org/7",
                    "body": "Как сделать?", "state": "open", "labels": [{"name":"вопрос"}],
                    "updated_at": "2026-11-20T00:00:00Z", "comments": 0
                })
                .to_string(),
            );
        }
        if req.line.starts_with(&format!("POST {path}/comments ")) {
            return (
                201,
                json!({"html_url":"https://example.org/7#answer"}).to_string(),
            );
        }
        if req.line.starts_with(&format!("DELETE {path}/labels/")) {
            return (200, "[]".into());
        }
        (404, "{}".into())
    });
    let fake = FakeHttp::start([], Action::With(respond)).await;
    let (_test_db, _db, state, mock) = fixture_steps(vec![kind("thought")]).await;
    let address = spawn(state.with_work(WorkSettings {
        token: Some(Secret::new("test-token")),
        repo: "o/r".into(),
        api: fake.root_url(),
        proxy: None,
    }))
    .await;
    let mut owner = common::logged_in(address).await;
    let body = json!({
        "id": Uuid::now_v7(), "text": "ответить на #7: По первому варианту", "source": "pult"
    });
    let result = owner.post_json(address, ROUTE, body.clone()).await;
    assert_eq!(result.status, 200, "{}", result.body);
    assert_eq!(result.body["kind"], "order");
    assert_eq!(
        owner.post_json(address, ROUTE, body).await.body,
        result.body
    );
    let comments: Vec<_> = fake
        .received()
        .into_iter()
        .filter(|req| req.line.starts_with("POST /repos/o/r/issues/7/comments "))
        .collect();
    assert_eq!(comments.len(), 1);
    assert!(
        comments[0]
            .body
            .contains("Ответ владельца: По первому варианту")
    );
    assert_eq!(mock.calls(), 1);
}

#[tokio::test]
async fn recognized_voice_goes_to_dispatch_without_a_second_inbox_item() {
    let (_test_db, _db, state, mock) = fixture_steps(vec![kind("thought")]).await;
    let address = spawn(state).await;
    let mut owner = common::logged_in(address).await;
    let method = owner
        .send(
            address,
            reqwest::Method::PUT,
            "/api/v1/voice/prefs",
            Some(json!({"method": "device"})),
            true,
        )
        .await;
    assert_eq!(method.status, 200, "{}", method.body);
    let transcript = owner
        .post_json(
            address,
            "/api/command/voice",
            json!({
                "audio_base64": "dGVzdA==",
                "mime": "audio/webm",
                "duration_ms": 500,
                "text": "Записать мысль голосом"
            }),
        )
        .await;
    assert_eq!(transcript.status, 200, "{}", transcript.body);
    assert_eq!(transcript.body["text"], "Записать мысль голосом");
    assert_eq!(mock.calls(), 0);
    let reply = owner
        .post_json(
            address,
            ROUTE,
            json!({"source": "voice", "text": transcript.body["text"]}),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let inbox = owner.get(address, "/api/v1/inbox").await;
    assert_eq!(inbox.body.as_array().unwrap().len(), 1);
    assert_eq!(inbox.body[0]["body"], "Записать мысль голосом");
}
