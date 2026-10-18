//! Гранты: owner вручную выдаёт пользователю права в модуле (D-054, D-062).
//!
//! Изменение не переписывает строку, а закрывает старую и добавляет новую —
//! так остаётся история «кто, когда и что выдал». Каждое изменение — в аудите.

use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{DenyReason, Error, Flags, ModuleId, OwnerConsole, Result};
use qubite_objects::{NewAuditEntry, audit, new_id};

/// Живой грант.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Grant {
    pub id: Uuid,
    pub account_id: Uuid,
    pub module_id: String,
    pub flags: Flags,
    pub granted_by: Option<Uuid>,
    pub granted_at: OffsetDateTime,
    pub version: i64,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    account_id: Uuid,
    module_id: String,
    can_read: bool,
    can_write: bool,
    can_manage: bool,
    can_ai: bool,
    granted_by: Option<Uuid>,
    granted_at: OffsetDateTime,
    version: i64,
}

impl From<Row> for Grant {
    fn from(row: Row) -> Self {
        Self {
            id: row.id,
            account_id: row.account_id,
            module_id: row.module_id,
            flags: Flags {
                read: row.can_read,
                write: row.can_write,
                manage: row.can_manage,
                ai: row.can_ai,
            },
            granted_by: row.granted_by,
            granted_at: row.granted_at,
            version: row.version,
        }
    }
}

const COLUMNS: &str = "id, account_id, module_id, can_read, can_write, can_manage, can_ai, \
                       granted_by, granted_at, version";

/// Выдать или изменить права. Пустой набор — то же, что отзыв.
/// Возвращает новый грант (или `None`, если права отозваны).
pub async fn set(
    pool: &PgPool,
    by: &OwnerConsole,
    account_id: Uuid,
    module: &ModuleId,
    flags: Flags,
    reason: Option<&str>,
) -> Result<Option<Grant>> {
    let flags = flags.normalized();
    let mut tx = pool.begin().await?;

    let exists: (bool, bool) = sqlx::query_as(
        "SELECT EXISTS (SELECT 1 FROM accounts WHERE id = $1), \
                EXISTS (SELECT 1 FROM modules WHERE id = $2)",
    )
    .bind(account_id)
    .bind(module.as_str())
    .fetch_one(&mut *tx)
    .await?;
    if !exists.0 || !exists.1 {
        return Err(Error::Denied(DenyReason::NotFound));
    }
    // Блокировка пары «аккаунт + модуль»: две вкладки Owner Console не создадут
    // два живых гранта.
    sqlx::query(
        "SELECT pg_advisory_xact_lock(hashtextextended('qubite.grant:' || $1 || ':' || $2, 0))",
    )
    .bind(account_id.to_string())
    .bind(module.as_str())
    .execute(&mut *tx)
    .await?;

    let before: Option<Grant> = sqlx::query_as::<_, Row>(sqlx::AssertSqlSafe(format!(
        "UPDATE module_grants SET revoked_at = now(), revoked_by = $3 \
         WHERE account_id = $1 AND module_id = $2 AND revoked_at IS NULL RETURNING {COLUMNS}"
    )))
    .bind(account_id)
    .bind(module.as_str())
    .bind(by.account_id())
    .fetch_optional(&mut *tx)
    .await?
    .map(Grant::from);

    let after = if flags.is_empty() {
        None
    } else {
        let row: Row = sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "INSERT INTO module_grants (id, account_id, module_id, can_read, can_write, can_manage, \
             can_ai, granted_by, reason, version) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
             RETURNING {COLUMNS}"
        )))
        .bind(new_id())
        .bind(account_id)
        .bind(module.as_str())
        .bind(flags.read)
        .bind(flags.write)
        .bind(flags.manage)
        .bind(flags.ai)
        .bind(by.account_id())
        .bind(reason)
        .bind(before.as_ref().map_or(1, |grant| grant.version + 1))
        .fetch_one(&mut *tx)
        .await?;
        Some(Grant::from(row))
    };

    if before.is_some() || after.is_some() {
        audit::record(
            &mut tx,
            NewAuditEntry {
                actor_id: Some(by.account_id()),
                action: if after.is_some() {
                    "module.grant_set".into()
                } else {
                    "module.grant_revoked".into()
                },
                target_kind: "module_grant".into(),
                target_id: Some(format!("{account_id}:{module}")),
                before: before.as_ref().map(|grant| serde_json::json!(grant.flags)),
                after: after.as_ref().map(|grant| serde_json::json!(grant.flags)),
                reason: reason.map(str::to_owned),
                ..NewAuditEntry::default()
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(after)
}

/// Отозвать все права аккаунта в модуле. `false` — грантов и не было.
pub async fn revoke(
    pool: &PgPool,
    by: &OwnerConsole,
    account_id: Uuid,
    module: &ModuleId,
    reason: Option<&str>,
) -> Result<bool> {
    let had = for_account(pool, account_id)
        .await?
        .iter()
        .any(|grant| grant.module_id == module.as_str());
    set(pool, by, account_id, module, Flags::NONE, reason).await?;
    Ok(had)
}

/// Живые гранты аккаунта.
pub async fn for_account(pool: &PgPool, account_id: Uuid) -> Result<Vec<Grant>> {
    let rows: Vec<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM module_grants WHERE account_id = $1 AND revoked_at IS NULL \
         ORDER BY module_id"
    )))
    .bind(account_id)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(Grant::from).collect())
}
