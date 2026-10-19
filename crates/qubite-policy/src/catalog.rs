//! Каталог модулей: что установлено, включено, готово и как видно без доступа.

use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;

use crate::{
    ActionKind, DenyReason, Error, Facts, Flags, ModuleId, ModuleState, OwnerConsole, Result,
    Subject, evaluate,
};
use qubite_objects::{NewAuditEntry, audit};

/// Модуль в каталоге (как его видит owner).
#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct Module {
    pub id: String,
    pub title: String,
    pub installed: bool,
    pub state: String,
    pub readiness: String,
    pub visibility: String,
    pub version: i64,
    pub updated_at: OffsetDateTime,
}

const COLUMNS: &str = "id, title, installed, state, readiness, visibility, version, updated_at";

/// Что видит пользователь на карточке модуля.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleStatus {
    /// Можно пользоваться.
    Available,
    /// Виден с замком: доступа нет.
    Locked,
    /// Доступ есть, модуль ещё не готов.
    Preparing,
    /// Доступ есть, модуль выключен или на техработах.
    Unavailable,
}

/// Строка каталога для конкретного пользователя.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CatalogEntry {
    pub id: String,
    pub title: String,
    pub status: ModuleStatus,
    /// Права пользователя (пусто, если модуль недоступен).
    pub flags: Flags,
}

/// Изменение модуля из Owner Console. Пустые поля не меняются.
#[derive(Debug, Clone, Default)]
pub struct ModulePatch {
    pub installed: Option<bool>,
    pub state: Option<String>,
    pub readiness: Option<String>,
    pub visibility: Option<String>,
    /// Ожидаемая версия: защита от одновременной правки двух вкладок.
    pub expected_version: Option<i64>,
}

/// Весь каталог (для owner).
pub async fn list_all(pool: &PgPool) -> Result<Vec<Module>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM modules ORDER BY id"
    )))
    .fetch_all(pool)
    .await?)
}

/// Каталог глазами субъекта: скрытые модули без доступа не попадают в список
/// вовсе, остальные — с замком, «готовится», «недоступен» или «доступен».
pub async fn catalog_for(pool: &PgPool, subject: &Subject) -> Result<Vec<CatalogEntry>> {
    let Subject::Account {
        account_id,
        session_id,
    } = subject
    else {
        return Err(DenyReason::GuestNotAllowed.into());
    };
    #[derive(sqlx::FromRow)]
    struct Row {
        id: String,
        title: String,
        installed: bool,
        state: String,
        readiness: String,
        visibility: String,
        can_read: Option<bool>,
        can_write: Option<bool>,
        can_manage: Option<bool>,
        can_ai: Option<bool>,
    }
    #[derive(sqlx::FromRow)]
    struct Me {
        status: String,
        is_owner: bool,
        session_ok: bool,
    }
    let me: Option<Me> = sqlx::query_as(
        "SELECT a.status, EXISTS (SELECT 1 FROM platform_owner o WHERE o.account_id = a.id) AS is_owner,
                ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM sessions s WHERE s.id = $2
                    AND s.account_id = a.id AND s.revoked_at IS NULL AND s.expires_at > now())) AS session_ok
         FROM accounts a WHERE a.id = $1",
    )
    .bind(account_id)
    .bind(session_id)
    .fetch_optional(pool)
    .await?;
    let Some(me) = me else {
        return Err(DenyReason::Unauthenticated.into());
    };
    let rows: Vec<Row> = sqlx::query_as(
        "SELECT m.id, m.title, m.installed, m.state, m.readiness, m.visibility,
                g.can_read, g.can_write, g.can_manage, g.can_ai
         FROM modules m
         LEFT JOIN module_grants g ON g.module_id = m.id AND g.account_id = $1 AND g.revoked_at IS NULL
         ORDER BY m.id",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await?;

    let mut entries = Vec::with_capacity(rows.len());
    for row in rows {
        let facts = Facts {
            account_status: Some(me.status.clone()),
            is_owner: me.is_owner,
            session_ok: me.session_ok,
            module: Some(ModuleState {
                installed: row.installed,
                state: row.state,
                readiness: row.readiness,
                visibility: row.visibility,
            }),
            grant: row.can_read.map(|read| Flags {
                read,
                write: row.can_write.unwrap_or(false),
                manage: row.can_manage.unwrap_or(false),
                ai: row.can_ai.unwrap_or(false),
            }),
            // Техработы закрывает слой HTTP; в каталоге — обычные замки.
            platform_maintenance: false,
        };
        let (status, flags) = match evaluate(&facts, None, ActionKind::Read) {
            Ok(flags) => (ModuleStatus::Available, flags),
            Err(DenyReason::NotFound) => continue,
            Err(DenyReason::ModuleNotGranted) => (ModuleStatus::Locked, Flags::NONE),
            Err(DenyReason::ModulePreparing) => (ModuleStatus::Preparing, Flags::NONE),
            Err(DenyReason::ModuleDisabled | DenyReason::ModuleMaintenance) => {
                (ModuleStatus::Unavailable, Flags::NONE)
            }
            Err(other) => return Err(other.into()),
        };
        entries.push(CatalogEntry {
            id: row.id,
            title: row.title,
            status,
            flags,
        });
    }
    Ok(entries)
}

/// Изменить модуль (Owner Console). Записывается в аудит.
pub async fn update(
    pool: &PgPool,
    by: &OwnerConsole,
    id: &ModuleId,
    patch: ModulePatch,
) -> Result<Module> {
    check_value(
        patch.state.as_deref(),
        &["enabled", "disabled", "maintenance"],
        "state",
    )?;
    check_value(
        patch.readiness.as_deref(),
        &["planned", "beta", "stable"],
        "readiness",
    )?;
    check_value(
        patch.visibility.as_deref(),
        &["locked", "hidden"],
        "visibility",
    )?;

    let mut tx = pool.begin().await?;
    let before: Option<Module> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM modules WHERE id = $1 FOR UPDATE"
    )))
    .bind(id.as_str())
    .fetch_optional(&mut *tx)
    .await?;
    let before = before.ok_or(Error::Denied(DenyReason::NotFound))?;
    if let Some(expected) = patch.expected_version
        && expected != before.version
    {
        return Err(Error::Invalid(format!(
            "модуль уже изменён: версия {}, ожидалась {expected}",
            before.version
        )));
    }
    let after: Module = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "UPDATE modules SET installed = coalesce($2, installed), state = coalesce($3, state),
                readiness = coalesce($4, readiness), visibility = coalesce($5, visibility),
                version = version + 1, updated_at = now(), updated_by = $6
         WHERE id = $1 RETURNING {COLUMNS}"
    )))
    .bind(id.as_str())
    .bind(patch.installed)
    .bind(&patch.state)
    .bind(&patch.readiness)
    .bind(&patch.visibility)
    .bind(by.account_id())
    .fetch_one(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(by.account_id()),
            action: "module.updated".into(),
            target_kind: "module".into(),
            target_id: Some(id.to_string()),
            before: Some(serde_json::to_value(&before).expect("модуль сериализуется")),
            after: Some(serde_json::to_value(&after).expect("модуль сериализуется")),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(after)
}

fn check_value(value: Option<&str>, allowed: &[&str], field: &str) -> Result<()> {
    match value {
        Some(value) if !allowed.contains(&value) => Err(Error::Invalid(format!(
            "{field}: «{value}», допустимо: {}",
            allowed.join(", ")
        ))),
        _ => Ok(()),
    }
}
