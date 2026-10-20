//! Web Push без сторонних служб (D-313): шифрование сообщения для браузера
//! (RFC 8291, `aes128gcm`) и подпись сервера VAPID (RFC 8292).
//!
//! Ключ сервера — пара P-256; закрытый ключ (PKCS#8, base64url) лежит в
//! `.env` (`QUBITE_PUSH_VAPID_KEY`), открытый браузер получает при подписке.
//! Создать: `qubite push keys`.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD as B64};
use ring::{
    aead, agreement, hkdf,
    rand::{SecureRandom, SystemRandom},
    signature::{self, EcdsaKeyPair, KeyPair},
};
use serde_json::json;
use std::time::Duration;
use time::OffsetDateTime;

/// Запись одна, поэтому размер записи — с запасом на всё сообщение.
const RECORD_SIZE: u32 = 4096;
/// Больше 4 КБ службы push не принимают; оставляем место на шифр.
pub const MAX_PAYLOAD: usize = 3000;

#[derive(Debug, thiserror::Error)]
pub enum PushError {
    #[error("неверный ключ: {0}")]
    Key(String),
    #[error("подписка больше не действует")]
    Gone,
    #[error("служба push ответила {0}")]
    Status(u16),
    #[error("служба push недоступна: {0}")]
    Network(String),
}

/// Новая пара ключей VAPID: (закрытый — в `.env`, открытый — для браузера).
pub fn generate_keys() -> Result<(String, String), PushError> {
    let rng = SystemRandom::new();
    let pkcs8 = EcdsaKeyPair::generate_pkcs8(&signature::ECDSA_P256_SHA256_FIXED_SIGNING, &rng)
        .map_err(|_| PushError::Key("ключ не создан".into()))?;
    let pair = EcdsaKeyPair::from_pkcs8(
        &signature::ECDSA_P256_SHA256_FIXED_SIGNING,
        pkcs8.as_ref(),
        &rng,
    )
    .map_err(|_| PushError::Key("ключ не читается".into()))?;
    Ok((
        B64.encode(pkcs8.as_ref()),
        B64.encode(pair.public_key().as_ref()),
    ))
}

/// Подписка браузера.
#[derive(Debug, Clone)]
pub struct Target<'a> {
    pub endpoint: &'a str,
    /// Открытый ключ браузера (base64url, 65 байт).
    pub p256dh: &'a str,
    /// Секрет браузера (base64url, 16 байт).
    pub auth: &'a str,
}

/// Отправитель Web Push.
pub struct WebPush {
    key: EcdsaKeyPair,
    public: String,
    subject: String,
    http: reqwest::Client,
    rng: SystemRandom,
    /// Разрешить `http://127.0.0.1` (тесты).
    pub allow_loopback: bool,
}

impl std::fmt::Debug for WebPush {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WebPush")
            .field("public", &self.public)
            .field("subject", &self.subject)
            .finish_non_exhaustive()
    }
}

/// Службы push браузеров. Сервер отправляет только туда: иначе адрес
/// подписки мог бы заставить его ходить во внутреннюю сеть.
const SERVICES: &[&str] = &[
    "fcm.googleapis.com",
    "updates.push.services.mozilla.com",
    "push.services.mozilla.com",
    "notify.windows.com",
    "push.apple.com",
];

impl WebPush {
    /// `private_key` — PKCS#8 base64url из `qubite push keys`; `subject` —
    /// `mailto:…` или адрес сайта (по нему служба push свяжется с владельцем).
    pub fn new(private_key: &str, subject: &str) -> Result<Self, PushError> {
        let rng = SystemRandom::new();
        let pkcs8 = B64
            .decode(private_key.trim())
            .map_err(|_| PushError::Key("QUBITE_PUSH_VAPID_KEY — не base64url".into()))?;
        let key =
            EcdsaKeyPair::from_pkcs8(&signature::ECDSA_P256_SHA256_FIXED_SIGNING, &pkcs8, &rng)
                .map_err(|_| {
                    PushError::Key("QUBITE_PUSH_VAPID_KEY — не ключ P-256 (PKCS#8)".into())
                })?;
        let public = B64.encode(key.public_key().as_ref());
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(20))
            .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| PushError::Network(error.to_string()))?;
        Ok(Self {
            key,
            public,
            subject: subject.to_owned(),
            http,
            rng,
            allow_loopback: false,
        })
    }

    /// Открытый ключ для `pushManager.subscribe({ applicationServerKey })`.
    pub fn public_key(&self) -> &str {
        &self.public
    }

    /// Адрес подписки ведёт в известную службу push (или на локальный — в тестах).
    pub fn endpoint_allowed(&self, endpoint: &str) -> bool {
        let Ok(url) = reqwest::Url::parse(endpoint) else {
            return false;
        };
        let Some(host) = url.host_str() else {
            return false;
        };
        match url.scheme() {
            "https" => SERVICES
                .iter()
                .any(|service| host == *service || host.ends_with(&format!(".{service}"))),
            "http" => self.allow_loopback && (host == "127.0.0.1" || host == "localhost"),
            _ => false,
        }
    }

    /// Подпись VAPID для службы push этой подписки.
    fn authorization(&self, endpoint: &str) -> Result<String, PushError> {
        let url = reqwest::Url::parse(endpoint)
            .map_err(|_| PushError::Key("неверный адрес подписки".into()))?;
        let audience = url.origin().ascii_serialization();
        let exp = OffsetDateTime::now_utc().unix_timestamp() + 12 * 60 * 60;
        let header = B64.encode(br#"{"typ":"JWT","alg":"ES256"}"#);
        let claims =
            B64.encode(json!({ "aud": audience, "exp": exp, "sub": self.subject }).to_string());
        let unsigned = format!("{header}.{claims}");
        let signature = self
            .key
            .sign(&self.rng, unsigned.as_bytes())
            .map_err(|_| PushError::Key("подпись VAPID не удалась".into()))?;
        Ok(format!(
            "vapid t={unsigned}.{}, k={}",
            B64.encode(signature.as_ref()),
            self.public
        ))
    }

    /// Зашифровать и отправить. `Gone` — подписку пора удалить.
    pub async fn send(&self, target: &Target<'_>, payload: &[u8]) -> Result<(), PushError> {
        if !self.endpoint_allowed(target.endpoint) {
            return Err(PushError::Key("адрес подписки не служба push".into()));
        }
        let body = encrypt(&self.rng, target, payload)?;
        let response = self
            .http
            .post(target.endpoint)
            .header("authorization", self.authorization(target.endpoint)?)
            .header("content-encoding", "aes128gcm")
            .header("content-type", "application/octet-stream")
            .header("ttl", "86400")
            .header("urgency", "high")
            .body(body)
            .send()
            .await
            .map_err(|error| PushError::Network(error.without_url().to_string()))?;
        match response.status().as_u16() {
            200..=299 => Ok(()),
            404 | 410 => Err(PushError::Gone),
            status => Err(PushError::Status(status)),
        }
    }
}

struct Len(usize);

impl hkdf::KeyType for Len {
    fn len(&self) -> usize {
        self.0
    }
}

fn expand(prk: &hkdf::Prk, info: &[u8], len: usize) -> Result<Vec<u8>, PushError> {
    let mut out = vec![0; len];
    prk.expand(&[info], Len(len))
        .and_then(|okm| okm.fill(&mut out))
        .map_err(|_| PushError::Key("HKDF".into()))?;
    Ok(out)
}

/// Ключ и nonce записи из общего секрета (RFC 8291, §3.3–3.4).
fn derive(
    ecdh: &[u8],
    auth: &[u8],
    ua_public: &[u8],
    as_public: &[u8],
    salt: &[u8],
) -> Result<(Vec<u8>, Vec<u8>), PushError> {
    let prk_key = hkdf::Salt::new(hkdf::HKDF_SHA256, auth).extract(ecdh);
    let mut key_info = b"WebPush: info\0".to_vec();
    key_info.extend_from_slice(ua_public);
    key_info.extend_from_slice(as_public);
    let ikm = expand(&prk_key, &key_info, 32)?;
    let prk = hkdf::Salt::new(hkdf::HKDF_SHA256, salt).extract(&ikm);
    Ok((
        expand(&prk, b"Content-Encoding: aes128gcm\0", 16)?,
        expand(&prk, b"Content-Encoding: nonce\0", 12)?,
    ))
}

/// Тело запроса `aes128gcm`: заголовок (соль, размер записи, ключ сервера) и шифр.
pub fn encrypt(
    rng: &SystemRandom,
    target: &Target<'_>,
    payload: &[u8],
) -> Result<Vec<u8>, PushError> {
    if payload.len() > MAX_PAYLOAD {
        return Err(PushError::Key("сообщение для push слишком длинное".into()));
    }
    let ua_public = B64
        .decode(target.p256dh)
        .map_err(|_| PushError::Key("p256dh — не base64url".into()))?;
    let auth = B64
        .decode(target.auth)
        .map_err(|_| PushError::Key("auth — не base64url".into()))?;
    if ua_public.len() != 65 || auth.len() != 16 {
        return Err(PushError::Key("ключи браузера неверной длины".into()));
    }
    let private = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, rng)
        .map_err(|_| PushError::Key("ключ не создан".into()))?;
    let as_public = private
        .compute_public_key()
        .map_err(|_| PushError::Key("ключ не создан".into()))?;
    let ecdh = agreement::agree_ephemeral(
        private,
        &agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, &ua_public),
        <[u8]>::to_vec,
    )
    .map_err(|_| PushError::Key("ключ браузера не точка P-256".into()))?;
    let mut salt = [0u8; 16];
    rng.fill(&mut salt)
        .map_err(|_| PushError::Key("нет случайных чисел".into()))?;
    let (cek, nonce) = derive(&ecdh, &auth, &ua_public, as_public.as_ref(), &salt)?;
    let key = aead::LessSafeKey::new(
        aead::UnboundKey::new(&aead::AES_128_GCM, &cek)
            .map_err(|_| PushError::Key("AES".into()))?,
    );
    let mut record = payload.to_vec();
    // Разделитель последней записи.
    record.push(2);
    key.seal_in_place_append_tag(
        aead::Nonce::try_assume_unique_for_key(&nonce)
            .map_err(|_| PushError::Key("nonce".into()))?,
        aead::Aad::empty(),
        &mut record,
    )
    .map_err(|_| PushError::Key("шифрование не удалось".into()))?;
    let mut body = Vec::with_capacity(16 + 4 + 1 + 65 + record.len());
    body.extend_from_slice(&salt);
    body.extend_from_slice(&RECORD_SIZE.to_be_bytes());
    body.push(65);
    body.extend_from_slice(as_public.as_ref());
    body.extend_from_slice(&record);
    Ok(body)
}

/// Браузер для проверок: свой ключ и секрет, расшифровка как в RFC 8291.
/// Сервер этим не пользуется — так тесты убеждаются, что браузер прочтёт.
pub struct TestBrowser {
    private: Option<agreement::EphemeralPrivateKey>,
    public: Vec<u8>,
    auth: [u8; 16],
}

impl TestBrowser {
    pub fn new() -> Self {
        let rng = SystemRandom::new();
        let private = agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, &rng)
            .expect("ключ P-256");
        let public = private
            .compute_public_key()
            .expect("открытый ключ")
            .as_ref()
            .to_vec();
        let mut auth = [0u8; 16];
        rng.fill(&mut auth).expect("случайные числа");
        Self {
            private: Some(private),
            public,
            auth,
        }
    }

    /// `p256dh` для подписки.
    pub fn p256dh(&self) -> String {
        B64.encode(&self.public)
    }

    /// `auth` для подписки.
    pub fn auth(&self) -> String {
        B64.encode(self.auth)
    }

    /// Расшифровать тело запроса (ключ браузера одноразовый — один раз).
    pub fn decrypt(&mut self, body: &[u8]) -> Option<Vec<u8>> {
        if body.len() < 86 || body[20] != 65 {
            return None;
        }
        let salt = &body[..16];
        let as_public = &body[21..86];
        let ecdh = agreement::agree_ephemeral(
            self.private.take()?,
            &agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, as_public),
            <[u8]>::to_vec,
        )
        .ok()?;
        let (cek, nonce) = derive(&ecdh, &self.auth, &self.public, as_public, salt).ok()?;
        let key = aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_128_GCM, &cek).ok()?);
        let mut record = body[86..].to_vec();
        let plain = key
            .open_in_place(
                aead::Nonce::try_assume_unique_for_key(&nonce).ok()?,
                aead::Aad::empty(),
                &mut record,
            )
            .ok()?;
        (plain.last() == Some(&2)).then(|| plain[..plain.len() - 1].to_vec())
    }
}

impl Default for TestBrowser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Браузер: свой ключ и секрет, расшифровка как в RFC 8291.
    struct Browser {
        private: Option<agreement::EphemeralPrivateKey>,
        public: Vec<u8>,
        auth: [u8; 16],
    }

    impl Browser {
        fn new(rng: &SystemRandom) -> Self {
            let private =
                agreement::EphemeralPrivateKey::generate(&agreement::ECDH_P256, rng).unwrap();
            let public = private.compute_public_key().unwrap().as_ref().to_vec();
            let mut auth = [0u8; 16];
            rng.fill(&mut auth).unwrap();
            Self {
                private: Some(private),
                public,
                auth,
            }
        }

        fn decrypt(&mut self, body: &[u8]) -> Vec<u8> {
            let salt = &body[..16];
            assert_eq!(&body[16..20], &RECORD_SIZE.to_be_bytes());
            assert_eq!(body[20], 65);
            let as_public = &body[21..86];
            let ecdh = agreement::agree_ephemeral(
                self.private.take().unwrap(),
                &agreement::UnparsedPublicKey::new(&agreement::ECDH_P256, as_public),
                <[u8]>::to_vec,
            )
            .unwrap();
            let (cek, nonce) = derive(&ecdh, &self.auth, &self.public, as_public, salt).unwrap();
            let key =
                aead::LessSafeKey::new(aead::UnboundKey::new(&aead::AES_128_GCM, &cek).unwrap());
            let mut record = body[86..].to_vec();
            let plain = key
                .open_in_place(
                    aead::Nonce::try_assume_unique_for_key(&nonce).unwrap(),
                    aead::Aad::empty(),
                    &mut record,
                )
                .unwrap();
            assert_eq!(plain.last(), Some(&2), "разделитель последней записи");
            plain[..plain.len() - 1].to_vec()
        }
    }

    #[test]
    fn browser_decrypts_the_message() {
        let rng = SystemRandom::new();
        let mut browser = Browser::new(&rng);
        let p256dh = B64.encode(&browser.public);
        let auth = B64.encode(browser.auth);
        let target = Target {
            endpoint: "https://fcm.googleapis.com/fcm/send/abc",
            p256dh: &p256dh,
            auth: &auth,
        };
        let message = "🔔 Сходить в музей — через час".as_bytes();
        let body = encrypt(&rng, &target, message).unwrap();
        assert_eq!(browser.decrypt(&body), message);
    }

    #[test]
    fn vapid_signature_verifies_with_the_public_key() {
        let (private, public) = generate_keys().unwrap();
        let push = WebPush::new(&private, "mailto:owner@qubiteapp.ru").unwrap();
        assert_eq!(push.public_key(), public);
        let header = push
            .authorization("https://updates.push.services.mozilla.com/wpush/v2/xyz")
            .unwrap();
        let (token, key) = header
            .strip_prefix("vapid t=")
            .unwrap()
            .split_once(", k=")
            .unwrap();
        assert_eq!(key, public);
        let (unsigned, signature) = token.rsplit_once('.').unwrap();
        let claims: serde_json::Value =
            serde_json::from_slice(&B64.decode(unsigned.split_once('.').unwrap().1).unwrap())
                .unwrap();
        assert_eq!(claims["aud"], "https://updates.push.services.mozilla.com");
        assert_eq!(claims["sub"], "mailto:owner@qubiteapp.ru");
        signature::UnparsedPublicKey::new(
            &signature::ECDSA_P256_SHA256_FIXED,
            B64.decode(key).unwrap(),
        )
        .verify(unsigned.as_bytes(), &B64.decode(signature).unwrap())
        .expect("подпись VAPID проверяется открытым ключом");
    }

    #[test]
    fn only_known_push_services() {
        let (private, _) = generate_keys().unwrap();
        let mut push = WebPush::new(&private, "mailto:a@b.c").unwrap();
        assert!(push.endpoint_allowed("https://fcm.googleapis.com/fcm/send/x"));
        assert!(push.endpoint_allowed("https://updates.push.services.mozilla.com/wpush/v2/x"));
        assert!(push.endpoint_allowed("https://wns2-db5p.notify.windows.com/w/?token=x"));
        assert!(push.endpoint_allowed("https://web.push.apple.com/abc"));
        assert!(!push.endpoint_allowed("https://169.254.169.254/latest"));
        assert!(!push.endpoint_allowed("https://evil.com/fcm.googleapis.com"));
        assert!(!push.endpoint_allowed("https://fcm.googleapis.com.evil.com/x"));
        assert!(!push.endpoint_allowed("http://127.0.0.1:9/x"));
        push.allow_loopback = true;
        assert!(push.endpoint_allowed("http://127.0.0.1:9/x"));
        assert!(WebPush::new("не ключ", "mailto:a@b.c").is_err());
    }
}
