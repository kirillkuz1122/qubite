//! AI-шлюз в сервере (AI-002): настройки `QUBITE_AI_*`, запуск (восстановление
//! «зависших» вызовов, каталог цен OpenRouter, лимиты платформы), фоновое
//! обслуживание и команды `qubite ai …` для owner.
//!
//! Без ключа OpenRouter AI просто выключен: провайдера нет, запросы получают
//! отказ до любых трат.

use std::{sync::Arc, time::Duration};

use anyhow::{Context, bail};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use clap::{Args, Subcommand, ValueEnum};
use qubite_ai::{
    AiConfig, Gateway, LoopGuard, MICROS_PER_USD,
    admin::{self, LimitScope, Metric, Period},
    catalog::{self, Allowlist, STARTER_MODELS, SyncReport},
    chatgpt::{self, ChatGpt, ChatGptConfig},
    openrouter::{self, OpenRouter, OpenRouterConfig},
    secret::SecretBox,
};
use qubite_db::Database;
use qubite_kernel::Secret;
use qubite_policy::{ModuleId, OwnerConsole, Subject};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody},
    modules::Owner,
};

/// ID провайдера OpenRouter в базе (`ai_providers.id`).
pub const OPENROUTER: &str = "openrouter";

/// Настройки AI. У каждой есть переменная окружения `QUBITE_AI_*`.
#[derive(Args, Clone, Debug)]
pub struct AiArgs {
    /// Часовой пояс, по которому считаются дни и месяцы AI-лимитов.
    #[arg(
        long = "ai-timezone",
        env = "QUBITE_AI_TIMEZONE",
        default_value = "Asia/Yekaterinburg"
    )]
    pub timezone: String,

    /// Сколько секунд ждать ответа модели; дальше результат «неизвестен»,
    /// резерв удерживается.
    #[arg(long = "ai-timeout-secs", env = "QUBITE_AI_TIMEOUT_SECS", default_value_t = 60,
          value_parser = clap::value_parser!(u64).range(1..=600))]
    pub timeout_secs: u64,

    /// Попыток, если запрос точно не ушёл (1–3).
    #[arg(long = "ai-max-attempts", env = "QUBITE_AI_MAX_ATTEMPTS", default_value_t = 3,
          value_parser = clap::value_parser!(u8).range(1..=3))]
    pub max_attempts: u8,

    /// Ключ OpenRouter. Задавать только переменной окружения (аргумент виден
    /// в списке процессов). Без ключа AI выключен.
    #[arg(
        long = "ai-openrouter-api-key",
        env = "QUBITE_AI_OPENROUTER_API_KEY",
        hide_env_values = true
    )]
    pub openrouter_api_key: Option<String>,

    /// Адрес API OpenRouter.
    #[arg(
        long = "ai-openrouter-base-url",
        env = "QUBITE_AI_OPENROUTER_BASE_URL",
        default_value = openrouter::DEFAULT_BASE_URL
    )]
    pub openrouter_base_url: String,

    /// Модели OpenRouter, которые разрешить при первом запуске (через запятую,
    /// имена как на openrouter.ai). Не задано — стартовый набор. Дальше модели
    /// выбирает owner (`qubite ai model`, Owner Console), запуск их не меняет.
    #[arg(
        long = "ai-openrouter-models",
        env = "QUBITE_AI_OPENROUTER_MODELS",
        value_delimiter = ','
    )]
    pub openrouter_models: Option<Vec<String>>,

    /// `data_collection` для моделей, где owner его не задал: `deny` — только
    /// провайдеры, которые не собирают данные; не задано — не указывать
    /// (у части моделей таких провайдеров нет).
    #[arg(
        long = "ai-openrouter-data-collection",
        env = "QUBITE_AI_OPENROUTER_DATA_COLLECTION",
        value_enum
    )]
    pub data_collection: Option<DataCollection>,

    /// Потолок на каждого пользователя за день, $ (у каждого свой счётчик).
    /// AI сам по себе не открывает. Не задан — не меняется.
    #[arg(long = "ai-each-user-usd-per-day", env = "QUBITE_AI_EACH_USER_USD_PER_DAY",
          value_parser = parse_usd)]
    pub each_user_usd_per_day: Option<i64>,

    /// Защита от зацикливания: начатых AI-вызовов в минуту на пользователя (0 — без проверки).
    #[arg(
        long = "ai-user-requests-per-minute",
        env = "QUBITE_AI_USER_REQUESTS_PER_MINUTE",
        default_value_t = 20
    )]
    pub user_requests_per_minute: u32,

    /// Защита от зацикливания: начатых AI-вызовов в минуту на одну фоновую задачу.
    #[arg(
        long = "ai-job-requests-per-minute",
        env = "QUBITE_AI_JOB_REQUESTS_PER_MINUTE",
        default_value_t = 10
    )]
    pub job_requests_per_minute: u32,

    /// Защита от зацикливания: сколько раз можно отправить один и тот же
    /// запрос за `QUBITE_AI_REPEAT_WINDOW_SECS`.
    #[arg(
        long = "ai-repeat-limit",
        env = "QUBITE_AI_REPEAT_LIMIT",
        default_value_t = 3
    )]
    pub repeat_limit: u32,

    #[arg(long = "ai-repeat-window-secs", env = "QUBITE_AI_REPEAT_WINDOW_SECS",
          default_value_t = 600, value_parser = clap::value_parser!(u64).range(1..=86_400))]
    pub repeat_window_secs: u64,

    /// Общий потолок расходов платформы за день, $ (например `2` или `0.50`).
    /// Не задан — не меняется (owner задаёт командой `qubite ai limit`).
    #[arg(long = "ai-platform-usd-per-day", env = "QUBITE_AI_PLATFORM_USD_PER_DAY",
          value_parser = parse_usd)]
    pub platform_usd_per_day: Option<i64>,

    /// Общий потолок расходов платформы за месяц, $.
    #[arg(long = "ai-platform-usd-per-month", env = "QUBITE_AI_PLATFORM_USD_PER_MONTH",
          value_parser = parse_usd)]
    pub platform_usd_per_month: Option<i64>,

    /// Как часто обновлять цены из каталога OpenRouter, часов.
    #[arg(long = "ai-catalog-refresh-hours", env = "QUBITE_AI_CATALOG_REFRESH_HOURS", default_value_t = 24,
          value_parser = clap::value_parser!(u64).range(1..=720))]
    pub catalog_refresh_hours: u64,

    /// Провайдер «ChatGPT по подписке» (Sign in with ChatGPT). Выключен по умолчанию;
    /// вход — `qubite ai chatgpt login`.
    #[arg(long = "ai-chatgpt-enabled", env = "QUBITE_AI_CHATGPT_ENABLED",
          default_value_t = false, action = clap::ArgAction::Set)]
    pub chatgpt_enabled: bool,

    /// Ключ шифрования токенов в базе: base64 от 32 байт (`qubite ai secret-key`
    /// или `openssl rand -base64 32`). Задавать только переменной окружения.
    #[arg(
        long = "ai-secret-key",
        env = "QUBITE_AI_SECRET_KEY",
        hide_env_values = true
    )]
    pub secret_key: Option<String>,

    /// Адрес входа OpenAI (для проверки — подставной сервер).
    #[arg(long = "ai-chatgpt-auth-url", env = "QUBITE_AI_CHATGPT_AUTH_URL",
          default_value = qubite_ai::chatgpt::AUTH_BASE)]
    pub chatgpt_auth_url: String,

    /// Адрес API OpenAI для запросов по подписке.
    #[arg(long = "ai-chatgpt-api-url", env = "QUBITE_AI_CHATGPT_API_URL",
          default_value = qubite_ai::chatgpt::API_BASE)]
    pub chatgpt_api_url: String,
}

impl AiArgs {
    pub fn gateway_config(&self) -> AiConfig {
        AiConfig {
            timezone: self.timezone.clone(),
            timeout: Duration::from_secs(self.timeout_secs),
            loop_guard: LoopGuard {
                user_per_minute: self.user_requests_per_minute,
                job_per_minute: self.job_requests_per_minute,
                repeat_limit: self.repeat_limit,
                repeat_window: Duration::from_secs(self.repeat_window_secs),
            },
            ..AiConfig::default()
        }
        .with_attempts(self.max_attempts)
    }

    /// Вызов «отправляется» дольше этого — точно осиротел (процесс упал):
    /// живой процесс сам пометил бы его `unknown` по таймауту.
    pub fn stale_after(&self) -> Duration {
        Duration::from_secs(self.timeout_secs + 30)
    }

    pub fn chatgpt_config(&self) -> ChatGptConfig {
        ChatGptConfig {
            auth_base: self.chatgpt_auth_url.clone(),
            api_base: self.chatgpt_api_url.clone(),
            ..ChatGptConfig::default()
        }
    }

    pub fn secret_box(&self) -> anyhow::Result<Option<SecretBox>> {
        match self
            .secret_key
            .as_deref()
            .map(str::trim)
            .filter(|k| !k.is_empty())
        {
            Some(key) => Ok(Some(
                SecretBox::from_base64(key).map_err(anyhow::Error::msg)?,
            )),
            None => Ok(None),
        }
    }

    fn openrouter(&self) -> anyhow::Result<Option<Arc<OpenRouter>>> {
        let Some(key) = self
            .openrouter_api_key
            .as_deref()
            .filter(|k| !k.trim().is_empty())
        else {
            return Ok(None);
        };
        let config = OpenRouterConfig {
            base_url: self.openrouter_base_url.clone(),
            data_collection: self.data_collection.map(|d| d.as_str().to_owned()),
            ..OpenRouterConfig::new(Secret::new(key.trim()))
        };
        Ok(Some(Arc::new(
            OpenRouter::new(config).map_err(anyhow::Error::msg)?,
        )))
    }

    /// Первый запуск — разрешить список из настроек или стартовый набор;
    /// дальше выбор owner не трогаем, только цены (D-210).
    fn allowlist(&self, first_run: bool) -> Allowlist {
        if !first_run {
            return Allowlist::Keep;
        }
        let configured: Vec<String> = self
            .openrouter_models
            .iter()
            .flatten()
            .map(|m| m.trim().to_owned())
            .filter(|m| !m.is_empty())
            .collect();
        if configured.is_empty() {
            Allowlist::Exact(STARTER_MODELS.iter().map(|m| (*m).to_owned()).collect())
        } else {
            Allowlist::Exact(configured)
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DataCollection {
    Allow,
    Deny,
}

impl DataCollection {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Allow => "allow",
            Self::Deny => "deny",
        }
    }
}

/// Доллары строкой (`2`, `0.50`, `0,5`) → микродоллары.
pub fn parse_usd(value: &str) -> Result<i64, String> {
    let value = value.trim().replace(',', ".");
    let (int, frac) = value.split_once('.').unwrap_or((&value, ""));
    let digits = |s: &str| s.bytes().all(|b| b.is_ascii_digit());
    if int.is_empty() && frac.is_empty() || !digits(int) || !digits(frac) || frac.len() > 6 {
        return Err(format!(
            "«{value}»: нужна сумма в долларах, до 6 знаков после точки"
        ));
    }
    let int: i64 = if int.is_empty() {
        0
    } else {
        int.parse()
            .map_err(|_| "слишком большая сумма".to_owned())?
    };
    let frac: i64 = format!("{frac:0<6}").parse().unwrap_or(0);
    int.checked_mul(MICROS_PER_USD)
        .and_then(|v| v.checked_add(frac))
        .ok_or_else(|| "слишком большая сумма".to_owned())
}

/// Микродоллары → «$1.234567» для людей.
pub fn format_usd(micros: i64) -> String {
    format!(
        "${}.{:06}",
        micros / MICROS_PER_USD,
        (micros % MICROS_PER_USD).abs()
    )
}

/// Запущенный AI: шлюз и (если есть ключ) адаптер OpenRouter.
pub struct AiRuntime {
    pub gateway: Arc<Gateway>,
    pub openrouter: Option<Arc<OpenRouter>>,
    /// Итог первой синхронизации каталога (если она была и удалась).
    pub catalog: Option<SyncReport>,
    /// Сколько «зависших» вызовов при запуске помечено `unknown`.
    pub recovered: u64,
    /// Провайдер ChatGPT, если включён флагом и вход выполнен.
    pub chatgpt: Option<Arc<ChatGpt>>,
}

/// Подготовить AI при запуске сервера.
pub async fn start(db: &Database, args: &AiArgs) -> anyhow::Result<AiRuntime> {
    let pool = db.pool();
    let mut gateway = Gateway::new(pool.clone(), args.gateway_config());
    match gateway.set_timezone(&args.timezone).await {
        Err(qubite_ai::AiError::Invalid(message)) => bail!("QUBITE_AI_TIMEZONE: {message}"),
        other => other?,
    }

    let recovered = qubite_ai::recover_stale(pool, args.stale_after()).await?;
    if recovered > 0 {
        tracing::warn!(
            recovered,
            "AI-вызовы, прерванные падением процесса, помечены unknown — резерв удерживается"
        );
    }

    for (scope, period, value) in [
        (LimitScope::Platform, Period::Day, args.platform_usd_per_day),
        (
            LimitScope::Platform,
            Period::Month,
            args.platform_usd_per_month,
        ),
        (
            LimitScope::EachUser,
            Period::Day,
            args.each_user_usd_per_day,
        ),
    ] {
        if let Some(value) = value
            && admin::ensure_limit(pool, &scope, period, Metric::Usd, value).await?
        {
            tracing::info!(scope = ?scope, period = period.as_str(), limit = %format_usd(value), "лимит из настроек");
        }
    }

    let openrouter = args.openrouter()?;
    let mut report = None;
    match &openrouter {
        Some(provider) => {
            catalog::ensure_provider(
                pool,
                OPENROUTER,
                "openrouter",
                &args.openrouter_base_url,
                true,
            )
            .await?;
            gateway = gateway.with_provider(OPENROUTER, provider.clone());
            match sync_catalog(pool, provider, args).await {
                Ok(done) => report = Some(done),
                Err(error) => tracing::warn!(
                    %error,
                    "каталог OpenRouter не обновлён — работают прежние цены из базы"
                ),
            }
        }
        None => {
            if provider_exists(pool, OPENROUTER).await? {
                catalog::ensure_provider(
                    pool,
                    OPENROUTER,
                    "openrouter",
                    &args.openrouter_base_url,
                    false,
                )
                .await?;
            }
            tracing::info!("AI выключен: не задан QUBITE_AI_OPENROUTER_API_KEY");
        }
    }
    let chatgpt = start_chatgpt(pool, args).await?;
    if let Some(provider) = &chatgpt {
        gateway = gateway.with_provider(chatgpt::PROVIDER_ID, provider.clone());
    }
    Ok(AiRuntime {
        gateway: Arc::new(gateway),
        openrouter,
        catalog: report,
        recovered,
        chatgpt,
    })
}

/// ChatGPT по подписке: только при `QUBITE_AI_CHATGPT_ENABLED=true`, ключе
/// шифрования и выполненном входе. Модели подписки — в каталог по 0 $;
/// включает их owner (`qubite ai model chatgpt:<модель> on`).
async fn start_chatgpt(pool: &PgPool, args: &AiArgs) -> anyhow::Result<Option<Arc<ChatGpt>>> {
    let connected = chatgpt::status(pool).await?.connected;
    let ready = args.chatgpt_enabled && connected;
    if !args.chatgpt_enabled {
        if provider_exists(pool, chatgpt::PROVIDER_ID).await? {
            catalog::ensure_provider(
                pool,
                chatgpt::PROVIDER_ID,
                "chatgpt",
                &args.chatgpt_api_url,
                false,
            )
            .await?;
        }
        return Ok(None);
    }
    let Some(secret) = args.secret_box()? else {
        tracing::warn!("ChatGPT включён, но не задан QUBITE_AI_SECRET_KEY — провайдер выключен");
        return Ok(None);
    };
    catalog::ensure_provider(
        pool,
        chatgpt::PROVIDER_ID,
        "chatgpt",
        &args.chatgpt_api_url,
        ready,
    )
    .await?;
    if !ready {
        tracing::info!("ChatGPT включён, но вход не выполнен: qubite ai chatgpt login");
        return Ok(None);
    }
    let provider = Arc::new(
        ChatGpt::new(pool.clone(), args.chatgpt_config(), Arc::new(secret))
            .map_err(anyhow::Error::msg)?,
    );
    match tokio::time::timeout(Duration::from_secs(30), provider.models()).await {
        Ok(Ok(entries)) => {
            catalog::apply(pool, chatgpt::PROVIDER_ID, &entries, &Allowlist::Keep).await?;
        }
        Ok(Err(error)) => tracing::warn!(%error, "модели подписки ChatGPT не получены"),
        Err(_) => tracing::warn!("модели подписки ChatGPT не получены за 30 с"),
    }
    Ok(Some(provider))
}

/// Обновить цены и allowlist из каталога OpenRouter.
pub async fn sync_catalog(
    pool: &PgPool,
    provider: &OpenRouter,
    args: &AiArgs,
) -> anyhow::Result<SyncReport> {
    let entries = tokio::time::timeout(Duration::from_secs(30), provider.catalog())
        .await
        .context("каталог OpenRouter не ответил за 30 с")??;
    let first_run = !catalog::has_models(pool, OPENROUTER).await?;
    let report = catalog::apply(pool, OPENROUTER, &entries, &args.allowlist(first_run)).await?;
    tracing::info!(enabled = ?report.enabled, missing = ?report.missing, "каталог OpenRouter обновлён");
    Ok(report)
}

async fn provider_exists(pool: &PgPool, id: &str) -> anyhow::Result<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM ai_providers WHERE id = $1)")
            .bind(id)
            .fetch_one(pool)
            .await?,
    )
}

/// Фоновое обслуживание: раз в минуту — «зависшие» вызовы → `unknown`,
/// раз в `catalog_refresh_hours` — цены из каталога.
pub fn spawn_maintenance(
    pool: PgPool,
    args: AiArgs,
    openrouter: Option<Arc<OpenRouter>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut tick = tokio::time::interval(Duration::from_secs(60));
        tick.tick().await; // первый тик сразу — его уже сделал запуск
        let refresh = Duration::from_secs(args.catalog_refresh_hours * 3600);
        let mut last_catalog = tokio::time::Instant::now();
        loop {
            tick.tick().await;
            match qubite_ai::recover_stale(&pool, args.stale_after()).await {
                Ok(0) => {}
                Ok(recovered) => tracing::warn!(recovered, "AI-вызовы помечены unknown"),
                Err(error) => tracing::warn!(%error, "восстановление AI-вызовов не удалось"),
            }
            if let Some(provider) = &openrouter
                && last_catalog.elapsed() >= refresh
            {
                last_catalog = tokio::time::Instant::now();
                if let Err(error) = sync_catalog(&pool, provider, &args).await {
                    tracing::warn!(%error, "каталог OpenRouter не обновлён");
                }
            }
        }
    })
}

// ---------------------------------------------------------------- команды owner

#[derive(Subcommand, Debug)]
pub enum AiCommand {
    /// Режим «owner без личного лимита»: on, off или status.
    OwnerUnlimited {
        #[arg(value_enum)]
        state: Switch,
    },
    /// Модели: цены, разрешена ли, заблокирована ли.
    Models,
    /// Каталог OpenRouter (обновляется при запуске и раз в сутки): что можно включить.
    Catalog {
        /// Часть имени модели, например `gemini`.
        search: Option<String>,
    },
    /// Модель: разрешить (on) из каталога или запретить (off); провайдеры
    /// OpenRouter и `data_collection`.
    Model {
        /// Имя модели, как в каталоге (`google/gemini-2.5-flash-lite`).
        id: String,
        #[arg(value_enum)]
        state: Option<OnOff>,
        /// Провайдеры OpenRouter через запятую по порядку (slug, например
        /// `google-vertex,google-ai-studio`) — только они, без автосмены.
        /// `auto` — пусть OpenRouter выбирает сам.
        #[arg(long)]
        providers: Option<String>,
        /// `allow`, `deny` или `server` (как в настройке сервера).
        #[arg(long)]
        data_collection: Option<String>,
    },
    /// Выбрать модель по умолчанию или для задачи (`--task inbox.triage`);
    /// `none` — убрать выбор.
    Use {
        model: String,
        #[arg(long, default_value = "default")]
        task: String,
    },
    /// Снять блокировку модели (после ответа дороже оценки).
    Unblock { id: String },
    /// Задать лимит. Новый лимит считает расход с нуля; 0 — запрещено.
    Limit {
        /// `platform`, `user:<почта>`, `module:<id>`, `model:<id>`,
        /// `provider:<id>`, `user-module:<почта>/<модуль>`.
        #[arg(long)]
        scope: String,
        #[arg(long, value_enum)]
        period: PeriodArg,
        #[arg(long, value_enum)]
        metric: MetricArg,
        /// Для usd — доллары (`1.50`), иначе — штуки.
        #[arg(long)]
        value: String,
    },
    /// Действующие лимиты, резерв и расход (сумма за все периоды).
    Limits,
    /// Новый ключ шифрования для QUBITE_AI_SECRET_KEY (печатается один раз).
    SecretKey,
    /// ChatGPT по подписке: вход, состояние, выход.
    Chatgpt {
        #[command(subcommand)]
        command: ChatgptCommand,
    },
    /// Настоящий вызов модели от имени owner — через шлюз, с бюджетом
    /// и аудитом (ручная проверка ключа). Стоит денег.
    Try {
        /// Текст, который модель разберёт (как мысль во «Входящих»).
        text: String,
        #[arg(long, default_value = "google/gemini-2.5-flash-lite")]
        model: String,
        /// Модуль, от имени которого идёт запрос (должен быть установлен).
        #[arg(long, default_value = "inbox")]
        module: String,
        /// Потолок ответа в токенах.
        #[arg(long, default_value_t = 200)]
        max_tokens: u32,
    },
}

#[derive(Subcommand, Debug)]
pub enum ChatgptCommand {
    /// Войти через браузер (Sign in with ChatGPT). Нужен ChatGPT Plus или Pro.
    /// На удалённом сервере: `ssh -L 1455:127.0.0.1:1455 сервер` и открыть адрес у себя.
    Login {
        /// Порт для возврата из браузера на 127.0.0.1.
        #[arg(long, default_value_t = 1455)]
        port: u16,
        /// Не открывать браузер, только напечатать адрес.
        #[arg(long)]
        no_browser: bool,
    },
    /// Подключена ли подписка и чья.
    Status,
    /// Выйти: отозвать токен у OpenAI и стереть его здесь.
    Logout,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum Switch {
    On,
    Off,
    Status,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum OnOff {
    On,
    Off,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum PeriodArg {
    Hour,
    Day,
    Month,
    All,
}

#[derive(Clone, Copy, Debug, ValueEnum)]
pub enum MetricArg {
    Usd,
    Requests,
    Tokens,
}

/// Owner Console для команд из консоли сервера: у кого есть доступ к базе
/// сервера, тот и так владеет установкой. В аудите — от имени owner.
async fn owner(pool: &PgPool) -> anyhow::Result<OwnerConsole> {
    let Some(account) = qubite_auth::owner::current(pool).await? else {
        bail!("owner платформы ещё не создан: qubite owner create");
    };
    Ok(qubite_policy::decide_owner(pool, &Subject::account(account.id, None)).await?)
}

async fn account_by_email(pool: &PgPool, email: &str) -> anyhow::Result<Uuid> {
    sqlx::query_scalar("SELECT id FROM accounts WHERE email = lower(btrim($1))")
        .bind(email)
        .fetch_optional(pool)
        .await?
        .with_context(|| format!("нет аккаунта с почтой {email}"))
}

async fn parse_scope(pool: &PgPool, scope: &str) -> anyhow::Result<LimitScope> {
    let module = |id: &str| ModuleId::new(id).with_context(|| format!("неверный модуль {id}"));
    Ok(match scope.split_once(':') {
        None if scope == "platform" => LimitScope::Platform,
        None if scope == "each-user" => LimitScope::EachUser,
        Some(("user", email)) => LimitScope::User(account_by_email(pool, email).await?),
        Some(("module", id)) => LimitScope::Module(module(id)?),
        Some(("model", id)) => LimitScope::Model(id.into()),
        Some(("provider", id)) => LimitScope::Provider(id.into()),
        Some(("user-module", rest)) => {
            let (email, id) = rest
                .rsplit_once('/')
                .context("user-module:<почта>/<модуль>")?;
            LimitScope::UserModule(account_by_email(pool, email).await?, module(id)?)
        }
        _ => bail!(
            "область лимита: platform, user:<почта>, module:<id>, model:<id>, provider:<id>, user-module:<почта>/<модуль>"
        ),
    })
}

async fn run_chatgpt(
    pool: &PgPool,
    args: &AiArgs,
    command: ChatgptCommand,
) -> anyhow::Result<String> {
    let config = args.chatgpt_config();
    match command {
        ChatgptCommand::Login { port, no_browser } => {
            let owner = owner(pool).await?;
            let secret = args
                .secret_box()?
                .context("сначала задайте QUBITE_AI_SECRET_KEY (qubite ai secret-key)")?;
            let result = chatgpt::login(pool, &config, &secret, owner.account_id(), port, |url| {
                println!("Откройте в браузере и войдите в ChatGPT:\n\n{url}\n");
                if !no_browser {
                    open_browser(url);
                }
            })
            .await
            .map_err(anyhow::Error::msg)?;
            let mut out = format!(
                "ChatGPT подключён: {} (client_id {}).",
                result.email.as_deref().unwrap_or("почта не сообщена"),
                result.client_id
            );
            if !args.chatgpt_enabled {
                out.push_str(
                    "\nЧтобы им пользоваться: QUBITE_AI_CHATGPT_ENABLED=true и перезапуск сервера.",
                );
            }
            out.push_str("\nМодели подписки появятся в `qubite ai catalog` после запуска; включить — `qubite ai model chatgpt:<модель> on`.");
            Ok(out)
        }
        ChatgptCommand::Status => {
            let status = chatgpt::status(pool).await?;
            Ok(if status.connected {
                format!(
                    "ChatGPT подключён: {}; разрешения: {}; флаг QUBITE_AI_CHATGPT_ENABLED = {}",
                    status.email.as_deref().unwrap_or("—"),
                    status.scopes.as_deref().unwrap_or("—"),
                    args.chatgpt_enabled
                )
            } else {
                "ChatGPT не подключён: qubite ai chatgpt login".into()
            })
        }
        ChatgptCommand::Logout => {
            let secret = args
                .secret_box()?
                .context("нужен QUBITE_AI_SECRET_KEY, чтобы отозвать токен")?;
            let revoked = chatgpt::logout(pool, &config, &secret)
                .await
                .map_err(anyhow::Error::msg)?;
            Ok(if revoked {
                "Вы вышли из ChatGPT: токен отозван у OpenAI и стёрт здесь.".into()
            } else {
                "Токены стёрты здесь, но отзыв у OpenAI не подтверждён — отключите Qubite в ChatGPT → Настройки.".into()
            })
        }
    }
}

/// Открыть адрес в системном браузере (если не получилось — адрес уже напечатан).
fn open_browser(url: &str) {
    let opener = if cfg!(target_os = "macos") {
        "open"
    } else if cfg!(windows) {
        "explorer"
    } else {
        "xdg-open"
    };
    let _ = std::process::Command::new(opener)
        .arg(url)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn();
}

/// id, провайдер, цена входа, цена выхода, разрешена, блокировка, дата цен,
/// провайдеры OpenRouter, data_collection.
type ModelLine = (
    String,
    String,
    i64,
    i64,
    bool,
    Option<String>,
    String,
    Vec<String>,
    Option<String>,
);

/// `a, b` → `["a", "b"]`; `auto` или пусто — пусть провайдер выбирает сам.
pub fn parse_providers(value: &str) -> Vec<String> {
    if value.trim().eq_ignore_ascii_case("auto") {
        return Vec::new();
    }
    value
        .split(',')
        .map(|p| p.trim().to_lowercase())
        .filter(|p| !p.is_empty())
        .collect()
}
/// область, цель, период, метрика, лимит, резерв, потрачено.
type LimitLine = (String, Option<String>, String, String, i64, i64, i64);

/// Выполнить команду `qubite ai …`; результат — текст для человека.
pub async fn run(db: &Database, args: &AiArgs, command: AiCommand) -> anyhow::Result<String> {
    let pool = db.pool();
    match command {
        AiCommand::SecretKey => Ok(format!(
            "QUBITE_AI_SECRET_KEY={}\nПоложите в .env (права 600). Потеряете ключ — придётся войти в ChatGPT заново.",
            SecretBox::generate_key()
        )),
        AiCommand::Chatgpt { command } => run_chatgpt(pool, args, command).await,
        AiCommand::Try {
            text,
            model,
            module,
            max_tokens,
        } => {
            let console = owner(pool).await?;
            let runtime = start(db, args).await?;
            if runtime.openrouter.is_none() {
                bail!("не задан QUBITE_AI_OPENROUTER_API_KEY");
            }
            let module =
                ModuleId::new(&module).with_context(|| format!("неверный модуль {module}"))?;
            let auth = qubite_policy::decide::<qubite_policy::UseAi>(
                pool,
                &Subject::account(console.account_id(), None),
                &module,
            )
            .await
            .with_context(|| format!("модуль {module} недоступен для AI"))?;
            let request = qubite_ai::AiRequest {
                request_id: format!("cli-try-{}", Uuid::now_v7()),
                model,
                prompt: "Это проверка связи Qubite. Коротко, в 1–2 предложениях по-русски, \
                         скажи, что за мысль в данных и какой у неё может быть следующий шаг."
                    .into(),
                untrusted: vec![qubite_ai::Untrusted::new("cli", text)],
                input_tokens: 0,
                max_output_tokens: max_tokens,
                job_id: None,
            };
            let reply = runtime.gateway.complete(&auth, request).await?;
            Ok(format!(
                "{}\n\n— токены: {} вход, {} выход; списано {}; вызов {}{}",
                reply.text.trim(),
                reply.tokens_in,
                reply.tokens_out,
                format_usd(reply.cost_usd),
                reply.call_id,
                if reply.warnings.is_empty() {
                    String::new()
                } else {
                    format!("; предупреждения защиты: {}", reply.warnings.join(", "))
                }
            ))
        }
        AiCommand::OwnerUnlimited { state } => {
            let owner = owner(pool).await?;
            match state {
                Switch::Status => {}
                Switch::On => admin::set_owner_unlimited(pool, &owner, true).await?,
                Switch::Off => admin::set_owner_unlimited(pool, &owner, false).await?,
            }
            Ok(if admin::owner_unlimited(pool).await? {
                "Owner без личного AI-лимита: ВКЛЮЧЕНО. Ограничивают только общие лимиты \
                 платформы, модулей и моделей и лимит самого ключа OpenRouter."
                    .into()
            } else {
                "Owner без личного AI-лимита: выключено (нужен личный лимит, как у всех).".into()
            })
        }
        AiCommand::Models => {
            let rows: Vec<ModelLine> = sqlx::query_as(
                "SELECT id, provider_id, price_in_per_mtok, price_out_per_mtok, enabled, blocked_reason, \
                        to_char(prices_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI'), \
                        routing_providers, data_collection \
                 FROM ai_models ORDER BY provider_id, id",
            )
            .fetch_all(pool)
            .await?;
            if rows.is_empty() {
                return Ok(
                    "Моделей нет. Задайте QUBITE_AI_OPENROUTER_API_KEY и перезапустите сервер."
                        .into(),
                );
            }
            let mut out = String::from(
                "модель | провайдер | $ за 1M вход / выход | разрешена | цены от (UTC)\n",
            );
            let tasks = admin::task_models(pool).await?;
            for (
                id,
                provider,
                price_in,
                price_out,
                enabled,
                blocked,
                updated,
                routing,
                collection,
            ) in rows
            {
                let state = match (enabled, blocked) {
                    (_, Some(reason)) => format!("ЗАБЛОКИРОВАНА ({reason})"),
                    (true, None) => "да".into(),
                    (false, None) => "нет".into(),
                };
                let used: Vec<&str> = tasks
                    .iter()
                    .filter(|(_, model)| model == &id)
                    .map(|(task, _)| task.as_str())
                    .collect();
                out.push_str(&format!(
                    "{id} | {provider} | {} / {} | {state} | {updated} | провайдеры: {} | data_collection: {} | задачи: {}\n",
                    format_usd(price_in),
                    format_usd(price_out),
                    if routing.is_empty() { "авто".to_owned() } else { routing.join(", ") },
                    collection.as_deref().unwrap_or("по серверу"),
                    if used.is_empty() { "—".to_owned() } else { used.join(", ") },
                ));
            }
            Ok(out)
        }
        AiCommand::Catalog { search } => {
            let rows: Vec<(String, i64, i64, i32, bool)> = sqlx::query_as(
                "SELECT c.external_id, c.price_in_per_mtok, c.price_out_per_mtok, c.context_tokens, \
                        coalesce(m.enabled, false) \
                 FROM ai_catalog c LEFT JOIN ai_models m \
                   ON m.provider_id = c.provider_id AND m.external_id = c.external_id \
                 WHERE c.provider_id = $1 AND ($2::text IS NULL OR c.external_id ILIKE '%' || $2 || '%') \
                 ORDER BY c.price_out_per_mtok, c.external_id LIMIT 100",
            )
            .bind(OPENROUTER)
            .bind(search.as_deref())
            .fetch_all(pool)
            .await?;
            if rows.is_empty() {
                return Ok("В каталоге ничего (нет ключа OpenRouter, каталог ещё не загружен или ничего не найдено).".into());
            }
            let mut out = String::from("модель | $ за 1M вход / выход | контекст | разрешена\n");
            for (id, price_in, price_out, context, enabled) in rows {
                out.push_str(&format!(
                    "{id} | {} / {} | {context} | {}\n",
                    format_usd(price_in),
                    format_usd(price_out),
                    if enabled { "да" } else { "нет" }
                ));
            }
            Ok(out)
        }
        AiCommand::Model {
            id,
            state,
            providers,
            data_collection,
        } => {
            let owner = owner(pool).await?;
            if state.is_none() && providers.is_none() && data_collection.is_none() {
                bail!("укажите on/off, --providers или --data-collection");
            }
            let id = catalog::model_id(&id);
            let mut done = Vec::new();
            match state {
                Some(OnOff::On) => {
                    let (provider, external) = catalog::split_model_id(&id);
                    admin::enable_from_catalog(pool, &owner, provider, external)
                        .await
                        .or_else(|error| match error {
                            // Не из каталога (например, mock) — просто включить известную.
                            qubite_ai::AiError::Invalid(_) => Ok(id.clone()),
                            other => Err(other),
                        })?;
                    admin::set_model_enabled(pool, &owner, &id, true).await?;
                    done.push("разрешена".to_owned());
                }
                Some(OnOff::Off) => {
                    admin::set_model_enabled(pool, &owner, &id, false).await?;
                    done.push("запрещена".to_owned());
                }
                None => {}
            }
            if providers.is_some() || data_collection.is_some() {
                let current: Option<(Vec<String>, Option<String>)> = sqlx::query_as(
                    "SELECT routing_providers, data_collection FROM ai_models WHERE id = $1",
                )
                .bind(&id)
                .fetch_optional(pool)
                .await?;
                let (mut list, mut collection) = current.with_context(|| {
                    format!("нет модели {id} — сначала: qubite ai model {id} on")
                })?;
                if let Some(providers) = providers {
                    list = parse_providers(&providers);
                }
                if let Some(value) = data_collection {
                    collection = match value.as_str() {
                        "server" => None,
                        other => Some(other.to_owned()),
                    };
                }
                admin::set_model_routing(pool, &owner, &id, &list, collection.as_deref()).await?;
                done.push(format!(
                    "провайдеры: {}; data_collection: {}",
                    if list.is_empty() {
                        "выбирает OpenRouter".to_owned()
                    } else {
                        format!("{} (без автосмены)", list.join(", "))
                    },
                    collection.as_deref().unwrap_or("как в настройке сервера")
                ));
            }
            Ok(format!("Модель {id}: {}", done.join("; ")))
        }
        AiCommand::Use { model, task } => {
            let owner = owner(pool).await?;
            if model == "none" {
                admin::set_task_model(pool, &owner, &task, None).await?;
                return Ok(format!("Для «{task}» модель не выбрана"));
            }
            let model = catalog::model_id(&model);
            admin::set_task_model(pool, &owner, &task, Some(&model)).await?;
            Ok(format!("Для «{task}» — модель {model}"))
        }
        AiCommand::Unblock { id } => {
            let owner = owner(pool).await?;
            admin::unblock_model(pool, &owner, &id).await?;
            Ok(format!("Блокировка модели {id} снята"))
        }
        AiCommand::Limit {
            scope,
            period,
            metric,
            value,
        } => {
            let owner = owner(pool).await?;
            let scope = parse_scope(pool, &scope).await?;
            let metric = match metric {
                MetricArg::Usd => Metric::Usd,
                MetricArg::Requests => Metric::Requests,
                MetricArg::Tokens => Metric::Tokens,
            };
            let period = match period {
                PeriodArg::Hour => Period::Hour,
                PeriodArg::Day => Period::Day,
                PeriodArg::Month => Period::Month,
                PeriodArg::All => Period::All,
            };
            let amount = match metric {
                Metric::Usd => parse_usd(&value).map_err(anyhow::Error::msg)?,
                _ => value.trim().parse().context("нужно целое число")?,
            };
            admin::set_limit(pool, &owner, &scope, period, metric, amount).await?;
            let shown = if metric == Metric::Usd {
                format_usd(amount)
            } else {
                amount.to_string()
            };
            Ok(format!(
                "Лимит задан: {scope:?}, {} {}, {shown}",
                period.as_str(),
                metric.as_str()
            ))
        }
        AiCommand::Limits => {
            let rows: Vec<LimitLine> = sqlx::query_as(
                "SELECT l.scope_kind, coalesce(a.email, l.module_id, l.model_id, l.provider_id) \
                        || CASE WHEN l.scope_kind = 'user_module' THEN '/' || l.module_id ELSE '' END, \
                        l.period, l.metric, l.limit_value, \
                        coalesce(sum(c.reserved), 0)::bigint, coalesce(sum(c.spent), 0)::bigint \
                 FROM ai_limits l LEFT JOIN accounts a ON a.id = l.account_id \
                 LEFT JOIN ai_usage_counters c ON c.limit_id = l.id \
                 WHERE l.revoked_at IS NULL \
                 GROUP BY l.id, a.email ORDER BY l.scope_kind, 2, l.period, l.metric",
            )
            .fetch_all(pool)
            .await?;
            let unlimited = admin::owner_unlimited(pool).await?;
            let mut out = format!(
                "Owner без личного лимита: {}\n",
                if unlimited {
                    "включено"
                } else {
                    "выключено"
                }
            );
            if rows.is_empty() {
                out.push_str("Лимитов нет: AI не доступен никому (бюджет по умолчанию — ноль).\n");
            }
            for (kind, target, period, metric, limit, reserved, spent) in rows {
                let money = |v: i64| {
                    if metric == "usd" {
                        format_usd(v)
                    } else {
                        v.to_string()
                    }
                };
                out.push_str(&format!(
                    "{kind} {} | {period} {metric} | лимит {} | резерв {} | потрачено {} (за все периоды)\n",
                    target.unwrap_or_default(),
                    money(limit),
                    money(reserved),
                    money(spent)
                ));
            }
            Ok(out)
        }
    }
}

// ---------------------------------------------------------------- Owner Console API

impl From<qubite_ai::AiError> for ApiError {
    fn from(error: qubite_ai::AiError) -> Self {
        use qubite_ai::AiError as E;
        let status = match &error {
            E::Invalid(_) => StatusCode::BAD_REQUEST,
            E::Db(_) | E::Audit(_) => {
                tracing::error!(%error, "AI: внутренняя ошибка");
                return Self::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "internal",
                    "внутренняя ошибка",
                );
            }
            E::Denied(reason) => {
                StatusCode::from_u16(reason.http_status()).unwrap_or(StatusCode::FORBIDDEN)
            }
            _ => StatusCode::CONFLICT,
        };
        Self::new(status, error.code(), error.to_string())
    }
}

/// Модель в Owner Console.
#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct AiModelItem {
    /// ID в Qubite (имя модели строчными).
    pub id: String,
    pub provider_id: String,
    /// Имя у провайдера.
    pub external_id: String,
    /// Микродоллары за миллион токенов.
    pub price_in_per_mtok: i64,
    pub price_out_per_mtok: i64,
    pub context_tokens: i32,
    /// В allowlist.
    pub enabled: bool,
    /// Заблокирована (например, ответ дороже оценки) — снимает owner.
    pub blocked_reason: Option<String>,
    /// Провайдеры OpenRouter по порядку; пусто — выбирает OpenRouter.
    pub routing_providers: Vec<String>,
    /// `allow` / `deny`; пусто — по настройке сервера.
    pub data_collection: Option<String>,
    /// Задачи, для которых выбрана модель (`default`, `inbox.triage` …).
    pub tasks: Vec<String>,
}

/// Модель из каталога провайдера.
#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct AiCatalogItem {
    pub external_id: String,
    pub price_in_per_mtok: i64,
    pub price_out_per_mtok: i64,
    pub context_tokens: i32,
    /// Уже разрешена.
    pub enabled: bool,
}

#[derive(Debug, Deserialize, ToSchema, utoipa::IntoParams)]
pub struct CatalogQuery {
    /// Часть имени модели.
    pub search: Option<String>,
}

/// `data_collection` модели: как в настройке сервера, разрешить или запретить.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum DataCollectionSetting {
    Server,
    Allow,
    Deny,
}

/// Изменение модели. Пустые поля не меняются.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AiModelChange {
    /// `true` — разрешить (из каталога), `false` — запретить.
    pub enabled: Option<bool>,
    /// Провайдеры OpenRouter (slug) по порядку — только они, без автосмены;
    /// `[]` — пусть OpenRouter выбирает сам.
    pub routing_providers: Option<Vec<String>>,
    pub data_collection: Option<DataCollectionSetting>,
}

/// Модель для задачи.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct TaskModel {
    pub task: String,
    pub model_id: String,
}

/// Выбор модели для задачи; `null` — убрать.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TaskModelChange {
    pub model_id: Option<String>,
}

async fn model_items(pool: &PgPool) -> Result<Vec<AiModelItem>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT m.id, m.provider_id, m.external_id, m.price_in_per_mtok, m.price_out_per_mtok, \
                m.context_tokens, m.enabled, m.blocked_reason, m.routing_providers, m.data_collection, \
                coalesce(array_agg(d.task ORDER BY d.task) FILTER (WHERE d.task IS NOT NULL), '{}') AS tasks \
         FROM ai_models m LEFT JOIN ai_model_defaults d ON d.model_id = m.id \
         GROUP BY m.id ORDER BY m.provider_id, m.id",
    )
    .fetch_all(pool)
    .await
    .map_err(qubite_ai::AiError::from)?)
}

/// Owner Console: модели (разрешённые и нет), их провайдеры и задачи.
#[utoipa::path(get, path = "/api/owner/ai/models", tag = "owner",
    responses(
        (status = 200, description = "Модели", body = Vec<AiModelItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_ai_models(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<Vec<AiModelItem>>, ApiError> {
    Ok(Json(model_items(state.db.pool()).await?))
}

/// Owner Console: каталог OpenRouter — из него включаются модели.
#[utoipa::path(get, path = "/api/owner/ai/catalog", tag = "owner", params(CatalogQuery),
    responses(
        (status = 200, description = "Каталог (до 200 моделей, дешёвые первыми)", body = Vec<AiCatalogItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_ai_catalog(
    State(state): State<AppState>,
    _owner: Owner,
    Query(query): Query<CatalogQuery>,
) -> Result<Json<Vec<AiCatalogItem>>, ApiError> {
    let items = sqlx::query_as(
        "SELECT c.external_id, c.price_in_per_mtok, c.price_out_per_mtok, c.context_tokens, \
                coalesce(m.enabled, false) AS enabled \
         FROM ai_catalog c LEFT JOIN ai_models m \
           ON m.provider_id = c.provider_id AND m.external_id = c.external_id \
         WHERE c.provider_id = $1 AND ($2::text IS NULL OR c.external_id ILIKE '%' || $2 || '%') \
         ORDER BY c.price_out_per_mtok, c.external_id LIMIT 200",
    )
    .bind(OPENROUTER)
    .bind(query.search.as_deref())
    .fetch_all(state.db.pool())
    .await
    .map_err(qubite_ai::AiError::from)?;
    Ok(Json(items))
}

/// Owner Console: разрешить/запретить модель, задать провайдеров и `data_collection`.
#[utoipa::path(patch, path = "/api/owner/ai/models/{id}", tag = "owner", request_body = AiModelChange,
    params(("id" = String, Path, description = "ID модели, например `google/gemini-2.5-flash-lite`")),
    responses(
        (status = 403, description = "`confirm_required`: нужен пароль (D-285)", body = ApiErrorBody),
        (status = 200, description = "Модель изменена", body = AiModelItem),
        (status = 400, description = "Неверное значение или модели нет", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_ai_update_model(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: crate::auth::Authenticated,
    Path(id): Path<String>,
    Json(change): Json<AiModelChange>,
) -> Result<Json<AiModelItem>, ApiError> {
    crate::console::require_confirmed(&state, &session).await?;
    let pool = state.db.pool();
    let id = catalog::model_id(&id);
    match change.enabled {
        Some(true) => {
            let (provider, external) = catalog::split_model_id(&id);
            if let Err(error) = admin::enable_from_catalog(pool, &owner, provider, external).await {
                match error {
                    qubite_ai::AiError::Invalid(_) => {
                        admin::set_model_enabled(pool, &owner, &id, true).await?
                    }
                    other => return Err(other.into()),
                }
            }
        }
        Some(false) => admin::set_model_enabled(pool, &owner, &id, false).await?,
        None => {}
    }
    if change.routing_providers.is_some() || change.data_collection.is_some() {
        let current: Option<(Vec<String>, Option<String>)> = sqlx::query_as(
            "SELECT routing_providers, data_collection FROM ai_models WHERE id = $1",
        )
        .bind(&id)
        .fetch_optional(pool)
        .await
        .map_err(qubite_ai::AiError::from)?;
        let Some((mut providers, mut collection)) = current else {
            return Err(qubite_ai::AiError::Invalid(format!("нет модели {id}")).into());
        };
        if let Some(list) = change.routing_providers {
            providers = list.iter().map(|p| p.trim().to_lowercase()).collect();
        }
        if let Some(setting) = change.data_collection {
            collection = match setting {
                DataCollectionSetting::Server => None,
                DataCollectionSetting::Allow => Some("allow".into()),
                DataCollectionSetting::Deny => Some("deny".into()),
            };
        }
        admin::set_model_routing(pool, &owner, &id, &providers, collection.as_deref()).await?;
    }
    model_items(pool)
        .await?
        .into_iter()
        .find(|m| m.id == id)
        .map(Json)
        .ok_or_else(|| qubite_ai::AiError::Invalid(format!("нет модели {id}")).into())
}

/// Owner Console: какие модели выбраны по умолчанию и для задач.
#[utoipa::path(get, path = "/api/owner/ai/tasks", tag = "owner",
    responses(
        (status = 200, description = "Задачи и модели", body = Vec<TaskModel>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_ai_tasks(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<Vec<TaskModel>>, ApiError> {
    let tasks = admin::task_models(state.db.pool()).await?;
    Ok(Json(
        tasks
            .into_iter()
            .map(|(task, model_id)| TaskModel { task, model_id })
            .collect(),
    ))
}

/// Owner Console: выбрать модель для задачи (`default` — для всех без своей).
#[utoipa::path(put, path = "/api/owner/ai/tasks/{task}", tag = "owner", request_body = TaskModelChange,
    params(("task" = String, Path, description = "`default`, `inbox.triage` …")),
    responses(
        (status = 403, description = "`confirm_required`: нужен пароль (D-285)", body = ApiErrorBody),
        (status = 200, description = "Выбор сохранён", body = Vec<TaskModel>),
        (status = 400, description = "Модель не разрешена или неверная задача", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_ai_set_task(
    State(state): State<AppState>,
    owner: Owner,
    session: crate::auth::Authenticated,
    Path(task): Path<String>,
    Json(change): Json<TaskModelChange>,
) -> Result<Json<Vec<TaskModel>>, ApiError> {
    crate::console::require_confirmed(&state, &session).await?;
    let model = change.model_id.as_deref().map(catalog::model_id);
    admin::set_task_model(state.db.pool(), &owner.0, &task, model.as_deref()).await?;
    owner_ai_tasks(State(state), owner).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dollars_parse_to_micros() {
        assert_eq!(parse_usd("2"), Ok(2_000_000));
        assert_eq!(parse_usd("0.50"), Ok(500_000));
        assert_eq!(parse_usd("0,5"), Ok(500_000));
        assert_eq!(parse_usd(".000001"), Ok(1));
        assert!(parse_usd("0.0000001").is_err());
        assert!(parse_usd("-1").is_err());
        assert!(parse_usd("abc").is_err());
        assert!(parse_usd("").is_err());
        assert_eq!(format_usd(1_500_000), "$1.500000");
        assert_eq!(format_usd(49), "$0.000049");
    }
}
