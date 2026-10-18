//! Пароли: Argon2id и ограничение одновременных проверок.
//!
//! Параметры — рекомендованные OWASP: 19 МиБ памяти, 2 прохода, 1 поток
//! (≈ десятки миллисекунд на обычном процессоре). Замер на Raspberry Pi —
//! открытый вопрос (STATUS, Q-13): Pi трогаем только с разрешения владельца.
//! Параметры записываются в саму строку хеша, поэтому их можно поменять
//! позже — старые хеши продолжат проверяться.

use std::sync::{Arc, OnceLock};

use argon2::{
    Algorithm, Argon2, Params, Version,
    password_hash::{PasswordHasher, PasswordVerifier, phc::PasswordHash},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

use crate::{Error, Result};

/// Минимальная длина пароля в символах (D-171).
pub const MIN_PASSWORD_CHARS: usize = 10;
/// Максимальная длина пароля в байтах: защита от очень длинных строк.
pub const MAX_PASSWORD_BYTES: usize = 1024;

/// Проверка требований к паролю.
pub fn validate(password: &str) -> Result<()> {
    if password.chars().count() < MIN_PASSWORD_CHARS {
        return Err(Error::Invalid(format!(
            "пароль должен быть не короче {MIN_PASSWORD_CHARS} символов"
        )));
    }
    if password.len() > MAX_PASSWORD_BYTES {
        return Err(Error::Invalid("пароль слишком длинный".into()));
    }
    Ok(())
}

fn argon2() -> Argon2<'static> {
    Argon2::new(Algorithm::Argon2id, Version::V0x13, Params::DEFAULT)
}

/// Хеширование и проверка паролей. Одновременно идёт не больше `parallel`
/// вычислений: каждое берёт 19 МиБ памяти и целое ядро, а перебор с многих
/// адресов не должен положить сервер.
#[derive(Clone)]
pub struct Passwords {
    permits: Arc<Semaphore>,
}

impl Default for Passwords {
    fn default() -> Self {
        Self::new(2)
    }
}

impl Passwords {
    pub fn new(parallel: usize) -> Self {
        Self {
            permits: Arc::new(Semaphore::new(parallel.max(1))),
        }
    }

    /// Хеш пароля в формате PHC (`$argon2id$v=19$m=19456,t=2,p=1$…`).
    pub async fn hash(&self, password: &str) -> Result<String> {
        let password = password.to_owned();
        self.run(move || hash_blocking(&password)).await
    }

    /// Совпадает ли пароль с хешем. Неверный хеш считается несовпадением.
    pub async fn verify(&self, password: &str, hash: &str) -> Result<bool> {
        self.permit().await?.verify(password, hash).await
    }

    /// Проверка с поддельным хешем — для несуществующей почты. Занимает
    /// столько же времени, сколько настоящая, поэтому по времени ответа
    /// нельзя узнать, есть ли такой аккаунт.
    pub async fn verify_dummy(&self, password: &str) -> Result<bool> {
        self.permit().await?.verify_dummy(password).await
    }

    /// Занять место для одной проверки заранее. Вход берёт его **до** того,
    /// как открыть транзакцию: иначе очередь на проверку держала бы соединения
    /// с базой, и перебор с разных почт занял бы весь пул — сервер перестал
    /// бы отвечать всем.
    pub async fn permit(&self) -> Result<PasswordPermit> {
        let permit = self
            .permits
            .clone()
            .acquire_owned()
            .await
            .map_err(|_| Error::Hash("пул проверки паролей закрыт".into()))?;
        Ok(PasswordPermit { _permit: permit })
    }

    async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce() -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let _permit = self.permit().await?;
        blocking(work).await
    }
}

/// Занятое место для проверки пароля (см. [`Passwords::permit`]).
pub struct PasswordPermit {
    _permit: OwnedSemaphorePermit,
}

impl PasswordPermit {
    /// Как [`Passwords::verify`], но без новой очереди: место уже занято.
    pub async fn verify(&self, password: &str, hash: &str) -> Result<bool> {
        let (password, hash) = (password.to_owned(), hash.to_owned());
        blocking(move || Ok(verify_blocking(&password, &hash))).await
    }

    /// Как [`Passwords::verify_dummy`], но без новой очереди.
    pub async fn verify_dummy(&self, password: &str) -> Result<bool> {
        let password = password.to_owned();
        blocking(move || {
            static DUMMY: OnceLock<String> = OnceLock::new();
            let hash = match DUMMY.get() {
                Some(hash) => hash,
                None => {
                    let hash = hash_blocking("qubite-dummy-password")?;
                    DUMMY.get_or_init(|| hash)
                }
            };
            let _ = verify_blocking(&password, hash);
            Ok(false)
        })
        .await
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T> + Send + 'static,
) -> Result<T> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| Error::Hash(error.to_string()))?
}

fn hash_blocking(password: &str) -> Result<String> {
    argon2()
        .hash_password(password.as_bytes())
        .map(|hash| hash.to_string())
        .map_err(|error| Error::Hash(error.to_string()))
}

fn verify_blocking(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash).is_ok_and(|parsed| {
        argon2()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_rules() {
        assert!(validate("короткий").is_err());
        assert!(validate("достаточно-длинный").is_ok());
        assert!(validate(&"x".repeat(MAX_PASSWORD_BYTES + 1)).is_err());
    }

    #[tokio::test]
    async fn hash_is_argon2id_and_verifies() {
        let passwords = Passwords::default();
        let hash = passwords.hash("верный пароль").await.unwrap();
        assert!(
            hash.starts_with("$argon2id$v=19$m=19456,t=2,p=1$"),
            "{hash}"
        );
        assert!(!hash.contains("верный"));
        assert!(passwords.verify("верный пароль", &hash).await.unwrap());
        assert!(!passwords.verify("неверный пароль", &hash).await.unwrap());
        assert!(!passwords.verify("что угодно", "не хеш").await.unwrap());
        assert!(!passwords.verify_dummy("верный пароль").await.unwrap());
    }
}
