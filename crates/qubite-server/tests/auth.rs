//! Вход, сессии, CSRF и лимиты перебора через настоящий HTTP-сервер.

mod common;

use std::time::Duration;

use common::{Browser, EMAIL, PASSWORD, logged_in, setup};
use qubite_auth::{AuthConfig, Limit, Passwords};
use qubite_server::auth::AuthSettings;
use reqwest::{Method, StatusCode};
use uuid::Uuid;

#[tokio::test]
async fn login_sets_protected_cookies_and_me_works() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = Browser::default();

    let reply = browser
        .login(address, "  KIRILL@qubite.ru ", PASSWORD)
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["account"]["email"], EMAIL);
    assert_eq!(reply.body["account"]["is_owner"], true);
    assert_eq!(reply.headers["cache-control"], "no-store");
    let cookies = reply.set_cookies();
    let session = cookies
        .iter()
        .find(|c| c.starts_with("qubite_session="))
        .unwrap();
    let csrf = cookies
        .iter()
        .find(|c| c.starts_with("qubite_csrf="))
        .unwrap();
    for flag in [
        "HttpOnly",
        "Secure",
        "SameSite=Lax",
        "Path=/",
        "Max-Age=2592000",
    ] {
        assert!(session.contains(flag), "{session} без {flag}");
    }
    assert!(!csrf.contains("HttpOnly"), "CSRF-cookie должен читать сайт");
    assert_eq!(reply.body["csrf_token"].as_str(), browser.csrf.as_deref());

    let me = browser.get(address, "/api/auth/me").await;
    assert_eq!(me.status, 200);
    assert_eq!(me.body["display_name"], "Кирилл");
    assert_eq!(me.body["session_id"], reply.body["account"]["session_id"]);

    // В базе нет ни токена, ни пароля в открытом виде.
    let token = browser.session.clone().unwrap();
    let stored: Vec<u8> = sqlx::query_scalar("SELECT token_hash FROM sessions")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_ne!(stored, token.as_bytes());

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn wrong_password_and_unknown_email_look_the_same() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;

    let wrong = Browser::default()
        .login(address, EMAIL, "неправильный пароль")
        .await;
    let unknown = Browser::default()
        .login(address, "nobody@qubite.ru", PASSWORD)
        .await;
    assert_eq!(wrong.status, 401);
    assert_eq!(unknown.status, 401);
    assert_eq!(wrong.body, unknown.body);
    assert_eq!(wrong.body["error"], "invalid_credentials");
    assert!(wrong.set_cookies().is_empty());

    let anonymous = Browser::default().get(address, "/api/auth/me").await;
    assert_eq!(anonymous.status, 401);
    assert_eq!(anonymous.body["error"], "unauthenticated");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn revoked_session_stops_working() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut phone = logged_in(address).await;
    let mut laptop = logged_in(address).await;

    // Список сессий: две, текущая отмечена, токенов в ответе нет.
    let list = laptop.get(address, "/api/auth/sessions").await;
    assert_eq!(list.status, 200);
    let items = list.body.as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items.iter().filter(|s| s["current"] == true).count(), 1);
    assert!(
        !list
            .body
            .to_string()
            .contains(phone.session.as_deref().unwrap())
    );
    let phone_id = phone.get(address, "/api/auth/me").await.body["session_id"]
        .as_str()
        .unwrap()
        .to_owned();

    // С ноутбука закрываем сессию телефона — телефон сразу теряет доступ.
    let revoke = laptop
        .delete(address, &format!("/api/auth/sessions/{phone_id}"))
        .await;
    assert_eq!(revoke.status, 204);
    let stale_cookie = phone.session.clone();
    let after = phone.get(address, "/api/auth/me").await;
    assert_eq!(after.status, 401);
    assert!(phone.session.is_none(), "мёртвую cookie сервер стирает");
    assert_eq!(laptop.get(address, "/api/auth/me").await.status, 200);

    // Старую cookie нельзя «оживить» — повторная отправка тоже 401.
    phone.session = stale_cookie;
    assert_eq!(phone.get(address, "/api/auth/me").await.status, 401);

    // Чужую или уже закрытую сессию закрыть нельзя.
    let again = laptop
        .delete(address, &format!("/api/auth/sessions/{phone_id}"))
        .await;
    assert_eq!(again.status, 404);
    let random = laptop
        .delete(address, &format!("/api/auth/sessions/{}", Uuid::now_v7()))
        .await;
    assert_eq!(random.status, 404);

    // Выход закрывает текущую сессию.
    let logout = laptop.post(address, "/api/auth/logout").await;
    assert_eq!(logout.status, 204);
    assert!(laptop.session.is_none());
    let mut replay = Browser {
        session: Some("not-a-token".into()),
        csrf: None,
    };
    assert_eq!(replay.get(address, "/api/auth/me").await.status, 401);

    let audit: Vec<String> =
        sqlx::query_scalar("SELECT action FROM audit_log WHERE action LIKE 'auth.%' ORDER BY seq")
            .fetch_all(db.pool())
            .await
            .unwrap();
    assert_eq!(
        audit,
        [
            "auth.login",
            "auth.login",
            "auth.session_revoked",
            "auth.logout"
        ]
    );

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn logout_everywhere_revokes_all_sessions() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browsers = Vec::new();
    for _ in 0..3 {
        browsers.push(logged_in(address).await);
    }

    let reply = browsers[0]
        .post(address, "/api/auth/logout-everywhere")
        .await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["revoked"], 3);
    for browser in &mut browsers {
        assert_eq!(browser.get(address, "/api/auth/me").await.status, 401);
    }

    // Новый вход после этого работает.
    let mut fresh = logged_in(address).await;
    assert_eq!(fresh.get(address, "/api/auth/me").await.status, 200);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn changing_requests_need_csrf_token() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;

    let without = browser
        .send(address, Method::POST, "/api/auth/logout", None, false)
        .await;
    assert_eq!(without.status, 403);
    assert_eq!(without.body["error"], "csrf_failed");

    let real = browser.csrf.clone();
    browser.csrf = Some("forged-token".into());
    let forged = browser.post(address, "/api/auth/logout").await;
    assert_eq!(forged.status, 403);

    // Сессия жива — подделки ничего не сделали.
    browser.csrf = real;
    assert_eq!(browser.get(address, "/api/auth/me").await.status, 200);
    assert_eq!(browser.post(address, "/api/auth/logout").await.status, 204);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn brute_force_hits_the_limit() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;

    for attempt in 1..=5 {
        let reply = Browser::default()
            .login(address, EMAIL, "неправильный")
            .await;
        assert_eq!(reply.status, 401, "попытка {attempt}");
    }
    // Шестая — отказ без проверки пароля, даже если пароль верный.
    let blocked = Browser::default().login(address, EMAIL, PASSWORD).await;
    assert_eq!(blocked.status, 429);
    assert_eq!(blocked.body["error"], "too_many_attempts");
    let retry: u64 = blocked.headers["retry-after"]
        .to_str()
        .unwrap()
        .parse()
        .unwrap();
    assert!((1..=15 * 60).contains(&retry), "Retry-After = {retry}");
    assert!(blocked.set_cookies().is_empty());

    // Регистр почты не помогает обойти лимит.
    let upper = Browser::default()
        .login(address, "KIRILL@QUBITE.RU", PASSWORD)
        .await;
    assert_eq!(upper.status, 429);

    // Окно прошло — вход снова возможен, и удачный вход обнуляет счётчик.
    sqlx::query("UPDATE login_attempts SET at = at - interval '16 minutes'")
        .execute(db.pool())
        .await
        .unwrap();
    logged_in(address).await;
    for _ in 0..4 {
        Browser::default()
            .login(address, EMAIL, "неправильный")
            .await;
    }
    logged_in(address).await;

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn parallel_brute_force_does_not_bypass_the_limit() {
    let (test_db, db, address) = setup(AuthSettings {
        passwords: Passwords::new(4),
        ..AuthSettings::default()
    })
    .await;

    let tasks: Vec<_> = (0..20)
        .map(|i| {
            tokio::spawn(async move {
                Browser::default()
                    .login(address, EMAIL, &format!("неправильный {i}"))
                    .await
                    .status
            })
        })
        .collect();
    let mut checked = 0;
    let mut throttled = 0;
    for task in tasks {
        match task.await.unwrap() {
            StatusCode::UNAUTHORIZED => checked += 1,
            StatusCode::TOO_MANY_REQUESTS => throttled += 1,
            other => panic!("неожиданный ответ {other}"),
        }
    }
    assert_eq!(checked, 5, "пароль проверен ровно 5 раз");
    assert_eq!(throttled, 15);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn one_address_cannot_try_many_emails() {
    let (test_db, db, address) = setup(AuthSettings {
        config: AuthConfig {
            ip_limit: Limit {
                max_failures: 3,
                window: Duration::from_secs(15 * 60),
            },
            ..AuthConfig::default()
        },
        ..AuthSettings::default()
    })
    .await;

    for i in 0..3 {
        let reply = Browser::default()
            .login(address, &format!("guess{i}@qubite.ru"), PASSWORD)
            .await;
        assert_eq!(reply.status, 401);
    }
    let reply = Browser::default().login(address, EMAIL, PASSWORD).await;
    assert_eq!(reply.status, 429, "с этого адреса уже 3 неудачи");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn session_slides_forward_and_expires_when_unused() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;

    // Сессией не пользовались час, до конца срока — день.
    sqlx::query(
        "UPDATE sessions SET last_seen_at = now() - interval '1 hour', \
                expires_at = now() + interval '1 day'",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let reply = browser.get(address, "/api/auth/me").await;
    assert_eq!(reply.status, 200);
    let left: f64 =
        sqlx::query_scalar("SELECT extract(epoch FROM expires_at - now())::float8 FROM sessions")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert!(
        left > 29.9 * 86_400.0,
        "срок снова 30 дней, осталось {left} с"
    );
    let cookies = reply.set_cookies();
    assert_eq!(cookies.len(), 2, "cookie продлены: {cookies:?}");
    assert!(cookies.iter().all(|c| c.contains("Max-Age=259")));

    // Частые запросы базу не дёргают: следующий cookie не переставляет.
    assert!(
        browser
            .get(address, "/api/auth/me")
            .await
            .set_cookies()
            .is_empty()
    );

    // Истёкшая сессия не работает.
    sqlx::query("UPDATE sessions SET expires_at = now() - interval '1 second'")
        .execute(db.pool())
        .await
        .unwrap();
    assert_eq!(browser.get(address, "/api/auth/me").await.status, 401);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn blocked_account_loses_sessions_and_cannot_login() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;

    sqlx::query("UPDATE accounts SET status = 'blocked'")
        .execute(db.pool())
        .await
        .unwrap();
    assert_eq!(browser.get(address, "/api/auth/me").await.status, 401);
    let reply = Browser::default().login(address, EMAIL, PASSWORD).await;
    assert_eq!(reply.status, 403);
    assert_eq!(reply.body["error"], "account_blocked");
    // С неверным паролем — обычный ответ, без подсказки о блокировке.
    let wrong = Browser::default()
        .login(address, EMAIL, "неправильный")
        .await;
    assert_eq!(wrong.body["error"], "invalid_credentials");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn owner_password_change_revokes_sessions() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;

    let revoked =
        qubite_auth::owner::set_password(db.pool(), &Passwords::default(), "новый пароль owner")
            .await
            .unwrap();
    assert_eq!(revoked, 1);
    assert_eq!(browser.get(address, "/api/auth/me").await.status, 401);
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, PASSWORD)
            .await
            .status,
        401
    );
    let mut fresh = Browser::default();
    assert_eq!(
        fresh
            .login(address, EMAIL, "новый пароль owner")
            .await
            .status,
        200
    );

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn there_is_no_http_route_to_become_owner() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;

    let document = browser.get(address, "/api/openapi.json").await.body;
    let paths = document["paths"].as_object().unwrap();
    // Owner Console управляет модулями и грантами, но назначить owner нельзя:
    // ни один маршрут не трогает `platform_owner`.
    let owner_paths: Vec<&String> = paths.keys().filter(|p| p.contains("owner")).collect();
    let console = [
        "/api/owner/modules",
        // люди (ACC-003): создать обычного, заблокировать, закрыть сессии
        "/api/owner/accounts",
        "/api/owner/audit",
        "/api/owner/confirm",
        "/api/owner/server",
        "/api/owner/invitations",
        "/api/owner/platform",
        "/api/owner/maintenance",
        "/api/owner/notifications",
        "/api/owner/ai/",
        // работа агентов (HAR-002): GitHub Issues, ответы на вопросы
        "/api/owner/work",
    ];
    assert!(
        owner_paths
            .iter()
            .all(|path| console.iter().any(|prefix| path.starts_with(prefix))),
        "лишний маршрут owner: {owner_paths:?}"
    );
    for path in [
        "/api/owner",
        "/api/auth/owner",
        "/api/owner/create",
        "/api/owner/transfer",
    ] {
        assert_eq!(browser.post(address, path).await.status, 404, "{path}");
    }

    db.close().await;
    test_db.drop_db().await;
}
