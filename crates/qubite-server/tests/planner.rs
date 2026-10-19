//! Planner через настоящий HTTP-сервер (PLAN-001): проекты и дела по
//! синхронизации, Policy Gate по модулю `planner`, «есть новое» по WebSocket.

mod common;

use std::{net::SocketAddr, time::Duration};

use common::{Browser, logged_in};
use futures_util::StreamExt;
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::{self, Message, client::IntoClientRequest, http::HeaderValue};
use uuid::Uuid;

const USER_PASSWORD: &str = "пароль пользователя";

async fn user(db: &qubite_db::Database, address: SocketAddr, email: &str) -> (Uuid, Browser) {
    let account = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email,
            display_name: "",
            password: USER_PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut browser = Browser::default();
    let reply = browser.login(address, email, USER_PASSWORD).await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    (account.id, browser)
}

fn create(object_id: Uuid, object_type: &str, title: &str, fields: Value) -> Value {
    json!({
        "op_id": Uuid::now_v7(),
        "object_id": object_id,
        "kind": "create",
        "object_type": object_type,
        "title": title,
        "fields": fields,
    })
}

fn batch(ops: Vec<Value>) -> Value {
    json!({ "device_id": Uuid::now_v7(), "ops": ops })
}

async fn connect(
    address: SocketAddr,
    browser: &Browser,
) -> Result<
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>,
    tungstenite::Error,
> {
    let mut request = format!("ws://{address}/api/v1/sync/ws")
        .into_client_request()
        .unwrap();
    let session = browser.session.as_ref().unwrap();
    request.headers_mut().insert(
        "cookie",
        HeaderValue::from_str(&format!("qubite_session={session}")).unwrap(),
    );
    request.headers_mut().insert(
        "origin",
        HeaderValue::from_str(&format!("http://{address}")).unwrap(),
    );
    tokio_tungstenite::connect_async(request)
        .await
        .map(|(socket, _)| socket)
}

#[tokio::test]
async fn planner_sync_follows_grants() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;

    // Owner: проект и дело в нём одним пакетом; другое устройство их забирает.
    let project = Uuid::now_v7();
    let task = Uuid::now_v7();
    let reply = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            batch(vec![
                create(
                    project,
                    "planner.project",
                    "Алгебра",
                    json!({ "color": "sky" }),
                ),
                create(
                    task,
                    "planner.task",
                    "№ 214–220",
                    json!({ "project_id": project, "priority": "urgent",
                            "due_date": "2026-10-20", "due_time": "18:00",
                            "recurrence": { "freq": "weekly" } }),
                ),
            ]),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    for result in reply.body["results"].as_array().unwrap() {
        assert_eq!(result["status"], "applied", "{result}");
    }
    let pulled = owner.get(address, "/api/v1/sync/pull?cursor=0").await;
    let changes = pulled.body["changes"].as_array().unwrap();
    let saved = changes
        .iter()
        .find(|change| change["id"] == task.to_string())
        .unwrap();
    assert_eq!(saved["fields"]["project_id"], project.to_string());
    assert_eq!(saved["fields"]["priority"], "urgent");
    // 20.10.2026 — вторник: «каждую неделю» = по вторникам.
    assert_eq!(saved["fields"]["recurrence"]["weekdays"], json!([2]));

    // Новый человек без гранта: ни записать, ни прочитать, ни подписаться.
    let (account, mut student) = user(&db, address, "student@qubite.ru").await;
    let mine = Uuid::now_v7();
    let reply = student
        .post_json(
            address,
            "/api/v1/sync/push",
            batch(vec![create(mine, "planner.task", "моё", json!({}))]),
        )
        .await;
    assert_eq!(reply.body["results"][0]["reason"], "forbidden");
    let socket = connect(address, &student).await;
    assert!(matches!(socket, Err(tungstenite::Error::Http(ref r)) if r.status() == 403));

    // Грант на Planner — пишет, читает только своё, подсказки приходят.
    let reply = owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{account}/grants/planner"),
            json!({ "read": true, "write": true, "manage": false, "ai": false }),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let mut socket = connect(address, &student).await.unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), socket.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        Message::text(r#"{"type":"ready"}"#)
    );
    let reply = student
        .post_json(
            address,
            "/api/v1/sync/push",
            batch(vec![
                create(Uuid::now_v7(), "planner.task", "моё", json!({})),
                // Чужой проект для меня «не существует»: дело создаётся без него.
                create(
                    Uuid::now_v7(),
                    "planner.task",
                    "в чужой проект",
                    json!({ "project_id": project }),
                ),
            ]),
        )
        .await;
    for result in reply.body["results"].as_array().unwrap() {
        assert_eq!(result["status"], "applied", "{result}");
    }
    let pulled = student.get(address, "/api/v1/sync/pull?cursor=0").await;
    let changes = pulled.body["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 2, "только своё");
    assert!(
        changes
            .iter()
            .all(|change| change["fields"]["project_id"].is_null())
    );
    let _ = socket.close(None).await;
    db.close().await;
    test_db.drop_db().await;
}
