//! Настройка AI владельцем (основа AI-части Owner Console): провайдеры,
//! модели (allowlist и цены), лимиты, снятие блокировки модели.
//! Каждое изменение — в аудите. Ключей провайдеров здесь нет.

use qubite_objects::{NewAuditEntry, audit};
use qubite_policy::{ModuleId, OwnerConsole};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{AiError, Result};

/// Провайдер.
#[derive(Debug, Clone)]
pub struct ProviderSpec<'a> {
    pub id: &'a str,
    /// `openrouter`, `openai`, `local`, `mock`.
    pub kind: &'a str,
    pub base_url: &'a str,
    pub enabled: bool,
}

/// Модель и её цены (микродоллары за миллион токенов).
#[derive(Debug, Clone)]
pub struct ModelSpec<'a> {
    pub id: &'a str,
    pub provider_id: &'a str,
    pub external_id: &'a str,
    pub price_in_per_mtok: i64,
    pub price_out_per_mtok: i64,
    pub context_tokens: i32,
    /// Входит в allowlist.
    pub enabled: bool,
}

/// На что действует лимит.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LimitScope {
    /// Вся платформа.
    Platform,
    User(Uuid),
    Module(ModuleId),
    Model(String),
    Provider(String),
    UserModule(Uuid, ModuleId),
}

/// Период лимита.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Period {
    Hour,
    Day,
    Month,
    All,
}

/// В чём измеряется лимит.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Metric {
    /// Микродоллары.
    Usd,
    Requests,
    Tokens,
}

impl Period {
    fn as_str(self) -> &'static str {
        match self {
            Self::Hour => "hour",
            Self::Day => "day",
            Self::Month => "month",
            Self::All => "all",
        }
    }
}

impl Metric {
    fn as_str(self) -> &'static str {
        match self {
            Self::Usd => "usd",
            Self::Requests => "requests",
            Self::Tokens => "tokens",
        }
    }
}

async fn record(
    conn: &mut sqlx::PgConnection,
    by: &OwnerConsole,
    action: &str,
    kind: &str,
    id: String,
    after: serde_json::Value,
) -> Result<()> {
    audit::record(
        conn,
        NewAuditEntry {
            actor_id: Some(by.account_id()),
            action: action.into(),
            target_kind: kind.into(),
            target_id: Some(id),
            after: Some(after),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    Ok(())
}

pub async fn upsert_provider(
    pool: &PgPool,
    by: &OwnerConsole,
    spec: ProviderSpec<'_>,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO ai_providers (id, kind, base_url, enabled) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, base_url = EXCLUDED.base_url, \
         enabled = EXCLUDED.enabled, updated_at = now()",
    )
    .bind(spec.id)
    .bind(spec.kind)
    .bind(spec.base_url)
    .bind(spec.enabled)
    .execute(&mut *tx)
    .await
    .map_err(invalid)?;
    let after = serde_json::json!({ "kind": spec.kind, "base_url": spec.base_url, "enabled": spec.enabled });
    record(
        &mut tx,
        by,
        "ai.provider_set",
        "ai_provider",
        spec.id.into(),
        after,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

pub async fn upsert_model(pool: &PgPool, by: &OwnerConsole, spec: ModelSpec<'_>) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "INSERT INTO ai_models (id, provider_id, external_id, price_in_per_mtok, price_out_per_mtok, \
         context_tokens, enabled) VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT (id) DO UPDATE SET provider_id = EXCLUDED.provider_id, \
         external_id = EXCLUDED.external_id, price_in_per_mtok = EXCLUDED.price_in_per_mtok, \
         price_out_per_mtok = EXCLUDED.price_out_per_mtok, context_tokens = EXCLUDED.context_tokens, \
         enabled = EXCLUDED.enabled, prices_updated_at = now()",
    )
    .bind(spec.id)
    .bind(spec.provider_id)
    .bind(spec.external_id)
    .bind(spec.price_in_per_mtok)
    .bind(spec.price_out_per_mtok)
    .bind(spec.context_tokens)
    .bind(spec.enabled)
    .execute(&mut *tx)
    .await
    .map_err(invalid)?;
    let after = serde_json::json!({
        "provider_id": spec.provider_id,
        "external_id": spec.external_id,
        "price_in_per_mtok": spec.price_in_per_mtok,
        "price_out_per_mtok": spec.price_out_per_mtok,
        "enabled": spec.enabled,
    });
    record(
        &mut tx,
        by,
        "ai.model_set",
        "ai_model",
        spec.id.into(),
        after,
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Снять блокировку модели (после превышения оценки) — решение owner.
pub async fn unblock_model(pool: &PgPool, by: &OwnerConsole, model_id: &str) -> Result<()> {
    let mut tx = pool.begin().await?;
    let changed = sqlx::query("UPDATE ai_models SET blocked_reason = NULL WHERE id = $1")
        .bind(model_id)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if changed == 0 {
        return Err(AiError::Invalid(format!("нет модели {model_id}")));
    }
    record(
        &mut tx,
        by,
        "ai.model_unblocked",
        "ai_model",
        model_id.into(),
        serde_json::json!({}),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Задать лимит (микродоллары, запросы или токены). Прежний лимит на то же
/// сочетание закрывается; накопленный расход нового лимита начинается с нуля.
/// Значение 0 — «запрещено» (то же, что отсутствие личного лимита).
pub async fn set_limit(
    pool: &PgPool,
    by: &OwnerConsole,
    scope: &LimitScope,
    period: Period,
    metric: Metric,
    value: i64,
) -> Result<Uuid> {
    if value < 0 {
        return Err(AiError::Invalid("лимит не может быть отрицательным".into()));
    }
    let (kind, account, module, model, provider) = match scope {
        LimitScope::Platform => ("platform", None, None, None, None),
        LimitScope::User(account) => ("user", Some(*account), None, None, None),
        LimitScope::Module(module) => ("module", None, Some(module.to_string()), None, None),
        LimitScope::Model(model) => ("model", None, None, Some(model.clone()), None),
        LimitScope::Provider(provider) => ("provider", None, None, None, Some(provider.clone())),
        LimitScope::UserModule(account, module) => (
            "user_module",
            Some(*account),
            Some(module.to_string()),
            None,
            None,
        ),
    };
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE ai_limits SET revoked_at = now() WHERE revoked_at IS NULL AND scope_kind = $1 \
         AND account_id IS NOT DISTINCT FROM $2 AND module_id IS NOT DISTINCT FROM $3 \
         AND model_id IS NOT DISTINCT FROM $4 AND provider_id IS NOT DISTINCT FROM $5 \
         AND period = $6 AND metric = $7",
    )
    .bind(kind)
    .bind(account)
    .bind(&module)
    .bind(&model)
    .bind(&provider)
    .bind(period.as_str())
    .bind(metric.as_str())
    .execute(&mut *tx)
    .await?;
    let id = qubite_objects::new_id();
    sqlx::query(
        "INSERT INTO ai_limits (id, scope_kind, account_id, module_id, model_id, provider_id, \
         period, metric, limit_value, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    )
    .bind(id)
    .bind(kind)
    .bind(account)
    .bind(&module)
    .bind(&model)
    .bind(&provider)
    .bind(period.as_str())
    .bind(metric.as_str())
    .bind(value)
    .bind(by.account_id())
    .execute(&mut *tx)
    .await
    .map_err(invalid)?;
    let after = serde_json::json!({
        "scope": kind, "account_id": account, "module_id": module, "model_id": model,
        "provider_id": provider, "period": period.as_str(), "metric": metric.as_str(), "value": value,
    });
    record(
        &mut tx,
        by,
        "ai.limit_set",
        "ai_limit",
        id.to_string(),
        after,
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

fn invalid(error: sqlx::Error) -> AiError {
    if let sqlx::Error::Database(db) = &error
        && matches!(db.code().as_deref(), Some("23514" | "23503"))
    {
        return AiError::Invalid(db.message().to_owned());
    }
    AiError::Db(error)
}
