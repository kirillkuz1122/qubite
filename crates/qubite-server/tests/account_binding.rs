//! Запрос привязан к аккаунту (SYNC-008, D-894): очередь одного человека не
//! уходит от имени другого, даже если в браузере уже вошёл другой.
//!
//! В браузере cookie общие на все вкладки. Вкладка, открытая под A, после
//! входа B в соседней вкладке шлёт запросы с cookie B. Клиент называет в
//! `X-Qubite-Account`, чья это очередь; сервер сверяет с сессией.

mod common;

use std::net::SocketAddr;

use common::{Browser, logged_in};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use uuid::Uuid;

const USER_PASSWORD: &str = "пароль ученика 1";

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

fn thought(object_id: Uuid, text: &str) -> Value {
    json!({ "device_id": Uuid::now_v7(), "ops": [{
        "op_id": Uuid::now_v7(),
        "object_id": object_id,
        "kind": "create",
        "object_type": "inbox.item",
        "title": text,
        "fields": { "body": text, "source": "web", "captured_at_ms": 1_792_224_000_000_i64 }
    }] })
}

async fn objects_of(db: &qubite_db::Database, owner: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM objects WHERE owner_id = $1")
        .bind(owner)
        .fetch_one(db.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn queue_of_one_account_is_not_applied_under_another() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let (a, _tab_a) = user(&db, address, "a@qubite.ru").await;
    let (b, mut tab_b) = user(&db, address, "b@qubite.ru").await;
    for account in [a, b] {
        let reply = owner
            .put_json(
                address,
                &format!("/api/owner/accounts/{account}/grants/inbox"),
                json!({ "read": true, "write": true, "manage": false, "ai": false }),
            )
            .await;
        assert_eq!(reply.status, 200, "{:?}", reply.body);
    }

    // Вкладка A осталась открытой, а cookie в браузере уже от B.
    let mut stale = Browser {
        account: Some(a.to_string()),
        ..tab_b.clone()
    };
    let private = Uuid::now_v7();
    let reply = stale
        .post_json(address, "/api/v1/sync/push", thought(private, "PRIVATE-A"))
        .await;
    assert_eq!(reply.status, 409, "{:?}", reply.body);
    assert_eq!(reply.body["error"], "account_mismatch");
    assert_eq!(objects_of(&db, b).await, 0, "в аккаунт B ничего не попало");
    assert_eq!(objects_of(&db, a).await, 0);

    // Не только отправка: чужой вкладке не отдаются и данные B.
    let reply = stale.get(address, "/api/v1/sync/pull?cursor=0").await;
    assert_eq!(reply.status, 409);
    let reply = stale.get(address, "/api/v1/inbox").await;
    assert_eq!(reply.status, 409);
    // Сессия при этом цела: вкладка узнаёт, кто вошёл, запросом без заголовка.
    let mut asking = Browser {
        account: None,
        ..tab_b.clone()
    };
    let me = asking.get(address, "/api/auth/me").await;
    assert_eq!(me.status, 200);
    assert_eq!(me.body["id"], b.to_string());

    // Старая версия страницы не называет аккаунт — её очередь не принимается.
    let reply = asking
        .post_json(address, "/api/v1/sync/push", thought(private, "PRIVATE-A"))
        .await;
    assert_eq!(reply.status, 400, "{:?}", reply.body);
    assert_eq!(reply.body["error"], "account_required");
    let voice = json!({ "id": Uuid::now_v7(), "mime": "audio/webm", "audio": "AAAA" });
    let reply = asking
        .post_json(address, "/api/v1/inbox/voice", voice)
        .await;
    assert_eq!(reply.status, 400, "{:?}", reply.body);
    assert_eq!(reply.body["error"], "account_required");
    // Мусор в заголовке — тоже «не тот аккаунт».
    let mut garbage = Browser {
        account: Some("кто-то".into()),
        ..tab_b.clone()
    };
    assert_eq!(garbage.get(address, "/api/v1/inbox").await.status, 409);
    assert_eq!(objects_of(&db, b).await, 0);

    // Своя вкладка B работает как обычно.
    let mine = Uuid::now_v7();
    let reply = tab_b
        .post_json(address, "/api/v1/sync/push", thought(mine, "мысль B"))
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["results"][0]["status"], "applied");
    assert_eq!(objects_of(&db, b).await, 1);
    assert_eq!(objects_of(&db, a).await, 0);
    db.close().await;
    test_db.drop_db().await;
}
