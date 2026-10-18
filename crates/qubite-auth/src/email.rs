//! Письма с кодами (AUTH-002): подтверждение почты и восстановление пароля.
//!
//! В письме — 6-значный код и кнопка-ссылка с длинным токеном. В базе только
//! их SHA-256. Правила (D-186):
//! - подтверждение действует 24 часа, восстановление — 30 минут;
//! - 5 неверных кодов — код сгорает, нужно новое письмо;
//! - новое письмо не чаще раза в минуту и не больше 5 в час на почту; новое
//!   письмо отменяет старый код;
//! - ответ на запрос письма всегда одинаковый, есть аккаунт или нет, и даже
//!   если письмо не отправлено из-за лимита — по нему нельзя узнать, чья это почта;
//! - восстановление — только для активного аккаунта с подтверждённой почтой;
//!   новый пароль закрывает все сессии и устройства.
//!
//! Письмо уходит в фоне после записи в базу (до 3 попыток), поэтому время
//! ответа не зависит от почтового сервиса.

use std::time::Duration;

use qubite_mail::{Letter, Mailer, templates};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{
    Error, Passwords, Result, new_id, normalize_email, password, random_token, secs,
    sessions::{self, RevokeReason},
    token_hash,
};
use qubite_objects::{NewAuditEntry, audit};

/// Настройки писем с кодами.
#[derive(Debug, Clone)]
pub struct EmailCodes {
    /// Адрес Qubite Auth для ссылок в письмах, например `https://auth.qubiteapp.ru`.
    pub auth_url: String,
    pub verify_ttl: Duration,
    pub reset_ttl: Duration,
    /// Неверных кодов до того, как код сгорит.
    pub max_attempts: i32,
    /// Не чаще одного письма за этот срок на почту и цель.
    pub resend_after: Duration,
    /// Не больше писем в час на почту и цель.
    pub max_per_hour: i64,
}

impl Default for EmailCodes {
    fn default() -> Self {
        Self {
            auth_url: "http://localhost:5173".into(),
            verify_ttl: Duration::from_secs(24 * 60 * 60),
            reset_ttl: Duration::from_secs(30 * 60),
            max_attempts: 5,
            resend_after: Duration::from_secs(60),
            max_per_hour: 5,
        }
    }
}

/// Зачем письмо.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purpose {
    VerifyEmail,
    ResetPassword,
}

impl Purpose {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::VerifyEmail => "verify_email",
            Self::ResetPassword => "reset_password",
        }
    }

    fn ttl(self, config: &EmailCodes) -> Duration {
        match self {
            Self::VerifyEmail => config.verify_ttl,
            Self::ResetPassword => config.reset_ttl,
        }
    }

    /// Какой статус аккаунта нужен, чтобы письмо имело смысл.
    fn needs_status(self) -> &'static str {
        match self {
            Self::VerifyEmail => "pending_email",
            Self::ResetPassword => "active",
        }
    }

    fn path(self) -> &'static str {
        match self {
            Self::VerifyEmail => "verify-email",
            Self::ResetPassword => "reset-password",
        }
    }
}

/// Чем человек подтверждает, что письмо у него: кодом из письма или ссылкой.
#[derive(Debug, Clone)]
pub enum Proof {
    Code { email: String, code: String },
    Link { token: String },
}

/// Случайный 6-значный код без перекоса (отбрасываем «хвост» диапазона u32).
fn random_code() -> String {
    const LIMIT: u32 = 4_294_000_000; // кратно 1 000 000
    loop {
        let mut bytes = [0u8; 4];
        getrandom::fill(&mut bytes).expect("генератор случайных чисел ОС доступен");
        let value = u32::from_le_bytes(bytes);
        if value < LIMIT {
            return format!("{:06}", value % 1_000_000);
        }
    }
}

fn code_hash(challenge_id: Uuid, code: &str) -> Vec<u8> {
    token_hash(&format!("{challenge_id}:{code}"))
}

/// «24 часа», «30 минут» — для текста письма.
pub fn human_duration(duration: Duration) -> String {
    fn plural(n: u64, one: &str, few: &str, many: &str) -> String {
        let word = match (n % 10, n % 100) {
            (1, rest) if rest != 11 => one,
            (2..=4, rest) if !(12..=14).contains(&rest) => few,
            _ => many,
        };
        format!("{n} {word}")
    }
    let minutes = (duration.as_secs() / 60).max(1);
    if minutes == 24 * 60 {
        "сутки".into()
    } else if minutes.is_multiple_of(24 * 60) {
        plural(minutes / (24 * 60), "день", "дня", "дней")
    } else if minutes.is_multiple_of(60) {
        plural(minutes / 60, "час", "часа", "часов")
    } else {
        plural(minutes, "минуту", "минуты", "минут")
    }
}

#[derive(sqlx::FromRow)]
struct Target {
    id: Uuid,
    display_name: String,
    status: String,
}

/// Попросить письмо. Ответ одинаковый для любой почты: `Ok(())`.
/// Ошибка — только если почта записана неправильно или база недоступна.
pub async fn request(
    pool: &PgPool,
    mailer: &Mailer,
    config: &EmailCodes,
    purpose: Purpose,
    raw_email: &str,
    ip: &str,
) -> Result<()> {
    let email = normalize_email(raw_email)?;
    let mut tx = pool.begin().await?;
    // Запросы одной почты — по очереди, иначе два параллельных обошли бы лимит.
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('qubite.mail:' || $1, 0))")
        .bind(&email)
        .execute(&mut *tx)
        .await?;
    let target: Option<Target> =
        sqlx::query_as("SELECT id, display_name, status FROM accounts WHERE email = $1")
            .bind(&email)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(target) = target.filter(|t| t.status == purpose.needs_status()) else {
        tx.commit().await?;
        return Ok(());
    };

    let (recent, last_hour): (bool, i64) = sqlx::query_as(
        "SELECT coalesce(bool_or(created_at > now() - $3::float8 * interval '1 second'), false), \
                count(*) \
         FROM email_challenges \
         WHERE email = $1 AND purpose = $2 AND created_at > now() - interval '1 hour'",
    )
    .bind(&email)
    .bind(purpose.as_str())
    .bind(secs(config.resend_after))
    .fetch_one(&mut *tx)
    .await?;
    if recent || last_hour >= config.max_per_hour {
        tracing::info!(account = %target.id, purpose = purpose.as_str(), "письмо не отправлено: лимит");
        tx.commit().await?;
        return Ok(());
    }

    let letter = issue(
        &mut tx,
        config,
        purpose,
        target.id,
        &email,
        &target.display_name,
        ip,
    )
    .await?;
    tx.commit().await?;
    send_in_background(mailer.clone(), letter.to(&email), target.id);
    Ok(())
}

/// Создать код (старые коды той же цели сгорают) и собрать письмо.
pub(crate) async fn issue(
    conn: &mut PgConnection,
    config: &EmailCodes,
    purpose: Purpose,
    account_id: Uuid,
    email: &str,
    name: &str,
    ip: &str,
) -> Result<Letter> {
    sqlx::query(
        "UPDATE email_challenges SET closed_at = now(), closed_reason = 'replaced' \
         WHERE account_id = $1 AND purpose = $2 AND closed_at IS NULL",
    )
    .bind(account_id)
    .bind(purpose.as_str())
    .execute(&mut *conn)
    .await?;

    let id = new_id();
    let code = random_code();
    let link_token = random_token();
    let ttl = purpose.ttl(config);
    sqlx::query(
        "INSERT INTO email_challenges (id, account_id, purpose, email, code_hash, link_hash, ip, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8::float8 * interval '1 second')",
    )
    .bind(id)
    .bind(account_id)
    .bind(purpose.as_str())
    .bind(email)
    .bind(code_hash(id, &code))
    .bind(token_hash(&link_token))
    .bind(sessions::truncate(ip, 64))
    .bind(secs(ttl))
    .execute(&mut *conn)
    .await?;

    let link = format!(
        "{}/{}?token={link_token}",
        config.auth_url.trim_end_matches('/'),
        purpose.path()
    );
    let valid_for = human_duration(ttl);
    Ok(match purpose {
        Purpose::VerifyEmail => templates::verify_email(name, &code, &link, &valid_for),
        Purpose::ResetPassword => templates::reset_password(name, &code, &link, &valid_for),
    })
}

/// Отправить письмо в фоне: до 3 попыток с паузой 1 с и 4 с.
pub(crate) fn send_in_background(mailer: Mailer, email: qubite_mail::Email, account_id: Uuid) {
    tokio::spawn(async move {
        for attempt in 1..=3u32 {
            match mailer.send(&email).await {
                Ok(()) => {
                    tracing::info!(account = %account_id, mode = mailer.mode().as_str(), "письмо отправлено");
                    return;
                }
                Err(error) => {
                    tracing::warn!(account = %account_id, attempt, %error, "письмо не ушло");
                    if attempt < 3 {
                        tokio::time::sleep(Duration::from_secs(u64::from(4u32.pow(attempt - 1))))
                            .await;
                    }
                }
            }
        }
        tracing::error!(account = %account_id, "письмо так и не отправлено");
    });
}

#[derive(sqlx::FromRow)]
struct Challenge {
    id: Uuid,
    account_id: Uuid,
    code_hash: Vec<u8>,
    attempts: i32,
    expired: bool,
}

/// Проверить код или ссылку и закрыть его. `None` — неверно или устарело
/// (неверный код уже засчитан: транзакцию нужно сохранить).
async fn consume(
    conn: &mut PgConnection,
    config: &EmailCodes,
    purpose: Purpose,
    proof: &Proof,
) -> Result<Option<Uuid>> {
    const COLUMNS: &str = "id, account_id, code_hash, attempts, expires_at <= now() AS expired";
    match proof {
        Proof::Link { token } => {
            let found: Option<Challenge> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "SELECT {COLUMNS} FROM email_challenges \
                 WHERE link_hash = $1 AND purpose = $2 AND closed_at IS NULL FOR UPDATE"
            )))
            .bind(token_hash(token.trim()))
            .bind(purpose.as_str())
            .fetch_optional(&mut *conn)
            .await?;
            let Some(challenge) = found.filter(|c| !c.expired) else {
                return Ok(None);
            };
            close(conn, challenge.id, "used").await?;
            Ok(Some(challenge.account_id))
        }
        Proof::Code { email, code } => {
            let Ok(email) = normalize_email(email) else {
                return Ok(None);
            };
            let code: String = code.chars().filter(char::is_ascii_digit).collect();
            let found: Option<Challenge> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "SELECT {COLUMNS} FROM email_challenges \
                 WHERE email = $1 AND purpose = $2 AND closed_at IS NULL \
                 ORDER BY created_at DESC LIMIT 1 FOR UPDATE"
            )))
            .bind(&email)
            .bind(purpose.as_str())
            .fetch_optional(&mut *conn)
            .await?;
            let Some(challenge) = found.filter(|c| !c.expired) else {
                return Ok(None);
            };
            if code.len() == 6 && code_hash(challenge.id, &code) == challenge.code_hash {
                close(conn, challenge.id, "used").await?;
                return Ok(Some(challenge.account_id));
            }
            let attempts = challenge.attempts + 1;
            sqlx::query("UPDATE email_challenges SET attempts = $2 WHERE id = $1")
                .bind(challenge.id)
                .bind(attempts)
                .execute(&mut *conn)
                .await?;
            if attempts >= config.max_attempts {
                close(conn, challenge.id, "attempts").await?;
            }
            Ok(None)
        }
    }
}

async fn close(conn: &mut PgConnection, id: Uuid, reason: &str) -> Result<()> {
    sqlx::query("UPDATE email_challenges SET closed_at = now(), closed_reason = $2 WHERE id = $1")
        .bind(id)
        .bind(reason)
        .execute(conn)
        .await?;
    Ok(())
}

/// Подтвердить почту. Аккаунт `pending_email` становится активным.
pub async fn verify_email(pool: &PgPool, config: &EmailCodes, proof: &Proof) -> Result<Uuid> {
    let mut tx = pool.begin().await?;
    let Some(account_id) = consume(&mut tx, config, Purpose::VerifyEmail, proof).await? else {
        tx.commit().await?;
        return Err(Error::InvalidCode);
    };
    sqlx::query(
        "UPDATE accounts SET email_verified_at = coalesce(email_verified_at, now()), \
         status = CASE WHEN status = 'pending_email' THEN 'active' ELSE status END, \
         updated_at = now() WHERE id = $1",
    )
    .bind(account_id)
    .execute(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(account_id),
            action: "auth.email_verified".into(),
            target_kind: "account".into(),
            target_id: Some(account_id.to_string()),
            after: Some(serde_json::json!({ "method": proof_kind(proof) })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(account_id)
}

/// Задать новый пароль по коду или ссылке из письма. Все сессии и устройства
/// аккаунта закрываются. Возвращает число закрытых сессий.
pub async fn reset_password(
    pool: &PgPool,
    passwords: &Passwords,
    config: &EmailCodes,
    proof: &Proof,
    new_password: &str,
) -> Result<u64> {
    // Слабый пароль не должен «сжигать» код: проверяем и хешируем до транзакции
    // (и очередь на Argon2 не держит соединение с базой).
    password::validate(new_password)?;
    let hash = passwords.hash(new_password).await?;

    let mut tx = pool.begin().await?;
    let Some(account_id) = consume(&mut tx, config, Purpose::ResetPassword, proof).await? else {
        tx.commit().await?;
        return Err(Error::InvalidCode);
    };
    let email: Option<String> =
        sqlx::query_scalar("SELECT email FROM accounts WHERE id = $1 AND status = 'active'")
            .bind(account_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some(email) = email else {
        // Аккаунт заблокировали после письма — код использован впустую.
        tx.commit().await?;
        return Err(Error::InvalidCode);
    };
    sqlx::query(
        "INSERT INTO credentials_password (account_id, hash) VALUES ($1, $2) \
         ON CONFLICT (account_id) DO UPDATE SET hash = EXCLUDED.hash, updated_at = now()",
    )
    .bind(account_id)
    .bind(&hash)
    .execute(&mut *tx)
    .await?;
    let revoked =
        sessions::revoke_all_in(&mut tx, account_id, RevokeReason::PasswordChanged).await?;
    // Письмо доказало владение почтой — снимаем блокировку входа за перебор.
    sqlx::query("INSERT INTO login_attempts (email, success) VALUES ($1, true)")
        .bind(&email)
        .execute(&mut *tx)
        .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(account_id),
            action: "auth.password_reset".into(),
            target_kind: "account".into(),
            target_id: Some(account_id.to_string()),
            after: Some(serde_json::json!({
                "password": "[скрыт]",
                "method": proof_kind(proof),
                "sessions_revoked": revoked,
            })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(revoked)
}

fn proof_kind(proof: &Proof) -> &'static str {
    match proof {
        Proof::Code { .. } => "code",
        Proof::Link { .. } => "link",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_six_digits() {
        for _ in 0..200 {
            let code = random_code();
            assert_eq!(code.len(), 6);
            assert!(code.chars().all(|c| c.is_ascii_digit()));
        }
    }

    #[test]
    fn durations_in_russian() {
        assert_eq!(human_duration(Duration::from_secs(24 * 3600)), "сутки");
        assert_eq!(human_duration(Duration::from_secs(30 * 60)), "30 минут");
        assert_eq!(human_duration(Duration::from_secs(2 * 3600)), "2 часа");
        assert_eq!(human_duration(Duration::from_secs(21 * 60)), "21 минуту");
        assert_eq!(human_duration(Duration::from_secs(7 * 24 * 3600)), "7 дней");
        assert_eq!(human_duration(Duration::from_secs(2 * 24 * 3600)), "2 дня");
        assert_eq!(human_duration(Duration::from_secs(11 * 60)), "11 минут");
    }
}
