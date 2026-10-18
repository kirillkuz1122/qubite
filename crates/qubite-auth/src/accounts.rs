//! Обычные аккаунты. Регистрации пока нет (AUTH-003): аккаунт создаёт owner
//! вручную (Owner Console, ACC-003) или тест. Новый аккаунт не получает
//! ни одного модуля (D-054, D-172).

use sqlx::PgPool;
use uuid::Uuid;

use crate::{Account, Error, Passwords, Result, new_id, normalize_email, password};
use qubite_objects::{NewAuditEntry, audit};

/// Данные нового аккаунта.
#[derive(Debug, Clone)]
pub struct NewAccount<'a> {
    pub email: &'a str,
    pub display_name: &'a str,
    pub password: &'a str,
    /// Почта уже подтверждена (аккаунт сразу активен). Иначе — `pending_email`.
    pub email_verified: bool,
}

/// Создать аккаунт. `created_by` — кто создал (owner) или `None` (система).
pub async fn create(
    pool: &PgPool,
    passwords: &Passwords,
    new: NewAccount<'_>,
    created_by: Option<Uuid>,
) -> Result<Account> {
    let email = normalize_email(new.email)?;
    let display_name = new.display_name.trim();
    if display_name.chars().count() > 100 {
        return Err(Error::Invalid("имя длиннее 100 символов".into()));
    }
    password::validate(new.password)?;
    let hash = passwords.hash(new.password).await?;

    let mut tx = pool.begin().await?;
    let account: Account = sqlx::query_as(
        "INSERT INTO accounts (id, email, email_verified_at, status, display_name) \
         VALUES ($1, $2, CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN 'active' ELSE 'pending_email' END, $4) \
         RETURNING id, email, display_name, status, created_at",
    )
    .bind(new_id())
    .bind(&email)
    .bind(new.email_verified)
    .bind(display_name)
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => Error::EmailTaken,
        _ => Error::Db(error),
    })?;
    sqlx::query("INSERT INTO credentials_password (account_id, hash) VALUES ($1, $2)")
        .bind(account.id)
        .bind(&hash)
        .execute(&mut *tx)
        .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: created_by,
            action: "account.created".into(),
            target_kind: "account".into(),
            target_id: Some(account.id.to_string()),
            after: Some(serde_json::json!({ "email": email, "status": account.status })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(account)
}
