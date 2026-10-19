//! Аккаунты и вход Qubite (AUTH-001).
//!
//! - [`owner`] — единственный owner платформы: создаётся только командой
//!   `qubite owner create`, второго база не примет;
//! - [`password`] — хеши паролей Argon2id и ограничение одновременных проверок;
//! - [`login`] — вход по почте и паролю с лимитами перебора;
//! - [`email`] — письма с кодами: подтверждение почты и восстановление пароля;
//! - [`platform`] — тумблеры платформы и аварийные env-переключатели (ACC-002);
//! - [`invitations`], [`registration`] — приглашения и регистрация (AUTH-003);
//! - [`sessions`] — сессии браузера: токен в cookie, CSRF-токен, скользящий срок,
//!   список, отзыв, «выйти везде».
//!
//! В базе хранятся только хеши: пароля (Argon2id), токена сессии и CSRF-токена
//! (SHA-256). Сами токены видит только браузер.

pub mod accounts;
pub mod consent;
pub mod devices;
pub mod email;
pub mod invitations;
pub mod login;
pub mod maintenance;
pub mod owner;
pub mod password;
pub mod platform;
pub mod registration;
pub mod sessions;

use std::time::Duration;

pub use login::{LoginInput, confirm_password, login};
pub use owner::Account;
pub use password::Passwords;
pub use sessions::{ClientInfo, IssuedSession, ResolvedSession, RevokeReason, SessionView};

use sha2::{Digest, Sha256};
use uuid::Uuid;

/// Настройки входа и сессий.
#[derive(Debug, Clone)]
pub struct AuthConfig {
    /// Срок сессии; продлевается при использовании (D-170).
    pub session_ttl: Duration,
    /// Как часто отмечать использование сессии и продлевать срок.
    pub touch_interval: Duration,
    /// Лимит неудачных попыток на одну почту.
    pub email_limit: Limit,
    /// Лимит неудачных попыток с одного IP-адреса (по всем почтам).
    pub ip_limit: Limit,
    /// CAPTCHA на входе (D-189, Q-20): после стольких неудач по почте…
    pub captcha_after_email: i64,
    /// …или с одного IP вход требует CAPTCHA (если она включена).
    pub captcha_after_ip: i64,
    /// Лимит неудач по почте, когда каждая попытка прошла CAPTCHA: чужой
    /// человек уже не закроет вход owner пятью неверными паролями.
    pub email_limit_with_captcha: Limit,
    /// Письма с кодами (AUTH-002).
    pub email: email::EmailCodes,
}

/// Не больше `max_failures` неудачных попыток за `window`.
#[derive(Debug, Clone, Copy)]
pub struct Limit {
    pub max_failures: i64,
    pub window: Duration,
}

impl Default for AuthConfig {
    fn default() -> Self {
        Self {
            session_ttl: Duration::from_secs(30 * 24 * 60 * 60),
            touch_interval: Duration::from_secs(5 * 60),
            email_limit: Limit {
                max_failures: 5,
                window: Duration::from_secs(15 * 60),
            },
            ip_limit: Limit {
                max_failures: 30,
                window: Duration::from_secs(15 * 60),
            },
            email: email::EmailCodes::default(),
            captcha_after_email: 3,
            captcha_after_ip: 10,
            email_limit_with_captcha: Limit {
                max_failures: 20,
                window: Duration::from_secs(15 * 60),
            },
        }
    }
}

/// Ошибки входа и работы с аккаунтами.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Неверная почта или пароль. Какая из двух — не сообщаем.
    #[error("неверная почта или пароль")]
    InvalidCredentials,
    #[error("слишком много неудачных попыток, повторите через {retry_after_secs} с")]
    TooManyAttempts { retry_after_secs: u64 },
    #[error("аккаунт заблокирован")]
    AccountBlocked,
    #[error("почта не подтверждена")]
    EmailNotVerified,
    #[error("регистрация закрыта")]
    RegistrationClosed,
    /// Новые входы выключены (тумблер или env), кроме owner.
    #[error("вход временно закрыт")]
    LoginDisabled,
    #[error("этот способ входа выключен")]
    LoginMethodDisabled,
    /// Идут техработы; текст — от owner.
    #[error("техработы: {0}")]
    Maintenance(String),
    /// Почта выключена — подтвердить регистрацию нечем.
    #[error("почта выключена")]
    EmailDisabled,
    /// Настройку уже изменили (устаревшая версия).
    #[error("конфликт: {0}")]
    Conflict(String),
    #[error("регистрация только по приглашению")]
    InviteRequired,
    /// Регистрация без согласия с текущими документами (D-230).
    #[error("нужно согласие с условиями")]
    ConsentRequired,
    /// Приглашение не найдено, истекло, использовано, отозвано или на другую почту.
    #[error("приглашение недействительно")]
    InvalidInvite,
    /// Код или ссылка из письма неверные, устарели или уже использованы.
    #[error("код неверный или устарел")]
    InvalidCode,
    #[error("owner платформы уже есть, второго быть не может")]
    OwnerExists,
    #[error("owner платформы ещё не создан")]
    NoOwner,
    #[error("аккаунт с такой почтой уже есть")]
    EmailTaken,
    #[error("неверные данные: {0}")]
    Invalid(String),
    #[error("не найдено")]
    NotFound,
    /// Неизвестное приложение или адрес возврата (OAuth `invalid_client`).
    #[error("неизвестное приложение или адрес возврата")]
    InvalidClient,
    /// Код или refresh-токен недействителен (OAuth `invalid_grant`).
    #[error("код или токен недействителен")]
    InvalidGrant,
    #[error("ошибка хеширования пароля: {0}")]
    Hash(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка аудита: {0}")]
    Audit(#[from] qubite_objects::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Новый идентификатор: UUIDv7.
pub fn new_id() -> Uuid {
    Uuid::now_v7()
}

/// Почта в каноническом виде: без пробелов по краям, в нижнем регистре.
/// Проверка простая: есть `@` не в начале и не в конце, нет пробелов.
pub fn normalize_email(raw: &str) -> Result<String> {
    let email = raw.trim().to_lowercase();
    let valid = (3..=320).contains(&email.len())
        && !email.chars().any(char::is_whitespace)
        && email
            .split_once('@')
            .is_some_and(|(local, domain)| !local.is_empty() && !domain.is_empty());
    if valid {
        Ok(email)
    } else {
        Err(Error::Invalid("неверный адрес почты".into()))
    }
}

/// SHA-256 случайного токена. Токены длинные и случайные, поэтому быстрый
/// хеш здесь безопасен (в отличие от паролей).
pub fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Случайный токен: 32 байта из генератора ОС в base64url без `=`.
pub fn random_token() -> String {
    use base64::Engine;
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("генератор случайных чисел ОС доступен");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

/// Длительность в секундах для SQL (`$1::float8 * interval '1 second'`).
pub(crate) fn secs(duration: Duration) -> f64 {
    duration.as_secs_f64()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn email_is_normalized() {
        assert_eq!(
            normalize_email("  Kirill@Qubite.RU ").unwrap(),
            "kirill@qubite.ru"
        );
        assert!(normalize_email("no-at-sign").is_err());
        assert!(normalize_email("@domain").is_err());
        assert!(normalize_email("user@").is_err());
        assert!(normalize_email("two words@x.ru").is_err());
    }

    #[test]
    fn tokens_are_random_and_hashed() {
        let a = random_token();
        let b = random_token();
        assert_ne!(a, b);
        assert_eq!(a.len(), 43);
        assert_eq!(token_hash(&a).len(), 32);
        assert_ne!(token_hash(&a), token_hash(&b));
    }
}
