//! Журнал событий: что произошло с объектами. Только добавление записей —
//! изменить или удалить событие не даст сама база (триггер).

use serde::Serialize;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, Result, new_id};

#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct Event {
    /// Порядковый номер: по нему устройства забирают новые события.
    pub seq: i64,
    pub id: Uuid,
    pub at: OffsetDateTime,
    pub actor_id: Option<Uuid>,
    pub object_id: Option<Uuid>,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct NewEvent {
    pub kind: String,
    pub actor_id: Option<Uuid>,
    pub object_id: Option<Uuid>,
    pub payload: serde_json::Value,
}

impl NewEvent {
    pub fn for_object(kind: &str, object_id: Uuid, actor_id: Uuid) -> Self {
        Self {
            kind: kind.to_owned(),
            actor_id: Some(actor_id),
            object_id: Some(object_id),
            payload: serde_json::json!({}),
        }
    }

    /// Системное событие без объекта и автора.
    pub fn system(kind: &str) -> Self {
        Self {
            kind: kind.to_owned(),
            actor_id: None,
            object_id: None,
            payload: serde_json::json!({}),
        }
    }

    pub fn with_payload(mut self, payload: serde_json::Value) -> Self {
        self.payload = payload;
        self
    }
}

const COLUMNS: &str = "seq, id, at, actor_id, object_id, kind, payload";

pub async fn append(conn: &mut PgConnection, new: NewEvent) -> Result<Event> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO events (id, actor_id, object_id, kind, payload) \
         VALUES ($1, $2, $3, $4, $5) RETURNING {COLUMNS}"
    )))
    .bind(new_id())
    .bind(new.actor_id)
    .bind(new.object_id)
    .bind(&new.kind)
    .bind(&new.payload)
    .fetch_one(conn)
    .await
    .map_err(Error::from_db)
}

/// События объекта по порядку.
pub async fn for_object(conn: &mut PgConnection, object_id: Uuid) -> Result<Vec<Event>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM events WHERE object_id = $1 ORDER BY seq"
    )))
    .bind(object_id)
    .fetch_all(conn)
    .await?)
}

/// События после курсора `seq` (для синхронизации), не больше `limit`.
pub async fn after(conn: &mut PgConnection, seq: i64, limit: i64) -> Result<Vec<Event>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM events WHERE seq > $1 ORDER BY seq LIMIT $2"
    )))
    .bind(seq)
    .bind(limit.clamp(1, 1000))
    .fetch_all(conn)
    .await?)
}
