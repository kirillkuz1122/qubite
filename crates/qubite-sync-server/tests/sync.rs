//! Тесты серверной синхронизации на настоящей PostgreSQL (нужна `TEST_DATABASE_URL`).

use qubite_sync::{OpKind, OpResult, Operation, PushRequest, RejectReason};
use qubite_sync_server::{pull, push};
use qubite_testkit::TestDb;
use sqlx::PgPool;
use uuid::Uuid;

fn create(object_id: Uuid, title: &str) -> Operation {
    Operation {
        op_id: Uuid::now_v7(),
        object_id,
        base_revision: None,
        kind: OpKind::Create {
            object_type: "inbox.item".into(),
            title: title.into(),
        },
    }
}

fn edit(object_id: Uuid, base: i64, kind: OpKind) -> Operation {
    Operation {
        op_id: Uuid::now_v7(),
        object_id,
        base_revision: Some(base),
        kind,
    }
}

fn set_title(object_id: Uuid, base: i64, title: &str) -> Operation {
    edit(
        object_id,
        base,
        OpKind::SetTitle {
            title: title.into(),
        },
    )
}

fn batch(ops: Vec<Operation>) -> PushRequest {
    PushRequest {
        device_id: Uuid::now_v7(),
        ops,
    }
}

async fn count(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_scalar(sqlx::AssertSqlSafe(sql.to_owned()))
        .fetch_one(pool)
        .await
        .unwrap()
}

#[tokio::test]
async fn offline_batch_is_applied_in_order_and_pulled_as_one_snapshot() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let thought = Uuid::now_v7();

    let response = push(
        pool,
        owner,
        &batch(vec![
            create(thought, "Завтра повторить графы"),
            set_title(thought, 1, "Повторить графы"),
            edit(thought, 2, OpKind::Delete),
        ]),
    )
    .await
    .unwrap();
    let revisions: Vec<i64> = response
        .results
        .iter()
        .map(|result| match result {
            OpResult::Applied { revision, .. } => *revision,
            other => panic!("ожидалось applied: {other:?}"),
        })
        .collect();
    assert_eq!(revisions, [1, 2, 3]);

    let page = pull(pool, owner, 0, 100).await.unwrap();
    assert_eq!(page.changes.len(), 1, "один снимок на объект");
    assert_eq!(page.changes[0].title, "Повторить графы");
    assert!(page.changes[0].deleted);
    assert_eq!(page.changes[0].revision, 3);
    assert!(!page.has_more);

    let again = pull(pool, owner, page.cursor, 100).await.unwrap();
    assert!(again.changes.is_empty(), "после курсора нового нет");
    test_db.drop_db().await;
}

#[tokio::test]
async fn resending_the_same_batch_applies_nothing_twice() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let thought = Uuid::now_v7();
    let request = batch(vec![
        create(thought, "мысль"),
        set_title(thought, 1, "мысль!"),
    ]);

    let first = push(pool, owner, &request).await.unwrap();
    let events_before = count(pool, "SELECT count(*) FROM events").await;
    let second = push(pool, owner, &request).await.unwrap();

    assert_eq!(first, second, "повтор возвращает те же результаты");
    assert_eq!(
        count(pool, "SELECT count(*) FROM events").await,
        events_before
    );
    assert_eq!(count(pool, "SELECT count(*) FROM objects").await, 1);
    test_db.drop_db().await;
}

#[tokio::test]
async fn parallel_resends_of_one_operation_create_one_object() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool().clone();
    let owner = Uuid::now_v7();
    let request = batch(vec![create(Uuid::now_v7(), "плохая сеть")]);

    let mut tasks = Vec::new();
    for _ in 0..10 {
        let pool = pool.clone();
        let request = request.clone();
        tasks.push(tokio::spawn(async move {
            push(&pool, owner, &request).await.unwrap()
        }));
    }
    let mut results = Vec::new();
    for task in tasks {
        results.push(task.await.unwrap());
    }
    // Параллельный повтор ждёт первую транзакцию и получает тот же результат.
    for response in &results {
        assert_eq!(response, &results[0]);
    }
    assert!(matches!(
        results[0].results[0],
        OpResult::Applied { revision: 1, .. }
    ));
    assert_eq!(count(&pool, "SELECT count(*) FROM objects").await, 1);
    assert_eq!(count(&pool, "SELECT count(*) FROM sync_ops").await, 1);
    test_db.drop_db().await;
}

#[tokio::test]
async fn stale_edit_is_a_conflict_with_current_state_and_others_still_apply() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let note = Uuid::now_v7();
    let other = Uuid::now_v7();
    push(
        pool,
        owner,
        &batch(vec![create(note, "v1"), create(other, "другая")]),
    )
    .await
    .unwrap();
    // Телефон уже поменял заголовок.
    push(pool, owner, &batch(vec![set_title(note, 1, "с телефона")]))
        .await
        .unwrap();

    // Ноутбук правит от старой версии и заодно другую заметку.
    let response = push(
        pool,
        owner,
        &batch(vec![
            set_title(note, 1, "с ноутбука"),
            set_title(other, 1, "ок"),
        ]),
    )
    .await
    .unwrap();
    match &response.results[0] {
        OpResult::Conflict { current, .. } => {
            assert_eq!(current.title, "с телефона");
            assert_eq!(current.revision, 2);
        }
        other => panic!("ожидался конфликт: {other:?}"),
    }
    assert!(matches!(
        response.results[1],
        OpResult::Applied { revision: 2, .. }
    ));
    test_db.drop_db().await;
}

#[tokio::test]
async fn foreign_objects_do_not_exist_for_another_owner() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let alice = Uuid::now_v7();
    let bob = Uuid::now_v7();
    let secret = Uuid::now_v7();
    let alice_op = create(secret, "личное");
    push(pool, alice, &batch(vec![alice_op.clone()]))
        .await
        .unwrap();

    let response = push(
        pool,
        bob,
        &batch(vec![
            set_title(secret, 1, "взлом"),
            edit(secret, 1, OpKind::Delete),
        ]),
    )
    .await
    .unwrap();
    for result in &response.results {
        assert!(matches!(
            result,
            OpResult::Rejected {
                reason: RejectReason::NotFound,
                ..
            }
        ));
    }
    // Чужой op_id тоже не позволяет прочитать чужой результат.
    let replay = push(pool, bob, &batch(vec![alice_op])).await.unwrap();
    assert!(matches!(
        replay.results[0],
        OpResult::Rejected {
            reason: RejectReason::Invalid,
            ..
        }
    ));

    assert!(pull(pool, bob, 0, 100).await.unwrap().changes.is_empty());
    assert_eq!(
        pull(pool, alice, 0, 100).await.unwrap().changes[0].title,
        "личное"
    );
    test_db.drop_db().await;
}

#[tokio::test]
async fn invalid_operations_are_rejected_without_side_effects() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let id = Uuid::now_v7();

    let mut no_base = set_title(id, 1, "x");
    no_base.base_revision = None;
    let bad_type = Operation {
        op_id: Uuid::now_v7(),
        object_id: Uuid::now_v7(),
        base_revision: None,
        kind: OpKind::Create {
            object_type: "Не Тип".into(),
            title: "x".into(),
        },
    };
    let response = push(pool, owner, &batch(vec![no_base, bad_type]))
        .await
        .unwrap();
    for result in &response.results {
        assert!(matches!(
            result,
            OpResult::Rejected {
                reason: RejectReason::Invalid,
                ..
            }
        ));
    }
    assert_eq!(count(pool, "SELECT count(*) FROM objects").await, 0);
    assert!(
        push(pool, owner, &batch(vec![])).await.is_err(),
        "пустой пакет"
    );
    test_db.drop_db().await;
}

#[tokio::test]
async fn pull_pages_through_all_changes_exactly_once() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = Uuid::now_v7();
    let ops: Vec<Operation> = (0..5)
        .map(|n| create(Uuid::now_v7(), &format!("{n}")))
        .collect();
    push(pool, owner, &batch(ops)).await.unwrap();

    let mut cursor = 0;
    let mut titles = Vec::new();
    loop {
        let page = pull(pool, owner, cursor, 2).await.unwrap();
        titles.extend(page.changes.into_iter().map(|snapshot| snapshot.title));
        cursor = page.cursor;
        if !page.has_more {
            break;
        }
    }
    assert_eq!(titles, ["0", "1", "2", "3", "4"]);
    test_db.drop_db().await;
}
