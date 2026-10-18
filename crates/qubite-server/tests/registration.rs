//! Регистрация, приглашения и CAPTCHA (AUTH-003) через настоящий HTTP-сервер,
//! mock-почту и поддельные сервисы CAPTCHA.

mod common;

use std::{
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{Json, Router, body::Bytes, extract::State, routing::post};
use common::{Browser, EMAIL, PASSWORD, logged_in, setup};
use qubite_auth::{
    Passwords,
    accounts::{self, NewAccount},
    platform,
};
use qubite_captcha::{Captcha, CaptchaConfig, Keys};
use qubite_mail::{Mailer, MockOutbox};
use qubite_server::auth::AuthSettings;
use reqwest::Method;
use serde_json::{Value, json};

const GUEST: &str = "guest@qubite.ru";
const GUEST_PASSWORD: &str = "пароль гостя длинный";

/// Поддельные Turnstile и SmartCaptcha: «human» — человек, остальное — бот.
/// Считают обращения к каждому.
struct FakeCaptcha {
    url: String,
    turnstile_calls: Arc<AtomicUsize>,
    smart_calls: Arc<AtomicUsize>,
}

async fn fake_captcha() -> FakeCaptcha {
    let turnstile_calls = Arc::new(AtomicUsize::new(0));
    let smart_calls = Arc::new(AtomicUsize::new(0));
    let app = Router::new()
        .route(
            "/turnstile",
            post(
                |State(calls): State<Arc<AtomicUsize>>, Json(body): Json<Value>| async move {
                    calls.fetch_add(1, Ordering::SeqCst);
                    Json(json!({ "success": body["response"] == "human" }))
                },
            ),
        )
        .with_state(turnstile_calls.clone())
        .merge(
            Router::new()
                .route(
                    "/smart",
                    post(
                        |State(calls): State<Arc<AtomicUsize>>, body: Bytes| async move {
                            calls.fetch_add(1, Ordering::SeqCst);
                            let human = String::from_utf8_lossy(&body).contains("token=human");
                            Json(json!({ "status": if human { "ok" } else { "failed" } }))
                        },
                    ),
                )
                .with_state(smart_calls.clone()),
        );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    FakeCaptcha {
        url: format!("http://{address}"),
        turnstile_calls,
        smart_calls,
    }
}

fn keys(name: &str) -> Option<Keys> {
    Keys::from_parts(Some(format!("{name}-site")), Some(format!("{name}-secret")))
}

fn settings(captcha_url: &str, captcha_disabled: bool) -> (AuthSettings, MockOutbox) {
    let (mailer, outbox) = Mailer::mock();
    let mut settings = AuthSettings {
        mailer,
        captcha: Captcha::new(CaptchaConfig {
            turnstile: keys("turnstile"),
            smartcaptcha: keys("smart"),
            turnstile_url: format!("{captcha_url}/turnstile"),
            smartcaptcha_url: format!("{captcha_url}/smart"),
            timeout: Duration::from_secs(3),
        }),
        captcha_disabled,
        ..AuthSettings::default()
    };
    settings.config.email.auth_url = "https://auth.qubiteapp.ru".into();
    (settings, outbox)
}

async fn anon(
    address: SocketAddr,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> common::Reply {
    Browser::default()
        .send(address, method, path, body, false)
        .await
}

async fn register(address: SocketAddr, body: Value) -> common::Reply {
    anon(address, Method::POST, "/api/auth/register", Some(body)).await
}

async fn invite(owner: &mut Browser, address: SocketAddr, body: Value) -> String {
    let reply = owner
        .post_json(address, "/api/owner/invitations", body)
        .await;
    assert_eq!(reply.status, 201, "{:?}", reply.body);
    reply.body["code"].as_str().unwrap().to_owned()
}

async fn accounts_count(db: &qubite_db::Database) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM accounts")
        .fetch_one(db.pool())
        .await
        .unwrap()
}

/// Код из письма.
fn code_in(text: &str) -> String {
    text.split("Или введите код: ")
        .nth(1)
        .unwrap()
        .chars()
        .take_while(|c| !c.is_whitespace())
        .collect()
}

#[tokio::test]
async fn default_mode_is_invite_only() {
    let fake = fake_captcha().await;
    let (settings, _) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;

    let info = anon(address, Method::GET, "/api/auth/registration", None).await;
    assert_eq!(info.status, 200);
    assert_eq!(info.body["mode"], "invite_only");
    assert_eq!(info.body["invite_required"], true);
    assert_eq!(info.body["captcha"], Value::Null);

    let no_invite = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD }),
    )
    .await;
    assert_eq!(no_invite.status, 400);
    assert_eq!(no_invite.body["error"], "invite_required");
    let made_up = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD, "invite": "AAAA-BBBB-CCCC" }),
    )
    .await;
    assert_eq!(made_up.body["error"], "invalid_invite");
    assert_eq!(accounts_count(&db).await, 1);
    assert_eq!(fake.turnstile_calls.load(Ordering::SeqCst), 0);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn open_link_invite_then_email_confirmation_then_login() {
    let fake = fake_captcha().await;
    let (settings, outbox) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;
    let mut owner = logged_in(address).await;

    let created = owner
        .post_json(
            address,
            "/api/owner/invitations",
            json!({ "note": "для друга" }),
        )
        .await;
    assert_eq!(created.status, 201);
    let code = created.body["code"].as_str().unwrap().to_owned();
    assert_eq!(code.len(), 14, "{code}");
    assert_eq!(created.body["emailed"], false);
    let link = created.body["link"].as_str().unwrap();
    assert_eq!(
        link,
        format!(
            "https://auth.qubiteapp.ru/register?invite={}",
            code.replace('-', "")
        )
    );

    // Код можно ввести как угодно: маленькими буквами, без дефисов.
    let reply = register(
        address,
        json!({
            "email": GUEST,
            "password": GUEST_PASSWORD,
            "display_name": "Гость",
            "invite": code.replace('-', "").to_lowercase(),
        }),
    )
    .await;
    assert_eq!(reply.status, 202, "{:?}", reply.body);

    // Войти до подтверждения почты нельзя (D-058).
    let early = Browser::default()
        .login(address, GUEST, GUEST_PASSWORD)
        .await;
    assert_eq!(early.body["error"], "email_not_verified");
    let mail = outbox.wait_for(GUEST, 1, Duration::from_secs(3)).await;
    assert_eq!(mail.len(), 1);
    assert!(mail[0].text.starts_with("Привет, Гость!"));
    let verified = anon(
        address,
        Method::POST,
        "/api/auth/email/verify",
        Some(json!({ "email": GUEST, "code": code_in(&mail[0].text) })),
    )
    .await;
    assert_eq!(verified.status, 204);
    let login = Browser::default()
        .login(address, GUEST, GUEST_PASSWORD)
        .await;
    assert_eq!(login.status, 200);

    // Новый пользователь не получил ни одного модуля (D-054, D-172).
    let grants: i64 = sqlx::query_scalar("SELECT count(*) FROM module_grants")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(grants, 0);

    // Приглашение одноразовое и видно в списке как использованное.
    let again = register(
        address,
        json!({ "email": "other@qubite.ru", "password": GUEST_PASSWORD, "invite": code }),
    )
    .await;
    assert_eq!(again.body["error"], "invalid_invite");
    let list = owner.get(address, "/api/owner/invitations").await;
    assert_eq!(list.body[0]["status"], "used");
    assert_eq!(list.body[0]["used_by_email"], GUEST);
    assert_eq!(list.body[0]["note"], "для друга");
    assert!(!list.body.to_string().contains(&code.replace('-', "")));
    let id = list.body[0]["id"].as_str().unwrap();
    let revoke_used = owner
        .delete(address, &format!("/api/owner/invitations/{id}"))
        .await;
    assert_eq!(revoke_used.status, 404);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn two_registrations_race_for_one_invite_and_only_one_wins() {
    let fake = fake_captcha().await;
    let (settings, _) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;
    let mut owner = logged_in(address).await;
    let code = invite(&mut owner, address, json!({})).await;

    let mut tasks = Vec::new();
    for i in 0..10 {
        let code = code.clone();
        tasks.push(tokio::spawn(async move {
            register(
                address,
                json!({
                    "email": format!("racer{i}@qubite.ru"),
                    "password": GUEST_PASSWORD,
                    "invite": code,
                }),
            )
            .await
        }));
    }
    let mut won = 0;
    for task in tasks {
        let reply = task.await.unwrap();
        if reply.status == 202 {
            won += 1;
        } else {
            assert_eq!(reply.body["error"], "invalid_invite");
        }
    }
    assert_eq!(won, 1);
    assert_eq!(accounts_count(&db).await, 2);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn email_bound_invite_is_mailed_and_only_for_that_email() {
    let fake = fake_captcha().await;
    let (settings, outbox) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;
    let mut owner = logged_in(address).await;

    for days in [0, 31] {
        let bad = owner
            .post_json(
                address,
                "/api/owner/invitations",
                json!({ "email": GUEST, "days": days }),
            )
            .await;
        assert_eq!(bad.status, 400);
    }
    let created = owner
        .post_json(
            address,
            "/api/owner/invitations",
            json!({ "email": "Guest@Qubite.ru", "days": 3 }),
        )
        .await;
    assert_eq!(created.status, 201);
    assert_eq!(created.body["emailed"], true);
    let code = created.body["code"].as_str().unwrap();
    let mail = outbox.wait_for(GUEST, 1, Duration::from_secs(3)).await;
    assert_eq!(mail[0].subject, "Приглашение в Qubite");
    assert!(mail[0].text.contains("Кирилл приглашает"));
    assert!(mail[0].text.contains(code));
    assert!(mail[0].text.contains("3 дня"));

    let stranger = register(
        address,
        json!({ "email": "stranger@qubite.ru", "password": GUEST_PASSWORD, "invite": code }),
    )
    .await;
    assert_eq!(stranger.body["error"], "invalid_invite");
    let guest = register(
        address,
        json!({ "email": "GUEST@qubite.ru", "password": GUEST_PASSWORD, "invite": code }),
    )
    .await;
    assert_eq!(guest.status, 202);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn revoked_and_expired_invites_do_not_work() {
    let fake = fake_captcha().await;
    let (settings, _) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;
    let mut owner = logged_in(address).await;

    let revoked = invite(&mut owner, address, json!({ "note": "отзову" })).await;
    let expired = invite(&mut owner, address, json!({ "note": "истечёт" })).await;
    let list = owner.get(address, "/api/owner/invitations").await;
    let id_of = |note: &str| {
        list.body
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["note"] == note)
            .unwrap()["id"]
            .as_str()
            .unwrap()
            .to_owned()
    };
    let revoke = owner
        .delete(
            address,
            &format!("/api/owner/invitations/{}", id_of("отзову")),
        )
        .await;
    assert_eq!(revoke.status, 204);
    sqlx::query(
        "UPDATE invitations SET expires_at = now() - interval '1 second' WHERE note = 'истечёт'",
    )
    .execute(db.pool())
    .await
    .unwrap();

    for code in [&revoked, &expired] {
        let reply = register(
            address,
            json!({ "email": GUEST, "password": GUEST_PASSWORD, "invite": code }),
        )
        .await;
        assert_eq!(reply.body["error"], "invalid_invite");
    }
    let list = owner.get(address, "/api/owner/invitations").await;
    let statuses: Vec<&str> = list
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["status"].as_str().unwrap())
        .collect();
    assert!(statuses.contains(&"revoked") && statuses.contains(&"expired"));
    assert_eq!(accounts_count(&db).await, 1);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn closed_registration_rejects_even_a_valid_invite() {
    let fake = fake_captcha().await;
    let (settings, _) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;
    let mut owner = logged_in(address).await;
    let code = invite(&mut owner, address, json!({})).await;

    platform::set(
        db.pool(),
        None,
        platform::REGISTRATION_MODE,
        json!("closed"),
    )
    .await
    .unwrap();
    let info = anon(address, Method::GET, "/api/auth/registration", None).await;
    assert_eq!(info.body["mode"], "closed");
    let reply = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD, "invite": code }),
    )
    .await;
    assert_eq!(reply.status, 403);
    assert_eq!(reply.body["error"], "registration_closed");
    let list = owner.get(address, "/api/owner/invitations").await;
    assert_eq!(list.body[0]["status"], "active");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn open_registration_needs_captcha_from_the_chosen_provider() {
    let fake = fake_captcha().await;
    let (settings, _) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;
    platform::set(db.pool(), None, platform::REGISTRATION_MODE, json!("open"))
        .await
        .unwrap();

    let info = anon(address, Method::GET, "/api/auth/registration", None).await;
    assert_eq!(info.body["mode"], "open");
    assert_eq!(info.body["invite_required"], false);
    assert_eq!(info.body["captcha"]["provider"], "turnstile");
    assert_eq!(info.body["captcha"]["site_key"], "turnstile-site");

    let without = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD }),
    )
    .await;
    assert_eq!(without.body["error"], "captcha_failed");
    let bot = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD, "captcha_token": "bot" }),
    )
    .await;
    assert_eq!(bot.status, 400);
    assert_eq!(bot.body["error"], "captcha_failed");
    assert_eq!(accounts_count(&db).await, 1);
    let human = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD, "captcha_token": "human" }),
    )
    .await;
    assert_eq!(human.status, 202, "{:?}", human.body);
    assert_eq!(fake.turnstile_calls.load(Ordering::SeqCst), 2);

    // Owner выбрал Яндекс — проверяет SmartCaptcha.
    platform::set(
        db.pool(),
        None,
        platform::CAPTCHA_PROVIDER,
        json!("smartcaptcha"),
    )
    .await
    .unwrap();
    let info = anon(address, Method::GET, "/api/auth/registration", None).await;
    assert_eq!(info.body["captcha"]["provider"], "smartcaptcha");
    assert_eq!(info.body["captcha"]["site_key"], "smart-site");
    let smart = register(
        address,
        json!({ "email": "two@qubite.ru", "password": GUEST_PASSWORD, "captcha_token": "human" }),
    )
    .await;
    assert_eq!(smart.status, 202);
    assert_eq!(fake.smart_calls.load(Ordering::SeqCst), 1);
    assert_eq!(fake.turnstile_calls.load(Ordering::SeqCst), 2);

    // С приглашением CAPTCHA не нужна.
    let mut owner = logged_in(address).await;
    let code = invite(&mut owner, address, json!({})).await;
    let invited = register(
        address,
        json!({ "email": "three@qubite.ru", "password": GUEST_PASSWORD, "invite": code }),
    )
    .await;
    assert_eq!(invited.status, 202);
    assert_eq!(fake.smart_calls.load(Ordering::SeqCst), 1);

    // Owner выключил CAPTCHA тумблером.
    platform::set(db.pool(), None, platform::CAPTCHA_PROVIDER, json!("off"))
        .await
        .unwrap();
    let info = anon(address, Method::GET, "/api/auth/registration", None).await;
    assert_eq!(info.body["captcha"], Value::Null);
    let free = register(
        address,
        json!({ "email": "four@qubite.ru", "password": GUEST_PASSWORD }),
    )
    .await;
    assert_eq!(free.status, 202);
    assert_eq!(accounts_count(&db).await, 5);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn captcha_outage_blocks_and_env_switch_disables_captcha() {
    // Сервис CAPTCHA не отвечает — регистрацию не пускаем.
    let (settings_down, _) = settings("http://127.0.0.1:1", false);
    let (test_db, db, address) = setup(settings_down).await;
    platform::set(db.pool(), None, platform::REGISTRATION_MODE, json!("open"))
        .await
        .unwrap();
    let reply = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD, "captcha_token": "human" }),
    )
    .await;
    assert_eq!(reply.status, 503);
    assert_eq!(reply.body["error"], "captcha_unavailable");
    assert_eq!(accounts_count(&db).await, 1);
    db.close().await;
    test_db.drop_db().await;

    // QUBITE_CAPTCHA_DISABLED сильнее тумблера owner.
    let fake = fake_captcha().await;
    let (settings_off, _) = settings(&fake.url, true);
    let (test_db, db, address) = setup(settings_off).await;
    platform::set(db.pool(), None, platform::REGISTRATION_MODE, json!("open"))
        .await
        .unwrap();
    let info = anon(address, Method::GET, "/api/auth/registration", None).await;
    assert_eq!(info.body["captcha"], Value::Null);
    let reply = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD }),
    )
    .await;
    assert_eq!(reply.status, 202);
    assert_eq!(fake.turnstile_calls.load(Ordering::SeqCst), 0);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn taken_email_gets_the_same_answer_and_keeps_the_invite() {
    let fake = fake_captcha().await;
    let (settings, outbox) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;
    let mut owner = logged_in(address).await;
    let code = invite(&mut owner, address, json!({})).await;

    let fresh = register(
        address,
        json!({ "email": GUEST, "password": GUEST_PASSWORD, "invite": code }),
    )
    .await;
    let code2 = invite(&mut owner, address, json!({})).await;
    let taken = register(
        address,
        json!({ "email": " Kirill@Qubite.ru ", "password": GUEST_PASSWORD, "invite": code2 }),
    )
    .await;
    assert_eq!(taken.status, 202);
    assert_eq!(taken.body, fresh.body);
    assert_eq!(accounts_count(&db).await, 2);
    // Владельцу почты — письмо «новый пароль», приглашение не потрачено.
    let mail = outbox.wait_for(EMAIL, 1, Duration::from_secs(3)).await;
    assert_eq!(mail[0].subject, "Новый пароль для Qubite");
    let list = owner.get(address, "/api/owner/invitations").await;
    assert_eq!(list.body[0]["status"], "active");
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, PASSWORD)
            .await
            .status,
        200,
        "чужая регистрация не меняет пароль"
    );

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn invitations_are_owner_only() {
    let fake = fake_captcha().await;
    let (settings, _) = settings(&fake.url, false);
    let (test_db, db, address) = setup(settings).await;
    accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: GUEST,
            display_name: "Гость",
            password: GUEST_PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut user = Browser::default();
    assert_eq!(user.login(address, GUEST, GUEST_PASSWORD).await.status, 200);

    let list = user.get(address, "/api/owner/invitations").await;
    let create = user
        .post_json(address, "/api/owner/invitations", json!({}))
        .await;
    let revoke = user
        .delete(
            address,
            &format!("/api/owner/invitations/{}", uuid::Uuid::now_v7()),
        )
        .await;
    for reply in [list, create, revoke] {
        assert_eq!(reply.status, 404);
    }
    let made: i64 = sqlx::query_scalar("SELECT count(*) FROM invitations")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(made, 0);

    db.close().await;
    test_db.drop_db().await;
}
