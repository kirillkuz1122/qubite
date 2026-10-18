//! Проверка CAPTCHA (AUTH-003): Cloudflare Turnstile и Yandex SmartCaptcha.
//!
//! Сайт показывает виджет выбранного провайдера и присылает его токен вместе
//! с формой. Сервер отправляет токен провайдеру и узнаёт, человек ли это.
//! Какой провайдер включён — решает owner (настройка платформы `captcha.provider`),
//! ключи лежат только в переменных окружения сервера (D-187).

use std::{fmt, str::FromStr, sync::Arc, time::Duration};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};
use qubite_kernel::Secret;
use serde::Deserialize;

pub const TURNSTILE_VERIFY_URL: &str = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
pub const SMARTCAPTCHA_VERIFY_URL: &str = "https://smartcaptcha.yandexcloud.net/validate";

/// Токены длиннее этого провайдеры не выдают — не отправляем мусор.
const MAX_TOKEN_LEN: usize = 4096;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("неизвестный провайдер CAPTCHA «{0}»: ожидается turnstile или smartcaptcha")]
    UnknownProvider(String),
    #[error("у CAPTCHA {0} нет ключей на сервере")]
    NotConfigured(Provider),
    #[error("сервис CAPTCHA недоступен: {0}")]
    Unavailable(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Провайдер CAPTCHA.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Provider {
    /// Cloudflare Turnstile (был в старом Qubite).
    Turnstile,
    /// Yandex SmartCaptcha.
    SmartCaptcha,
}

impl Provider {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Turnstile => "turnstile",
            Self::SmartCaptcha => "smartcaptcha",
        }
    }
}

impl fmt::Display for Provider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for Provider {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "turnstile" => Ok(Self::Turnstile),
            "smartcaptcha" | "yandex" => Ok(Self::SmartCaptcha),
            other => Err(Error::UnknownProvider(other.to_owned())),
        }
    }
}

/// Пара ключей провайдера: открытый (для виджета на сайте) и секретный.
#[derive(Debug, Clone)]
pub struct Keys {
    pub site_key: String,
    pub secret: Secret,
}

impl Keys {
    /// Ключи из двух строк; пустые — `None`.
    pub fn from_parts(site_key: Option<String>, secret: Option<String>) -> Option<Self> {
        let site_key = site_key.filter(|key| !key.trim().is_empty())?;
        let secret = secret.filter(|key| !key.trim().is_empty())?;
        Some(Self {
            site_key,
            secret: Secret::new(secret),
        })
    }
}

#[derive(Debug, Clone)]
pub struct CaptchaConfig {
    pub turnstile: Option<Keys>,
    pub smartcaptcha: Option<Keys>,
    /// Адреса проверки (меняются только в тестах).
    pub turnstile_url: String,
    pub smartcaptcha_url: String,
    pub timeout: Duration,
}

impl Default for CaptchaConfig {
    fn default() -> Self {
        Self {
            turnstile: None,
            smartcaptcha: None,
            turnstile_url: TURNSTILE_VERIFY_URL.into(),
            smartcaptcha_url: SMARTCAPTCHA_VERIFY_URL.into(),
            timeout: Duration::from_secs(10),
        }
    }
}

/// Проверяет токены CAPTCHA. Дёшево клонируется.
#[derive(Clone)]
pub struct Captcha {
    client: Client<hyper_rustls::HttpsConnector<HttpConnector>, Full<Bytes>>,
    config: Arc<CaptchaConfig>,
}

#[derive(Deserialize)]
struct TurnstileReply {
    success: bool,
}

#[derive(Deserialize)]
struct SmartCaptchaReply {
    status: String,
}

impl Captcha {
    pub fn new(config: CaptchaConfig) -> Self {
        // TLS — ring, задан явно (как в qubite-mail).
        let https = hyper_rustls::HttpsConnectorBuilder::new()
            .with_provider_and_webpki_roots(rustls::crypto::ring::default_provider())
            .expect("встроенные корневые сертификаты и ring всегда подходят")
            .https_or_http()
            .enable_http1()
            .build();
        Self {
            client: Client::builder(TokioExecutor::new()).build(https),
            config: Arc::new(config),
        }
    }

    fn keys(&self, provider: Provider) -> Option<&Keys> {
        match provider {
            Provider::Turnstile => self.config.turnstile.as_ref(),
            Provider::SmartCaptcha => self.config.smartcaptcha.as_ref(),
        }
    }

    /// Открытый ключ для виджета на сайте; `None` — у провайдера нет ключей.
    pub fn site_key(&self, provider: Provider) -> Option<&str> {
        self.keys(provider).map(|keys| keys.site_key.as_str())
    }

    /// Человек ли прислал токен. `Ok(false)` — провайдер сказал «нет» или
    /// токена нет; `Err` — проверить не удалось (тогда регистрацию не пускаем).
    pub async fn verify(&self, provider: Provider, token: &str, ip: &str) -> Result<bool> {
        let keys = self.keys(provider).ok_or(Error::NotConfigured(provider))?;
        let token = token.trim();
        if token.is_empty() || token.len() > MAX_TOKEN_LEN {
            return Ok(false);
        }
        let (url, content_type, body) = match provider {
            Provider::Turnstile => {
                let mut body = serde_json::json!({
                    "secret": keys.secret.expose(),
                    "response": token,
                });
                if !ip.is_empty() {
                    body["remoteip"] = serde_json::json!(ip);
                }
                (
                    &self.config.turnstile_url,
                    "application/json",
                    serde_json::to_vec(&body).expect("JSON всегда сериализуется"),
                )
            }
            Provider::SmartCaptcha => {
                let mut form = form_urlencoded::Serializer::new(String::new());
                form.append_pair("secret", keys.secret.expose());
                form.append_pair("token", token);
                if !ip.is_empty() {
                    form.append_pair("ip", ip);
                }
                (
                    &self.config.smartcaptcha_url,
                    "application/x-www-form-urlencoded",
                    form.finish().into_bytes(),
                )
            }
        };
        let request = http::Request::post(url.as_str())
            .header(http::header::CONTENT_TYPE, content_type)
            .body(Full::new(Bytes::from(body)))
            .map_err(|error| Error::Unavailable(format!("адрес проверки: {error}")))?;
        let exchange = async {
            let response = self
                .client
                .request(request)
                .await
                .map_err(|error| Error::Unavailable(error.to_string()))?;
            let status = response.status();
            let body = response
                .into_body()
                .collect()
                .await
                .map_err(|error| Error::Unavailable(error.to_string()))?
                .to_bytes();
            Ok::<_, Error>((status, body))
        };
        let (status, body) = tokio::time::timeout(self.config.timeout, exchange)
            .await
            .map_err(|_| Error::Unavailable("не ответил вовремя".into()))??;
        if !status.is_success() {
            return Err(Error::Unavailable(format!("{provider} ответил {status}")));
        }
        let human = match provider {
            Provider::Turnstile => {
                serde_json::from_slice::<TurnstileReply>(&body).map(|reply| reply.success)
            }
            Provider::SmartCaptcha => {
                serde_json::from_slice::<SmartCaptchaReply>(&body).map(|reply| reply.status == "ok")
            }
        }
        .map_err(|error| Error::Unavailable(format!("непонятный ответ {provider}: {error}")))?;
        Ok(human)
    }
}
