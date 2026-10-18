//! Owner платформы на настоящей PostgreSQL: второго owner быть не может.

use qubite_auth::{Error, Passwords, owner};
use qubite_testkit::TestDb;

const PASSWORD: &str = "правильный пароль";

#[tokio::test]
async fn second_owner_is_impossible() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let passwords = Passwords::default();

    let first = owner::create(pool, &passwords, " Kirill@Qubite.RU ", "Кирилл", PASSWORD)
        .await
        .unwrap();
    assert_eq!(first.email, "kirill@qubite.ru");
    assert_eq!(first.status, "active");

    // Повторный запуск команды — и с той же почтой, и с другой — отказ.
    for email in ["kirill@qubite.ru", "other@qubite.ru"] {
        let error = owner::create(pool, &passwords, email, "", PASSWORD)
            .await
            .unwrap_err();
        assert!(matches!(error, Error::OwnerExists), "{error:?}");
    }
    assert_eq!(owner::current(pool).await.unwrap().unwrap().id, first.id);

    // В обход кода база тоже не даст: ни вторую строку, ни подмену, ни удаление.
    let other = qubite_auth::new_id();
    sqlx::query("INSERT INTO accounts (id, email) VALUES ($1, 'intruder@x.ru')")
        .bind(other)
        .execute(pool)
        .await
        .unwrap();
    for sql in [
        "INSERT INTO platform_owner (account_id) VALUES ($1)",
        "INSERT INTO platform_owner (singleton, account_id) VALUES (false, $1)",
        "UPDATE platform_owner SET account_id = $1",
    ] {
        let result = sqlx::query(sql).bind(other).execute(pool).await;
        assert!(result.is_err(), "база приняла: {sql}");
    }
    assert!(
        sqlx::query("DELETE FROM platform_owner")
            .execute(pool)
            .await
            .is_err()
    );
    let owners: i64 = sqlx::query_scalar("SELECT count(*) FROM platform_owner")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(owners, 1);

    let audit: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM audit_log WHERE action = 'platform.owner_created' AND target_id = $1",
    )
    .bind(first.id.to_string())
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(audit, 1);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn parallel_owner_creation_has_one_winner() {
    let (test_db, db) = TestDb::migrated().await;
    let passwords = Passwords::new(4);

    let tasks: Vec<_> = (0..4)
        .map(|i| {
            let pool = db.pool().clone();
            let passwords = passwords.clone();
            tokio::spawn(async move {
                owner::create(&pool, &passwords, &format!("owner{i}@x.ru"), "", PASSWORD).await
            })
        })
        .collect();
    let mut winners = 0;
    for task in tasks {
        match task.await.unwrap() {
            Ok(_) => winners += 1,
            Err(Error::OwnerExists) => {}
            Err(other) => panic!("неожиданная ошибка: {other:?}"),
        }
    }
    assert_eq!(winners, 1);
    let accounts: i64 = sqlx::query_scalar("SELECT count(*) FROM accounts")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(accounts, 1, "проигравшие не оставили аккаунтов");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn owner_password_is_hashed_and_rules_apply() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let passwords = Passwords::default();

    assert!(matches!(
        owner::create(pool, &passwords, "a@x.ru", "", "короткий").await,
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        owner::create(pool, &passwords, "без собаки", "", PASSWORD).await,
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        owner::set_password(pool, &passwords, "новый пароль владельца").await,
        Err(Error::NoOwner)
    ));

    let account = owner::create(pool, &passwords, "a@x.ru", "", PASSWORD)
        .await
        .unwrap();
    let hash: String =
        sqlx::query_scalar("SELECT hash FROM credentials_password WHERE account_id = $1")
            .bind(account.id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(hash.starts_with("$argon2id$"));
    assert!(!hash.contains(PASSWORD));
    let audit: String = sqlx::query_scalar::<_, serde_json::Value>(
        "SELECT after FROM audit_log WHERE action = 'platform.owner_created'",
    )
    .fetch_one(pool)
    .await
    .unwrap()
    .to_string();
    assert!(!audit.contains(PASSWORD), "пароль не попадает в аудит");

    db.close().await;
    test_db.drop_db().await;
}
