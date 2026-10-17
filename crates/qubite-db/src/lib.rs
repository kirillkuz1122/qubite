//! Подключение к PostgreSQL и миграции схемы.
//!
//! Миграции лежат в `migrations/` этого crate'а и встраиваются в бинарник при
//! сборке, поэтому серверу не нужны отдельные SQL-файлы при установке.

use std::time::Duration;

use qubite_kernel::Secret;
use sqlx::postgres::{PgPool, PgPoolOptions};

/// Пул соединений с базой Qubite.
#[derive(Clone)]
pub struct Database {
    pool: PgPool,
}

/// Настройки подключения.
#[derive(Debug, Clone)]
pub struct DbConfig {
    pub url: Secret,
    pub max_connections: u32,
    pub acquire_timeout: Duration,
}

impl DbConfig {
    pub fn new(url: Secret) -> Self {
        Self {
            url,
            max_connections: 10,
            acquire_timeout: Duration::from_secs(5),
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("не удалось подключиться к базе данных: {0}")]
    Connect(#[source] sqlx::Error),
    #[error("ошибка миграции схемы: {0}")]
    Migrate(#[source] sqlx::migrate::MigrateError),
    #[error("ошибка запроса к базе данных: {0}")]
    Query(#[source] sqlx::Error),
}

impl Database {
    /// Подключиться сразу и проверить, что база отвечает.
    pub async fn connect(config: &DbConfig) -> Result<Self, DbError> {
        let pool = Self::options(config)
            .connect(config.url.expose())
            .await
            .map_err(DbError::Connect)?;
        Ok(Self { pool })
    }

    /// Создать пул без немедленного подключения. Соединения откроются при
    /// первом запросе; сервер сможет стартовать и сообщить «база недоступна»
    /// через `/api/ready`, а не упасть.
    pub fn connect_lazy(config: &DbConfig) -> Result<Self, DbError> {
        let pool = Self::options(config)
            .connect_lazy(config.url.expose())
            .map_err(DbError::Connect)?;
        Ok(Self { pool })
    }

    fn options(config: &DbConfig) -> PgPoolOptions {
        PgPoolOptions::new()
            .max_connections(config.max_connections)
            .acquire_timeout(config.acquire_timeout)
    }

    /// Применить все ещё не применённые миграции. Повторный вызов безопасен.
    pub async fn migrate(&self) -> Result<(), DbError> {
        sqlx::migrate!("./migrations")
            .run(&self.pool)
            .await
            .map_err(DbError::Migrate)
    }

    /// Простая проверка, что база отвечает на запросы.
    pub async fn ping(&self) -> Result<(), DbError> {
        sqlx::query("SELECT 1")
            .execute(&self.pool)
            .await
            .map(|_| ())
            .map_err(DbError::Query)
    }

    /// Номер последней применённой миграции (или `None`, если миграций нет).
    pub async fn schema_version(&self) -> Result<Option<i64>, DbError> {
        let exists: bool =
            sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
                .fetch_one(&self.pool)
                .await
                .map_err(DbError::Query)?;
        if !exists {
            return Ok(None);
        }
        sqlx::query_scalar::<_, Option<i64>>(
            "SELECT max(version) FROM _sqlx_migrations WHERE success",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(DbError::Query)
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Закрыть все соединения (при остановке сервера).
    pub async fn close(&self) {
        self.pool.close().await;
    }
}
