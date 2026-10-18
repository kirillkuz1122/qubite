//! Общие помощники для тестов Qubite: временная база PostgreSQL и
//! поддельный HTTP-сервер провайдера ([`fake_http`]).
//!
//! Нужна переменная `TEST_DATABASE_URL` — строка подключения с правом
//! создавать базы. Локально её задаёт `just check-server` или
//! `eval "$(scripts/dev-db.sh env)"`.

pub mod fake_http;

use qubite_db::{Database, DbConfig};
use qubite_kernel::Secret;
use sqlx::{Connection, PgConnection};

/// HTTP-клиент для тестов. TLS в сборке включает адаптер OpenRouter
/// (rustls без встроенного выбора криптографии), поэтому до создания
/// клиента нужно выбрать провайдер — ring, как и в сервере.
pub fn http_client() -> reqwest::Client {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::new()
}

/// Временная база, созданная для одного теста.
pub struct TestDb {
    admin_url: String,
    name: String,
    url: String,
}

impl TestDb {
    /// Создать пустую базу (без миграций).
    pub async fn empty() -> Self {
        let admin_url = std::env::var("TEST_DATABASE_URL").expect(
            "нужна TEST_DATABASE_URL: запусти `just db-up` и `eval \"$(scripts/dev-db.sh env)\"`",
        );
        let name = format!("qubite_test_{}", uuid::Uuid::new_v4().simple());
        let mut admin = PgConnection::connect(&admin_url)
            .await
            .expect("подключение к тестовой PostgreSQL");
        // Имя генерируется из UUID здесь же — внешнего ввода нет.
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

    /// Создать базу, подключиться и применить все миграции.
    pub async fn migrated() -> (Self, Database) {
        let test_db = Self::empty().await;
        let db = test_db.connect().await;
        db.migrate().await.expect("миграции");
        (test_db, db)
    }

    pub fn config(&self) -> DbConfig {
        let mut config = DbConfig::new(Secret::new(self.url.clone()));
        config.max_connections = 8;
        config
    }

    pub async fn connect(&self) -> Database {
        Database::connect(&self.config())
            .await
            .expect("подключение к временной базе")
    }

    /// Удалить базу. Вызывать в конце теста.
    pub async fn drop_db(self) {
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
pub fn replace_database(url: &str, name: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::replace_database;

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
}
