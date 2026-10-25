//! AI-шлюз Qubite (AI-001, AI-002): **ни один цент без разрешения**.
//!
//! Путь вызова ([AI_COST_GUARD](../../docs/architecture/AI_COST_GUARD.md)):
//! 1. Policy Gate — на вход нужен `&Authorized<UseAi>` (грант `ai` в модуле);
//! 2. модель в allowlist и не заблокирована, провайдер включён;
//! 3. резерв худшей стоимости по всем лимитам в одной транзакции;
//! 4. отметка «отправляется» сохраняется **до** вызова провайдера;
//! 5. ответ → списание факта и возврат остатка; «точно не ушёл» → возврат и
//!    повтор (до 3 попыток, перед каждой — права и бюджет заново);
//!    «неизвестно» или таймаут → резерв удерживается; отказ провайдера без
//!    смысла повторять (нет денег, неверный ключ) → возврат без повтора.
//!
//! Инструкции и недоверенные данные собирает [`guard`] (защита от prompt
//! injection); настоящий провайдер — [`openrouter`], цены — [`catalog`].
//!
//! Без личного денежного лимита AI запрещён: бюджет по умолчанию — ноль (D-173);
//! исключение — осознанно включённый режим «owner без личного лимита» (D-200).
//! Текст запроса и ответа в журнал расходов не пишется.

pub mod admin;
pub mod budget;
pub mod catalog;
pub mod chatgpt;
pub mod elevenlabs;
pub mod guard;
pub mod openrouter;
pub mod provider;
pub mod realtime;
pub mod secret;
pub mod voice;

use std::{
    collections::HashMap,
    sync::{Arc, RwLock},
    time::Duration,
};

use qubite_policy::{Authorized, DenyReason, UseAi};
use serde::Serialize;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

pub use budget::{PeriodKeys, Reservation};

/// «Назначение» шифрования ключа: ключ одного человека не подставить другому.
pub fn key_purpose(account_id: Option<Uuid>) -> String {
    match account_id {
        Some(id) => format!("ai.key.openrouter.{id}"),
        None => "ai.key.openrouter.platform".into(),
    }
}
pub use guard::Untrusted;
pub use provider::{
    ChatMessage, Delta, MockProvider, MockStep, Provider, ProviderCall, ProviderError,
    ProviderReply, Role, Routing,
};
pub use realtime::{
    MockRealtime, MockRealtimeStep, RealtimeLimits, RealtimeProvider, RealtimeRequest,
    RealtimeSession,
};
pub use voice::{
    ListenRequest, MockHeard, MockVoice, SpeakRequest, Speech, Transcript, VoiceProvider,
};

/// Микродоллары: 1 $ = 1 000 000.
pub const MICROS_PER_USD: i64 = 1_000_000;

/// Потолок вызовов в одном ходе ([`InTurn`]): распознавание, модель и голос по
/// предложениям укладываются с большим запасом; больше — зацикливание внутри хода.
pub const TURN_CALLS: i64 = 40;

/// Ошибки и отказы шлюза. У каждого — код для программ.
#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("{}", .0.message())]
    Denied(DenyReason),
    #[error("модель не разрешена")]
    ModelNotAllowed,
    #[error("модель временно заблокирована владельцем: {0}")]
    ModelBlocked(String),
    #[error("AI-бюджет не выдан. Можно сохранить без AI или попросить владельца")]
    BudgetNotSet,
    #[error(
        "AI-лимит исчерпан ({scope}, {period}, {metric}). Можно сохранить без AI или попросить владельца"
    )]
    BudgetExhausted {
        scope: String,
        period: String,
        metric: String,
    },
    #[error(
        "в режиме «owner без личного лимита» нужен дневной потолок платформы в $ — Console → AI → «Сделать мне безлимит»"
    )]
    PlatformCapNotSet,
    #[error("слишком много AI-запросов за минуту ({scope}) — похоже на зацикливание, подождите")]
    RateLimited { scope: String },
    #[error("тот же запрос повторяется слишком часто — похоже на зацикливание, остановлено")]
    RepeatedRequest,
    #[error("для задачи «{0}» модель не выбрана (и нет модели по умолчанию)")]
    NoModelForTask(String),
    #[error("запрос с этим request_id уже был (статус {status}) — повторно не выполняется")]
    DuplicateRequest { status: String },
    #[error("провайдер недоступен{}", others(.alternatives))]
    ProviderUnavailable { alternatives: Vec<String> },
    #[error("{reason}{}", others(.alternatives))]
    SubscriptionLimit {
        reason: String,
        alternatives: Vec<String>,
    },
    #[error("провайдер отказал ({reason}){}", others(.alternatives))]
    ProviderRefused {
        reason: String,
        alternatives: Vec<String>,
    },
    #[error("результат запроса неизвестен; резерв удерживается до выяснения")]
    ResultUnknown { call_id: Uuid },
    #[error("{0}")]
    SourceNotReady(String),
    /// Свои лимиты живого разговора (сеансов или минут в день, ENG-005).
    #[error("{0}")]
    SessionLimit(String),
    #[error("неверные данные: {0}")]
    Invalid(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка аудита: {0}")]
    Audit(#[from] qubite_objects::Error),
}

impl AiError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Denied(reason) => reason.code(),
            Self::ModelNotAllowed => "model_not_allowed",
            Self::ModelBlocked(_) => "model_blocked",
            Self::BudgetNotSet => "budget_not_set",
            Self::BudgetExhausted { .. } => "budget_exhausted",
            Self::PlatformCapNotSet => "platform_cap_not_set",
            Self::RateLimited { .. } => "rate_limited",
            Self::RepeatedRequest => "repeated_request",
            Self::NoModelForTask(_) => "no_model_for_task",
            Self::DuplicateRequest { .. } => "duplicate_request",
            Self::ProviderUnavailable { .. } => "provider_unavailable",
            Self::ProviderRefused { .. } => "provider_refused",
            Self::SubscriptionLimit { .. } => "subscription_limit",
            Self::ResultUnknown { .. } => "result_unknown",
            Self::SourceNotReady(_) => "source_not_ready",
            Self::SessionLimit(_) => "realtime_limit",
            Self::Invalid(_) => "invalid",
            Self::Db(_) | Self::Audit(_) => "internal",
        }
    }
}

impl From<qubite_policy::Error> for AiError {
    fn from(error: qubite_policy::Error) -> Self {
        match error {
            qubite_policy::Error::Denied(reason) => Self::Denied(reason),
            qubite_policy::Error::Invalid(message) => Self::Invalid(message),
            qubite_policy::Error::Db(error) => Self::Db(error),
            qubite_policy::Error::Audit(error) => Self::Audit(error),
        }
    }
}

/// «; можно выбрать другую модель: …» — только когда есть из чего выбрать.
fn others(alternatives: &[String]) -> String {
    if alternatives.is_empty() {
        String::new()
    } else {
        format!("; можно выбрать другую модель: {}", alternatives.join(", "))
    }
}

pub type Result<T, E = AiError> = std::result::Result<T, E>;

/// Источник текущего времени (в тестах — подменяется, чтобы проверить полночь).
pub type Clock = Arc<dyn Fn() -> OffsetDateTime + Send + Sync>;

/// Настройки шлюза.
#[derive(Clone)]
pub struct AiConfig {
    /// Часовой пояс периодов (D-072).
    pub timezone: String,
    /// Таймаут вызова провайдера (D-075).
    pub timeout: Duration,
    /// Паузы перед повторами; попыток = паузы + 1 (D-074: 1 и 2 с, всего 3).
    pub retry_delays: Vec<Duration>,
    pub clock: Clock,
    /// Защита от зацикливания (D-213).
    pub loop_guard: LoopGuard,
    /// Свои лимиты живого разговора (ENG-005).
    pub realtime: realtime::RealtimeLimits,
}

/// Защита от зацикливания: запрос, который мог бы уйти, проверяется до резерва.
/// Ноль — проверка выключена.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoopGuard {
    /// Начатых вызовов в минуту на пользователя.
    pub user_per_minute: u32,
    /// Начатых вызовов в минуту на одну фоновую задачу.
    pub job_per_minute: u32,
    /// Сколько раз можно отправить один и тот же запрос за `repeat_window`.
    pub repeat_limit: u32,
    pub repeat_window: Duration,
}

impl Default for LoopGuard {
    fn default() -> Self {
        Self {
            user_per_minute: 20,
            job_per_minute: 10,
            repeat_limit: 3,
            repeat_window: Duration::from_secs(600),
        }
    }
}

impl AiConfig {
    /// Попыток при «точно не ушёл»: от 1 до 3 (D-074), паузы 1 и 2 с.
    pub fn with_attempts(mut self, attempts: u8) -> Self {
        let delays = [Duration::from_secs(1), Duration::from_secs(2)];
        let retries = usize::from(attempts.clamp(1, 3)) - 1;
        self.retry_delays = delays[..retries].to_vec();
        self
    }
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            timezone: "Asia/Yekaterinburg".into(),
            timeout: Duration::from_secs(60),
            retry_delays: vec![Duration::from_secs(1), Duration::from_secs(2)],
            clock: Arc::new(OffsetDateTime::now_utc),
            loop_guard: LoopGuard::default(),
            realtime: realtime::RealtimeLimits::default(),
        }
    }
}

/// Запрос модуля к AI.
#[derive(Debug, Clone)]
pub struct AiRequest {
    /// Уникален для одного действия пользователя (в пределах его аккаунта):
    /// повтор с тем же ID не выполняется и не списывается второй раз.
    pub request_id: String,
    pub model: String,
    /// Инструкции — **только из кода модуля**. Текст человека и всё внешнее
    /// сюда не вставлять: для этого `untrusted`.
    pub prompt: String,
    /// Данные: текст человека, письма, страницы. Шлюз оборачивает их так,
    /// чтобы модель не приняла их за инструкции ([`guard`]).
    pub untrusted: Vec<Untrusted>,
    /// Оценка входных токенов (сверху). Шлюз берёт большее из неё и своей
    /// оценки по размеру текста.
    pub input_tokens: u32,
    /// Потолок ответа.
    pub max_output_tokens: u32,
    /// Фоновая задача, от имени которой идёт запрос: у неё свой потолок
    /// запросов в минуту (защита от зацикливания).
    pub job_id: Option<Uuid>,
}

/// Ответ.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AiResponse {
    pub call_id: Uuid,
    pub text: String,
    pub tokens_in: u64,
    pub tokens_out: u64,
    /// Фактическая стоимость, микродоллары.
    pub cost_usd: i64,
    /// Что заметила защита от prompt injection (коды [`guard::signal`]).
    /// Ответ при этом — по-прежнему только данные для человека.
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
struct ModelRow {
    id: String,
    provider_id: String,
    external_id: String,
    price_in_per_mtok: i64,
    price_out_per_mtok: i64,
    enabled: bool,
    blocked_reason: Option<String>,
    provider_enabled: bool,
    routing_providers: Vec<String>,
    data_collection: Option<String>,
    /// `text` — модель; `stt` — распознавание речи (единица — секунда
    /// звука), `tts` — синтез речи (единица — знак текста), см. [`voice`].
    capabilities: Vec<String>,
}

/// Что выполнить у провайдера.
enum Work<'a> {
    Chat {
        guarded: &'a guard::Guarded,
        max_output_tokens: u32,
        /// Отдавать текст по кусочкам (поток модели).
        delta: Option<provider::Delta>,
    },
    /// Распознать речь.
    Listen(&'a voice::Listen),
    /// Сказать текст голосом.
    Speak(&'a voice::Say),
    /// Живое распознавание (открывается и закрывается само, [`voice::LiveListen`]).
    Live,
    /// Временный ключ живого разговора ([`realtime`]).
    Realtime(&'a realtime::Open),
}

impl Work<'_> {
    /// Подходит ли модель для этой работы: голосовые модели — только для
    /// голоса, текстовые — только для текста.
    fn fits(&self, capabilities: &[String]) -> bool {
        let has = |name: &str| capabilities.iter().any(|c| c == name);
        match self {
            Self::Chat { .. } => {
                !has(voice::STT)
                    && !has(voice::TTS)
                    && !has(voice::STT_LIVE)
                    && !has(realtime::REALTIME)
            }
            Self::Listen(_) => has(voice::STT),
            Self::Live => has(voice::STT_LIVE),
            Self::Speak(_) => has(voice::TTS),
            Self::Realtime(_) => has(realtime::REALTIME),
        }
    }
}

/// Ответ провайдера на [`Work`].
enum Done {
    Chat(ProviderReply),
    Listen(voice::Heard),
    Speak(voice::Spoken),
    SpeakStream(voice::AudioChunks),
    Realtime {
        key: realtime::RealtimeKey,
        model: String,
        calls_url: String,
    },
}

/// Сколько израсходовано: токены у моделей, секунды или знаки у голоса.
struct Usage {
    units_in: u64,
    units_out: u64,
    reported_usd: Option<i64>,
}

/// Вызов, для которого уже сделан резерв и отметка «отправляется».
struct Opened {
    id: Uuid,
    model: ModelRow,
    reservations: Vec<Reservation>,
    estimate_usd: i64,
    account_id: Uuid,
    /// Свой ключ человека (D-493); `None` — ключ платформы.
    api_key: Option<qubite_kernel::Secret>,
}

/// Кто платит за вызов (D-531): платформа (ключ owner, лимиты owner), своя
/// подписка ChatGPT или свой ключ человека — тогда денежные лимиты owner его не
/// касаются, а запросы, токены и защита от зацикливания — как у всех.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PaidBy {
    Platform,
    Subscription,
    OwnKey,
}

impl PaidBy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Platform => "platform",
            Self::Subscription => "subscription",
            Self::OwnKey => "own_key",
        }
    }
}

/// Один платный вызов для [`Gateway::run`].
struct Plan<'a> {
    request_id: &'a str,
    model: &'a str,
    fingerprint: String,
    /// Оценка входа сверху (токены, секунды или знаки).
    input_units: u64,
    max_output_units: u64,
    job_id: Option<Uuid>,
    /// Ход живого разговора ([`InTurn`]): для защиты от зацикливания — один запрос.
    turn: Option<Uuid>,
    signals: Vec<&'static str>,
    work: Work<'a>,
}

/// Стоимость в микродолларах, округлённая вверх.
pub fn cost(
    tokens_in: u64,
    tokens_out: u64,
    price_in_per_mtok: i64,
    price_out_per_mtok: i64,
) -> i64 {
    let micros = i128::from(tokens_in) * i128::from(price_in_per_mtok)
        + i128::from(tokens_out) * i128::from(price_out_per_mtok);
    let rounded = (micros + 999_999) / 1_000_000;
    i64::try_from(rounded).unwrap_or(i64::MAX)
}

/// Ход живого разговора ([`Gateway::turn`]): распознавание, ответ модели и
/// голос по предложениям — для защиты от зацикливания один запрос в минуту,
/// проверка — по первому вызову. Права, резерв и списание — по каждому вызову.
#[derive(Clone, Copy)]
pub struct InTurn<'g> {
    gateway: &'g Gateway,
    id: Uuid,
}

impl<'g> InTurn<'g> {
    /// [`Gateway::complete`] в этом ходе.
    pub async fn complete(
        &self,
        auth: &Authorized<UseAi>,
        request: AiRequest,
    ) -> Result<AiResponse> {
        self.gateway
            .answer(auth, request, None, Some(self.id))
            .await
    }

    /// [`Gateway::complete_stream`] в этом ходе.
    pub async fn complete_stream(
        &self,
        auth: &Authorized<UseAi>,
        request: AiRequest,
        delta: provider::Delta,
    ) -> Result<AiResponse> {
        self.gateway
            .answer(auth, request, Some(delta), Some(self.id))
            .await
    }
}

/// AI-шлюз. Один на процесс; провайдеры подключаются при запуске.
pub struct Gateway {
    pool: PgPool,
    config: AiConfig,
    timezone: RwLock<String>,
    providers: HashMap<String, Arc<dyn Provider>>,
    /// Голосовые адаптеры: распознавание и речь ([`voice`]).
    voices: HashMap<String, Arc<dyn voice::VoiceProvider>>,
    /// Живой разговор ([`realtime`]).
    realtimes: HashMap<String, Arc<dyn realtime::RealtimeProvider>>,
    /// Секрет процесса для «отпечатков» запросов: в базе не текст и не хеш,
    /// который можно сверить с догадкой.
    fingerprint_key: ring::hmac::Key,
    /// Ключ шифрования (`QUBITE_AI_SECRET_KEY`): свои ключи людей в базе (D-493).
    secrets: Option<Arc<secret::SecretBox>>,
}

impl Gateway {
    pub fn new(pool: PgPool, config: AiConfig) -> Self {
        let rng = ring::rand::SystemRandom::new();
        let fingerprint_key =
            ring::hmac::Key::generate(ring::hmac::HMAC_SHA256, &rng).expect("случайный ключ");
        Self {
            timezone: RwLock::new(config.timezone.clone()),
            pool,
            config,
            providers: HashMap::new(),
            voices: HashMap::new(),
            realtimes: HashMap::new(),
            fingerprint_key,
            secrets: None,
        }
    }

    /// Ключ шифрования: без него свои ключи людей не прочитать.
    pub fn with_secrets(mut self, secrets: Arc<secret::SecretBox>) -> Self {
        self.secrets = Some(secrets);
        self
    }

    /// Защита от зацикливания сейчас: что задал owner в Console (D-534),
    /// иначе — настройки сервера.
    pub async fn loop_guard_now(&self) -> Result<LoopGuard> {
        let mut conn = self.pool.acquire().await?;
        self.current_guard(&mut conn).await
    }

    /// Настройки сервера (`QUBITE_AI_*`) — то, к чему вернёт «Как в настройках».
    pub fn loop_guard_default(&self) -> &LoopGuard {
        &self.config.loop_guard
    }

    async fn current_guard(&self, conn: &mut PgConnection) -> Result<LoopGuard> {
        let row: Option<(i32, i32, i32, i32)> = sqlx::query_as(
            "SELECT user_per_minute, job_per_minute, repeat_limit, repeat_window_secs \
             FROM ai_loop_guard WHERE singleton",
        )
        .fetch_optional(&mut *conn)
        .await?;
        Ok(match row {
            Some((user, job, repeat, window)) => LoopGuard {
                user_per_minute: u32::try_from(user).unwrap_or(0),
                job_per_minute: u32::try_from(job).unwrap_or(0),
                repeat_limit: u32::try_from(repeat).unwrap_or(0),
                repeat_window: Duration::from_secs(u64::try_from(window).unwrap_or(1).max(1)),
            },
            None => self.config.loop_guard.clone(),
        })
    }

    /// Модель, кошелёк и ключ вызова. Для текста — выбор человека в
    /// «Подключить AI» (`ai_sources`, D-493): своя подписка ChatGPT вместо модели
    /// платформы или свой ключ OpenRouter к той же модели. Голос — всегда платформа.
    async fn route(
        &self,
        account_id: Uuid,
        requested: &str,
        work: &Work<'_>,
    ) -> Result<(ModelRow, PaidBy, Option<qubite_kernel::Secret>)> {
        if let Work::Realtime(_) = work {
            // Своя подписка: allowlist owner не нужен (D-531), выключенная
            // строка модели — тоже годится; провайдер и блокировка — как у всех.
            let model = self.model_row(requested).await?;
            if !model.provider_enabled {
                return Err(AiError::SourceNotReady(
                    "ChatGPT по подписке выключен на сервере (QUBITE_AI_CHATGPT_ENABLED)".into(),
                ));
            }
            if let Some(reason) = &model.blocked_reason {
                return Err(AiError::ModelBlocked(reason.clone()));
            }
            let paid = if model.provider_id == chatgpt::PROVIDER_ID {
                PaidBy::Subscription
            } else {
                PaidBy::Platform
            };
            return Ok((model, paid, None));
        }
        if !matches!(work, Work::Chat { .. }) {
            return Ok((self.load_model(requested).await?, PaidBy::Platform, None));
        }
        if catalog::split_model_id(requested).0 == chatgpt::PROVIDER_ID {
            return Ok((
                self.subscription_model(Some(requested)).await?,
                PaidBy::Subscription,
                None,
            ));
        }
        let source: Option<(String, Option<String>)> =
            sqlx::query_as("SELECT source, chatgpt_model FROM ai_sources WHERE account_id = $1")
                .bind(account_id)
                .fetch_optional(&self.pool)
                .await?;
        match source {
            Some((kind, chosen)) if kind == "chatgpt" => Ok((
                self.subscription_model(chosen.as_deref()).await?,
                PaidBy::Subscription,
                None,
            )),
            Some((kind, _)) if kind == "own_key" => {
                let model = self.load_model(requested).await?;
                if model.provider_id != "openrouter" {
                    return Ok((model, PaidBy::Platform, None));
                }
                let key = self.own_key(account_id).await?.ok_or_else(|| {
                    AiError::SourceNotReady(
                        "свой ключ OpenRouter не добавлен — «Настройки → AI и бюджет»".into(),
                    )
                })?;
                Ok((model, PaidBy::OwnKey, Some(key)))
            }
            _ => Ok((self.load_model(requested).await?, PaidBy::Platform, None)),
        }
    }

    /// Свой ключ OpenRouter человека (расшифрованный).
    async fn own_key(&self, account_id: Uuid) -> Result<Option<qubite_kernel::Secret>> {
        let sealed: Option<String> = sqlx::query_scalar(
            "SELECT key_enc FROM ai_keys WHERE account_id = $1 AND provider_id = 'openrouter'",
        )
        .bind(account_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(sealed) = sealed else {
            return Ok(None);
        };
        let secrets = self.secrets.as_ref().ok_or_else(|| {
            AiError::SourceNotReady(
                "на сервере не задан QUBITE_AI_SECRET_KEY — свой ключ не прочитать".into(),
            )
        })?;
        let key = secrets
            .open(&key_purpose(Some(account_id)), &sealed)
            .map_err(|e| AiError::SourceNotReady(format!("свой ключ не прочитан: {e}")))?;
        Ok(Some(qubite_kernel::Secret::new(key)))
    }

    /// Модель подписки ChatGPT: выбранная (если есть в каталоге подписки), иначе
    /// разрешённая owner, иначе первая из каталога. Allowlist owner для подписки
    /// не нужен — она не тратит деньги платформы (D-531); строка модели
    /// заводится выключенной, чтобы вызов было к чему привязать.
    async fn subscription_model(&self, chosen: Option<&str>) -> Result<ModelRow> {
        let external: Option<String> = sqlx::query_scalar(
            "SELECT external_id FROM ( \
               SELECT m.external_id, 0 AS rank FROM ai_models m \
                 WHERE m.provider_id = 'chatgpt' AND m.id = $1 \
                   AND NOT ('realtime' = ANY(m.capabilities)) \
               UNION ALL SELECT c.external_id, 1 FROM ai_catalog c \
                 WHERE c.provider_id = 'chatgpt' AND 'chatgpt:' || lower(c.external_id) = $1 \
               UNION ALL SELECT m.external_id, 2 FROM ai_models m \
                 WHERE m.provider_id = 'chatgpt' AND m.enabled \
                   AND NOT ('realtime' = ANY(m.capabilities)) \
               UNION ALL SELECT c.external_id, 3 FROM ai_catalog c WHERE c.provider_id = 'chatgpt' \
             ) x ORDER BY rank, external_id LIMIT 1",
        )
        .bind(chosen.unwrap_or(""))
        .fetch_optional(&self.pool)
        .await?;
        let Some(external) = external else {
            return Err(AiError::SourceNotReady(
                "модели подписки ChatGPT ещё не получены — войдите через ChatGPT ещё раз".into(),
            ));
        };
        let id = catalog::model_id_for(chatgpt::PROVIDER_ID, &external);
        sqlx::query(
            "INSERT INTO ai_models (id, provider_id, external_id, price_in_per_mtok, \
             price_out_per_mtok, context_tokens, enabled) \
             SELECT $1, provider_id, external_id, price_in_per_mtok, price_out_per_mtok, \
                    context_tokens, false FROM ai_catalog \
             WHERE provider_id = 'chatgpt' AND external_id = $2 ON CONFLICT (id) DO NOTHING",
        )
        .bind(&id)
        .bind(&external)
        .execute(&self.pool)
        .await?;
        let model = self.model_row(&id).await?;
        if !model.provider_enabled {
            return Err(AiError::SourceNotReady(
                "ChatGPT по подписке выключен на сервере (QUBITE_AI_CHATGPT_ENABLED)".into(),
            ));
        }
        if let Some(reason) = &model.blocked_reason {
            return Err(AiError::ModelBlocked(reason.clone()));
        }
        Ok(model)
    }

    /// Модель для задачи модуля (`inbox.triage` …): выбор owner для задачи,
    /// иначе модель по умолчанию (`default`). Тихой замены нет: если выбранная
    /// модель выключена, запрос получит отказ (D-076).
    pub async fn model_for(&self, task: &str) -> Result<String> {
        sqlx::query_scalar(
            "SELECT model_id FROM ai_model_defaults WHERE task IN ($1, 'default') \
             ORDER BY task = 'default' LIMIT 1",
        )
        .bind(task)
        .fetch_optional(&self.pool)
        .await?
        .ok_or_else(|| AiError::NoModelForTask(task.into()))
    }

    /// «Отпечаток» запроса: HMAC частей с длинами (части не склеятся в другую).
    fn fingerprint<'p>(&self, parts: impl IntoIterator<Item = &'p [u8]>) -> String {
        let mut ctx = ring::hmac::Context::with_key(&self.fingerprint_key);
        for part in parts {
            ctx.update(&(part.len() as u64).to_le_bytes());
            ctx.update(part);
        }
        ctx.sign()
            .as_ref()
            .iter()
            .take(16)
            .map(|b| format!("{b:02x}"))
            .collect()
    }

    /// Защита от зацикливания (D-213): проверка под блокировкой аккаунта,
    /// чтобы параллельные запросы не проскочили вместе. Ход ([`InTurn`])
    /// проверяется один раз, по первому вызову, и считается одним запросом в
    /// минуту и одним повтором; вызовов в одном ходе — не больше [`TURN_CALLS`].
    async fn loop_guard(
        &self,
        conn: &mut PgConnection,
        account_id: Uuid,
        job_id: Option<Uuid>,
        turn: Option<Uuid>,
        fingerprint: &str,
    ) -> Result<()> {
        let guard = &self.current_guard(conn).await?;
        sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1::text, 7))")
            .bind(account_id)
            .execute(&mut *conn)
            .await?;
        if let Some(turn) = turn {
            let calls: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM ai_calls WHERE account_id = $1 AND turn_id = $2",
            )
            .bind(account_id)
            .bind(turn)
            .fetch_one(&mut *conn)
            .await?;
            if calls >= TURN_CALLS {
                return Err(AiError::RateLimited {
                    scope: "turn".into(),
                });
            }
            if calls > 0 {
                return Ok(());
            }
        }
        let (per_minute, repeats): (i64, i64) = sqlx::query_as(
            "SELECT count(DISTINCT coalesce(turn_id, id)) \
                    FILTER (WHERE created_at > now() - interval '1 minute'), \
                    count(DISTINCT coalesce(turn_id, id)) FILTER (WHERE fingerprint = $2 \
                                     AND created_at > now() - $3::float8 * interval '1 second') \
             FROM ai_calls WHERE account_id = $1 \
               AND created_at > now() - greatest($3::float8, 60) * interval '1 second'",
        )
        .bind(account_id)
        .bind(fingerprint)
        .bind(guard.repeat_window.as_secs_f64())
        .fetch_one(&mut *conn)
        .await?;
        if guard.user_per_minute > 0 && per_minute >= i64::from(guard.user_per_minute) {
            return Err(AiError::RateLimited {
                scope: "user".into(),
            });
        }
        if guard.repeat_limit > 0 && repeats >= i64::from(guard.repeat_limit) {
            return Err(AiError::RepeatedRequest);
        }
        if let Some(job) = job_id
            && guard.job_per_minute > 0
        {
            let per_job: i64 = sqlx::query_scalar(
                "SELECT count(*) FROM ai_calls WHERE job_id = $1 \
                 AND created_at > now() - interval '1 minute'",
            )
            .bind(job)
            .fetch_one(&mut *conn)
            .await?;
            if per_job >= i64::from(guard.job_per_minute) {
                return Err(AiError::RateLimited {
                    scope: "job".into(),
                });
            }
        }
        Ok(())
    }

    /// Подключить адаптер провайдера с этим ID (`ai_providers.id`).
    pub fn with_provider(mut self, provider_id: &str, provider: Arc<dyn Provider>) -> Self {
        self.providers.insert(provider_id.into(), provider);
        self
    }

    /// Сменить часовой пояс периодов. Накопленное не обнуляется: старые резервы
    /// остаются в своих периодах.
    pub async fn set_timezone(&self, timezone: &str) -> Result<()> {
        let mut conn = self.pool.acquire().await?;
        budget::period_keys(&mut conn, (self.config.clock)(), timezone).await?;
        *self.timezone.write().expect("пояс") = timezone.into();
        Ok(())
    }

    fn timezone(&self) -> String {
        self.timezone.read().expect("пояс").clone()
    }

    /// Выполнить запрос к модели.
    pub async fn complete(
        &self,
        auth: &Authorized<UseAi>,
        request: AiRequest,
    ) -> Result<AiResponse> {
        self.answer(auth, request, None, None).await
    }

    /// То же потоком: текст уходит в `delta` по мере того, как модель пишет
    /// (ENG-001), а права, резерв и списание — те же, что у [`Self::complete`].
    /// Повтор «точно не ушёл» начинается заново — до первого куска.
    pub async fn complete_stream(
        &self,
        auth: &Authorized<UseAi>,
        request: AiRequest,
        delta: provider::Delta,
    ) -> Result<AiResponse> {
        self.answer(auth, request, Some(delta), None).await
    }

    /// Начать ход живого разговора: вызовы через [`InTurn`] — один запрос для
    /// защиты от зацикливания (деньги и резерв — по каждому, как обычно).
    pub fn turn(&self) -> InTurn<'_> {
        InTurn {
            gateway: self,
            id: qubite_objects::new_id(),
        }
    }

    async fn answer(
        &self,
        auth: &Authorized<UseAi>,
        request: AiRequest,
        delta: Option<provider::Delta>,
        turn: Option<Uuid>,
    ) -> Result<AiResponse> {
        let guarded =
            guard::build(&request.prompt, &request.untrusted).map_err(AiError::Invalid)?;
        let fingerprint = self.fingerprint(
            [request.model.as_str(), request.prompt.as_str()]
                .into_iter()
                .chain(
                    request
                        .untrusted
                        .iter()
                        .flat_map(|u| [u.source.as_str(), u.text.as_str()]),
                )
                .map(str::as_bytes),
        );
        let input_tokens = guarded
            .input_tokens_upper_bound()
            .max(u64::from(request.input_tokens));
        let (call_id, done, actual) = self
            .run(
                auth,
                Plan {
                    request_id: &request.request_id,
                    model: &request.model,
                    fingerprint,
                    input_units: input_tokens,
                    max_output_units: u64::from(request.max_output_tokens),
                    job_id: request.job_id,
                    turn,
                    signals: guarded.signals.clone(),
                    work: Work::Chat {
                        guarded: &guarded,
                        max_output_tokens: request.max_output_tokens,
                        delta,
                    },
                },
            )
            .await?;
        let Done::Chat(reply) = done else {
            unreachable!("на текстовый запрос — текстовый ответ")
        };
        let mut warnings = guarded.signals.clone();
        warnings.extend(guarded.check_output(&reply.text));
        Ok(AiResponse {
            call_id,
            text: reply.text,
            tokens_in: reply.tokens_in,
            tokens_out: reply.tokens_out,
            cost_usd: actual,
            warnings: warnings.into_iter().map(Into::into).collect(),
        })
    }

    /// Есть ли у шлюза адаптер, который выполнит эту работу у провайдера модели.
    fn can_run(&self, provider_id: &str, work: &Work<'_>) -> bool {
        match work {
            Work::Chat { .. } => self.providers.contains_key(provider_id),
            Work::Listen(_) | Work::Speak(_) | Work::Live => self.voices.contains_key(provider_id),
            Work::Realtime(_) => self.realtimes.contains_key(provider_id),
        }
    }

    /// Вызвать провайдера (уже после резерва и отметки «отправляется»).
    async fn send(
        &self,
        model: &ModelRow,
        account_id: Uuid,
        api_key: Option<qubite_kernel::Secret>,
        input_units: u64,
        work: &Work<'_>,
    ) -> std::result::Result<Result<Done, ProviderError>, tokio::time::error::Elapsed> {
        match work {
            Work::Chat {
                guarded,
                max_output_tokens,
                delta,
            } => {
                let provider = self.providers[&model.provider_id].clone();
                let call = ProviderCall {
                    external_id: model.external_id.clone(),
                    messages: guarded.messages.clone(),
                    max_output_tokens: *max_output_tokens,
                    input_tokens_estimate: input_units,
                    routing: Routing {
                        providers: model.routing_providers.clone(),
                        data_collection: model.data_collection.clone(),
                        max_price_in_per_mtok: model.price_in_per_mtok,
                        max_price_out_per_mtok: model.price_out_per_mtok,
                    },
                    account_id,
                    api_key,
                };
                match delta {
                    Some(delta) => {
                        tokio::time::timeout(
                            self.config.timeout,
                            provider.stream(&call, delta.clone()),
                        )
                        .await
                    }
                    None => {
                        tokio::time::timeout(self.config.timeout, provider.complete(&call)).await
                    }
                }
                .map(|reply| reply.map(Done::Chat))
            }
            Work::Listen(listen) => {
                let provider = self.voices[&model.provider_id].clone();
                let call = voice::SttCall {
                    external_id: model.external_id.clone(),
                    audio: listen.audio.clone(),
                    mime: listen.mime.clone(),
                    language: listen.language.clone(),
                    account_id,
                };
                tokio::time::timeout(self.config.timeout, provider.transcribe(&call))
                    .await
                    .map(|heard| heard.map(Done::Listen))
            }
            Work::Realtime(open) => {
                self.send_realtime(&model.provider_id, &model.external_id, account_id, open)
                    .await
            }
            // Живое распознавание идёт мимо `run` (длина звука известна в конце).
            Work::Live => Ok(Err(ProviderError::Refused("не через run".into()))),
            Work::Speak(say) => {
                let provider = self.voices[&model.provider_id].clone();
                let call = voice::TtsCall {
                    external_id: model.external_id.clone(),
                    voice: say.voice.clone(),
                    text: say.text.clone(),
                    account_id,
                };
                if say.stream {
                    tokio::time::timeout(self.config.timeout, provider.speak_stream(&call))
                        .await
                        .map(|chunks| chunks.map(Done::SpeakStream))
                } else {
                    tokio::time::timeout(self.config.timeout, provider.speak(&call))
                        .await
                        .map(|spoken| spoken.map(Done::Speak))
                }
            }
        }
    }

    /// Запрос с таким ID уже был — второй раз не выполняется.
    async fn check_request(&self, auth: &Authorized<UseAi>, request_id: &str) -> Result<()> {
        if request_id.is_empty() || request_id.len() > 200 {
            return Err(AiError::Invalid("request_id: от 1 до 200 символов".into()));
        }
        if let Some(status) = sqlx::query_scalar::<_, String>(
            "SELECT status FROM ai_calls WHERE account_id = $1 AND request_id = $2",
        )
        .bind(auth.account_id())
        .bind(request_id)
        .fetch_optional(&self.pool)
        .await?
        {
            return Err(AiError::DuplicateRequest { status });
        }

        Ok(())
    }

    /// Одна попытка до вызова провайдера: права заново, модель, защита от
    /// зацикливания (только в первой), резерв и отметка «отправляется».
    async fn open_attempt(
        &self,
        auth: &Authorized<UseAi>,
        plan: &Plan<'_>,
        attempt: usize,
        call_id: Option<Uuid>,
    ) -> Result<Opened> {
        // Перед каждой попыткой — права заново: отзыв гранта останавливает повтор.
        let auth = match auth.recheck(&self.pool).await {
            Ok(auth) => auth,
            Err(error) => {
                if let Some(id) = call_id {
                    self.finish_without_call(id, "denied", "access_revoked")
                        .await?;
                }
                return Err(error.into());
            }
        };
        let (model, paid_by, api_key) = self
            .route(auth.account_id(), plan.model, &plan.work)
            .await?;
        if !plan.work.fits(&model.capabilities) || !self.can_run(&model.provider_id, &plan.work) {
            return Err(AiError::ModelNotAllowed);
        }

        let estimate_usd = cost(
            plan.input_units,
            plan.max_output_units,
            model.price_in_per_mtok,
            model.price_out_per_mtok,
        );
        let estimate_tokens = i64::try_from(plan.input_units)
            .unwrap_or(i64::MAX)
            .saturating_add(i64::try_from(plan.max_output_units).unwrap_or(i64::MAX));

        // Резерв и отметка «отправляется» — до вызова, одной транзакцией.
        let mut tx = self.pool.begin().await?;
        if call_id.is_none() {
            self.loop_guard(
                &mut tx,
                auth.account_id(),
                plan.job_id,
                plan.turn,
                &plan.fingerprint,
            )
            .await?;
        }
        let keys = budget::period_keys(&mut tx, (self.config.clock)(), &self.timezone()).await?;
        let scope = budget::Scope {
            account_id: auth.account_id(),
            module_id: auth.module().as_str(),
            model_id: &model.id,
            provider_id: &model.provider_id,
            own_source: paid_by != PaidBy::Platform,
        };
        let reservations =
            match budget::reserve(&mut tx, &scope, &keys, estimate_usd, estimate_tokens).await {
                Ok(reservations) => reservations,
                Err(error) => {
                    drop(tx);
                    if let Some(id) = call_id {
                        self.finish_without_call(id, "denied", error.code()).await?;
                    }
                    return Err(error);
                }
            };
        let reservations_json = serde_json::to_value(&reservations).expect("резерв сериализуется");
        let id = match call_id {
            None => {
                let id = qubite_objects::new_id();
                let inserted = sqlx::query(
                    "INSERT INTO ai_calls (id, request_id, account_id, module_id, model_id, status, \
                     attempts, estimate_usd, estimate_tokens, reservations, job_id, fingerprint, turn_id, \
                     paid_by) VALUES ($1, $2, $3, $4, $5, 'sending', 1, $6, $7, $8, $9, $10, $11, $12)",
                )
                .bind(id)
                .bind(plan.request_id)
                .bind(auth.account_id())
                .bind(auth.module().as_str())
                .bind(&model.id)
                .bind(estimate_usd)
                .bind(estimate_tokens)
                .bind(&reservations_json)
                .bind(plan.job_id)
                .bind(&plan.fingerprint)
                .bind(plan.turn)
                .bind(paid_by.as_str())
                .execute(&mut *tx)
                .await;
                if let Err(sqlx::Error::Database(db)) = &inserted
                    && db.code().as_deref() == Some("23505")
                {
                    // Тот же request_id параллельно — резерв откатывается вместе с транзакцией.
                    return Err(AiError::DuplicateRequest {
                        status: "sending".into(),
                    });
                }
                inserted?;
                id
            }
            Some(id) => {
                sqlx::query(
                    "UPDATE ai_calls SET status = 'sending', attempts = attempts + 1, \
                     estimate_usd = $2, estimate_tokens = $3, reservations = $4, updated_at = now() \
                     WHERE id = $1",
                )
                .bind(id)
                .bind(estimate_usd)
                .bind(estimate_tokens)
                .bind(&reservations_json)
                .execute(&mut *tx)
                .await?;
                id
            }
        };
        event(
            &mut tx,
            id,
            "call.sending",
            serde_json::json!({
                "attempt": attempt,
                "estimate_usd": estimate_usd,
                "guard": plan.signals,
            }),
        )
        .await?;
        tx.commit().await?;
        Ok(Opened {
            id,
            model,
            reservations,
            estimate_usd,
            account_id: auth.account_id(),
            api_key,
        })
    }

    /// Общий путь любого платного вызова: права → модель → защита от
    /// зацикливания → резерв и «отправляется» → провайдер → списание.
    /// Возвращает ID вызова, ответ провайдера и списанную сумму.
    async fn run(&self, auth: &Authorized<UseAi>, plan: Plan<'_>) -> Result<(Uuid, Done, i64)> {
        self.check_request(auth, plan.request_id).await?;
        let attempts = self.config.retry_delays.len() + 1;
        let mut call_id: Option<Uuid> = None;
        for attempt in 1..=attempts {
            let Opened {
                id,
                model,
                reservations,
                estimate_usd,
                account_id,
                api_key,
            } = self.open_attempt(auth, &plan, attempt, call_id).await?;
            call_id = Some(id);
            let outcome = self
                .send(&model, account_id, api_key, plan.input_units, &plan.work)
                .await;
            match outcome {
                Ok(Ok(done)) => {
                    let (usage, leaked) = match (&done, &plan.work) {
                        (Done::Chat(reply), Work::Chat { guarded, .. }) => (
                            Usage {
                                units_in: reply.tokens_in,
                                units_out: reply.tokens_out,
                                reported_usd: reply.cost_usd,
                            },
                            !guarded.check_output(&reply.text).is_empty(),
                        ),
                        (Done::Listen(heard), Work::Listen(listen)) => (
                            Usage {
                                units_in: voice::billed_seconds(heard, listen),
                                units_out: 0,
                                reported_usd: None,
                            },
                            false,
                        ),
                        _ => (
                            Usage {
                                units_in: plan.input_units,
                                units_out: 0,
                                reported_usd: None,
                            },
                            false,
                        ),
                    };
                    let actual = self
                        .settle_success(id, &model, &reservations, estimate_usd, usage, leaked)
                        .await?;
                    return Ok((id, done, actual));
                }
                Ok(Err(ProviderError::UsageLimit(reason))) => {
                    self.release_not_sent(id, &reservations, attempt, "usage_limit", &reason)
                        .await?;
                    return Err(AiError::SubscriptionLimit {
                        reason,
                        alternatives: self.alternatives(&model.id).await?,
                    });
                }
                Ok(Err(ProviderError::Refused(reason))) => {
                    self.release_not_sent(id, &reservations, attempt, "refused", &reason)
                        .await?;
                    return Err(AiError::ProviderRefused {
                        reason,
                        alternatives: self.alternatives(&model.id).await?,
                    });
                }
                Ok(Err(ProviderError::NotSent(reason))) => {
                    self.release_not_sent(id, &reservations, attempt, "not_sent", &reason)
                        .await?;
                    if let Some(delay) = self.config.retry_delays.get(attempt - 1) {
                        tokio::time::sleep(*delay).await;
                        continue;
                    }
                    return Err(AiError::ProviderUnavailable {
                        alternatives: self.alternatives(&model.id).await?,
                    });
                }
                Ok(Err(ProviderError::Unknown(reason))) => {
                    self.mark_unknown(id, &reason).await?;
                    return Err(AiError::ResultUnknown { call_id: id });
                }
                Err(_elapsed) => {
                    self.mark_unknown(id, "таймаут").await?;
                    return Err(AiError::ResultUnknown { call_id: id });
                }
            }
        }
        unreachable!("цикл попыток всегда возвращает результат")
    }

    /// Запрос точно не стоил денег: резерв возвращается целиком.
    async fn release_not_sent(
        &self,
        id: Uuid,
        reservations: &[Reservation],
        attempt: usize,
        code: &str,
        reason: &str,
    ) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        budget::release(&mut tx, reservations).await?;
        sqlx::query(
            "UPDATE ai_calls SET status = 'failed_not_sent', error_code = $2, \
             reservations = '[]', updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(code)
        .execute(&mut *tx)
        .await?;
        event(
            &mut tx,
            id,
            "call.not_sent",
            serde_json::json!({ "attempt": attempt, "code": code, "reason": reason }),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn load_model(&self, model_id: &str) -> Result<ModelRow> {
        let model = self.model_row(model_id).await?;
        if !model.enabled || !model.provider_enabled {
            return Err(AiError::ModelNotAllowed);
        }
        if let Some(reason) = &model.blocked_reason {
            return Err(AiError::ModelBlocked(reason.clone()));
        }
        Ok(model)
    }

    async fn model_row(&self, model_id: &str) -> Result<ModelRow> {
        let model: Option<ModelRow> = sqlx::query_as(
            "SELECT m.id, m.provider_id, m.external_id, m.price_in_per_mtok, m.price_out_per_mtok, \
                    m.enabled, m.blocked_reason, p.enabled AS provider_enabled, \
                    m.routing_providers, m.data_collection, m.capabilities \
             FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id WHERE m.id = $1",
        )
        .bind(model_id)
        .fetch_optional(&self.pool)
        .await?;
        model.ok_or(AiError::ModelNotAllowed)
    }

    async fn settle_success(
        &self,
        id: Uuid,
        model: &ModelRow,
        reservations: &[Reservation],
        estimate_usd: i64,
        usage: Usage,
        leaked: bool,
    ) -> Result<i64> {
        // Списывается большее: расчёт по каталогу или стоимость от провайдера.
        let actual = cost(
            usage.units_in,
            usage.units_out,
            model.price_in_per_mtok,
            model.price_out_per_mtok,
        )
        .max(usage.reported_usd.unwrap_or(0));
        let tokens = i64::try_from(usage.units_in + usage.units_out).unwrap_or(i64::MAX);
        let mut tx = self.pool.begin().await?;
        budget::settle(&mut tx, reservations, actual, tokens).await?;
        sqlx::query(
            "UPDATE ai_calls SET status = 'succeeded', actual_usd = $2, tokens_in = $3, tokens_out = $4, \
             reservations = '[]', updated_at = now(), settled_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(actual)
        .bind(i64::try_from(usage.units_in).unwrap_or(i64::MAX))
        .bind(i64::try_from(usage.units_out).unwrap_or(i64::MAX))
        .execute(&mut *tx)
        .await?;
        event(
            &mut tx,
            id,
            "call.settled",
            serde_json::json!({ "actual_usd": actual, "reported_usd": usage.reported_usd }),
        )
        .await?;
        if leaked {
            event(
                &mut tx,
                id,
                "guard.output",
                serde_json::json!({ "signals": [guard::signal::LEAKED] }),
            )
            .await?;
            tracing::warn!(call_id = %id, "в ответе модели — служебная метка: инструкции утекли");
        }
        if actual > estimate_usd {
            block_model(&mut tx, &model.id, id, estimate_usd, actual).await?;
        }
        tx.commit().await?;
        Ok(actual)
    }

    async fn mark_unknown(&self, id: Uuid, reason: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE ai_calls SET status = 'unknown', error_code = 'unknown', updated_at = now() WHERE id = $1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        event(
            &mut tx,
            id,
            "call.unknown",
            serde_json::json!({ "reason": reason }),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn finish_without_call(&self, id: Uuid, status: &str, code: &str) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE ai_calls SET status = $2, error_code = $3, updated_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(status)
        .bind(code)
        .execute(&mut *tx)
        .await?;
        event(
            &mut tx,
            id,
            "call.stopped",
            serde_json::json!({ "reason": code }),
        )
        .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Другие разрешённые модели того же вида (текст, распознавание, речь) —
    /// пользователь выбирает сам (D-076).
    async fn alternatives(&self, except: &str) -> Result<Vec<String>> {
        Ok(sqlx::query_scalar(
            "SELECT m.id FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id \
             WHERE m.enabled AND p.enabled AND m.blocked_reason IS NULL AND m.id <> $1 \
               AND ('stt' = ANY(m.capabilities)) = coalesce((SELECT 'stt' = ANY(capabilities) FROM ai_models WHERE id = $1), false) \
               AND ('tts' = ANY(m.capabilities)) = coalesce((SELECT 'tts' = ANY(capabilities) FROM ai_models WHERE id = $1), false) \
               AND ('realtime' = ANY(m.capabilities)) = coalesce((SELECT 'realtime' = ANY(capabilities) FROM ai_models WHERE id = $1), false) \
             ORDER BY m.id",
        )
        .bind(except)
        .fetch_all(&self.pool)
        .await?)
    }
}

/// Поздний ответ на вызов со статусом `unknown`: расход учитывается ровно один раз.
pub async fn settle_late(
    pool: &PgPool,
    call_id: Uuid,
    tokens_in: u64,
    tokens_out: u64,
) -> Result<i64> {
    let mut tx = pool.begin().await?;
    let row: Option<(String, serde_json::Value, String, i64)> =
        sqlx::query_as("SELECT status, reservations, model_id, estimate_usd FROM ai_calls WHERE id = $1 FOR UPDATE")
            .bind(call_id)
            .fetch_optional(&mut *tx)
            .await?;
    let Some((status, reservations, model_id, estimate_usd)) = row else {
        return Err(AiError::Invalid("нет такого вызова".into()));
    };
    if status != "unknown" {
        return Err(AiError::DuplicateRequest { status });
    }
    let reservations: Vec<Reservation> = serde_json::from_value(reservations)
        .map_err(|error| AiError::Invalid(error.to_string()))?;
    let (price_in, price_out): (i64, i64) =
        sqlx::query_as("SELECT price_in_per_mtok, price_out_per_mtok FROM ai_models WHERE id = $1")
            .bind(&model_id)
            .fetch_one(&mut *tx)
            .await?;
    let actual = cost(tokens_in, tokens_out, price_in, price_out);
    let tokens = i64::try_from(tokens_in + tokens_out).unwrap_or(i64::MAX);
    budget::settle(&mut tx, &reservations, actual, tokens).await?;
    sqlx::query(
        "UPDATE ai_calls SET status = 'succeeded', actual_usd = $2, tokens_in = $3, tokens_out = $4, \
         reservations = '[]', updated_at = now(), settled_at = now() WHERE id = $1",
    )
    .bind(call_id)
    .bind(actual)
    .bind(i64::try_from(tokens_in).unwrap_or(i64::MAX))
    .bind(i64::try_from(tokens_out).unwrap_or(i64::MAX))
    .execute(&mut *tx)
    .await?;
    event(
        &mut tx,
        call_id,
        "call.settled_late",
        serde_json::json!({ "actual_usd": actual }),
    )
    .await?;
    if actual > estimate_usd {
        block_model(&mut tx, &model_id, call_id, estimate_usd, actual).await?;
    }
    tx.commit().await?;
    Ok(actual)
}

/// Процесс упал между «отправляется» и ответом: такие вызовы помечаются
/// `unknown`, резерв остаётся. Вызывать при запуске и периодически.
pub async fn recover_stale(pool: &PgPool, older_than: Duration) -> Result<u64> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE ai_calls SET status = 'unknown', error_code = 'interrupted', updated_at = now() \
         WHERE status = 'sending' AND updated_at < now() - $1::float8 * interval '1 second' RETURNING id",
    )
    .bind(older_than.as_secs_f64())
    .fetch_all(pool)
    .await?;
    for id in &ids {
        let mut conn = pool.acquire().await?;
        event(&mut conn, *id, "call.interrupted", serde_json::json!({})).await?;
    }
    Ok(ids.len() as u64)
}

async fn block_model(
    conn: &mut PgConnection,
    model_id: &str,
    call_id: Uuid,
    estimate: i64,
    actual: i64,
) -> Result<()> {
    sqlx::query("UPDATE ai_models SET blocked_reason = 'cost_over_estimate' WHERE id = $1")
        .bind(model_id)
        .execute(&mut *conn)
        .await?;
    event(
        conn,
        call_id,
        "model.blocked",
        serde_json::json!({ "model_id": model_id, "estimate_usd": estimate, "actual_usd": actual }),
    )
    .await?;
    tracing::warn!(
        model_id,
        estimate,
        actual,
        "ответ дороже оценки — модель заблокирована до решения owner"
    );
    Ok(())
}

async fn event(
    conn: &mut PgConnection,
    call_id: Uuid,
    kind: &str,
    details: serde_json::Value,
) -> Result<()> {
    sqlx::query("INSERT INTO ai_call_events (call_id, kind, details) VALUES ($1, $2, $3)")
        .bind(call_id)
        .bind(kind)
        .bind(details)
        .execute(conn)
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::cost;

    #[test]
    fn cost_rounds_up_in_micros() {
        // 10 000 токенов ответа по $60 за миллион = $0,60.
        assert_eq!(cost(0, 10_000, 0, 60_000_000), 600_000);
        assert_eq!(cost(1, 0, 1, 0), 1, "доли микродоллара округляются вверх");
        assert_eq!(cost(0, 0, 5, 5), 0);
    }
}
