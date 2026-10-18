//! Настройки платформы — тумблеры owner (таблица `platform_settings`).
//!
//! Одна строка на настройку; нет строки — действует значение по умолчанию.
//! У каждой настройки своя версия: она растёт при каждом изменении.
//! AUTH-003: режим регистрации и CAPTCHA.

use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{Error, Result};
use qubite_objects::{NewAuditEntry, audit};

/// Кто может зарегистрироваться (D-056).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegistrationMode {
    /// Никто.
    Closed,
    /// Только по приглашению (по умолчанию).
    InviteOnly,
    /// Любой, с CAPTCHA.
    Open,
}

/// Какая CAPTCHA на открытой регистрации (D-187).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CaptchaChoice {
    Turnstile,
    Smartcaptcha,
    Off,
}

/// Все тумблеры платформы, как они записаны в базе (без env-переключателей).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlatformSettings {
    pub registration_mode: RegistrationMode,
    pub captcha: CaptchaChoice,
}

impl Default for PlatformSettings {
    fn default() -> Self {
        Self {
            registration_mode: RegistrationMode::InviteOnly,
            captcha: CaptchaChoice::Turnstile,
        }
    }
}

pub const REGISTRATION_MODE: &str = "registration.mode";
pub const CAPTCHA_PROVIDER: &str = "captcha.provider";

fn parse<T: for<'de> Deserialize<'de>>(key: &str, value: serde_json::Value, fallback: T) -> T {
    serde_json::from_value(value).unwrap_or_else(|error| {
        tracing::warn!(key, %error, "неверное значение настройки платформы — беру по умолчанию");
        fallback
    })
}

/// Прочитать тумблеры. Неизвестные ключи пропускаются, неверные значения —
/// значение по умолчанию.
pub async fn load(conn: &mut PgConnection) -> Result<PlatformSettings> {
    let rows: Vec<(String, serde_json::Value)> =
        sqlx::query_as("SELECT key, value FROM platform_settings")
            .fetch_all(conn)
            .await?;
    let mut settings = PlatformSettings::default();
    for (key, value) in rows {
        match key.as_str() {
            REGISTRATION_MODE => {
                settings.registration_mode = parse(&key, value, settings.registration_mode);
            }
            CAPTCHA_PROVIDER => settings.captcha = parse(&key, value, settings.captcha),
            _ => {}
        }
    }
    Ok(settings)
}

/// То же, взяв соединение из пула.
pub async fn current(pool: &PgPool) -> Result<PlatformSettings> {
    let mut conn = pool.acquire().await?;
    load(&mut conn).await
}

/// Изменить одну настройку (с аудитом). Возвращает новую версию.
pub async fn set(
    pool: &PgPool,
    actor: Option<Uuid>,
    key: &str,
    value: serde_json::Value,
) -> Result<i64> {
    let valid = match key {
        REGISTRATION_MODE => serde_json::from_value::<RegistrationMode>(value.clone()).is_ok(),
        CAPTCHA_PROVIDER => serde_json::from_value::<CaptchaChoice>(value.clone()).is_ok(),
        _ => false,
    };
    if !valid {
        return Err(Error::Invalid(format!("неверная настройка {key}: {value}")));
    }
    let mut tx = pool.begin().await?;
    let before: Option<serde_json::Value> =
        sqlx::query_scalar("SELECT value FROM platform_settings WHERE key = $1 FOR UPDATE")
            .bind(key)
            .fetch_optional(&mut *tx)
            .await?;
    let version: i64 = sqlx::query_scalar(
        "INSERT INTO platform_settings (key, value, updated_by) VALUES ($1, $2, $3) \
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, version = platform_settings.version + 1, \
         updated_by = EXCLUDED.updated_by, updated_at = now() RETURNING version",
    )
    .bind(key)
    .bind(&value)
    .bind(actor)
    .fetch_one(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: actor,
            action: "platform.setting_changed".into(),
            target_kind: "platform_setting".into(),
            target_id: Some(key.into()),
            before,
            after: Some(value),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(version)
}
