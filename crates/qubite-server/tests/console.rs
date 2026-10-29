//! Owner Console (ACC-003): люди, подтверждение паролем, журнал и сервер
//! через настоящий HTTP-сервер.

mod common;

use common::{Browser, EMAIL, PASSWORD, logged_in, setup};
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};

const FRIEND: &str = "friend@qubite.ru";
const FRIEND_PASSWORD: &str = "пароль друга длинный";

fn module<'a>(catalog: &'a Value, id: &str) -> &'a Value {
    catalog
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == id)
        .unwrap()
}

#[tokio::test]
async fn create_person_grant_docs_block_and_see_it_in_the_log() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut owner = common::logged_in_unconfirmed(address).await;

    // Гостю раздела нет (404, а не 403).
    for path in [
        "/api/owner/accounts",
        "/api/owner/audit",
        "/api/owner/server",
    ] {
        assert_eq!(Browser::default().get(address, path).await.status, 404);
    }

    let list = owner.get(address, "/api/owner/accounts").await;
    assert_eq!(list.status, 200, "{:?}", list.body);
    assert_eq!(list.body.as_array().unwrap().len(), 1);
    assert_eq!(list.body[0]["is_owner"], true);
    assert_eq!(list.body[0]["has_password"], true);

    // Опасное действие без пароля — нельзя; неверный пароль не подтверждает.
    let new_person =
        json!({ "email": FRIEND, "display_name": "Друг", "password": FRIEND_PASSWORD });
    let early = owner
        .post_json(address, "/api/owner/accounts", new_person.clone())
        .await;
    assert_eq!(early.status, 403);
    assert_eq!(early.body["error"], "confirm_required");
    let wrong = owner
        .post_json(
            address,
            "/api/owner/confirm",
            json!({ "password": "не тот пароль" }),
        )
        .await;
    assert_eq!(wrong.status, 401, "{:?}", wrong.body);
    let confirmed = owner
        .post_json(
            address,
            "/api/owner/confirm",
            json!({ "password": PASSWORD }),
        )
        .await;
    assert_eq!(confirmed.status, 200, "{:?}", confirmed.body);
    assert!(confirmed.body["until"].is_string());

    let created = owner
        .post_json(address, "/api/owner/accounts", new_person.clone())
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    assert_eq!(created.body["status"], "active");
    assert_eq!(created.body["modules"], 0);
    let id = created.body["id"].as_str().unwrap().to_owned();
    let again = owner
        .post_json(address, "/api/owner/accounts", new_person)
        .await;
    assert_eq!(again.status, 409, "{:?}", again.body);

    // Человек входит сразу, но Console для него не существует, модулей нет.
    let mut friend = Browser::default();
    assert_eq!(
        friend.login(address, FRIEND, FRIEND_PASSWORD).await.status,
        200
    );
    assert_eq!(friend.get(address, "/api/owner/accounts").await.status, 404);
    let catalog = friend.get(address, "/api/modules").await.body;
    assert_eq!(module(&catalog, "docs")["flags"]["read"], false);

    // Owner включил модуль Docs и выдал его — человек видит Docs, и только его.
    let docs = owner
        .patch_json(
            address,
            "/api/owner/modules/docs",
            json!({ "installed": true, "readiness": "beta" }),
        )
        .await;
    assert_eq!(docs.status, 200, "{:?}", docs.body);
    let grant = owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{id}/grants/docs"),
            json!({ "read": true, "write": true, "manage": false, "ai": false }),
        )
        .await;
    assert_eq!(grant.status, 200, "{:?}", grant.body);
    let catalog = friend.get(address, "/api/modules").await.body;
    let readable: Vec<&str> = catalog
        .as_array()
        .unwrap()
        .iter()
        .filter(|m| m["flags"]["read"] == true)
        .map(|m| m["id"].as_str().unwrap())
        .collect();
    assert_eq!(readable, ["docs"]);
    let found = owner
        .get(address, "/api/owner/accounts?q=FRIEND&status=active")
        .await;
    assert_eq!(found.body.as_array().unwrap().len(), 1);
    assert_eq!(found.body[0]["modules"], 1);
    assert_eq!(found.body[0]["sessions"], 1);
    let none = owner
        .get(address, "/api/owner/accounts?status=blocked")
        .await;
    assert!(none.body.as_array().unwrap().is_empty());

    // Отозвали — доступ пропал сразу.
    let revoked = owner
        .delete(address, &format!("/api/owner/accounts/{id}/grants/docs"))
        .await;
    assert_eq!(revoked.status, 204);
    let catalog = friend.get(address, "/api/modules").await.body;
    assert_eq!(module(&catalog, "docs")["flags"]["read"], false);

    // Блокировка закрывает его сессии; себя заблокировать нельзя.
    let me = owner.get(address, "/api/auth/me").await.body["id"].clone();
    let selfish = owner
        .patch_json(
            address,
            &format!("/api/owner/accounts/{}", me.as_str().unwrap()),
            json!({ "status": "blocked" }),
        )
        .await;
    assert_eq!(selfish.body["error"], "self_forbidden");
    let blocked = owner
        .patch_json(
            address,
            &format!("/api/owner/accounts/{id}"),
            json!({ "status": "blocked", "reason": "проверка" }),
        )
        .await;
    assert_eq!(blocked.status, 200, "{:?}", blocked.body);
    assert_eq!(blocked.body["status"], "blocked");
    assert_eq!(blocked.body["sessions"], 0);
    assert_eq!(friend.get(address, "/api/auth/me").await.status, 401);
    assert_eq!(
        Browser::default()
            .login(address, FRIEND, FRIEND_PASSWORD)
            .await
            .body["error"],
        "account_blocked"
    );
    let unblocked = owner
        .patch_json(
            address,
            &format!("/api/owner/accounts/{id}"),
            json!({ "status": "active" }),
        )
        .await;
    assert_eq!(unblocked.body["status"], "active");

    // Закрыть его сессии — тоже опасное действие.
    let mut friend = Browser::default();
    friend.login(address, FRIEND, FRIEND_PASSWORD).await;
    let closed = owner
        .post(
            address,
            &format!("/api/owner/accounts/{id}/sessions/revoke"),
        )
        .await;
    assert_eq!(closed.body["revoked"], 1, "{:?}", closed.body);
    assert_eq!(friend.get(address, "/api/auth/me").await.status, 401);

    // Подтверждение живёт 10 минут (D-285).
    sqlx::query("UPDATE sessions SET confirmed_at = now() - interval '11 minutes'")
        .execute(db.pool())
        .await
        .unwrap();
    let stale = owner
        .post(
            address,
            &format!("/api/owner/accounts/{id}/sessions/revoke"),
        )
        .await;
    assert_eq!(stale.body["error"], "confirm_required");

    // Журнал: всё записано, фильтры работают.
    let log = owner
        .get(address, &format!("/api/owner/audit?account={id}"))
        .await;
    assert_eq!(log.status, 200, "{:?}", log.body);
    let actions: Vec<&str> = log
        .body
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["action"].as_str().unwrap())
        .collect();
    for action in [
        "account.created",
        "account.blocked",
        "account.unblocked",
        "auth.sessions_revoked_by_owner",
    ] {
        assert!(actions.contains(&action), "{action}: {actions:?}");
    }
    let blocked_entry = log
        .body
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["action"] == "account.blocked")
        .unwrap();
    assert_eq!(blocked_entry["actor_email"], EMAIL);
    assert_eq!(blocked_entry["reason"], "проверка");
    let only_accounts = owner.get(address, "/api/owner/audit?kind=account").await;
    assert!(
        only_accounts
            .body
            .as_array()
            .unwrap()
            .iter()
            .all(|e| e["action"].as_str().unwrap().starts_with("account."))
    );
    let page = owner.get(address, "/api/owner/audit?limit=2").await;
    assert_eq!(page.body.as_array().unwrap().len(), 2);
    let older = owner
        .get(
            address,
            &format!("/api/owner/audit?limit=2&before={}", page.body[1]["seq"]),
        )
        .await;
    assert!(older.body[0]["seq"].as_i64() < page.body[1]["seq"].as_i64());

    // Сервер.
    let server = owner.get(address, "/api/owner/server").await;
    assert_eq!(server.status, 200, "{:?}", server.body);
    assert_eq!(server.body["accounts"], 2);
    assert!(server.body["migration"].as_i64().unwrap() >= 22);
    assert!(server.body["version"].is_string());
    assert!(
        server.body["deploy"].is_object(),
        "блок выкладки есть всегда"
    );

    db.close().await;
    test_db.drop_db().await;
}

/// Страховка на будущее: любой адрес Owner Console из описания API (все методы)
/// для гостя и для обычного вошедшего человека не существует — 404, а не 401/403,
/// и ничего не меняет. Новый адрес owner без проверки сразу уронит этот тест.
#[tokio::test]
async fn every_owner_route_is_404_for_guest_and_regular_person() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let confirmed = owner
        .post_json(
            address,
            "/api/owner/confirm",
            json!({ "password": PASSWORD }),
        )
        .await;
    assert_eq!(confirmed.status, 200, "{:?}", confirmed.body);
    let created = owner
        .post_json(
            address,
            "/api/owner/accounts",
            json!({ "email": FRIEND, "display_name": "Друг", "password": FRIEND_PASSWORD }),
        )
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let mut friend = Browser::default();
    assert_eq!(
        friend.login(address, FRIEND, FRIEND_PASSWORD).await.status,
        200
    );

    let document = owner.get(address, "/api/openapi.json").await.body;
    let mut checked = 0;
    for (path, item) in document["paths"].as_object().unwrap() {
        if !path.starts_with("/api/owner") {
            continue;
        }
        // {id}, {account_id}, {*id}… — любое правдоподобное значение.
        let mut concrete = String::new();
        let mut rest = path.as_str();
        while let Some(start) = rest.find('{') {
            concrete.push_str(&rest[..start]);
            concrete.push_str("00000000-0000-4000-8000-000000000009");
            rest = &rest[rest[start..].find('}').unwrap() + start + 1..];
        }
        concrete.push_str(rest);
        for method in item.as_object().unwrap().keys() {
            let method: reqwest::Method = method.to_uppercase().parse().unwrap();
            let body = (method != reqwest::Method::GET).then(|| json!({}));
            for (who, browser) in [("гость", &mut Browser::default()), ("человек", &mut friend)]
            {
                let reply = browser
                    .send(address, method.clone(), &concrete, body.clone(), true)
                    .await;
                assert_eq!(
                    reply.status, 404,
                    "{who}: {method} {concrete} → {:?}",
                    reply.body
                );
            }
            checked += 1;
        }
    }
    assert!(checked >= 20, "проверено адресов owner: {checked}");

    db.close().await;
    test_db.drop_db().await;
}

/// Q-42, D-285: «режим подтверждения» — тумблеры платформы и техработ, доступы,
/// модули и AI без свежего пароля отвечают `confirm_required` и ничего не меняют;
/// после одного подтверждения те же запросы проходят проверку пароля.
#[tokio::test]
async fn dangerous_console_actions_ask_password_once_for_ten_minutes() {
    let (test_db, db, address) = setup(AuthSettings::default()).await;
    let mut owner = common::logged_in_unconfirmed(address).await;
    let owner_id: uuid::Uuid = sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let grant = format!("/api/owner/accounts/{owner_id}/grants/docs");
    let flags = json!({ "read": true, "write": false, "manage": false, "ai": false });
    let actions: Vec<(&str, String, Option<Value>)> = vec![
        (
            "PATCH",
            "/api/owner/platform".into(),
            Some(json!({ "changes": [] })),
        ),
        (
            "POST",
            "/api/owner/maintenance".into(),
            Some(json!({ "enabled": false })),
        ),
        (
            "PATCH",
            "/api/owner/modules/docs".into(),
            Some(json!({ "installed": true })),
        ),
        ("PUT", grant.clone(), Some(flags)),
        ("DELETE", grant, None),
        (
            "PATCH",
            "/api/owner/ai/models/mock:x".into(),
            Some(json!({ "enabled": false })),
        ),
        (
            "PUT",
            "/api/owner/ai/tasks/default".into(),
            Some(json!({ "model_id": null })),
        ),
    ];
    async fn call(
        b: &mut Browser,
        a: std::net::SocketAddr,
        m: &str,
        p: &str,
        v: &Option<Value>,
    ) -> common::Reply {
        let method = reqwest::Method::from_bytes(m.as_bytes()).unwrap();
        b.send(a, method, p, v.clone(), true).await
    }
    for (method, path, body) in &actions {
        let reply = call(&mut owner, address, method, path, body).await;
        assert_eq!(reply.status, 403, "{method} {path}: {:?}", reply.body);
        assert_eq!(reply.body["error"], "confirm_required", "{method} {path}");
    }
    let events: i64 =
        sqlx::query_scalar("SELECT count(*) FROM audit_log WHERE action NOT LIKE 'auth.%' AND action <> 'platform.owner_created'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(events, 0, "без пароля ничего не изменилось");

    owner.confirm(address, PASSWORD).await;
    for (method, path, body) in &actions {
        let reply = call(&mut owner, address, method, path, body).await;
        assert_ne!(reply.body["error"], "confirm_required", "{method} {path}");
    }
    db.close().await;
    test_db.drop_db().await;
}
