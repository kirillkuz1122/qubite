//! AI и бюджеты кнопками (AI-003, D-530…D-539): Owner Console → AI (лимиты,
//! «сделать мне безлимит», защита от зацикливания, ключи, расход, журнал
//! вызовов) и «Настройки → AI и бюджет» у каждого (свой расход и лимиты,
//! «Подключить AI»: своя подписка ChatGPT, свой ключ OpenRouter или деньги
//! owner по личному лимиту).
//!
//! Всё, что меняет AI в Console, — опасное действие: нужен свежий пароль
//! (D-232, D-285). Каждое изменение — в аудите; ключи — только зашифрованными,
//! на экран и в журнал — последние 4 символа.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use qubite_ai::{
    LoopGuard, MICROS_PER_USD,
    admin::{self, LimitScope, Metric, Period},
    budget,
    catalog::{self, Allowlist},
    chatgpt::{self, ChatGpt, ChatGptConfig},
    openrouter::OpenRouter,
    secret::SecretBox,
};
use qubite_kernel::Secret;
use qubite_policy::ModuleId;
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    console::require_confirmed,
    modules::Owner,
};

/// Потолок платформы, который ставит «Сделать мне безлимит», если его нет (Q-133).
pub const DEFAULT_PLATFORM_DAY_USD: i64 = 5 * MICROS_PER_USD;

/// Что сервер знает об AI для экранов: ключ шифрования, ChatGPT, адаптер
/// OpenRouter (его ключ меняется из Console без перезапуска).
#[derive(Default)]
pub struct AiPanel {
    pub secrets: Option<Arc<SecretBox>>,
    /// `QUBITE_AI_CHATGPT_ENABLED`.
    pub chatgpt_enabled: bool,
    pub chatgpt_config: ChatGptConfig,
    /// Провайдер ChatGPT (если включён): после входа — модели подписки в каталог.
    pub chatgpt: Option<Arc<ChatGpt>>,
    pub openrouter: Option<Arc<OpenRouter>>,
    /// Ключ OpenRouter из настроек сервера (`QUBITE_AI_OPENROUTER_API_KEY`) —
    /// к нему возвращается адаптер, если ключ в Console убрали.
    pub env_key: Option<Secret>,
    /// Голос (ElevenLabs) включён ключом в настройках сервера.
    pub voice: bool,
    /// Пояс периодов (`QUBITE_AI_TIMEZONE`).
    pub timezone: String,
    /// Последняя ошибка входа в ChatGPT у человека (вход закончился без него).
    pub login_errors: Mutex<HashMap<Uuid, String>>,
}

fn ai(error: qubite_ai::AiError) -> ApiError {
    error.into()
}

fn db(error: sqlx::Error) -> ApiError {
    ai(qubite_ai::AiError::Db(error))
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "invalid", message)
}

fn timezone(state: &AppState) -> String {
    if state.ai_panel.timezone.is_empty() {
        "Asia/Yekaterinburg".into()
    } else {
        state.ai_panel.timezone.clone()
    }
}

/// Последние 4 символа ключа — чтобы узнать его на экране.
fn hint(key: &str) -> String {
    let chars: Vec<char> = key.chars().collect();
    chars[chars.len().saturating_sub(4)..].iter().collect()
}

/// Похоже ли на ключ API: печатные символы без пробелов, 16…300 знаков.
fn check_key(key: &str) -> Result<&str, ApiError> {
    let key = key.trim();
    if !(16..=300).contains(&key.len()) || !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(invalid(
            "ключ не похож на ключ API: без пробелов, от 16 до 300 символов",
        ));
    }
    Ok(key)
}

fn secrets(state: &AppState) -> Result<&Arc<SecretBox>, ApiError> {
    state.ai_panel.secrets.as_ref().ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "secret_key_not_set",
            "На сервере не задан QUBITE_AI_SECRET_KEY — ключи и вход в ChatGPT хранить нечем \
             (создать: just qubite ai secret-key, вписать в .env и перезапустить)",
        )
    })
}

// ---------------------------------------------------------------- лимиты

/// Живой лимит и сколько израсходовано в текущем периоде.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct AiLimitItem {
    pub id: Uuid,
    /// `platform`, `user`, `module`, `model`, `provider`, `user_module`, `each_user`.
    pub scope: String,
    pub account_id: Option<Uuid>,
    pub account_email: Option<String>,
    pub module_id: Option<String>,
    pub model_id: Option<String>,
    pub provider_id: Option<String>,
    /// `hour`, `day`, `month`, `all`.
    pub period: String,
    /// `usd` (микродоллары), `requests`, `tokens`.
    pub metric: String,
    pub value: i64,
    /// Потрачено и зарезервировано в текущем периоде; у «на каждого» — больше
    /// всех (у кого счётчик ближе к потолку).
    pub used: i64,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    pub created_at: OffsetDateTime,
}

type LimitRow = (
    Uuid,
    String,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    String,
    String,
    i64,
    OffsetDateTime,
);

/// Лимиты с расходом за текущий период. `only` — только эти (личные человека).
async fn limit_items(state: &AppState, who: Option<Uuid>) -> Result<Vec<AiLimitItem>, ApiError> {
    let pool = state.db.pool();
    let mut conn = pool.acquire().await.map_err(db)?;
    let keys = budget::period_keys(&mut conn, OffsetDateTime::now_utc(), &timezone(state))
        .await
        .map_err(ai)?;
    let rows: Vec<LimitRow> = sqlx::query_as(
        "SELECT l.id, l.scope_kind, l.account_id, a.email, l.module_id, l.model_id, l.provider_id, \
                l.period, l.metric, l.limit_value, l.created_at \
         FROM ai_limits l LEFT JOIN accounts a ON a.id = l.account_id \
         WHERE l.revoked_at IS NULL \
           AND ($1::uuid IS NULL OR l.account_id = $1 OR l.scope_kind IN ('each_user', 'platform')) \
         ORDER BY CASE l.scope_kind WHEN 'platform' THEN 0 WHEN 'each_user' THEN 1 \
                  WHEN 'user' THEN 2 WHEN 'user_module' THEN 3 ELSE 4 END, \
                  a.email, l.module_id, l.model_id, l.provider_id, l.period, l.metric",
    )
    .bind(who)
    .fetch_all(&mut *conn)
    .await
    .map_err(db)?;
    let mut items = Vec::with_capacity(rows.len());
    for (id, scope, account_id, email, module, model, provider, period, metric, value, at) in rows {
        let key = keys.key(&period);
        let used: i64 = if scope == "each_user" {
            sqlx::query_scalar(
                "SELECT coalesce(max(reserved + spent), 0)::bigint FROM ai_usage_counters \
                 WHERE limit_id = $1 AND ($3::uuid IS NULL AND period_key LIKE $2 || '#%' \
                       OR period_key = $2 || '#' || $3::text)",
            )
            .bind(id)
            .bind(&key)
            .bind(who)
            .fetch_one(&mut *conn)
            .await
            .map_err(db)?
        } else {
            sqlx::query_scalar(
                "SELECT coalesce(sum(reserved + spent), 0)::bigint FROM ai_usage_counters \
                 WHERE limit_id = $1 AND period_key = $2",
            )
            .bind(id)
            .bind(&key)
            .fetch_one(&mut *conn)
            .await
            .map_err(db)?
        };
        items.push(AiLimitItem {
            id,
            scope,
            account_id,
            account_email: email,
            module_id: module,
            model_id: model,
            provider_id: provider,
            period,
            metric,
            value,
            used,
            created_at: at,
        });
    }
    Ok(items)
}

/// Новый лимит (или новое значение — прежний на то же сочетание закрывается).
#[derive(Debug, Deserialize, ToSchema)]
pub struct AiLimitNew {
    /// `platform`, `user`, `module`, `model`, `provider`, `user_module`, `each_user`.
    pub scope: String,
    pub account_id: Option<Uuid>,
    pub module_id: Option<String>,
    pub model_id: Option<String>,
    pub provider_id: Option<String>,
    /// `hour`, `day`, `month`, `all`.
    pub period: String,
    /// `usd`, `requests`, `tokens`.
    pub metric: String,
    /// Для `usd` — микродоллары (1 $ = 1 000 000). 0 — запрещено.
    pub value: i64,
}

fn parse_limit(new: &AiLimitNew) -> Result<(LimitScope, Period, Metric), ApiError> {
    let need = |v: &Option<String>, what: &str| {
        v.as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| invalid(format!("для этого лимита нужно выбрать {what}")))
    };
    let account = || {
        new.account_id
            .ok_or_else(|| invalid("для этого лимита нужно выбрать человека"))
    };
    let module = || {
        ModuleId::new(&need(&new.module_id, "модуль")?).map_err(|_| invalid("неизвестный модуль"))
    };
    let scope = match new.scope.as_str() {
        "platform" => LimitScope::Platform,
        "each_user" => LimitScope::EachUser,
        "user" => LimitScope::User(account()?),
        "module" => LimitScope::Module(module()?),
        "model" => LimitScope::Model(catalog::model_id(&need(&new.model_id, "модель")?)),
        "provider" => LimitScope::Provider(need(&new.provider_id, "провайдера")?),
        "user_module" => LimitScope::UserModule(account()?, module()?),
        _ => return Err(invalid("неизвестная область лимита")),
    };
    let period = match new.period.as_str() {
        "hour" => Period::Hour,
        "day" => Period::Day,
        "month" => Period::Month,
        "all" => Period::All,
        _ => return Err(invalid("период: hour, day, month или all")),
    };
    let metric = match new.metric.as_str() {
        "usd" => Metric::Usd,
        "requests" => Metric::Requests,
        "tokens" => Metric::Tokens,
        _ => return Err(invalid("метрика: usd, requests или tokens")),
    };
    if new.value < 0 {
        return Err(invalid("лимит не может быть отрицательным"));
    }
    Ok((scope, period, metric))
}

/// Owner Console: все живые лимиты с расходом за текущий период.
#[utoipa::path(get, path = "/api/owner/ai/limits", tag = "owner",
    responses(
        (status = 200, description = "Лимиты", body = Vec<AiLimitItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_limits(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<Vec<AiLimitItem>>, ApiError> {
    Ok(Json(limit_items(&state, None).await?))
}

/// Owner Console: задать лимит (прежний на то же сочетание закрывается).
#[utoipa::path(post, path = "/api/owner/ai/limits", tag = "owner", request_body = AiLimitNew,
    responses(
        (status = 200, description = "Лимиты после изменения", body = Vec<AiLimitItem>),
        (status = 400, description = "Неверное значение", body = ApiErrorBody),
        (status = 403, description = "`confirm_required`: нужен пароль", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_set_limit(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Json(new): Json<AiLimitNew>,
) -> Result<Json<Vec<AiLimitItem>>, ApiError> {
    require_confirmed(&state, &session).await?;
    let (scope, period, metric) = parse_limit(&new)?;
    admin::set_limit(state.db.pool(), &owner, &scope, period, metric, new.value)
        .await
        .map_err(ai)?;
    Ok(Json(limit_items(&state, None).await?))
}

/// Owner Console: снять лимит.
#[utoipa::path(delete, path = "/api/owner/ai/limits/{id}", tag = "owner",
    params(("id" = Uuid, Path, description = "ID лимита")),
    responses(
        (status = 200, description = "Лимиты после изменения", body = Vec<AiLimitItem>),
        (status = 400, description = "Такого лимита нет", body = ApiErrorBody),
        (status = 403, description = "`confirm_required`: нужен пароль", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_revoke_limit(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<Vec<AiLimitItem>>, ApiError> {
    require_confirmed(&state, &session).await?;
    admin::revoke_limit(state.db.pool(), &owner, id)
        .await
        .map_err(ai)?;
    Ok(Json(limit_items(&state, None).await?))
}

// ---------------------------------------------------------------- сводка owner

/// Защита от зацикливания (0 — выключено).
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema, PartialEq, Eq)]
pub struct LoopGuardInfo {
    /// Начатых AI-вызовов в минуту на человека.
    pub user_per_minute: u32,
    /// …на одну фоновую задачу.
    pub job_per_minute: u32,
    /// Один и тот же запрос — не больше стольких раз…
    pub repeat_limit: u32,
    /// …за столько секунд (1…86 400).
    pub repeat_window_secs: u64,
}

impl From<&LoopGuard> for LoopGuardInfo {
    fn from(g: &LoopGuard) -> Self {
        Self {
            user_per_minute: g.user_per_minute,
            job_per_minute: g.job_per_minute,
            repeat_limit: g.repeat_limit,
            repeat_window_secs: g.repeat_window.as_secs(),
        }
    }
}

/// Ключ провайдера платформы.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProviderKeyInfo {
    pub provider: String,
    /// `console` — сохранён в Console, `server` — из настроек сервера, `none` — нет.
    pub source: String,
    /// Последние 4 символа (только у ключа из Console).
    pub hint: Option<String>,
}

/// Owner Console → AI: всё, что нужно для режима «без личного лимита» и защиты.
#[derive(Debug, Serialize, ToSchema)]
pub struct AiOverview {
    /// Режим «owner без личного лимита» включён (D-200).
    pub owner_unlimited: bool,
    /// Личные денежные лимиты owner — пока они есть, действуют они (режим не помогает).
    pub owner_personal_usd: Vec<AiLimitItem>,
    /// Дневной потолок платформы в $ — без него режим не работает (D-212).
    pub platform_day_usd: Option<AiLimitItem>,
    /// Режим действует прямо сейчас: включён, личного лимита в $ нет, потолок есть.
    pub unlimited_works: bool,
    /// Какой потолок поставит «Сделать мне безлимит», если его нет (микродоллары).
    pub default_platform_day_usd: i64,
    pub loop_guard: LoopGuardInfo,
    /// Настройки сервера — к ним вернёт «Как в настройках сервера».
    pub loop_guard_server: LoopGuardInfo,
    /// Защита задана в Console (а не настройками сервера).
    pub loop_guard_from_console: bool,
    pub keys: Vec<ProviderKeyInfo>,
    /// Задан `QUBITE_AI_SECRET_KEY` (без него ключи и ChatGPT не сохранить).
    pub secret_key_set: bool,
    /// ChatGPT по подписке включён на сервере.
    pub chatgpt_enabled: bool,
    /// Сколько человек подключили свою подписку.
    pub chatgpt_people: i64,
    /// Голос (ElevenLabs) включён.
    pub voice: bool,
    pub timezone: String,
    /// Сегодня по всей платформе: $ (микродоллары) и вызовов.
    pub today_usd: i64,
    pub today_requests: i64,
}

async fn overview(state: &AppState, owner_id: Uuid) -> Result<AiOverview, ApiError> {
    let pool = state.db.pool();
    let limits = limit_items(state, None).await?;
    let owner_personal_usd: Vec<AiLimitItem> = limits
        .iter()
        .filter(|l| {
            l.metric == "usd"
                && l.account_id == Some(owner_id)
                && matches!(l.scope.as_str(), "user" | "user_module")
        })
        .cloned()
        .collect();
    let platform_day_usd = limits
        .iter()
        .find(|l| l.scope == "platform" && l.period == "day" && l.metric == "usd")
        .cloned();
    let owner_unlimited = admin::owner_unlimited(pool).await.map_err(ai)?;
    let from_console: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM ai_loop_guard WHERE singleton)")
            .fetch_one(pool)
            .await
            .map_err(db)?;
    let guard = state.ai.loop_guard_now().await.map_err(ai)?;
    let console_key: Option<String> = sqlx::query_scalar(
        "SELECT hint FROM ai_keys WHERE account_id IS NULL AND provider_id = 'openrouter'",
    )
    .fetch_optional(pool)
    .await
    .map_err(db)?;
    let key = match (&console_key, &state.ai_panel.env_key) {
        (Some(h), _) => ProviderKeyInfo {
            provider: "openrouter".into(),
            source: "console".into(),
            hint: Some(h.clone()),
        },
        (None, Some(_)) => ProviderKeyInfo {
            provider: "openrouter".into(),
            source: "server".into(),
            hint: None,
        },
        (None, None) => ProviderKeyInfo {
            provider: "openrouter".into(),
            source: "none".into(),
            hint: None,
        },
    };
    let chatgpt_people: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM ai_chatgpt_tokens WHERE refresh_token_enc IS NOT NULL",
    )
    .fetch_one(pool)
    .await
    .map_err(db)?;
    let (today_usd, today_requests): (i64, i64) = sqlx::query_as(
        "SELECT coalesce(sum(actual_usd), 0)::bigint, count(*) FILTER (WHERE status <> 'failed_not_sent') \
         FROM ai_calls WHERE (created_at AT TIME ZONE $1)::date = (now() AT TIME ZONE $1)::date",
    )
    .bind(timezone(state))
    .fetch_one(pool)
    .await
    .map_err(db)?;
    Ok(AiOverview {
        unlimited_works: owner_unlimited
            && owner_personal_usd.is_empty()
            && platform_day_usd.is_some(),
        owner_unlimited,
        owner_personal_usd,
        platform_day_usd,
        default_platform_day_usd: DEFAULT_PLATFORM_DAY_USD,
        loop_guard: (&guard).into(),
        loop_guard_server: state.ai.loop_guard_default().into(),
        loop_guard_from_console: from_console,
        keys: vec![key],
        secret_key_set: state.ai_panel.secrets.is_some(),
        chatgpt_enabled: state.ai_panel.chatgpt_enabled,
        chatgpt_people,
        voice: state.ai_panel.voice,
        timezone: timezone(state),
        today_usd,
        today_requests,
    })
}

/// Owner Console → AI: сводка (режим owner, потолок, защита, ключи).
#[utoipa::path(get, path = "/api/owner/ai/overview", tag = "owner",
    responses(
        (status = 200, description = "Сводка", body = AiOverview),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_overview(
    State(state): State<AppState>,
    Owner(owner): Owner,
) -> Result<Json<AiOverview>, ApiError> {
    Ok(Json(overview(&state, owner.account_id()).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct Toggle {
    pub enabled: bool,
}

/// Owner Console: режим «owner без личного лимита» вкл/выкл.
#[utoipa::path(put, path = "/api/owner/ai/owner-unlimited", tag = "owner", request_body = Toggle,
    responses(
        (status = 200, description = "Сводка после изменения", body = AiOverview),
        (status = 403, description = "`confirm_required`: нужен пароль", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_set_unlimited(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Json(toggle): Json<Toggle>,
) -> Result<Json<AiOverview>, ApiError> {
    require_confirmed(&state, &session).await?;
    admin::set_owner_unlimited(state.db.pool(), &owner, toggle.enabled)
        .await
        .map_err(ai)?;
    Ok(Json(overview(&state, owner.account_id()).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct MakeUnlimited {
    /// Потолок платформы в день, если его ещё нет (микродоллары); не задан — $5.
    pub platform_day_usd: Option<i64>,
}

/// Owner Console: «Сделать мне безлимит» — снять личные лимиты owner в $,
/// поставить дневной потолок платформы (если нет) и включить режим.
#[utoipa::path(post, path = "/api/owner/ai/unlimited", tag = "owner", request_body = MakeUnlimited,
    responses(
        (status = 200, description = "Сводка после изменения", body = AiOverview),
        (status = 400, description = "Потолок должен быть больше нуля", body = ApiErrorBody),
        (status = 403, description = "`confirm_required`: нужен пароль", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_make_unlimited(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Json(body): Json<MakeUnlimited>,
) -> Result<Json<AiOverview>, ApiError> {
    require_confirmed(&state, &session).await?;
    let cap = body.platform_day_usd.unwrap_or(DEFAULT_PLATFORM_DAY_USD);
    admin::make_owner_unlimited(state.db.pool(), &owner, cap)
        .await
        .map_err(ai)?;
    Ok(Json(overview(&state, owner.account_id()).await?))
}

/// Защита от зацикливания; `reset: true` — как в настройках сервера.
#[derive(Debug, Deserialize, ToSchema)]
pub struct LoopGuardChange {
    #[serde(default)]
    pub reset: bool,
    pub user_per_minute: Option<u32>,
    pub job_per_minute: Option<u32>,
    pub repeat_limit: Option<u32>,
    pub repeat_window_secs: Option<u64>,
}

/// Owner Console: защита от зацикливания (0 — выключено, окно повторов 1…86 400 с).
#[utoipa::path(put, path = "/api/owner/ai/loop-guard", tag = "owner", request_body = LoopGuardChange,
    responses(
        (status = 200, description = "Сводка после изменения", body = AiOverview),
        (status = 400, description = "Неверное значение", body = ApiErrorBody),
        (status = 403, description = "`confirm_required`: нужен пароль", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_set_loop_guard(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Json(change): Json<LoopGuardChange>,
) -> Result<Json<AiOverview>, ApiError> {
    require_confirmed(&state, &session).await?;
    if change.reset {
        admin::set_loop_guard(state.db.pool(), &owner, None)
            .await
            .map_err(ai)?;
    } else {
        let now = state.ai.loop_guard_now().await.map_err(ai)?;
        let guard = LoopGuard {
            user_per_minute: change.user_per_minute.unwrap_or(now.user_per_minute),
            job_per_minute: change.job_per_minute.unwrap_or(now.job_per_minute),
            repeat_limit: change.repeat_limit.unwrap_or(now.repeat_limit),
            repeat_window: change
                .repeat_window_secs
                .map_or(now.repeat_window, Duration::from_secs),
        };
        admin::set_loop_guard(state.db.pool(), &owner, Some(&guard))
            .await
            .map_err(ai)?;
    }
    Ok(Json(overview(&state, owner.account_id()).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct KeyChange {
    /// Ключ API целиком; на экран и в журнал — только последние 4 символа.
    pub key: String,
}

/// Owner Console: ключ OpenRouter платформы (D-442). Действует сразу, без перезапуска.
#[utoipa::path(put, path = "/api/owner/ai/keys/openrouter", tag = "owner", request_body = KeyChange,
    responses(
        (status = 200, description = "Сводка после изменения", body = AiOverview),
        (status = 400, description = "Не похоже на ключ", body = ApiErrorBody),
        (status = 403, description = "`confirm_required`: нужен пароль", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody),
        (status = 409, description = "`secret_key_not_set`: не задан ключ шифрования", body = ApiErrorBody)
    ))]
pub async fn owner_set_key(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Json(change): Json<KeyChange>,
) -> Result<Json<AiOverview>, ApiError> {
    require_confirmed(&state, &session).await?;
    let key = check_key(&change.key)?;
    let sealed = secrets(&state)?.seal(&qubite_ai::key_purpose(None), key);
    admin::save_key(
        state.db.pool(),
        owner.account_id(),
        None,
        &sealed,
        &hint(key),
    )
    .await
    .map_err(ai)?;
    if let Some(adapter) = &state.ai_panel.openrouter {
        adapter.set_key(Secret::new(key));
        // Цены и стартовые модели — сразу, а не через сутки.
        let (pool, adapter) = (state.db.pool().clone(), adapter.clone());
        tokio::spawn(async move {
            if let Err(error) = crate::ai::sync_after_key(&pool, &adapter).await {
                tracing::warn!(
                    error = format!("{error:#}"),
                    "каталог OpenRouter не обновлён"
                );
            }
        });
    }
    Ok(Json(overview(&state, owner.account_id()).await?))
}

/// Owner Console: убрать ключ из Console (останется ключ из настроек сервера, если он есть).
#[utoipa::path(delete, path = "/api/owner/ai/keys/openrouter", tag = "owner",
    responses(
        (status = 200, description = "Сводка после изменения", body = AiOverview),
        (status = 403, description = "`confirm_required`: нужен пароль", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_remove_key(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
) -> Result<Json<AiOverview>, ApiError> {
    require_confirmed(&state, &session).await?;
    admin::remove_key(state.db.pool(), owner.account_id(), None)
        .await
        .map_err(ai)?;
    if let Some(adapter) = &state.ai_panel.openrouter {
        adapter.set_key(
            state
                .ai_panel
                .env_key
                .clone()
                .unwrap_or_else(|| Secret::new("")),
        );
    }
    Ok(Json(overview(&state, owner.account_id()).await?))
}

/// Ключ платформы из Console (если сохранён) — при запуске сервера.
pub async fn platform_key(
    pool: &PgPool,
    secrets: Option<&SecretBox>,
) -> anyhow::Result<Option<Secret>> {
    let sealed: Option<String> = sqlx::query_scalar(
        "SELECT key_enc FROM ai_keys WHERE account_id IS NULL AND provider_id = 'openrouter'",
    )
    .fetch_optional(pool)
    .await?;
    let (Some(sealed), Some(secrets)) = (sealed, secrets) else {
        return Ok(None);
    };
    match secrets.open(&qubite_ai::key_purpose(None), &sealed) {
        Ok(key) => Ok(Some(Secret::new(key))),
        Err(error) => {
            tracing::warn!(%error, "ключ OpenRouter из Console не прочитан — другой QUBITE_AI_SECRET_KEY?");
            Ok(None)
        }
    }
}

// ---------------------------------------------------------------- расход

#[derive(Debug, Deserialize, IntoParams)]
pub struct UsageQuery {
    /// За сколько последних дней (1…366, по умолчанию 30).
    pub days: Option<i64>,
}

/// Расход за группу: $, вызовы, токены.
#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct UsageRow {
    /// День (`2026-10-23`), модуль, модель или почта.
    pub key: String,
    /// Микродоллары (списано по факту).
    pub usd: i64,
    pub requests: i64,
    pub tokens: i64,
}

/// AI Cost Center: расход по дням, модулям, моделям, людям и кто платил.
#[derive(Debug, Serialize, ToSchema)]
pub struct AiUsage {
    pub days: i64,
    pub total: UsageRow,
    /// По дням, старые первыми (дни без вызовов — с нулями).
    pub by_day: Vec<UsageRow>,
    pub by_module: Vec<UsageRow>,
    pub by_model: Vec<UsageRow>,
    pub by_person: Vec<UsageRow>,
    /// `platform`, `subscription`, `own_key`.
    pub by_payer: Vec<UsageRow>,
}

async fn usage(state: &AppState, days: i64, who: Option<Uuid>) -> Result<AiUsage, ApiError> {
    let pool = state.db.pool();
    let tz = timezone(state);
    let days = days.clamp(1, 366);
    let group = |expr: &str, order: &str| {
        format!(
            "SELECT {expr} AS key, coalesce(sum(c.actual_usd), 0)::bigint AS usd, \
                    count(*) FILTER (WHERE c.status <> 'failed_not_sent') AS requests, \
                    coalesce(sum(coalesce(c.tokens_in, 0) + coalesce(c.tokens_out, 0)), 0)::bigint AS tokens \
             FROM ai_calls c LEFT JOIN accounts a ON a.id = c.account_id \
             WHERE (c.created_at AT TIME ZONE $1)::date > (now() AT TIME ZONE $1)::date - $2::int \
               AND ($3::uuid IS NULL OR c.account_id = $3) \
             GROUP BY 1 ORDER BY {order}"
        )
    };
    let run = |sql: String| {
        let tz = tz.clone();
        async move {
            sqlx::query_as::<_, UsageRow>(sqlx::AssertSqlSafe(sql))
                .bind(tz)
                .bind(days as i32)
                .bind(who)
                .fetch_all(pool)
                .await
                .map_err(db)
        }
    };
    let by_day_raw = run(group(
        "to_char(c.created_at AT TIME ZONE $1, 'YYYY-MM-DD')",
        "1",
    ))
    .await?;
    let today: String = sqlx::query_scalar("SELECT to_char(now() AT TIME ZONE $1, 'YYYY-MM-DD')")
        .bind(&tz)
        .fetch_one(pool)
        .await
        .map_err(db)?;
    // Все дни подряд — график без дыр.
    let mut by_day = Vec::with_capacity(days as usize);
    let today = time::Date::parse(
        &today,
        &time::macros::format_description!("[year]-[month]-[day]"),
    )
    .map_err(|_| invalid("дата"))?;
    for back in (0..days).rev() {
        let day = (today - time::Duration::days(back)).to_string();
        match by_day_raw.iter().find(|r| r.key == day) {
            Some(r) => by_day.push(UsageRow {
                key: day,
                usd: r.usd,
                requests: r.requests,
                tokens: r.tokens,
            }),
            None => by_day.push(UsageRow {
                key: day,
                usd: 0,
                requests: 0,
                tokens: 0,
            }),
        }
    }
    let total = UsageRow {
        key: "total".into(),
        usd: by_day.iter().map(|r| r.usd).sum(),
        requests: by_day.iter().map(|r| r.requests).sum(),
        tokens: by_day.iter().map(|r| r.tokens).sum(),
    };
    Ok(AiUsage {
        days,
        total,
        by_day,
        by_module: run(group("c.module_id", "2 DESC, 3 DESC, 1")).await?,
        by_model: run(group("c.model_id", "2 DESC, 3 DESC, 1")).await?,
        by_person: if who.is_some() {
            Vec::new()
        } else {
            run(group("a.email", "2 DESC, 3 DESC, 1")).await?
        },
        by_payer: run(group("c.paid_by", "2 DESC, 3 DESC, 1")).await?,
    })
}

/// Owner Console: AI Cost Center — расход по дням, модулям, моделям, людям.
#[utoipa::path(get, path = "/api/owner/ai/usage", tag = "owner", params(UsageQuery),
    responses(
        (status = 200, description = "Расход", body = AiUsage),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_usage(
    State(state): State<AppState>,
    _owner: Owner,
    Query(query): Query<UsageQuery>,
) -> Result<Json<AiUsage>, ApiError> {
    Ok(Json(usage(&state, query.days.unwrap_or(30), None).await?))
}

// ---------------------------------------------------------------- вызовы

#[derive(Debug, Deserialize, IntoParams)]
pub struct CallsQuery {
    /// Вызовы старше этого времени (для «Ещё»).
    #[param(value_type = Option<String>, format = DateTime)]
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub before: Option<OffsetDateTime>,
    /// Только вызовы этого человека.
    pub account: Option<Uuid>,
    /// Сколько, 1…200, по умолчанию 50.
    pub limit: Option<i64>,
}

/// AI-вызов в журнале (без текста запроса и ответа).
#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct AiCallItem {
    pub id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    pub at: OffsetDateTime,
    pub account_email: Option<String>,
    pub module_id: String,
    pub model_id: String,
    /// `succeeded`, `failed_not_sent`, `unknown`, `sending`, `reserved`, `denied`.
    pub status: String,
    pub error_code: Option<String>,
    /// Списано (микродоллары); у незаконченных — пусто.
    pub actual_usd: Option<i64>,
    pub estimate_usd: i64,
    pub tokens_in: Option<i64>,
    pub tokens_out: Option<i64>,
    /// `platform`, `subscription`, `own_key`.
    pub paid_by: String,
    pub attempts: i32,
}

async fn calls(state: &AppState, query: &CallsQuery) -> Result<Vec<AiCallItem>, ApiError> {
    sqlx::query_as(
        "SELECT c.id, c.created_at AS at, a.email AS account_email, c.module_id, c.model_id, \
                c.status, c.error_code, c.actual_usd, c.estimate_usd, c.tokens_in, c.tokens_out, \
                c.paid_by, c.attempts \
         FROM ai_calls c LEFT JOIN accounts a ON a.id = c.account_id \
         WHERE ($1::timestamptz IS NULL OR c.created_at < $1) \
           AND ($2::uuid IS NULL OR c.account_id = $2) \
         ORDER BY c.created_at DESC LIMIT $3",
    )
    .bind(query.before)
    .bind(query.account)
    .bind(query.limit.unwrap_or(50).clamp(1, 200))
    .fetch_all(state.db.pool())
    .await
    .map_err(db)
}

/// Owner Console: журнал AI-вызовов, новые сверху.
#[utoipa::path(get, path = "/api/owner/ai/calls", tag = "owner", params(CallsQuery),
    responses(
        (status = 200, description = "Вызовы", body = Vec<AiCallItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_calls(
    State(state): State<AppState>,
    _owner: Owner,
    Query(query): Query<CallsQuery>,
) -> Result<Json<Vec<AiCallItem>>, ApiError> {
    Ok(Json(calls(&state, &query).await?))
}

// ---------------------------------------------------------------- «AI и бюджет» у каждого

/// Подписка ChatGPT человека.
#[derive(Debug, Serialize, ToSchema)]
pub struct MyChatGpt {
    /// Можно подключить: включено на сервере и есть ключ шифрования.
    pub available: bool,
    /// Почему нельзя (если нельзя).
    pub unavailable_reason: Option<String>,
    pub connected: bool,
    pub email: Option<String>,
    /// Модель подписки для текстовых задач (`chatgpt:…`); пусто — первая из каталога.
    pub model: Option<String>,
    /// Модели подписки, из которых можно выбрать.
    pub models: Vec<String>,
    /// Вход закончился ошибкой (если был начат и не удался).
    pub last_error: Option<String>,
}

/// «Настройки → AI и бюджет».
#[derive(Debug, Serialize, ToSchema)]
pub struct MyAi {
    pub is_owner: bool,
    /// Откуда AI: `owner` (платит платформа по личному лимиту), `chatgpt`, `own_key`.
    pub source: String,
    /// Личные лимиты, «на каждого» и потолок платформы — с расходом за текущий период.
    pub limits: Vec<AiLimitItem>,
    /// Owner выдал личный лимит в $ (путь ③ «owner разрешил свой OpenRouter»).
    pub owner_allows: bool,
    /// У owner включён режим «без личного лимита» (только для самого owner).
    pub owner_unlimited: bool,
    pub chatgpt: MyChatGpt,
    /// Последние 4 символа своего ключа OpenRouter (если добавлен).
    pub own_key_hint: Option<String>,
    /// Ключи можно хранить (на сервере есть ключ шифрования).
    pub keys_available: bool,
    /// Свой расход за 30 дней.
    pub usage: AiUsage,
    /// Свои последние вызовы.
    pub calls: Vec<AiCallItem>,
}

async fn my_ai(state: &AppState, session: &Authenticated) -> Result<MyAi, ApiError> {
    let pool = state.db.pool();
    let me = session.0.account_id;
    let is_owner: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM platform_owner WHERE account_id = $1)")
            .bind(me)
            .fetch_one(pool)
            .await
            .map_err(db)?;
    let source: Option<(String, Option<String>)> =
        sqlx::query_as("SELECT source, chatgpt_model FROM ai_sources WHERE account_id = $1")
            .bind(me)
            .fetch_optional(pool)
            .await
            .map_err(db)?;
    let (source, chatgpt_model) = source.unwrap_or_else(|| ("owner".into(), None));
    let limits = limit_items(state, Some(me)).await?;
    let owner_allows = limits.iter().any(|l| {
        l.metric == "usd"
            && l.account_id == Some(me)
            && matches!(l.scope.as_str(), "user" | "user_module")
    });
    let status = chatgpt::status(pool, me).await.map_err(db)?;
    let models: Vec<String> = sqlx::query_scalar(
        "SELECT 'chatgpt:' || lower(external_id) FROM ai_catalog WHERE provider_id = 'chatgpt' \
         ORDER BY external_id",
    )
    .fetch_all(pool)
    .await
    .map_err(db)?;
    let panel = &state.ai_panel;
    let unavailable_reason = if !panel.chatgpt_enabled {
        Some("ChatGPT по подписке выключен на сервере — owner включает QUBITE_AI_CHATGPT_ENABLED=true".into())
    } else if panel.secrets.is_none() {
        Some("на сервере не задан QUBITE_AI_SECRET_KEY — входу негде хранить токены".into())
    } else {
        None
    };
    let own_key_hint: Option<String> = sqlx::query_scalar(
        "SELECT hint FROM ai_keys WHERE account_id = $1 AND provider_id = 'openrouter'",
    )
    .bind(me)
    .fetch_optional(pool)
    .await
    .map_err(db)?;
    let last_error = panel
        .login_errors
        .lock()
        .expect("ошибки входа")
        .get(&me)
        .cloned();
    Ok(MyAi {
        is_owner,
        source,
        limits,
        owner_allows,
        owner_unlimited: is_owner && admin::owner_unlimited(pool).await.map_err(ai)?,
        chatgpt: MyChatGpt {
            available: unavailable_reason.is_none(),
            unavailable_reason,
            connected: status.connected,
            email: status.email,
            model: chatgpt_model,
            models,
            last_error,
        },
        own_key_hint,
        keys_available: panel.secrets.is_some(),
        usage: usage(state, 30, Some(me)).await?,
        calls: calls(
            state,
            &CallsQuery {
                before: None,
                account: Some(me),
                limit: Some(20),
            },
        )
        .await?,
    })
}

/// «AI и бюджет»: свой расход, лимиты и чем подключён AI.
#[utoipa::path(get, path = "/api/ai/me", tag = "ai",
    responses(
        (status = 200, description = "AI и бюджет человека", body = MyAi),
        (status = 401, description = "Не вошёл", body = ApiErrorBody)
    ))]
pub async fn me(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<MyAi>, ApiError> {
    Ok(Json(my_ai(&state, &session).await?))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SourceChange {
    /// `owner`, `chatgpt` или `own_key`.
    pub source: String,
    /// Модель подписки (`chatgpt:…`) для `chatgpt`; пусто — первая из каталога.
    pub chatgpt_model: Option<String>,
}

/// «AI и бюджет»: откуда брать AI.
#[utoipa::path(put, path = "/api/ai/me/source", tag = "ai", request_body = SourceChange,
    responses(
        (status = 200, description = "Сохранено", body = MyAi),
        (status = 400, description = "Неверный выбор", body = ApiErrorBody),
        (status = 401, description = "Не вошёл", body = ApiErrorBody)
    ))]
pub async fn set_source(
    State(state): State<AppState>,
    session: Authenticated,
    Json(change): Json<SourceChange>,
) -> Result<Json<MyAi>, ApiError> {
    let pool = state.db.pool();
    let me = session.0.account_id;
    let model = change
        .chatgpt_model
        .as_deref()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .map(catalog::model_id);
    if let Some(model) = &model {
        let known: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM ai_catalog WHERE provider_id = 'chatgpt' \
             AND 'chatgpt:' || lower(external_id) = $1)",
        )
        .bind(model)
        .fetch_one(pool)
        .await
        .map_err(db)?;
        if !known {
            return Err(invalid("такой модели подписки нет"));
        }
        // строка модели нужна для ссылки из ai_sources (выключенная — allowlist не меняется)
        sqlx::query(
            "INSERT INTO ai_models (id, provider_id, external_id, price_in_per_mtok, \
             price_out_per_mtok, context_tokens, enabled) \
             SELECT $1, provider_id, external_id, price_in_per_mtok, price_out_per_mtok, \
                    context_tokens, false FROM ai_catalog \
             WHERE provider_id = 'chatgpt' AND 'chatgpt:' || lower(external_id) = $1 \
             ON CONFLICT (id) DO NOTHING",
        )
        .bind(model)
        .execute(pool)
        .await
        .map_err(db)?;
    }
    admin::set_source(pool, me, &change.source, model.as_deref())
        .await
        .map_err(ai)?;
    Ok(Json(my_ai(&state, &session).await?))
}

/// «AI и бюджет»: свой ключ OpenRouter (тратит деньги своего счёта). Сразу
/// выбирается источником AI.
#[utoipa::path(put, path = "/api/ai/me/key", tag = "ai", request_body = KeyChange,
    responses(
        (status = 200, description = "Сохранено", body = MyAi),
        (status = 400, description = "Не похоже на ключ", body = ApiErrorBody),
        (status = 401, description = "Не вошёл", body = ApiErrorBody),
        (status = 409, description = "`secret_key_not_set`", body = ApiErrorBody)
    ))]
pub async fn set_my_key(
    State(state): State<AppState>,
    session: Authenticated,
    Json(change): Json<KeyChange>,
) -> Result<Json<MyAi>, ApiError> {
    let me = session.0.account_id;
    let key = check_key(&change.key)?;
    let sealed = secrets(&state)?.seal(&qubite_ai::key_purpose(Some(me)), key);
    admin::save_key(state.db.pool(), me, Some(me), &sealed, &hint(key))
        .await
        .map_err(ai)?;
    admin::set_source(state.db.pool(), me, "own_key", None)
        .await
        .map_err(ai)?;
    Ok(Json(my_ai(&state, &session).await?))
}

/// «AI и бюджет»: убрать свой ключ (источник — снова owner).
#[utoipa::path(delete, path = "/api/ai/me/key", tag = "ai",
    responses(
        (status = 200, description = "Убран", body = MyAi),
        (status = 401, description = "Не вошёл", body = ApiErrorBody)
    ))]
pub async fn remove_my_key(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<MyAi>, ApiError> {
    let me = session.0.account_id;
    admin::remove_key(state.db.pool(), me, Some(me))
        .await
        .map_err(ai)?;
    let source: Option<String> =
        sqlx::query_scalar("SELECT source FROM ai_sources WHERE account_id = $1")
            .bind(me)
            .fetch_optional(state.db.pool())
            .await
            .map_err(db)?;
    if source.as_deref() == Some("own_key") {
        admin::set_source(state.db.pool(), me, "owner", None)
            .await
            .map_err(ai)?;
    }
    Ok(Json(my_ai(&state, &session).await?))
}

/// Начатый вход в ChatGPT.
#[derive(Debug, Serialize, ToSchema)]
pub struct ChatGptStart {
    /// Страница входа OpenAI — открыть в браузере.
    pub url: String,
    /// Куда OpenAI вернёт браузер. Если сервер на другом компьютере, страница
    /// не откроется — адрес из строки браузера вставляют в Qubite.
    pub redirect_uri: String,
}

fn chatgpt_ready(state: &AppState) -> Result<Arc<SecretBox>, ApiError> {
    if !state.ai_panel.chatgpt_enabled {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "chatgpt_disabled",
            "ChatGPT по подписке выключен на сервере — owner включает QUBITE_AI_CHATGPT_ENABLED=true",
        ));
    }
    Ok(secrets(state)?.clone())
}

/// После входа: модели подписки — в каталог (owner их видит в Console).
async fn after_login(state: &AppState, account: Uuid) {
    let Some(provider) = &state.ai_panel.chatgpt else {
        return;
    };
    match tokio::time::timeout(Duration::from_secs(30), provider.models(account)).await {
        Ok(Ok(entries)) => {
            if let Err(error) = catalog::apply(
                state.db.pool(),
                chatgpt::PROVIDER_ID,
                &entries,
                &Allowlist::Keep,
            )
            .await
            {
                tracing::warn!(%error, "модели подписки ChatGPT не записаны");
            }
        }
        Ok(Err(error)) => tracing::warn!(%error, "модели подписки ChatGPT не получены"),
        Err(_) => tracing::warn!("модели подписки ChatGPT не получены за 30 с"),
    }
}

/// Вход удался: подписка — источник AI человека (D-536).
async fn connected(state: &AppState, account: Uuid) -> Result<(), ApiError> {
    after_login(state, account).await;
    admin::set_source(state.db.pool(), account, "chatgpt", None)
        .await
        .map_err(ai)
}

/// «Войти через ChatGPT»: адрес входа. Сервер сам ждёт возврата браузера на
/// `127.0.0.1` 5 минут; если браузер на другом компьютере — адрес возврата
/// вставляют в «Закончить вход».
#[utoipa::path(post, path = "/api/ai/me/chatgpt/start", tag = "ai",
    responses(
        (status = 200, description = "Адрес входа", body = ChatGptStart),
        (status = 401, description = "Не вошёл", body = ApiErrorBody),
        (status = 409, description = "`chatgpt_disabled` или `secret_key_not_set`", body = ApiErrorBody)
    ))]
pub async fn chatgpt_start(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<ChatGptStart>, ApiError> {
    let secret = chatgpt_ready(&state)?;
    let me = session.0.account_id;
    let (listener, redirect_uri) = chatgpt::loopback(0)
        .await
        .map_err(|e| ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "internal", e))?;
    let start = chatgpt::begin_login(
        state.db.pool(),
        &state.ai_panel.chatgpt_config,
        &secret,
        me,
        &redirect_uri,
    )
    .await
    .map_err(|e| ApiError::new(StatusCode::BAD_GATEWAY, "chatgpt_login_failed", e))?;
    state
        .ai_panel
        .login_errors
        .lock()
        .expect("ошибки входа")
        .remove(&me);
    let waiting = state.clone();
    let login_state = start.state.clone();
    tokio::spawn(async move {
        let Ok(callback) = chatgpt::await_callback(&listener, &login_state).await else {
            return; // не дождались — возможно, адрес вставят вручную
        };
        let panel = &waiting.ai_panel;
        let result = chatgpt::finish_login(
            waiting.db.pool(),
            &panel.chatgpt_config,
            &secret,
            me,
            &callback,
        )
        .await;
        match result {
            Ok(_) => {
                if let Err(error) = connected(&waiting, me).await {
                    tracing::warn!(?error, "ChatGPT подключён, но источник не выбран");
                }
            }
            // Адрес уже вставили вручную — это не ошибка.
            Err(error) if error.contains("не найден") => {}
            Err(error) => {
                panel
                    .login_errors
                    .lock()
                    .expect("ошибки входа")
                    .insert(me, error);
            }
        }
    });
    Ok(Json(ChatGptStart {
        url: start.url,
        redirect_uri,
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ChatGptFinish {
    /// Адрес из строки браузера после входа (`http://127.0.0.1:…/auth/callback?code=…`).
    pub callback: String,
}

/// «Войти через ChatGPT»: закончить вход вставленным адресом возврата.
#[utoipa::path(post, path = "/api/ai/me/chatgpt/finish", tag = "ai", request_body = ChatGptFinish,
    responses(
        (status = 200, description = "Подключено", body = MyAi),
        (status = 400, description = "Вход не принят", body = ApiErrorBody),
        (status = 401, description = "Не вошёл", body = ApiErrorBody),
        (status = 409, description = "`chatgpt_disabled` или `secret_key_not_set`", body = ApiErrorBody)
    ))]
pub async fn chatgpt_finish(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<ChatGptFinish>,
) -> Result<Json<MyAi>, ApiError> {
    let secret = chatgpt_ready(&state)?;
    let me = session.0.account_id;
    chatgpt::finish_login(
        state.db.pool(),
        &state.ai_panel.chatgpt_config,
        &secret,
        me,
        &body.callback,
    )
    .await
    .map_err(|e| ApiError::new(StatusCode::BAD_REQUEST, "chatgpt_login_failed", e))?;
    connected(&state, me).await?;
    Ok(Json(my_ai(&state, &session).await?))
}

/// «AI и бюджет»: отключить свою подписку ChatGPT (токены отзываются у OpenAI).
#[utoipa::path(delete, path = "/api/ai/me/chatgpt", tag = "ai",
    responses(
        (status = 200, description = "Отключено", body = MyAi),
        (status = 401, description = "Не вошёл", body = ApiErrorBody),
        (status = 409, description = "`secret_key_not_set`", body = ApiErrorBody)
    ))]
pub async fn chatgpt_logout(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<MyAi>, ApiError> {
    let me = session.0.account_id;
    let secret = secrets(&state)?.clone();
    chatgpt::logout(state.db.pool(), &state.ai_panel.chatgpt_config, &secret, me)
        .await
        .map_err(|e| ApiError::new(StatusCode::BAD_GATEWAY, "chatgpt_logout_failed", e))?;
    let source: Option<String> =
        sqlx::query_scalar("SELECT source FROM ai_sources WHERE account_id = $1")
            .bind(me)
            .fetch_optional(state.db.pool())
            .await
            .map_err(db)?;
    if source.as_deref() == Some("chatgpt") {
        admin::set_source(state.db.pool(), me, "owner", None)
            .await
            .map_err(ai)?;
    }
    Ok(Json(my_ai(&state, &session).await?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_hint_and_check() {
        assert_eq!(hint("sk-or-v1-abcdef1234"), "1234");
        assert_eq!(hint("ab"), "ab");
        assert!(check_key("sk-or-v1-0123456789abcdef").is_ok());
        assert!(check_key("short").is_err());
        assert!(check_key("sk-or v1 with spaces 0123").is_err());
    }
}
