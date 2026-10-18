//! Вход приложений (AUTH-006): тестовый клиент проходит вход через PKCE,
//! отзыв устройства его блокирует.

mod common;

use std::net::SocketAddr;

use common::{Browser, logged_in, setup};
use qubite_auth::devices::challenge_for;
use qubite_db::Database;
use qubite_server::auth::AuthSettings;
use reqwest::StatusCode;
use serde_json::{Value, json};

const VERIFIER: &str = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const REDIRECT: &str = "qubite://auth/callback";

/// Тестовое приложение: умеет только HTTP с `Authorization: Bearer`.
struct App {
    address: SocketAddr,
    access: Option<String>,
    refresh: Option<String>,
}

impl App {
    fn new(address: SocketAddr) -> Self {
        Self {
            address,
            access: None,
            refresh: None,
        }
    }

    async fn post(&self, path: &str, body: Value) -> (StatusCode, Value) {
        let response = reqwest::Client::new()
            .post(format!("http://{}{path}", self.address))
            .json(&body)
            .send()
            .await
            .unwrap();
        let status = response.status();
        if path.ends_with("/token") {
            assert_eq!(response.headers()["cache-control"], "no-store");
        }
        (status, response.json().await.unwrap_or(Value::Null))
    }

    async fn api(&self, method: reqwest::Method, path: &str) -> StatusCode {
        let mut request =
            reqwest::Client::new().request(method, format!("http://{}{path}", self.address));
        if let Some(access) = &self.access {
            request = request.bearer_auth(access);
        }
        request.send().await.unwrap().status()
    }

    async fn me(&self) -> StatusCode {
        self.api(reqwest::Method::GET, "/api/auth/me").await
    }

    async fn exchange(&mut self, code: &str, verifier: &str) -> (StatusCode, Value) {
        let (status, body) = self
            .post(
                "/api/auth/device/token",
                json!({
                    "grant_type": "authorization_code",
                    "client_id": "qubite-desktop",
                    "code": code,
                    "code_verifier": verifier,
                    "redirect_uri": REDIRECT,
                }),
            )
            .await;
        self.remember(status, &body);
        (status, body)
    }

    async fn refresh_with(&mut self, refresh: &str) -> (StatusCode, Value) {
        let (status, body) = self
            .post(
                "/api/auth/device/token",
                json!({ "grant_type": "refresh_token", "client_id": "qubite-desktop", "refresh_token": refresh }),
            )
            .await;
        self.remember(status, &body);
        (status, body)
    }

    fn remember(&mut self, status: StatusCode, body: &Value) {
        if status == 200 {
            self.access = body["access_token"].as_str().map(str::to_owned);
            self.refresh = body["refresh_token"].as_str().map(str::to_owned);
        }
    }
}

/// Человек в браузере разрешает вход; возвращается код из адреса возврата.
async fn approve(
    browser: &mut Browser,
    address: SocketAddr,
    body: Value,
) -> (StatusCode, Option<String>) {
    let reply = browser
        .post_json(address, "/api/auth/device/authorize", body)
        .await;
    let code = reply.body["redirect_to"].as_str().map(|to| {
        assert!(to.starts_with("qubite://auth/callback?code="), "{to}");
        assert!(to.ends_with("&state=xyz-123"), "{to}");
        to["qubite://auth/callback?code=".len()..to.len() - "&state=xyz-123".len()].to_owned()
    });
    (reply.status, code)
}

fn request() -> Value {
    json!({
        "client_id": "qubite-desktop",
        "redirect_uri": REDIRECT,
        "code_challenge": challenge_for(VERIFIER),
        "code_challenge_method": "S256",
        "state": "xyz-123",
        "device_name": "Ноутбук Xiaoxin",
    })
}

async fn signed_in_app(browser: &mut Browser, address: SocketAddr) -> App {
    let (status, code) = approve(browser, address, request()).await;
    assert_eq!(status, 200);
    let mut app = App::new(address);
    let (status, body) = app.exchange(&code.unwrap(), VERIFIER).await;
    assert_eq!(status, 200, "{body}");
    app
}

async fn finish(test_db: qubite_testkit::TestDb, db: Database) {
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn test_client_signs_in_and_revocation_blocks_it() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let mut app = signed_in_app(&mut browser, address).await;

    assert_eq!(app.me().await, 200);
    // Изменяющий запрос по Bearer — без CSRF.
    assert_eq!(app.api(reqwest::Method::GET, "/api/modules").await, 200);

    // В списке сессий браузера видно устройство.
    let list = browser.get(address, "/api/auth/sessions").await.body;
    let device = list
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["kind"] == "device")
        .unwrap()
        .clone();
    assert_eq!(device["device_name"], "Ноутбук Xiaoxin");
    assert_eq!(device["current"], false);

    // Отзыв из профиля — приложение сразу теряет доступ, refresh не помогает.
    let revoke = browser
        .delete(
            address,
            &format!("/api/auth/sessions/{}", device["id"].as_str().unwrap()),
        )
        .await;
    assert_eq!(revoke.status, 204);
    assert_eq!(app.me().await, 401);
    let refresh = app.refresh.clone().unwrap();
    let (status, body) = app.refresh_with(&refresh).await;
    assert_eq!(status, 400);
    assert_eq!(body["error"], "invalid_grant");

    let actions: Vec<String> = sqlx::query_scalar(
        "SELECT action FROM audit_log WHERE action LIKE 'auth.device%' ORDER BY seq",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(actions, ["auth.device_authorized", "auth.device_login"]);
    finish(test_db, db).await;
}

#[tokio::test]
async fn stolen_code_is_useless_and_codes_are_single_use() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;

    // Перехватили код, но не знают code_verifier — и код сгорает.
    let (_, code) = approve(&mut browser, address, request()).await;
    let code = code.unwrap();
    let mut thief = App::new(address);
    let (status, body) = thief.exchange(&code, &"a".repeat(43)).await;
    assert_eq!(
        (status.as_u16(), body["error"].as_str()),
        (400, Some("invalid_grant"))
    );
    let mut app = App::new(address);
    assert_eq!(app.exchange(&code, VERIFIER).await.0, 400, "код уже сожжён");

    // Повтор кода закрывает выданную по нему сессию.
    let (_, code) = approve(&mut browser, address, request()).await;
    let code = code.unwrap();
    assert_eq!(app.exchange(&code, VERIFIER).await.0, 200);
    assert_eq!(app.me().await, 200);
    let mut replay = App::new(address);
    assert_eq!(replay.exchange(&code, VERIFIER).await.0, 400);
    assert_eq!(app.me().await, 401, "сессию по повторённому коду закрыли");

    // Истёкший код и чужой адрес возврата.
    let (_, code) = approve(&mut browser, address, request()).await;
    sqlx::query("UPDATE device_auth_codes SET expires_at = now() - interval '1 second' WHERE used_at IS NULL")
        .execute(db.pool())
        .await
        .unwrap();
    assert_eq!(
        App::new(address).exchange(&code.unwrap(), VERIFIER).await.0,
        400
    );
    let (_, code) = approve(&mut browser, address, request()).await;
    let (status, _) = App::new(address)
        .post(
            "/api/auth/device/token",
            json!({
                "grant_type": "authorization_code", "client_id": "qubite-desktop",
                "code": code.unwrap(), "code_verifier": VERIFIER,
                "redirect_uri": "http://127.0.0.1:5000/callback",
            }),
        )
        .await;
    assert_eq!(status, 400);
    finish(test_db, db).await;
}

/// Код выдан из web-сессии; если её закрыли до обмена (например, «выйти
/// везде» после кражи входа), код не действует.
#[tokio::test]
async fn code_dies_with_the_browser_session_that_approved_it() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let (_, code) = approve(&mut browser, address, request()).await;
    assert_eq!(
        browser
            .post(address, "/api/auth/logout-everywhere")
            .await
            .status,
        200
    );
    let (status, body) = App::new(address).exchange(&code.unwrap(), VERIFIER).await;
    assert_eq!(
        (status.as_u16(), body["error"].as_str()),
        (400, Some("invalid_grant"))
    );
    let sessions: i64 = sqlx::query_scalar("SELECT count(*) FROM sessions WHERE kind = 'device'")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(sessions, 0, "сессия устройства не создана");
    finish(test_db, db).await;
}

#[tokio::test]
async fn authorize_checks_client_pkce_and_needs_browser_session() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;

    let mut bad_client = request();
    bad_client["client_id"] = json!("evil-app");
    assert_eq!(approve(&mut browser, address, bad_client).await.0, 401);
    let mut bad_redirect = request();
    bad_redirect["redirect_uri"] = json!("https://evil.example/steal");
    assert_eq!(approve(&mut browser, address, bad_redirect).await.0, 401);
    let mut plain = request();
    plain["code_challenge_method"] = json!("plain");
    assert_eq!(approve(&mut browser, address, plain).await.0, 400);
    let mut bad_state = request();
    bad_state["state"] = json!("a&code=evil");
    assert_eq!(approve(&mut browser, address, bad_state).await.0, 400);

    // Без входа и без CSRF — нельзя.
    let mut anonymous = Browser::default();
    assert_eq!(approve(&mut anonymous, address, request()).await.0, 401);
    let no_csrf = browser
        .send(
            address,
            reqwest::Method::POST,
            "/api/auth/device/authorize",
            Some(request()),
            false,
        )
        .await;
    assert_eq!(no_csrf.status, 403);

    // Токен приложения не может разрешить вход другому приложению.
    let app = signed_in_app(&mut browser, address).await;
    let response = reqwest::Client::new()
        .post(format!("http://{address}/api/auth/device/authorize"))
        .bearer_auth(app.access.as_deref().unwrap())
        .json(&request())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 400);

    let (status, body) = App::new(address)
        .post(
            "/api/auth/device/token",
            json!({ "grant_type": "password", "client_id": "qubite-desktop" }),
        )
        .await;
    assert_eq!(
        (status.as_u16(), body["error"].as_str()),
        (400, Some("unsupported_grant_type"))
    );
    finish(test_db, db).await;
}

#[tokio::test]
async fn refresh_rotates_and_reuse_closes_the_device_session() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let mut app = signed_in_app(&mut browser, address).await;
    let (first_access, first_refresh) = (app.access.clone().unwrap(), app.refresh.clone().unwrap());

    // Access истёк — не работает, refresh выдаёт новую пару.
    sqlx::query(
        "UPDATE sessions SET access_expires_at = now() - interval '1 second' WHERE kind = 'device'",
    )
    .execute(db.pool())
    .await
    .unwrap();
    assert_eq!(app.me().await, 401);
    let (status, body) = app.refresh_with(&first_refresh).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(body["expires_in"], 900);
    assert_ne!(app.access.as_deref(), Some(first_access.as_str()));
    assert_eq!(app.me().await, 200);
    let old = App {
        address,
        access: Some(first_access),
        refresh: None,
    };
    assert_eq!(old.me().await, 401, "старый access больше не действует");

    // Кто-то предъявил старый refresh — сессия устройства закрыта целиком.
    let (status, _) = App::new(address).refresh_with(&first_refresh).await;
    assert_eq!(status, 400);
    assert_eq!(app.me().await, 401);
    let current = app.refresh.clone().unwrap();
    assert_eq!(app.refresh_with(&current).await.0, 400);
    let reason: String =
        sqlx::query_scalar("SELECT revoke_reason FROM sessions WHERE kind = 'device'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(reason, "refresh_reuse");
    finish(test_db, db).await;
}

#[tokio::test]
async fn cookie_and_bearer_tokens_are_not_interchangeable_and_logout_everywhere_covers_devices() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let app = signed_in_app(&mut browser, address).await;

    // Токен приложения в cookie и cookie браузера как Bearer — не принимаются.
    let mut fake_browser = Browser {
        session: app.access.clone(),
        csrf: None,
    };
    assert_eq!(fake_browser.get(address, "/api/auth/me").await.status, 401);
    let fake_app = App {
        address,
        access: browser.session.clone(),
        refresh: None,
    };
    assert_eq!(fake_app.me().await, 401);

    // Выход приложения закрывает только его сессию.
    assert_eq!(
        app.api(reqwest::Method::POST, "/api/auth/logout").await,
        204
    );
    assert_eq!(app.me().await, 401);
    assert_eq!(browser.get(address, "/api/auth/me").await.status, 200);

    // «Выйти везде» закрывает и приложения.
    let app = signed_in_app(&mut browser, address).await;
    assert_eq!(
        browser
            .post(address, "/api/auth/logout-everywhere")
            .await
            .status,
        200
    );
    assert_eq!(app.me().await, 401);
    finish(test_db, db).await;
}
