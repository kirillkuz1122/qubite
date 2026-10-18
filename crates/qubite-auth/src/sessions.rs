//! Сессии браузера.
//!
//! При входе создаются два случайных токена: токен сессии (в cookie
//! `HttpOnly`, JavaScript его не видит) и CSRF-токен (его сайт отправляет в
//! заголовке `X-CSRF-Token` при каждом изменяющем запросе). В базе — только
//! их SHA-256.
//!
//! Срок — 30 дней и продлевается при использовании: если сессией не
//! пользоваться месяц, она истекает (D-170). Отозванная или истёкшая сессия
//! перестаёт работать на следующем же запросе: каждый запрос сверяется с базой.

use std::time::Duration;

use serde::Serialize;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{AuthConfig, Result, new_id, random_token, secs, token_hash};
use qubite_objects::{NewAuditEntry, audit};

/// Только что созданная сессия. Токены есть только здесь — в базе их нет.
#[derive(Debug, Clone)]
pub struct IssuedSession {
    pub id: Uuid,
    pub account_id: Uuid,
    pub token: String,
    pub csrf_token: String,
    pub expires_at: OffsetDateTime,
}

/// Откуда пришёл вход: показывается в списке сессий.
#[derive(Debug, Clone, Default)]
pub struct ClientInfo {
    pub user_agent: String,
    pub ip: String,
}

/// Сессия, найденная по токену из cookie.
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct ResolvedSession {
    pub id: Uuid,
    pub account_id: Uuid,
    pub email: String,
    pub display_name: String,
    pub is_owner: bool,
    pub csrf_hash: Vec<u8>,
    pub expires_at: OffsetDateTime,
    /// Срок продлён этим запросом — нужно обновить cookie.
    #[sqlx(skip)]
    pub extended: bool,
}

impl ResolvedSession {
    /// Совпадает ли CSRF-токен из заголовка с токеном этой сессии.
    pub fn csrf_matches(&self, header: &str) -> bool {
        token_hash(header) == self.csrf_hash
    }
}

/// Сессия в списке «Мои сессии».
#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct SessionView {
    pub id: Uuid,
    pub kind: String,
    pub user_agent: String,
    pub ip: String,
    pub created_at: OffsetDateTime,
    pub last_seen_at: OffsetDateTime,
    pub expires_at: OffsetDateTime,
}

/// Почему сессия закрыта.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RevokeReason {
    /// Пользователь вышел.
    Logout,
    /// Сессию закрыли из списка сессий.
    Revoked,
    /// «Выйти везде».
    LogoutEverywhere,
    /// Сменился пароль.
    PasswordChanged,
}

impl RevokeReason {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Logout => "logout",
            Self::Revoked => "revoked",
            Self::LogoutEverywhere => "logout_everywhere",
            Self::PasswordChanged => "password_changed",
        }
    }
}

/// Создать web-сессию (внутри транзакции входа).
pub async fn create(
    conn: &mut PgConnection,
    account_id: Uuid,
    client: &ClientInfo,
    ttl: Duration,
) -> Result<IssuedSession> {
    let id = new_id();
    let token = random_token();
    let csrf_token = random_token();
    let expires_at: OffsetDateTime = sqlx::query_scalar(
        "INSERT INTO sessions (id, account_id, token_hash, csrf_hash, kind, user_agent, ip, expires_at) \
         VALUES ($1, $2, $3, $4, 'web', $5, $6, now() + $7::float8 * interval '1 second') \
         RETURNING expires_at",
    )
    .bind(id)
    .bind(account_id)
    .bind(token_hash(&token))
    .bind(token_hash(&csrf_token))
    .bind(truncate(&client.user_agent, 500))
    .bind(truncate(&client.ip, 64))
    .bind(secs(ttl))
    .fetch_one(conn)
    .await?;
    Ok(IssuedSession {
        id,
        account_id,
        token,
        csrf_token,
        expires_at,
    })
}

/// Найти живую сессию по токену из cookie. Неизвестный, отозванный, истёкший
/// токен или неактивный аккаунт — `None`. Раз в `touch_interval` отмечает
/// использование и продлевает срок.
pub async fn resolve(
    pool: &PgPool,
    config: &AuthConfig,
    token: &str,
) -> Result<Option<ResolvedSession>> {
    let found: Option<(ResolvedSession, bool)> = sqlx::query_as::<_, ResolvedRow>(
        "SELECT s.id, s.account_id, a.email, a.display_name, \
                (o.account_id IS NOT NULL) AS is_owner, s.csrf_hash, s.expires_at, \
                (s.last_seen_at < now() - $2::float8 * interval '1 second') AS stale \
         FROM sessions s \
         JOIN accounts a ON a.id = s.account_id \
         LEFT JOIN platform_owner o ON o.account_id = a.id \
         WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() \
           AND a.status = 'active'",
    )
    .bind(token_hash(token))
    .bind(secs(config.touch_interval))
    .fetch_optional(pool)
    .await?
    .map(|row| (row.session, row.stale));

    let Some((mut session, stale)) = found else {
        return Ok(None);
    };
    if stale {
        let extended: Option<OffsetDateTime> = sqlx::query_scalar(
            "UPDATE sessions SET last_seen_at = now(), \
                    expires_at = now() + $2::float8 * interval '1 second' \
             WHERE id = $1 AND revoked_at IS NULL RETURNING expires_at",
        )
        .bind(session.id)
        .bind(secs(config.session_ttl))
        .fetch_optional(pool)
        .await?;
        match extended {
            Some(expires_at) => {
                session.expires_at = expires_at;
                session.extended = true;
            }
            // Сессию отозвали между двумя запросами.
            None => return Ok(None),
        }
    }
    Ok(Some(session))
}

#[derive(sqlx::FromRow)]
struct ResolvedRow {
    #[sqlx(flatten)]
    session: ResolvedSession,
    stale: bool,
}

/// Живые сессии аккаунта, свежие сверху.
pub async fn list(pool: &PgPool, account_id: Uuid) -> Result<Vec<SessionView>> {
    Ok(sqlx::query_as(
        "SELECT id, kind, user_agent, ip, created_at, last_seen_at, expires_at FROM sessions \
         WHERE account_id = $1 AND revoked_at IS NULL AND expires_at > now() \
         ORDER BY last_seen_at DESC, id DESC",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await?)
}

/// Закрыть одну свою сессию. Чужую или уже закрытую — `false`.
pub async fn revoke(
    pool: &PgPool,
    account_id: Uuid,
    session_id: Uuid,
    reason: RevokeReason,
) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let revoked = sqlx::query(
        "UPDATE sessions SET revoked_at = now(), revoke_reason = $3 \
         WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL",
    )
    .bind(session_id)
    .bind(account_id)
    .bind(reason.as_str())
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if revoked {
        let action = match reason {
            RevokeReason::Logout => "auth.logout",
            _ => "auth.session_revoked",
        };
        audit::record(
            &mut tx,
            NewAuditEntry {
                actor_id: Some(account_id),
                action: action.into(),
                target_kind: "session".into(),
                target_id: Some(session_id.to_string()),
                reason: Some(reason.as_str().into()),
                ..NewAuditEntry::default()
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(revoked)
}

/// «Выйти везде»: закрыть все сессии аккаунта, включая текущую.
pub async fn revoke_all(pool: &PgPool, account_id: Uuid) -> Result<u64> {
    let mut tx = pool.begin().await?;
    let count = revoke_all_in(&mut tx, account_id, RevokeReason::LogoutEverywhere).await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(account_id),
            action: "auth.logout_everywhere".into(),
            target_kind: "account".into(),
            target_id: Some(account_id.to_string()),
            after: Some(serde_json::json!({ "sessions_revoked": count })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(count)
}

pub(crate) async fn revoke_all_in(
    conn: &mut PgConnection,
    account_id: Uuid,
    reason: RevokeReason,
) -> Result<u64> {
    Ok(sqlx::query(
        "UPDATE sessions SET revoked_at = now(), revoke_reason = $2 \
         WHERE account_id = $1 AND revoked_at IS NULL",
    )
    .bind(account_id)
    .bind(reason.as_str())
    .execute(conn)
    .await?
    .rows_affected())
}

fn truncate(value: &str, max_bytes: usize) -> &str {
    if value.len() <= max_bytes {
        return value;
    }
    let mut end = max_bytes;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    &value[..end]
}

#[cfg(test)]
mod tests {
    use super::truncate;

    #[test]
    fn truncate_keeps_whole_characters() {
        assert_eq!(truncate("абв", 3), "а");
        assert_eq!(truncate("abc", 10), "abc");
    }
}
