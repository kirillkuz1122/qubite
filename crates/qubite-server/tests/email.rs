//! Письма с кодами (AUTH-002) через настоящий HTTP-сервер и mock-почту:
//! подтверждение почты, восстановление пароля, лимиты и одинаковые ответы.

mod common;

use std::time::Duration;

use common::{Browser, EMAIL, PASSWORD, logged_in, setup};
use qubite_auth::{
    Passwords,
    accounts::{self, NewAccount},
    email::EmailCodes,
};
use qubite_mail::{Email, Mailer, MockOutbox};
use qubite_server::auth::AuthSettings;
use reqwest::Method;
use serde_json::{Value, json};

const NEW_EMAIL: &str = "friend@qubite.ru";
const NEW_PASSWORD: &str = "новый длинный пароль";

fn settings(codes: EmailCodes) -> (AuthSettings, MockOutbox) {
    let (mailer, outbox) = Mailer::mock();
    let mut settings = AuthSettings {
        mailer,
        ..AuthSettings::default()
    };
    settings.config.email = EmailCodes {
        auth_url: "https://auth.qubiteapp.ru".into(),
        ..codes
    };
    (settings, outbox)
}

/// Код и токен ссылки из текста письма.
fn code_and_token(email: &Email) -> (String, String) {
    let code = email
        .text
        .split("Или введите код: ")
        .nth(1)
        .unwrap()
        .chars()
        .take(6)
        .collect::<String>();
    let token = email
        .text
        .split("?token=")
        .nth(1)
        .unwrap()
        .split_whitespace()
        .next()
        .unwrap()
        .to_owned();
    (code, token)
}

async fn post(address: std::net::SocketAddr, path: &str, body: Value) -> common::Reply {
    Browser::default()
        .send(address, Method::POST, path, Some(body), false)
        .await
}

async fn letters(outbox: &MockOutbox, to: &str, count: usize) -> Vec<Email> {
    outbox.wait_for(to, count, Duration::from_secs(3)).await
}

/// Чуть подождать фоновую отправку, чтобы убедиться, что письма НЕТ.
async fn no_more_letters(outbox: &MockOutbox, to: &str, expected: usize) {
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert_eq!(outbox.to(to).len(), expected, "лишнее письмо на {to}");
}

async fn pending_account(db: &qubite_db::Database) {
    accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: NEW_EMAIL,
            display_name: "Друг",
            password: PASSWORD,
            email_verified: false,
        },
        None,
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn new_account_confirms_email_with_code_then_logs_in() {
    let (settings, outbox) = settings(EmailCodes::default());
    let (test_db, db, address) = setup(settings).await;
    pending_account(&db).await;

    let early = Browser::default().login(address, NEW_EMAIL, PASSWORD).await;
    assert_eq!(early.status, 403);
    assert_eq!(early.body["error"], "email_not_verified");

    let asked = post(
        address,
        "/api/auth/email/verify/request",
        json!({ "email": " Friend@Qubite.ru " }),
    )
    .await;
    assert_eq!(asked.status, 202, "{:?}", asked.body);
    let mail = letters(&outbox, NEW_EMAIL, 1).await;
    assert_eq!(mail.len(), 1);
    assert_eq!(mail[0].subject, "Подтвердите почту в Qubite");
    assert!(mail[0].text.starts_with("Привет, Друг!"));
    assert!(
        mail[0]
            .text
            .contains("https://auth.qubiteapp.ru/verify-email?token=")
    );
    assert!(mail[0].text.contains("действуют сутки"));
    let (code, _) = code_and_token(&mail[0]);

    let wrong_code = if code == "000000" { "111111" } else { "000000" };
    let wrong = post(
        address,
        "/api/auth/email/verify",
        json!({ "email": NEW_EMAIL, "code": wrong_code }),
    )
    .await;
    assert_eq!(wrong.status, 400);
    assert_eq!(wrong.body["error"], "invalid_code");

    // Код можно ввести с пробелом посередине, как его удобно читать.
    let spaced = format!("{} {}", &code[..3], &code[3..]);
    let ok = post(
        address,
        "/api/auth/email/verify",
        json!({ "email": NEW_EMAIL, "code": spaced }),
    )
    .await;
    assert_eq!(ok.status, 204, "{:?}", ok.body);

    let login = Browser::default().login(address, NEW_EMAIL, PASSWORD).await;
    assert_eq!(login.status, 200, "{:?}", login.body);

    // Код одноразовый.
    let again = post(
        address,
        "/api/auth/email/verify",
        json!({ "email": NEW_EMAIL, "code": code }),
    )
    .await;
    assert_eq!(again.body["error"], "invalid_code");

    let audit: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action = 'auth.email_verified'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(audit, 1);
    // В базе нет ни кода, ни токена ссылки в открытом виде.
    let stored: Vec<u8> = sqlx::query_scalar("SELECT code_hash FROM email_challenges")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_ne!(stored, code.as_bytes());

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn link_from_letter_confirms_email_once() {
    let (settings, outbox) = settings(EmailCodes::default());
    let (test_db, db, address) = setup(settings).await;
    pending_account(&db).await;

    post(
        address,
        "/api/auth/email/verify/request",
        json!({ "email": NEW_EMAIL }),
    )
    .await;
    let (_, token) = code_and_token(&letters(&outbox, NEW_EMAIL, 1).await[0]);

    let ok = post(address, "/api/auth/email/verify", json!({ "token": token })).await;
    assert_eq!(ok.status, 204);
    let again = post(address, "/api/auth/email/verify", json!({ "token": token })).await;
    assert_eq!(again.body["error"], "invalid_code");
    let made_up = post(
        address,
        "/api/auth/email/verify",
        json!({ "token": "выдуманный" }),
    )
    .await;
    assert_eq!(made_up.body["error"], "invalid_code");
    let empty = post(address, "/api/auth/email/verify", json!({})).await;
    assert_eq!(empty.status, 400);
    assert_eq!(empty.body["error"], "invalid");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn answer_is_the_same_whether_account_exists_or_not() {
    let (settings, outbox) = settings(EmailCodes::default());
    let (test_db, db, address) = setup(settings).await;
    pending_account(&db).await;

    // Неизвестная почта, подтверждённая почта (owner), неподтверждённая —
    // для восстановления: ответ один и тот же, письма нет.
    let unknown = post(
        address,
        "/api/auth/password/forgot",
        json!({ "email": "nobody@qubite.ru" }),
    )
    .await;
    let pending_reset = post(
        address,
        "/api/auth/password/forgot",
        json!({ "email": NEW_EMAIL }),
    )
    .await;
    let owner_verify = post(
        address,
        "/api/auth/email/verify/request",
        json!({ "email": EMAIL }),
    )
    .await;
    let unknown_verify = post(
        address,
        "/api/auth/email/verify/request",
        json!({ "email": "nobody@qubite.ru" }),
    )
    .await;
    for reply in [&unknown, &pending_reset, &owner_verify, &unknown_verify] {
        assert_eq!(reply.status, 202);
        assert_eq!(reply.body, unknown.body);
    }
    no_more_letters(&outbox, "nobody@qubite.ru", 0).await;
    no_more_letters(&outbox, NEW_EMAIL, 0).await;
    no_more_letters(&outbox, EMAIL, 0).await;

    let bad = post(
        address,
        "/api/auth/password/forgot",
        json!({ "email": "not an email" }),
    )
    .await;
    assert_eq!(bad.status, 400);

    // Код для неизвестной почты — тот же ответ, что и неверный код.
    let guess = post(
        address,
        "/api/auth/email/verify",
        json!({ "email": "nobody@qubite.ru", "code": "123456" }),
    )
    .await;
    assert_eq!(guess.body["error"], "invalid_code");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn parallel_guessing_burns_the_code_after_five_tries() {
    let (settings, outbox) = settings(EmailCodes::default());
    let (test_db, db, address) = setup(settings).await;
    pending_account(&db).await;

    post(
        address,
        "/api/auth/email/verify/request",
        json!({ "email": NEW_EMAIL }),
    )
    .await;
    let (code, _) = code_and_token(&letters(&outbox, NEW_EMAIL, 1).await[0]);

    // 20 неверных кодов одновременно: засчитываются все, по очереди.
    let mut tasks = Vec::new();
    for i in 0..20u32 {
        let guess = format!("{:06}", (code.parse::<u32>().unwrap() + 1 + i) % 1_000_000);
        tasks.push(tokio::spawn(async move {
            post(
                address,
                "/api/auth/email/verify",
                json!({ "email": NEW_EMAIL, "code": guess }),
            )
            .await
            .body["error"]
                .clone()
        }));
    }
    for task in tasks {
        assert_eq!(task.await.unwrap(), "invalid_code");
    }
    let (attempts, reason): (i32, Option<String>) =
        sqlx::query_as("SELECT attempts, closed_reason FROM email_challenges")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(attempts, 5);
    assert_eq!(reason.as_deref(), Some("attempts"));

    // Даже верный код уже не подходит — нужно новое письмо.
    let late = post(
        address,
        "/api/auth/email/verify",
        json!({ "email": NEW_EMAIL, "code": code }),
    )
    .await;
    assert_eq!(late.body["error"], "invalid_code");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn letters_are_rate_limited_and_new_letter_replaces_old_code() {
    // Минутная пауза по умолчанию: второе письмо сразу не уходит.
    let (settings_default, outbox) = settings(EmailCodes::default());
    let (test_db, db, address) = setup(settings_default).await;
    pending_account(&db).await;
    for _ in 0..3 {
        let reply = post(
            address,
            "/api/auth/email/verify/request",
            json!({ "email": NEW_EMAIL }),
        )
        .await;
        assert_eq!(reply.status, 202);
    }
    letters(&outbox, NEW_EMAIL, 1).await;
    no_more_letters(&outbox, NEW_EMAIL, 1).await;
    db.close().await;
    test_db.drop_db().await;

    // Без паузы, но не больше 3 писем в час.
    let (settings_fast, outbox) = settings(EmailCodes {
        resend_after: Duration::ZERO,
        max_per_hour: 3,
        ..EmailCodes::default()
    });
    let (test_db, db, address) = setup(settings_fast).await;
    pending_account(&db).await;
    for _ in 0..5 {
        post(
            address,
            "/api/auth/email/verify/request",
            json!({ "email": NEW_EMAIL }),
        )
        .await;
    }
    let mail = letters(&outbox, NEW_EMAIL, 3).await;
    no_more_letters(&outbox, NEW_EMAIL, 3).await;

    // Новое письмо отменяет прежний код: из трёх кодов подходит ровно один.
    let replaced: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM email_challenges WHERE closed_reason = 'replaced'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(replaced, 2);
    let mut accepted = 0;
    for letter in &mail {
        let (code, _) = code_and_token(letter);
        let reply = post(
            address,
            "/api/auth/email/verify",
            json!({ "email": NEW_EMAIL, "code": code }),
        )
        .await;
        if reply.status == 204 {
            accepted += 1;
        } else {
            assert_eq!(reply.body["error"], "invalid_code");
        }
    }
    assert_eq!(accepted, 1);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn expired_code_does_not_work() {
    let (settings, outbox) = settings(EmailCodes::default());
    let (test_db, db, address) = setup(settings).await;

    post(
        address,
        "/api/auth/password/forgot",
        json!({ "email": EMAIL }),
    )
    .await;
    let mail = letters(&outbox, EMAIL, 1).await;
    assert!(mail[0].text.contains("действуют 30 минут"));
    let (code, token) = code_and_token(&mail[0]);
    sqlx::query("UPDATE email_challenges SET expires_at = now() - interval '1 second'")
        .execute(db.pool())
        .await
        .unwrap();
    let by_code = post(
        address,
        "/api/auth/password/reset",
        json!({ "email": EMAIL, "code": code, "password": NEW_PASSWORD }),
    )
    .await;
    let by_link = post(
        address,
        "/api/auth/password/reset",
        json!({ "token": token, "password": NEW_PASSWORD }),
    )
    .await;
    assert_eq!(by_code.body["error"], "invalid_code");
    assert_eq!(by_link.body["error"], "invalid_code");
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, PASSWORD)
            .await
            .status,
        200
    );

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn password_reset_closes_every_session_and_unlocks_login() {
    let (settings, outbox) = settings(EmailCodes::default());
    let (test_db, db, address) = setup(settings).await;
    let mut phone = logged_in(address).await;
    let mut laptop = logged_in(address).await;

    // Кто-то перебором заблокировал вход по почте.
    for _ in 0..5 {
        Browser::default()
            .login(address, EMAIL, "чужой пароль")
            .await;
    }
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, PASSWORD)
            .await
            .status,
        429
    );

    let asked = post(
        address,
        "/api/auth/password/forgot",
        json!({ "email": EMAIL }),
    )
    .await;
    assert_eq!(asked.status, 202);
    let mail = letters(&outbox, EMAIL, 1).await;
    assert_eq!(mail[0].subject, "Новый пароль для Qubite");
    assert!(
        mail[0]
            .text
            .contains("https://auth.qubiteapp.ru/reset-password?token=")
    );
    let (code, token) = code_and_token(&mail[0]);

    // Слабый пароль не тратит код.
    let weak = post(
        address,
        "/api/auth/password/reset",
        json!({ "email": EMAIL, "code": code, "password": "short" }),
    )
    .await;
    assert_eq!(weak.status, 400);
    assert_eq!(weak.body["error"], "invalid");

    let reset = post(
        address,
        "/api/auth/password/reset",
        json!({ "email": EMAIL, "code": code, "password": NEW_PASSWORD }),
    )
    .await;
    assert_eq!(reset.status, 200, "{:?}", reset.body);
    assert_eq!(reset.body["revoked"], 2);

    assert_eq!(phone.get(address, "/api/auth/me").await.status, 401);
    assert_eq!(laptop.get(address, "/api/auth/me").await.status, 401);
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, PASSWORD)
            .await
            .status,
        401
    );
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, NEW_PASSWORD)
            .await
            .status,
        200
    );

    // Ни код, ни ссылка из того же письма второй раз не работают.
    let again = post(
        address,
        "/api/auth/password/reset",
        json!({ "token": token, "password": "ещё один новый пароль" }),
    )
    .await;
    assert_eq!(again.body["error"], "invalid_code");

    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'auth.password_reset' \
         AND NOT after::text LIKE '%' || $1 || '%'",
    )
    .bind(NEW_PASSWORD)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(audit, 1);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn reset_by_link_and_blocked_account_gets_nothing() {
    let (settings, outbox) = settings(EmailCodes::default());
    let (test_db, db, address) = setup(settings).await;

    post(
        address,
        "/api/auth/password/forgot",
        json!({ "email": EMAIL }),
    )
    .await;
    let (_, token) = code_and_token(&letters(&outbox, EMAIL, 1).await[0]);
    let reset = post(
        address,
        "/api/auth/password/reset",
        json!({ "token": token, "password": NEW_PASSWORD }),
    )
    .await;
    assert_eq!(reset.status, 200);
    assert_eq!(reset.body["revoked"], 0);
    assert_eq!(
        Browser::default()
            .login(address, EMAIL, NEW_PASSWORD)
            .await
            .status,
        200
    );

    // Заблокированному аккаунту письма не уходят.
    pending_account(&db).await;
    sqlx::query("UPDATE accounts SET status = 'blocked' WHERE email = $1")
        .bind(NEW_EMAIL)
        .execute(db.pool())
        .await
        .unwrap();
    for path in [
        "/api/auth/password/forgot",
        "/api/auth/email/verify/request",
    ] {
        let reply = post(address, path, json!({ "email": NEW_EMAIL })).await;
        assert_eq!(reply.status, 202);
    }
    no_more_letters(&outbox, NEW_EMAIL, 0).await;

    db.close().await;
    test_db.drop_db().await;
}
