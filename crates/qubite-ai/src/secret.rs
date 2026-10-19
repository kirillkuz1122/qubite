//! Шифрование секретов в базе (токены ChatGPT, AI-005): ChaCha20-Poly1305
//! (ring). Ключ — 32 байта в `QUBITE_AI_SECRET_KEY` (base64), в базе его нет:
//! утечка базы не раскрывает токены. Каждая запись — свой случайный nonce;
//! «назначение» (`purpose`) входит в подпись, поэтому зашифрованный refresh-токен
//! нельзя подставить вместо access-токена.

use base64::{Engine, engine::general_purpose::STANDARD};
use ring::{
    aead::{Aad, CHACHA20_POLY1305, LessSafeKey, NONCE_LEN, Nonce, UnboundKey},
    rand::{SecureRandom, SystemRandom},
};

pub struct SecretBox {
    key: LessSafeKey,
    rng: SystemRandom,
}

impl std::fmt::Debug for SecretBox {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretBox(***)")
    }
}

impl SecretBox {
    /// Ключ — base64 от 32 случайных байт (`openssl rand -base64 32`).
    pub fn from_base64(key: &str) -> Result<Self, String> {
        let bytes = STANDARD.decode(key.trim()).map_err(|_| {
            "QUBITE_AI_SECRET_KEY: нужен base64 (openssl rand -base64 32)".to_owned()
        })?;
        if bytes.len() != 32 {
            return Err(format!(
                "QUBITE_AI_SECRET_KEY: нужно ровно 32 байта, а не {}",
                bytes.len()
            ));
        }
        let key = UnboundKey::new(&CHACHA20_POLY1305, &bytes).map_err(|_| "ключ не подошёл")?;
        Ok(Self {
            key: LessSafeKey::new(key),
            rng: SystemRandom::new(),
        })
    }

    /// Новый случайный ключ в base64 (для `qubite ai secret-key`).
    pub fn generate_key() -> String {
        let mut bytes = [0_u8; 32];
        SystemRandom::new()
            .fill(&mut bytes)
            .expect("случайные байты");
        STANDARD.encode(bytes)
    }

    pub fn seal(&self, purpose: &str, plain: &str) -> String {
        let mut nonce = [0_u8; NONCE_LEN];
        self.rng.fill(&mut nonce).expect("случайные байты");
        let mut data = plain.as_bytes().to_vec();
        self.key
            .seal_in_place_append_tag(
                Nonce::assume_unique_for_key(nonce),
                Aad::from(purpose.as_bytes()),
                &mut data,
            )
            .expect("шифрование");
        let mut out = nonce.to_vec();
        out.extend_from_slice(&data);
        STANDARD.encode(out)
    }

    pub fn open(&self, purpose: &str, sealed: &str) -> Result<String, String> {
        let bad = || "секрет не расшифрован: другой ключ или запись повреждена".to_owned();
        let bytes = STANDARD.decode(sealed).map_err(|_| bad())?;
        if bytes.len() < NONCE_LEN {
            return Err(bad());
        }
        let (nonce, data) = bytes.split_at(NONCE_LEN);
        let mut data = data.to_vec();
        let nonce = Nonce::try_assume_unique_for_key(nonce).map_err(|_| bad())?;
        let plain = self
            .key
            .open_in_place(nonce, Aad::from(purpose.as_bytes()), &mut data)
            .map_err(|_| bad())?;
        String::from_utf8(plain.to_vec()).map_err(|_| bad())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sealed_secret_opens_only_with_same_key_and_purpose() {
        let key = SecretBox::generate_key();
        let secret = SecretBox::from_base64(&key).unwrap();
        let sealed = secret.seal("access", "токен-123");
        assert!(!sealed.contains("токен"));
        assert_ne!(
            sealed,
            secret.seal("access", "токен-123"),
            "свой nonce каждый раз"
        );
        assert_eq!(secret.open("access", &sealed).unwrap(), "токен-123");
        assert!(secret.open("refresh", &sealed).is_err(), "чужое назначение");
        let other = SecretBox::from_base64(&SecretBox::generate_key()).unwrap();
        assert!(other.open("access", &sealed).is_err(), "чужой ключ");
        assert!(SecretBox::from_base64("короткий").is_err());
        assert!(SecretBox::from_base64("AAAA").is_err());
    }
}
