//! «Работа агентов» (HAR-002): раздел из GitHub Issues и ответ кнопкой —
//! с подставным GitHub. В интернет тест не ходит.

mod common;

use std::{net::SocketAddr, sync::Arc};

use common::{Browser, EMAIL, PASSWORD};
use qubite_auth::Passwords;
use qubite_db::Database;
use qubite_kernel::Secret;
use qubite_server::{AppState, auth::AuthSettings, harness::WorkSettings};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp, Received},
};
use serde_json::{Value, json};

fn label(name: &str) -> Value {
    json!({ "name": name })
}

fn issues() -> String {
    json!([
        { "number": 78, "title": "HAR-002 — раздел", "html_url": "https://github.com/o/r/issues/78",
          "body": "Скрин: ![пк](https://github.com/user-attachments/assets/pc.png)", "state": "open",
          "labels": [label("in_progress")], "updated_at": "2026-10-29T10:00:00Z", "comments": 0 },
        { "number": 81, "title": "Куда бэкап?", "html_url": "https://github.com/o/r/issues/81",
          "body": "Где хранить бэкап?\n\n- Внешний диск (рекомендую)\n- Облако", "state": "open",
          "labels": [label("вопрос")], "updated_at": "2026-10-29T09:00:00Z", "comments": 0 },
        { "number": 70, "title": "Готовая", "html_url": "https://github.com/o/r/issues/70",
          "body": null, "state": "open", "labels": [label("review")],
          "updated_at": "2026-10-28T09:00:00Z", "comments": 0 },
        { "number": 90, "title": "Вторая в очереди", "html_url": "https://github.com/o/r/issues/90",
          "body": "", "state": "open", "labels": [label("ready")],
          "updated_at": "2026-10-28T09:00:00Z", "comments": 0 },
        { "number": 85, "title": "Первая в очереди", "html_url": "https://github.com/o/r/issues/85",
          "body": "", "state": "open", "labels": [label("ready")],
          "updated_at": "2026-10-29T09:00:00Z", "comments": 0 },
        { "number": 60, "title": "Лимит агентов", "html_url": "https://github.com/o/r/issues/60",
          "body": "сюда пишет менеджер", "state": "open", "labels": [label("лимит")],
          "updated_at": "2026-10-29T08:00:00Z", "comments": 2 },
        { "number": 99, "title": "PR", "html_url": "https://github.com/o/r/pull/99",
          "body": "Часть #78", "state": "open", "labels": [], "pull_request": {},
          "updated_at": "2026-10-29T10:00:00Z", "comments": 0 }
    ])
    .to_string()
}

async fn github() -> FakeHttp {
    let respond = Arc::new(|req: &Received| -> (u16, String) {
        let line = &req.line;
        if req.header("authorization") != Some("Bearer test-token") {
            return (401, "{}".into());
        }
        if line.starts_with("GET /repos/o/r/issues?state=open") {
            (200, issues())
        } else if line.starts_with("GET /repos/o/r/issues/60/comments") {
            (
                200,
                json!([
                    { "body": "старое", "html_url": "https://github.com/o/r/issues/60#c1",
                      "updated_at": "2026-10-29T07:00:00Z" },
                    { "body": "Лимит: окно 35%, неделя 62%", "html_url": "https://github.com/o/r/issues/60#c2",
                      "updated_at": "2026-10-29T08:00:00Z" }
                ])
                .to_string(),
            )
        } else if line.starts_with("GET /repos/o/r/issues/81 ") {
            (
                200,
                json!({ "number": 81, "title": "Куда бэкап?", "html_url": "https://github.com/o/r/issues/81",
                        "body": "", "state": "open", "labels": [label("вопрос")],
                        "updated_at": "2026-10-29T09:00:00Z" })
                .to_string(),
            )
        } else if line.starts_with("GET /repos/o/r/issues/70 ") {
            (
                200,
                json!({ "number": 70, "title": "Готовая", "html_url": "https://github.com/o/r/issues/70",
                        "state": "open", "labels": [label("review")], "updated_at": "2026-10-29T09:00:00Z" })
                .to_string(),
            )
        } else if line.starts_with("POST /repos/o/r/issues/81/comments") {
            (
                201,
                json!({ "html_url": "https://github.com/o/r/issues/81#c9" }).to_string(),
            )
        } else if line
            .starts_with("DELETE /repos/o/r/issues/81/labels/%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81")
        {
            (200, "[]".into())
        } else {
            (404, "{}".into())
        }
    });
    FakeHttp::start([], Action::With(respond)).await
}

async fn spawn(db: Database, settings: WorkSettings) -> SocketAddr {
    let state = AppState::with_auth(db, AuthSettings::default()).with_work(settings);
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    address
}

async fn setup(settings: WorkSettings) -> (TestDb, SocketAddr) {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let address = spawn(db, settings).await;
    (test_db, address)
}

fn settings(fake: &FakeHttp) -> WorkSettings {
    WorkSettings {
        token: Some(Secret::new("test-token")),
        repo: "o/r".into(),
        api: fake.root_url(),
        proxy: None,
    }
}

fn numbers(list: &Value) -> Vec<u64> {
    list.as_array()
        .unwrap()
        .iter()
        .map(|i| i["number"].as_u64().unwrap())
        .collect()
}

#[tokio::test]
async fn board_from_issues_cached_and_answer_becomes_comment() {
    let fake = github().await;
    let (test_db, address) = setup(settings(&fake)).await;

    // Гостю раздела нет.
    let guest = Browser::default().get(address, "/api/owner/work").await;
    assert_eq!(guest.status, 404);

    let mut owner = common::logged_in_unconfirmed(address).await;
    let board = owner.get(address, "/api/owner/work").await;
    assert_eq!(board.status, 200, "{:?}", board.body);
    let b = &board.body;
    assert_eq!(b["configured"], true);
    assert_eq!(numbers(&b["running"]), [78]);
    assert_eq!(numbers(&b["review"]), [70]);
    assert_eq!(numbers(&b["queue"]), [85, 90], "очередь — по номеру");
    assert_eq!(numbers(&b["questions"]), [81]);
    assert_eq!(b["questions"][0]["text"], "Где хранить бэкап?");
    assert_eq!(
        b["questions"][0]["options"],
        json!(["Внешний диск (рекомендую)", "Облако"])
    );
    let links: Vec<&str> = b["running"][0]["links"]
        .as_array()
        .unwrap()
        .iter()
        .map(|l| l["label"].as_str().unwrap())
        .collect();
    assert_eq!(links, ["PR #99", "скриншот"]);
    assert_eq!(b["usage"]["window_percent"], 35);
    assert_eq!(b["usage"]["week_percent"], 62);
    assert_eq!(b["usage"]["url"], "https://github.com/o/r/issues/60#c2");
    // Токен в ответ браузеру не попадает.
    assert!(!board.body.to_string().contains("test-token"));

    // Второй раз — из кэша: GitHub не спрашивается.
    let before = fake.received().len();
    assert_eq!(owner.get(address, "/api/owner/work").await.status, 200);
    assert_eq!(fake.received().len(), before);

    // Пустой ответ — нельзя; не-вопрос — нельзя.
    let empty = owner
        .post_json(
            address,
            "/api/owner/work/questions/81/answer",
            json!({ "answer": "  " }),
        )
        .await;
    assert_eq!(empty.status, 400);
    let not_question = owner
        .post_json(
            address,
            "/api/owner/work/questions/70/answer",
            json!({ "answer": "да" }),
        )
        .await;
    assert_eq!(not_question.status, 409, "{:?}", not_question.body);

    let answered = owner
        .post_json(
            address,
            "/api/owner/work/questions/81/answer",
            json!({ "answer": "Внешний диск (рекомендую)" }),
        )
        .await;
    assert_eq!(answered.status, 200, "{:?}", answered.body);
    assert_eq!(answered.body["url"], "https://github.com/o/r/issues/81#c9");
    let sent = fake.received();
    let comment = sent
        .iter()
        .find(|r| r.line.starts_with("POST /repos/o/r/issues/81/comments"))
        .expect("комментарий отправлен");
    let body: Value = serde_json::from_str(&comment.body).unwrap();
    assert!(
        body["body"]
            .as_str()
            .unwrap()
            .starts_with("Ответ владельца: Внешний диск (рекомендую)")
    );
    assert!(
        sent.iter()
            .any(|r| r.line.starts_with("DELETE /repos/o/r/issues/81/labels/"))
    );

    // Ответ — в журнале Console.
    let log = owner.get(address, "/api/owner/audit").await;
    assert!(
        log.body.to_string().contains("work.question_answered"),
        "{:?}",
        log.body
    );

    test_db.drop_db().await;
}

#[tokio::test]
async fn without_token_section_says_not_configured() {
    let (test_db, address) = setup(WorkSettings {
        repo: "o/r".into(),
        ..WorkSettings::default()
    })
    .await;
    let mut owner = common::logged_in_unconfirmed(address).await;
    let board = owner.get(address, "/api/owner/work").await;
    assert_eq!(board.status, 200, "{:?}", board.body);
    assert_eq!(board.body["configured"], false);
    assert_eq!(board.body["running"], json!([]));
    let answer = owner
        .post_json(
            address,
            "/api/owner/work/questions/1/answer",
            json!({ "answer": "да" }),
        )
        .await;
    assert_eq!(answer.status, 409);
    assert_eq!(answer.body["error"], "github_not_configured");
    test_db.drop_db().await;
}

#[tokio::test]
async fn github_down_is_an_honest_error() {
    let fake = FakeHttp::start([], Action::Respond(401, "{}".into())).await;
    let (test_db, address) = setup(settings(&fake)).await;
    let mut owner = common::logged_in_unconfirmed(address).await;
    let board = owner.get(address, "/api/owner/work").await;
    assert_eq!(board.status, 502, "{:?}", board.body);
    assert_eq!(board.body["error"], "github_unavailable");
    assert!(board.body["message"].as_str().unwrap().contains("401"));
    test_db.drop_db().await;
}
