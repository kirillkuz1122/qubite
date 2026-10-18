//! Вход по почте и паролю с лимитами перебора.
//!
//! Лимиты (D-171): не больше 5 неудачных попыток на одну почту и 30 с одного
//! IP-адреса за 15 минут. Сверх лимита пароль даже не проверяется — сразу
//! отказ «повторите через N секунд». Удачный вход обнуляет счётчик почты.
//!
//! Попытки по одной почте выполняются строго по очереди (блокировка в базе),
//! поэтому параллельные запросы не обходят лимит.

use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    AuthConfig, Error, IssuedSession, Limit, Passwords, Result, secs,
    sessions::{self, ClientInfo},
};
use qubite_objects::{NewAuditEntry, audit};

/// Данные формы входа и откуда она пришла.
#[derive(Debug, Clone)]
pub struct LoginInput {
    pub email: String,
    pub password: String,
    pub client: ClientInfo,
}

#[derive(sqlx::FromRow)]
struct Candidate {
    id: Uuid,
    status: String,
    hash: Option<String>,
}

/// Проверить почту и пароль и открыть сессию.
pub async fn login(
    pool: &PgPool,
    passwords: &Passwords,
    config: &AuthConfig,
    input: LoginInput,
) -> Result<IssuedSession> {
    // Для лимита берём почту в простом каноническом виде даже если она
    // неправильная: перебор «неправильных почт» тоже считается.
    let email = input.email.trim().to_lowercase();
    let ip = input.client.ip.as_str();
    if email.is_empty()
        || email.len() > 320
        || input.password.len() > crate::password::MAX_PASSWORD_BYTES
    {
        return Err(Error::InvalidCredentials);
    }

    let mut tx = pool.begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('qubite.login:' || $1, 0))")
        .bind(&email)
        .execute(&mut *tx)
        .await?;
    // Журнал попыток живёт сутки.
    sqlx::query(
        "DELETE FROM login_attempts WHERE id IN \
         (SELECT id FROM login_attempts WHERE at < now() - interval '1 day' LIMIT 500)",
    )
    .execute(&mut *tx)
    .await?;

    if let Some(retry_after_secs) = throttled(&mut tx, &email, ip, config).await? {
        tx.commit().await?;
        tracing::warn!(retry_after_secs, "вход: превышен лимит попыток");
        return Err(Error::TooManyAttempts { retry_after_secs });
    }

    let candidate: Option<Candidate> = sqlx::query_as(
        "SELECT a.id, a.status, c.hash FROM accounts a \
         LEFT JOIN credentials_password c ON c.account_id = a.id WHERE a.email = $1",
    )
    .bind(&email)
    .fetch_optional(&mut *tx)
    .await?;

    let verified = match &candidate {
        Some(Candidate {
            hash: Some(hash), ..
        }) => passwords.verify(&input.password, hash).await?,
        _ => passwords.verify_dummy(&input.password).await?,
    };
    let account = match candidate {
        Some(account) if verified => account,
        _ => {
            record_attempt(&mut tx, &email, ip, false).await?;
            tx.commit().await?;
            return Err(Error::InvalidCredentials);
        }
    };
    // Пароль верный — только теперь можно сказать, что не так с аккаунтом.
    match account.status.as_str() {
        "active" => {}
        "blocked" => return Err(Error::AccountBlocked),
        _ => return Err(Error::EmailNotVerified),
    }

    record_attempt(&mut tx, &email, ip, true).await?;
    let session = sessions::create(&mut tx, account.id, &input.client, config.session_ttl).await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(account.id),
            action: "auth.login".into(),
            target_kind: "session".into(),
            target_id: Some(session.id.to_string()),
            after: Some(serde_json::json!({
                "method": "password",
                "ip": input.client.ip,
                "user_agent": input.client.user_agent,
            })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(session)
}

/// Через сколько секунд можно повторить, если лимит превышен.
async fn throttled(
    conn: &mut sqlx::PgConnection,
    email: &str,
    ip: &str,
    config: &AuthConfig,
) -> Result<Option<u64>> {
    // Неудачи по почте считаются после последнего удачного входа.
    let by_email = failures(
        conn,
        "SELECT count(*), min(at) FROM login_attempts \
         WHERE email = $1 AND NOT success AND at > now() - $2::float8 * interval '1 second' \
           AND at > coalesce((SELECT max(at) FROM login_attempts WHERE email = $1 AND success), \
                             '-infinity')",
        email,
        config.email_limit,
    )
    .await?;
    if by_email.is_some() || ip.is_empty() {
        return Ok(by_email);
    }
    failures(
        conn,
        "SELECT count(*), min(at) FROM login_attempts \
         WHERE ip = $1 AND NOT success AND at > now() - $2::float8 * interval '1 second'",
        ip,
        config.ip_limit,
    )
    .await
}

async fn failures(
    conn: &mut sqlx::PgConnection,
    sql: &'static str,
    key: &str,
    limit: Limit,
) -> Result<Option<u64>> {
    let (count, oldest): (i64, Option<OffsetDateTime>) = sqlx::query_as(sql)
        .bind(key)
        .bind(secs(limit.window))
        .fetch_one(conn)
        .await?;
    if count < limit.max_failures {
        return Ok(None);
    }
    let oldest = oldest.unwrap_or_else(OffsetDateTime::now_utc);
    let until = oldest + limit.window;
    let wait = (until - OffsetDateTime::now_utc()).whole_seconds().max(1);
    Ok(Some(u64::try_from(wait).unwrap_or(1)))
}

async fn record_attempt(
    conn: &mut sqlx::PgConnection,
    email: &str,
    ip: &str,
    success: bool,
) -> Result<()> {
    sqlx::query("INSERT INTO login_attempts (email, ip, success) VALUES ($1, $2, $3)")
        .bind(email)
        .bind(ip)
        .bind(success)
        .execute(conn)
        .await?;
    Ok(())
}
