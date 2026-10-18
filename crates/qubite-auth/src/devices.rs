//! Вход приложений (AUTH-006): OAuth 2.0 для нативных приложений (RFC 8252)
//! с PKCE (RFC 7636).
//!
//! Как это выглядит:
//! 1. Приложение придумывает секрет `code_verifier`, считает от него
//!    `code_challenge = BASE64URL(SHA256(verifier))` и открывает системный
//!    браузер со страницей входа Qubite.
//! 2. Человек входит (или уже вошёл) и нажимает «Разрешить». Сервер выдаёт
//!    одноразовый код на 5 минут и отправляет браузер на `qubite://auth/callback`.
//! 3. Приложение меняет код + `code_verifier` на токены устройства.
//!    Перехваченный код без `code_verifier` бесполезен.
//! 4. Access-токен живёт 15 минут, refresh — пока жива сессия устройства
//!    (30 дней с продлением, D-170). Refresh одноразовый: при обновлении
//!    выдаётся новый; повтор старого закрывает всю сессию устройства.
//!
//! Отзыв устройства в списке сессий действует сразу: каждый запрос сверяется с базой.

use std::time::Duration;

use base64::Engine;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    AuthConfig, ClientInfo, Error, ResolvedSession, Result, RevokeReason, new_id, random_token,
    secs, sessions, token_hash,
};
use qubite_objects::{NewAuditEntry, audit};

/// Срок access-токена.
pub const ACCESS_TTL: Duration = Duration::from_secs(15 * 60);
/// Срок одноразового кода.
pub const CODE_TTL: Duration = Duration::from_secs(5 * 60);

/// Приложение Qubite, которому можно входить.
#[derive(Debug, Clone, Copy)]
pub struct Client {
    pub id: &'static str,
    pub name: &'static str,
    /// Адрес возврата (deep link).
    pub redirect_uri: &'static str,
    /// Разрешён ли возврат на локальный адрес `http://127.0.0.1:<порт>/callback`
    /// (RFC 8252 §7.3) — удобно для desktop.
    pub loopback: bool,
}

/// Список приложений. Новые добавляются здесь (кодом, не через API).
pub const CLIENTS: &[Client] = &[
    Client {
        id: "qubite-desktop",
        name: "Qubite для компьютера",
        redirect_uri: "qubite://auth/callback",
        loopback: true,
    },
    Client {
        id: "qubite-android",
        name: "Qubite для Android",
        redirect_uri: "qubite://auth/callback",
        loopback: false,
    },
];

pub fn client(id: &str) -> Option<&'static Client> {
    CLIENTS.iter().find(|client| client.id == id)
}

fn redirect_allowed(client: &Client, uri: &str) -> bool {
    if uri == client.redirect_uri {
        return true;
    }
    if !client.loopback {
        return false;
    }
    ["http://127.0.0.1:", "http://[::1]:"].iter().any(|prefix| {
        uri.strip_prefix(prefix)
            .and_then(|rest| rest.strip_suffix("/callback"))
            .is_some_and(|port| port.parse::<u16>().is_ok_and(|port| port > 0))
    })
}

fn unreserved(value: &str) -> bool {
    value
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '.' | '_' | '~'))
}

/// `BASE64URL(SHA256(verifier))`.
pub fn challenge_for(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

/// Запрос приложения на вход.
#[derive(Debug, Clone)]
pub struct AuthorizeInput {
    pub client_id: String,
    pub redirect_uri: String,
    pub code_challenge: String,
    pub code_challenge_method: String,
    pub device_name: String,
}

/// Человек в своей web-сессии разрешил приложению вход. Возвращает
/// одноразовый код. Токен приложения не может разрешить вход другому приложению.
pub async fn authorize(
    pool: &PgPool,
    web: &ResolvedSession,
    input: AuthorizeInput,
) -> Result<String> {
    if web.kind != "web" {
        return Err(Error::Invalid(
            "разрешить вход приложению можно только из браузера".into(),
        ));
    }
    let client = client(&input.client_id).ok_or(Error::InvalidClient)?;
    if !redirect_allowed(client, &input.redirect_uri) {
        return Err(Error::InvalidClient);
    }
    if input.code_challenge_method != "S256" {
        return Err(Error::Invalid(
            "поддерживается только code_challenge_method=S256".into(),
        ));
    }
    if input.code_challenge.len() != 43 || !unreserved(&input.code_challenge) {
        return Err(Error::Invalid("неверный code_challenge".into()));
    }
    let device_name = input.device_name.trim();
    if device_name.chars().count() > 100 {
        return Err(Error::Invalid("имя устройства длиннее 100 символов".into()));
    }

    let code = random_token();
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO device_auth_codes (id, code_hash, account_id, web_session_id, client_id, \
         redirect_uri, code_challenge, device_name, expires_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now() + $9::float8 * interval '1 second')",
    )
    .bind(new_id())
    .bind(token_hash(&code))
    .bind(web.account_id)
    .bind(web.id)
    .bind(client.id)
    .bind(&input.redirect_uri)
    .bind(&input.code_challenge)
    .bind(device_name)
    .bind(secs(CODE_TTL))
    .execute(&mut *tx)
    .await?;
    // Заодно убираем старые коды.
    sqlx::query("DELETE FROM device_auth_codes WHERE expires_at < now() - interval '1 day' AND issued_session_id IS NULL")
        .execute(&mut *tx)
        .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(web.account_id),
            action: "auth.device_authorized".into(),
            target_kind: "session".into(),
            target_id: Some(web.id.to_string()),
            after: Some(serde_json::json!({ "client_id": client.id, "device_name": device_name })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(code)
}

/// Токены устройства. Показываются один раз — в базе только хеши.
#[derive(Debug, Clone)]
pub struct DeviceTokens {
    pub session_id: Uuid,
    pub account_id: Uuid,
    pub access_token: String,
    pub refresh_token: String,
    pub access_expires_in: Duration,
}

#[derive(sqlx::FromRow)]
struct CodeRow {
    id: Uuid,
    account_id: Uuid,
    client_id: String,
    redirect_uri: String,
    code_challenge: String,
    device_name: String,
    expired: bool,
    used: bool,
    issued_session_id: Option<Uuid>,
    account_active: bool,
    /// Web-сессия, в которой разрешили вход, ещё открыта.
    web_alive: bool,
}

/// Обменять код на токены. Любая ошибка «сжигает» код.
pub async fn exchange_code(
    pool: &PgPool,
    config: &AuthConfig,
    client_id: &str,
    redirect_uri: &str,
    code: &str,
    code_verifier: &str,
    client_info: &ClientInfo,
) -> Result<DeviceTokens> {
    let client = client(client_id).ok_or(Error::InvalidClient)?;
    let mut tx = pool.begin().await?;
    let row: Option<CodeRow> = sqlx::query_as(
        "SELECT c.id, c.account_id, c.client_id, c.redirect_uri, c.code_challenge, c.device_name, \
                c.expires_at <= now() AS expired, c.used_at IS NOT NULL AS used, c.issued_session_id, \
                (a.status = 'active') AS account_active, \
                (w.revoked_at IS NULL AND w.expires_at > now()) AS web_alive \
         FROM device_auth_codes c JOIN accounts a ON a.id = c.account_id \
         JOIN sessions w ON w.id = c.web_session_id \
         WHERE c.code_hash = $1 FOR UPDATE OF c",
    )
    .bind(token_hash(code))
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        return Err(Error::InvalidGrant);
    };
    if row.used {
        // Код предъявлен второй раз — выданную по нему сессию закрываем.
        if let Some(session) = row.issued_session_id {
            sessions::revoke_all_ids(&mut tx, &[session], RevokeReason::RefreshReuse).await?;
        }
        tx.commit().await?;
        return Err(Error::InvalidGrant);
    }
    sqlx::query("UPDATE device_auth_codes SET used_at = now() WHERE id = $1")
        .bind(row.id)
        .execute(&mut *tx)
        .await?;
    let verifier_ok = (43..=128).contains(&code_verifier.len())
        && unreserved(code_verifier)
        && challenge_for(code_verifier) == row.code_challenge;
    if row.expired
        || row.client_id != client.id
        || row.redirect_uri != redirect_uri
        || !verifier_ok
        || !row.account_active
        // Вход в браузере закрыли (выход, «выйти везде», смена пароля) —
        // выданный из него код больше не действует.
        || !row.web_alive
    {
        tx.commit().await?;
        return Err(Error::InvalidGrant);
    }

    let tokens = issue(
        &mut tx,
        config,
        row.account_id,
        client.id,
        &row.device_name,
        client_info,
    )
    .await?;
    sqlx::query("UPDATE device_auth_codes SET issued_session_id = $2 WHERE id = $1")
        .bind(row.id)
        .bind(tokens.session_id)
        .execute(&mut *tx)
        .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(row.account_id),
            action: "auth.device_login".into(),
            target_kind: "session".into(),
            target_id: Some(tokens.session_id.to_string()),
            after: Some(serde_json::json!({
                "client_id": client.id,
                "device_name": row.device_name,
                "ip": client_info.ip,
            })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(tokens)
}

async fn issue(
    conn: &mut sqlx::PgConnection,
    config: &AuthConfig,
    account_id: Uuid,
    client_id: &str,
    device_name: &str,
    client_info: &ClientInfo,
) -> Result<DeviceTokens> {
    let session_id = new_id();
    let access_token = random_token();
    let refresh_token = random_token();
    sqlx::query(
        "INSERT INTO sessions (id, account_id, token_hash, csrf_hash, kind, user_agent, ip, device_name, \
         client_id, access_expires_at, expires_at) \
         VALUES ($1, $2, $3, $4, 'device', $5, $6, $7, $8, \
                 now() + $9::float8 * interval '1 second', now() + $10::float8 * interval '1 second')",
    )
    .bind(session_id)
    .bind(account_id)
    .bind(token_hash(&access_token))
    // CSRF устройствам не нужен (нет cookie), но поле обязательное — случайное значение.
    .bind(token_hash(&random_token()))
    .bind(sessions::truncate(&client_info.user_agent, 500))
    .bind(sessions::truncate(&client_info.ip, 64))
    .bind(device_name)
    .bind(client_id)
    .bind(secs(ACCESS_TTL))
    .bind(secs(config.session_ttl))
    .execute(&mut *conn)
    .await?;
    sqlx::query("INSERT INTO device_refresh_tokens (token_hash, session_id) VALUES ($1, $2)")
        .bind(token_hash(&refresh_token))
        .bind(session_id)
        .execute(&mut *conn)
        .await?;
    Ok(DeviceTokens {
        session_id,
        account_id,
        access_token,
        refresh_token,
        access_expires_in: ACCESS_TTL,
    })
}

#[derive(sqlx::FromRow)]
struct RefreshRow {
    session_id: Uuid,
    account_id: Uuid,
    used: bool,
    client_id: Option<String>,
    alive: bool,
}

/// Обновить токены по refresh-токену (ротация). Повтор использованного
/// refresh-токена закрывает сессию устройства целиком.
pub async fn refresh(
    pool: &PgPool,
    config: &AuthConfig,
    client_id: &str,
    refresh_token: &str,
) -> Result<DeviceTokens> {
    let client = client(client_id).ok_or(Error::InvalidClient)?;
    let mut tx = pool.begin().await?;
    let row: Option<RefreshRow> = sqlx::query_as(
        "SELECT r.session_id, s.account_id, r.used_at IS NOT NULL AS used, s.client_id, \
                (s.revoked_at IS NULL AND s.expires_at > now() AND a.status = 'active') AS alive \
         FROM device_refresh_tokens r \
         JOIN sessions s ON s.id = r.session_id \
         JOIN accounts a ON a.id = s.account_id \
         WHERE r.token_hash = $1 FOR UPDATE OF r, s",
    )
    .bind(token_hash(refresh_token))
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        return Err(Error::InvalidGrant);
    };
    if row.client_id.as_deref() != Some(client.id) {
        return Err(Error::InvalidGrant);
    }
    if row.used {
        let revoked =
            sessions::revoke_all_ids(&mut tx, &[row.session_id], RevokeReason::RefreshReuse)
                .await?;
        if revoked > 0 {
            audit::record(
                &mut tx,
                NewAuditEntry {
                    actor_id: Some(row.account_id),
                    action: "auth.refresh_reuse".into(),
                    target_kind: "session".into(),
                    target_id: Some(row.session_id.to_string()),
                    reason: Some("повтор использованного refresh-токена".into()),
                    ..NewAuditEntry::default()
                },
            )
            .await?;
        }
        tx.commit().await?;
        tracing::warn!(session = %row.session_id, "повтор refresh-токена: сессия устройства закрыта");
        return Err(Error::InvalidGrant);
    }
    if !row.alive {
        return Err(Error::InvalidGrant);
    }

    sqlx::query("UPDATE device_refresh_tokens SET used_at = now() WHERE token_hash = $1")
        .bind(token_hash(refresh_token))
        .execute(&mut *tx)
        .await?;
    let access_token = random_token();
    let new_refresh = random_token();
    sqlx::query(
        "UPDATE sessions SET token_hash = $2, access_expires_at = now() + $3::float8 * interval '1 second', \
                expires_at = now() + $4::float8 * interval '1 second', last_seen_at = now() \
         WHERE id = $1",
    )
    .bind(row.session_id)
    .bind(token_hash(&access_token))
    .bind(secs(ACCESS_TTL))
    .bind(secs(config.session_ttl))
    .execute(&mut *tx)
    .await?;
    sqlx::query("INSERT INTO device_refresh_tokens (token_hash, session_id) VALUES ($1, $2)")
        .bind(token_hash(&new_refresh))
        .bind(row.session_id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(DeviceTokens {
        session_id: row.session_id,
        account_id: row.account_id,
        access_token,
        refresh_token: new_refresh,
        access_expires_in: ACCESS_TTL,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_challenge_matches_rfc_7636_example() {
        // Пример из RFC 7636, приложение B.
        assert_eq!(
            challenge_for("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    #[test]
    fn only_known_redirects() {
        let desktop = client("qubite-desktop").unwrap();
        let android = client("qubite-android").unwrap();
        assert!(redirect_allowed(desktop, "qubite://auth/callback"));
        assert!(redirect_allowed(desktop, "http://127.0.0.1:53682/callback"));
        assert!(redirect_allowed(desktop, "http://[::1]:8000/callback"));
        assert!(!redirect_allowed(desktop, "http://127.0.0.1:0/callback"));
        assert!(!redirect_allowed(desktop, "http://evil.example/callback"));
        assert!(!redirect_allowed(
            desktop,
            "http://127.0.0.1:80/callback/../x"
        ));
        assert!(!redirect_allowed(
            android,
            "http://127.0.0.1:53682/callback"
        ));
        assert!(client("evil-app").is_none());
    }
}
