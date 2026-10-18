//! База: начатые входы, привязки, вход по привязке.

use std::time::Duration;

use qubite_auth::{AuthConfig, ClientInfo, IssuedSession, sessions};
use qubite_objects::{NewAuditEntry, audit};
use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, Identity, Intent, Provider, Result};

/// Путь возврата на нашем сайте: только «/что-то», без чужих адресов.
fn safe_return(path: &str) -> String {
    let ok = path.starts_with('/')
        && !path.starts_with("//")
        && !path.starts_with("/\\")
        && path.len() <= 500
        && !path.chars().any(char::is_control);
    if ok { path.to_owned() } else { "/".into() }
}

pub(crate) async fn create_flow(
    pool: &PgPool,
    provider: Provider,
    intent: &Intent,
    ttl: Duration,
) -> Result<(String, String)> {
    let state = qubite_auth::random_token();
    let verifier = qubite_auth::random_token();
    let (kind, account, session, return_to) = match intent {
        Intent::Login { return_to } => ("login", None, None, safe_return(return_to)),
        Intent::Link {
            account_id,
            session_id,
        } => ("link", Some(*account_id), Some(*session_id), "/".to_owned()),
    };
    let mut tx = pool.begin().await?;
    // Старые входы не копятся.
    sqlx::query(
        "DELETE FROM oauth_flows WHERE id IN \
         (SELECT id FROM oauth_flows WHERE expires_at < now() - interval '1 day' LIMIT 500)",
    )
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO oauth_flows (id, state_hash, provider, intent, account_id, session_id, \
         code_verifier, return_to, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + $9::float8 * interval '1 second')",
    )
    .bind(qubite_auth::new_id())
    .bind(qubite_auth::token_hash(&state))
    .bind(provider.as_str())
    .bind(kind)
    .bind(account)
    .bind(session)
    .bind(&verifier)
    .bind(return_to)
    .bind(ttl.as_secs_f64())
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok((state, verifier))
}

pub(crate) struct Flow {
    pub intent: Intent,
    pub code_verifier: String,
}

#[derive(sqlx::FromRow)]
struct FlowRow {
    provider: String,
    intent: String,
    account_id: Option<Uuid>,
    session_id: Option<Uuid>,
    code_verifier: String,
    return_to: String,
    expired: bool,
}

/// Забрать начатый вход: отмечается использованным атомарно (второй раз —
/// `InvalidState`), проверяются срок и провайдер.
pub(crate) async fn take_flow(pool: &PgPool, provider: Provider, state: &str) -> Result<Flow> {
    let row: Option<FlowRow> = sqlx::query_as(
        "UPDATE oauth_flows SET used_at = now() \
         WHERE state_hash = $1 AND used_at IS NULL \
         RETURNING provider, intent, account_id, session_id, code_verifier, return_to, \
                   expires_at < now() AS expired",
    )
    .bind(qubite_auth::token_hash(state))
    .fetch_optional(pool)
    .await?;
    let row = row.ok_or(Error::InvalidState)?;
    if row.expired || row.provider != provider.as_str() {
        return Err(Error::InvalidState);
    }
    let intent = match (row.intent.as_str(), row.account_id, row.session_id) {
        ("link", Some(account_id), Some(session_id)) => Intent::Link {
            account_id,
            session_id,
        },
        _ => Intent::Login {
            return_to: row.return_to,
        },
    };
    Ok(Flow {
        intent,
        code_verifier: row.code_verifier,
    })
}

/// Данные Telegram можно предъявить только один раз.
pub(crate) async fn mark_seen(pool: &PgPool, digest: &[u8]) -> Result<()> {
    sqlx::query("DELETE FROM oauth_seen WHERE seen_at < now() - interval '1 day'")
        .execute(pool)
        .await?;
    let inserted =
        sqlx::query("INSERT INTO oauth_seen (digest) VALUES ($1) ON CONFLICT DO NOTHING")
            .bind(digest)
            .execute(pool)
            .await?
            .rows_affected();
    if inserted == 0 {
        return Err(Error::Invalid("эти данные входа уже использованы".into()));
    }
    Ok(())
}

/// Войти по привязке. Совпадение почты не помогает — только ID провайдера.
pub async fn login(
    pool: &PgPool,
    config: &AuthConfig,
    provider: Provider,
    identity: &Identity,
    client: &ClientInfo,
) -> Result<IssuedSession> {
    let mut tx = pool.begin().await?;
    let found: Option<(Uuid, String)> = sqlx::query_as(
        "SELECT a.id, a.status FROM oauth_identities i JOIN accounts a ON a.id = i.account_id \
         WHERE i.provider = $1 AND i.subject = $2 FOR UPDATE OF i",
    )
    .bind(provider.as_str())
    .bind(&identity.subject)
    .fetch_optional(&mut *tx)
    .await?;
    let Some((account_id, status)) = found else {
        return Err(Error::NotLinked);
    };
    match status.as_str() {
        "active" => {}
        "blocked" => return Err(qubite_auth::Error::AccountBlocked.into()),
        _ => return Err(qubite_auth::Error::EmailNotVerified.into()),
    }
    sqlx::query(
        "UPDATE oauth_identities SET last_login_at = now() WHERE provider = $1 AND subject = $2",
    )
    .bind(provider.as_str())
    .bind(&identity.subject)
    .execute(&mut *tx)
    .await?;
    let session = sessions::create(&mut tx, account_id, client, config.session_ttl).await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(account_id),
            action: "auth.login".into(),
            target_kind: "session".into(),
            target_id: Some(session.id.to_string()),
            after: Some(serde_json::json!({
                "method": provider.as_str(),
                "ip": client.ip,
                "user_agent": client.user_agent,
            })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(session)
}

/// Привязать провайдера к аккаунту. Сессия, из которой начали привязку,
/// должна быть жива (её могли закрыть, пока человек был у провайдера).
pub async fn link(
    pool: &PgPool,
    account_id: Uuid,
    session_id: Option<Uuid>,
    provider: Provider,
    identity: &Identity,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    if let Some(session_id) = session_id {
        let alive: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM sessions s JOIN accounts a ON a.id = s.account_id \
             WHERE s.id = $1 AND s.account_id = $2 AND s.revoked_at IS NULL \
               AND s.expires_at > now() AND a.status = 'active')",
        )
        .bind(session_id)
        .bind(account_id)
        .fetch_one(&mut *tx)
        .await?;
        if !alive {
            return Err(Error::InvalidState);
        }
    }
    let owner: Option<Uuid> = sqlx::query_scalar(
        "SELECT account_id FROM oauth_identities WHERE provider = $1 AND subject = $2",
    )
    .bind(provider.as_str())
    .bind(&identity.subject)
    .fetch_optional(&mut *tx)
    .await?;
    match owner {
        Some(owner) if owner == account_id => return Ok(()),
        Some(_) => return Err(Error::Taken),
        None => {}
    }
    let inserted = sqlx::query(
        "INSERT INTO oauth_identities (provider, subject, account_id, email, display_name) \
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
    )
    .bind(provider.as_str())
    .bind(&identity.subject)
    .bind(account_id)
    .bind(identity.email.as_deref().filter(|email| email.len() <= 320))
    .bind(identity.display_name.chars().take(200).collect::<String>())
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if inserted == 0 {
        // Либо у аккаунта уже другой ID этого провайдера, либо гонка за этот ID.
        let mine: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM oauth_identities WHERE account_id = $1 AND provider = $2)",
        )
        .bind(account_id)
        .bind(provider.as_str())
        .fetch_one(&mut *tx)
        .await?;
        return Err(if mine {
            Error::AlreadyLinked
        } else {
            Error::Taken
        });
    }
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(account_id),
            action: "auth.oauth_linked".into(),
            target_kind: "account".into(),
            target_id: Some(account_id.to_string()),
            after: Some(serde_json::json!({ "provider": provider.as_str() })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Отвязать провайдера. `false` — привязки не было.
pub async fn unlink(pool: &PgPool, account_id: Uuid, provider: Provider) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let removed =
        sqlx::query("DELETE FROM oauth_identities WHERE account_id = $1 AND provider = $2")
            .bind(account_id)
            .bind(provider.as_str())
            .execute(&mut *tx)
            .await?
            .rows_affected();
    if removed > 0 {
        audit::record(
            &mut tx,
            NewAuditEntry {
                actor_id: Some(account_id),
                action: "auth.oauth_unlinked".into(),
                target_kind: "account".into(),
                target_id: Some(account_id.to_string()),
                before: Some(serde_json::json!({ "provider": provider.as_str() })),
                ..NewAuditEntry::default()
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(removed > 0)
}

/// Привязка в профиле.
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
pub struct LinkedIdentity {
    pub provider: String,
    pub display_name: String,
    pub email: Option<String>,
    pub linked_at: OffsetDateTime,
    pub last_login_at: Option<OffsetDateTime>,
}

pub async fn identities(pool: &PgPool, account_id: Uuid) -> Result<Vec<LinkedIdentity>> {
    Ok(sqlx::query_as(
        "SELECT provider, display_name, email, linked_at, last_login_at \
         FROM oauth_identities WHERE account_id = $1 ORDER BY linked_at",
    )
    .bind(account_id)
    .fetch_all(pool)
    .await?)
}

/// Куда вернуть после входа (сохранено при старте).
pub fn return_to(intent: &Intent) -> &str {
    match intent {
        Intent::Login { return_to } => return_to,
        Intent::Link { .. } => "/settings",
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn return_path_stays_on_our_site() {
        assert_eq!(super::safe_return("/today"), "/today");
        for evil in [
            "https://evil.ru",
            "//evil.ru",
            "/\\evil.ru",
            "javascript:1",
            "",
        ] {
            assert_eq!(super::safe_return(evil), "/", "{evil}");
        }
    }
}
