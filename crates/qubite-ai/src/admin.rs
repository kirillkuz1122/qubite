//! Настройка AI владельцем (основа AI-части Owner Console): провайдеры,
//! модели (allowlist и цены), лимиты, снятие блокировки модели, режим
//! «owner без личного лимита», «сделать мне безлимит», защита от зацикливания,
//! ключи OpenRouter (уже зашифрованные) и выбор «откуда AI» у человека (AI-003).
//! Каждое изменение — в аудите; сами ключи в аудит не попадают.

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
    /// Каждый пользователь отдельно (одно значение, свой счётчик у каждого).
    /// Потолок, а не разрешение: AI сам по себе не открывает.
    EachUser,
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
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Hour => "hour",
            Self::Day => "day",
            Self::Month => "month",
            Self::All => "all",
        }
    }
}

impl Metric {
    pub fn as_str(self) -> &'static str {
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
    let mut tx = pool.begin().await?;
    let id = write_limit(
        &mut tx,
        Some(by.account_id()),
        None,
        scope,
        period,
        metric,
        value,
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

/// Лимит из настроек сервера (`QUBITE_AI_PLATFORM_USD_*`): меняется, только
/// если значение другое, — перезапуск сервера не обнуляет накопленный расход.
/// Возвращает `true`, если лимит изменился.
pub async fn ensure_limit(
    pool: &PgPool,
    scope: &LimitScope,
    period: Period,
    metric: Metric,
    value: i64,
) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let parts = scope_parts(scope);
    let current: Option<i64> = sqlx::query_scalar(
        "SELECT limit_value FROM ai_limits WHERE revoked_at IS NULL AND scope_kind = $1 \
         AND account_id IS NOT DISTINCT FROM $2 AND module_id IS NOT DISTINCT FROM $3 \
         AND model_id IS NOT DISTINCT FROM $4 AND provider_id IS NOT DISTINCT FROM $5 \
         AND period = $6 AND metric = $7 FOR UPDATE",
    )
    .bind(parts.0)
    .bind(parts.1)
    .bind(&parts.2)
    .bind(&parts.3)
    .bind(&parts.4)
    .bind(period.as_str())
    .bind(metric.as_str())
    .fetch_optional(&mut *tx)
    .await?;
    if current == Some(value) {
        return Ok(false);
    }
    write_limit(
        &mut tx,
        None,
        Some("настройки сервера"),
        scope,
        period,
        metric,
        value,
    )
    .await?;
    tx.commit().await?;
    Ok(true)
}

type ScopeParts = (
    &'static str,
    Option<Uuid>,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn scope_parts(scope: &LimitScope) -> ScopeParts {
    match scope {
        LimitScope::Platform => ("platform", None, None, None, None),
        LimitScope::EachUser => ("each_user", None, None, None, None),
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
    }
}

async fn write_limit(
    conn: &mut sqlx::PgConnection,
    actor: Option<Uuid>,
    reason: Option<&str>,
    scope: &LimitScope,
    period: Period,
    metric: Metric,
    value: i64,
) -> Result<Uuid> {
    if value < 0 {
        return Err(AiError::Invalid("лимит не может быть отрицательным".into()));
    }
    let (kind, account, module, model, provider) = scope_parts(scope);
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
    .execute(&mut *conn)
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
    .bind(actor)
    .execute(&mut *conn)
    .await
    .map_err(invalid)?;
    let after = serde_json::json!({
        "scope": kind, "account_id": account, "module_id": module, "model_id": model,
        "provider_id": provider, "period": period.as_str(), "metric": metric.as_str(), "value": value,
    });
    audit::record(
        conn,
        NewAuditEntry {
            actor_id: actor,
            action: "ai.limit_set".into(),
            target_kind: "ai_limit".into(),
            target_id: Some(id.to_string()),
            after: Some(after),
            reason: reason.map(Into::into),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    Ok(id)
}

/// Режим «owner без личного лимита» (D-200). Включает только owner лично;
/// каждое переключение — в аудите. Общие лимиты платформы, модуля, модели,
/// провайдера и личные лимиты owner, если он их задал, продолжают работать.
pub async fn set_owner_unlimited(pool: &PgPool, by: &OwnerConsole, enabled: bool) -> Result<()> {
    let mut tx = pool.begin().await?;
    set_owner_unlimited_in(&mut tx, by, enabled).await?;
    tx.commit().await?;
    Ok(())
}

async fn set_owner_unlimited_in(
    tx: &mut sqlx::PgConnection,
    by: &OwnerConsole,
    enabled: bool,
) -> Result<()> {
    let before = owner_unlimited_in(&mut *tx).await?;
    sqlx::query(
        "INSERT INTO ai_owner_unlimited (singleton, enabled, changed_by, changed_at) \
         VALUES (true, $1, $2, now()) ON CONFLICT (singleton) DO UPDATE SET \
         enabled = EXCLUDED.enabled, changed_by = EXCLUDED.changed_by, changed_at = now()",
    )
    .bind(enabled)
    .bind(by.account_id())
    .execute(&mut *tx)
    .await?;
    audit::record(
        tx,
        NewAuditEntry {
            actor_id: Some(by.account_id()),
            action: "ai.owner_unlimited_set".into(),
            target_kind: "ai_owner_unlimited".into(),
            target_id: Some(by.account_id().to_string()),
            before: Some(serde_json::json!({ "enabled": before })),
            after: Some(serde_json::json!({ "enabled": enabled })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    Ok(())
}

/// Включён ли режим «owner без личного лимита».
pub async fn owner_unlimited(pool: &PgPool) -> Result<bool> {
    let mut conn = pool.acquire().await?;
    owner_unlimited_in(&mut conn).await
}

async fn owner_unlimited_in(conn: &mut sqlx::PgConnection) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT coalesce((SELECT enabled FROM ai_owner_unlimited WHERE singleton), false)",
    )
    .fetch_one(conn)
    .await?)
}

/// Снять лимит (D-532). Накопленный расход остаётся в истории вызовов.
pub async fn revoke_limit(pool: &PgPool, by: &OwnerConsole, limit_id: Uuid) -> Result<()> {
    let mut tx = pool.begin().await?;
    revoke_limit_in(&mut tx, Some(by.account_id()), limit_id, None).await?;
    tx.commit().await?;
    Ok(())
}

async fn revoke_limit_in(
    conn: &mut sqlx::PgConnection,
    actor: Option<Uuid>,
    limit_id: Uuid,
    reason: Option<&str>,
) -> Result<()> {
    type Row = (
        String,
        Option<Uuid>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
        String,
        i64,
    );
    let row: Option<Row> = sqlx::query_as(
        "UPDATE ai_limits SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL \
         RETURNING scope_kind, account_id, module_id, model_id, provider_id, period, metric, limit_value",
    )
    .bind(limit_id)
    .fetch_optional(&mut *conn)
    .await?;
    let Some((kind, account, module, model, provider, period, metric, value)) = row else {
        return Err(AiError::Invalid(
            "такого лимита нет (или его уже сняли)".into(),
        ));
    };
    audit::record(
        conn,
        NewAuditEntry {
            actor_id: actor,
            action: "ai.limit_revoked".into(),
            target_kind: "ai_limit".into(),
            target_id: Some(limit_id.to_string()),
            before: Some(serde_json::json!({
                "scope": kind, "account_id": account, "module_id": module, "model_id": model,
                "provider_id": provider, "period": period, "metric": metric, "value": value,
            })),
            reason: reason.map(Into::into),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    Ok(())
}

/// Что сделала кнопка «Сделать мне безлимит».
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UnlimitedReport {
    /// Сколько личных денежных лимитов owner снято.
    pub removed_personal: usize,
    /// Поставлен дневной потолок платформы (его не было), микродоллары.
    pub platform_cap_set: Option<i64>,
}

/// «Сделать мне безлимит» (D-530): снять личные денежные лимиты owner (они
/// мешают режиму, D-200), поставить дневной потолок платформы в $, если его
/// нет (без него режим не работает, D-212), и включить режим — одним действием.
pub async fn make_owner_unlimited(
    pool: &PgPool,
    by: &OwnerConsole,
    platform_day_usd: i64,
) -> Result<UnlimitedReport> {
    if platform_day_usd <= 0 {
        return Err(AiError::Invalid(
            "дневной потолок платформы должен быть больше нуля".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let reason = Some("кнопка «Сделать мне безлимит»");
    let personal: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM ai_limits WHERE revoked_at IS NULL AND metric = 'usd' \
         AND scope_kind IN ('user', 'user_module') AND account_id = $1 ORDER BY id FOR UPDATE",
    )
    .bind(by.account_id())
    .fetch_all(&mut *tx)
    .await?;
    for id in &personal {
        revoke_limit_in(&mut tx, Some(by.account_id()), *id, reason).await?;
    }
    let has_cap: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM ai_limits WHERE revoked_at IS NULL \
         AND scope_kind = 'platform' AND period = 'day' AND metric = 'usd')",
    )
    .fetch_one(&mut *tx)
    .await?;
    let mut report = UnlimitedReport {
        removed_personal: personal.len(),
        platform_cap_set: None,
    };
    if !has_cap {
        write_limit(
            &mut tx,
            Some(by.account_id()),
            reason,
            &LimitScope::Platform,
            Period::Day,
            Metric::Usd,
            platform_day_usd,
        )
        .await?;
        report.platform_cap_set = Some(platform_day_usd);
    }
    set_owner_unlimited_in(&mut tx, by, true).await?;
    tx.commit().await?;
    Ok(report)
}

/// Защита от зацикливания (D-534); `None` — как в настройках сервера.
/// `repeat_window_secs` — от 1 до 86 400, остальное — от 0 (выключено) до 10 000.
pub async fn set_loop_guard(
    pool: &PgPool,
    by: &OwnerConsole,
    guard: Option<&crate::LoopGuard>,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    match guard {
        Some(g) => {
            let window = g.repeat_window.as_secs();
            if !(1..=86_400).contains(&window) {
                return Err(AiError::Invalid(
                    "окно повторов — от 1 до 86 400 секунд".into(),
                ));
            }
            if [g.user_per_minute, g.job_per_minute, g.repeat_limit]
                .iter()
                .any(|v| *v > 10_000)
            {
                return Err(AiError::Invalid("не больше 10 000 (0 — выключено)".into()));
            }
            sqlx::query(
                "INSERT INTO ai_loop_guard (singleton, user_per_minute, job_per_minute, repeat_limit, \
                 repeat_window_secs, changed_by, changed_at) VALUES (true, $1, $2, $3, $4, $5, now()) \
                 ON CONFLICT (singleton) DO UPDATE SET user_per_minute = EXCLUDED.user_per_minute, \
                 job_per_minute = EXCLUDED.job_per_minute, repeat_limit = EXCLUDED.repeat_limit, \
                 repeat_window_secs = EXCLUDED.repeat_window_secs, changed_by = EXCLUDED.changed_by, \
                 changed_at = now()",
            )
            .bind(g.user_per_minute as i32)
            .bind(g.job_per_minute as i32)
            .bind(g.repeat_limit as i32)
            .bind(window as i32)
            .bind(by.account_id())
            .execute(&mut *tx)
            .await?;
        }
        None => {
            sqlx::query("DELETE FROM ai_loop_guard")
                .execute(&mut *tx)
                .await?;
        }
    }
    let after = guard.map(|g| {
        serde_json::json!({
            "user_per_minute": g.user_per_minute,
            "job_per_minute": g.job_per_minute,
            "repeat_limit": g.repeat_limit,
            "repeat_window_secs": g.repeat_window.as_secs(),
        })
    });
    record(
        &mut tx,
        by,
        "ai.loop_guard_set",
        "ai_loop_guard",
        "platform".into(),
        after.unwrap_or_else(|| serde_json::json!({ "server_settings": true })),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Сохранить ключ OpenRouter — платформы (`account_id = None`, только owner,
/// D-442) или свой у человека (D-493). Ключ уже зашифрован; в аудит — только
/// последние символы.
pub async fn save_key(
    pool: &PgPool,
    actor: Uuid,
    account_id: Option<Uuid>,
    sealed: &str,
    hint: &str,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "DELETE FROM ai_keys WHERE account_id IS NOT DISTINCT FROM $1 AND provider_id = 'openrouter'",
    )
    .bind(account_id)
    .execute(&mut *tx)
    .await?;
    sqlx::query(
        "INSERT INTO ai_keys (id, account_id, provider_id, key_enc, hint) \
         VALUES ($1, $2, 'openrouter', $3, $4)",
    )
    .bind(qubite_objects::new_id())
    .bind(account_id)
    .bind(sealed)
    .bind(hint)
    .execute(&mut *tx)
    .await
    .map_err(invalid)?;
    key_audit(&mut tx, actor, account_id, "ai.key_set", Some(hint)).await?;
    tx.commit().await?;
    Ok(())
}

/// Убрать ключ. Возвращает `true`, если ключ был.
pub async fn remove_key(pool: &PgPool, actor: Uuid, account_id: Option<Uuid>) -> Result<bool> {
    let mut tx = pool.begin().await?;
    let removed = sqlx::query(
        "DELETE FROM ai_keys WHERE account_id IS NOT DISTINCT FROM $1 AND provider_id = 'openrouter'",
    )
    .bind(account_id)
    .execute(&mut *tx)
    .await?
    .rows_affected()
        > 0;
    if removed {
        key_audit(&mut tx, actor, account_id, "ai.key_removed", None).await?;
    }
    tx.commit().await?;
    Ok(removed)
}

async fn key_audit(
    conn: &mut sqlx::PgConnection,
    actor: Uuid,
    account_id: Option<Uuid>,
    action: &str,
    hint: Option<&str>,
) -> Result<()> {
    audit::record(
        conn,
        NewAuditEntry {
            actor_id: Some(actor),
            action: action.into(),
            target_kind: "ai_key".into(),
            target_id: Some(match account_id {
                Some(id) => format!("openrouter:{id}"),
                None => "openrouter:platform".into(),
            }),
            after: hint.map(|h| serde_json::json!({ "hint": h })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    Ok(())
}

/// Откуда у человека AI (D-493): `owner` — платит платформа по личному лимиту,
/// `chatgpt` — своя подписка, `own_key` — свой ключ OpenRouter.
pub async fn set_source(
    pool: &PgPool,
    account_id: Uuid,
    source: &str,
    chatgpt_model: Option<&str>,
) -> Result<()> {
    if !matches!(source, "owner" | "chatgpt" | "own_key") {
        return Err(AiError::Invalid(
            "источник: owner, chatgpt или own_key".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    let before: Option<String> =
        sqlx::query_scalar("SELECT source FROM ai_sources WHERE account_id = $1 FOR UPDATE")
            .bind(account_id)
            .fetch_optional(&mut *tx)
            .await?;
    sqlx::query(
        "INSERT INTO ai_sources (account_id, source, chatgpt_model, changed_at) \
         VALUES ($1, $2, $3, now()) ON CONFLICT (account_id) DO UPDATE SET \
         source = EXCLUDED.source, chatgpt_model = EXCLUDED.chatgpt_model, changed_at = now()",
    )
    .bind(account_id)
    .bind(source)
    .bind(chatgpt_model)
    .execute(&mut *tx)
    .await
    .map_err(invalid)?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(account_id),
            action: "ai.source_set".into(),
            target_kind: "account".into(),
            target_id: Some(account_id.to_string()),
            before: before.map(|b| serde_json::json!({ "source": b })),
            after: Some(serde_json::json!({ "source": source, "chatgpt_model": chatgpt_model })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Разрешить или запретить модель (allowlist). Если allowlist задан
/// в настройках сервера (`QUBITE_AI_OPENROUTER_MODELS`), при запуске
/// побеждают настройки.
pub async fn set_model_enabled(
    pool: &PgPool,
    by: &OwnerConsole,
    model_id: &str,
    enabled: bool,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    let changed = sqlx::query("UPDATE ai_models SET enabled = $2 WHERE id = $1")
        .bind(model_id)
        .bind(enabled)
        .execute(&mut *tx)
        .await?
        .rows_affected();
    if changed == 0 {
        return Err(AiError::Invalid(format!("нет модели {model_id}")));
    }
    record(
        &mut tx,
        by,
        "ai.model_enabled_set",
        "ai_model",
        model_id.into(),
        serde_json::json!({ "enabled": enabled }),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Разрешить модель из каталога провайдера (цены — из каталога). Уже
/// известную модель — просто включить.
pub async fn enable_from_catalog(
    pool: &PgPool,
    by: &OwnerConsole,
    provider_id: &str,
    external_id: &str,
) -> Result<String> {
    let mut tx = pool.begin().await?;
    let id = crate::catalog::model_id_for(provider_id, external_id);
    let inserted = sqlx::query(
        "INSERT INTO ai_models (id, provider_id, external_id, price_in_per_mtok, price_out_per_mtok, \
         context_tokens, enabled, prices_updated_at) \
         SELECT $3, provider_id, external_id, price_in_per_mtok, price_out_per_mtok, context_tokens, \
                true, fetched_at FROM ai_catalog WHERE provider_id = $1 AND external_id = $2 \
         ON CONFLICT (id) DO UPDATE SET enabled = true, \
             price_in_per_mtok = EXCLUDED.price_in_per_mtok, \
             price_out_per_mtok = EXCLUDED.price_out_per_mtok, \
             context_tokens = EXCLUDED.context_tokens, prices_updated_at = EXCLUDED.prices_updated_at \
         WHERE ai_models.provider_id = EXCLUDED.provider_id",
    )
    .bind(provider_id)
    .bind(external_id)
    .bind(&id)
    .execute(&mut *tx)
    .await
    .map_err(invalid)?
    .rows_affected();
    if inserted == 0 {
        return Err(AiError::Invalid(format!(
            "модели {external_id} нет в каталоге {provider_id} (или ID занят другим провайдером)"
        )));
    }
    record(
        &mut tx,
        by,
        "ai.model_enabled_set",
        "ai_model",
        id.clone(),
        serde_json::json!({ "enabled": true, "from_catalog": provider_id }),
    )
    .await?;
    tx.commit().await?;
    Ok(id)
}

/// Через каких провайдеров OpenRouter идёт модель (slug, по порядку) и
/// `data_collection` (D-211). Пустой список — провайдер выбирает сам;
/// `None` у `data_collection` — по настройке сервера.
pub async fn set_model_routing(
    pool: &PgPool,
    by: &OwnerConsole,
    model_id: &str,
    providers: &[String],
    data_collection: Option<&str>,
) -> Result<()> {
    let valid_slug = |p: &String| {
        !p.is_empty()
            && p.len() <= 80
            && p.bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"-_./".contains(&b))
    };
    if let Some(bad) = providers.iter().find(|p| !valid_slug(p)) {
        return Err(AiError::Invalid(format!(
            "провайдер «{bad}»: нужен slug OpenRouter (строчные буквы, цифры, - _ . /)"
        )));
    }
    if providers.len() > 10 {
        return Err(AiError::Invalid("не больше 10 провайдеров".into()));
    }
    if let Some(value) = data_collection
        && !matches!(value, "allow" | "deny")
    {
        return Err(AiError::Invalid("data_collection: allow или deny".into()));
    }
    let mut tx = pool.begin().await?;
    let changed = sqlx::query(
        "UPDATE ai_models SET routing_providers = $2, data_collection = $3 WHERE id = $1",
    )
    .bind(model_id)
    .bind(providers)
    .bind(data_collection)
    .execute(&mut *tx)
    .await?
    .rows_affected();
    if changed == 0 {
        return Err(AiError::Invalid(format!("нет модели {model_id}")));
    }
    record(
        &mut tx,
        by,
        "ai.model_routing_set",
        "ai_model",
        model_id.into(),
        serde_json::json!({ "providers": providers, "data_collection": data_collection }),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Модель для задачи (`default` — для всех задач без своей). Модель должна
/// быть разрешена. `None` — убрать выбор для задачи.
pub async fn set_task_model(
    pool: &PgPool,
    by: &OwnerConsole,
    task: &str,
    model_id: Option<&str>,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    match model_id {
        Some(model_id) => {
            let enabled: Option<bool> =
                sqlx::query_scalar("SELECT enabled FROM ai_models WHERE id = $1")
                    .bind(model_id)
                    .fetch_optional(&mut *tx)
                    .await?;
            if enabled != Some(true) {
                return Err(AiError::Invalid(format!(
                    "модель {model_id} не разрешена — сначала включите её"
                )));
            }
            sqlx::query(
                "INSERT INTO ai_model_defaults (task, model_id, changed_by) VALUES ($1, $2, $3) \
                 ON CONFLICT (task) DO UPDATE SET model_id = EXCLUDED.model_id, \
                 changed_by = EXCLUDED.changed_by, changed_at = now()",
            )
            .bind(task)
            .bind(model_id)
            .bind(by.account_id())
            .execute(&mut *tx)
            .await
            .map_err(invalid)?;
        }
        None => {
            sqlx::query("DELETE FROM ai_model_defaults WHERE task = $1")
                .bind(task)
                .execute(&mut *tx)
                .await?;
        }
    }
    record(
        &mut tx,
        by,
        "ai.task_model_set",
        "ai_task",
        task.into(),
        serde_json::json!({ "model_id": model_id }),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Выбор моделей по задачам: (задача, модель).
pub async fn task_models(pool: &PgPool) -> Result<Vec<(String, String)>> {
    Ok(sqlx::query_as(
        "SELECT task, model_id FROM ai_model_defaults ORDER BY task = 'default' DESC, task",
    )
    .fetch_all(pool)
    .await?)
}

fn invalid(error: sqlx::Error) -> AiError {
    if let sqlx::Error::Database(db) = &error
        && matches!(db.code().as_deref(), Some("23514" | "23503"))
    {
        return AiError::Invalid(db.message().to_owned());
    }
    AiError::Db(error)
}
