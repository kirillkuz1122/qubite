//! Уведомления владельцу (CMD-006) через HTTP: тумблеры только у owner,
//! привязка Telegram по паролю, ошибки сервера → уведомление.

mod common;

use std::net::SocketAddr;

use axum::{Router, http::StatusCode, routing::get};
use common::{Browser, logged_in};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_server::{AppState, auth::AuthSettings};
use serde_json::json;

async fn spawn(db: qubite_db::Database, bot_name: &str) -> SocketAddr {
    let settings = qubite_oauth::OAuthSettings {
        telegram: qubite_oauth::TelegramLogin {
            bot_name: bot_name.into(),
            ..qubite_oauth::TelegramLogin::default()
        },
        ..qubite_oauth::OAuthSettings::default()
    };
    let broken: Router<AppState> = Router::new().route(
        "/api/test/broken",
        get(|| async { (StatusCode::INTERNAL_SERVER_ERROR, "упало") }),
    );
    let app = qubite_server::router_with(
        AppState::with_auth(db, AuthSettings::default()).with_oauth(settings),
        broken,
    )
    .into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    address
}

async fn setup(bot_name: &str) -> (qubite_testkit::TestDb, qubite_db::Database, SocketAddr) {
    let (test_db, db) = qubite_testkit::TestDb::migrated().await;
    qubite_auth::owner::create(
        db.pool(),
        &Passwords::default(),
        common::EMAIL,
        "Кирилл",
        common::PASSWORD,
    )
    .await
    .unwrap();
    let address = spawn(db.clone(), bot_name).await;
    (test_db, db, address)
}

#[tokio::test]
async fn only_owner_switches_notification_kinds() {
    let (test_db, db, address) = setup("qubite_test_bot").await;
    qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "student@qubite.ru",
            display_name: "",
            password: "пароль пользователя",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut student = Browser::default();
    student
        .login(address, "student@qubite.ru", "пароль пользователя")
        .await;
    assert_eq!(
        student
            .get(address, "/api/owner/notifications")
            .await
            .status,
        404
    );
    let reply = student
        .put_json(
            address,
            "/api/owner/notifications/registration",
            json!({ "enabled": false }),
        )
        .await;
    assert_eq!(reply.status, 404);

    let mut owner = logged_in(address).await;
    let list = owner.get(address, "/api/owner/notifications").await;
    assert_eq!(list.status, 200);
    let kinds = list.body.as_array().unwrap();
    assert_eq!(kinds.len(), qubite_bot::Kind::ALL.len());
    assert!(
        kinds.iter().all(|kind| kind["enabled"] == true),
        "по умолчанию всё включено"
    );
    for kind in [
        "new_device_login",
        "ai_budget_80",
        "ai_budget_100",
        "server_down",
        "backup_failed",
        "disk_low",
        "registration",
        "invitation_accepted",
    ] {
        assert!(kinds.iter().any(|k| k["kind"] == kind), "{kind}");
    }
    let reply = owner
        .put_json(
            address,
            "/api/owner/notifications/registration",
            json!({ "enabled": false }),
        )
        .await;
    assert_eq!(reply.status, 204, "{:?}", reply.body);
    let list = owner.get(address, "/api/owner/notifications").await;
    let registration = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|k| k["kind"] == "registration")
        .cloned()
        .unwrap();
    assert_eq!(registration["enabled"], false);
    let unknown = owner
        .put_json(
            address,
            "/api/owner/notifications/что-то",
            json!({ "enabled": false }),
        )
        .await;
    assert_eq!(unknown.status, 404);
    let audited: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'notify.setting_changed'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(audited, 1);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn telegram_link_code_needs_password_and_configured_bot() {
    let (test_db, db, address) = setup("qubite_test_bot").await;
    let mut owner = logged_in(address).await;
    let wrong = owner
        .post_json(
            address,
            "/api/v1/telegram/link-code",
            json!({ "password": "не тот" }),
        )
        .await;
    assert_eq!(wrong.status, 401);
    let reply = owner
        .post_json(
            address,
            "/api/v1/telegram/link-code",
            json!({ "password": common::PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let url = reply.body["url"].as_str().unwrap();
    assert!(
        url.starts_with("https://t.me/qubite_test_bot?start="),
        "{url}"
    );
    assert_eq!(reply.body["expires_in"], 600);
    let codes: i64 = sqlx::query_scalar("SELECT count(*) FROM telegram_link_codes")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(codes, 1);
    let anonymous = Browser::default()
        .post_json(
            address,
            "/api/v1/telegram/link-code",
            json!({ "password": common::PASSWORD }),
        )
        .await;
    assert_eq!(anonymous.status, 401);
    db.close().await;
    test_db.drop_db().await;

    let (test_db, db, address) = setup("").await;
    let mut owner = logged_in(address).await;
    let reply = owner
        .post_json(
            address,
            "/api/v1/telegram/link-code",
            json!({ "password": common::PASSWORD }),
        )
        .await;
    assert_eq!(reply.status, 409);
    assert_eq!(reply.body["error"], "bot_not_configured");
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn server_errors_notify_owner_once_an_hour() {
    let (test_db, db, address) = setup("qubite_test_bot").await;
    let mut browser = Browser::default();
    for _ in 0..3 {
        assert_eq!(
            browser
                .get(address, "/api/test/broken?code=секрет")
                .await
                .status,
            500
        );
    }
    // Уведомление пишется в фоне: ждём первое, потом убеждаемся, что второго нет.
    let count = || async {
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM owner_notifications")
            .fetch_one(db.pool())
            .await
            .unwrap()
    };
    for _ in 0..50 {
        if count().await > 0 {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT kind, text FROM owner_notifications")
        .fetch_all(db.pool())
        .await
        .unwrap();
    assert_eq!(rows.len(), 1, "одно в час, а не на каждую ошибку: {rows:?}");
    assert_eq!(rows[0].0, "server_errors");
    assert!(rows[0].1.contains("GET /api/test/broken"));
    assert!(
        !rows[0].1.contains("секрет"),
        "параметры запроса не попадают в уведомление"
    );
    db.close().await;
    test_db.drop_db().await;
}
