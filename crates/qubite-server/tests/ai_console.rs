//! AI-003 по HTTP: Console → AI (пароль, лимиты, «сделать мне безлимит»,
//! защита от зацикливания, ключ платформы, расход, журнал вызовов) и
//! «Настройки → AI и бюджет» у каждого (свой расход, свой ключ, источник).
//! Провайдеров нет — к AI ничего не уходит.

mod common;

use std::{net::SocketAddr, sync::Arc};

use common::{EMAIL, PASSWORD};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_db::Database;
use qubite_server::{AppState, ai_console::AiPanel, auth::AuthSettings};
use qubite_testkit::TestDb;
use serde_json::{Value, json};

async fn start(secrets: bool) -> (TestDb, Database, SocketAddr) {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let panel = AiPanel {
        secrets: secrets.then(|| {
            Arc::new(
                qubite_ai::secret::SecretBox::from_base64(
                    &qubite_ai::secret::SecretBox::generate_key(),
                )
                .unwrap(),
            )
        }),
        timezone: "Asia/Yekaterinburg".into(),
        ..AiPanel::default()
    };
    let state = AppState::with_auth(db.clone(), AuthSettings::default()).with_ai_panel(panel);
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (test_db, db, address)
}

async fn student(db: &Database, address: SocketAddr) -> (common::Browser, uuid::Uuid) {
    let account = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "student@qubite.ru",
            display_name: "",
            password: "пароль ученика",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut browser = common::Browser::default();
    let reply = browser
        .login(address, "student@qubite.ru", "пароль ученика")
        .await;
    assert_eq!(reply.status, 200);
    (browser, account.id)
}

fn actions(log: &Value) -> Vec<String> {
    log.as_array()
        .unwrap()
        .iter()
        .map(|e| e["action"].as_str().unwrap().to_owned())
        .collect()
}

#[tokio::test]
async fn owner_makes_himself_unlimited_with_buttons() {
    let (test_db, db, address) = start(false).await;
    let mut owner = common::logged_in_unconfirmed(address).await;
    let me: Value = owner.get(address, "/api/auth/me").await.body;
    let owner_id = me["id"].as_str().unwrap().to_owned();

    // Как у владельца 22.10: личный лимит в $ мешает режиму.
    let set = owner
        .post_json(
            address,
            "/api/owner/ai/limits",
            json!({ "scope": "user", "account_id": owner_id, "period": "day",
                    "metric": "usd", "value": 500_000 }),
        )
        .await;
    assert_eq!(set.status, 403, "без пароля — нельзя");
    assert_eq!(set.body["error"], "confirm_required");
    owner.confirm(address, PASSWORD).await;
    let set = owner
        .post_json(
            address,
            "/api/owner/ai/limits",
            json!({ "scope": "user", "account_id": owner_id, "period": "day",
                    "metric": "usd", "value": 500_000 }),
        )
        .await;
    assert_eq!(set.status, 200, "{:?}", set.body);
    let overview = owner.get(address, "/api/owner/ai/overview").await;
    assert_eq!(overview.status, 200, "{:?}", overview.body);
    assert_eq!(overview.body["unlimited_works"], false);
    assert_eq!(
        overview.body["owner_personal_usd"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(overview.body["platform_day_usd"].is_null());
    assert_eq!(overview.body["default_platform_day_usd"], 5_000_000);

    let done = owner
        .post_json(address, "/api/owner/ai/unlimited", json!({}))
        .await;
    assert_eq!(done.status, 200, "{:?}", done.body);
    assert_eq!(done.body["unlimited_works"], true);
    assert_eq!(done.body["owner_unlimited"], true);
    assert!(
        done.body["owner_personal_usd"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert_eq!(done.body["platform_day_usd"]["value"], 5_000_000);

    // Переключатель отдельно — тоже работает и тоже в журнале.
    let off = owner
        .put_json(
            address,
            "/api/owner/ai/owner-unlimited",
            json!({ "enabled": false }),
        )
        .await;
    assert_eq!(off.body["unlimited_works"], false);

    let log = owner.get(address, "/api/owner/audit?kind=ai").await;
    let log = actions(&log.body);
    for action in ["ai.limit_set", "ai.limit_revoked", "ai.owner_unlimited_set"] {
        assert!(log.contains(&action.to_owned()), "{action}: {log:?}");
    }
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn every_kind_of_limit_can_be_listed_changed_and_removed() {
    let (test_db, db, address) = start(false).await;
    let (_, student_id) = student(&db, address).await;
    let mut owner = common::logged_in(address).await;
    let cases = [
        json!({ "scope": "platform", "period": "month", "metric": "usd", "value": 20_000_000 }),
        json!({ "scope": "each_user", "period": "day", "metric": "requests", "value": 100 }),
        json!({ "scope": "user", "account_id": student_id, "period": "hour", "metric": "tokens", "value": 5000 }),
        json!({ "scope": "module", "module_id": "docs", "period": "all", "metric": "usd", "value": 1 }),
        json!({ "scope": "user_module", "account_id": student_id, "module_id": "docs",
                "period": "day", "metric": "usd", "value": 300_000 }),
    ];
    for case in &cases {
        let reply = owner
            .post_json(address, "/api/owner/ai/limits", case.clone())
            .await;
        assert_eq!(reply.status, 200, "{case}: {:?}", reply.body);
    }
    let list = owner.get(address, "/api/owner/ai/limits").await.body;
    let list = list.as_array().unwrap();
    assert_eq!(list.len(), cases.len());
    assert_eq!(list[0]["scope"], "platform", "платформа — первой");
    let mine = list.iter().find(|l| l["scope"] == "user").unwrap();
    assert_eq!(mine["account_email"], "student@qubite.ru");
    assert_eq!(mine["used"], 0);

    // То же сочетание с новым значением — замена, а не второй лимит.
    let changed = owner
        .post_json(
            address,
            "/api/owner/ai/limits",
            json!({ "scope": "each_user", "period": "day", "metric": "requests", "value": 7 }),
        )
        .await
        .body;
    let each: Vec<&Value> = changed
        .as_array()
        .unwrap()
        .iter()
        .filter(|l| l["scope"] == "each_user")
        .collect();
    assert_eq!(each.len(), 1);
    assert_eq!(each[0]["value"], 7);

    // Ошибки — понятные.
    for bad in [
        json!({ "scope": "user", "period": "day", "metric": "usd", "value": 1 }),
        json!({ "scope": "galaxy", "period": "day", "metric": "usd", "value": 1 }),
        json!({ "scope": "platform", "period": "week", "metric": "usd", "value": 1 }),
        json!({ "scope": "platform", "period": "day", "metric": "usd", "value": -1 }),
        json!({ "scope": "module", "module_id": "нет-такого", "period": "day", "metric": "usd", "value": 1 }),
    ] {
        let reply = owner
            .post_json(address, "/api/owner/ai/limits", bad.clone())
            .await;
        assert_eq!(reply.status, 400, "{bad}: {:?}", reply.body);
    }

    let id = mine["id"].as_str().unwrap();
    let after = owner
        .delete(address, &format!("/api/owner/ai/limits/{id}"))
        .await;
    assert_eq!(after.status, 200, "{:?}", after.body);
    assert!(!after.body.as_array().unwrap().iter().any(|l| l["id"] == id));
    let again = owner
        .delete(address, &format!("/api/owner/ai/limits/{id}"))
        .await;
    assert_eq!(again.status, 400);

    // Чужим — этих адресов нет.
    let mut stranger = common::Browser::default();
    for path in [
        "/api/owner/ai/overview",
        "/api/owner/ai/limits",
        "/api/owner/ai/usage",
        "/api/owner/ai/calls",
    ] {
        assert_eq!(stranger.get(address, path).await.status, 404, "{path}");
    }
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn loop_guard_usage_and_calls_in_console() {
    let (test_db, db, address) = start(false).await;
    let mut owner = common::logged_in(address).await;
    let overview = owner.get(address, "/api/owner/ai/overview").await.body;
    assert_eq!(overview["loop_guard_from_console"], false);
    assert_eq!(overview["loop_guard"]["user_per_minute"], 20);

    let set = owner
        .put_json(
            address,
            "/api/owner/ai/loop-guard",
            json!({ "user_per_minute": 0, "repeat_window_secs": 3600 }),
        )
        .await;
    assert_eq!(set.status, 200, "{:?}", set.body);
    assert_eq!(set.body["loop_guard_from_console"], true);
    assert_eq!(set.body["loop_guard"]["user_per_minute"], 0);
    assert_eq!(set.body["loop_guard"]["repeat_window_secs"], 3600);
    assert_eq!(
        set.body["loop_guard"]["repeat_limit"], 3,
        "прочее — как было"
    );
    let bad = owner
        .put_json(
            address,
            "/api/owner/ai/loop-guard",
            json!({ "repeat_window_secs": 0 }),
        )
        .await;
    assert_eq!(bad.status, 400);
    let reset = owner
        .put_json(
            address,
            "/api/owner/ai/loop-guard",
            json!({ "reset": true }),
        )
        .await;
    assert_eq!(reset.body["loop_guard_from_console"], false);
    assert_eq!(reset.body["loop_guard"], reset.body["loop_guard_server"]);

    // Расход и журнал вызовов — из ai_calls (здесь — записанные вручную).
    let owner_id: uuid::Uuid = sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_one(db.pool())
        .await
        .unwrap();
    for (i, (usd, paid)) in [(120_000_i64, "platform"), (0, "subscription")]
        .iter()
        .enumerate()
    {
        sqlx::query(
            "INSERT INTO ai_calls (id, request_id, account_id, module_id, model_id, status, attempts, \
             estimate_usd, estimate_tokens, actual_usd, tokens_in, tokens_out, paid_by) \
             VALUES ($1, $2, $3, 'agent', 'elevenlabs/scribe_v1', 'succeeded', 1, $4, 10, $4, 100, 20, $5)",
        )
        .bind(uuid::Uuid::now_v7())
        .bind(format!("r{i}"))
        .bind(owner_id)
        .bind(usd)
        .bind(paid)
        .execute(db.pool())
        .await
        .unwrap();
    }
    let usage = owner.get(address, "/api/owner/ai/usage?days=7").await;
    assert_eq!(usage.status, 200, "{:?}", usage.body);
    assert_eq!(usage.body["by_day"].as_array().unwrap().len(), 7);
    assert_eq!(usage.body["total"]["usd"], 120_000);
    assert_eq!(usage.body["total"]["requests"], 2);
    assert_eq!(usage.body["by_module"][0]["key"], "agent");
    assert_eq!(usage.body["by_person"][0]["key"], EMAIL);
    let payers: Vec<&str> = usage.body["by_payer"]
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["key"].as_str().unwrap())
        .collect();
    assert_eq!(payers, ["platform", "subscription"]);
    let calls = owner.get(address, "/api/owner/ai/calls?limit=1").await;
    assert_eq!(calls.body.as_array().unwrap().len(), 1);
    assert_eq!(calls.body[0]["account_email"], EMAIL);
    let overview = owner.get(address, "/api/owner/ai/overview").await.body;
    assert_eq!(overview["today_usd"], 120_000);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn keys_need_secret_key_and_are_never_shown() {
    let (test_db, db, address) = start(false).await;
    let mut owner = common::logged_in(address).await;
    let reply = owner
        .put_json(
            address,
            "/api/owner/ai/keys/openrouter",
            json!({ "key": "sk-or-v1-0123456789abcdef" }),
        )
        .await;
    assert_eq!(reply.status, 409);
    assert_eq!(reply.body["error"], "secret_key_not_set");
    db.close().await;
    test_db.drop_db().await;

    let (test_db, db, address) = start(true).await;
    let mut owner = common::logged_in(address).await;
    let short = owner
        .put_json(
            address,
            "/api/owner/ai/keys/openrouter",
            json!({ "key": "short" }),
        )
        .await;
    assert_eq!(short.status, 400);
    let saved = owner
        .put_json(
            address,
            "/api/owner/ai/keys/openrouter",
            json!({ "key": "sk-or-v1-0123456789abcdef" }),
        )
        .await;
    assert_eq!(saved.status, 200, "{:?}", saved.body);
    assert_eq!(saved.body["keys"][0]["source"], "console");
    assert_eq!(saved.body["keys"][0]["hint"], "cdef");
    assert!(!saved.body.to_string().contains("0123456789"));
    let stored: String = sqlx::query_scalar("SELECT key_enc FROM ai_keys")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(!stored.contains("sk-or"), "в базе — только зашифрованный");
    let removed = owner.delete(address, "/api/owner/ai/keys/openrouter").await;
    assert_eq!(removed.body["keys"][0]["source"], "none");
    let log = owner.get(address, "/api/owner/audit?kind=ai").await.body;
    assert!(actions(&log).contains(&"ai.key_set".to_owned()));
    assert!(
        !log.to_string().contains("0123456789"),
        "ключа нет в журнале"
    );
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn everyone_sees_own_ai_and_connects_own_key() {
    let (test_db, db, address) = start(true).await;
    let (mut me, my_id) = student(&db, address).await;
    let mut owner = common::logged_in(address).await;
    owner
        .post_json(
            address,
            "/api/owner/ai/limits",
            json!({ "scope": "user", "account_id": my_id, "period": "day",
                    "metric": "usd", "value": 1_000_000 }),
        )
        .await;
    let mine = me.get(address, "/api/ai/me").await;
    assert_eq!(mine.status, 200, "{:?}", mine.body);
    assert_eq!(mine.body["is_owner"], false);
    assert_eq!(mine.body["source"], "owner");
    assert_eq!(mine.body["owner_allows"], true, "путь ③: owner выдал $");
    assert_eq!(mine.body["keys_available"], true);
    assert_eq!(mine.body["chatgpt"]["available"], false);
    assert!(
        mine.body["chatgpt"]["unavailable_reason"]
            .as_str()
            .unwrap()
            .contains("QUBITE_AI_CHATGPT_ENABLED")
    );
    assert_eq!(mine.body["usage"]["by_day"].as_array().unwrap().len(), 30);
    let limits = mine.body["limits"].as_array().unwrap();
    assert_eq!(limits.len(), 1, "только свои (и общие), не чужие");

    // Свой ключ — сразу источник AI.
    let saved = me
        .put_json(
            address,
            "/api/ai/me/key",
            json!({ "key": "sk-or-v1-mine-0000abcd" }),
        )
        .await;
    assert_eq!(saved.status, 200, "{:?}", saved.body);
    assert_eq!(saved.body["source"], "own_key");
    assert_eq!(saved.body["own_key_hint"], "abcd");
    let back = me
        .put_json(address, "/api/ai/me/source", json!({ "source": "owner" }))
        .await;
    assert_eq!(back.body["source"], "owner");
    let bad = me
        .put_json(address, "/api/ai/me/source", json!({ "source": "magic" }))
        .await;
    assert_eq!(bad.status, 400);
    me.put_json(address, "/api/ai/me/source", json!({ "source": "own_key" }))
        .await;
    let removed = me.delete(address, "/api/ai/me/key").await;
    assert_eq!(removed.body["source"], "owner", "ключа нет — снова owner");
    assert!(removed.body["own_key_hint"].is_null());

    // ChatGPT выключен на сервере — вход не начинается, понятно почему.
    let start = me.post(address, "/api/ai/me/chatgpt/start").await;
    assert_eq!(start.status, 409);
    assert_eq!(start.body["error"], "chatgpt_disabled");

    // Owner видит свой «безлимит» и здесь.
    let owner_view = owner.get(address, "/api/ai/me").await.body;
    assert_eq!(owner_view["is_owner"], true);
    assert_eq!(
        owner_view["limits"].as_array().unwrap().len(),
        0,
        "чужой личный лимит owner не видит у себя"
    );
    let guest = common::Browser::default().get(address, "/api/ai/me").await;
    assert_eq!(guest.status, 401);
    db.close().await;
    test_db.drop_db().await;
}
