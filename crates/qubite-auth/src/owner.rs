//! Owner платформы — один на всю установку (D-052, D-053).
//!
//! Создаётся только командой `qubite owner create`; HTTP-маршрута нет.
//! Второго owner не даст создать сама база: у таблицы `platform_owner`
//! первичный ключ — константа `true`.

use serde::Serialize;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, Passwords, Result, RevokeReason, new_id, normalize_email, password, sessions};
use qubite_objects::{NewAuditEntry, audit};

/// Аккаунт без секретов.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct Account {
    pub id: Uuid,
    pub email: String,
    pub display_name: String,
    pub status: String,
    pub created_at: OffsetDateTime,
}

const ACCOUNT_COLUMNS: &str = "id, email, display_name, status, created_at";

/// Создать owner платформы. Почта owner считается подтверждённой: её вводит
/// тот, кто устанавливает сервер.
pub async fn create(
    pool: &PgPool,
    passwords: &Passwords,
    email: &str,
    display_name: &str,
    new_password: &str,
) -> Result<Account> {
    let email = normalize_email(email)?;
    let display_name = display_name.trim();
    if display_name.chars().count() > 100 {
        return Err(Error::Invalid("имя длиннее 100 символов".into()));
    }
    password::validate(new_password)?;
    if current(pool).await?.is_some() {
        return Err(Error::OwnerExists);
    }
    let hash = passwords.hash(new_password).await?;

    let mut tx = pool.begin().await?;
    let account: Account = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO accounts (id, email, email_verified_at, status, display_name) \
         VALUES ($1, $2, now(), 'active', $3) RETURNING {ACCOUNT_COLUMNS}"
    )))
    .bind(new_id())
    .bind(&email)
    .bind(display_name)
    .fetch_one(&mut *tx)
    .await
    .map_err(map_unique)?;
    sqlx::query("INSERT INTO credentials_password (account_id, hash) VALUES ($1, $2)")
        .bind(account.id)
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
    sqlx::query("INSERT INTO platform_owner (account_id) VALUES ($1)")
        .bind(account.id)
        .execute(&mut *tx)
        .await
        .map_err(map_unique)?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: None,
            action: "platform.owner_created".into(),
            target_kind: "account".into(),
            target_id: Some(account.id.to_string()),
            after: Some(serde_json::json!({ "email": email, "password": "[скрыт]" })),
            reason: Some("qubite owner create".into()),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(account)
}

/// Текущий owner, если он уже создан.
pub async fn current(pool: &PgPool) -> Result<Option<Account>> {
    Ok(sqlx::query_as(
        "SELECT a.id, a.email, a.display_name, a.status, a.created_at \
         FROM accounts a JOIN platform_owner o ON o.account_id = a.id",
    )
    .fetch_optional(pool)
    .await?)
}

/// Является ли аккаунт owner платформы.
pub async fn is_owner(conn: &mut PgConnection, account_id: Uuid) -> Result<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM platform_owner WHERE account_id = $1)")
            .bind(account_id)
            .fetch_one(conn)
            .await?,
    )
}

/// Сменить пароль owner (команда `qubite owner password`). Пока нет
/// восстановления по почте (AUTH-002), это единственный способ вернуть вход.
/// Все сессии owner отзываются.
pub async fn set_password(pool: &PgPool, passwords: &Passwords, new_password: &str) -> Result<u64> {
    password::validate(new_password)?;
    let owner = current(pool).await?.ok_or(Error::NoOwner)?;
    let hash = passwords.hash(new_password).await?;

    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO credentials_password (account_id, hash) VALUES ($1, $2) \
         ON CONFLICT (account_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()",
    )
    .bind(owner.id)
    .bind(&hash)
    .execute(&mut *tx)
    .await?;
    let revoked = sessions::revoke_all_in(&mut tx, owner.id, RevokeReason::PasswordChanged).await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: None,
            action: "auth.password_changed".into(),
            target_kind: "account".into(),
            target_id: Some(owner.id.to_string()),
            after: Some(serde_json::json!({ "password": "[скрыт]", "sessions_revoked": revoked })),
            reason: Some("qubite owner password".into()),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(revoked)
}

fn map_unique(error: sqlx::Error) -> Error {
    if let sqlx::Error::Database(db) = &error
        && db.code().as_deref() == Some("23505")
    {
        return match db.constraint() {
            Some("accounts_email_key") => Error::EmailTaken,
            _ => Error::OwnerExists,
        };
    }
    Error::Db(error)
}
