//! Тесты ядра объектов на настоящей PostgreSQL (нужна `TEST_DATABASE_URL`).

use qubite_objects::{
    AuditEntry, BlobStore, Error, NewAuditEntry, NewObject, NewRelation, audit, events, files,
    new_id, objects, relations,
};
use qubite_testkit::TestDb;
use uuid::Uuid;

async fn setup() -> (TestDb, sqlx::PgPool) {
    let (test_db, db) = TestDb::migrated().await;
    (test_db, db.pool().clone())
}

#[tokio::test]
async fn create_and_get_object_writes_created_event() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();

    let object = objects::create(
        &mut conn,
        NewObject::new("inbox.item", owner, "Повторить графы"),
    )
    .await
    .unwrap();
    assert_eq!(object.revision, 1);
    assert_eq!(object.module_id, "inbox");
    assert_eq!(object.id.get_version_num(), 7, "ID — UUIDv7");

    let loaded = objects::get(&mut conn, object.id).await.unwrap().unwrap();
    assert_eq!(loaded, object);

    let history = events::for_object(&mut conn, object.id).await.unwrap();
    assert_eq!(history.len(), 1);
    assert_eq!(history[0].kind, "object.created");
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn client_side_id_is_kept_and_duplicate_id_is_rejected() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();
    let id = Uuid::now_v7();
    let mut new = NewObject::new("inbox.item", owner, "офлайн");
    new.id = Some(id);

    let object = objects::create(&mut conn, new.clone()).await.unwrap();
    assert_eq!(object.id, id);
    assert!(
        objects::create(&mut conn, new).await.is_err(),
        "тот же ID второй раз нельзя"
    );
    // Неудачная попытка не оставила лишнего события.
    assert_eq!(events::for_object(&mut conn, id).await.unwrap().len(), 1);
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn invalid_type_or_module_mismatch_is_rejected() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();

    let mut mismatch = NewObject::new("inbox.item", owner, "x");
    mismatch.module_id = "planner".into();
    assert!(matches!(
        objects::create(&mut conn, mismatch).await,
        Err(Error::Invalid(_))
    ));

    let bad_type = NewObject::new("Inbox Item", owner, "x");
    assert!(matches!(
        objects::create(&mut conn, bad_type).await,
        Err(Error::Invalid(_))
    ));
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn rename_checks_revision_and_reports_conflict() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();
    let object = objects::create(&mut conn, NewObject::new("docs.note", owner, "Черновик"))
        .await
        .unwrap();

    let renamed = objects::rename(&mut conn, object.id, 1, "Итог", owner)
        .await
        .unwrap();
    assert_eq!(renamed.revision, 2);
    assert_eq!(renamed.title, "Итог");

    // Второе устройство всё ещё думает, что версия 1.
    let stale = objects::rename(&mut conn, object.id, 1, "Другое", owner).await;
    assert!(matches!(
        stale,
        Err(Error::Conflict {
            expected: 1,
            current: 2
        })
    ));
    assert_eq!(
        objects::get(&mut conn, object.id)
            .await
            .unwrap()
            .unwrap()
            .title,
        "Итог"
    );

    assert!(matches!(
        objects::rename(&mut conn, new_id(), 1, "x", owner).await,
        Err(Error::NotFound)
    ));
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn concurrent_edits_of_same_revision_have_exactly_one_winner() {
    let (test_db, pool) = setup().await;
    let owner = new_id();
    let object = {
        let mut conn = pool.acquire().await.unwrap();
        objects::create(&mut conn, NewObject::new("docs.note", owner, "0"))
            .await
            .unwrap()
    };

    let mut tasks = Vec::new();
    for i in 0..10 {
        let pool = pool.clone();
        tasks.push(tokio::spawn(async move {
            let mut conn = pool.acquire().await.unwrap();
            objects::rename(&mut conn, object.id, 1, &format!("правка {i}"), owner).await
        }));
    }
    let mut wins = 0;
    let mut conflicts = 0;
    for task in tasks {
        match task.await.unwrap() {
            Ok(_) => wins += 1,
            Err(Error::Conflict { .. }) => conflicts += 1,
            Err(other) => panic!("неожиданная ошибка: {other}"),
        }
    }
    assert_eq!((wins, conflicts), (1, 9));
    test_db.drop_db().await;
}

#[tokio::test]
async fn delete_hides_object_and_restore_brings_it_back() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();
    let object = objects::create(&mut conn, NewObject::new("planner.task", owner, "Задача"))
        .await
        .unwrap();

    let deleted = objects::delete(&mut conn, object.id, 1, owner)
        .await
        .unwrap();
    assert!(deleted.is_deleted());
    assert!(objects::get(&mut conn, object.id).await.unwrap().is_none());
    assert!(
        objects::list_by_owner(&mut conn, owner, None, 50)
            .await
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        objects::rename(&mut conn, object.id, 2, "x", owner).await,
        Err(Error::Deleted)
    ));

    let restored = objects::restore(&mut conn, object.id, 2, owner)
        .await
        .unwrap();
    assert_eq!(restored.revision, 3);
    assert!(objects::get(&mut conn, object.id).await.unwrap().is_some());

    let kinds: Vec<String> = events::for_object(&mut conn, object.id)
        .await
        .unwrap()
        .into_iter()
        .map(|event| event.kind)
        .collect();
    assert_eq!(
        kinds,
        ["object.created", "object.deleted", "object.restored"]
    );
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn bump_inside_module_transaction_rolls_back_on_conflict() {
    let (test_db, pool) = setup().await;
    let owner = new_id();
    let mut conn = pool.acquire().await.unwrap();
    let object = objects::create(&mut conn, NewObject::new("planner.task", owner, "t"))
        .await
        .unwrap();
    objects::rename(&mut conn, object.id, 1, "t2", owner)
        .await
        .unwrap();

    // Модуль в своей транзакции меняет данные и поднимает версию со старым номером.
    let mut tx = sqlx::Connection::begin(&mut *conn).await.unwrap();
    let result = objects::bump(&mut tx, object.id, 1, owner, &["due_at"]).await;
    assert!(matches!(result, Err(Error::Conflict { .. })));
    tx.rollback().await.unwrap();

    let ok = objects::bump(&mut conn, object.id, 2, owner, &["due_at"])
        .await
        .unwrap();
    assert_eq!(ok.revision, 3);
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn relations_are_idempotent_and_hide_deleted_ends() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();
    let thought = objects::create(&mut conn, NewObject::new("inbox.item", owner, "мысль"))
        .await
        .unwrap();
    let task = objects::create(&mut conn, NewObject::new("planner.task", owner, "задача"))
        .await
        .unwrap();

    let first = relations::link(
        &mut conn,
        NewRelation::manual(task.id, thought.id, "derived_from", owner),
    )
    .await
    .unwrap();
    let again = relations::link(
        &mut conn,
        NewRelation::manual(task.id, thought.id, "derived_from", owner),
    )
    .await
    .unwrap();
    assert_eq!(first.id, again.id, "повторная связь не создаёт дубль");

    assert_eq!(
        relations::outgoing(&mut conn, task.id).await.unwrap().len(),
        1
    );
    assert_eq!(
        relations::incoming(&mut conn, thought.id)
            .await
            .unwrap()
            .len(),
        1
    );

    // Удалённый конец связи не показывается.
    objects::delete(&mut conn, thought.id, 1, owner)
        .await
        .unwrap();
    assert!(
        relations::outgoing(&mut conn, task.id)
            .await
            .unwrap()
            .is_empty()
    );
    // И к удалённому объекту новую связь не создать.
    assert!(matches!(
        relations::link(
            &mut conn,
            NewRelation::manual(task.id, thought.id, "related_to", owner)
        )
        .await,
        Err(Error::Deleted)
    ));

    objects::restore(&mut conn, thought.id, 2, owner)
        .await
        .unwrap();
    assert!(
        relations::unlink(&mut conn, task.id, thought.id, "derived_from", owner)
            .await
            .unwrap()
    );
    assert!(
        !relations::unlink(&mut conn, task.id, thought.id, "derived_from", owner)
            .await
            .unwrap()
    );
    assert!(
        relations::outgoing(&mut conn, task.id)
            .await
            .unwrap()
            .is_empty()
    );
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn relation_to_itself_or_missing_object_is_rejected() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();
    let a = objects::create(&mut conn, NewObject::new("docs.note", owner, "a"))
        .await
        .unwrap();

    assert!(matches!(
        relations::link(
            &mut conn,
            NewRelation::manual(a.id, a.id, "related_to", owner)
        )
        .await,
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        relations::link(
            &mut conn,
            NewRelation::manual(a.id, new_id(), "related_to", owner)
        )
        .await,
        Err(Error::NotFound)
    ));
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn events_and_audit_cannot_be_changed_or_deleted() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();
    objects::create(&mut conn, NewObject::new("docs.note", owner, "a"))
        .await
        .unwrap();
    let entry: AuditEntry = audit::record(
        &mut conn,
        NewAuditEntry {
            actor_id: Some(owner),
            action: "module_grant.created".into(),
            target_kind: "module_grant".into(),
            target_id: Some("docs:user".into()),
            after: Some(serde_json::json!({ "read": true })),
            reason: Some("тест".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        audit::for_target(&mut conn, "module_grant", "docs:user")
            .await
            .unwrap(),
        [entry]
    );

    for statement in [
        "UPDATE events SET kind = 'object.hacked'",
        "DELETE FROM events",
        "TRUNCATE events",
        "UPDATE audit_log SET reason = 'подделка'",
        "DELETE FROM audit_log",
        "TRUNCATE audit_log",
    ] {
        let result = sqlx::query(statement).execute(&mut *conn).await;
        assert!(result.is_err(), "должно быть запрещено: {statement}");
    }
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn events_after_cursor_return_in_order() {
    let (test_db, pool) = setup().await;
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();
    for i in 0..3 {
        objects::create(
            &mut conn,
            NewObject::new("docs.note", owner, format!("{i}")),
        )
        .await
        .unwrap();
    }
    let all = events::after(&mut conn, 0, 100).await.unwrap();
    assert_eq!(all.len(), 3);
    let rest = events::after(&mut conn, all[0].seq, 100).await.unwrap();
    assert_eq!(rest.len(), 2);
    assert!(rest[0].seq < rest[1].seq);
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn same_file_is_stored_once_and_can_be_attached() {
    let (test_db, pool) = setup().await;
    let dir = tempfile::tempdir().unwrap();
    let store = BlobStore::new(dir.path());
    let mut conn = pool.acquire().await.unwrap();
    let owner = new_id();
    let object = objects::create(&mut conn, NewObject::new("inbox.item", owner, "голос"))
        .await
        .unwrap();

    let content = b"hello qubite".repeat(10_000);
    let first = store
        .put(&mut conn, content.as_slice(), "audio/ogg")
        .await
        .unwrap();
    let second = store
        .put(&mut conn, content.as_slice(), "audio/ogg")
        .await
        .unwrap();
    assert_eq!(first, second);
    assert_eq!(first.size, i64::try_from(content.len()).unwrap());

    let blobs: i64 = sqlx::query_scalar("SELECT count(*) FROM file_blobs")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(blobs, 1, "одинаковое содержимое — одна запись");
    let on_disk = std::fs::read(store.path(first.sha256)).unwrap();
    assert_eq!(on_disk, content);
    let tmp_left = std::fs::read_dir(dir.path().join("tmp")).unwrap().count();
    assert_eq!(tmp_left, 0, "временные файлы убраны");

    files::attach(&mut conn, object.id, &first, "voice.ogg", owner)
        .await
        .unwrap();
    assert!(matches!(
        files::attach(&mut conn, object.id, &first, "voice.ogg", owner).await,
        Err(Error::Invalid(_))
    ));
    let list = files::attachments(&mut conn, object.id).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].sha256, first.sha256);
    assert_eq!(list[0].mime, "audio/ogg");
    drop(conn);
    test_db.drop_db().await;
}
