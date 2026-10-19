//! Тумблеры платформы (ACC-002, D-059, D-188).
//!
//! Owner переключает их в Owner Console; хранятся в `platform_settings` —
//! одна строка на настройку, нет строки — значение по умолчанию. У каждой
//! настройки своя версия: сохранение с устаревшей версией отклоняется
//! (две вкладки не затрут друг друга).
//!
//! Аварийные переменные окружения ([`Overrides`]) **сильнее** тумблеров: ими
//! можно только выключить (вход, регистрацию, способ входа, почту) или включить
//! техработы и выключить CAPTCHA. Owner не запирает сам себя: он всегда может
//! войти по паролю и работать во время техработ.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
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

/// Способ входа.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LoginMethod {
    Password,
    Google,
    Yandex,
    Vk,
    Telegram,
}

impl LoginMethod {
    pub const ALL: [Self; 5] = [
        Self::Password,
        Self::Google,
        Self::Yandex,
        Self::Vk,
        Self::Telegram,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Password => "password",
            Self::Google => "google",
            Self::Yandex => "yandex",
            Self::Vk => "vk",
            Self::Telegram => "telegram",
        }
    }

    /// Ключ тумблера: `login.methods.<способ>`.
    pub fn key(self) -> &'static str {
        match self {
            Self::Password => "login.methods.password",
            Self::Google => "login.methods.google",
            Self::Yandex => "login.methods.yandex",
            Self::Vk => "login.methods.vk",
            Self::Telegram => "login.methods.telegram",
        }
    }

    /// По умолчанию включены пароль, Яндекс и VK; Google и Telegram — выключены.
    fn default_enabled(self) -> bool {
        matches!(self, Self::Password | Self::Yandex | Self::Vk)
    }

    pub fn parse(value: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|method| method.as_str() == value)
    }
}

pub const REGISTRATION_MODE: &str = "registration.mode";
pub const CAPTCHA_PROVIDER: &str = "captcha.provider";
pub const LOGIN_ENABLED: &str = "login.enabled";
pub const MAINTENANCE_ENABLED: &str = "maintenance.enabled";
pub const MAINTENANCE_MESSAGE: &str = "maintenance.message";
/// До какого времени техработы (RFC 3339) — только для экрана «вернёмся к…».
/// `null` — время не задано, экран его не показывает (D-216).
pub const MAINTENANCE_UNTIL: &str = "maintenance.until";
pub const EMAIL_ENABLED: &str = "email.enabled";
pub const TIMEZONE: &str = "platform.timezone";

pub const DEFAULT_MAINTENANCE_MESSAGE: &str = "Qubite ненадолго закрылся на обновление: подкручиваем винтики и добавляем новое. Все ваши заметки и дела на месте — скоро вернёмся!";
pub const DEFAULT_TIMEZONE: &str = "Asia/Yekaterinburg";

/// Все ключи тумблеров по порядку (так их показывает Owner Console).
pub fn keys() -> Vec<&'static str> {
    let mut keys = vec![
        REGISTRATION_MODE,
        LOGIN_ENABLED,
        MAINTENANCE_ENABLED,
        MAINTENANCE_MESSAGE,
        MAINTENANCE_UNTIL,
    ];
    keys.extend(LoginMethod::ALL.map(LoginMethod::key));
    keys.extend([EMAIL_ENABLED, CAPTCHA_PROVIDER, TIMEZONE]);
    keys
}

/// Значение по умолчанию; `None` — такого ключа нет.
pub fn default_value(key: &str) -> Option<Value> {
    Some(match key {
        REGISTRATION_MODE => json!("invite_only"),
        CAPTCHA_PROVIDER => json!("turnstile"),
        LOGIN_ENABLED | EMAIL_ENABLED => json!(true),
        MAINTENANCE_ENABLED => json!(false),
        MAINTENANCE_MESSAGE => json!(DEFAULT_MAINTENANCE_MESSAGE),
        MAINTENANCE_UNTIL => Value::Null,
        TIMEZONE => json!(DEFAULT_TIMEZONE),
        other => {
            let method = LoginMethod::ALL.into_iter().find(|m| m.key() == other)?;
            json!(method.default_enabled())
        }
    })
}

/// Проверить значение тумблера. Часовой пояс проверяет база ([`set_many`]).
fn validate(key: &str, value: &Value) -> Result<()> {
    let ok = match key {
        REGISTRATION_MODE => serde_json::from_value::<RegistrationMode>(value.clone()).is_ok(),
        CAPTCHA_PROVIDER => serde_json::from_value::<CaptchaChoice>(value.clone()).is_ok(),
        MAINTENANCE_MESSAGE => value
            .as_str()
            .is_some_and(|text| !text.trim().is_empty() && text.chars().count() <= 500),
        TIMEZONE => value
            .as_str()
            .is_some_and(|tz| (1..=64).contains(&tz.len())),
        // Время проверяет база ([`set_many`]).
        MAINTENANCE_UNTIL => value.is_null() || value.as_str().is_some_and(|t| t.len() <= 64),
        other if default_value(other).is_some() => value.is_boolean(),
        other => {
            return Err(Error::Invalid(format!("нет такой настройки: {other}")));
        }
    };
    if ok {
        Ok(())
    } else {
        Err(Error::Invalid(format!("неверное значение {key}: {value}")))
    }
}

/// Все тумблеры, как они записаны в базе (без env-переключателей).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PlatformSettings {
    pub registration_mode: RegistrationMode,
    pub captcha: CaptchaChoice,
    pub login_enabled: bool,
    pub maintenance: bool,
    pub maintenance_message: String,
    /// «Вернёмся к …» (RFC 3339), если owner задал.
    pub maintenance_until: Option<String>,
    /// Положение тумблера способа входа; `None` — owner его не трогал
    /// (действует стартовое положение, [`Overrides::method_defaults`]).
    /// Порядок — [`LoginMethod::ALL`].
    pub methods: [Option<bool>; 5],
    pub email_enabled: bool,
    pub timezone: String,
}

impl Default for PlatformSettings {
    fn default() -> Self {
        Self {
            registration_mode: RegistrationMode::InviteOnly,
            captcha: CaptchaChoice::Turnstile,
            login_enabled: true,
            maintenance: false,
            maintenance_message: DEFAULT_MAINTENANCE_MESSAGE.into(),
            maintenance_until: None,
            methods: [None; 5],
            email_enabled: true,
            timezone: DEFAULT_TIMEZONE.into(),
        }
    }
}

impl PlatformSettings {
    fn apply(&mut self, key: &str, value: Value) {
        if validate(key, &value).is_err() {
            tracing::warn!(key, %value, "неверное значение настройки платформы — беру по умолчанию");
            return;
        }
        let flag = value.as_bool().unwrap_or_default();
        match key {
            REGISTRATION_MODE => {
                self.registration_mode =
                    serde_json::from_value(value).unwrap_or(self.registration_mode);
            }
            CAPTCHA_PROVIDER => {
                self.captcha = serde_json::from_value(value).unwrap_or(self.captcha)
            }
            LOGIN_ENABLED => self.login_enabled = flag,
            MAINTENANCE_ENABLED => self.maintenance = flag,
            MAINTENANCE_MESSAGE => {
                self.maintenance_message = value.as_str().unwrap_or_default().to_owned();
            }
            EMAIL_ENABLED => self.email_enabled = flag,
            MAINTENANCE_UNTIL => self.maintenance_until = value.as_str().map(str::to_owned),
            TIMEZONE => self.timezone = value.as_str().unwrap_or_default().to_owned(),
            other => {
                if let Some(index) = LoginMethod::ALL.iter().position(|m| m.key() == other) {
                    self.methods[index] = Some(flag);
                }
            }
        }
    }

    /// Положение тумблера; `None` — не меняли.
    pub fn method(&self, method: LoginMethod) -> Option<bool> {
        self.methods[method as usize]
    }
}

/// Аварийные переключатели из переменных окружения. По умолчанию ничего не
/// ограничивают.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Overrides {
    /// `QUBITE_AUTH_LOGIN_ENABLED=false` — новые входы закрыты (кроме owner).
    pub login: bool,
    /// `QUBITE_AUTH_REGISTRATION_ENABLED=false` — регистрация закрыта.
    pub registration: bool,
    /// `QUBITE_AUTH_<СПОСОБ>_ENABLED=false` — способ входа выключен; порядок — [`LoginMethod::ALL`].
    pub methods: [bool; 5],
    /// `QUBITE_MAINTENANCE=true` — техработы.
    pub maintenance: bool,
    /// `QUBITE_EMAIL_ENABLED=false` — письма не отправляются.
    pub email: bool,
    /// `QUBITE_CAPTCHA_DISABLED=true` — CAPTCHA выключена.
    pub captcha_disabled: bool,
    /// Стартовое положение тумблеров способов входа, пока owner их не
    /// трогал: `QUBITE_OAUTH_<ПРОВАЙДЕР>_ENABLED` (AUTH-004, D-194). Не
    /// ограничение, а значение по умолчанию; порядок — [`LoginMethod::ALL`].
    pub method_defaults: [bool; 5],
}

impl Default for Overrides {
    fn default() -> Self {
        Self {
            login: true,
            registration: true,
            methods: [true; 5],
            maintenance: false,
            email: true,
            captcha_disabled: false,
            method_defaults: LoginMethod::ALL.map(LoginMethod::default_enabled),
        }
    }
}

impl Overrides {
    /// Какие ключи сейчас зажаты переменными окружения (Owner Console
    /// показывает их неизменяемыми).
    pub fn locks(&self, key: &str) -> bool {
        match key {
            LOGIN_ENABLED => !self.login,
            REGISTRATION_MODE => !self.registration,
            MAINTENANCE_ENABLED => self.maintenance,
            EMAIL_ENABLED => !self.email,
            CAPTCHA_PROVIDER => self.captcha_disabled,
            other => LoginMethod::ALL
                .iter()
                .position(|m| m.key() == other)
                .is_some_and(|index| !self.methods[index]),
        }
    }
}

/// Что действует на самом деле: тумблеры + env-переключатели.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct Effective {
    pub settings: PlatformSettings,
    pub overrides: Overrides,
}

impl Effective {
    pub fn registration_mode(&self) -> RegistrationMode {
        if self.overrides.registration {
            self.settings.registration_mode
        } else {
            RegistrationMode::Closed
        }
    }

    /// Можно ли открыть новую сессию. Owner может всегда.
    pub fn login_allowed(&self, is_owner: bool) -> bool {
        is_owner || (self.settings.login_enabled && self.overrides.login)
    }

    /// Включён ли способ входа. Owner всегда может войти по паролю, чтобы не
    /// запереть сам себя; OAuth выключается для всех.
    pub fn method_allowed(&self, method: LoginMethod, is_owner: bool) -> bool {
        if is_owner && method == LoginMethod::Password {
            return true;
        }
        let index = method as usize;
        self.settings
            .method(method)
            .unwrap_or(self.overrides.method_defaults[index])
            && self.overrides.methods[index]
    }

    /// Текст техработ, если они идут для этого человека (owner работает).
    pub fn maintenance_for(&self, is_owner: bool) -> Option<&str> {
        (self.maintenance_on() && !is_owner).then_some(self.settings.maintenance_message.as_str())
    }

    pub fn maintenance_on(&self) -> bool {
        self.settings.maintenance || self.overrides.maintenance
    }

    pub fn email_enabled(&self) -> bool {
        self.settings.email_enabled && self.overrides.email
    }

    /// Выбранная CAPTCHA; `Off` — если выключена тумблером или env.
    pub fn captcha(&self) -> CaptchaChoice {
        if self.overrides.captcha_disabled {
            CaptchaChoice::Off
        } else {
            self.settings.captcha
        }
    }
}

/// Прочитать тумблеры. Неизвестные ключи пропускаются, неверные значения —
/// значение по умолчанию.
pub async fn load(conn: &mut PgConnection) -> Result<PlatformSettings> {
    let rows: Vec<(String, Value)> = sqlx::query_as("SELECT key, value FROM platform_settings")
        .fetch_all(conn)
        .await?;
    let mut settings = PlatformSettings::default();
    for (key, value) in rows {
        settings.apply(&key, value);
    }
    Ok(settings)
}

/// То же, взяв соединение из пула.
pub async fn current(pool: &PgPool) -> Result<PlatformSettings> {
    let mut conn = pool.acquire().await?;
    load(&mut conn).await
}

/// Действующие правила: тумблеры из базы + env.
pub async fn effective(pool: &PgPool, overrides: &Overrides) -> Result<Effective> {
    Ok(Effective {
        settings: current(pool).await?,
        overrides: overrides.clone(),
    })
}

/// Настройка для Owner Console.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SettingView {
    pub key: &'static str,
    pub value: Value,
    pub default: Value,
    /// 0 — ни разу не меняли (действует значение по умолчанию).
    pub version: i64,
    /// Зажата переменной окружения — менять в Console бесполезно.
    pub locked_by_env: bool,
    pub updated_at: Option<OffsetDateTime>,
    pub updated_by: Option<Uuid>,
}

/// Все тумблеры с версиями.
pub async fn list(pool: &PgPool, overrides: &Overrides) -> Result<Vec<SettingView>> {
    #[derive(sqlx::FromRow)]
    struct Row {
        key: String,
        value: Value,
        version: i64,
        updated_at: OffsetDateTime,
        updated_by: Option<Uuid>,
    }
    let rows: Vec<Row> =
        sqlx::query_as("SELECT key, value, version, updated_at, updated_by FROM platform_settings")
            .fetch_all(pool)
            .await?;
    let mut stored: BTreeMap<String, Row> = rows.into_iter().map(|r| (r.key.clone(), r)).collect();
    Ok(keys()
        .into_iter()
        .map(|key| {
            let default = LoginMethod::ALL
                .iter()
                .position(|m| m.key() == key)
                .map_or_else(
                    || default_value(key).expect("ключ из списка"),
                    |index| json!(overrides.method_defaults[index]),
                );
            let row = stored.remove(key);
            SettingView {
                key,
                value: row
                    .as_ref()
                    .map_or_else(|| default.clone(), |r| r.value.clone()),
                default,
                version: row.as_ref().map_or(0, |r| r.version),
                locked_by_env: overrides.locks(key),
                updated_at: row.as_ref().map(|r| r.updated_at),
                updated_by: row.and_then(|r| r.updated_by),
            }
        })
        .collect())
}

/// Одно изменение: ключ, новое значение и версия, которую видел owner
/// (0 — настройку ещё не меняли; [`ANY_VERSION`] — без проверки: команды
/// сервера и бот, где «вкладок» нет).
pub const ANY_VERSION: i64 = -1;

#[derive(Debug, Clone)]
pub struct Change {
    pub key: String,
    pub value: Value,
    pub version: i64,
}

/// Сохранить пачку изменений целиком или ничего (D-063: «Сохранить» со
/// списком изменений). Устаревшая версия — [`Error::Conflict`].
pub async fn set_many(pool: &PgPool, actor: Option<Uuid>, changes: &[Change]) -> Result<()> {
    if changes.is_empty() {
        return Ok(());
    }
    let mut seen = std::collections::HashSet::new();
    for change in changes {
        validate(&change.key, &change.value)?;
        if !seen.insert(change.key.as_str()) {
            return Err(Error::Invalid(format!("настройка {} дважды", change.key)));
        }
    }
    let mut tx = pool.begin().await?;
    for change in changes {
        if change.key == MAINTENANCE_UNTIL
            && let Some(at) = change.value.as_str()
        {
            let valid: bool = sqlx::query_scalar("SELECT pg_input_is_valid($1, 'timestamptz')")
                .bind(at)
                .fetch_one(&mut *tx)
                .await?;
            if !valid {
                return Err(Error::Invalid(format!("неверное время: {at}")));
            }
        }
        if change.key == TIMEZONE {
            // Пояс проверяет PostgreSQL: неизвестный — ошибка.
            let known: bool = sqlx::query_scalar(
                "SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = $1)",
            )
            .bind(change.value.as_str().unwrap_or_default())
            .fetch_one(&mut *tx)
            .await?;
            if !known {
                return Err(Error::Invalid(format!(
                    "неизвестный часовой пояс: {}",
                    change.value
                )));
            }
        }
        let before: Option<(Value, i64)> = sqlx::query_as(
            "SELECT value, version FROM platform_settings WHERE key = $1 FOR UPDATE",
        )
        .bind(&change.key)
        .fetch_optional(&mut *tx)
        .await?;
        let current_version = before.as_ref().map_or(0, |(_, version)| *version);
        if change.version != ANY_VERSION && current_version != change.version {
            return Err(Error::Conflict(format!(
                "настройку {} уже изменили (версия {current_version}), обновите страницу",
                change.key
            )));
        }
        if change.version == ANY_VERSION {
            sqlx::query(
                "INSERT INTO platform_settings (key, value, updated_by) VALUES ($1, $2, $3) \
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, \
                 version = platform_settings.version + 1, updated_by = EXCLUDED.updated_by, \
                 updated_at = now()",
            )
            .bind(&change.key)
            .bind(&change.value)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        } else if current_version == 0 {
            // Две первые записи одного ключа одновременно: вторая упрётся в
            // первичный ключ и получит конфликт, а не перезапишет первую.
            let inserted = sqlx::query(
                "INSERT INTO platform_settings (key, value, updated_by) VALUES ($1, $2, $3) \
                 ON CONFLICT (key) DO NOTHING",
            )
            .bind(&change.key)
            .bind(&change.value)
            .bind(actor)
            .execute(&mut *tx)
            .await?
            .rows_affected();
            if inserted == 0 {
                return Err(Error::Conflict(format!(
                    "настройку {} уже изменили, обновите страницу",
                    change.key
                )));
            }
        } else {
            sqlx::query(
                "UPDATE platform_settings SET value = $2, version = version + 1, \
                 updated_by = $3, updated_at = now() WHERE key = $1",
            )
            .bind(&change.key)
            .bind(&change.value)
            .bind(actor)
            .execute(&mut *tx)
            .await?;
        }
        audit::record(
            &mut tx,
            NewAuditEntry {
                actor_id: actor,
                action: "platform.setting_changed".into(),
                target_kind: "platform_setting".into(),
                target_id: Some(change.key.clone()),
                before: Some(
                    before.map_or_else(|| default_value(&change.key).unwrap_or_default(), |b| b.0),
                ),
                after: Some(change.value.clone()),
                ..NewAuditEntry::default()
            },
        )
        .await?;
    }
    tx.commit().await?;
    Ok(())
}

/// Изменить одну настройку без проверки версии (команды и тесты).
pub async fn set(pool: &PgPool, actor: Option<Uuid>, key: &str, value: Value) -> Result<()> {
    set_many(
        pool,
        actor,
        &[Change {
            key: key.into(),
            value,
            version: ANY_VERSION,
        }],
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_key_has_a_valid_default() {
        for key in keys() {
            let value = default_value(key).unwrap();
            validate(key, &value).unwrap();
        }
        assert!(validate("nope", &json!(true)).is_err());
        assert!(validate(LOGIN_ENABLED, &json!("yes")).is_err());
        assert!(validate(REGISTRATION_MODE, &json!("maybe")).is_err());
        assert!(validate(MAINTENANCE_MESSAGE, &json!("  ")).is_err());
    }

    #[test]
    fn env_is_stronger_but_owner_keeps_the_key() {
        let mut effective = Effective {
            settings: PlatformSettings::default(),
            overrides: Overrides::default(),
        };
        assert!(effective.method_allowed(LoginMethod::Yandex, false));
        assert!(!effective.method_allowed(LoginMethod::Google, false));
        effective.overrides.methods[LoginMethod::Password as usize] = false;
        effective.overrides.login = false;
        effective.overrides.maintenance = true;
        assert!(!effective.method_allowed(LoginMethod::Password, false));
        assert!(effective.method_allowed(LoginMethod::Password, true));
        assert!(!effective.login_allowed(false));
        assert!(effective.login_allowed(true));
        assert!(effective.maintenance_for(false).is_some());
        assert!(effective.maintenance_for(true).is_none());
        assert!(effective.overrides.locks(MAINTENANCE_ENABLED));
        assert!(effective.overrides.locks(LoginMethod::Password.key()));
        assert!(!effective.overrides.locks(LoginMethod::Vk.key()));
    }
}
