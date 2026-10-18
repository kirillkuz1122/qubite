//! Приглашения (AUTH-003, D-057): на конкретную почту или общая ссылка.
//!
//! Одноразовые, со сроком (7 дней по умолчанию), отзываемые. Код — 12 знаков
//! без похожих букв (`7KQ2-M9XD-4TPR`), его же содержит ссылка
//! `…/register?invite=…`. Код показывается один раз, в базе — SHA-256.

use std::time::Duration;

use qubite_mail::{Mailer, templates};
use serde::Serialize;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, Result, email, new_id, normalize_email, secs, token_hash};
use qubite_objects::{NewAuditEntry, audit};

/// Срок по умолчанию.
pub const DEFAULT_TTL: Duration = Duration::from_secs(7 * 24 * 60 * 60);
/// Самый долгий срок.
pub const MAX_TTL_DAYS: u32 = 30;

/// Алфавит Крокфорда: без I, L, O, U — их не спутать с 1 и 0.
const ALPHABET: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Kind {
    EmailBound,
    OpenLink,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::EmailBound => "email_bound",
            Self::OpenLink => "open_link",
        }
    }
}

/// Новое приглашение.
#[derive(Debug, Clone)]
pub struct NewInvitation {
    /// Почта — приглашение только для неё; `None` — общая ссылка.
    pub email: Option<String>,
    pub ttl: Duration,
    /// Заметка owner для себя («для Пети»).
    pub note: String,
}

/// Только что созданное приглашение: код есть только здесь.
#[derive(Debug, Clone)]
pub struct IssuedInvitation {
    pub id: Uuid,
    pub code: String,
    pub link: String,
    pub expires_at: OffsetDateTime,
    /// Письмо с приглашением ушло (только для приглашений на почту).
    pub emailed: bool,
}

/// Приглашение в списке owner (без кода).
#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct InvitationView {
    pub id: Uuid,
    pub kind: String,
    pub email: Option<String>,
    pub note: String,
    pub created_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
    pub used_at: Option<OffsetDateTime>,
    pub used_by_email: Option<String>,
    pub revoked_at: Option<OffsetDateTime>,
    /// `active`, `used`, `revoked` или `expired`.
    pub status: String,
}

/// Случайный код: 12 знаков = 60 бит.
fn random_code() -> String {
    let mut bytes = [0u8; 12];
    getrandom::fill(&mut bytes).expect("генератор случайных чисел ОС доступен");
    bytes
        .iter()
        .map(|byte| ALPHABET[usize::from(byte & 31)] as char)
        .collect()
}

/// Код в каноническом виде: заглавные, без дефисов и пробелов, O→0, I/L→1.
pub fn normalize_code(raw: &str) -> String {
    raw.chars()
        .filter(|ch| !matches!(ch, '-' | ' ' | '\t'))
        .map(|ch| match ch.to_ascii_uppercase() {
            'O' => '0',
            'I' | 'L' => '1',
            other => other,
        })
        .collect()
}

/// Код для показа человеку: `XXXX-XXXX-XXXX`.
pub fn format_code(code: &str) -> String {
    code.as_bytes()
        .chunks(4)
        .map(|chunk| String::from_utf8_lossy(chunk).into_owned())
        .collect::<Vec<_>>()
        .join("-")
}

pub(crate) fn code_hash(code: &str) -> Vec<u8> {
    token_hash(&format!("invite:{}", normalize_code(code)))
}

fn link(auth_url: &str, code: &str) -> String {
    format!("{}/register?invite={code}", auth_url.trim_end_matches('/'))
}

/// Создать приглашение (только owner — проверяет вызывающий). Приглашение на
/// почту сразу уходит письмом, если почта включена (`send_email`).
pub async fn create(
    pool: &PgPool,
    mailer: &Mailer,
    codes: &email::EmailCodes,
    send_email: bool,
    owner_id: Uuid,
    new: NewInvitation,
) -> Result<IssuedInvitation> {
    let email = new.email.as_deref().map(normalize_email).transpose()?;
    let note = new.note.trim();
    if note.chars().count() > 200 {
        return Err(Error::Invalid("заметка длиннее 200 символов".into()));
    }
    let max = Duration::from_secs(u64::from(MAX_TTL_DAYS) * 24 * 60 * 60);
    if new.ttl.is_zero() || new.ttl > max {
        return Err(Error::Invalid(format!(
            "срок приглашения — от 1 до {MAX_TTL_DAYS} дней"
        )));
    }
    let kind = if email.is_some() {
        Kind::EmailBound
    } else {
        Kind::OpenLink
    };
    let id = new_id();
    let code = random_code();

    let mut tx = pool.begin().await?;
    let expires_at: OffsetDateTime = sqlx::query_scalar(
        "INSERT INTO invitations (id, kind, email, code_hash, note, created_by, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, now() + $7::float8 * interval '1 second') RETURNING expires_at",
    )
    .bind(id)
    .bind(kind.as_str())
    .bind(&email)
    .bind(code_hash(&code))
    .bind(note)
    .bind(owner_id)
    .bind(secs(new.ttl))
    .fetch_one(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(owner_id),
            action: "invitation.created".into(),
            target_kind: "invitation".into(),
            target_id: Some(id.to_string()),
            after: Some(serde_json::json!({
                "kind": kind.as_str(),
                "email": email,
                "note": note,
                "expires_at": expires_at.unix_timestamp(),
            })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    let inviter: String = sqlx::query_scalar("SELECT display_name FROM accounts WHERE id = $1")
        .bind(owner_id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;

    let link = link(&codes.auth_url, &code);
    let emailed = if let Some(email) = email.as_ref().filter(|_| send_email) {
        let letter = templates::invitation(
            &inviter,
            &format_code(&code),
            &link,
            &email::human_duration(new.ttl),
        );
        email::send_in_background(mailer.clone(), letter.to(email), owner_id);
        true
    } else {
        false
    };
    Ok(IssuedInvitation {
        id,
        code: format_code(&code),
        link,
        expires_at,
        emailed,
    })
}

/// Все приглашения, свежие сверху.
pub async fn list(pool: &PgPool) -> Result<Vec<InvitationView>> {
    Ok(sqlx::query_as(
        "SELECT i.id, i.kind, i.email, i.note, i.created_at, i.expires_at, i.used_at, \
                a.email AS used_by_email, i.revoked_at, \
                CASE WHEN i.used_at IS NOT NULL THEN 'used' \
                     WHEN i.revoked_at IS NOT NULL THEN 'revoked' \
                     WHEN i.expires_at <= now() THEN 'expired' \
                     ELSE 'active' END AS status \
         FROM invitations i LEFT JOIN accounts a ON a.id = i.used_by \
         ORDER BY i.created_at DESC LIMIT 500",
    )
    .fetch_all(pool)
    .await?)
}

/// Отозвать действующее приглашение. Использованное или уже отозванное — `false`.
pub async fn revoke(pool: &PgPool, owner_id: Uuid, id: Uuid) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let revoked = sqlx::query(
        "UPDATE invitations SET revoked_at = now(), revoked_by = $2 \
         WHERE id = $1 AND used_at IS NULL AND revoked_at IS NULL",
    )
    .bind(id)
    .bind(owner_id)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if revoked {
        audit::record(
            &mut tx,
            NewAuditEntry {
                actor_id: Some(owner_id),
                action: "invitation.revoked".into(),
                target_kind: "invitation".into(),
                target_id: Some(id.to_string()),
                ..NewAuditEntry::default()
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(revoked)
}

/// Найти действующее приглашение по коду и заблокировать его строку до конца
/// транзакции: две регистрации по одной ссылке пойдут по очереди, и вторая
/// увидит, что приглашение уже использовано.
pub(crate) async fn lock_usable(conn: &mut PgConnection, code: &str, email: &str) -> Result<Uuid> {
    let found: Option<(Uuid, Option<String>, bool)> = sqlx::query_as(
        "SELECT id, email, (used_at IS NULL AND revoked_at IS NULL AND expires_at > now()) \
         FROM invitations WHERE code_hash = $1 FOR UPDATE",
    )
    .bind(code_hash(code))
    .fetch_optional(conn)
    .await?;
    match found {
        Some((id, bound, true)) if bound.as_deref().is_none_or(|bound| bound == email) => Ok(id),
        _ => Err(Error::InvalidInvite),
    }
}

/// Отметить приглашение использованным (строка уже заблокирована).
pub(crate) async fn mark_used(conn: &mut PgConnection, id: Uuid, account_id: Uuid) -> Result<()> {
    sqlx::query("UPDATE invitations SET used_at = now(), used_by = $2 WHERE id = $1")
        .bind(id)
        .bind(account_id)
        .execute(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_readable_and_forgiving() {
        let code = random_code();
        assert_eq!(code.len(), 12);
        assert!(code.bytes().all(|b| ALPHABET.contains(&b)));
        let shown = format_code(&code);
        assert_eq!(shown.len(), 14);
        assert_eq!(normalize_code(&shown.to_lowercase()), code);
        assert_eq!(normalize_code("o1l-i 0"), "01110");
        assert_eq!(code_hash("7kq2-m9xd-4tpr"), code_hash("7KQ2M9XD4TPR"));
    }
}
