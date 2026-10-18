//! AI-шлюз в сервере (AI-002): настройки `QUBITE_AI_*`, запуск (восстановление
//! «зависших» вызовов, каталог цен OpenRouter, лимиты платформы), фоновое
//! обслуживание и команды `qubite ai …` для owner.
//!
//! Без ключа OpenRouter AI просто выключен: провайдера нет, запросы получают
//! отказ до любых трат.

use std::{sync::Arc, time::Duration};

use anyhow::{Context, bail};
use clap::{Args, Subcommand, ValueEnum};
use qubite_ai::{
    AiConfig, Gateway, MICROS_PER_USD,
    admin::{self, LimitScope, Metric, Period},
    catalog::{self, Allowlist, STARTER_MODELS, SyncReport},
    openrouter::{self, OpenRouter, OpenRouterConfig},
};
use qubite_db::Database;
use qubite_kernel::Secret;
use qubite_policy::{ModuleId, OwnerConsole, Subject};
use sqlx::PgPool;
use uuid::Uuid;

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

    /// Разрешённые модели OpenRouter через запятую (имена как на openrouter.ai).
    /// Если задано — при каждом запуске разрешены ровно они. Если нет — при
    /// первом запуске стартовый набор, дальше решает owner (`qubite ai model`).
    #[arg(
        long = "ai-openrouter-models",
        env = "QUBITE_AI_OPENROUTER_MODELS",
        value_delimiter = ','
    )]
    pub openrouter_models: Option<Vec<String>>,

    /// Просить OpenRouter отправлять запросы только провайдерам, которые
    /// не сохраняют данные и не учатся на них.
    #[arg(long = "ai-openrouter-deny-data-collection", env = "QUBITE_AI_OPENROUTER_DENY_DATA_COLLECTION",
          default_value_t = true, action = clap::ArgAction::Set)]
    pub deny_data_collection: bool,

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
}

impl AiArgs {
    pub fn gateway_config(&self) -> AiConfig {
        AiConfig {
            timezone: self.timezone.clone(),
            timeout: Duration::from_secs(self.timeout_secs),
            ..AiConfig::default()
        }
        .with_attempts(self.max_attempts)
    }

    /// Вызов «отправляется» дольше этого — точно осиротел (процесс упал):
    /// живой процесс сам пометил бы его `unknown` по таймауту.
    pub fn stale_after(&self) -> Duration {
        Duration::from_secs(self.timeout_secs + 30)
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
            deny_data_collection: self.deny_data_collection,
            ..OpenRouterConfig::new(Secret::new(key.trim()))
        };
        Ok(Some(Arc::new(
            OpenRouter::new(config).map_err(anyhow::Error::msg)?,
        )))
    }

    fn allowlist(&self, first_run: bool) -> Allowlist {
        match &self.openrouter_models {
            Some(list) if list.iter().any(|m| !m.trim().is_empty()) => Allowlist::Exact(
                list.iter()
                    .map(|m| m.trim().to_owned())
                    .filter(|m| !m.is_empty())
                    .collect(),
            ),
            _ if first_run => {
                Allowlist::Exact(STARTER_MODELS.iter().map(|m| (*m).to_owned()).collect())
            }
            _ => Allowlist::Keep,
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

    for (period, value) in [
        (Period::Day, args.platform_usd_per_day),
        (Period::Month, args.platform_usd_per_month),
    ] {
        if let Some(value) = value
            && admin::ensure_limit(pool, &LimitScope::Platform, period, Metric::Usd, value).await?
        {
            tracing::info!(period = period.as_str(), limit = %format_usd(value), "лимит платформы из настроек");
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
    Ok(AiRuntime {
        gateway: Arc::new(gateway),
        openrouter,
        catalog: report,
        recovered,
    })
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
    /// Разрешить (on) или запретить (off) модель.
    Model {
        id: String,
        #[arg(value_enum)]
        state: OnOff,
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

/// id, провайдер, цена входа, цена выхода, разрешена, блокировка, дата цен.
type ModelLine = (String, String, i64, i64, bool, Option<String>, String);
/// область, цель, период, метрика, лимит, резерв, потрачено.
type LimitLine = (String, Option<String>, String, String, i64, i64, i64);

/// Выполнить команду `qubite ai …`; результат — текст для человека.
pub async fn run(db: &Database, args: &AiArgs, command: AiCommand) -> anyhow::Result<String> {
    let pool = db.pool();
    match command {
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
                        to_char(prices_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI') \
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
            for (id, provider, price_in, price_out, enabled, blocked, updated) in rows {
                let state = match (enabled, blocked) {
                    (_, Some(reason)) => format!("ЗАБЛОКИРОВАНА ({reason})"),
                    (true, None) => "да".into(),
                    (false, None) => "нет".into(),
                };
                out.push_str(&format!(
                    "{id} | {provider} | {} / {} | {state} | {updated}\n",
                    format_usd(price_in),
                    format_usd(price_out)
                ));
            }
            Ok(out)
        }
        AiCommand::Model { id, state } => {
            let owner = owner(pool).await?;
            admin::set_model_enabled(pool, &owner, &id, matches!(state, OnOff::On)).await?;
            Ok(format!(
                "Модель {id}: {}",
                if matches!(state, OnOff::On) {
                    "разрешена"
                } else {
                    "запрещена"
                }
            ))
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
