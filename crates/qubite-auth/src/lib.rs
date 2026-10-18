//! Аккаунты и вход Qubite (AUTH-001).
//!
//! - [`owner`] — единственный owner платформы: создаётся только командой
//!   `qubite owner create`, второго база не примет;
//! - [`password`] — хеши паролей Argon2id и ограничение одновременных проверок;
//! - [`login`] — вход по почте и паролю с лимитами перебора;
//! - [`sessions`] — сессии браузера: токен в cookie, CSRF-токен, скользящий срок,
//!   список, отзыв, «выйти везде».
//!
//! В базе хранятся только хеши: пароля (Argon2id), токена сессии и CSRF-токена
//! (SHA-256). Сами токены видит только браузер.

pub mod login;
pub mod owner;
pub mod password;
pub mod sessions;

use std::time::Duration;

pub use login::{LoginInput, login};
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
pub(crate) fn token_hash(token: &str) -> Vec<u8> {
    Sha256::digest(token.as_bytes()).to_vec()
}

/// Случайный токен: 32 байта из генератора ОС в base64url без `=`.
pub(crate) fn random_token() -> String {
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
