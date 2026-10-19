//! Вход через провайдеров (AUTH-004) через настоящий сервер и поддельных
//! провайдеров: PKCE, привязка к браузеру, выключение на ходу, привязка
//! только с паролем, совпадение почты ничего не даёт, Telegram-подпись.

mod common;

use std::{
    collections::{BTreeMap, HashMap},
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use axum::{
    Form, Json, Router,
    extract::{Query, State},
    http::HeaderMap,
    routing::{get, post},
};
use base64::Engine;
use hmac::{Hmac, KeyInit, Mac};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_db::Database;
use qubite_oauth::{OAuthSettings, Provider, RedirectProvider, TelegramLogin};
use qubite_server::{AppState, auth::AuthSettings};
use qubite_testkit::TestDb;
use reqwest::{Method, StatusCode, redirect::Policy};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const BOT_TOKEN: &str = "123456:тестовый-токен";
const PUBLIC: &str = "http://qubite.test";

// ---------------------------------------------------------------- поддельный провайдер

#[derive(Clone)]
struct Grant {
    challenge: String,
    redirect_uri: String,
    identity: Value,
}

#[derive(Clone, Default)]
struct Mock {
    grants: Arc<Mutex<HashMap<String, Grant>>>,
    tokens: Arc<Mutex<HashMap<String, Value>>>,
    vk_device_ids: Arc<Mutex<Vec<String>>>,
}

impl Mock {
    /// Провайдер «показал человеку окно» и выдал код для этого `state`.
    fn issue(&self, code: &str, authorize_url: &str, identity: Value) {
        let url = reqwest::Url::parse(authorize_url).unwrap();
        let query: HashMap<_, _> = url.query_pairs().into_owned().collect();
        assert_eq!(query["code_challenge_method"], "S256");
        assert_eq!(query["response_type"], "code");
        self.grants.lock().unwrap().insert(
            code.into(),
            Grant {
                challenge: query["code_challenge"].clone(),
                redirect_uri: query["redirect_uri"].clone(),
                identity,
            },
        );
    }
}

async fn token(State(mock): State<Mock>, Form(form): Form<HashMap<String, String>>) -> Json<Value> {
    let Some(grant) = mock.grants.lock().unwrap().remove(&form["code"]) else {
        return Json(json!({ "error": "invalid_grant" }));
    };
    let verifier = form.get("code_verifier").cloned().unwrap_or_default();
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(Sha256::digest(verifier.as_bytes()));
    if challenge != grant.challenge || form["redirect_uri"] != grant.redirect_uri {
        return Json(json!({ "error": "invalid_grant", "error_description": "PKCE" }));
    }
    if let Some(device) = form.get("device_id") {
        mock.vk_device_ids.lock().unwrap().push(device.clone());
    }
    let access = format!("at-{}", form["code"]);
    mock.tokens
        .lock()
        .unwrap()
        .insert(access.clone(), grant.identity);
    Json(json!({ "access_token": access, "token_type": "bearer" }))
}

fn identity_for(mock: &Mock, token: &str) -> Value {
    mock.tokens
        .lock()
        .unwrap()
        .get(token)
        .cloned()
        .unwrap_or(Value::Null)
}

async fn yandex_info(State(mock): State<Mock>, headers: HeaderMap) -> Json<Value> {
    let auth = headers["authorization"].to_str().unwrap();
    Json(identity_for(&mock, auth.strip_prefix("OAuth ").unwrap()))
}

async fn google_info(State(mock): State<Mock>, headers: HeaderMap) -> Json<Value> {
    let auth = headers["authorization"].to_str().unwrap();
    Json(identity_for(&mock, auth.strip_prefix("Bearer ").unwrap()))
}

async fn vk_info(
    State(mock): State<Mock>,
    Form(form): Form<HashMap<String, String>>,
) -> Json<Value> {
    Json(json!({ "user": identity_for(&mock, &form["access_token"]) }))
}

async fn spawn_mock() -> (Mock, String) {
    let mock = Mock::default();
    let app = Router::new()
        .route("/token", post(token))
        .route("/yandex/info", get(yandex_info))
        .route("/google/userinfo", get(google_info))
        .route("/vk/user_info", post(vk_info))
        .route(
            "/authorize",
            get(|Query(_): Query<HashMap<String, String>>| async {
                "окно провайдера"
            }),
        )
        .with_state(mock.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (mock, base)
}

fn provider(base: &str, mut config: RedirectProvider, info: &str) -> RedirectProvider {
    config.client_id = "qubite-app".into();
    config.client_secret = "секрет".into();
    config.authorize_url = format!("{base}/authorize");
    config.token_url = format!("{base}/token");
    config.userinfo_url = format!("{base}{info}");
    config
}

// ---------------------------------------------------------------- стенд

struct Lab {
    test_db: TestDb,
    db: Database,
    address: SocketAddr,
    mock: Mock,
}

impl Lab {
    async fn new() -> Self {
        let (test_db, db) = TestDb::migrated().await;
        qubite_auth::owner::create(
            db.pool(),
            &Passwords::default(),
            common::EMAIL,
            "Кирилл",
            common::PASSWORD,
        )
        .await
        .unwrap();
        let (mock, base) = spawn_mock().await;
        let settings = OAuthSettings {
            public_url: PUBLIC.into(),
            yandex: provider(&base, RedirectProvider::yandex("", ""), "/yandex/info"),
            vk: provider(&base, RedirectProvider::vk("", ""), "/vk/user_info"),
            google: provider(&base, RedirectProvider::google("", ""), "/google/userinfo"),
            telegram: TelegramLogin {
                bot_name: "qubite_test_bot".into(),
                bot_token: BOT_TOKEN.into(),
                ..TelegramLogin::default()
            },
            ..OAuthSettings::default()
        };
        let state = AppState::with_auth(db.clone(), AuthSettings::default()).with_oauth(settings);
        let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self {
            test_db,
            db,
            address,
            mock,
        }
    }

    async fn user(&self, email: &str) -> uuid::Uuid {
        qubite_auth::accounts::create(
            self.db.pool(),
            &Passwords::default(),
            NewAccount {
                email,
                display_name: "",
                password: "пароль пользователя",
                email_verified: true,
            },
            None,
        )
        .await
        .unwrap()
        .id
    }

    async fn finish(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

/// Браузер без автоматических переходов: cookie ведём вручную (у них `Secure`).
#[derive(Default, Clone)]
struct Browser {
    cookies: BTreeMap<String, String>,
}

struct Reply {
    status: StatusCode,
    location: Option<String>,
    body: Value,
}

impl Browser {
    async fn send(
        &mut self,
        address: SocketAddr,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Reply {
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .build()
            .unwrap();
        let mut request = client.request(method, format!("http://{address}{path}"));
        if !self.cookies.is_empty() {
            let header = self
                .cookies
                .iter()
                .map(|(name, value)| format!("{name}={value}"))
                .collect::<Vec<_>>()
                .join("; ");
            request = request.header("cookie", header);
        }
        if let Some(csrf) = self.cookies.get("qubite_csrf") {
            request = request.header("x-csrf-token", csrf);
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.unwrap();
        let status = response.status();
        let location = response
            .headers()
            .get("location")
            .map(|value| value.to_str().unwrap().to_owned());
        for cookie in response.headers().get_all("set-cookie") {
            let pair = cookie.to_str().unwrap().split(';').next().unwrap();
            let (name, value) = pair.split_once('=').unwrap();
            if value.is_empty() {
                self.cookies.remove(name);
            } else {
                self.cookies.insert(name.into(), value.into());
            }
        }
        let body = response.json().await.unwrap_or(Value::Null);
        Reply {
            status,
            location,
            body,
        }
    }

    async fn get(&mut self, address: SocketAddr, path: &str) -> Reply {
        self.send(address, Method::GET, path, None).await
    }

    async fn post(&mut self, address: SocketAddr, path: &str, body: Value) -> Reply {
        self.send(address, Method::POST, path, Some(body)).await
    }

    async fn login(address: SocketAddr, email: &str, password: &str) -> Self {
        let mut browser = Self::default();
        let reply = browser
            .post(
                address,
                "/api/auth/login",
                json!({ "email": email, "password": password }),
            )
            .await;
        assert_eq!(reply.status, 200, "{:?}", reply.body);
        browser
    }

    fn logged_in(&self) -> bool {
        self.cookies.contains_key("qubite_session")
    }
}

fn query(url: &str) -> HashMap<String, String> {
    reqwest::Url::parse(url)
        .unwrap()
        .query_pairs()
        .into_owned()
        .collect()
}

/// Человек у провайдера нажал «Разрешить»: вернуться на callback.
async fn come_back(
    lab: &Lab,
    browser: &mut Browser,
    provider: &str,
    authorize_url: &str,
    identity: Value,
) -> Reply {
    let code = format!("code-{}", uuid::Uuid::now_v7());
    lab.mock.issue(&code, authorize_url, identity);
    let state = &query(authorize_url)["state"];
    let device = if provider == "vk" {
        "&device_id=vk-device-1"
    } else {
        ""
    };
    browser
        .get(
            lab.address,
            &format!("/api/auth/oauth/{provider}/callback?code={code}&state={state}{device}"),
        )
        .await
}

/// Начать вход как со страницы регистрации — с галочкой «Принимаю условия» (D-230).
async fn start_login(lab: &Lab, browser: &mut Browser, provider: &str, return_to: &str) -> String {
    let consent = qubite_auth::consent::LEGAL_VERSION;
    begin_login(
        lab,
        browser,
        provider,
        &format!("return_to={return_to}&consent={consent}"),
    )
    .await
}

async fn begin_login(lab: &Lab, browser: &mut Browser, provider: &str, params: &str) -> String {
    let reply = browser
        .get(
            lab.address,
            &format!("/api/auth/oauth/{provider}/login?{params}"),
        )
        .await;
    assert_eq!(reply.status, 303);
    let location = reply.location.unwrap();
    assert!(
        location.contains("/authorize?"),
        "ушли к провайдеру: {location}"
    );
    assert!(
        browser.cookies.contains_key("qubite_oauth"),
        "секрет входа в cookie"
    );
    assert_eq!(
        query(&location)["redirect_uri"],
        format!("{PUBLIC}/api/auth/oauth/{provider}/callback")
    );
    location
}

fn yandex_person(id: &str, email: &str) -> Value {
    json!({ "id": id, "default_email": email, "display_name": "Кирилл" })
}

// ---------------------------------------------------------------- тесты

#[tokio::test]
async fn login_only_by_linked_id_and_same_email_gives_nothing() {
    let lab = Lab::new().await;
    // Чужой человек у Яндекса с той же почтой, что у owner.
    let mut stranger = Browser::default();
    let url = start_login(&lab, &mut stranger, "yandex", "/today").await;
    let reply = come_back(
        &lab,
        &mut stranger,
        "yandex",
        &url,
        yandex_person("777", common::EMAIL),
    )
    .await;
    assert_eq!(reply.status, 303);
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=oauth_not_linked&provider=yandex")
    );
    assert!(
        !stranger.logged_in(),
        "совпадение почты не даёт входа (D-060)"
    );

    // Owner привязывает свой Яндекс: без пароля — нет.
    let mut owner = Browser::login(lab.address, common::EMAIL, common::PASSWORD).await;
    let wrong = owner
        .post(
            lab.address,
            "/api/auth/oauth/yandex/link",
            json!({ "password": "не тот" }),
        )
        .await;
    assert_eq!(wrong.status, 401, "{:?}", wrong.body);
    let started = owner
        .post(
            lab.address,
            "/api/auth/oauth/yandex/link",
            json!({ "password": common::PASSWORD }),
        )
        .await;
    assert_eq!(started.status, 200, "{:?}", started.body);
    let url = started.body["authorize_url"].as_str().unwrap().to_owned();
    let reply = come_back(
        &lab,
        &mut owner,
        "yandex",
        &url,
        yandex_person("100500", "k@ya.ru"),
    )
    .await;
    assert_eq!(reply.location.as_deref(), Some("/account?linked=yandex"));
    let list = owner.get(lab.address, "/api/auth/oauth/identities").await;
    assert_eq!(list.body[0]["provider"], "yandex");
    assert_eq!(list.body[0]["email"], "k@ya.ru");

    // Теперь вход через Яндекс — в аккаунт owner, и туда, откуда начинали.
    let mut phone = Browser::default();
    let url = start_login(&lab, &mut phone, "yandex", "/inbox").await;
    let reply = come_back(
        &lab,
        &mut phone,
        "yandex",
        &url,
        yandex_person("100500", "другая@почта"),
    )
    .await;
    assert_eq!(reply.location.as_deref(), Some("/inbox"));
    assert!(phone.logged_in());
    assert!(
        !phone.cookies.contains_key("qubite_oauth"),
        "секрет входа стёрт"
    );
    let me = phone.get(lab.address, "/api/auth/me").await;
    assert_eq!(me.body["email"], common::EMAIL);

    // Повтор того же возврата (украденный адрес) — отказ.
    let state = &query(&url)["state"];
    let mut thief = phone.clone();
    thief.cookies.insert("qubite_oauth".into(), state.clone());
    thief.cookies.remove("qubite_session");
    let replay = thief
        .get(
            lab.address,
            &format!("/api/auth/oauth/yandex/callback?code=x&state={state}"),
        )
        .await;
    assert_eq!(
        replay.location.as_deref(),
        Some("/auth?error=oauth_invalid_state&provider=yandex")
    );
    let audit: Vec<String> =
        sqlx::query_scalar("SELECT action FROM audit_log WHERE action LIKE 'auth.%' ORDER BY seq")
            .fetch_all(lab.db.pool())
            .await
            .unwrap();
    assert!(audit.contains(&"auth.oauth_linked".to_owned()));
    lab.finish().await;
}

#[tokio::test]
async fn flow_is_bound_to_browser_single_use_and_short_lived() {
    let lab = Lab::new().await;
    let owner_id: uuid::Uuid = sqlx::query_scalar("SELECT id FROM accounts")
        .fetch_one(lab.db.pool())
        .await
        .unwrap();
    qubite_oauth::link(
        lab.db.pool(),
        owner_id,
        None,
        Provider::Yandex,
        &qubite_oauth::Identity {
            subject: "42".into(),
            email: None,
            display_name: String::new(),
        },
    )
    .await
    .unwrap();

    // Чужой браузер подсовывает свой адрес возврата: нет cookie — нет входа.
    let mut attacker = Browser::default();
    let url = start_login(&lab, &mut attacker, "yandex", "/").await;
    let mut victim = Browser::default();
    let reply = come_back(&lab, &mut victim, "yandex", &url, yandex_person("42", "")).await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=oauth_invalid_state&provider=yandex")
    );
    assert!(!victim.logged_in());

    // Начатый вход старше 10 минут не принимается.
    let mut slow = Browser::default();
    let url = start_login(&lab, &mut slow, "yandex", "/").await;
    sqlx::query("UPDATE oauth_flows SET expires_at = now() - interval '1 second'")
        .execute(lab.db.pool())
        .await
        .unwrap();
    let reply = come_back(&lab, &mut slow, "yandex", &url, yandex_person("42", "")).await;
    assert!(reply.location.unwrap().contains("oauth_invalid_state"));
    assert!(!slow.logged_in());

    // Подмена провайдера и чужой адрес возврата.
    let mut browser = Browser::default();
    let url = start_login(&lab, &mut browser, "yandex", "//evil.example/").await;
    let state = &query(&url)["state"];
    let reply = browser
        .get(
            lab.address,
            &format!("/api/auth/oauth/google/callback?code=c&state={state}"),
        )
        .await;
    assert!(
        reply.location.unwrap().contains("error="),
        "google не продолжит вход yandex"
    );
    let url = start_login(&lab, &mut browser, "yandex", "//evil.example/").await;
    let reply = come_back(&lab, &mut browser, "yandex", &url, yandex_person("42", "")).await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/"),
        "на чужой сайт не уводим"
    );

    // Неверный PKCE (провайдер отказал) — не входим.
    let mut pkce = Browser::default();
    let url = start_login(&lab, &mut pkce, "yandex", "/").await;
    let code = "pkce-code";
    lab.mock.issue(
        code,
        &url.replace("code_challenge=", "code_challenge=x"),
        yandex_person("42", ""),
    );
    let state = &query(&url)["state"];
    let reply = pkce
        .get(
            lab.address,
            &format!("/api/auth/oauth/yandex/callback?code={code}&state={state}"),
        )
        .await;
    assert!(reply.location.unwrap().contains("oauth_provider_error"));
    assert!(!pkce.logged_in());
    lab.finish().await;
}

#[tokio::test]
async fn disabled_provider_rejects_new_and_started_logins() {
    let lab = Lab::new().await;
    // По умолчанию: Яндекс и VK включены, Google и Telegram — нет (D-194).
    let list = Browser::default()
        .get(lab.address, "/api/auth/oauth/providers")
        .await;
    let ids: Vec<&str> = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|p| p["id"].as_str().unwrap())
        .collect();
    assert_eq!(ids, ["yandex", "vk"]);
    let mut browser = Browser::default();
    let reply = browser
        .get(lab.address, "/api/auth/oauth/google/login")
        .await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=oauth_provider_disabled&provider=google")
    );
    let reply = browser
        .get(lab.address, "/api/auth/oauth/github/login")
        .await;
    assert!(reply.location.unwrap().contains("oauth_unknown_provider"));

    // Вход начат, а владелец выключил способ, пока человек был у провайдера.
    let url = start_login(&lab, &mut browser, "vk", "/").await;
    // Тумблер способа входа (ACC-002).
    qubite_auth::platform::set(
        lab.db.pool(),
        None,
        qubite_auth::platform::LoginMethod::Vk.key(),
        json!(false),
    )
    .await
    .unwrap();
    let reply = come_back(&lab, &mut browser, "vk", &url, json!({ "user_id": 1 })).await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=oauth_provider_disabled&provider=vk")
    );
    assert!(
        lab.mock.vk_device_ids.lock().unwrap().is_empty(),
        "к провайдеру не ходили"
    );

    // Владелец включил Google — появляется и работает.
    // Тумблер способа входа (ACC-002).
    qubite_auth::platform::set(
        lab.db.pool(),
        None,
        qubite_auth::platform::LoginMethod::Google.key(),
        json!(true),
    )
    .await
    .unwrap();
    let list = Browser::default()
        .get(lab.address, "/api/auth/oauth/providers")
        .await;
    assert!(
        list.body
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p["id"] == "google")
    );
    let mut owner = Browser::login(lab.address, common::EMAIL, common::PASSWORD).await;
    let started = owner
        .post(
            lab.address,
            "/api/auth/oauth/google/link",
            json!({ "password": common::PASSWORD }),
        )
        .await;
    let url = started.body["authorize_url"].as_str().unwrap().to_owned();
    assert_eq!(query(&url)["scope"], "openid email profile");
    come_back(
        &lab,
        &mut owner,
        "google",
        &url,
        json!({ "sub": "g-1", "name": "K" }),
    )
    .await;
    let mut laptop = Browser::default();
    let url = start_login(&lab, &mut laptop, "google", "/").await;
    come_back(&lab, &mut laptop, "google", &url, json!({ "sub": "g-1" })).await;
    assert!(laptop.logged_in());
    lab.finish().await;
}

#[tokio::test]
async fn vk_identity_belongs_to_one_account_and_unlink_needs_password() {
    let lab = Lab::new().await;
    lab.user("student@qubite.ru").await;
    let mut owner = Browser::login(lab.address, common::EMAIL, common::PASSWORD).await;
    let mut student = Browser::login(lab.address, "student@qubite.ru", "пароль пользователя").await;
    let vk_person = json!({ "user_id": 31337, "first_name": "Кирилл", "last_name": "К" });

    let link = |browser: &mut Browser, password: &str| {
        let mut browser = browser.clone();
        let password = password.to_owned();
        let address = lab.address;
        async move {
            let reply = browser
                .post(
                    address,
                    "/api/auth/oauth/vk/link",
                    json!({ "password": password }),
                )
                .await;
            (browser, reply)
        }
    };
    let (mut owner_b, started) = link(&mut owner, common::PASSWORD).await;
    let url = started.body["authorize_url"].as_str().unwrap().to_owned();
    let reply = come_back(&lab, &mut owner_b, "vk", &url, vk_person.clone()).await;
    assert_eq!(reply.location.as_deref(), Some("/account?linked=vk"));
    assert_eq!(
        lab.mock.vk_device_ids.lock().unwrap().as_slice(),
        ["vk-device-1"]
    );

    // Тот же VK второй аккаунт привязать не может.
    let (mut student_b, started) = link(&mut student, "пароль пользователя").await;
    let url = started.body["authorize_url"].as_str().unwrap().to_owned();
    let reply = come_back(&lab, &mut student_b, "vk", &url, vk_person.clone()).await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=oauth_taken&provider=vk")
    );

    // Привязку начал один человек, а вернулся другой (сессия в браузере сменилась).
    let (mut swapped, started) = link(&mut student, "пароль пользователя").await;
    swapped.cookies.insert(
        "qubite_session".into(),
        owner.cookies["qubite_session"].clone(),
    );
    let url = started.body["authorize_url"].as_str().unwrap().to_owned();
    let reply = come_back(&lab, &mut swapped, "vk", &url, json!({ "user_id": 5 })).await;
    assert!(reply.location.unwrap().contains("oauth_invalid_state"));

    // Отвязка — только с паролем; после неё VK свободен.
    let no = owner
        .post(
            lab.address,
            "/api/auth/oauth/identities/vk/unlink",
            json!({ "password": "нет" }),
        )
        .await;
    assert_eq!(no.status, 401);
    let yes = owner
        .post(
            lab.address,
            "/api/auth/oauth/identities/vk/unlink",
            json!({ "password": common::PASSWORD }),
        )
        .await;
    assert_eq!(yes.status, 204, "{:?}", yes.body);
    let again = owner
        .post(
            lab.address,
            "/api/auth/oauth/identities/vk/unlink",
            json!({ "password": common::PASSWORD }),
        )
        .await;
    assert_eq!(again.status, 404);
    let (mut student_b, started) = link(&mut student, "пароль пользователя").await;
    let url = started.body["authorize_url"].as_str().unwrap().to_owned();
    let reply = come_back(&lab, &mut student_b, "vk", &url, vk_person).await;
    assert_eq!(reply.location.as_deref(), Some("/account?linked=vk"));

    // Перебор пароля через привязку упирается в тот же лимит, что и вход.
    for _ in 0..5 {
        owner
            .post(
                lab.address,
                "/api/auth/oauth/vk/link",
                json!({ "password": "подбираю" }),
            )
            .await;
    }
    let limited = owner
        .post(
            lab.address,
            "/api/auth/oauth/vk/link",
            json!({ "password": common::PASSWORD }),
        )
        .await;
    assert_eq!(limited.status, 429, "{:?}", limited.body);
    lab.finish().await;
}

fn telegram_data(id: &str, age_secs: i64, token: &str) -> Value {
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let mut data = BTreeMap::from([
        ("id".to_owned(), id.to_owned()),
        ("first_name".to_owned(), "Кирилл".to_owned()),
        ("auth_date".to_owned(), (now - age_secs).to_string()),
        ("nonce".to_owned(), uuid::Uuid::now_v7().to_string()),
    ]);
    let check = data
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut mac =
        <Hmac<Sha256> as KeyInit>::new_from_slice(&Sha256::digest(token.as_bytes())).unwrap();
    mac.update(check.as_bytes());
    data.insert("hash".into(), hex::encode(mac.finalize().into_bytes()));
    serde_json::to_value(data).unwrap()
}

#[tokio::test]
async fn telegram_widget_is_signed_fresh_and_single_use() {
    let lab = Lab::new().await;
    let mut owner = Browser::login(lab.address, common::EMAIL, common::PASSWORD).await;
    let link = json!({ "password": common::PASSWORD, "auth": telegram_data("4242", 0, BOT_TOKEN) });
    // Выключен по умолчанию (D-194).
    let reply = owner
        .post(lab.address, "/api/auth/oauth/telegram/link", link.clone())
        .await;
    assert_eq!(reply.status, 409, "{:?}", reply.body);
    assert_eq!(reply.body["error"], "oauth_provider_disabled");

    // Тумблер способа входа (ACC-002).
    qubite_auth::platform::set(
        lab.db.pool(),
        None,
        qubite_auth::platform::LoginMethod::Telegram.key(),
        json!(true),
    )
    .await
    .unwrap();
    let list = Browser::default()
        .get(lab.address, "/api/auth/oauth/providers")
        .await;
    let telegram = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "telegram")
        .cloned()
        .unwrap();
    assert_eq!(telegram["kind"], "telegram_widget");
    assert_eq!(telegram["bot_name"], "qubite_test_bot");
    let reply = owner
        .post(lab.address, "/api/auth/oauth/telegram/link", link)
        .await;
    assert_eq!(reply.status, 204, "{:?}", reply.body);

    let mut phone = Browser::default();
    let fresh = telegram_data("4242", 5, BOT_TOKEN);
    let reply = phone
        .post(lab.address, "/api/auth/oauth/telegram/login", fresh.clone())
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["account"]["email"], common::EMAIL);
    assert!(phone.logged_in());

    for (bad, why) in [
        (fresh, "повтор тех же данных"),
        (telegram_data("4242", 3600, BOT_TOKEN), "данные час назад"),
        (
            telegram_data("4242", 0, "999:чужой-бот"),
            "подпись чужого бота",
        ),
    ] {
        let mut browser = Browser::default();
        let reply = browser
            .post(lab.address, "/api/auth/oauth/telegram/login", bad)
            .await;
        assert_eq!(reply.status, 400, "{why}: {:?}", reply.body);
        assert!(!browser.logged_in(), "{why}");
    }
    let mut forged = telegram_data("4242", 0, BOT_TOKEN);
    forged["id"] = json!("1");
    let reply = Browser::default()
        .post(lab.address, "/api/auth/oauth/telegram/login", forged)
        .await;
    assert_eq!(reply.status, 400);
    let unknown = Browser::default()
        .post(
            lab.address,
            "/api/auth/oauth/telegram/login",
            telegram_data("777", 0, BOT_TOKEN),
        )
        .await;
    assert_eq!(unknown.status, 401);
    assert_eq!(unknown.body["error"], "oauth_not_linked");
    lab.finish().await;
}

// ---------------------------------------------------------------- регистрация (D-189)

async fn set_toggle(lab: &Lab, key: &str, value: Value) {
    qubite_auth::platform::set(lab.db.pool(), None, key, value)
        .await
        .unwrap();
}

async fn accounts(lab: &Lab) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM accounts")
        .fetch_one(lab.db.pool())
        .await
        .unwrap()
}

async fn invite(lab: &Lab, body: Value) -> String {
    let mut owner = Browser::login(lab.address, common::EMAIL, common::PASSWORD).await;
    let reply = owner
        .post(lab.address, "/api/owner/invitations", body)
        .await;
    assert_eq!(reply.status, 201, "{:?}", reply.body);
    reply.body["code"].as_str().unwrap().to_owned()
}

#[tokio::test]
async fn open_registration_creates_account_through_provider() {
    let lab = Lab::new().await;
    set_toggle(&lab, "registration.mode", json!("open")).await;

    // Без галочки «Принимаю условия» (вход со страницы входа) аккаунт не создаётся.
    let mut hasty = Browser::default();
    let url = begin_login(&lab, &mut hasty, "yandex", "return_to=/today").await;
    let reply = come_back(
        &lab,
        &mut hasty,
        "yandex",
        &url,
        yandex_person("555", "Newcomer@Yandex.ru"),
    )
    .await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=consent_required&provider=yandex")
    );
    assert!(!hasty.logged_in());
    assert_eq!(accounts(&lab).await, 1);

    let mut newcomer = Browser::default();
    let url = start_login(&lab, &mut newcomer, "yandex", "/today").await;
    let reply = come_back(
        &lab,
        &mut newcomer,
        "yandex",
        &url,
        yandex_person("555", "Newcomer@Yandex.ru"),
    )
    .await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/today"),
        "{:?}",
        reply.body
    );
    assert!(newcomer.logged_in(), "аккаунт создан и вход выполнен сразу");
    let me = newcomer.get(lab.address, "/api/auth/me").await;
    assert_eq!(me.body["email"], "newcomer@yandex.ru");
    assert_eq!(me.body["is_owner"], false);
    assert_eq!(accounts(&lab).await, 2);
    // Модулей новичок не получил (D-054); пароля у аккаунта нет.
    let grants: i64 = sqlx::query_scalar("SELECT count(*) FROM module_grants")
        .fetch_one(lab.db.pool())
        .await
        .unwrap();
    assert_eq!(grants, 0);
    // Согласие записано со способом входа (D-230).
    let methods: Vec<String> = sqlx::query_scalar("SELECT DISTINCT method FROM account_consents")
        .fetch_all(lab.db.pool())
        .await
        .unwrap();
    assert_eq!(methods, ["yandex"]);
    let by_password = Browser::default()
        .post(
            lab.address,
            "/api/auth/login",
            json!({ "email": "newcomer@yandex.ru", "password": "любой пароль тут" }),
        )
        .await;
    assert_eq!(by_password.body["error"], "invalid_credentials");

    // Второй вход тем же Яндексом — тот же аккаунт, нового не появляется.
    let mut again = Browser::default();
    let url = start_login(&lab, &mut again, "yandex", "/").await;
    come_back(
        &lab,
        &mut again,
        "yandex",
        &url,
        yandex_person("555", "other@yandex.ru"),
    )
    .await;
    assert!(again.logged_in());
    assert_eq!(
        again.get(lab.address, "/api/auth/me").await.body["id"],
        me.body["id"]
    );
    assert_eq!(accounts(&lab).await, 2);

    // Почта уже занята — аккаунты не объединяются (D-060).
    let mut stranger = Browser::default();
    let url = start_login(&lab, &mut stranger, "yandex", "/").await;
    let taken = come_back(
        &lab,
        &mut stranger,
        "yandex",
        &url,
        yandex_person("777", common::EMAIL),
    )
    .await;
    assert_eq!(
        taken.location.as_deref(),
        Some("/auth?error=oauth_email_taken&provider=yandex")
    );
    assert!(!stranger.logged_in());

    // VK без почты — регистрироваться нечем.
    let mut no_email = Browser::default();
    let url = start_login(&lab, &mut no_email, "vk", "/").await;
    let reply = come_back(&lab, &mut no_email, "vk", &url, json!({ "user_id": 31 })).await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=oauth_email_required&provider=vk")
    );
    assert_eq!(accounts(&lab).await, 2);

    // «Вход выключен» действует и на вход через провайдера.
    set_toggle(&lab, "login.enabled", json!(false)).await;
    let mut late = Browser::default();
    let url = start_login(&lab, &mut late, "yandex", "/").await;
    let reply = come_back(
        &lab,
        &mut late,
        "yandex",
        &url,
        yandex_person("555", "x@y.ru"),
    )
    .await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=login_disabled&provider=yandex")
    );
    assert!(!late.logged_in());

    // Регистрация закрыта — неизвестный ID снова просто «не привязан».
    set_toggle(&lab, "login.enabled", json!(true)).await;
    set_toggle(&lab, "registration.mode", json!("closed")).await;
    let mut closed = Browser::default();
    let url = start_login(&lab, &mut closed, "yandex", "/").await;
    let reply = come_back(
        &lab,
        &mut closed,
        "yandex",
        &url,
        yandex_person("888", "c@y.ru"),
    )
    .await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=oauth_not_linked&provider=yandex")
    );
    assert_eq!(accounts(&lab).await, 2);
    lab.finish().await;
}

#[tokio::test]
async fn invite_only_registration_through_provider_needs_an_invite() {
    let lab = Lab::new().await;
    // По умолчанию — по приглашениям: без приглашения — «не привязан».
    let mut guest = Browser::default();
    let url = start_login(&lab, &mut guest, "yandex", "/").await;
    let reply = come_back(
        &lab,
        &mut guest,
        "yandex",
        &url,
        yandex_person("1", "g@y.ru"),
    )
    .await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=oauth_not_linked&provider=yandex")
    );

    let code = invite(&lab, json!({})).await;
    let mut guest = Browser::default();
    let url = start_login(&lab, &mut guest, "yandex", &format!("/today&invite={code}")).await;
    let reply = come_back(
        &lab,
        &mut guest,
        "yandex",
        &url,
        yandex_person("1", "g@y.ru"),
    )
    .await;
    assert_eq!(reply.location.as_deref(), Some("/today"));
    assert!(guest.logged_in());
    let status: String = sqlx::query_scalar(
        "SELECT CASE WHEN used_at IS NULL THEN 'active' ELSE 'used' END FROM invitations",
    )
    .fetch_one(lab.db.pool())
    .await
    .unwrap();
    assert_eq!(status, "used");

    // То же приглашение второй раз не работает.
    let mut second = Browser::default();
    let url = start_login(&lab, &mut second, "yandex", &format!("/&invite={code}")).await;
    let reply = come_back(
        &lab,
        &mut second,
        "yandex",
        &url,
        yandex_person("2", "h@y.ru"),
    )
    .await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=invalid_invite&provider=yandex")
    );

    // Приглашение на почту подходит только для неё.
    let bound = invite(&lab, json!({ "email": "friend@y.ru" })).await;
    let mut other = Browser::default();
    let url = start_login(&lab, &mut other, "yandex", &format!("/&invite={bound}")).await;
    let reply = come_back(
        &lab,
        &mut other,
        "yandex",
        &url,
        yandex_person("3", "not-friend@y.ru"),
    )
    .await;
    assert_eq!(
        reply.location.as_deref(),
        Some("/auth?error=invalid_invite&provider=yandex")
    );
    let mut friend = Browser::default();
    let url = start_login(&lab, &mut friend, "yandex", &format!("/&invite={bound}")).await;
    come_back(
        &lab,
        &mut friend,
        "yandex",
        &url,
        yandex_person("4", "Friend@Y.ru"),
    )
    .await;
    assert!(friend.logged_in());
    assert_eq!(accounts(&lab).await, 3);
    lab.finish().await;
}
