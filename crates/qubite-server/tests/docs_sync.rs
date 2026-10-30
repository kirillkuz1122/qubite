//! DOC-002a: протокол документов через HTTP и обычную синхронизацию.
mod common;

use std::{net::SocketAddr, time::Duration};

use base64::{Engine, engine::general_purpose::STANDARD};
use common::{Browser, Reply, logged_in};
use futures_util::StreamExt;
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest, http::HeaderValue};
use uuid::Uuid;
use yrs::{Doc, ReadTxn, StateVector, Text, Transact};

fn update(text: &str, client: u64) -> String {
    let doc = Doc::with_client_id(client);
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, text);
    STANDARD.encode(
        doc.transact()
            .encode_state_as_update_v1(&StateVector::default()),
    )
}

async fn push(browser: &mut Browser, address: SocketAddr, ops: Vec<Value>) -> Value {
    let reply = browser
        .post_json(
            address,
            "/api/v1/sync/push",
            json!({"device_id": Uuid::now_v7(), "ops": ops}),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    reply.body
}

async fn create(browser: &mut Browser, address: SocketAddr, fields: Option<Value>) -> Uuid {
    let id = Uuid::now_v7();
    let mut op = json!({"op_id": Uuid::now_v7(), "object_id": id, "kind": "create",
        "object_type": "docs.page", "title": "Документ"});
    if let Some(fields) = fields {
        op["fields"] = fields;
    }
    let result = push(browser, address, vec![op]).await;
    assert_eq!(result["results"][0]["status"], "applied", "{result}");
    id
}

async fn count_events(db: &qubite_db::Database, id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM events WHERE object_id = $1")
        .bind(id)
        .fetch_one(db.pool())
        .await
        .unwrap()
}

async fn post(browser: &mut Browser, address: SocketAddr, id: Uuid, packet: Value) -> Reply {
    browser
        .post_json(address, &format!("/api/v1/docs/{id}/y"), packet)
        .await
}

async fn exchange(browser: &mut Browser, address: SocketAddr, id: Uuid) -> Value {
    let reply = browser.get(address, &format!("/api/v1/docs/{id}/y")).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    reply.body
}

async fn edit(
    browser: &mut Browser,
    address: SocketAddr,
    id: Uuid,
    title: &str,
    body: &str,
    revision: &Value,
) -> Reply {
    browser
        .put_json(
            address,
            &format!("/api/v1/docs/{id}"),
            json!({"title": title, "body": body, "revision": revision}),
        )
        .await
}

async fn query(browser: &Browser, address: SocketAddr, path: &str, key: &str, q: &str) -> Value {
    let response = qubite_testkit::http_client()
        .get(format!("http://{address}{path}"))
        .query(&[(key, q)])
        .header(
            "cookie",
            format!("qubite_session={}", browser.session.as_deref().unwrap()),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    response.json().await.unwrap()
}

async fn user(db: &qubite_db::Database, address: SocketAddr) -> (Uuid, Browser) {
    let account = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "docs-user@qubite.ru",
            display_name: "",
            password: common::PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut browser = Browser::default();
    let login = browser
        .login(address, "docs-user@qubite.ru", common::PASSWORD)
        .await;
    assert_eq!(login.status, 200);
    (account.id, browser)
}

#[tokio::test]
async fn offline_create_exchange_retry_search_and_legacy_edit() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    // Операция создана устройством без сети: нет полей и нет проекта.
    let invalid_id = Uuid::now_v7();
    let invalid = push(
        &mut owner,
        address,
        vec![
            json!({"op_id": Uuid::now_v7(), "object_id": invalid_id, "kind": "create",
            "object_type": "docs.page", "title": "Не создать", "fields": {"body": "нельзя"}}),
        ],
    )
    .await;
    assert_eq!(invalid["results"][0]["reason"], "invalid");
    let absent: bool =
        sqlx::query_scalar("SELECT NOT EXISTS (SELECT 1 FROM objects WHERE id = $1)")
            .bind(invalid_id)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert!(absent, "отклонённый create не оставляет объект без полей");
    let id = create(&mut owner, address, None).await;
    let first = exchange(&mut owner, address, id).await;
    assert_eq!(first["seed_markdown"], "");
    let legacy = edit(
        &mut owner,
        address,
        id,
        "Конспект",
        "# Старый документ",
        &json!(1),
    )
    .await;
    assert_eq!(legacy.status, 200, "{}", legacy.body);
    let before_seed = exchange(&mut owner, address, id).await;
    assert_eq!(before_seed["seed_markdown"], "# Старый документ");
    let packet =
        json!({"update": update("Старый документ", 1), "text": "Старый документ", "seed": true});
    let seeded = post(&mut owner, address, id, packet.clone()).await;
    assert_eq!(seeded.status, 200, "{}", seeded.body);
    let seeded_again = post(&mut owner, address, id, packet.clone()).await;
    assert_eq!(seeded_again.status, 409);
    assert_eq!(seeded_again.body["error"], "seed_taken");
    let events = count_events(&db, id).await;
    // Повторный пакет не меняет даже пришедший с ним старый text.
    let retry = post(
        &mut owner,
        address,
        id,
        json!({"update": packet["update"], "text": "устаревший текст"}),
    )
    .await;
    assert_eq!(retry.status, 200);
    assert_eq!(retry.body["sv"], seeded.body["sv"]);
    assert_eq!(count_events(&db, id).await, events);
    let body = owner.get(address, &format!("/api/v1/docs/{id}")).await;
    assert_eq!(body.body["body"], "Старый документ");
    let all = exchange(&mut owner, address, id).await;
    assert!(all["seed_markdown"].is_null());
    let no_missing = query(
        &owner,
        address,
        &format!("/api/v1/docs/{id}/y"),
        "sv",
        seeded.body["sv"].as_str().unwrap(),
    )
    .await;
    assert_eq!(
        STANDARD
            .decode(no_missing["update"].as_str().unwrap())
            .unwrap(),
        vec![0, 0]
    );
    let pull = owner.get(address, "/api/v1/sync/pull?cursor=0").await;
    let snapshot = pull.body["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == id.to_string())
        .unwrap();
    assert_eq!(
        snapshot["fields"],
        json!({"preview": "Старый документ", "has_ystate": true})
    );
    for fields in [json!({}), json!({"body": "потерять"})] {
        let patch = push(
            &mut owner,
            address,
            vec![json!({"op_id": Uuid::now_v7(), "object_id": id,
                "kind": "patch", "base_revision": body.body["revision"], "fields": fields})],
        )
        .await;
        assert_eq!(patch["results"][0]["reason"], "invalid");
    }
    let old_editor = edit(
        &mut owner,
        address,
        id,
        "Конспект",
        "потерять",
        &body.body["revision"],
    )
    .await;
    assert_eq!(old_editor.status, 409);
    assert_eq!(old_editor.body["error"], "use_editor");
    let rename = edit(
        &mut owner,
        address,
        id,
        "Алгебра",
        "Старый документ",
        &body.body["revision"],
    )
    .await;
    assert_eq!(rename.status, 200, "{}", rename.body);
    let search = query(&owner, address, "/api/v1/docs", "q", "документы").await;
    assert_eq!(search["docs"][0]["id"], id.to_string());
    let by_title = query(&owner, address, "/api/v1/docs", "q", "алгебра").await;
    assert_eq!(by_title["docs"][0]["id"], id.to_string());
    let id2 = create(&mut owner, address, Some(json!({}))).await;
    let saved = post(
        &mut owner,
        address,
        id2,
        json!({"update": update("Новый", 2), "text": "Новый"}),
    )
    .await;
    assert_eq!(saved.status, 200, "без seed при NULL: {}", saved.body);
    // Заголовок весит больше совпадения в тексте.
    let ranked = query(&owner, address, "/api/v1/docs", "q", "документ").await;
    assert_eq!(ranked["docs"][0]["id"], id2.to_string());
    assert_eq!(ranked["docs"][1]["id"], id.to_string());
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn seed_race_and_invalid_updates_leave_state_unchanged() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let id = create(&mut owner, address, None).await;
    let packet1 = json!({"update": update("А", 1), "text": "А", "seed": true});
    let packet2 = json!({"update": update("Б", 2), "text": "Б", "seed": true});
    let mut second = owner.clone();
    let (a, b) = tokio::join!(
        post(&mut owner, address, id, packet1),
        post(&mut second, address, id, packet2)
    );
    assert!((a.status == 200 && b.status == 409) || (a.status == 409 && b.status == 200));
    let loser = if a.status == 409 { &a } else { &b };
    assert_eq!(loser.body["error"], "seed_taken");
    assert_eq!(count_events(&db, id).await, 2, "создание + один seed");
    let before = exchange(&mut owner, address, id).await;
    let events = count_events(&db, id).await;
    for (update, text, code) in [
        ("%%%".into(), "".into(), "invalid_update"),
        (STANDARD.encode([255]), "".into(), "invalid_update"),
        (STANDARD.encode([0, 0, 1]), "".into(), "invalid_update"),
        (
            STANDARD.encode(vec![0; 512 * 1024 + 1]),
            "".into(),
            "update_too_large",
        ),
        (
            STANDARD.encode([0, 0]),
            "я".repeat(200_001),
            "text_too_large",
        ),
    ] {
        let reply = post(
            &mut owner,
            address,
            id,
            json!({"update": update, "text": text}),
        )
        .await;
        assert_eq!(reply.status, 400, "{}", reply.body);
        assert_eq!(reply.body["error"], code, "{}", reply.body);
    }
    assert_eq!(exchange(&mut owner, address, id).await, before);
    assert_eq!(count_events(&db, id).await, events);
    let invalid_sv = owner
        .get(address, &format!("/api/v1/docs/{id}/y?sv=/w=="))
        .await;
    assert_eq!(invalid_sv.status, 400);
    let large = create(&mut owner, address, None).await;
    let doc = Doc::with_client_id(5);
    let text = doc.get_or_insert_text("text");
    for _ in 0..10 {
        let sv = doc.transact().state_vector();
        text.insert(&mut doc.transact_mut(), 0, &"a".repeat(400_000));
        let packet = json!({
            "update": STANDARD.encode(doc.transact().encode_state_as_update_v1(&sv)), "text": ""});
        let reply = post(&mut owner, address, large, packet).await;
        assert_eq!(reply.status, 200, "{}", reply.body);
    }
    let events = count_events(&db, large).await;
    let before = exchange(&mut owner, address, large).await;
    let sv = doc.transact().state_vector();
    text.insert(&mut doc.transact_mut(), 0, &"a".repeat(400_000));
    let packet = json!({
        "update": STANDARD.encode(doc.transact().encode_state_as_update_v1(&sv)), "text": ""});
    let reply = post(&mut owner, address, large, packet).await;
    assert_eq!(reply.status, 400);
    assert_eq!(reply.body["error"], "doc_too_large");
    assert_eq!(exchange(&mut owner, address, large).await, before);
    assert_eq!(count_events(&db, large).await, events);
    // Длина plain text измеряется в символах, а не байтах UTF-8.
    let boundary = create(&mut owner, address, None).await;
    let packet = json!({"update": update("я", 6), "text": "я".repeat(200_000)});
    assert_eq!(
        post(&mut owner, address, boundary, packet).await.status,
        200
    );
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn docs_grants_and_foreign_documents_are_enforced() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let id = create(&mut owner, address, None).await;
    let path = format!("/api/v1/docs/{id}/y");
    let (account, mut user) = user(&db, address).await;
    let packet = json!({"update": update("Чужое", 4), "text": "Чужое"});
    assert_eq!(user.get(address, &path).await.status, 403);
    let denied = post(&mut user, address, id, packet.clone()).await;
    assert_eq!(denied.status, 403);
    let denied = push(
        &mut user,
        address,
        vec![json!({"op_id": Uuid::now_v7(), "object_id": Uuid::now_v7(),
            "kind": "create", "object_type": "docs.page", "title": "Нет прав"})],
    )
    .await;
    assert_eq!(denied["results"][0]["reason"], "forbidden");
    let grant_path = format!("/api/owner/accounts/{account}/grants/docs");
    let grant = owner
        .put_json(
            address,
            &grant_path,
            json!({"read": true, "write": true, "manage": false, "ai": false}),
        )
        .await;
    assert_eq!(grant.status, 200);
    assert_eq!(user.get(address, &path).await.status, 404);
    assert_eq!(post(&mut user, address, id, packet).await.status, 404);
    let own = create(&mut user, address, None).await;
    exchange(&mut user, address, own).await;
    let list = query(&user, address, "/api/v1/docs", "q", "документы").await;
    assert_eq!(list["docs"].as_array().unwrap().len(), 1);
    assert_eq!(list["docs"][0]["id"], own.to_string());
    let grant = owner
        .put_json(
            address,
            &grant_path,
            json!({"read": true, "write": false, "manage": false, "ai": false}),
        )
        .await;
    assert_eq!(grant.status, 200);
    exchange(&mut user, address, own).await;
    let packet = json!({"update": update("x", 7), "text": "x"});
    assert_eq!(post(&mut user, address, own, packet).await.status, 403);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn docs_only_websocket_is_notified_for_new_state_but_not_retry() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let (account, mut user) = user(&db, address).await;
    let granted = owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{account}/grants/docs"),
            json!({"read": true, "write": true, "manage": false, "ai": false}),
        )
        .await;
    assert_eq!(granted.status, 200);
    let id = create(&mut user, address, None).await;
    let mut request = format!("ws://{address}/api/v1/sync/ws")
        .into_client_request()
        .unwrap();
    request.headers_mut().insert(
        "cookie",
        HeaderValue::from_str(&format!(
            "qubite_session={}",
            user.session.as_deref().unwrap()
        ))
        .unwrap(),
    );
    request.headers_mut().insert(
        "origin",
        HeaderValue::from_str(&format!("http://{address}")).unwrap(),
    );
    let (mut socket, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let ready = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(ready, Message::text(r#"{"type":"ready"}"#));
    // Первое подключение слушателя сообщает «проверь всё».
    while let Ok(Some(Ok(_))) =
        tokio::time::timeout(Duration::from_millis(300), socket.next()).await
    {}
    let packet = json!({"update": update("Новый текст", 10), "text": "Новый текст"});
    assert_eq!(
        post(&mut user, address, id, packet.clone()).await.status,
        200
    );
    let changed = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert_eq!(changed, Message::text(r#"{"type":"changed"}"#));
    let events = count_events(&db, id).await;
    assert_eq!(post(&mut user, address, id, packet).await.status, 200);
    assert_eq!(count_events(&db, id).await, events);
    assert!(
        tokio::time::timeout(Duration::from_millis(300), socket.next())
            .await
            .is_err()
    );
    drop(socket);
    db.close().await;
    test_db.drop_db().await;
}
