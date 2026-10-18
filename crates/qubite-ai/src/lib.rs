//! AI-шлюз Qubite (AI-001): **ни один цент без разрешения**.
//!
//! Путь вызова ([AI_COST_GUARD](../../docs/architecture/AI_COST_GUARD.md)):
//! 1. Policy Gate — на вход нужен `&Authorized<UseAi>` (грант `ai` в модуле);
//! 2. модель в allowlist и не заблокирована, провайдер включён;
//! 3. резерв худшей стоимости по всем лимитам в одной транзакции;
//! 4. отметка «отправляется» сохраняется **до** вызова провайдера;
//! 5. ответ → списание факта и возврат остатка; «точно не ушёл» → возврат и
//!    повтор (до 3 попыток, перед каждой — права и бюджет заново);
//!    «неизвестно» или таймаут → резерв удерживается.
//!
//! Без личного денежного лимита AI запрещён: бюджет по умолчанию — ноль (D-173).
//! Текст запроса и ответа в журнал расходов не пишется.

pub mod admin;
pub mod budget;
pub mod provider;

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
pub use provider::{MockProvider, MockStep, Provider, ProviderCall, ProviderError, ProviderReply};

/// Микродоллары: 1 $ = 1 000 000.
pub const MICROS_PER_USD: i64 = 1_000_000;

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
    #[error("запрос с этим request_id уже был (статус {status}) — повторно не выполняется")]
    DuplicateRequest { status: String },
    #[error("провайдер недоступен; можно выбрать другую модель: {alternatives:?}")]
    ProviderUnavailable { alternatives: Vec<String> },
    #[error("результат запроса неизвестен; резерв удерживается до выяснения")]
    ResultUnknown { call_id: Uuid },
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
            Self::DuplicateRequest { .. } => "duplicate_request",
            Self::ProviderUnavailable { .. } => "provider_unavailable",
            Self::ResultUnknown { .. } => "result_unknown",
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
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            timezone: "Asia/Yekaterinburg".into(),
            timeout: Duration::from_secs(60),
            retry_delays: vec![Duration::from_secs(1), Duration::from_secs(2)],
            clock: Arc::new(OffsetDateTime::now_utc),
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
    pub prompt: String,
    /// Оценка входных токенов (сверху).
    pub input_tokens: u32,
    /// Потолок ответа.
    pub max_output_tokens: u32,
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

/// AI-шлюз. Один на процесс; провайдеры подключаются при запуске.
pub struct Gateway {
    pool: PgPool,
    config: AiConfig,
    timezone: RwLock<String>,
    providers: HashMap<String, Arc<dyn Provider>>,
}

impl Gateway {
    pub fn new(pool: PgPool, config: AiConfig) -> Self {
        Self {
            timezone: RwLock::new(config.timezone.clone()),
            pool,
            config,
            providers: HashMap::new(),
        }
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
        if request.request_id.is_empty() || request.request_id.len() > 200 {
            return Err(AiError::Invalid("request_id: от 1 до 200 символов".into()));
        }
        if let Some(status) = sqlx::query_scalar::<_, String>(
            "SELECT status FROM ai_calls WHERE account_id = $1 AND request_id = $2",
        )
        .bind(auth.account_id())
        .bind(&request.request_id)
        .fetch_optional(&self.pool)
        .await?
        {
            return Err(AiError::DuplicateRequest { status });
        }

        let attempts = self.config.retry_delays.len() + 1;
        let mut call_id: Option<Uuid> = None;
        for attempt in 1..=attempts {
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
            let model = self.load_model(&request.model).await?;
            let provider = self
                .providers
                .get(&model.provider_id)
                .cloned()
                .ok_or(AiError::ModelNotAllowed)?;

            let estimate_usd = cost(
                u64::from(request.input_tokens),
                u64::from(request.max_output_tokens),
                model.price_in_per_mtok,
                model.price_out_per_mtok,
            );
            let estimate_tokens =
                i64::from(request.input_tokens) + i64::from(request.max_output_tokens);

            // Резерв и отметка «отправляется» — до вызова, одной транзакцией.
            let mut tx = self.pool.begin().await?;
            let keys =
                budget::period_keys(&mut tx, (self.config.clock)(), &self.timezone()).await?;
            let scope = budget::Scope {
                account_id: auth.account_id(),
                module_id: auth.module().as_str(),
                model_id: &model.id,
                provider_id: &model.provider_id,
            };
            let reservations = match budget::reserve(
                &mut tx,
                &scope,
                &keys,
                estimate_usd,
                estimate_tokens,
            )
            .await
            {
                Ok(reservations) => reservations,
                Err(error) => {
                    drop(tx);
                    if let Some(id) = call_id {
                        self.finish_without_call(id, "denied", error.code()).await?;
                    }
                    return Err(error);
                }
            };
            let reservations_json =
                serde_json::to_value(&reservations).expect("резерв сериализуется");
            let id = match call_id {
                None => {
                    let id = qubite_objects::new_id();
                    let inserted = sqlx::query(
                        "INSERT INTO ai_calls (id, request_id, account_id, module_id, model_id, status, \
                         attempts, estimate_usd, estimate_tokens, reservations) \
                         VALUES ($1, $2, $3, $4, $5, 'sending', 1, $6, $7, $8)",
                    )
                    .bind(id)
                    .bind(&request.request_id)
                    .bind(auth.account_id())
                    .bind(auth.module().as_str())
                    .bind(&model.id)
                    .bind(estimate_usd)
                    .bind(estimate_tokens)
                    .bind(&reservations_json)
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
            call_id = Some(id);
            event(
                &mut tx,
                id,
                "call.sending",
                serde_json::json!({ "attempt": attempt, "estimate_usd": estimate_usd }),
            )
            .await?;
            tx.commit().await?;

            let call = ProviderCall {
                external_id: model.external_id.clone(),
                prompt: request.prompt.clone(),
                max_output_tokens: request.max_output_tokens,
            };
            let outcome = tokio::time::timeout(self.config.timeout, provider.complete(&call)).await;
            match outcome {
                Ok(Ok(reply)) => {
                    return self
                        .settle_success(id, &model, &reservations, estimate_usd, reply)
                        .await;
                }
                Ok(Err(ProviderError::NotSent(reason))) => {
                    let mut tx = self.pool.begin().await?;
                    budget::release(&mut tx, &reservations).await?;
                    sqlx::query(
                        "UPDATE ai_calls SET status = 'failed_not_sent', error_code = 'not_sent', \
                         reservations = '[]', updated_at = now() WHERE id = $1",
                    )
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
                    event(
                        &mut tx,
                        id,
                        "call.not_sent",
                        serde_json::json!({ "attempt": attempt, "reason": reason }),
                    )
                    .await?;
                    tx.commit().await?;
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

    async fn load_model(&self, model_id: &str) -> Result<ModelRow> {
        let model: Option<ModelRow> = sqlx::query_as(
            "SELECT m.id, m.provider_id, m.external_id, m.price_in_per_mtok, m.price_out_per_mtok, \
                    m.enabled, m.blocked_reason, p.enabled AS provider_enabled \
             FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id WHERE m.id = $1",
        )
        .bind(model_id)
        .fetch_optional(&self.pool)
        .await?;
        let model = model.ok_or(AiError::ModelNotAllowed)?;
        if !model.enabled || !model.provider_enabled {
            return Err(AiError::ModelNotAllowed);
        }
        if let Some(reason) = &model.blocked_reason {
            return Err(AiError::ModelBlocked(reason.clone()));
        }
        Ok(model)
    }

    async fn settle_success(
        &self,
        id: Uuid,
        model: &ModelRow,
        reservations: &[Reservation],
        estimate_usd: i64,
        reply: ProviderReply,
    ) -> Result<AiResponse> {
        let actual = cost(
            reply.tokens_in,
            reply.tokens_out,
            model.price_in_per_mtok,
            model.price_out_per_mtok,
        );
        let tokens = i64::try_from(reply.tokens_in + reply.tokens_out).unwrap_or(i64::MAX);
        let mut tx = self.pool.begin().await?;
        budget::settle(&mut tx, reservations, actual, tokens).await?;
        sqlx::query(
            "UPDATE ai_calls SET status = 'succeeded', actual_usd = $2, tokens_in = $3, tokens_out = $4, \
             reservations = '[]', updated_at = now(), settled_at = now() WHERE id = $1",
        )
        .bind(id)
        .bind(actual)
        .bind(i64::try_from(reply.tokens_in).unwrap_or(i64::MAX))
        .bind(i64::try_from(reply.tokens_out).unwrap_or(i64::MAX))
        .execute(&mut *tx)
        .await?;
        event(
            &mut tx,
            id,
            "call.settled",
            serde_json::json!({ "actual_usd": actual }),
        )
        .await?;
        if actual > estimate_usd {
            block_model(&mut tx, &model.id, id, estimate_usd, actual).await?;
        }
        tx.commit().await?;
        Ok(AiResponse {
            call_id: id,
            text: reply.text,
            tokens_in: reply.tokens_in,
            tokens_out: reply.tokens_out,
            cost_usd: actual,
        })
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

    /// Другие разрешённые модели — пользователь выбирает сам (D-076).
    async fn alternatives(&self, except: &str) -> Result<Vec<String>> {
        Ok(sqlx::query_scalar(
            "SELECT m.id FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id \
             WHERE m.enabled AND p.enabled AND m.blocked_reason IS NULL AND m.id <> $1 ORDER BY m.id",
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
