//! Вход через внешних провайдеров (AUTH-004): Яндекс ID, VK ID, Google,
//! Telegram.
//!
//! Главные правила (D-060, D-195):
//! - вход — **только по сохранённому ID у провайдера**; совпадение почты
//!   ничего не объединяет и не даёт входа;
//! - привязать провайдера можно только из открытого аккаунта, подтвердив
//!   пароль; отвязать — тоже с паролем;
//! - Яндекс и VK включены по умолчанию, Google и Telegram — выключены
//!   (D-194). Выключенный провайдер отклоняет и новый, и уже начатый вход;
//! - Яндекс, VK, Google — OAuth 2.0 «код + PKCE»: браузер уходит к
//!   провайдеру, возвращается с кодом, сервер меняет код на токен и узнаёт ID.
//!   Начатый вход привязан к браузеру cookie с секретом `state`, одноразовый,
//!   живёт 10 минут;
//! - Telegram — виджет входа: данные подписаны ботом (HMAC-SHA256), сервер
//!   проверяет подпись, свежесть и одноразовость.
//!
//! Неизвестный ID — регистрация по режиму платформы (D-189): открыта — аккаунт
//! создаётся сразу (нужна почта от провайдера, занятая почта аккаунты не
//! объединяет); «по приглашениям» — только с приглашением; закрыта — отказ
//! `oauth_not_linked`.

mod providers;
mod store;

use std::{collections::HashMap, fmt, str::FromStr, sync::RwLock, time::Duration};

pub use providers::Identity;
pub use store::{LinkedIdentity, Signup, identities, link, login, return_to, unlink};

/// Провайдер входа. Имена общие для всего проекта (тумблеры ACC-002 тоже).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Yandex,
    Vk,
    Google,
    Telegram,
}

impl Provider {
    pub const ALL: [Self; 4] = [Self::Yandex, Self::Vk, Self::Google, Self::Telegram];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Yandex => "yandex",
            Self::Vk => "vk",
            Self::Google => "google",
            Self::Telegram => "telegram",
        }
    }

    /// Вход через переход на сайт провайдера (а не виджет).
    pub fn is_redirect(self) -> bool {
        !matches!(self, Self::Telegram)
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
        Self::ALL
            .into_iter()
            .find(|provider| provider.as_str() == value)
            .ok_or(Error::UnknownProvider)
    }
}

// ---------------------------------------------------------------- настройки

/// Приложение Qubite у провайдера с переходом (Яндекс, VK, Google).
#[derive(Clone)]
pub struct RedirectProvider {
    /// Включён ли способ входа (стартовое значение; меняется на ходу).
    pub enabled: bool,
    pub client_id: String,
    pub client_secret: String,
    pub authorize_url: String,
    pub token_url: String,
    pub userinfo_url: String,
    pub scope: String,
}

impl fmt::Debug for RedirectProvider {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RedirectProvider")
            .field("enabled", &self.enabled)
            .field("client_id", &self.client_id)
            .field("client_secret", &"***")
            .field("authorize_url", &self.authorize_url)
            .finish_non_exhaustive()
    }
}

impl RedirectProvider {
    /// Яндекс ID (oauth.yandex.ru). Включён по умолчанию.
    pub fn yandex(client_id: impl Into<String>, client_secret: impl Into<String>) -> Self {
        Self {
            enabled: true,
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            authorize_url: "https://oauth.yandex.ru/authorize".into(),
            token_url: "https://oauth.yandex.ru/token".into(),
            userinfo_url: "https://login.yandex.ru/info".into(),
            scope: "login:info login:email".into(),
        }
    }

    /// VK ID (id.vk.com, OAuth 2.1 с PKCE). Включён по умолчанию.
    pub fn vk(client_id: impl Into<String>, client_secret: impl Into<String>) -> Self {
        Self {
            enabled: true,
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            authorize_url: "https://id.vk.com/authorize".into(),
            token_url: "https://id.vk.com/oauth2/auth".into(),
            userinfo_url: "https://id.vk.com/oauth2/user_info".into(),
            scope: "vkid.personal_info email".into(),
        }
    }

    /// Google (OpenID Connect). **Выключен по умолчанию** (D-194).
    pub fn google(client_id: impl Into<String>, client_secret: impl Into<String>) -> Self {
        Self {
            enabled: false,
            client_id: client_id.into(),
            client_secret: client_secret.into(),
            authorize_url: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            token_url: "https://oauth2.googleapis.com/token".into(),
            userinfo_url: "https://openidconnect.googleapis.com/v1/userinfo".into(),
            scope: "openid email profile".into(),
        }
    }

    fn configured(&self) -> bool {
        !self.client_id.is_empty()
    }
}

/// Вход через Telegram (виджет на сайте, подпись токеном бота).
#[derive(Clone)]
pub struct TelegramLogin {
    /// **Выключен по умолчанию** (D-194).
    pub enabled: bool,
    /// Имя бота для виджета (без `@`).
    pub bot_name: String,
    pub bot_token: String,
    /// Сколько живут подписанные данные виджета.
    pub max_age: Duration,
}

impl fmt::Debug for TelegramLogin {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("TelegramLogin")
            .field("enabled", &self.enabled)
            .field("bot_name", &self.bot_name)
            .field("bot_token", &"***")
            .finish_non_exhaustive()
    }
}

impl Default for TelegramLogin {
    fn default() -> Self {
        Self {
            enabled: false,
            bot_name: String::new(),
            bot_token: String::new(),
            max_age: Duration::from_secs(10 * 60),
        }
    }
}

/// Все настройки входа через провайдеров.
#[derive(Debug, Clone)]
pub struct OAuthSettings {
    /// Публичный адрес сайта (`https://qubite.ru`) — из него адрес возврата
    /// `…/api/auth/oauth/<провайдер>/callback`, его же регистрируют у провайдера.
    pub public_url: String,
    pub yandex: RedirectProvider,
    pub vk: RedirectProvider,
    pub google: RedirectProvider,
    pub telegram: TelegramLogin,
    /// Сколько живёт начатый вход.
    pub flow_ttl: Duration,
}

impl Default for OAuthSettings {
    fn default() -> Self {
        Self {
            public_url: "http://localhost:5173".into(),
            yandex: RedirectProvider::yandex("", ""),
            vk: RedirectProvider::vk("", ""),
            google: RedirectProvider::google("", ""),
            telegram: TelegramLogin::default(),
            flow_ttl: Duration::from_secs(10 * 60),
        }
    }
}

/// Ошибки входа через провайдера. У каждой — код для адреса `/auth?error=…`.
#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("такого способа входа нет")]
    UnknownProvider,
    #[error("этот способ входа выключен")]
    ProviderDisabled,
    #[error("вход устарел или начат в другом браузере — начните заново")]
    InvalidState,
    #[error("провайдер не подтвердил вход: {0}")]
    Provider(String),
    #[error("этот аккаунт провайдера не привязан ни к одному аккаунту Qubite")]
    NotLinked,
    #[error("этот аккаунт провайдера уже привязан к другому аккаунту Qubite")]
    Taken,
    #[error("к аккаунту уже привязан другой аккаунт этого провайдера — сначала отвяжите его")]
    AlreadyLinked,
    #[error("неверные данные: {0}")]
    Invalid(String),
    /// Регистрация через провайдера, но он не сообщил почту.
    #[error("провайдер не сообщил почту — зарегистрируйтесь по почте и привяжите его в профиле")]
    EmailRequired,
    /// Регистрация через провайдера, а аккаунт с этой почтой уже есть (D-060).
    #[error("аккаунт с этой почтой уже есть — войдите и привяжите провайдера в профиле")]
    EmailTaken,
    #[error(transparent)]
    Auth(#[from] qubite_auth::Error),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка аудита: {0}")]
    Audit(#[from] qubite_objects::Error),
}

impl Error {
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownProvider => "oauth_unknown_provider",
            Self::ProviderDisabled => "oauth_provider_disabled",
            Self::InvalidState => "oauth_invalid_state",
            Self::Provider(_) => "oauth_provider_error",
            Self::NotLinked => "oauth_not_linked",
            Self::Taken => "oauth_taken",
            Self::AlreadyLinked => "oauth_already_linked",
            Self::Invalid(_) => "oauth_invalid",
            Self::EmailRequired => "oauth_email_required",
            Self::EmailTaken => "oauth_email_taken",
            Self::Auth(qubite_auth::Error::InviteRequired) => "invite_required",
            Self::Auth(qubite_auth::Error::InvalidInvite) => "invalid_invite",
            Self::Auth(qubite_auth::Error::ConsentRequired) => "consent_required",
            Self::Auth(qubite_auth::Error::AccountBlocked) => "account_blocked",
            Self::Auth(qubite_auth::Error::InvalidCredentials) => "invalid_credentials",
            Self::Auth(qubite_auth::Error::TooManyAttempts { .. }) => "too_many_attempts",
            Self::Auth(qubite_auth::Error::LoginDisabled) => "login_disabled",
            Self::Auth(qubite_auth::Error::Maintenance(_)) => "maintenance",
            Self::Auth(_) | Self::Db(_) | Self::Audit(_) => "internal",
        }
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

// ---------------------------------------------------------------- входы

/// Что человек хочет: войти или привязать провайдера к своему аккаунту.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intent {
    Login {
        return_to: String,
        /// Хеш кода приглашения — для регистрации через провайдера, когда
        /// регистрация «по приглашениям» (D-189).
        invite_hash: Option<Vec<u8>>,
        /// Версия документов, принятых галочкой на странице регистрации (D-230).
        /// Без неё вход через провайдера аккаунт не создаёт.
        consent_version: Option<String>,
    },
    Link {
        account_id: uuid::Uuid,
        session_id: uuid::Uuid,
    },
}

/// Вход начат: браузер получает `state` в cookie и уходит по адресу.
#[derive(Debug, Clone)]
pub struct Started {
    pub state: String,
    pub authorize_url: String,
}

/// Провайдер вернул человека: кто он и что хотел.
#[derive(Debug, Clone)]
pub struct Finished {
    pub provider: Provider,
    pub intent: Intent,
    pub identity: Identity,
}

/// Что пришло в адресе возврата.
#[derive(Debug, Clone, Default, serde::Deserialize)]
pub struct Callback {
    pub code: Option<String>,
    pub state: Option<String>,
    /// VK ID присылает ID устройства — его нужно вернуть при обмене кода.
    pub device_id: Option<String>,
    /// Человек нажал «Отмена» у провайдера.
    pub error: Option<String>,
}

/// Вход через провайдеров: настройки, тумблеры и HTTP-клиент.
pub struct OAuth {
    settings: OAuthSettings,
    enabled: RwLock<HashMap<Provider, bool>>,
    http: reqwest::Client,
}

impl OAuth {
    pub fn new(settings: OAuthSettings) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP-клиент собирается с настройками по умолчанию");
        let enabled = HashMap::from([
            (Provider::Yandex, settings.yandex.enabled),
            (Provider::Vk, settings.vk.enabled),
            (Provider::Google, settings.google.enabled),
            (Provider::Telegram, settings.telegram.enabled),
        ]);
        Self {
            settings,
            enabled: RwLock::new(enabled),
            http,
        }
    }

    pub fn settings(&self) -> &OAuthSettings {
        &self.settings
    }

    /// Включить или выключить способ входа на ходу (тумблер владельца).
    pub fn set_enabled(&self, provider: Provider, enabled: bool) {
        self.enabled
            .write()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .insert(provider, enabled);
    }

    /// Можно ли сейчас войти: включён и настроен (есть приложение у провайдера).
    pub fn is_available(&self, provider: Provider) -> bool {
        let enabled = self
            .enabled
            .read()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .get(&provider)
            .copied()
            .unwrap_or(false);
        enabled
            && match provider {
                Provider::Telegram => !self.settings.telegram.bot_token.is_empty(),
                other => self
                    .redirect_config(other)
                    .is_some_and(RedirectProvider::configured),
            }
    }

    /// Доступные способы входа (для экрана входа).
    pub fn available(&self) -> Vec<Provider> {
        Provider::ALL
            .into_iter()
            .filter(|provider| self.is_available(*provider))
            .collect()
    }

    fn redirect_config(&self, provider: Provider) -> Option<&RedirectProvider> {
        match provider {
            Provider::Yandex => Some(&self.settings.yandex),
            Provider::Vk => Some(&self.settings.vk),
            Provider::Google => Some(&self.settings.google),
            Provider::Telegram => None,
        }
    }

    fn require(&self, provider: Provider) -> Result<&RedirectProvider> {
        let config = self
            .redirect_config(provider)
            .ok_or(Error::UnknownProvider)?;
        if !self.is_available(provider) {
            return Err(Error::ProviderDisabled);
        }
        Ok(config)
    }

    /// Адрес возврата, зарегистрированный у провайдера.
    pub fn redirect_uri(&self, provider: Provider) -> String {
        format!(
            "{}/api/auth/oauth/{provider}/callback",
            self.settings.public_url.trim_end_matches('/')
        )
    }

    /// Начать вход: запомнить `state` и секрет PKCE, вернуть адрес провайдера.
    pub async fn start(
        &self,
        pool: &sqlx::PgPool,
        provider: Provider,
        intent: Intent,
    ) -> Result<Started> {
        let config = self.require(provider)?;
        let (state, verifier) =
            store::create_flow(pool, provider, &intent, self.settings.flow_ttl).await?;
        let authorize_url =
            providers::authorize_url(config, &self.redirect_uri(provider), &state, &verifier)?;
        Ok(Started {
            state,
            authorize_url,
        })
    }

    /// Провайдер вернул человека. `browser_state` — секрет из cookie этого
    /// браузера: без него (или с чужим) вход не продолжится.
    pub async fn finish(
        &self,
        pool: &sqlx::PgPool,
        provider: Provider,
        browser_state: Option<&str>,
        callback: &Callback,
    ) -> Result<Finished> {
        let state = callback.state.as_deref().ok_or(Error::InvalidState)?;
        if browser_state != Some(state) {
            return Err(Error::InvalidState);
        }
        // Одноразовость: вход «сгорает» сразу, даже если дальше что-то не так.
        let flow = store::take_flow(pool, provider, state).await?;
        // Владелец мог выключить способ входа, пока человек был у провайдера.
        let config = self.require(provider)?;
        if let Some(error) = &callback.error {
            return Err(Error::Provider(format!("отказ: {error}")));
        }
        let code = callback
            .code
            .as_deref()
            .ok_or_else(|| Error::Provider("нет кода".into()))?;
        let identity = providers::exchange(
            &self.http,
            provider,
            config,
            &self.redirect_uri(provider),
            code,
            &flow.code_verifier,
            state,
            callback.device_id.as_deref(),
        )
        .await?;
        Ok(Finished {
            provider,
            intent: flow.intent,
            identity,
        })
    }

    /// Проверить данные виджета Telegram (подпись, свежесть, одноразовость).
    pub async fn verify_telegram(
        &self,
        pool: &sqlx::PgPool,
        data: &std::collections::BTreeMap<String, String>,
    ) -> Result<Identity> {
        if !self.is_available(Provider::Telegram) {
            return Err(Error::ProviderDisabled);
        }
        let (identity, digest) = providers::verify_telegram(&self.settings.telegram, data)?;
        store::mark_seen(pool, &digest).await?;
        Ok(identity)
    }
}
