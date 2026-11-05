//! DOC-003a: производные упоминания, подсказки и права через HTTP.
mod common;

use std::net::SocketAddr;

use base64::{Engine, engine::general_purpose::STANDARD};
use common::{Browser, Reply, logged_in};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_db::Database;
use qubite_objects::{NewObject, NewRelation, objects, relations};
use qubite_planner::{PROJECT_TYPE, TASK_TYPE, folder::DOC_TYPE};
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use uuid::Uuid;
use yrs::updates::{decoder::Decode, encoder::Encode};
use yrs::{Doc, GetString, ReadTxn, StateVector, Text, Transact, Update};

async fn owner_id(db: &Database) -> Uuid {
    sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_one(db.pool())
        .await
        .unwrap()
}

async fn object(db: &Database, owner: Uuid, kind: &str, title: &str) -> Uuid {
    let mut conn = db.pool().acquire().await.unwrap();
    let object = objects::create(&mut conn, NewObject::new(kind, owner, title))
        .await
        .unwrap();
    if kind == DOC_TYPE {
        sqlx::query("INSERT INTO docs_pages (object_id) VALUES ($1)")
            .bind(object.id)
            .execute(&mut *conn)
            .await
            .unwrap();
    }
    object.id
}

async fn user(db: &Database, address: SocketAddr) -> (Uuid, Browser) {
    let account = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "links-user@qubite.ru",
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
            .login(address, "links-user@qubite.ru", common::PASSWORD)
            .await
            .status,
        200
    );
    (account.id, browser)
}

async fn grant(owner: &mut Browser, address: SocketAddr, account: Uuid, module: &str, write: bool) {
    let reply = owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{account}/grants/{module}"),
            json!({"read": true, "write": write, "manage": false, "ai": false}),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
}

fn packet(doc: &Doc, links: Option<&[Uuid]>) -> Value {
    let text = doc.get_or_insert_text("text");
    let txn = doc.transact();
    let mut packet = json!({
        "update": STANDARD.encode(txn.encode_state_as_update_v1(&StateVector::default())),
        "snapshot": STANDARD.encode(txn.snapshot().encode_v1()),
        "text": text.get_string(&txn),
    });
    if let Some(links) = links {
        packet["links"] = json!(links);
    }
    packet
}

async fn post(browser: &mut Browser, address: SocketAddr, id: Uuid, packet: Value) -> Reply {
    browser
        .post_json(address, &format!("/api/v1/docs/{id}/y"), packet)
        .await
}

async fn save(browser: &mut Browser, address: SocketAddr, id: Uuid, packet: Value) {
    let reply = post(browser, address, id, packet).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
}

async fn get(browser: &mut Browser, address: SocketAddr, path: &str, field: &str) -> Vec<Value> {
    let reply = browser.get(address, path).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    reply.body[field].as_array().unwrap().clone()
}

async fn links(browser: &mut Browser, address: SocketAddr, id: Uuid) -> Vec<Value> {
    get(
        browser,
        address,
        &format!("/api/v1/docs/{id}/links"),
        "links",
    )
    .await
}

async fn events(db: &Database, id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM events WHERE object_id = $1")
        .bind(id)
        .fetch_one(db.pool())
        .await
        .unwrap()
}

async fn live_relations(db: &Database, id: Uuid) -> Vec<(Uuid, Uuid, String)> {
    sqlx::query_as(
        "SELECT id, to_id, source FROM relations \
         WHERE from_id = $1 AND type = 'mentions' AND deleted_at IS NULL ORDER BY to_id",
    )
    .bind(id)
    .fetch_all(db.pool())
    .await
    .unwrap()
}

async fn trash(db: &Database, owner: Uuid, id: Uuid, restore: bool) {
    let mut conn = db.pool().acquire().await.unwrap();
    let current = objects::get_any(&mut conn, id).await.unwrap().unwrap();
    if restore {
        objects::restore(&mut conn, id, current.revision, owner)
            .await
            .unwrap();
    } else {
        objects::delete(&mut conn, id, current.revision, owner)
            .await
            .unwrap();
    }
}

#[tokio::test]
async fn link_lists_replace_atomically_and_retries_do_not_emit_events() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    let source = object(&db, owner, DOC_TYPE, "Источник").await;
    let first = object(&db, owner, DOC_TYPE, "Первый").await;
    let second = object(&db, owner, TASK_TYPE, "Второй").await;
    let doc = Doc::with_client_id(1);
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, "Текст");
    let initial = packet(&doc, Some(&[first]));
    let reply = post(&mut browser, address, source, initial.clone()).await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    let before = live_relations(&db, source).await;
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].1, first);
    assert_eq!(before[0].2, "manual");
    let count = events(&db, source).await;
    save(&mut browser, address, source, initial).await;
    assert_eq!(live_relations(&db, source).await, before);
    assert_eq!(events(&db, source).await, count);

    // Yjs не изменился, но новый список всё равно принимается.
    let both = packet(&doc, Some(&[first, second]));
    save(&mut browser, address, source, both).await;
    let current = live_relations(&db, source).await;
    assert_eq!(current.len(), 2);
    assert!(current.contains(&before[0]));
    assert_eq!(events(&db, source).await, count + 1);

    // Старый клиент прислал правку без links: обе связи остаются.
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, "Новый ");
    let mut legacy = packet(&doc, None);
    legacy.as_object_mut().unwrap().remove("snapshot");
    save(&mut browser, address, source, legacy).await;
    assert_eq!(live_relations(&db, source).await, current);
    let count = events(&db, source).await;

    // И старый клиент без snapshot может заменить список при повторе Yjs.
    let mut only_second = packet(&doc, Some(&[second]));
    only_second.as_object_mut().unwrap().remove("snapshot");
    save(&mut browser, address, source, only_second).await;
    assert_eq!(
        links(&mut browser, address, source).await[0]["id"],
        second.to_string()
    );
    assert_eq!(live_relations(&db, source).await.len(), 1);
    assert_eq!(events(&db, source).await, count + 1);
    save(&mut browser, address, source, packet(&doc, Some(&[]))).await;
    assert!(links(&mut browser, address, source).await.is_empty());
    let count = events(&db, source).await;
    save(&mut browser, address, source, packet(&doc, Some(&[]))).await;
    assert_eq!(events(&db, source).await, count);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn trashed_targets_keep_existing_links_across_edits_until_explicitly_removed() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    for kind in [DOC_TYPE, TASK_TYPE, PROJECT_TYPE] {
        let source = object(&db, owner, DOC_TYPE, "Источник").await;
        let target = object(&db, owner, kind, "Цель").await;
        let doc = Doc::with_client_id(1);
        let text = doc.get_or_insert_text("text");
        text.insert(&mut doc.transact_mut(), 0, "Текст");
        save(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
        let original = live_relations(&db, source).await;
        assert_eq!(original.len(), 1);

        trash(&db, owner, target, false).await;
        text.insert(&mut doc.transact_mut(), 0, "Правка: ");
        let reply = post(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
        assert_eq!(reply.status, 200, "{}", reply.body);
        assert_eq!(reply.body["text_stale"], false);
        assert_eq!(live_relations(&db, source).await, original);
        assert_eq!(
            links(&mut browser, address, source).await,
            vec![json!({"id": target, "type": kind, "title": "Цель", "deleted": true})]
        );

        // Восстановление возвращает обратную ссылку без нового POST /y.
        trash(&db, owner, target, true).await;
        let mut paths = vec![format!("/api/v1/objects/{target}/backlinks")];
        if kind == DOC_TYPE {
            paths.push(format!("/api/v1/docs/{target}/backlinks"));
        }
        for path in &paths {
            assert_eq!(
                get(&mut browser, address, path, "backlinks").await,
                vec![json!({"id": source, "type": DOC_TYPE, "title": "Источник"})]
            );
        }
        assert_eq!(
            links(&mut browser, address, source).await[0]["deleted"],
            false
        );

        // Удаление UUID из links убирает связь даже с целью в корзине.
        trash(&db, owner, target, false).await;
        save(&mut browser, address, source, packet(&doc, Some(&[]))).await;
        assert!(live_relations(&db, source).await.is_empty());
        assert!(links(&mut browser, address, source).await.is_empty());
        // Повторное добавление UUID не создаёт связь с удалённой целью.
        save(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
        assert!(live_relations(&db, source).await.is_empty());
        assert!(links(&mut browser, address, source).await.is_empty());
        trash(&db, owner, target, true).await;
        for path in &paths {
            assert!(
                get(&mut browser, address, path, "backlinks")
                    .await
                    .is_empty()
            );
        }
    }
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn concurrent_reciprocal_mentions_save_both_documents_without_deadlock() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut first_browser = logged_in(address).await;
    let mut second_browser = first_browser.clone();
    let owner = owner_id(&db).await;
    for iteration in 0..20 {
        // Новые пары каждый раз проходят INSERT relations с проверкой обоих FK.
        let first = object(&db, owner, DOC_TYPE, "Первый").await;
        let second = object(&db, owner, DOC_TYPE, "Второй").await;
        let first_doc = Doc::with_client_id(1);
        first_doc.get_or_insert_text("text").insert(
            &mut first_doc.transact_mut(),
            0,
            "Из первого во второй",
        );
        let second_doc = Doc::with_client_id(2);
        second_doc.get_or_insert_text("text").insert(
            &mut second_doc.transact_mut(),
            0,
            "Из второго в первый",
        );
        let (first_reply, second_reply) = tokio::join!(
            post(
                &mut first_browser,
                address,
                first,
                packet(&first_doc, Some(&[second])),
            ),
            post(
                &mut second_browser,
                address,
                second,
                packet(&second_doc, Some(&[first])),
            ),
        );
        assert_eq!(
            first_reply.status, 200,
            "iteration {iteration}, first: {}",
            first_reply.body
        );
        assert_eq!(
            second_reply.status, 200,
            "iteration {iteration}, second: {}",
            second_reply.body
        );
        for (id, target, title, text) in [
            (first, second, "Второй", "Из первого во второй"),
            (second, first, "Первый", "Из второго в первый"),
        ] {
            assert_eq!(
                links(&mut first_browser, address, id).await,
                vec![json!({"id": target, "type": DOC_TYPE, "title": title, "deleted": false})]
            );
            let saved = first_browser
                .get(address, &format!("/api/v1/docs/{id}/y"))
                .await;
            assert_eq!(saved.status, 200, "{}", saved.body);
            let bytes = STANDARD
                .decode(saved.body["update"].as_str().unwrap())
                .unwrap();
            let persisted = Doc::new();
            let persisted_text = persisted.get_or_insert_text("text");
            persisted
                .transact_mut()
                .apply_update(Update::decode_v1(&bytes).unwrap())
                .unwrap();
            assert_eq!(persisted_text.get_string(&persisted.transact()), text);
        }
    }
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn inaccessible_targets_are_ignored_and_invalid_lists_do_not_save() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    let (other, _) = user(&db, address).await;
    let source = object(&db, owner, DOC_TYPE, "Источник").await;
    let valid = object(&db, owner, PROJECT_TYPE, "Проект").await;
    let foreign = object(&db, other, DOC_TYPE, "Чужое").await;
    let deleted = object(&db, owner, DOC_TYPE, "Удалено").await;
    trash(&db, owner, deleted, false).await;
    let doc = Doc::with_client_id(1);
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, "Сохранено");
    let reply = post(
        &mut browser,
        address,
        source,
        packet(
            &doc,
            Some(&[valid, foreign, Uuid::now_v7(), deleted, source]),
        ),
    )
    .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(
        links(&mut browser, address, source).await,
        vec![json!({
            "id": valid, "type": PROJECT_TYPE, "title": "Проект", "deleted": false,
        })]
    );
    let before = browser
        .get(address, &format!("/api/v1/docs/{source}/y"))
        .await
        .body;
    let count = events(&db, source).await;
    let before_relations = live_relations(&db, source).await;
    doc.get_or_insert_text("text")
        .insert(&mut doc.transact_mut(), 0, "Не сохранять ");
    for invalid in [
        json!(["не uuid"]),
        json!([valid, valid]),
        json!((0..201).map(|_| Uuid::now_v7()).collect::<Vec<_>>()),
        json!([42]),
        json!(null),
        json!("строка"),
    ] {
        let mut request = packet(&doc, None);
        request["links"] = invalid;
        let reply = post(&mut browser, address, source, request).await;
        assert_eq!(reply.status, 400, "{}", reply.body);
        assert_eq!(reply.body["error"], "invalid_update");
    }
    assert_eq!(
        browser
            .get(address, &format!("/api/v1/docs/{source}/y"))
            .await
            .body,
        before
    );
    assert_eq!(events(&db, source).await, count);
    assert_eq!(live_relations(&db, source).await, before_relations);
    let saved = browser
        .get(address, &format!("/api/v1/docs/{source}"))
        .await;
    assert_eq!(saved.body["body"], "Сохранено");

    // Ровно 200 уникальных UUID допустимы, даже если целей ещё нет.
    let boundary: Vec<_> = (0..200).map(|_| Uuid::now_v7()).collect();
    save(&mut browser, address, source, packet(&doc, Some(&boundary))).await;
    assert!(links(&mut browser, address, source).await.is_empty());
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn stale_snapshots_keep_links_until_the_merged_projection_arrives() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    let source = object(&db, owner, DOC_TYPE, "Источник").await;
    let target = object(&db, owner, DOC_TYPE, "Цель").await;
    let doc = Doc::with_client_id(1);
    let text = doc.get_or_insert_text("text");
    text.insert(&mut doc.transact_mut(), 0, "abcdef");
    let stale = packet(&doc, Some(&[]));
    save(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
    // Удаление не меняет вектор состояния; нужен именно snapshot.
    text.remove_range(&mut doc.transact_mut(), 0, 1);
    save(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
    let count = events(&db, source).await;
    let reply = post(&mut browser, address, source, stale).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["text_stale"], true);
    assert_eq!(links(&mut browser, address, source).await.len(), 1);
    assert_eq!(events(&db, source).await, count);

    // Устаревший снимок вместе с новыми вставками: Yjs сливается, links не меняются.
    let concurrent = Doc::with_client_id(2);
    concurrent.get_or_insert_text("text").insert(
        &mut concurrent.transact_mut(),
        0,
        "С другого устройства",
    );
    let reply = post(
        &mut browser,
        address,
        source,
        packet(&concurrent, Some(&[])),
    )
    .await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["text_stale"], true);
    assert_eq!(links(&mut browser, address, source).await.len(), 1);

    // Клиент забирает слитое состояние и досылает актуальные text + links.
    let reply = browser
        .get(address, &format!("/api/v1/docs/{source}/y"))
        .await;
    let update = STANDARD
        .decode(reply.body["update"].as_str().unwrap())
        .unwrap();
    doc.transact_mut()
        .apply_update(Update::decode_v1(&update).unwrap())
        .unwrap();
    let reply = post(&mut browser, address, source, packet(&doc, Some(&[]))).await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["text_stale"], false);
    assert!(links(&mut browser, address, source).await.is_empty());
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn target_search_orders_documents_first_then_recency_and_caps_at_eight() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    let (other, _) = user(&db, address).await;
    object(&db, other, DOC_TYPE, "Метка чужая").await;
    object(&db, owner, "inbox.item", "Метка мысль").await;
    let deleted = object(&db, owner, DOC_TYPE, "Метка удалена").await;
    trash(&db, owner, deleted, false).await;
    let old_doc = object(&db, owner, DOC_TYPE, "Метка старый документ").await;
    let new_doc = object(&db, owner, DOC_TYPE, "Метка новый документ").await;
    let project = object(&db, owner, PROJECT_TYPE, "Метка проект").await;
    let task = object(&db, owner, TASK_TYPE, "Метка дело").await;
    let event = object(&db, owner, "calendar.event", "Метка событие").await;
    for (id, minutes) in [
        (old_doc, 40_i32),
        (new_doc, 30),
        (project, 20),
        (task, 10),
        (event, 50),
    ] {
        sqlx::query(
            "UPDATE objects SET updated_at = now() - $2::int * interval '1 minute' WHERE id = $1",
        )
        .bind(id)
        .bind(minutes)
        .execute(db.pool())
        .await
        .unwrap();
    }
    let expected = vec![new_doc, old_doc, task, project, event];
    for query in ["", "?q=", "?q=%D0%BC%D0%95%D1%82%D0%9A%D0%B0"] {
        let targets = get(
            &mut browser,
            address,
            &format!("/api/v1/docs/link-targets{query}"),
            "targets",
        )
        .await;
        let ids: Vec<Uuid> = targets
            .iter()
            .map(|item| item["id"].as_str().unwrap().parse().unwrap())
            .collect();
        assert_eq!(ids, expected);
    }
    let result = get(
        &mut browser,
        address,
        "/api/v1/docs/link-targets?q=%D0%B4%D0%B5%D0%BB%D0%BE",
        "targets",
    )
    .await;
    assert_eq!(
        result,
        vec![json!({"id": task, "type": TASK_TYPE, "title": "Метка дело"})]
    );
    let literal_percent = get(
        &mut browser,
        address,
        "/api/v1/docs/link-targets?q=%25",
        "targets",
    )
    .await;
    assert!(literal_percent.is_empty());
    for index in 0..10 {
        object(&db, owner, TASK_TYPE, &format!("Ещё {index}")).await;
    }
    let targets = get(
        &mut browser,
        address,
        "/api/v1/docs/link-targets",
        "targets",
    )
    .await;
    assert_eq!(targets.len(), 8);
    assert_eq!(targets[0]["id"], new_doc.to_string());
    assert_eq!(targets[1]["id"], old_doc.to_string());
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn links_resolve_current_titles_and_trash_state_then_restore() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    let source = object(&db, owner, DOC_TYPE, "Источник").await;
    let target = object(&db, owner, TASK_TYPE, "До переименования").await;
    let doc = Doc::with_client_id(1);
    save(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
    let mut conn = db.pool().acquire().await.unwrap();
    objects::rename(&mut conn, target, 1, "После переименования", owner)
        .await
        .unwrap();
    drop(conn);
    assert_eq!(
        links(&mut browser, address, source).await[0]["title"],
        "После переименования"
    );
    trash(&db, owner, target, false).await;
    assert_eq!(
        links(&mut browser, address, source).await,
        vec![json!({
            "id": target, "type": TASK_TYPE, "title": "После переименования", "deleted": true,
        })]
    );
    let targets = get(
        &mut browser,
        address,
        "/api/v1/docs/link-targets",
        "targets",
    )
    .await;
    assert!(!targets.iter().any(|item| item["id"] == target.to_string()));
    trash(&db, owner, target, true).await;
    assert_eq!(
        links(&mut browser, address, source).await[0]["deleted"],
        false
    );
    let targets = get(
        &mut browser,
        address,
        "/api/v1/docs/link-targets",
        "targets",
    )
    .await;
    assert!(targets.iter().any(|item| item["id"] == target.to_string()));
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn backlinks_filter_foreign_deleted_and_unreadable_objects_and_require_grants() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner_browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    let (account, mut browser) = user(&db, address).await;
    let source = object(&db, account, DOC_TYPE, "Мой документ").await;
    let target = object(&db, account, DOC_TYPE, "Моя цель").await;
    let task = object(&db, account, TASK_TYPE, "Моё дело").await;
    let foreign = object(&db, owner, DOC_TYPE, "Чужой источник").await;
    let deleted = object(&db, account, DOC_TYPE, "Удалённый источник").await;
    let mut conn = db.pool().acquire().await.unwrap();
    for from in [source, task, foreign, deleted] {
        relations::link(
            &mut conn,
            NewRelation::manual(from, target, "mentions", account),
        )
        .await
        .unwrap();
    }
    relations::link(
        &mut conn,
        NewRelation::manual(source, foreign, "mentions", account),
    )
    .await
    .unwrap();
    relations::link(
        &mut conn,
        NewRelation::manual(source, task, "mentions", account),
    )
    .await
    .unwrap();
    relations::link(
        &mut conn,
        NewRelation::manual(source, target, "related_to", account),
    )
    .await
    .unwrap();
    drop(conn);
    trash(&db, account, deleted, false).await;

    let paths = [
        "/api/v1/docs/link-targets".to_owned(),
        format!("/api/v1/docs/{target}/backlinks"),
        format!("/api/v1/objects/{target}/backlinks"),
        format!("/api/v1/docs/{source}/links"),
    ];
    for path in &paths {
        assert_eq!(browser.get(address, path).await.status, 403);
    }
    grant(&mut owner_browser, address, account, "docs", false).await;
    let expected = vec![json!({
        "id": source, "type": DOC_TYPE, "title": "Мой документ",
    })];
    for path in &paths[1..3] {
        assert_eq!(
            get(&mut browser, address, path, "backlinks").await,
            expected
        );
    }
    let outgoing = links(&mut browser, address, source).await;
    assert_eq!(outgoing.len(), 1);
    assert_eq!(outgoing[0]["id"], target.to_string());
    let targets = get(&mut browser, address, &paths[0], "targets").await;
    assert!(targets.iter().all(|item| item["type"] == DOC_TYPE));
    let doc = Doc::with_client_id(1);
    let denied = post(&mut browser, address, source, packet(&doc, Some(&[]))).await;
    assert_eq!(denied.status, 403);
    for id in [foreign, deleted, Uuid::now_v7()] {
        for path in [
            format!("/api/v1/docs/{id}/backlinks"),
            format!("/api/v1/objects/{id}/backlinks"),
            format!("/api/v1/docs/{id}/links"),
        ] {
            assert_eq!(browser.get(address, &path).await.status, 404);
        }
    }
    let task_path = format!("/api/v1/objects/{task}/backlinks");
    assert_eq!(browser.get(address, &task_path).await.status, 404);
    grant(&mut owner_browser, address, account, "planner", false).await;
    let backlinks = get(&mut browser, address, &paths[1], "backlinks").await;
    assert_eq!(backlinks.len(), 2);
    assert!(backlinks.iter().any(|item| item["id"] == task.to_string()));
    assert_eq!(
        get(&mut browser, address, &task_path, "backlinks").await,
        expected
    );
    let doc_path = format!("/api/v1/docs/{task}/backlinks");
    assert_eq!(browser.get(address, &doc_path).await.status, 404);
    assert_eq!(links(&mut browser, address, source).await.len(), 2);

    // Нельзя записать упоминание даже своей цели из модуля без read.
    grant(&mut owner_browser, address, account, "docs", true).await;
    let revoked = owner_browser
        .delete(
            address,
            &format!("/api/owner/accounts/{account}/grants/planner"),
        )
        .await;
    assert_eq!(revoked.status, 204);
    save(
        &mut browser,
        address,
        source,
        packet(&doc, Some(&[target, task, foreign])),
    )
    .await;
    assert_eq!(live_relations(&db, source).await.len(), 1);
    let forbidden = post(
        &mut browser,
        address,
        foreign,
        packet(&doc, Some(&[target])),
    )
    .await;
    assert_eq!(forbidden.status, 404);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn restore_snapshots_old_state_but_replaces_links_from_the_new_update() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    let source = object(&db, owner, DOC_TYPE, "Источник").await;
    let first = object(&db, owner, DOC_TYPE, "Первая цель").await;
    let second = object(&db, owner, DOC_TYPE, "Вторая цель").await;
    let doc = Doc::with_client_id(1);
    let text = doc.get_or_insert_text("text");
    text.insert(&mut doc.transact_mut(), 0, "Первая версия");
    save(&mut browser, address, source, packet(&doc, Some(&[first]))).await;
    let named = browser
        .post_json(
            address,
            &format!("/api/v1/docs/{source}/versions"),
            json!({"name": "Первая"}),
        )
        .await;
    assert_eq!(named.status, 201);
    sqlx::query(
        "UPDATE docs_versions SET created_at = now() - interval '11 minutes' WHERE doc_id = $1",
    )
    .bind(source)
    .execute(db.pool())
    .await
    .unwrap();
    let len = text.len(&doc.transact());
    text.remove_range(&mut doc.transact_mut(), 0, len);
    text.insert(&mut doc.transact_mut(), 0, "Вторая версия");
    save(&mut browser, address, source, packet(&doc, Some(&[second]))).await;
    let before = packet(&doc, Some(&[second]));
    // Чтение снимка само по себе не меняет текущие связи.
    let detail = browser
        .get(
            address,
            &format!(
                "/api/v1/docs/{source}/versions/{}",
                named.body["id"].as_str().unwrap()
            ),
        )
        .await;
    assert_eq!(detail.status, 200);
    assert_eq!(
        links(&mut browser, address, source).await[0]["id"],
        second.to_string()
    );
    // Клиент восстанавливает содержимое новой правкой поверх текущего Y.Doc.
    let len = text.len(&doc.transact());
    text.remove_range(&mut doc.transact_mut(), 0, len);
    text.insert(&mut doc.transact_mut(), 0, "Первая версия");
    let mut restore = packet(&doc, Some(&[first]));
    restore["reason"] = json!("restore");
    restore["restore_of"] = named.body["id"].clone();
    save(&mut browser, address, source, restore).await;
    let outgoing = links(&mut browser, address, source).await;
    assert_eq!(outgoing.len(), 1);
    assert_eq!(outgoing[0]["id"], first.to_string());
    let versions = get(
        &mut browser,
        address,
        &format!("/api/v1/docs/{source}/versions"),
        "versions",
    )
    .await;
    assert_eq!(versions.len(), 3);
    let auto = versions
        .iter()
        .find(|version| version["kind"] == "auto")
        .unwrap();
    assert_eq!(auto["preview"], "Первая версия");
    let saved = browser
        .get(
            address,
            &format!(
                "/api/v1/docs/{source}/versions/{}",
                versions[0]["id"].as_str().unwrap()
            ),
        )
        .await;
    assert_eq!(saved.body["kind"], "before_restore");
    assert_eq!(saved.body["ystate"], before["update"]);
    assert_eq!(saved.body["text"], before["text"]);
    assert_eq!(links(&mut browser, address, source).await, outgoing);
    db.close().await;
    test_db.drop_db().await;
}

async fn calendar_event(browser: &mut Browser, address: SocketAddr, title: &str) -> Uuid {
    let reply = browser
        .post_json(
            address,
            "/api/calendar/events",
            json!({"title": title, "starts_at": 1000, "ends_at": 2000}),
        )
        .await;
    assert_eq!(reply.status, 201, "{}", reply.body);
    reply.body["id"].as_str().unwrap().parse().unwrap()
}

#[tokio::test]
async fn calendar_mentions_follow_event_creation_rename_and_deletion() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut browser = logged_in(address).await;
    let owner = owner_id(&db).await;
    let source = object(&db, owner, DOC_TYPE, "Источник").await;
    let target = calendar_event(&mut browser, address, "Calendar original").await;
    let path = format!("/api/calendar/events/{target}");
    let targets = get(
        &mut browser,
        address,
        "/api/v1/docs/link-targets?q=original",
        "targets",
    )
    .await;
    assert_eq!(
        targets,
        vec![json!({"id": target, "type": "calendar.event", "title": "Calendar original"})]
    );
    let doc = Doc::with_client_id(1);
    save(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
    assert_eq!(
        links(&mut browser, address, source).await,
        vec![json!({
            "id": target, "type": "calendar.event", "title": "Calendar original", "deleted": false,
        })]
    );
    assert_eq!(
        get(
            &mut browser,
            address,
            &format!("/api/v1/objects/{target}/backlinks"),
            "backlinks",
        )
        .await,
        vec![json!({"id": source, "type": DOC_TYPE, "title": "Источник"})]
    );
    assert_eq!(
        browser
            .get(address, &format!("/api/v1/docs/{target}/backlinks"))
            .await
            .status,
        404
    );
    let reply = browser
        .patch_json(
            address,
            &path,
            json!({"title": "Calendar renamed", "revision": 1}),
        )
        .await;
    assert_eq!(reply.status, 200, "{}", reply.body);
    assert_eq!(
        browser
            .patch_json(address, &path, json!({"title": "Stale", "revision": 1}))
            .await
            .status,
        409
    );
    let targets = get(
        &mut browser,
        address,
        "/api/v1/docs/link-targets?q=renamed",
        "targets",
    )
    .await;
    assert_eq!(targets[0]["title"], "Calendar renamed");
    assert!(
        get(
            &mut browser,
            address,
            "/api/v1/docs/link-targets?q=original",
            "targets",
        )
        .await
        .is_empty()
    );
    let core: (String, i64) = sqlx::query_as("SELECT title, revision FROM objects WHERE id=$1")
        .bind(target)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(core, ("Calendar renamed".to_owned(), 2));
    assert_eq!(browser.delete(address, &path).await.status, 204);
    assert_eq!(
        links(&mut browser, address, source).await,
        vec![json!({
            "id": target, "type": "calendar.event", "title": "Calendar renamed", "deleted": true,
        })]
    );
    // Правка документа сохраняет прежнюю ссылку на удалённое событие.
    save(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
    assert_eq!(
        links(&mut browser, address, source).await[0]["deleted"],
        true
    );
    assert!(
        get(
            &mut browser,
            address,
            "/api/v1/docs/link-targets?q=Calendar",
            "targets",
        )
        .await
        .is_empty()
    );
    assert_eq!(browser.get(address, &path).await.status, 404);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn calendar_mentions_require_planner_read_and_hide_foreign_events() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner_browser = logged_in(address).await;
    let foreign = calendar_event(&mut owner_browser, address, "Foreign calendar").await;
    let (account, mut browser) = user(&db, address).await;
    grant(&mut owner_browser, address, account, "docs", true).await;
    grant(&mut owner_browser, address, account, "planner", true).await;
    let target = calendar_event(&mut browser, address, "My calendar").await;
    let source = object(&db, account, DOC_TYPE, "Источник").await;
    let doc = Doc::with_client_id(1);
    save(
        &mut browser,
        address,
        source,
        packet(&doc, Some(&[target, foreign])),
    )
    .await;
    assert_eq!(links(&mut browser, address, source).await.len(), 1);
    let targets_path = "/api/v1/docs/link-targets?q=calendar";
    let targets = get(&mut browser, address, targets_path, "targets").await;
    assert_eq!(targets.len(), 1);
    assert_eq!(targets[0]["id"], target.to_string());
    for path in [
        format!("/api/calendar/events/{foreign}"),
        format!("/api/v1/objects/{foreign}/backlinks"),
    ] {
        assert_eq!(browser.get(address, &path).await.status, 404);
    }
    let backlinks_path = format!("/api/v1/objects/{target}/backlinks");
    // Для ссылок достаточно read, право write на Planner не требуется.
    grant(&mut owner_browser, address, account, "planner", false).await;
    assert_eq!(
        get(&mut browser, address, &backlinks_path, "backlinks")
            .await
            .len(),
        1
    );
    let reply = owner_browser
        .delete(
            address,
            &format!("/api/owner/accounts/{account}/grants/planner"),
        )
        .await;
    assert_eq!(reply.status, 204);
    assert!(
        get(&mut browser, address, targets_path, "targets")
            .await
            .is_empty()
    );
    assert!(links(&mut browser, address, source).await.is_empty());
    assert_eq!(browser.get(address, &backlinks_path).await.status, 404);
    save(&mut browser, address, source, packet(&doc, Some(&[target]))).await;
    assert!(live_relations(&db, source).await.is_empty());
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn calendar_objects_migration_backfills_live_and_deleted_events_idempotently() {
    let (test_db, db, _address) = common::setup(AuthSettings::default()).await;
    let owner = owner_id(&db).await;
    let live = Uuid::now_v7();
    let deleted = Uuid::now_v7();
    // Старые события создаются напрямую, без объекта ядра.
    for (id, is_deleted) in [(live, false), (deleted, true)] {
        sqlx::query(
            "INSERT INTO calendar_events \
             (id, owner_id, title, starts_at, ends_at, deleted, created_at, updated_at) \
             VALUES ($1, $2, 'Existing event', 1000, 2000, $3, \
                     now() - interval '2 days', now() - interval '1 day')",
        )
        .bind(id)
        .bind(owner)
        .bind(is_deleted)
        .execute(db.pool())
        .await
        .unwrap();
    }
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM objects WHERE id=ANY($1)")
        .bind(&[live, deleted][..])
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(before, 0);
    for _ in 0..2 {
        sqlx::query(include_str!(
            "../../qubite-db/migrations/0047_calendar_event_objects.sql"
        ))
        .execute(db.pool())
        .await
        .unwrap();
        let matching: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM calendar_events e JOIN objects o ON o.id=e.id \
             WHERE e.id=ANY($1) AND o.type='calendar.event' AND o.module_id='calendar' \
             AND o.owner_id=e.owner_id AND o.created_by=e.owner_id AND o.updated_by=e.owner_id \
             AND o.title=e.title AND o.created_at=e.created_at AND o.updated_at=e.updated_at \
             AND o.deleted_at IS NOT DISTINCT FROM (CASE WHEN e.deleted THEN e.updated_at END) \
             AND o.revision=1 AND o.visibility='private' AND o.workspace_id IS NULL \
             AND o.source_refs='[]'::jsonb",
        )
        .bind(&[live, deleted][..])
        .fetch_one(db.pool())
        .await
        .unwrap();
        assert_eq!(matching, 2);
    }
    db.close().await;
    test_db.drop_db().await;
}
