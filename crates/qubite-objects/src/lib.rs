//! Ядро объектов Qubite: общий «конверт» любого объекта (задача, заметка,
//! мысль во «Входящих»…), связи между объектами, журнал событий, аудит и
//! хранение файлов по хешу содержимого.
//!
//! Все изменяющие функции принимают `&mut PgConnection` и сами открывают
//! транзакцию (или точку сохранения, если вызваны внутри чужой транзакции).
//! Поэтому изменение объекта и запись события всегда атомарны, а модуль может
//! объединить несколько операций в одну свою транзакцию.
//!
//! **Права здесь не проверяются.** Этот слой отвечает за целостность данных;
//! кто что может читать и менять, решает Policy Gate (задача ACC-001) до вызова
//! этих функций. В частности, связи возвращаются только как ID — заголовки
//! объектов на другом конце показывает слой, который проверил права.

pub mod audit;
pub mod events;
pub mod files;
pub mod objects;
pub mod relations;

pub use audit::{AuditEntry, NewAuditEntry};
pub use events::{Event, NewEvent};
pub use files::{Attachment, Blob, BlobStore, Sha256};
pub use objects::{NewObject, Object, Visibility};
pub use relations::{NewRelation, Relation, RelationSource};

use uuid::Uuid;

/// Новый идентификатор: UUIDv7 (сортируется по времени создания).
pub fn new_id() -> Uuid {
    Uuid::now_v7()
}

/// Ошибки слоя объектов.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("объект не найден")]
    NotFound,
    #[error("объект удалён")]
    Deleted,
    #[error("конфликт версий: ожидалась {expected}, сейчас {current}")]
    Conflict { expected: i64, current: i64 },
    #[error("неверные данные: {0}")]
    Invalid(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка файловой системы: {0}")]
    Io(#[from] std::io::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

impl Error {
    /// Нарушение ограничения базы (CHECK, внешний ключ) — это ошибка входных данных.
    pub(crate) fn from_db(error: sqlx::Error) -> Self {
        if let sqlx::Error::Database(db) = &error {
            // 23514 check_violation, 23503 foreign_key_violation, 22001 string too long
            if matches!(db.code().as_deref(), Some("23514" | "23503" | "22001")) {
                return Self::Invalid(db.message().to_owned());
            }
        }
        Self::Db(error)
    }
}
