//! Вход на настоящей PostgreSQL: очередь на проверку пароля не занимает
//! соединения с базой.

use std::time::Duration;

use qubite_auth::{AuthConfig, ClientInfo, Error, LoginInput, Passwords, login, owner};
use qubite_testkit::TestDb;
use sqlx::postgres::PgPoolOptions;

const PASSWORD: &str = "правильный пароль";

fn input(email: &str, password: &str) -> LoginInput {
    LoginInput {
        email: email.into(),
        password: password.into(),
        client: ClientInfo {
            user_agent: "test".into(),
            ip: "203.0.113.7".into(),
        },
        platform: Default::default(),
    }
}

/// Перебор с разных почт ждёт своей очереди на Argon2, не держа соединения:
/// остальные запросы сервера (проверка сессии и т. п.) продолжают работать.
#[tokio::test]
async fn waiting_for_password_check_does_not_hold_db_connections() {
    let (test_db, db) = TestDb::migrated().await;
    let passwords = Passwords::new(1);
    owner::create(db.pool(), &passwords, "kirill@qubite.ru", "", PASSWORD)
        .await
        .unwrap();
    // Маленький пул, как у сервера под нагрузкой: 3 соединения.
    let pool = PgPoolOptions::new()
        .max_connections(3)
        .acquire_timeout(Duration::from_secs(3))
        .connect(test_db.config().url.expose())
        .await
        .unwrap();

    // Единственное место для проверки пароля занято — вход «медленный».
    let held = passwords.permit().await.unwrap();
    let tasks: Vec<_> = (0..10)
        .map(|i| {
            let (pool, passwords) = (pool.clone(), passwords.clone());
            tokio::spawn(async move {
                login(
                    &pool,
                    &passwords,
                    &AuthConfig::default(),
                    input(&format!("guess{i}@qubite.ru"), "неправильный пароль"),
                )
                .await
            })
        })
        .collect();
    tokio::time::sleep(Duration::from_millis(300)).await;

    // Пока 10 входов ждут, база доступна остальным.
    let alive = tokio::time::timeout(
        Duration::from_secs(1),
        sqlx::query_scalar::<_, i32>("SELECT 1").fetch_one(&pool),
    )
    .await;
    assert!(
        matches!(alive, Ok(Ok(1))),
        "очередь входов заняла весь пул: {alive:?}"
    );

    drop(held);
    for task in tasks {
        let result = task.await.unwrap();
        assert!(
            matches!(result, Err(Error::InvalidCredentials)),
            "{result:?}"
        );
    }
    let session = login(
        &pool,
        &passwords,
        &AuthConfig::default(),
        input("kirill@qubite.ru", PASSWORD),
    )
    .await
    .unwrap();
    assert!(!session.token.is_empty());

    pool.close().await;
    db.close().await;
    test_db.drop_db().await;
}
