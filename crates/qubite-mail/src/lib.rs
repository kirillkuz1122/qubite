//! Письма Qubite (AUTH-002): шаблоны в стиле Qubite и отправка.
//!
//! Способ отправки выбирается настройкой `QUBITE_EMAIL_MODE`:
//! - `mock` (по умолчанию в разработке и тестах) — письма никуда не уходят,
//!   а складываются в [`MockOutbox`] (и в лог в режиме разработки);
//! - `resend` — через HTTP API Resend (ключ `QUBITE_RESEND_API_KEY`);
//! - `smtp` — обычный SMTP-сервер (`QUBITE_SMTP_URL`, например
//!   `smtps://user:pass@smtp.yandex.ru:465`).
//!
//! Отправитель по умолчанию — `Qubite <no-reply@qubiteapp.ru>` (D-186).

pub mod templates;

use std::{
    str::FromStr,
    sync::{Arc, Mutex},
    time::Duration,
};

use bytes::Bytes;
use http_body_util::{BodyExt, Full};
use hyper_util::{
    client::legacy::{Client, connect::HttpConnector},
    rt::TokioExecutor,
};
use lettre::{
    AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor,
    message::{Mailbox, MultiPart},
};
use qubite_kernel::Secret;

pub use templates::Letter;

/// Отправитель по умолчанию.
pub const DEFAULT_FROM: &str = "Qubite <no-reply@qubiteapp.ru>";
/// Адрес API Resend.
pub const RESEND_API_URL: &str = "https://api.resend.com/emails";

/// Готовое письмо: кому, тема, HTML и обычный текст (для почты без HTML).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Email {
    pub to: String,
    pub subject: String,
    pub html: String,
    pub text: String,
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("неверные настройки почты: {0}")]
    Config(String),
    #[error("неверный адрес почты: {0}")]
    Address(String),
    #[error("не удалось отправить письмо: {0}")]
    Send(String),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Способ отправки.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Mode {
    Mock,
    Resend,
    Smtp,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mock => "mock",
            Self::Resend => "resend",
            Self::Smtp => "smtp",
        }
    }
}

impl FromStr for Mode {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "mock" | "" => Ok(Self::Mock),
            "resend" => Ok(Self::Resend),
            "smtp" => Ok(Self::Smtp),
            other => Err(Error::Config(format!(
                "неизвестный способ отправки «{other}»: ожидается mock, resend или smtp"
            ))),
        }
    }
}

/// Настройки почты.
#[derive(Debug, Clone)]
pub struct MailConfig {
    pub mode: Mode,
    /// Отправитель, например `Qubite <no-reply@qubiteapp.ru>`.
    pub from: String,
    /// Куда отвечать (необязательно).
    pub reply_to: Option<String>,
    pub resend_api_key: Option<Secret>,
    /// Адрес API Resend (меняется только в тестах).
    pub resend_api_url: String,
    /// `smtp://` (STARTTLS, порт 587) или `smtps://` (TLS, порт 465) с логином и паролем.
    pub smtp_url: Option<Secret>,
    /// Сколько ждать почтовый сервис.
    pub timeout: Duration,
    /// mock: писать текст письма (с кодами) в лог. Только для разработки.
    pub log_contents: bool,
}

impl Default for MailConfig {
    fn default() -> Self {
        Self {
            mode: Mode::Mock,
            from: DEFAULT_FROM.into(),
            reply_to: None,
            resend_api_key: None,
            resend_api_url: RESEND_API_URL.into(),
            smtp_url: None,
            timeout: Duration::from_secs(15),
            log_contents: false,
        }
    }
}

/// Отправляет письма выбранным способом. Дёшево клонируется.
#[derive(Clone)]
pub struct Mailer {
    transport: Arc<Transport>,
    from: Mailbox,
    reply_to: Option<Mailbox>,
}

enum Transport {
    Mock {
        outbox: MockOutbox,
        log_contents: bool,
    },
    Resend {
        client: Client<hyper_rustls::HttpsConnector<HttpConnector>, Full<Bytes>>,
        api_key: Secret,
        url: http::Uri,
        timeout: Duration,
    },
    Smtp(AsyncSmtpTransport<Tokio1Executor>),
}

fn mailbox(raw: &str) -> Result<Mailbox> {
    // Разбор lettre отклоняет переводы строк — подставить свои заголовки нельзя.
    raw.trim()
        .parse::<Mailbox>()
        .map_err(|error| Error::Address(format!("«{raw}»: {error}")))
}

impl Mailer {
    /// Почта по настройкам. Ошибка — если не хватает ключа или адреса.
    pub fn new(config: &MailConfig) -> Result<Self> {
        let transport = match config.mode {
            Mode::Mock => Transport::Mock {
                outbox: MockOutbox::default(),
                log_contents: config.log_contents,
            },
            Mode::Resend => {
                let api_key = config
                    .resend_api_key
                    .clone()
                    .filter(|key| !key.expose().trim().is_empty())
                    .ok_or_else(|| {
                        Error::Config("для resend нужен QUBITE_RESEND_API_KEY".into())
                    })?;
                let url = config
                    .resend_api_url
                    .parse::<http::Uri>()
                    .map_err(|error| Error::Config(format!("адрес Resend: {error}")))?;
                // Криптография TLS — ring (та же, что у SMTP); задана явно, без
                // общего «провайдера по умолчанию», который мешал бы другим
                // HTTP-клиентам в программе.
                let https = hyper_rustls::HttpsConnectorBuilder::new()
                    .with_provider_and_webpki_roots(rustls::crypto::ring::default_provider())
                    .map_err(|error| Error::Config(format!("TLS: {error}")))?
                    .https_or_http()
                    .enable_http1()
                    .build();
                Transport::Resend {
                    client: Client::builder(TokioExecutor::new()).build(https),
                    api_key,
                    url,
                    timeout: config.timeout,
                }
            }
            Mode::Smtp => {
                let url = config
                    .smtp_url
                    .as_ref()
                    .filter(|url| !url.expose().trim().is_empty())
                    .ok_or_else(|| Error::Config("для smtp нужен QUBITE_SMTP_URL".into()))?;
                let transport = AsyncSmtpTransport::<Tokio1Executor>::from_url(url.expose())
                    // В тексте ошибки lettre может быть адрес с паролем — не показываем.
                    .map_err(|_| Error::Config("неверный QUBITE_SMTP_URL".into()))?
                    .timeout(Some(config.timeout))
                    .build();
                Transport::Smtp(transport)
            }
        };
        Ok(Self {
            transport: Arc::new(transport),
            from: mailbox(&config.from)?,
            reply_to: config
                .reply_to
                .as_deref()
                .filter(|value| !value.trim().is_empty())
                .map(mailbox)
                .transpose()?,
        })
    }

    /// mock-почта и её ящик (для тестов).
    pub fn mock() -> (Self, MockOutbox) {
        let mailer = Self::new(&MailConfig::default()).expect("настройки mock всегда верные");
        let outbox = mailer.outbox().expect("это mock").clone();
        (mailer, outbox)
    }

    pub fn mode(&self) -> Mode {
        match &*self.transport {
            Transport::Mock { .. } => Mode::Mock,
            Transport::Resend { .. } => Mode::Resend,
            Transport::Smtp(_) => Mode::Smtp,
        }
    }

    /// Ящик mock-почты; у настоящих способов — `None`.
    pub fn outbox(&self) -> Option<&MockOutbox> {
        match &*self.transport {
            Transport::Mock { outbox, .. } => Some(outbox),
            _ => None,
        }
    }

    /// Отправить письмо. Повторы при сбое — забота вызывающего.
    pub async fn send(&self, email: &Email) -> Result<()> {
        let to = mailbox(&email.to)?;
        match &*self.transport {
            Transport::Mock {
                outbox,
                log_contents,
            } => {
                if *log_contents {
                    tracing::info!(to = %email.to, subject = %email.subject, text = %email.text,
                        "письмо (mock): никуда не отправлено");
                } else {
                    tracing::info!(subject = %email.subject, "письмо (mock): никуда не отправлено");
                }
                outbox.push(email.clone());
                Ok(())
            }
            Transport::Resend {
                client,
                api_key,
                url,
                timeout,
            } => {
                let mut body = serde_json::json!({
                    "from": self.from.to_string(),
                    "to": [to.to_string()],
                    "subject": email.subject,
                    "html": email.html,
                    "text": email.text,
                });
                if let Some(reply_to) = &self.reply_to {
                    body["reply_to"] = serde_json::json!(reply_to.to_string());
                }
                let body = serde_json::to_vec(&body)
                    .map_err(|error| Error::Send(format!("письмо не собрано: {error}")))?;
                let request = http::Request::post(url.clone())
                    .header(
                        http::header::AUTHORIZATION,
                        format!("Bearer {}", api_key.expose()),
                    )
                    .header(http::header::CONTENT_TYPE, "application/json")
                    .body(Full::new(Bytes::from(body)))
                    .map_err(|_| Error::Config("неверный ключ Resend".into()))?;
                let exchange = async {
                    let response = client
                        .request(request)
                        .await
                        .map_err(|error| Error::Send(format!("Resend недоступен: {error}")))?;
                    let status = response.status();
                    let body = response
                        .into_body()
                        .collect()
                        .await
                        .map(|body| body.to_bytes())
                        .unwrap_or_default();
                    Ok::<_, Error>((status, body))
                };
                let (status, body) = tokio::time::timeout(*timeout, exchange)
                    .await
                    .map_err(|_| Error::Send("Resend не ответил вовремя".into()))??;
                if status.is_success() {
                    return Ok(());
                }
                let text: String = String::from_utf8_lossy(&body).chars().take(300).collect();
                Err(Error::Send(format!("Resend ответил {status}: {text}")))
            }
            Transport::Smtp(transport) => {
                let mut builder = Message::builder()
                    .from(self.from.clone())
                    .to(to)
                    .subject(email.subject.clone());
                if let Some(reply_to) = &self.reply_to {
                    builder = builder.reply_to(reply_to.clone());
                }
                let message = builder
                    .multipart(MultiPart::alternative_plain_html(
                        email.text.clone(),
                        email.html.clone(),
                    ))
                    .map_err(|error| Error::Send(format!("письмо не собрано: {error}")))?;
                transport
                    .send(message)
                    .await
                    .map_err(|error| Error::Send(format!("SMTP: {error}")))?;
                Ok(())
            }
        }
    }
}

/// Ящик mock-почты: все «отправленные» письма.
#[derive(Clone, Default)]
pub struct MockOutbox {
    messages: Arc<Mutex<Vec<Email>>>,
}

impl MockOutbox {
    fn push(&self, email: Email) {
        self.messages
            .lock()
            .expect("ящик mock-почты не отравлен")
            .push(email);
    }

    /// Все письма по порядку.
    pub fn all(&self) -> Vec<Email> {
        self.messages
            .lock()
            .expect("ящик mock-почты не отравлен")
            .clone()
    }

    /// Письма на этот адрес (регистр не важен).
    pub fn to(&self, address: &str) -> Vec<Email> {
        self.all()
            .into_iter()
            .filter(|email| email.to.eq_ignore_ascii_case(address.trim()))
            .collect()
    }

    /// Подождать, пока на адрес придёт `count` писем (отправка идёт в фоне).
    /// Возвращает все письма на адрес — их может быть меньше, если не дождались.
    pub async fn wait_for(&self, address: &str, count: usize, timeout: Duration) -> Vec<Email> {
        let deadline = tokio::time::Instant::now() + timeout;
        loop {
            let found = self.to(address);
            if found.len() >= count || tokio::time::Instant::now() >= deadline {
                return found;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    }
}
