//! DOC-004a: снимки, права и корзина через HTTP. Выполняется в CI с тестовой БД.
mod common;

use std::net::SocketAddr;

use base64::{Engine, engine::general_purpose::STANDARD};
use common::{Browser, Reply, logged_in};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_db::Database;
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use uuid::Uuid;
use yrs::updates::encoder::Encode;
use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact};

async fn create(browser: &mut Browser, address: SocketAddr) -> Uuid {
    let id = Uuid::now_v7();
    let reply = browser
        .post_json(
            address,
            "/api/v1/sync/push",
            json!({
                "device_id": Uuid::now_v7(), "ops": [{
                    "op_id": Uuid::now_v7(), "object_id": id, "kind": "create",
                    "object_type": "docs.page", "title": "Конспект",
                }],
            }),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(reply.body["results"][0]["status"], "applied", "{}", reply.body);
    id
}

fn packet(doc: &Doc) -> Value {
    let text = doc.get_or_insert_text("text");
    let txn = doc.transact();
    json!({
        "update": STANDARD.encode(txn.encode_state_as_update_v1(&StateVector::default())),
        "snapshot": STANDARD.encode(txn.snapshot().encode_v1()),
        "text": text.get_string(&txn),
    })
}

async fn save(browser: &mut Browser, address: SocketAddr, id: Uuid, value: Value) {
    let reply = browser
        .post_json(address, &format!("/api/v1/docs/{id}/y"), value)
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
}

async fn list(browser: &mut Browser, address: SocketAddr, id: Uuid) -> Vec<Value> {
    let reply = browser
        .get(address, &format!("/api/v1/docs/{id}/versions"))
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    reply.body["versions"].as_array().unwrap().clone()
}

async fn named(browser: &mut Browser, address: SocketAddr, id: Uuid, name: &str) -> Reply {
    browser
        .post_json(
            address,
            &format!("/api/v1/docs/{id}/versions"),
            json!({"name": name}),
        )
        .await
}

async fn age(db: &Database, id: Uuid) {
    sqlx::query(
        "UPDATE docs_versions SET created_at = now() - interval '11 minutes' WHERE doc_id = $1",
    )
    .bind(id)
    .execute(db.pool())
    .await
    .unwrap();
}

#[tokio::test]
async fn autos_save_previous_state_only_for_changes_at_ten_minute_intervals() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let id = create(&mut browser, address).await;
    let doc = Doc::with_client_id(1);
    let text = doc.get_or_insert_text("text");
    text.insert(&mut doc.transact_mut(), 0, "Первая");
    let first = packet(&doc);
    save(&mut browser, address, id, first.clone()).await;
    assert!(list(&mut browser, address, id).await.is_empty());
    text.insert(&mut doc.transact_mut(), 0, "Вторая ");
    save(&mut browser, address, id, packet(&doc)).await;
    let autos = list(&mut browser, address, id).await;
    assert_eq!(autos.len(), 1);
    assert_eq!(autos[0]["kind"], "auto");
    assert_eq!(autos[0]["preview"], "Первая");
    assert_eq!(autos[0]["title"], "Конспект");
    assert!(autos[0].get("ystate").is_none());
    assert!(autos[0].get("text").is_none());
    let detail = browser
        .get(
            address,
            &format!(
                "/api/v1/docs/{id}/versions/{}",
                autos[0]["id"].as_str().unwrap()
            ),
        )
        .await;
    assert_eq!(detail.status, 200);
    assert_eq!(detail.body["ystate"], first["update"]);
    assert_eq!(detail.body["text"], "Первая");
    assert_eq!(
        detail.body["size"],
        STANDARD
            .decode(first["update"].as_str().unwrap())
            .unwrap()
            .len()
    );

    text.insert(&mut doc.transact_mut(), 0, "Третья ");
    save(&mut browser, address, id, packet(&doc)).await;
    assert_eq!(list(&mut browser, address, id).await.len(), 1);
    age(&db, id).await;
    // Старый пакет и повтор текущего не меняют Yjs и не создают версии.
    save(&mut browser, address, id, first).await;
    save(&mut browser, address, id, packet(&doc)).await;
    assert_eq!(list(&mut browser, address, id).await.len(), 1);
    let previous = packet(&doc);
    text.insert(&mut doc.transact_mut(), 0, "Четвёртая ");
    save(&mut browser, address, id, packet(&doc)).await;
    let autos = list(&mut browser, address, id).await;
    assert_eq!(autos.len(), 2);
    assert_eq!(autos[0]["preview"], previous["text"]);
    let page = browser
        .get(address, &format!("/api/v1/docs/{id}/versions?limit=1"))
        .await;
    assert_eq!(page.body["versions"].as_array().unwrap().len(), 1);
    let response = qubite_testkit::http_client()
        .get(format!("http://{address}/api/v1/docs/{id}/versions"))
        .query(&[("before", autos[0]["created_at"].as_str().unwrap())])
        .header(
            "cookie",
            format!("qubite_session={}", browser.session.as_deref().unwrap()),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    let page: Value = response.json().await.unwrap();
    assert_eq!(page["versions"], json!([autos[1]]));
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn named_versions_validate_names_and_force_before_restore_even_on_retry() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let id = create(&mut browser, address).await;
    assert_eq!(named(&mut browser, address, id, "Начало").await.status, 400);
    let doc = Doc::with_client_id(1);
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, &"я".repeat(130));
    save(&mut browser, address, id, packet(&doc)).await;
    for name in [String::new(), " \n\t ".into(), "я".repeat(81)] {
        let reply = named(&mut browser, address, id, &name).await;
        assert_eq!(reply.status, 400, "{}", reply.body);
        assert_eq!(reply.body["error"], "invalid_name");
    }
    let version = named(&mut browser, address, id, &"я".repeat(80)).await;
    assert_eq!(version.status, 201, "{}", version.body);
    assert_eq!(version.body["ystate"], packet(&doc)["update"]);
    assert_eq!(version.body["preview"].as_str().unwrap().chars().count(), 120);
    let vid = version.body["id"].as_str().unwrap();
    let path = format!("/api/v1/docs/{id}/versions/{vid}");
    for name in ["".into(), "я".repeat(81)] {
        assert_eq!(
            browser
                .patch_json(address, &path, json!({"name": name}))
                .await
                .status,
            400
        );
    }
    let renamed = browser
        .patch_json(address, &path, json!({"name": "  Итог  "}))
        .await;
    assert_eq!(renamed.status, 200);
    assert_eq!(renamed.body["name"], "Итог");
    // Свежая именованная версия тоже отодвигает очередной автоснимок.
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, "Новая ");
    save(&mut browser, address, id, packet(&doc)).await;
    assert_eq!(list(&mut browser, address, id).await.len(), 1);
    let mut restore = packet(&doc);
    restore["reason"] = json!("restore");
    restore["restore_of"] = version.body["id"].clone();
    for expected in [2, 3] {
        save(&mut browser, address, id, restore.clone()).await;
        let versions = list(&mut browser, address, id).await;
        assert_eq!(versions.len(), expected);
        assert_eq!(versions[0]["kind"], "before_restore");
        let before_path = format!(
            "/api/v1/docs/{id}/versions/{}",
            versions[0]["id"].as_str().unwrap()
        );
        assert_eq!(
            browser
                .patch_json(address, &before_path, json!({"name": "Нельзя"}))
                .await
                .status,
            409
        );
        assert_eq!(browser.delete(address, &before_path).await.status, 409);
    }
    let mut invalid = restore;
    invalid["update"] = json!("%%%");
    let reply = browser
        .post_json(address, &format!("/api/v1/docs/{id}/y"), invalid)
        .await;
    assert_eq!(reply.status, 400);
    assert_eq!(list(&mut browser, address, id).await.len(), 3);
    assert_eq!(browser.delete(address, &path).await.status, 204);
    assert_eq!(browser.get(address, &path).await.status, 404);
    db.close().await;
    test_db.drop_db().await;
}

async fn insert_old(db: &Database, doc: Uuid, kind: &str, at: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO docs_versions (id, doc_id, owner_id, kind, name, title, ystate, text, created_at, created_by) \
         SELECT $1, o.id, o.owner_id, $2, 'Сохранить', o.title, d.ystate, d.body, $3::text::timestamptz, o.owner_id \
         FROM objects o JOIN docs_pages d ON d.object_id = o.id WHERE o.id = $4",
    )
    .bind(id)
    .bind(kind)
    .bind(at)
    .bind(doc)
    .execute(db.pool())
    .await
    .unwrap();
    id
}

#[tokio::test]
async fn pruning_keeps_one_old_auto_per_utc_day_and_at_most_one_hundred_autos() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let id = create(&mut browser, address).await;
    let doc = Doc::with_client_id(1);
    let text = doc.get_or_insert_text("text");
    text.insert(&mut doc.transact_mut(), 0, "Текст");
    save(&mut browser, address, id, packet(&doc)).await;
    let named = insert_old(&db, id, "named", "2020-01-01T01:00:00Z").await;
    let before = insert_old(&db, id, "before_restore", "2020-01-01T01:00:00Z").await;
    let removed = insert_old(&db, id, "auto", "2020-01-01T01:00:00Z").await;
    let kept = insert_old(&db, id, "auto", "2020-01-01T23:00:00Z").await;
    let next_day = insert_old(&db, id, "auto", "2020-01-02T01:00:00Z").await;
    text.insert(&mut doc.transact_mut(), 0, "Правка ");
    save(&mut browser, address, id, packet(&doc)).await;
    let ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM docs_versions WHERE doc_id = $1")
        .bind(id)
        .fetch_all(db.pool())
        .await
        .unwrap();
    assert_eq!(ids.len(), 5);
    for expected in [named, before, kept, next_day] {
        assert!(ids.contains(&expected));
    }
    assert!(!ids.contains(&removed));
    let auto_path = format!("/api/v1/docs/{id}/versions/{kept}");
    assert_eq!(
        browser
            .patch_json(address, &auto_path, json!({"name": "Нельзя"}))
            .await
            .status,
        409
    );
    assert_eq!(browser.delete(address, &auto_path).await.status, 409);
    age(&db, id).await;
    sqlx::query(
        "INSERT INTO docs_versions (id, doc_id, owner_id, kind, title, ystate, text, created_at, created_by) \
         SELECT gen_random_uuid(), o.id, o.owner_id, 'auto', o.title, d.ystate, d.body, \
             now() - interval '12 minutes', o.owner_id \
         FROM objects o JOIN docs_pages d ON d.object_id = o.id CROSS JOIN generate_series(1, 110) WHERE o.id = $1",
    )
    .bind(id)
    .execute(db.pool())
    .await
    .unwrap();
    text.insert(&mut doc.transact_mut(), 0, "Ещё ");
    save(&mut browser, address, id, packet(&doc)).await;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM docs_versions WHERE doc_id = $1 AND kind = 'auto'",
    )
    .bind(id)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(count, 100);
    for vid in [named, before] {
        assert_eq!(
            browser
                .get(address, &format!("/api/v1/docs/{id}/versions/{vid}"))
                .await
                .status,
            200
        );
    }
    assert_eq!(list(&mut browser, address, id).await.len(), 50);
    let capped = browser
        .get(address, &format!("/api/v1/docs/{id}/versions?limit=500"))
        .await;
    assert_eq!(capped.body["versions"].as_array().unwrap().len(), 50);
    db.close().await;
    test_db.drop_db().await;
}

async fn grant(owner: &mut Browser, address: SocketAddr, account: Uuid, write: bool) {
    let reply = owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{account}/grants/docs"),
            json!({"read": true, "write": write, "manage": false, "ai": false}),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
}

#[tokio::test]
async fn version_routes_require_grants_and_hide_foreign_or_mismatched_versions() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let foreign_doc = create(&mut owner, address).await;
    let doc = Doc::with_client_id(1);
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, "Личное");
    save(&mut owner, address, foreign_doc, packet(&doc)).await;
    let version = named(&mut owner, address, foreign_doc, "Личная версия").await;
    let vid = version.body["id"].as_str().unwrap();
    let account = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "versions@qubite.ru",
            display_name: "",
            password: common::PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut browser = Browser::default();
    assert_eq!(
        browser
            .login(address, "versions@qubite.ru", common::PASSWORD)
            .await
            .status,
        200
    );
    assert_eq!(
        browser.get(address, "/api/v1/docs?deleted=true").await.status,
        403
    );
    let path = format!("/api/v1/docs/{foreign_doc}/versions");
    let detail = format!("{path}/{vid}");
    for read in [false, true] {
        if read {
            grant(&mut owner, address, account.id, false).await;
        }
        for route in [&path, &detail] {
            assert_eq!(
                browser.get(address, route).await.status,
                if read { 404 } else { 403 }
            );
        }
        assert_eq!(
            named(&mut browser, address, foreign_doc, "Копия")
                .await
                .status,
            403
        );
        assert_eq!(
            browser
                .patch_json(address, &detail, json!({"name": "Чужое"}))
                .await
                .status,
            403
        );
        assert_eq!(browser.delete(address, &detail).await.status, 403);
    }
    grant(&mut owner, address, account.id, true).await;
    let own_doc = create(&mut browser, address).await;
    for id in [foreign_doc, Uuid::now_v7(), own_doc] {
        let detail = format!("/api/v1/docs/{id}/versions/{vid}");
        assert_eq!(browser.get(address, &detail).await.status, 404);
        assert_eq!(
            browser
                .patch_json(address, &detail, json!({"name": "Чужое"}))
                .await
                .status,
            404
        );
        assert_eq!(browser.delete(address, &detail).await.status, 404);
        if id != own_doc {
            assert_eq!(named(&mut browser, address, id, "Чужое").await.status, 404);
            assert_eq!(
                browser
                    .get(address, &format!("/api/v1/docs/{id}/versions"))
                    .await
                    .status,
                404
            );
        }
    }
    let current = owner
        .get(address, &format!("/api/v1/docs/{foreign_doc}"))
        .await;
    let deleted = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            json!({"device_id": Uuid::now_v7(), "ops": [{
                "op_id": Uuid::now_v7(), "object_id": foreign_doc,
                "kind": "delete", "base_revision": current.body["revision"],
            }]}),
        )
        .await;
    assert_eq!(deleted.body["results"][0]["status"], "applied");
    let trash = browser.get(address, "/api/v1/docs?deleted=true").await;
    assert_eq!(trash.status, 200);
    assert!(trash.body["docs"].as_array().unwrap().is_empty());
    assert_eq!(browser.get(address, &detail).await.status, 404);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn sync_delete_lists_trash_preserves_versions_and_restore_returns_document() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let id = create(&mut browser, address).await;
    let doc = Doc::with_client_id(1);
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, "Текст в корзине");
    save(&mut browser, address, id, packet(&doc)).await;
    let version = named(&mut browser, address, id, "До удаления").await;
    let detail = format!(
        "/api/v1/docs/{id}/versions/{}",
        version.body["id"].as_str().unwrap()
    );
    let current = browser.get(address, &format!("/api/v1/docs/{id}")).await;
    let mut revision = current.body["revision"].clone();
    for kind in ["delete", "restore"] {
        let reply = browser
            .post_json(
                address,
                "/api/v1/sync/push",
                json!({
                    "device_id": Uuid::now_v7(), "ops": [{"op_id": Uuid::now_v7(),
                        "object_id": id, "kind": kind, "base_revision": revision}],
                }),
            )
            .await;
        assert_eq!(reply.status, 200);
        assert_eq!(reply.body["results"][0]["status"], "applied", "{}", reply.body);
        revision = reply.body["results"][0]["revision"].clone();
        let active = browser.get(address, "/api/v1/docs").await;
        let trash = browser.get(address, "/api/v1/docs?deleted=true").await;
        assert_eq!(active.status, 200);
        assert_eq!(trash.status, 200);
        let in_active = active.body["docs"]
            .as_array()
            .unwrap()
            .iter()
            .any(|doc| doc["id"] == id.to_string());
        let in_trash = trash.body["docs"]
            .as_array()
            .unwrap()
            .iter()
            .find(|doc| doc["id"] == id.to_string());
        assert_eq!(in_active, kind == "restore");
        assert_eq!(in_trash.is_some(), kind == "delete");
        if let Some(deleted) = in_trash {
            assert_eq!(deleted["title"], "Конспект");
            assert_eq!(deleted["preview"], "Текст в корзине");
            assert!(deleted["deleted_at"].is_string());
        }
        assert_eq!(list(&mut browser, address, id).await.len(), 1);
        assert_eq!(browser.get(address, &detail).await.body, version.body);
    }
    db.close().await;
    test_db.drop_db().await;
}
