//! Курсор синхронизации не теряет изменения (SYNC-007, D-875…D-877).
//!
//! Первые два теста — воспроизведения из ревью 12.11.2026
//! (`docs/reports/code-review-2026-11-12-reproduction.md`), перевёрнутые:
//! раньше они подтверждали потерю, теперь проверяют, что её нет.
//! Нужна настоящая PostgreSQL (`TEST_DATABASE_URL`).

use std::{collections::HashSet, path::Path, sync::Arc, time::Duration};

use qubite_objects::{NewObject, objects};
use qubite_sync::Cursor;
use qubite_sync_server::{Rules, pull, pull_with};
use qubite_testkit::TestDb;
use sqlx::{PgPool, migrate::Migrator};
use uuid::Uuid;

fn readable(modules: &[&str]) -> Rules {
    Rules {
        readable: Some(modules.iter().map(|module| (*module).to_owned()).collect()),
        ..Default::default()
    }
}

async fn create(pool: &PgPool, object_type: &str, owner: Uuid, title: &str) -> Uuid {
    let mut conn = pool.acquire().await.unwrap();
    objects::create(&mut conn, NewObject::new(object_type, owner, title))
        .await
        .unwrap()
        .id
}

fn ids(changes: &[qubite_sync::ObjectSnapshot]) -> Vec<Uuid> {
    changes.iter().map(|snapshot| snapshot.id).collect()
}

/// Замечание 2: медленная транзакция начала раньше, а закончила позже быстрой.
#[tokio::test]
async fn transaction_committed_later_is_not_missed() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();

    // Медленная получает номер события первой, но ещё не зафиксирована.
    let mut slow = pool.begin().await.unwrap();
    let a = objects::create(
        &mut slow,
        NewObject::new("inbox.item", owner, "slow transaction"),
    )
    .await
    .unwrap();
    let b = create(pool, "inbox.item", owner, "fast transaction").await;

    let first = pull(pool, owner, 0, 100).await.unwrap();
    assert_eq!(ids(&first.changes), [b], "видна только зафиксированная");

    slow.commit().await.unwrap();
    let next = pull(pool, owner, &first.cursor, 100).await.unwrap();
    assert_eq!(
        ids(&next.changes),
        [a.id],
        "изменение, зафиксированное позже, приходит следующим запросом"
    );
    let rest = pull(pool, owner, &next.cursor, 100).await.unwrap();
    assert!(rest.changes.is_empty(), "и только один раз");
    let full = pull(pool, owner, 0, 100).await.unwrap();
    assert_eq!(full.changes.len(), 2);
    test_db.drop_db().await;
}

/// Замечание 7: доступ к модулю выдали позже — его старые объекты приходят.
#[tokio::test]
async fn module_granted_later_is_backfilled() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let doc = create(pool, "docs.page", owner, "existing doc").await;
    let inbox = create(pool, "inbox.item", owner, "visible inbox").await;

    let first = pull_with(pool, owner, 0, 100, &readable(&["inbox"]))
        .await
        .unwrap();
    assert_eq!(ids(&first.changes), [inbox]);

    // Выдали доступ к Docs: старый документ приходит, Входящие не повторяются.
    let both = readable(&["inbox", "docs"]);
    let next = pull_with(pool, owner, &first.cursor, 100, &both)
        .await
        .unwrap();
    assert_eq!(ids(&next.changes), [doc], "старый объект нового модуля");
    let rest = pull_with(pool, owner, &next.cursor, 100, &both)
        .await
        .unwrap();
    assert!(rest.changes.is_empty());

    // Доступ отозвали, документы менялись, доступ вернули: модуль продолжает
    // с того места, где остановился, — изменения за время отзыва не теряются.
    let later_doc = create(pool, "docs.page", owner, "written while revoked").await;
    let later_inbox = create(pool, "inbox.item", owner, "new inbox").await;
    let revoked = pull_with(pool, owner, &rest.cursor, 100, &readable(&["inbox"]))
        .await
        .unwrap();
    assert_eq!(ids(&revoked.changes), [later_inbox]);
    let regranted = pull_with(pool, owner, &revoked.cursor, 100, &both)
        .await
        .unwrap();
    assert_eq!(ids(&regranted.changes), [later_doc]);
    test_db.drop_db().await;
}

/// Страницы и модули вместе: новый модуль догоняется постранично.
#[tokio::test]
async fn backfill_of_a_new_module_is_paged() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let mut docs = Vec::new();
    for n in 0..5 {
        docs.push(create(pool, "docs.page", owner, &format!("doc {n}")).await);
    }
    let inbox = create(pool, "inbox.item", owner, "inbox").await;
    let first = pull_with(pool, owner, 0, 100, &readable(&["inbox"]))
        .await
        .unwrap();
    assert_eq!(ids(&first.changes), [inbox]);

    let both = readable(&["inbox", "docs"]);
    let mut cursor = first.cursor;
    let mut seen = Vec::new();
    loop {
        let page = pull_with(pool, owner, &cursor, 2, &both).await.unwrap();
        seen.extend(ids(&page.changes));
        cursor = page.cursor;
        if !page.has_more {
            break;
        }
    }
    assert_eq!(seen, docs, "все документы, по порядку, без повторов");
    test_db.drop_db().await;
}

/// Объект менялся много раз — в ленте он один, с последней позицией.
#[tokio::test]
async fn feed_keeps_one_row_per_object() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let first = create(pool, "inbox.item", owner, "first").await;
    let second = create(pool, "inbox.item", owner, "second").await;
    let mut conn = pool.acquire().await.unwrap();
    for revision in 1..=3 {
        objects::rename(
            &mut conn,
            first,
            revision,
            &format!("first v{revision}"),
            owner,
        )
        .await
        .unwrap();
    }
    let rows: i64 = sqlx::query_scalar("SELECT count(*) FROM sync_feed WHERE owner_id = $1")
        .bind(owner)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(rows, 2);
    let page = pull(pool, owner, 0, 100).await.unwrap();
    assert_eq!(
        ids(&page.changes),
        [second, first],
        "порядок последнего изменения"
    );
    assert_eq!(page.changes[1].revision, 4);
    test_db.drop_db().await;
}

/// Совместимость: числовой курсор старого клиента — один раз всё заново.
#[tokio::test]
async fn legacy_numeric_cursor_restarts_from_the_beginning() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let a = create(pool, "inbox.item", owner, "a").await;
    let b = create(pool, "inbox.item", owner, "b").await;

    // Старый клиент хранит число (номер события) и присылает его как есть.
    let legacy = pull(pool, owner, Cursor::parse("999999"), 100)
        .await
        .unwrap();
    assert_eq!(ids(&legacy.changes), [a, b], "ничего не пропущено");
    assert!(!legacy.cursor.is_start(), "в ответ — курсор нового формата");
    let again = pull(pool, owner, &legacy.cursor, 100).await.unwrap();
    assert!(again.changes.is_empty(), "дальше — как обычно");
    test_db.drop_db().await;
}

/// После восстановления базы из копии курсор устройства оказывается «из
/// будущего»: продолжать с него нельзя, устройство забирает всё заново.
#[tokio::test]
async fn cursor_ahead_of_the_feed_restarts() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let a = create(pool, "inbox.item", owner, "a").await;
    let synced = pull(pool, owner, 0, 100).await.unwrap();
    assert_eq!(ids(&synced.changes), [a]);

    let mut ahead = synced.cursor.clone();
    ahead.advance("inbox", synced.cursor.max_pos() + 1000);
    let b = create(pool, "inbox.item", owner, "b").await;
    let page = pull(pool, owner, &ahead, 100).await.unwrap();
    assert_eq!(ids(&page.changes), [a, b]);
    test_db.drop_db().await;
}

/// Много транзакций фиксируются вперемешку, пока устройство забирает
/// изменения: по курсору должно прийти ровно всё.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn concurrent_commits_never_slip_behind_the_cursor() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool().clone();
    let owner = Uuid::now_v7();
    const WRITERS: u64 = 6;
    const ROUNDS: u64 = 20;

    let created = Arc::new(tokio::sync::Mutex::new(HashSet::new()));
    let mut writers = Vec::new();
    for writer in 0..WRITERS {
        let pool = pool.clone();
        let created = created.clone();
        writers.push(tokio::spawn(async move {
            for round in 0..ROUNDS {
                let mut tx = pool.begin().await.unwrap();
                let object = objects::create(
                    &mut tx,
                    NewObject::new("inbox.item", owner, format!("{writer}/{round}")),
                )
                .await
                .unwrap();
                // Номер события уже выдан; commit — с разной задержкой.
                tokio::time::sleep(Duration::from_millis((writer * 7 + round * 5) % 13)).await;
                tx.commit().await.unwrap();
                created.lock().await.insert(object.id);
            }
        }));
    }

    let mut cursor = Cursor::start();
    let mut seen = HashSet::new();
    let mut duplicates = 0;
    let mut drain = async |cursor: &mut Cursor, seen: &mut HashSet<Uuid>| {
        loop {
            let page = pull(&pool, owner, &*cursor, 7).await.unwrap();
            for snapshot in &page.changes {
                if !seen.insert(snapshot.id) {
                    duplicates += 1;
                }
            }
            *cursor = page.cursor;
            if !page.has_more {
                break;
            }
        }
    };
    while !writers.iter().all(tokio::task::JoinHandle::is_finished) {
        drain(&mut cursor, &mut seen).await;
    }
    for writer in writers {
        writer.await.unwrap();
    }
    drain(&mut cursor, &mut seen).await;

    let created = created.lock().await;
    assert_eq!(created.len() as u64, WRITERS * ROUNDS);
    let missed: Vec<_> = created.difference(&seen).collect();
    assert!(missed.is_empty(), "по курсору не пришло: {missed:?}");
    assert_eq!(
        duplicates, 0,
        "каждый объект создан один раз и пришёл один раз"
    );
    test_db.drop_db().await;
}

/// Миграция переносит в ленту объекты, которые были до неё.
#[tokio::test]
async fn migration_backfills_existing_objects() {
    let test_db = TestDb::empty().await;
    let db = test_db.connect().await;
    let pool = db.pool();
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../qubite-db/migrations");
    let mut before = Migrator::new(dir).await.unwrap();
    let all = before.migrations.to_vec();
    let split = all
        .iter()
        .position(|migration| migration.description == "sync feed")
        .expect("миграция sync_feed");
    before.migrations = all[..split].to_vec().into();
    before.run(pool).await.unwrap();

    // Данные «старого» сервера: лента ещё не существует.
    let owner = Uuid::now_v7();
    let first = create(pool, "inbox.item", owner, "first").await;
    let second = create(pool, "docs.page", owner, "second").await;
    let mut conn = pool.acquire().await.unwrap();
    objects::rename(&mut conn, first, 1, "first renamed", owner)
        .await
        .unwrap();
    drop(conn);

    db.migrate().await.unwrap();
    let page = pull(pool, owner, 0, 100).await.unwrap();
    assert_eq!(
        ids(&page.changes),
        [second, first],
        "в порядке последнего события"
    );
    // И новые изменения идут после перенесённых.
    let third = create(pool, "inbox.item", owner, "third").await;
    let next = pull(pool, owner, &page.cursor, 100).await.unwrap();
    assert_eq!(ids(&next.changes), [third]);
    test_db.drop_db().await;
}
