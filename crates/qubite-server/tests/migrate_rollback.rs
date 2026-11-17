//! Откат обновления без восстановления базы (D-962): прошлая версия сервера
//! запускается на схеме, которую уже обновила новая.

use qubite_testkit::TestDb;

#[tokio::test]
async fn older_binary_accepts_newer_migrations() {
    let (test_db, db) = TestDb::migrated().await;
    // Миграция «из будущей версии»: этот бинарник её не знает.
    sqlx::query(
        "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time) \
         VALUES (99991231235959, 'из новой версии', true, '\\x00'::bytea, 0)",
    )
    .execute(db.pool())
    .await
    .expect("запись о новой миграции");

    db.migrate()
        .await
        .expect("прошлая версия не падает на новой схеме");

    let applied: i64 = sqlx::query_scalar("SELECT count(*) FROM _sqlx_migrations")
        .fetch_one(db.pool())
        .await
        .expect("число миграций");
    assert!(applied > 1, "свои миграции на месте, чужая не мешает");

    db.close().await;
    test_db.drop_db().await;
}
