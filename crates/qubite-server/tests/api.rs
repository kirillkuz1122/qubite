//! Интеграционные тесты HTTP API на настоящей PostgreSQL.
//!
//! Нужна переменная `TEST_DATABASE_URL` — строка подключения с правом
//! создавать базы. Локально: `scripts/dev-db.sh up && eval "$(scripts/dev-db.sh env)"`.
//! Каждый тест создаёт свою временную базу и удаляет её в конце.

use std::{net::SocketAddr, time::Duration};

use qubite_db::{Database, DbConfig};
use qubite_kernel::Secret;
use serde_json::Value;
use sqlx::{Connection, PgConnection};

/// Временная база, удаляемая при завершении теста.
struct TestDb {
    admin_url: String,
    name: String,
    url: String,
}

impl TestDb {
    async fn create() -> Self {
        let admin_url = std::env::var("TEST_DATABASE_URL").expect(
            "нужна TEST_DATABASE_URL: запусти `scripts/dev-db.sh up` и `eval \"$(scripts/dev-db.sh env)\"`",
        );
        let name = format!("qubite_test_{}", uuid::Uuid::new_v4().simple());
        let mut admin = PgConnection::connect(&admin_url)
            .await
            .expect("подключение к тестовой PostgreSQL");
        // Имя генерируется из UUID внутри теста — внешнего ввода нет.
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE {name}")))
            .execute(&mut admin)
            .await
            .expect("CREATE DATABASE");
        admin.close().await.ok();
        let url = replace_database(&admin_url, &name);
        Self {
            admin_url,
            name,
            url,
        }
    }

    fn config(&self) -> DbConfig {
        let mut config = DbConfig::new(Secret::new(self.url.clone()));
        config.max_connections = 4;
        config
    }

    async fn drop_db(self) {
        if let Ok(mut admin) = PgConnection::connect(&self.admin_url).await {
            let _ = sqlx::query(sqlx::AssertSqlSafe(format!(
                "DROP DATABASE IF EXISTS {} WITH (FORCE)",
                self.name
            )))
            .execute(&mut admin)
            .await;
        }
    }
}

/// Подменить имя базы в строке подключения `postgres://user:pass@host:port/db?params`.
fn replace_database(url: &str, name: &str) -> String {
    let (base, query) = match url.split_once('?') {
        Some((base, query)) => (base, Some(query)),
        None => (url, None),
    };
    let prefix = base.rsplit_once('/').map_or(base, |(prefix, _)| prefix);
    match query {
        Some(query) => format!("{prefix}/{name}?{query}"),
        None => format!("{prefix}/{name}"),
    }
}

/// Запустить настоящий router на свободном порту.
async fn spawn_server(db: Database) -> SocketAddr {
    let app = qubite_server::router(qubite_server::AppState { db });
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    address
}

async fn get_json(address: SocketAddr, path: &str) -> (u16, Value) {
    let response = reqwest::get(format!("http://{address}{path}"))
        .await
        .unwrap();
    let status = response.status().as_u16();
    let body = response.json::<Value>().await.unwrap_or(Value::Null);
    (status, body)
}

#[tokio::test]
async fn health_answers_without_database() {
    // База по заведомо закрытому порту: health не должен к ней обращаться.
    let mut config = DbConfig::new(Secret::new("postgres://nobody:nothing@127.0.0.1:1/none"));
    config.acquire_timeout = Duration::from_millis(300);
    let address = spawn_server(Database::connect_lazy(&config).unwrap()).await;

    let (status, body) = get_json(address, "/api/health").await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "ok");
    assert_eq!(body["version"], qubite_kernel::VERSION);
}

#[tokio::test]
async fn ready_reports_unavailable_database_with_503() {
    let mut config = DbConfig::new(Secret::new("postgres://nobody:nothing@127.0.0.1:1/none"));
    config.acquire_timeout = Duration::from_millis(300);
    let address = spawn_server(Database::connect_lazy(&config).unwrap()).await;

    let (status, body) = get_json(address, "/api/ready").await;
    assert_eq!(status, 503);
    assert_eq!(body["status"], "not_ready");
    assert_eq!(body["database"], "unavailable");
}

#[tokio::test]
async fn ready_is_503_until_migrations_then_200() {
    let test_db = TestDb::create().await;
    let db = Database::connect(&test_db.config()).await.unwrap();
    let address = spawn_server(db.clone()).await;

    let (status, body) = get_json(address, "/api/ready").await;
    assert_eq!(status, 503, "без миграций сервер не готов");
    assert_eq!(body["database"], "ok");

    db.migrate().await.unwrap();
    let (status, body) = get_json(address, "/api/ready").await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "ready");
    assert_eq!(body["schema_version"], 1);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn migrations_create_meta_and_are_idempotent() {
    let test_db = TestDb::create().await;
    let db = Database::connect(&test_db.config()).await.unwrap();

    db.migrate().await.unwrap();
    db.migrate().await.unwrap(); // повторный запуск ничего не ломает

    let family: String =
        sqlx::query_scalar("SELECT value FROM qubite_meta WHERE key = 'schema_family'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(family, "qubite-2");
    assert_eq!(db.schema_version().await.unwrap(), Some(1));

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn database_is_postgres_18_with_pgvector_available() {
    let test_db = TestDb::create().await;
    let db = Database::connect(&test_db.config()).await.unwrap();

    let version: i32 = sqlx::query_scalar("SELECT current_setting('server_version_num')::int")
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert!(
        version >= 180_000,
        "нужна PostgreSQL 18+, получено {version}"
    );

    let has_vector: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector')",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert!(has_vector, "расширение pgvector должно быть доступно");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn openapi_describes_system_endpoints() {
    let mut config = DbConfig::new(Secret::new("postgres://nobody:nothing@127.0.0.1:1/none"));
    config.acquire_timeout = Duration::from_millis(300);
    let address = spawn_server(Database::connect_lazy(&config).unwrap()).await;

    let (status, body) = get_json(address, "/api/openapi.json").await;
    assert_eq!(status, 200);
    assert!(body["paths"]["/api/health"]["get"].is_object());
    assert!(body["paths"]["/api/ready"]["get"].is_object());
}

#[tokio::test]
async fn unknown_route_is_404() {
    let mut config = DbConfig::new(Secret::new("postgres://nobody:nothing@127.0.0.1:1/none"));
    config.acquire_timeout = Duration::from_millis(300);
    let address = spawn_server(Database::connect_lazy(&config).unwrap()).await;

    let response = reqwest::get(format!("http://{address}/api/does-not-exist"))
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 404);
}

#[test]
fn replace_database_keeps_credentials_and_params() {
    assert_eq!(
        replace_database("postgres://u:p@h:5/postgres", "x"),
        "postgres://u:p@h:5/x"
    );
    assert_eq!(
        replace_database("postgres://u:p@h:5/postgres?sslmode=disable", "x"),
        "postgres://u:p@h:5/x?sslmode=disable"
    );
}
