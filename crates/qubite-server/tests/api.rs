//! Интеграционные тесты HTTP API на настоящей PostgreSQL.
//!
//! Временные базы создаёт `qubite_testkit::TestDb` (нужна `TEST_DATABASE_URL`).

use std::{net::SocketAddr, time::Duration};

use qubite_db::{Database, DbConfig};
use qubite_kernel::Secret;
use qubite_testkit::TestDb;

/// Номер последней миграции в `crates/qubite-db/migrations`.
const LATEST_MIGRATION: i64 = 41;
use serde_json::Value;

/// Запустить настоящий router на свободном порту.
async fn spawn_server(db: Database) -> SocketAddr {
    let app = qubite_server::router(qubite_server::AppState::new(db));
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    address
}

async fn get_json(address: SocketAddr, path: &str) -> (u16, Value) {
    let response = qubite_testkit::http_client()
        .get(format!("http://{address}{path}"))
        .send()
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

/// Сервер, который читает выкладку из указанного файла (как это делает автодеплой, OPS-007).
async fn spawn_with_deploy(db: Database, file: &std::path::Path) -> SocketAddr {
    let state = qubite_server::AppState::new(db).with_deploy_file(file);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, qubite_server::router(state))
            .await
            .unwrap();
    });
    address
}

fn lazy_db() -> Database {
    let mut config = DbConfig::new(Secret::new("postgres://nobody:nothing@127.0.0.1:1/none"));
    config.acquire_timeout = Duration::from_millis(300);
    Database::connect_lazy(&config).unwrap()
}

#[tokio::test]
async fn health_has_empty_deploy_without_file() {
    let missing = std::env::temp_dir().join("qubite-no-deploy-file.json");
    let address = spawn_with_deploy(lazy_db(), &missing).await;

    let (status, body) = get_json(address, "/api/health").await;
    assert_eq!(status, 200);
    assert_eq!(body["version"], qubite_kernel::VERSION);
    assert!(body["deploy"]["commit"].is_null());
    assert!(body["deploy"]["deployed_at"].is_null());
    assert!(body["deploy"]["rollback"].is_null());
}

#[tokio::test]
async fn health_and_ready_show_commit_time_and_rollback() {
    let file = std::env::temp_dir().join(format!("qubite-deploy-http-{}.json", std::process::id()));
    // Ровно то, что пишет deploy/pi/update.sh после отката.
    std::fs::write(
        &file,
        r#"{"commit":"0123456789abcdef0123456789abcdef01234567",
            "built_at":"2026-10-29T10:00:00Z","deployed_at":"2026-10-29T11:00:00Z",
            "rollback":{"from":"fedcba9876543210fedcba9876543210fedcba98",
                        "to":"0123456789abcdef0123456789abcdef01234567",
                        "at":"2026-10-29T11:00:00Z","reason":"миграции упали"}}"#,
    )
    .unwrap();
    let address = spawn_with_deploy(lazy_db(), &file).await;

    let (_, health) = get_json(address, "/api/health").await;
    let (_, ready) = get_json(address, "/api/ready").await;
    // Версия видна, даже когда база недоступна (/api/ready — 503): это и нужно при поломке.
    for body in [&health, &ready] {
        assert_eq!(body["version"], qubite_kernel::VERSION);
        assert_eq!(body["deploy"]["commit"], "0123456789ab");
        assert_eq!(body["deploy"]["built_at"], "2026-10-29T10:00:00Z");
        assert_eq!(body["deploy"]["deployed_at"], "2026-10-29T11:00:00Z");
        assert_eq!(body["deploy"]["rollback"]["from"], "fedcba987654");
        assert_eq!(body["deploy"]["rollback"]["to"], "0123456789ab");
        assert_eq!(body["deploy"]["rollback"]["reason"], "миграции упали");
    }

    // Следующая выкладка стирает пометку об откате — без перезапуска сервера.
    std::fs::write(
        &file,
        r#"{"commit":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","deployed_at":"2026-10-29T12:00:00Z","rollback":null}"#,
    )
    .unwrap();
    let (_, health) = get_json(address, "/api/health").await;
    std::fs::remove_file(&file).unwrap();
    assert_eq!(health["deploy"]["commit"], "aaaaaaaaaaaa");
    assert!(health["deploy"]["rollback"].is_null());
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
    let test_db = TestDb::empty().await;
    let db = test_db.connect().await;
    let address = spawn_server(db.clone()).await;

    let (status, body) = get_json(address, "/api/ready").await;
    assert_eq!(status, 503, "без миграций сервер не готов");
    assert_eq!(body["database"], "ok");

    db.migrate().await.unwrap();
    let (status, body) = get_json(address, "/api/ready").await;
    assert_eq!(status, 200);
    assert_eq!(body["status"], "ready");
    assert_eq!(body["schema_version"], LATEST_MIGRATION);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn migrations_create_meta_and_are_idempotent() {
    let test_db = TestDb::empty().await;
    let db = test_db.connect().await;

    db.migrate().await.unwrap();
    db.migrate().await.unwrap(); // повторный запуск ничего не ломает

    let family: String =
        sqlx::query_scalar("SELECT value FROM qubite_meta WHERE key = 'schema_family'")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(family, "qubite-2");
    assert_eq!(db.schema_version().await.unwrap(), Some(LATEST_MIGRATION));

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn database_is_postgres_18_with_pgvector_available() {
    let test_db = TestDb::empty().await;
    let db = test_db.connect().await;

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

    let response = qubite_testkit::http_client()
        .get(format!("http://{address}/api/does-not-exist"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 404);
}

#[test]
fn openapi_json_matches_served_document() {
    let printed: Value = serde_json::from_str(&qubite_server::openapi_json()).unwrap();
    assert!(printed["paths"]["/api/health"]["get"].is_object());
    assert_eq!(printed["info"]["title"], "Qubite API");
}

/// SEC-001 (D-545): у каждого ответа — заголовки безопасности, и у ошибок тоже.
#[tokio::test]
async fn every_response_has_security_headers() {
    let mut config = DbConfig::new(Secret::new("postgres://nobody:nothing@127.0.0.1:1/none"));
    config.acquire_timeout = Duration::from_millis(300);
    let address = spawn_server(Database::connect_lazy(&config).unwrap()).await;

    for path in ["/api/health", "/api/no-such-route", "/api/auth/me"] {
        let response = qubite_testkit::http_client()
            .get(format!("http://{address}{path}"))
            .send()
            .await
            .unwrap();
        let headers = response.headers();
        assert_eq!(headers["x-content-type-options"], "nosniff", "{path}");
        assert_eq!(headers["x-frame-options"], "SAMEORIGIN", "{path}");
        assert_eq!(headers["referrer-policy"], "same-origin", "{path}");
    }
}
