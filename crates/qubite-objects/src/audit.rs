//! Аудит: кто, когда и на каком основании изменил права, бюджеты, настройки.
//! Только добавление — изменить или удалить запись не даст база.
//! Секреты сюда не пишем: значения ключей и паролей заменяются отметкой.

use serde::Serialize;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, Result, new_id};

#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct AuditEntry {
    pub seq: i64,
    pub id: Uuid,
    pub at: OffsetDateTime,
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub reason: Option<String>,
    pub request_id: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct NewAuditEntry {
    pub actor_id: Option<Uuid>,
    pub action: String,
    pub target_kind: String,
    pub target_id: Option<String>,
    pub before: Option<serde_json::Value>,
    pub after: Option<serde_json::Value>,
    pub reason: Option<String>,
    pub request_id: Option<String>,
}

const COLUMNS: &str =
    "seq, id, at, actor_id, action, target_kind, target_id, before, after, reason, request_id";

pub async fn record(conn: &mut PgConnection, new: NewAuditEntry) -> Result<AuditEntry> {
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO audit_log (id, actor_id, action, target_kind, target_id, before, after, \
         reason, request_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING {COLUMNS}"
    )))
    .bind(new_id())
    .bind(new.actor_id)
    .bind(&new.action)
    .bind(&new.target_kind)
    .bind(&new.target_id)
    .bind(&new.before)
    .bind(&new.after)
    .bind(&new.reason)
    .bind(&new.request_id)
    .fetch_one(conn)
    .await
    .map_err(Error::from_db)
}

/// Записи аудита по цели (например, `module_grant` + ID).
pub async fn for_target(
    conn: &mut PgConnection,
    target_kind: &str,
    target_id: &str,
) -> Result<Vec<AuditEntry>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM audit_log WHERE target_kind = $1 AND target_id = $2 ORDER BY seq"
    )))
    .bind(target_kind)
    .bind(target_id)
    .fetch_all(conn)
    .await?)
}
