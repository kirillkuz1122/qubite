//! Общие типы Qubite: версия, окружение, секреты.
//!
//! Этот crate не зависит ни от базы, ни от HTTP — его могут использовать все
//! остальные части сервера и клиентское ядро устройств.

use std::fmt;

/// Версия Qubite (общая для всех crate'ов workspace).
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

/// В каком окружении запущен сервер.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Environment {
    Dev,
    Prod,
}

impl std::str::FromStr for Environment {
    type Err = UnknownEnvironment;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value.trim().to_ascii_lowercase().as_str() {
            "dev" | "development" => Ok(Self::Dev),
            "prod" | "production" => Ok(Self::Prod),
            other => Err(UnknownEnvironment(other.to_owned())),
        }
    }
}

#[derive(Debug, thiserror::Error)]
#[error("неизвестное окружение «{0}»: ожидается dev или prod")]
pub struct UnknownEnvironment(String);

/// Значение, которое нельзя случайно напечатать в лог.
///
/// `Debug` и `Display` показывают `***`. Настоящее значение доступно только
/// через явный вызов [`Secret::expose`].
#[derive(Clone, PartialEq, Eq)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// Открыть значение. Вызывать только там, где оно действительно нужно
    /// (например, при подключении к базе).
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

impl fmt::Display for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("***")
    }
}

impl From<String> for Secret {
    fn from(value: String) -> Self {
        Self(value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_is_never_printed() {
        let secret = Secret::new("postgres://user:hunter2@localhost/qubite");
        assert_eq!(format!("{secret}"), "***");
        assert_eq!(format!("{secret:?}"), "Secret(***)");
        assert!(secret.expose().contains("hunter2"));
    }

    #[test]
    fn environment_parses_known_values() {
        assert_eq!("dev".parse::<Environment>().unwrap(), Environment::Dev);
        assert_eq!(" PROD ".parse::<Environment>().unwrap(), Environment::Prod);
        assert!("staging".parse::<Environment>().is_err());
    }
}
