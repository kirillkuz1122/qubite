//! Техработы (ACC-005): включение из API, «вернёмся к …», обрыв WebSocket и
//! фоновых задач не-owner, одноразовый пропуск owner.

mod common;

use std::{net::SocketAddr, time::Duration};

use common::{Browser, EMAIL, logged_in, setup};
use futures_util::StreamExt;
use qubite_auth::{
    Passwords,
    accounts::NewAccount,
    maintenance::{self, PassClaims, Switch},
};
use qubite_policy::{DenyReason, ModuleId, Read, Subject};
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest, http::HeaderValue};
use uuid::Uuid;

const USER: &str = "student@qubite.ru";
const USER_PASSWORD: &str = "пароль ученика";

async fn student(
    db: &qubite_db::Database,
    address: SocketAddr,
    owner: &mut Browser,
) -> (Uuid, Browser) {
    let account = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: USER,
            display_name: "",
            password: USER_PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let reply = owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{}/grants/inbox", account.id),
            json!({ "read": true, "write": true, "manage": false, "ai": false }),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let mut browser = Browser::default();
    assert_eq!(
        browser.login(address, USER, USER_PASSWORD).await.status,
        200
    );
    (account.id, browser)
}

async fn status(address: SocketAddr) -> Value {
    Browser::default()
        .get(address, "/api/platform/status")
        .await
        .body
}

type Socket =
    tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>>;

async fn connect(address: SocketAddr, browser: &Browser) -> Result<Socket, String> {
    let mut request = format!("ws://{address}/api/v1/sync/ws")
        .into_client_request()
        .unwrap();
    let headers = request.headers_mut();
    headers.insert(
        "cookie",
        HeaderValue::from_str(&format!(
            "qubite_session={}",
            browser.session.as_deref().unwrap()
        ))
        .unwrap(),
    );
    headers.insert(
        "origin",
        HeaderValue::from_str(&format!("http://{address}")).unwrap(),
    );
    tokio_tungstenite::connect_async(request)
        .await
        .map(|(socket, _)| socket)
        .map_err(|error| error.to_string())
}

/// Следующее сообщение, кроме ping/pong; `None` — соединение закрыто.
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

async fn drain(socket: &mut Socket) {
    while let Ok(Some(Ok(_))) =
        tokio::time::timeout(Duration::from_millis(300), socket.next()).await
    {}
}

#[tokio::test]
async fn owner_switches_maintenance_and_return_time_shows_only_if_set() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;

    let on = owner
        .post_json(
            address,
            "/api/owner/maintenance",
            json!({ "enabled": true }),
        )
        .await;
    assert_eq!(on.status, 200, "{:?}", on.body);
    assert_eq!(on.body["enabled"], true);
    assert_eq!(on.body["effective"], true);
    assert_eq!(on.body["until"], Value::Null);
    let body = status(address).await;
    assert_eq!(body["maintenance"], true);
    // Время не задано — экран его не показывает.
    assert_eq!(body["maintenance_until"], Value::Null);
    assert!(
        body["maintenance_message"]
            .as_str()
            .unwrap()
            .contains("скоро вернёмся"),
        "{body}"
    );

    // «До 10:00» — ближайшие 10:00 по часам платформы, в будущем.
    let timed = owner
        .post_json(
            address,
            "/api/owner/maintenance",
            json!({ "enabled": true, "until": "10:00", "message": "Переезжаем на новый сервер" }),
        )
        .await;
    assert_eq!(timed.status, 200, "{:?}", timed.body);
    let until = timed.body["until"].as_str().unwrap().to_owned();
    let (future, local): (bool, String) = sqlx::query_as(
        "SELECT $1::timestamptz > now(), to_char($1::timestamptz AT TIME ZONE 'Asia/Yekaterinburg', 'HH24:MI')",
    )
    .bind(&until)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert!(future, "{until}");
    assert_eq!(local, "10:00");
    let body = status(address).await;
    assert_eq!(body["maintenance_until"], until.as_str());
    assert_eq!(body["maintenance_message"], "Переезжаем на новый сервер");

    for bad in ["25:00", "завтра", "10:7"] {
        let reply = owner
            .post_json(
                address,
                "/api/owner/maintenance",
                json!({ "enabled": true, "until": bad }),
            )
            .await;
        assert_eq!(reply.status, 400, "{bad}: {:?}", reply.body);
    }

    let off = owner
        .post_json(
            address,
            "/api/owner/maintenance",
            json!({ "enabled": false }),
        )
        .await;
    assert_eq!(off.body["enabled"], false);
    let body = status(address).await;
    assert_eq!(body["maintenance"], false);
    assert_eq!(body["maintenance_until"], Value::Null);
    assert_eq!(body["maintenance_message"], Value::Null);

    // Только owner.
    let (_, mut user) = student(&db, address, &mut owner).await;
    let reply = user
        .post_json(
            address,
            "/api/owner/maintenance",
            json!({ "enabled": true }),
        )
        .await;
    assert_eq!(reply.status, 404);
    assert_eq!(status(address).await["maintenance"], false);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn maintenance_closes_open_sockets_and_stops_jobs_of_everyone_but_owner() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let (account, mut user) = student(&db, address, &mut owner).await;

    let mut user_socket = connect(address, &user).await.unwrap();
    let mut owner_socket = connect(address, &owner).await.unwrap();
    for socket in [&mut user_socket, &mut owner_socket] {
        assert_eq!(
            next(socket).await,
            Some(Message::text(r#"{"type":"ready"}"#))
        );
        drain(socket).await;
    }

    // Фоновая задача пользователя и задача owner, поставленные до техработ.
    let session: Uuid = user.get(address, "/api/auth/me").await.body["session_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let inbox = ModuleId::new("inbox").unwrap();
    let user_job =
        qubite_policy::decide::<Read>(db.pool(), &Subject::account(account, Some(session)), &inbox)
            .await
            .unwrap()
            .authority();
    let owner_id = qubite_auth::owner::current(db.pool())
        .await
        .unwrap()
        .unwrap()
        .id;
    let owner_job =
        qubite_policy::decide::<Read>(db.pool(), &Subject::account(owner_id, None), &inbox)
            .await
            .unwrap()
            .authority();

    // Техработы включили из другого процесса (команда или бот) — прямо в базе.
    maintenance::switch(
        db.pool(),
        None,
        Switch {
            on: true,
            ..Switch::default()
        },
    )
    .await
    .unwrap();

    // Соединение пользователя закрывается сразу, не дожидаясь таймера (30 с).
    match next(&mut user_socket).await {
        Some(Message::Close(Some(frame))) => assert_eq!(u16::from(frame.code), 4403),
        other => panic!("ждали закрытие: {other:?}"),
    }
    // Новое не открыть, а owner остаётся на связи.
    assert!(connect(address, &user).await.is_err());
    assert_eq!(
        next(&mut owner_socket).await,
        Some(Message::text(r#"{"type":"changed"}"#))
    );
    drain(&mut owner_socket).await;
    let reply = owner
        .post_json(
            address,
            "/api/v1/inbox",
            json!({ "text": "owner работает" }),
        )
        .await;
    assert_eq!(reply.status, 201);
    assert_eq!(
        next(&mut owner_socket).await,
        Some(Message::text(r#"{"type":"changed"}"#))
    );

    // Фоновые задачи: пользователя — стоп (как при отзыве прав), owner — дальше.
    let stopped = user_job.recheck::<Read>(db.pool()).await;
    assert!(
        matches!(
            stopped,
            Err(qubite_policy::Error::Denied(
                DenyReason::PlatformMaintenance
            ))
        ),
        "{stopped:?}"
    );
    assert!(owner_job.recheck::<Read>(db.pool()).await.is_ok());

    // Техработы кончились — задача пользователя снова может работать.
    maintenance::switch(db.pool(), None, Switch::default())
        .await
        .unwrap();
    assert!(user_job.recheck::<Read>(db.pool()).await.is_ok());
    assert_eq!(user.get(address, "/api/v1/inbox").await.status, 200);

    let _ = owner_socket.close(None).await;
    db.close().await;
    test_db.drop_db().await;
}

/// Нажать «Войти» на странице пропуска.
async fn redeem(address: SocketAddr, token: &str) -> (reqwest::StatusCode, String, Option<String>) {
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .unwrap();
    let response = client
        .post(format!("http://{address}/api/maintenance/pass"))
        .header("content-type", "application/x-www-form-urlencoded")
        .body(format!("token={token}"))
        .send()
        .await
        .unwrap();
    let location = response.headers()["location"].to_str().unwrap().to_owned();
    let session = response
        .headers()
        .get_all("set-cookie")
        .iter()
        .map(|c| c.to_str().unwrap())
        .find_map(|c| c.strip_prefix("qubite_session="))
        .map(|c| c.split(';').next().unwrap().to_owned());
    (response.status(), location, session)
}

#[tokio::test]
async fn owner_pass_lets_the_owner_in_once_during_maintenance() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    owner
        .post_json(
            address,
            "/api/owner/maintenance",
            json!({ "enabled": true }),
        )
        .await;

    let issued = owner
        .post_json(address, "/api/owner/maintenance/pass", json!({}))
        .await;
    assert_eq!(issued.status, 200, "{:?}", issued.body);
    let link = issued.body["link"].as_str().unwrap();
    let token = link.split("token=").nth(1).unwrap().to_owned();

    // Страница пропуска (её может открыть предпросмотр Telegram) пропуск не тратит.
    let page = reqwest::get(format!(
        "http://{address}/api/maintenance/pass?token={token}"
    ))
    .await
    .unwrap();
    assert_eq!(page.status(), 200);
    let html = page.text().await.unwrap();
    assert!(html.contains("Войти") && html.contains(&token));

    // Новый браузер: по пропуску — сессия owner, хотя идут техработы.
    let (status, location, session) = redeem(address, &token).await;
    assert_eq!(status, 303);
    assert_eq!(location, "/");
    let mut fresh = Browser {
        session,
        ..Browser::default()
    };
    let me = fresh.get(address, "/api/auth/me").await;
    assert_eq!(me.status, 200, "{:?}", me.body);
    assert_eq!(me.body["email"], EMAIL);
    assert_eq!(fresh.get(address, "/api/modules").await.status, 200);

    // Второй раз — нет.
    let (_, again, session) = redeem(address, &token).await;
    assert_eq!(again, "/auth?error=pass_invalid");
    assert!(session.is_none());

    // Поддельный и просроченный пропуска не проходят.
    let key = maintenance::pass_key(db.pool()).await.unwrap();
    let owner_id = qubite_auth::owner::current(db.pool())
        .await
        .unwrap()
        .unwrap()
        .id;
    let expired = maintenance::encode_pass(
        &key,
        &PassClaims {
            owner_id,
            expires_at: 1,
            nonce: [3; 16],
        },
    );
    let foreign = maintenance::encode_pass(
        &[9u8; 32],
        &PassClaims {
            owner_id,
            expires_at: i64::MAX,
            nonce: [4; 16],
        },
    );
    for bad in [expired.as_str(), foreign.as_str(), "мусор"] {
        let (_, location, session) = redeem(address, bad).await;
        assert_eq!(location, "/auth?error=pass_invalid");
        assert!(session.is_none());
    }

    // Пропуск — только owner и только себе.
    let (account, mut user) = {
        owner
            .post_json(
                address,
                "/api/owner/maintenance",
                json!({ "enabled": false }),
            )
            .await;
        student(&db, address, &mut owner).await
    };
    assert_eq!(
        user.post_json(address, "/api/owner/maintenance/pass", json!({}))
            .await
            .status,
        404
    );
    assert!(maintenance::issue_pass(db.pool(), account).await.is_err());
    // Подписанный «пропуск» на пользователя (если бы ключ утёк) входа не даёт.
    let for_user = maintenance::encode_pass(
        &key,
        &PassClaims {
            owner_id: account,
            expires_at: i64::MAX,
            nonce: [5; 16],
        },
    );
    let (_, location, _) = redeem(address, &for_user).await;
    assert_eq!(location, "/auth?error=pass_invalid");

    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'auth.login' \
         AND after->>'method' = 'maintenance_pass'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(audit, 1);

    db.close().await;
    test_db.drop_db().await;
}
