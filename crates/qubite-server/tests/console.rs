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
    let mut owner = logged_in(address).await;

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

    // Подтверждение живёт 5 минут.
    sqlx::query("UPDATE sessions SET confirmed_at = now() - interval '6 minutes'")
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

    db.close().await;
    test_db.drop_db().await;
}
