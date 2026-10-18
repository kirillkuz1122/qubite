//! Тумблеры платформы (ACC-002) через настоящий HTTP-сервер: каждый тумблер
//! меняет поведение API, env-переключатели сильнее тумблеров, owner не
//! запирает сам себя, версии защищают от двух вкладок.

mod common;

use std::{net::SocketAddr, time::Duration};

use common::{Browser, EMAIL, PASSWORD, logged_in, setup};
use qubite_auth::{
    Passwords,
    accounts::{self, NewAccount},
    platform::{LoginMethod, Overrides},
};
use qubite_mail::{Mailer, MockOutbox};
use qubite_server::auth::AuthSettings;
use reqwest::Method;
use serde_json::{Value, json};

const USER: &str = "user@qubite.ru";
const USER_PASSWORD: &str = "пароль пользователя";

fn settings(overrides: Overrides) -> (AuthSettings, MockOutbox) {
    let (mailer, outbox) = Mailer::mock();
    (
        AuthSettings {
            mailer,
            overrides,
            ..AuthSettings::default()
        },
        outbox,
    )
}

async fn start(
    overrides: Overrides,
) -> (
    qubite_testkit::TestDb,
    qubite_db::Database,
    SocketAddr,
    MockOutbox,
) {
    let (settings, outbox) = settings(overrides);
    let (test_db, db, address) = setup(settings).await;
    accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: USER,
            display_name: "Пользователь",
            password: USER_PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    (test_db, db, address, outbox)
}

async fn user(address: SocketAddr) -> Browser {
    let mut browser = Browser::default();
    let reply = browser.login(address, USER, USER_PASSWORD).await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    browser
}

async fn status(address: SocketAddr) -> Value {
    let reply = Browser::default()
        .get(address, "/api/platform/status")
        .await;
    assert_eq!(reply.status, 200);
    reply.body
}

/// Owner сохраняет один тумблер с текущей версией.
async fn toggle(
    owner: &mut Browser,
    address: SocketAddr,
    key: &str,
    value: Value,
) -> common::Reply {
    let list = owner.get(address, "/api/owner/platform").await;
    let version = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["key"] == key)
        .unwrap_or_else(|| panic!("нет тумблера {key}"))["version"]
        .clone();
    owner
        .patch_json(
            address,
            "/api/owner/platform",
            json!({ "changes": [{ "key": key, "value": value, "version": version }] }),
        )
        .await
}

fn item<'a>(list: &'a Value, key: &str) -> &'a Value {
    list.as_array()
        .unwrap()
        .iter()
        .find(|item| item["key"] == key)
        .unwrap()
}

#[tokio::test]
async fn defaults_and_owner_console_list() {
    let (test_db, db, address, _) = start(Overrides::default()).await;
    let body = status(address).await;
    assert_eq!(body["maintenance"], false);
    assert_eq!(body["login_enabled"], true);
    assert_eq!(body["registration_mode"], "invite_only");
    assert_eq!(body["timezone"], "Asia/Yekaterinburg");
    assert_eq!(
        body["login_methods"],
        json!({ "password": true, "google": false, "yandex": true, "vk": true, "telegram": false })
    );

    let mut owner = logged_in(address).await;
    let list = owner.get(address, "/api/owner/platform").await;
    assert_eq!(list.status, 200);
    let keys: Vec<&str> = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["key"].as_str().unwrap())
        .collect();
    for key in [
        "registration.mode",
        "login.enabled",
        "maintenance.enabled",
        "maintenance.message",
        "login.methods.password",
        "login.methods.google",
        "login.methods.yandex",
        "login.methods.vk",
        "login.methods.telegram",
        "email.enabled",
        "captcha.provider",
        "platform.timezone",
    ] {
        assert!(keys.contains(&key), "нет {key}");
        assert_eq!(item(&list.body, key)["version"], 0);
        assert_eq!(item(&list.body, key)["locked_by_env"], false);
    }

    // Не owner — раздела нет.
    let mut someone = user(address).await;
    assert_eq!(
        someone.get(address, "/api/owner/platform").await.status,
        404
    );
    let attempt = someone
        .patch_json(
            address,
            "/api/owner/platform",
            json!({ "changes": [{ "key": "maintenance.enabled", "value": true, "version": 0 }] }),
        )
        .await;
    assert_eq!(attempt.status, 404);
    assert_eq!(status(address).await["maintenance"], false);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn registration_mode_toggle_and_env_lock() {
    let (test_db, db, address, _) = start(Overrides::default()).await;
    let mut owner = logged_in(address).await;
    let saved = toggle(&mut owner, address, "registration.mode", json!("closed")).await;
    assert_eq!(saved.status, 200, "{:?}", saved.body);
    assert_eq!(item(&saved.body, "registration.mode")["version"], 1);
    let info = Browser::default()
        .get(address, "/api/auth/registration")
        .await;
    assert_eq!(info.body["mode"], "closed");
    let reply = Browser::default()
        .send(
            address,
            Method::POST,
            "/api/auth/register",
            Some(json!({ "email": "new@qubite.ru", "password": USER_PASSWORD })),
            false,
        )
        .await;
    assert_eq!(reply.body["error"], "registration_closed");
    db.close().await;
    test_db.drop_db().await;

    // QUBITE_AUTH_REGISTRATION_ENABLED=false: тумблер «открыто» не помогает.
    let (test_db, db, address, _) = start(Overrides {
        registration: false,
        ..Overrides::default()
    })
    .await;
    let mut owner = logged_in(address).await;
    toggle(&mut owner, address, "registration.mode", json!("open")).await;
    let list = owner.get(address, "/api/owner/platform").await;
    assert_eq!(item(&list.body, "registration.mode")["locked_by_env"], true);
    assert_eq!(item(&list.body, "registration.mode")["value"], "open");
    assert_eq!(status(address).await["registration_mode"], "closed");
    let info = Browser::default()
        .get(address, "/api/auth/registration")
        .await;
    assert_eq!(info.body["mode"], "closed");
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn login_toggle_stops_new_logins_but_not_owner_or_open_sessions() {
    let (test_db, db, address, _) = start(Overrides::default()).await;
    let mut owner = logged_in(address).await;
    let mut already_in = user(address).await;

    let saved = toggle(&mut owner, address, "login.enabled", json!(false)).await;
    assert_eq!(saved.status, 200);
    assert_eq!(status(address).await["login_enabled"], false);

    let refused = Browser::default().login(address, USER, USER_PASSWORD).await;
    assert_eq!(refused.status, 403);
    assert_eq!(refused.body["error"], "login_disabled");
    // Неверный пароль — всё так же «неверная почта или пароль»: тумблер не
    // подсказывает, чья почта.
    let wrong = Browser::default()
        .login(address, USER, "не тот пароль")
        .await;
    assert_eq!(wrong.body["error"], "invalid_credentials");
    // Уже открытая сессия работает, owner входит.
    assert_eq!(already_in.get(address, "/api/auth/me").await.status, 200);
    // Но разрешить вход новому приложению (AUTH-006) из неё нельзя — это новый вход.
    let app = already_in
        .post_json(
            address,
            "/api/auth/device/authorize",
            json!({
                "client_id": "qubite-desktop",
                "redirect_uri": "qubite://auth/callback",
                "code_challenge": "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
                "code_challenge_method": "S256",
                "state": "xyz",
            }),
        )
        .await;
    assert_eq!(app.status, 403, "{:?}", app.body);
    assert_eq!(app.body["error"], "login_disabled");
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, PASSWORD)
            .await
            .status,
        200
    );

    toggle(&mut owner, address, "login.enabled", json!(true)).await;
    assert_eq!(
        Browser::default()
            .login(address, USER, USER_PASSWORD)
            .await
            .status,
        200
    );
    db.close().await;
    test_db.drop_db().await;

    // QUBITE_AUTH_LOGIN_ENABLED=false — сильнее тумблера.
    let (test_db, db, address, _) = start(Overrides {
        login: false,
        ..Overrides::default()
    })
    .await;
    let refused = Browser::default().login(address, USER, USER_PASSWORD).await;
    assert_eq!(refused.body["error"], "login_disabled");
    let mut owner = logged_in(address).await;
    let list = owner.get(address, "/api/owner/platform").await;
    assert_eq!(item(&list.body, "login.enabled")["locked_by_env"], true);
    assert_eq!(status(address).await["login_enabled"], false);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn maintenance_shows_message_to_everyone_but_owner() {
    let (test_db, db, address, _) = start(Overrides::default()).await;
    let mut owner = logged_in(address).await;
    let mut someone = user(address).await;

    let list = owner.get(address, "/api/owner/platform").await;
    let saved = owner
        .patch_json(
            address,
            "/api/owner/platform",
            json!({ "changes": [
                { "key": "maintenance.enabled", "value": true,
                  "version": item(&list.body, "maintenance.enabled")["version"] },
                { "key": "maintenance.message", "value": "Переезжаем на новый сервер до 10:00",
                  "version": item(&list.body, "maintenance.message")["version"] },
            ] }),
        )
        .await;
    assert_eq!(saved.status, 200, "{:?}", saved.body);

    let body = status(address).await;
    assert_eq!(body["maintenance"], true);
    assert_eq!(
        body["maintenance_message"],
        "Переезжаем на новый сервер до 10:00"
    );
    // Пользователь: любой адрес API — 503 с текстом owner.
    for path in ["/api/auth/me", "/api/modules", "/api/auth/sessions"] {
        let reply = someone.get(address, path).await;
        assert_eq!(reply.status, 503, "{path}");
        assert_eq!(reply.body["error"], "maintenance");
        assert_eq!(reply.body["message"], "Переезжаем на новый сервер до 10:00");
    }
    let anonymous = Browser::default()
        .get(address, "/api/auth/registration")
        .await;
    assert_eq!(anonymous.status, 503);
    let login = Browser::default().login(address, USER, USER_PASSWORD).await;
    assert_eq!(login.status, 503);
    assert_eq!(login.body["error"], "maintenance");
    // Выйти можно и во время техработ.
    assert_eq!(someone.post(address, "/api/auth/logout").await.status, 204);
    // Owner работает как обычно и может войти заново.
    assert_eq!(owner.get(address, "/api/modules").await.status, 200);
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, PASSWORD)
            .await
            .status,
        200
    );
    // Проверки сервера работают.
    assert_eq!(
        Browser::default().get(address, "/api/health").await.status,
        200
    );

    toggle(&mut owner, address, "maintenance.enabled", json!(false)).await;
    assert_eq!(
        user(address)
            .await
            .get(address, "/api/modules")
            .await
            .status,
        200
    );
    db.close().await;
    test_db.drop_db().await;

    // QUBITE_MAINTENANCE=true — техработы, даже если тумблер выключен.
    let (test_db, db, address, _) = start(Overrides {
        maintenance: true,
        ..Overrides::default()
    })
    .await;
    let body = status(address).await;
    assert_eq!(body["maintenance"], true);
    assert_eq!(
        body["maintenance_message"],
        "Qubite обновляется. Скоро вернёмся!"
    );
    assert_eq!(
        Browser::default()
            .login(address, USER, USER_PASSWORD)
            .await
            .status,
        503
    );
    let mut owner = logged_in(address).await;
    let list = owner.get(address, "/api/owner/platform").await;
    assert_eq!(
        item(&list.body, "maintenance.enabled")["locked_by_env"],
        true
    );
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn login_methods_toggles_and_owner_keeps_password() {
    let (test_db, db, address, _) = start(Overrides::default()).await;
    let mut owner = logged_in(address).await;

    for (method, value) in [("google", true), ("telegram", true), ("vk", false)] {
        let saved = toggle(
            &mut owner,
            address,
            &format!("login.methods.{method}"),
            json!(value),
        )
        .await;
        assert_eq!(saved.status, 200);
    }
    let body = status(address).await;
    assert_eq!(
        body["login_methods"],
        json!({ "password": true, "google": true, "yandex": true, "vk": false, "telegram": true })
    );

    toggle(&mut owner, address, "login.methods.password", json!(false)).await;
    assert_eq!(status(address).await["login_methods"]["password"], false);
    let refused = Browser::default().login(address, USER, USER_PASSWORD).await;
    assert_eq!(refused.status, 403);
    assert_eq!(refused.body["error"], "login_method_disabled");
    // Owner не запирает сам себя.
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, PASSWORD)
            .await
            .status,
        200
    );
    db.close().await;
    test_db.drop_db().await;

    // QUBITE_AUTH_VK_ENABLED=false и QUBITE_AUTH_PASSWORD_ENABLED=false.
    let mut methods = [true; 5];
    methods[LoginMethod::Vk as usize] = false;
    methods[LoginMethod::Password as usize] = false;
    let (test_db, db, address, _) = start(Overrides {
        methods,
        ..Overrides::default()
    })
    .await;
    let body = status(address).await;
    assert_eq!(body["login_methods"]["vk"], false);
    assert_eq!(body["login_methods"]["password"], false);
    assert_eq!(body["login_methods"]["yandex"], true);
    assert_eq!(
        Browser::default()
            .login(address, USER, USER_PASSWORD)
            .await
            .body["error"],
        "login_method_disabled"
    );
    let mut owner = logged_in(address).await;
    toggle(&mut owner, address, "login.methods.vk", json!(true)).await;
    assert_eq!(status(address).await["login_methods"]["vk"], false);
    let list = owner.get(address, "/api/owner/platform").await;
    assert_eq!(item(&list.body, "login.methods.vk")["locked_by_env"], true);
    assert_eq!(
        item(&list.body, "login.methods.yandex")["locked_by_env"],
        false
    );
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn email_toggle_stops_letters() {
    let (test_db, db, address, outbox) = start(Overrides::default()).await;
    let mut owner = logged_in(address).await;
    toggle(&mut owner, address, "email.enabled", json!(false)).await;

    // Ответ тот же, но письма нет.
    let forgot = Browser::default()
        .send(
            address,
            Method::POST,
            "/api/auth/password/forgot",
            Some(json!({ "email": USER })),
            false,
        )
        .await;
    assert_eq!(forgot.status, 202);
    // Приглашение на почту создаётся, но письмом не уходит.
    let invite = owner
        .post_json(
            address,
            "/api/owner/invitations",
            json!({ "email": "friend@qubite.ru" }),
        )
        .await;
    assert_eq!(invite.status, 201);
    assert_eq!(invite.body["emailed"], false);
    // Регистрация без почты невозможна: подтвердить её нечем.
    let register = Browser::default()
        .send(
            address,
            Method::POST,
            "/api/auth/register",
            Some(json!({
                "email": "friend@qubite.ru",
                "password": USER_PASSWORD,
                "invite": invite.body["code"],
            })),
            false,
        )
        .await;
    assert_eq!(register.status, 503);
    assert_eq!(register.body["error"], "email_disabled");
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(outbox.all().is_empty(), "{:?}", outbox.all());

    toggle(&mut owner, address, "email.enabled", json!(true)).await;
    let forgot = Browser::default()
        .send(
            address,
            Method::POST,
            "/api/auth/password/forgot",
            Some(json!({ "email": USER })),
            false,
        )
        .await;
    assert_eq!(forgot.status, 202);
    assert_eq!(
        outbox.wait_for(USER, 1, Duration::from_secs(3)).await.len(),
        1
    );
    db.close().await;
    test_db.drop_db().await;

    // QUBITE_EMAIL_ENABLED=false.
    let (test_db, db, address, outbox) = start(Overrides {
        email: false,
        ..Overrides::default()
    })
    .await;
    Browser::default()
        .send(
            address,
            Method::POST,
            "/api/auth/password/forgot",
            Some(json!({ "email": USER })),
            false,
        )
        .await;
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(outbox.all().is_empty());
    let mut owner = logged_in(address).await;
    let list = owner.get(address, "/api/owner/platform").await;
    assert_eq!(item(&list.body, "email.enabled")["locked_by_env"], true);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn captcha_toggle_and_env_lock() {
    let (test_db, db, address, _) = start(Overrides::default()).await;
    let mut owner = logged_in(address).await;
    toggle(&mut owner, address, "registration.mode", json!("open")).await;
    let info = Browser::default()
        .get(address, "/api/auth/registration")
        .await;
    assert_eq!(info.body["captcha"]["provider"], "turnstile");
    toggle(
        &mut owner,
        address,
        "captcha.provider",
        json!("smartcaptcha"),
    )
    .await;
    let info = Browser::default()
        .get(address, "/api/auth/registration")
        .await;
    assert_eq!(info.body["captcha"]["provider"], "smartcaptcha");
    toggle(&mut owner, address, "captcha.provider", json!("off")).await;
    let info = Browser::default()
        .get(address, "/api/auth/registration")
        .await;
    assert_eq!(info.body["captcha"], Value::Null);
    let bad = toggle(&mut owner, address, "captcha.provider", json!("recaptcha")).await;
    assert_eq!(bad.status, 400);
    db.close().await;
    test_db.drop_db().await;

    let (test_db, db, address, _) = start(Overrides {
        captcha_disabled: true,
        ..Overrides::default()
    })
    .await;
    let mut owner = logged_in(address).await;
    toggle(&mut owner, address, "registration.mode", json!("open")).await;
    let info = Browser::default()
        .get(address, "/api/auth/registration")
        .await;
    assert_eq!(info.body["captcha"], Value::Null);
    let list = owner.get(address, "/api/owner/platform").await;
    assert_eq!(item(&list.body, "captcha.provider")["locked_by_env"], true);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn timezone_is_checked_by_the_database() {
    let (test_db, db, address, _) = start(Overrides::default()).await;
    let mut owner = logged_in(address).await;
    let bad = toggle(
        &mut owner,
        address,
        "platform.timezone",
        json!("Mars/Olympus"),
    )
    .await;
    assert_eq!(bad.status, 400);
    let ok = toggle(
        &mut owner,
        address,
        "platform.timezone",
        json!("Europe/Moscow"),
    )
    .await;
    assert_eq!(ok.status, 200);
    assert_eq!(status(address).await["timezone"], "Europe/Moscow");
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn stale_version_from_another_tab_saves_nothing() {
    let (test_db, db, address, _) = start(Overrides::default()).await;
    let mut tab1 = logged_in(address).await;
    let mut tab2 = logged_in(address).await;
    let seen = tab1.get(address, "/api/owner/platform").await.body;

    // Вкладка 2 успела выключить вход.
    let first = tab2
        .patch_json(
            address,
            "/api/owner/platform",
            json!({ "changes": [{ "key": "login.enabled", "value": false, "version": 0 }] }),
        )
        .await;
    assert_eq!(first.status, 200);

    // Вкладка 1 со старыми версиями: две правки, одна устарела — не сохраняется ни одна.
    let stale = tab1
        .patch_json(
            address,
            "/api/owner/platform",
            json!({ "changes": [
                { "key": "maintenance.enabled", "value": true,
                  "version": item(&seen, "maintenance.enabled")["version"] },
                { "key": "login.enabled", "value": true,
                  "version": item(&seen, "login.enabled")["version"] },
            ] }),
        )
        .await;
    assert_eq!(stale.status, 409);
    assert_eq!(stale.body["error"], "conflict");
    let body = status(address).await;
    assert_eq!(body["maintenance"], false);
    assert_eq!(body["login_enabled"], false);

    // Неизвестный ключ и неверный тип — 400, ничего не меняется.
    for change in [
        json!({ "key": "rockets.enabled", "value": true, "version": 0 }),
        json!({ "key": "login.enabled", "value": "да", "version": 1 }),
    ] {
        let reply = tab1
            .patch_json(
                address,
                "/api/owner/platform",
                json!({ "changes": [change] }),
            )
            .await;
        assert_eq!(reply.status, 400, "{:?}", reply.body);
    }

    // Каждое изменение — в аудите, с тем, кто и что было.
    let audit: Vec<(Option<Value>, Option<Value>)> = sqlx::query_as(
        "SELECT before, after FROM audit_log WHERE action = 'platform.setting_changed' \
         AND target_id = 'login.enabled'",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    assert_eq!(audit, vec![(Some(json!(true)), Some(json!(false)))]);

    db.close().await;
    test_db.drop_db().await;
}
