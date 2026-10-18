//! Входящие и синхронизация через настоящий HTTP-сервер (CMD-001):
//! вход, CSRF, Policy Gate, офлайн-пакет без дублей, WebSocket «есть новое».

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

fn capture_op(object_id: Uuid, text: &str) -> Value {
    json!({
        "op_id": Uuid::now_v7(),
        "object_id": object_id,
        "kind": "create",
        "object_type": "inbox.item",
        "title": text,
        "fields": { "body": text, "source": "web", "captured_at_ms": 1_792_224_000_000_i64 }
    })
}

#[tokio::test]
async fn offline_batch_arrives_once_even_if_the_reply_is_lost() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let device = Uuid::now_v7();
    // Три мысли записаны без сети; сеть появилась — уходит пакет.
    let ids: Vec<Uuid> = (0..3).map(|_| Uuid::now_v7()).collect();
    let batch = json!({
        "device_id": device,
        "ops": ids.iter().enumerate().map(|(n, id)| capture_op(*id, &format!("мысль {n}"))).collect::<Vec<_>>(),
    });
    let first = owner
        .post_json(address, "/api/v1/sync/push", batch.clone())
        .await;
    assert_eq!(first.status, 200, "{:?}", first.body);
    for result in first.body["results"].as_array().unwrap() {
        assert_eq!(result["status"], "applied", "{result}");
    }
    // Ответ «потерялся» — устройство шлёт тот же пакет ещё раз.
    let again = owner.post_json(address, "/api/v1/sync/push", batch).await;
    assert_eq!(again.body, first.body, "повтор — тот же ответ");

    let list = owner.get(address, "/api/v1/inbox").await;
    assert_eq!(list.status, 200, "{:?}", list.body);
    assert_eq!(list.body.as_array().unwrap().len(), 3, "без дублей");
    assert_eq!(list.body[0]["source"], "web");

    // Другое устройство забирает всё вместе с полями.
    let pulled = owner.get(address, "/api/v1/sync/pull?cursor=0").await;
    assert_eq!(pulled.status, 200, "{:?}", pulled.body);
    let changes = pulled.body["changes"].as_array().unwrap();
    assert_eq!(changes.len(), 3);
    assert_eq!(changes[0]["fields"]["status"], "new");
    let cursor = pulled.body["cursor"].as_i64().unwrap();
    let nothing = owner
        .get(address, &format!("/api/v1/sync/pull?cursor={cursor}"))
        .await;
    assert!(nothing.body["changes"].as_array().unwrap().is_empty());

    // Пакет без CSRF не принимается, без входа — 401.
    let no_csrf = owner
        .send(
            address,
            reqwest::Method::POST,
            "/api/v1/sync/push",
            Some(json!({ "device_id": device, "ops": [capture_op(Uuid::now_v7(), "x")] })),
            false,
        )
        .await;
    assert_eq!(no_csrf.status, 403);
    let anonymous = Browser::default()
        .get(address, "/api/v1/sync/pull?cursor=0")
        .await;
    assert_eq!(anonymous.status, 401);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn sync_and_inbox_follow_grants() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let (account, mut student) = user(&db, address, "student@qubite.ru").await;

    // Нового пользователя во Входящие не пускают (D-172): ни API, ни синхронизация.
    let reply = student.get(address, "/api/v1/inbox").await;
    assert_eq!(reply.status, 403, "{:?}", reply.body);
    let id = Uuid::now_v7();
    let push = json!({ "device_id": Uuid::now_v7(), "ops": [capture_op(id, "моя мысль")] });
    let reply = student
        .post_json(address, "/api/v1/sync/push", push.clone())
        .await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["results"][0]["status"], "rejected");
    assert_eq!(reply.body["results"][0]["reason"], "forbidden");

    // Владелец выдал «только чтение» — читать можно, писать нельзя.
    let grants = format!("/api/owner/accounts/{account}/grants/inbox");
    let reply = owner
        .put_json(
            address,
            &grants,
            json!({ "read": true, "write": false, "manage": false, "ai": false }),
        )
        .await;
    assert_eq!(reply.status, 200);
    assert_eq!(student.get(address, "/api/v1/inbox").await.status, 200);
    let reply = student
        .post_json(address, "/api/v1/inbox", json!({ "text": "мысль" }))
        .await;
    assert_eq!(reply.status, 403, "{:?}", reply.body);

    // С правом записи — получается; чужие элементы не видны и «не существуют».
    let reply = owner
        .put_json(
            address,
            &grants,
            json!({ "read": true, "write": true, "manage": false, "ai": false }),
        )
        .await;
    assert_eq!(reply.status, 200);
    // Тот же op_id вернёт прежний отказ (операция уже решена) — устройство
    // отправляет мысль заново новой операцией.
    let again = student.post_json(address, "/api/v1/sync/push", push).await;
    assert_eq!(again.body["results"][0]["reason"], "forbidden");
    let push = json!({ "device_id": Uuid::now_v7(), "ops": [capture_op(id, "моя мысль")] });
    let reply = student.post_json(address, "/api/v1/sync/push", push).await;
    assert_eq!(
        reply.body["results"][0]["status"], "applied",
        "{:?}",
        reply.body
    );
    let mine = owner
        .post_json(address, "/api/v1/inbox", json!({ "text": "мысль owner" }))
        .await;
    assert_eq!(mine.status, 201, "{:?}", mine.body);
    let owner_item = mine.body["id"].as_str().unwrap().to_owned();
    let reply = student
        .get(address, &format!("/api/v1/inbox/{owner_item}"))
        .await;
    assert_eq!(reply.status, 404);
    let reply = student
        .patch_json(
            address,
            &format!("/api/v1/inbox/{owner_item}"),
            json!({ "revision": 1, "status": "archived" }),
        )
        .await;
    assert_eq!(reply.status, 404);
    let pulled = student.get(address, "/api/v1/sync/pull?cursor=0").await;
    let ids: Vec<&str> = pulled.body["changes"]
        .as_array()
        .unwrap()
        .iter()
        .map(|change| change["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, [id.to_string()], "только своё");

    // Отзыв гранта действует сразу.
    let reply = owner
        .delete(
            address,
            &format!("/api/owner/accounts/{account}/grants/inbox"),
        )
        .await;
    assert_eq!(reply.status, 204);
    let pulled = student.get(address, "/api/v1/sync/pull?cursor=0").await;
    assert!(pulled.body["changes"].as_array().unwrap().is_empty());
    assert_eq!(student.get(address, "/api/v1/inbox").await.status, 403);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn inbox_api_capture_archive_trash_and_undo() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;

    let id = Uuid::now_v7();
    let body = json!({
        "id": id,
        "text": "Посмотреть лекцию про графы\nссылка ниже",
        "url": "https://example.ru/lecture",
    });
    let created = owner
        .post_json(address, "/api/v1/inbox", body.clone())
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    assert_eq!(created.body["title"], "Посмотреть лекцию про графы");
    assert_eq!(created.body["kind"], "link");
    assert_eq!(created.body["triage"]["status"], "pending");
    // Повтор с тем же ID (кнопку нажали дважды) — тот же элемент.
    let again = owner.post_json(address, "/api/v1/inbox", body).await;
    assert_eq!(again.status, 200);
    assert_eq!(again.body["id"], created.body["id"]);

    for bad in [
        json!({ "text": "   " }),
        json!({ "text": "x", "url": "ftp://old" }),
        json!({ "text": "x", "source": "telegram" }),
        json!({ "text": "x", "tags": ["учёба"] }),
    ] {
        let reply = owner.post_json(address, "/api/v1/inbox", bad.clone()).await;
        assert!(
            matches!(reply.status.as_u16(), 400 | 422),
            "{bad}: {} {:?}",
            reply.status,
            reply.body
        );
    }

    // Разобрано → в архив; старая версия → 409.
    let path = format!("/api/v1/inbox/{id}");
    let archived = owner
        .patch_json(
            address,
            &path,
            json!({ "revision": 1, "status": "archived" }),
        )
        .await;
    assert_eq!(archived.status, 200, "{:?}", archived.body);
    assert_eq!(archived.body["status"], "archived");
    let stale = owner
        .patch_json(address, &path, json!({ "revision": 1, "body": "другое" }))
        .await;
    assert_eq!(stale.status, 409);
    assert_eq!(
        owner
            .get(address, "/api/v1/inbox?view=archived")
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        1
    );

    // В корзину и обратно (отмена удаления).
    let removed = owner
        .send(
            address,
            reqwest::Method::DELETE,
            &format!("{path}?revision=2"),
            None,
            true,
        )
        .await;
    assert_eq!(removed.status, 200, "{:?}", removed.body);
    assert_eq!(removed.body["deleted"], true);
    assert_eq!(
        owner
            .get(address, "/api/v1/inbox?view=trash")
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        1
    );
    let restored = owner
        .post_json(
            address,
            &format!("{path}/restore"),
            json!({ "revision": 3 }),
        )
        .await;
    assert_eq!(restored.status, 200, "{:?}", restored.body);
    assert_eq!(restored.body["deleted"], false);
    let detail = owner.get(address, &path).await;
    assert_eq!(detail.status, 200);
    assert_eq!(detail.body["item"]["revision"], 4);
    assert!(detail.body["links"].as_array().unwrap().is_empty());
    db.close().await;
    test_db.drop_db().await;
}

// ---------------------------------------------------------------- WebSocket

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(
    address: SocketAddr,
    browser: &Browser,
    origin: Option<&str>,
) -> Result<Socket, tungstenite::Error> {
    let mut request = format!("ws://{address}/api/v1/sync/ws")
        .into_client_request()
        .unwrap();
    if let Some(session) = &browser.session {
        request.headers_mut().insert(
            "cookie",
            HeaderValue::from_str(&format!("qubite_session={session}")).unwrap(),
        );
    }
    if let Some(origin) = origin {
        request
            .headers_mut()
            .insert("origin", HeaderValue::from_str(origin).unwrap());
    }
    tokio_tungstenite::connect_async(request)
        .await
        .map(|(socket, _)| socket)
}

/// Следующее текстовое сообщение (или закрытие) за 5 секунд.
async fn next(socket: &mut Socket) -> Option<Message> {
    loop {
        match tokio::time::timeout(Duration::from_secs(5), socket.next()).await {
            Ok(Some(Ok(Message::Ping(_) | Message::Pong(_)))) => continue,
            Ok(Some(Ok(message))) => return Some(message),
            Ok(_) => return None,
            Err(_) => panic!("сообщение не пришло за 5 секунд"),
        }
    }
}

/// Пропустить подсказки, пришедшие при подключении.
async fn drain(socket: &mut Socket) {
    while let Ok(Some(Ok(_))) =
        tokio::time::timeout(Duration::from_millis(300), socket.next()).await
    {}
}

#[tokio::test]
async fn websocket_says_something_changed_only_to_its_account() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let origin = format!("http://{address}");

    // Без входа и с чужого сайта — не подключиться.
    let anonymous = connect(address, &Browser::default(), Some(&origin)).await;
    assert!(matches!(anonymous, Err(tungstenite::Error::Http(ref r)) if r.status() == 401));
    let evil = connect(address, &owner, Some("https://evil.example")).await;
    assert!(matches!(evil, Err(tungstenite::Error::Http(ref r)) if r.status() == 403));
    let no_origin = connect(address, &owner, None).await;
    assert!(matches!(no_origin, Err(tungstenite::Error::Http(ref r)) if r.status() == 403));

    let mut socket = connect(address, &owner, Some(&origin)).await.unwrap();
    assert_eq!(
        next(&mut socket).await,
        Some(Message::text(r#"{"type":"ready"}"#))
    );
    drain(&mut socket).await;

    // Мысль пришла с другого устройства — этот сокет узнаёт о ней.
    let reply = owner
        .post_json(address, "/api/v1/inbox", json!({ "text": "с телефона" }))
        .await;
    assert_eq!(reply.status, 201);
    assert_eq!(
        next(&mut socket).await,
        Some(Message::text(r#"{"type":"changed"}"#))
    );
    drain(&mut socket).await;

    // Изменение другого человека этому сокету не сообщается.
    let (account, mut student) = user(&db, address, "student@qubite.ru").await;
    owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{account}/grants/inbox"),
            json!({ "read": true, "write": true, "manage": false, "ai": false }),
        )
        .await;
    let reply = student
        .post_json(address, "/api/v1/inbox", json!({ "text": "чужая мысль" }))
        .await;
    assert_eq!(reply.status, 201);
    let quiet = tokio::time::timeout(Duration::from_millis(700), socket.next()).await;
    assert!(quiet.is_err(), "чужое изменение пришло: {quiet:?}");

    // «Выйти везде» — при следующем сообщении соединение закрывается (recheck).
    let mut student_socket = connect(address, &student, Some(&origin)).await.unwrap();
    assert_eq!(
        next(&mut student_socket).await,
        Some(Message::text(r#"{"type":"ready"}"#))
    );
    drain(&mut student_socket).await;
    assert_eq!(
        student
            .post(address, "/api/auth/logout-everywhere")
            .await
            .status,
        200
    );
    let reply = owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{account}/grants/inbox"),
            json!({ "read": true, "write": false, "manage": false, "ai": false }),
        )
        .await;
    assert_eq!(reply.status, 200);
    // Сессию уже не найти, поэтому шлём изменение от имени аккаунта напрямую.
    let mut conn = db.pool().acquire().await.unwrap();
    qubite_objects::objects::create(
        &mut conn,
        qubite_objects::NewObject::new("planner.task", account, "фон"),
    )
    .await
    .unwrap();
    match next(&mut student_socket).await {
        Some(Message::Close(Some(frame))) => assert_eq!(u16::from(frame.code), 4403),
        other => panic!("ждали закрытие: {other:?}"),
    }
    let _ = socket.close(None).await;
    drop(conn);
    db.close().await;
    test_db.drop_db().await;
}
