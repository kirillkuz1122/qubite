//! Тесты очереди фоновых задач на настоящей PostgreSQL (нужна `TEST_DATABASE_URL`).

use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
    time::Duration,
};

use qubite_jobs::{
    Error, NewJob, Status, WorkerConfig, claim, complete, enqueue, fail, get, run_worker,
};
use qubite_testkit::TestDb;
use tokio::sync::watch;

const LEASE: Duration = Duration::from_secs(30);

#[tokio::test]
async fn idempotency_key_prevents_duplicates() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let first = enqueue(
        pool,
        NewJob::new("index.document", serde_json::json!({"n": 1})).idempotency_key("doc-1"),
    )
    .await
    .unwrap();
    let second = enqueue(
        pool,
        NewJob::new("index.document", serde_json::json!({"n": 2})).idempotency_key("doc-1"),
    )
    .await
    .unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(second.payload["n"], 1, "повтор не перезаписывает задачу");
    test_db.drop_db().await;
}

#[tokio::test]
async fn each_job_is_claimed_by_exactly_one_worker() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool().clone();
    for n in 0..40 {
        enqueue(
            &pool,
            NewJob::new("demo.work", serde_json::json!({ "n": n })),
        )
        .await
        .unwrap();
    }

    let seen = Arc::new(Mutex::new(Vec::new()));
    let mut workers = Vec::new();
    for w in 0..4 {
        let pool = pool.clone();
        let seen = seen.clone();
        workers.push(tokio::spawn(async move {
            let name = format!("worker-{w}");
            while let Some(job) = claim(&pool, &name, &["demo.work"], LEASE).await.unwrap() {
                seen.lock().unwrap().push(job.id);
                complete(&pool, job.id, &name).await.unwrap();
            }
        }));
    }
    for worker in workers {
        worker.await.unwrap();
    }
    let seen = seen.lock().unwrap().clone();
    let unique: HashSet<_> = seen.iter().collect();
    assert_eq!(seen.len(), 40, "каждая задача выполнена");
    assert_eq!(unique.len(), 40, "и ни одна — дважды");
    test_db.drop_db().await;
}

#[tokio::test]
async fn crashed_worker_job_is_reclaimed_and_late_completion_is_rejected() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let job = enqueue(pool, NewJob::new("demo.work", serde_json::json!({})))
        .await
        .unwrap();

    // Первый обработчик взял задачу на 1 секунду и «упал».
    let taken = claim(pool, "crashed", &["demo.work"], Duration::from_secs(1))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(taken.id, job.id);
    assert!(
        claim(pool, "other", &["demo.work"], LEASE)
            .await
            .unwrap()
            .is_none(),
        "пока аренда жива — не отдаём"
    );

    tokio::time::sleep(Duration::from_millis(1200)).await;
    let reclaimed = claim(pool, "rescuer", &["demo.work"], LEASE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reclaimed.id, job.id, "задача не потерялась");
    assert_eq!(reclaimed.attempts, 2);

    // Ожил первый обработчик — отметить выполненной он уже не может.
    assert!(matches!(
        complete(pool, job.id, "crashed").await,
        Err(Error::LeaseLost)
    ));
    complete(pool, job.id, "rescuer").await.unwrap();
    assert!(
        matches!(
            complete(pool, job.id, "rescuer").await,
            Err(Error::LeaseLost)
        ),
        "дважды не завершить"
    );
    assert_eq!(
        get(pool, job.id).await.unwrap().unwrap().status,
        Status::Succeeded
    );
    test_db.drop_db().await;
}

#[tokio::test]
async fn failures_retry_with_backoff_then_become_dead() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let job = enqueue(
        pool,
        NewJob::new("demo.flaky", serde_json::json!({})).max_attempts(2),
    )
    .await
    .unwrap();

    let first = claim(pool, "w", &["demo.flaky"], LEASE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        fail(pool, first.id, "w", "сеть недоступна").await.unwrap(),
        Status::Queued
    );
    let queued = get(pool, job.id).await.unwrap().unwrap();
    assert!(queued.run_at > queued.created_at, "повтор отложен");
    assert_eq!(queued.last_error.as_deref(), Some("сеть недоступна"));
    assert!(
        claim(pool, "w", &["demo.flaky"], LEASE)
            .await
            .unwrap()
            .is_none(),
        "до паузы не берём"
    );

    // Перематываем паузу и пробуем последний раз.
    sqlx::query("UPDATE jobs SET run_at = now() WHERE id = $1")
        .bind(job.id)
        .execute(pool)
        .await
        .unwrap();
    let second = claim(pool, "w", &["demo.flaky"], LEASE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(second.attempts, 2);
    assert_eq!(
        fail(pool, second.id, "w", "снова").await.unwrap(),
        Status::Dead
    );
    assert!(
        claim(pool, "w", &["demo.flaky"], LEASE)
            .await
            .unwrap()
            .is_none(),
        "мёртвая задача не берётся"
    );
    test_db.drop_db().await;
}

#[tokio::test]
async fn future_jobs_and_other_kinds_are_not_claimed() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let later = time::OffsetDateTime::now_utc() + time::Duration::hours(1);
    enqueue(
        pool,
        NewJob::new("demo.work", serde_json::json!({})).run_at(later),
    )
    .await
    .unwrap();
    enqueue(pool, NewJob::new("other.kind", serde_json::json!({})))
        .await
        .unwrap();
    assert!(
        claim(pool, "w", &["demo.work"], LEASE)
            .await
            .unwrap()
            .is_none()
    );
    assert!(matches!(
        enqueue(
            pool,
            NewJob::new("demo.work", serde_json::json!({})).max_attempts(0)
        )
        .await,
        Err(Error::Invalid(_))
    ));
    test_db.drop_db().await;
}

#[tokio::test]
async fn worker_loop_processes_jobs_and_stops_on_signal() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool().clone();
    for n in 0..5 {
        enqueue(
            &pool,
            NewJob::new("demo.work", serde_json::json!({ "n": n })),
        )
        .await
        .unwrap();
    }
    enqueue(
        &pool,
        NewJob::new("demo.work", serde_json::json!({ "fail": true })).max_attempts(1),
    )
    .await
    .unwrap();

    let (stop, shutdown) = watch::channel(false);
    let config = WorkerConfig {
        worker_id: "loop".into(),
        kinds: vec!["demo.work".into()],
        lease: LEASE,
        idle_poll: Duration::from_millis(50),
    };
    let worker_pool = pool.clone();
    let worker = tokio::spawn(async move {
        run_worker(&worker_pool, &config, shutdown, |job| async move {
            if job.payload["fail"] == true {
                Err("не получилось".to_owned())
            } else {
                Ok(())
            }
        })
        .await
    });

    for _ in 0..100 {
        let pending: i64 =
            sqlx::query_scalar("SELECT count(*) FROM jobs WHERE status IN ('queued', 'running')")
                .fetch_one(&pool)
                .await
                .unwrap();
        if pending == 0 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    stop.send(true).unwrap();
    let processed = worker.await.unwrap().unwrap();
    assert_eq!(processed, 6);

    let counts: Vec<(String, i64)> =
        sqlx::query_as("SELECT status, count(*) FROM jobs GROUP BY status ORDER BY status")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert_eq!(
        counts,
        [("dead".to_owned(), 1), ("succeeded".to_owned(), 5)]
    );
    test_db.drop_db().await;
}
