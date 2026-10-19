//! CAPTCHA на входе после нескольких неудач (ответ владельца на Q-20, D-189):
//! настоящий HTTP-сервер и поддельный Turnstile.

mod common;

use std::{
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{Json, Router, extract::State, routing::post};
use common::{Browser, EMAIL, PASSWORD, setup};
use qubite_auth::platform::{self, Overrides};
use qubite_captcha::{Captcha, CaptchaConfig, Keys};
use qubite_server::auth::AuthSettings;
use reqwest::Method;
use serde_json::{Value, json};

/// Поддельный Turnstile: «human» — человек. Считает обращения.
async fn fake_turnstile() -> (String, Arc<AtomicUsize>) {
    let calls = Arc::new(AtomicUsize::new(0));
    let app = Router::new()
        .route(
            "/verify",
            post(
                |State(calls): State<Arc<AtomicUsize>>, Json(body): Json<Value>| async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Json(json!({ "success": body["response"] == "human" }))
                },
            ),
        )
        .with_state(calls.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}/verify"), calls)
}

fn settings(url: &str, overrides: Overrides) -> AuthSettings {
    AuthSettings {
        captcha: Captcha::new(CaptchaConfig {
            turnstile: Keys::from_parts(Some("site-key".into()), Some("secret".into())),
            turnstile_url: url.into(),
            timeout: Duration::from_secs(3),
            ..CaptchaConfig::default()
        }),
        overrides,
        ..AuthSettings::default()
    }
}

async fn login(address: SocketAddr, password: &str, captcha: Option<&str>) -> common::Reply {
    let mut body = json!({ "email": EMAIL, "password": password });
    if let Some(token) = captcha {
        body["captcha_token"] = json!(token);
    }
    Browser::default()
        .send(address, Method::POST, "/api/auth/login", Some(body), false)
        .await
}

#[tokio::test]
async fn captcha_is_asked_after_three_failures() {
    let (url, calls) = fake_turnstile().await;
    let (test_db, db, address) = setup(settings(&url, Overrides::default())).await;

    // Виджет для входа виден в состоянии платформы.
    let status = Browser::default()
        .get(address, "/api/platform/status")
        .await;
    assert_eq!(
        status.body["login_captcha"],
        json!({ "provider": "turnstile", "site_key": "site-key" })
    );

    // Первые три ошибки — как обычно, без CAPTCHA.
    for _ in 0..3 {
        let reply = login(address, "не тот пароль", None).await;
        assert_eq!(reply.body["error"], "invalid_credentials");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 0);

    // Дальше без CAPTCHA пароль даже не проверяется — и верный тоже.
    let without = login(address, PASSWORD, None).await;
    assert_eq!(without.status, 401);
    assert_eq!(without.body["error"], "captcha_required");
    let bot = login(address, PASSWORD, Some("bot")).await;
    assert_eq!(bot.status, 400);
    assert_eq!(bot.body["error"], "captcha_failed");
    let human = login(address, PASSWORD, Some("human")).await;
    assert_eq!(human.status, 200, "{:?}", human.body);
    assert_eq!(calls.load(Ordering::SeqCst), 2);

    // Удачный вход обнуляет счётчик — снова без CAPTCHA.
    assert_eq!(login(address, PASSWORD, None).await.status, 200);

    // Неизвестная почта после трёх ошибок — тот же ответ: по CAPTCHA нельзя
    // узнать, есть ли аккаунт.
    for _ in 0..3 {
        Browser::default()
            .login(address, "nobody@qubite.ru", "что угодно тут")
            .await;
    }
    let nobody = Browser::default()
        .login(address, "nobody@qubite.ru", "что угодно тут")
        .await;
    assert_eq!(nobody.body["error"], "captcha_required");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn with_captcha_a_stranger_can_not_lock_the_owner_out() {
    let (url, _) = fake_turnstile().await;
    let (test_db, db, address) = setup(settings(&url, Overrides::default())).await;

    // Чужой человек десять раз вводит неверный пароль owner (решая CAPTCHA).
    for attempt in 0..10 {
        let reply = login(address, "чужая догадка", Some("human")).await;
        assert_eq!(
            reply.body["error"], "invalid_credentials",
            "попытка {attempt}"
        );
    }
    // Owner всё равно входит (раньше вход по почте закрывался на 15 минут после 5).
    let owner = login(address, PASSWORD, Some("human")).await;
    assert_eq!(owner.status, 200, "{:?}", owner.body);

    // Но и с CAPTCHA перебор не бесконечен: после 20 неудач — 429.
    for _ in 0..20 {
        login(address, "чужая догадка", Some("human")).await;
    }
    let stopped = login(address, PASSWORD, Some("human")).await;
    assert_eq!(stopped.status, 429);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn captcha_off_keeps_the_old_hard_limit() {
    // Owner выключил CAPTCHA тумблером: как раньше, 5 неудач — 429.
    let (url, calls) = fake_turnstile().await;
    let (test_db, db, address) = setup(settings(&url, Overrides::default())).await;
    platform::set(db.pool(), None, platform::CAPTCHA_PROVIDER, json!("off"))
        .await
        .unwrap();
    assert_eq!(
        Browser::default()
            .get(address, "/api/platform/status")
            .await
            .body["login_captcha"],
        Value::Null
    );
    for _ in 0..5 {
        assert_eq!(
            login(address, "не тот пароль", None).await.body["error"],
            "invalid_credentials"
        );
    }
    assert_eq!(login(address, PASSWORD, None).await.status, 429);
    db.close().await;
    test_db.drop_db().await;

    // QUBITE_CAPTCHA_DISABLED=true — то же самое.
    let (test_db, db, address) = setup(settings(
        &url,
        Overrides {
            captcha_disabled: true,
            ..Overrides::default()
        },
    ))
    .await;
    for _ in 0..5 {
        login(address, "не тот пароль", None).await;
    }
    assert_eq!(login(address, PASSWORD, Some("human")).await.status, 429);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn captcha_outage_does_not_open_the_door() {
    let (test_db, db, address) =
        setup(settings("http://127.0.0.1:1/verify", Overrides::default())).await;
    for _ in 0..3 {
        login(address, "не тот пароль", None).await;
    }
    let reply = login(address, PASSWORD, Some("human")).await;
    assert_eq!(reply.status, 503);
    assert_eq!(reply.body["error"], "captcha_unavailable");
    db.close().await;
    test_db.drop_db().await;
}
