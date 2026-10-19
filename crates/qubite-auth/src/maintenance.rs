//! Техработы (ACC-005, D-216…D-218).
//!
//! - [`switch`] включает и выключает техработы — из команды `qubite
//!   maintenance`, Telegram-бота (`/tech`) и API Owner Console. Время «вернёмся
//!   к …» необязательно: экран его показывает, только если owner его задал.
//!   Сами по себе техработы по этому времени не заканчиваются.
//! - Пропуск owner — одноразовая подписанная ссылка на 10 минут. По ней owner
//!   входит в новом браузере, даже когда идут техработы, а будущий запасной
//!   сервер (OPS-001) может проверить подпись без базы и пропустить owner на
//!   основной. Пропуск: ID owner, срок, случайное число и HMAC-SHA256 ключом,
//!   который сервер создаёт сам и хранит в `platform_secrets`.

use std::time::Duration;

use base64::Engine;
use hmac::{Hmac, KeyInit, Mac};
use serde_json::{Value, json};
use sha2::Sha256;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    AuthConfig, Error, IssuedSession, Result, owner,
    platform::{self, ANY_VERSION, Change, PlatformSettings},
    sessions::{self, ClientInfo},
};
use qubite_objects::{NewAuditEntry, audit};

/// Сколько живёт пропуск.
pub const PASS_TTL: Duration = Duration::from_secs(10 * 60);
const PASS_KEY: &str = "maintenance_pass";
const PAYLOAD_LEN: usize = 16 + 8 + 16;
const SIG_LEN: usize = 32;

/// Включить или выключить техработы.
#[derive(Debug, Clone, Default)]
pub struct Switch<'a> {
    pub on: bool,
    /// «10:00» (ближайшее такое время в поясе платформы) или RFC 3339.
    pub until: Option<&'a str>,
    /// Новый текст экрана; `None` — оставить прежний.
    pub message: Option<&'a str>,
}

/// «10:00» или «9:30» → часы и минуты.
fn clock(raw: &str) -> Option<(u8, u8)> {
    let (hours, minutes) = raw.trim().split_once(':')?;
    let hours: u8 = hours.parse().ok()?;
    let minutes: u8 = minutes.parse().ok()?;
    (hours < 24 && minutes < 60 && minutes_digits(raw)).then_some((hours, minutes))
}

fn minutes_digits(raw: &str) -> bool {
    raw.trim().rsplit(':').next().is_some_and(|m| m.len() == 2)
}

/// Время «вернёмся к …» в виде строки RFC 3339 (UTC).
async fn resolve_until(pool: &PgPool, raw: &str, timezone: &str) -> Result<Value> {
    let raw = raw.trim();
    if let Some((hours, minutes)) = clock(raw) {
        // Ближайшие «10:00» по часам платформы: сегодня или уже завтра.
        let at: String = sqlx::query_scalar(
            "SELECT to_char(CASE WHEN t > now() THEN t ELSE t + interval '1 day' END \
                            AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"') \
             FROM (SELECT (((now() AT TIME ZONE $1)::date + make_time($2, $3, 0)) \
                           AT TIME ZONE $1) AS t) x",
        )
        .bind(timezone)
        .bind(i32::from(hours))
        .bind(i32::from(minutes))
        .fetch_one(pool)
        .await?;
        return Ok(json!(at));
    }
    let valid: bool = sqlx::query_scalar("SELECT pg_input_is_valid($1, 'timestamptz')")
        .bind(raw)
        .fetch_one(pool)
        .await?;
    if valid && raw.len() <= 64 {
        Ok(json!(raw))
    } else {
        Err(Error::Invalid(format!(
            "не понял время «{raw}»: напишите, например, 10:00"
        )))
    }
}

/// Включить или выключить техработы. Возвращает тумблеры после изменения.
pub async fn switch(
    pool: &PgPool,
    actor: Option<Uuid>,
    request: Switch<'_>,
) -> Result<PlatformSettings> {
    let current = platform::current(pool).await?;
    let mut changes = vec![Change {
        key: platform::MAINTENANCE_ENABLED.into(),
        value: json!(request.on),
        version: ANY_VERSION,
    }];
    let until = match (request.on, request.until) {
        (true, Some(raw)) if !raw.trim().is_empty() => {
            resolve_until(pool, raw, &current.timezone).await?
        }
        _ => Value::Null,
    };
    changes.push(Change {
        key: platform::MAINTENANCE_UNTIL.into(),
        value: until,
        version: ANY_VERSION,
    });
    if let Some(message) = request.message.map(str::trim).filter(|m| !m.is_empty()) {
        changes.push(Change {
            key: platform::MAINTENANCE_MESSAGE.into(),
            value: json!(message),
            version: ANY_VERSION,
        });
    }
    platform::set_many(pool, actor, &changes).await?;
    platform::current(pool).await
}

/// «10:00, 19.10» в поясе платформы — для ответов бота и команды.
pub async fn local_time(pool: &PgPool, at: &str, timezone: &str) -> Result<String> {
    Ok(
        sqlx::query_scalar("SELECT to_char($1::timestamptz AT TIME ZONE $2, 'HH24:MI, DD.MM')")
            .bind(at)
            .bind(timezone)
            .fetch_one(pool)
            .await?,
    )
}

// ---------------------------------------------------------------- пропуск owner

/// Что внутри пропуска.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PassClaims {
    pub owner_id: Uuid,
    pub expires_at: i64,
    pub nonce: [u8; 16],
}

type HmacSha256 = Hmac<Sha256>;

/// Ключ подписи пропусков; создаётся при первом обращении.
pub async fn pass_key(pool: &PgPool) -> Result<Vec<u8>> {
    let mut fresh = [0u8; 32];
    getrandom::fill(&mut fresh).expect("генератор случайных чисел ОС доступен");
    sqlx::query(
        "INSERT INTO platform_secrets (name, value) VALUES ($1, $2) ON CONFLICT (name) DO NOTHING",
    )
    .bind(PASS_KEY)
    .bind(fresh.as_slice())
    .execute(pool)
    .await?;
    Ok(
        sqlx::query_scalar("SELECT value FROM platform_secrets WHERE name = $1")
            .bind(PASS_KEY)
            .fetch_one(pool)
            .await?,
    )
}

fn sign(key: &[u8], payload: &[u8]) -> HmacSha256 {
    let mut mac = HmacSha256::new_from_slice(key).expect("HMAC принимает ключ любой длины");
    mac.update(b"qubite.maintenance-pass.v1:");
    mac.update(payload);
    mac
}

/// Подписать пропуск (без базы — для тестов и запасного сервера).
pub fn encode_pass(key: &[u8], claims: &PassClaims) -> String {
    let mut payload = Vec::with_capacity(PAYLOAD_LEN + SIG_LEN);
    payload.extend_from_slice(claims.owner_id.as_bytes());
    payload.extend_from_slice(&claims.expires_at.to_be_bytes());
    payload.extend_from_slice(&claims.nonce);
    let signature = sign(key, &payload).finalize().into_bytes();
    payload.extend_from_slice(&signature);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(payload)
}

/// Проверить подпись и срок пропуска. Одноразовость здесь не проверяется —
/// её помнит база основного сервера ([`login_with_pass`]).
pub fn verify_pass(key: &[u8], token: &str, now_unix: i64) -> Option<PassClaims> {
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(token.trim())
        .ok()?;
    if bytes.len() != PAYLOAD_LEN + SIG_LEN {
        return None;
    }
    let (payload, signature) = bytes.split_at(PAYLOAD_LEN);
    // Сравнение подписи — за постоянное время.
    sign(key, payload).verify_slice(signature).ok()?;
    let owner_id = Uuid::from_slice(&payload[..16]).ok()?;
    let expires_at = i64::from_be_bytes(payload[16..24].try_into().ok()?);
    let nonce: [u8; 16] = payload[24..].try_into().ok()?;
    (expires_at > now_unix).then_some(PassClaims {
        owner_id,
        expires_at,
        nonce,
    })
}

/// Адрес страницы пропуска (там кнопка «Войти»).
pub fn pass_link(auth_url: &str, token: &str) -> String {
    format!(
        "{}/api/maintenance/pass?token={token}",
        auth_url.trim_end_matches('/')
    )
}

/// Выдать пропуск owner (только ему самому). Возвращает токен и срок.
pub async fn issue_pass(pool: &PgPool, owner_id: Uuid) -> Result<(String, OffsetDateTime)> {
    let current = owner::current(pool).await?.ok_or(Error::NoOwner)?;
    if current.id != owner_id {
        return Err(Error::NotFound);
    }
    let key = pass_key(pool).await?;
    let expires_at = OffsetDateTime::now_utc()
        + time::Duration::try_from(PASS_TTL).expect("10 минут помещаются в time::Duration");
    let mut nonce = [0u8; 16];
    getrandom::fill(&mut nonce).expect("генератор случайных чисел ОС доступен");
    let token = encode_pass(
        &key,
        &PassClaims {
            owner_id,
            expires_at: expires_at.unix_timestamp(),
            nonce,
        },
    );
    Ok((token, expires_at))
}

/// Войти по пропуску: подпись, срок, «это owner» и «ещё не использован» —
/// иначе [`Error::InvalidGrant`]. Открывает обычную web-сессию owner.
pub async fn login_with_pass(
    pool: &PgPool,
    config: &AuthConfig,
    token: &str,
    client: &ClientInfo,
) -> Result<IssuedSession> {
    let key = pass_key(pool).await?;
    let claims = verify_pass(&key, token, OffsetDateTime::now_utc().unix_timestamp())
        .ok_or(Error::InvalidGrant)?;
    let mut tx = pool.begin().await?;
    if !owner::is_owner(&mut tx, claims.owner_id).await? {
        return Err(Error::InvalidGrant);
    }
    let active: bool = sqlx::query_scalar("SELECT status = 'active' FROM accounts WHERE id = $1")
        .bind(claims.owner_id)
        .fetch_one(&mut *tx)
        .await?;
    if !active {
        return Err(Error::AccountBlocked);
    }
    // Использованные пропуска старше суток уже просрочены — их можно забыть.
    sqlx::query("DELETE FROM maintenance_passes_used WHERE used_at < now() - interval '1 day'")
        .execute(&mut *tx)
        .await?;
    let first_use = sqlx::query(
        "INSERT INTO maintenance_passes_used (nonce) VALUES ($1) ON CONFLICT DO NOTHING",
    )
    .bind(claims.nonce.as_slice())
    .execute(&mut *tx)
    .await?
    .rows_affected()
        == 1;
    if !first_use {
        return Err(Error::InvalidGrant);
    }
    let session = sessions::create(&mut tx, claims.owner_id, client, config.session_ttl).await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(claims.owner_id),
            action: "auth.login".into(),
            target_kind: "session".into(),
            target_id: Some(session.id.to_string()),
            after: Some(json!({
                "method": "maintenance_pass",
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

#[cfg(test)]
mod tests {
    use super::*;

    fn claims(expires_at: i64) -> PassClaims {
        PassClaims {
            owner_id: Uuid::now_v7(),
            expires_at,
            nonce: [7; 16],
        }
    }

    #[test]
    fn pass_signature_and_expiry() {
        let key = [1u8; 32];
        let good = claims(2_000);
        let token = encode_pass(&key, &good);
        assert_eq!(verify_pass(&key, &token, 1_999), Some(good.clone()));
        // Истёк.
        assert_eq!(verify_pass(&key, &token, 2_000), None);
        // Чужой ключ.
        assert_eq!(verify_pass(&[2u8; 32], &token, 1_000), None);
        // Подменили срок в токене — подпись не сходится.
        let mut bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(&token)
            .unwrap();
        bytes[16 + 7] ^= 1;
        let forged = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes);
        assert_eq!(verify_pass(&key, &forged, 1_000), None);
        assert_eq!(verify_pass(&key, "мусор", 1_000), None);
    }

    #[test]
    fn clock_times() {
        assert_eq!(clock("10:00"), Some((10, 0)));
        assert_eq!(clock(" 9:30 "), Some((9, 30)));
        assert_eq!(clock("24:00"), None);
        assert_eq!(clock("10:7"), None);
        assert_eq!(clock("завтра"), None);
    }
}
