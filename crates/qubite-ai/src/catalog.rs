//! Каталог моделей провайдера в базе: цены с датой обновления и allowlist
//! (AI-002). Цены берутся только из каталога провайдера — своих «примерных»
//! цен нет: модель без цены из каталога в allowlist не попадает.

use qubite_objects::{NewAuditEntry, audit};
use serde::Serialize;
use sqlx::PgPool;

use crate::{Result, chatgpt, openrouter::CatalogEntry};

/// Стартовый allowlist OpenRouter (D-201): дешёвые и быстрые модели без
/// «размышлений» — для разбора мыслей и коротких ответов.
pub const STARTER_MODELS: &[&str] = &[
    "google/gemini-2.5-flash-lite",
    "openai/gpt-4.1-nano",
    "mistralai/mistral-small-3.2-24b-instruct",
];

/// Как поступить с allowlist при синхронизации.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Allowlist {
    /// Разрешены ровно эти модели (по имени у провайдера), остальные модели
    /// провайдера выключаются.
    Exact(Vec<String>),
    /// Только обновить цены уже известных моделей; что разрешено — не менять.
    Keep,
}

/// Итог синхронизации.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct SyncReport {
    /// Модели с обновлёнными ценами.
    pub updated: Vec<String>,
    /// Разрешены после синхронизации.
    pub enabled: Vec<String>,
    /// Есть в allowlist, но нет в каталоге (или без понятной цены) — не разрешены.
    pub missing: Vec<String>,
}

/// ID модели в Qubite — имя у провайдера строчными буквами.
pub fn model_id(external_id: &str) -> String {
    external_id.to_lowercase()
}

/// ID модели с учётом провайдера: у OpenRouter — имя как есть
/// (`google/gemini-…`), у остальных — с приставкой (`chatgpt:gpt-…`).
pub fn model_id_for(provider_id: &str, external_id: &str) -> String {
    if provider_id == "openrouter" {
        model_id(external_id)
    } else {
        format!("{provider_id}:{}", model_id(external_id))
    }
}

/// Обратно: какой провайдер и какое имя у модели с этим ID.
pub fn split_model_id(id: &str) -> (&str, &str) {
    match id.split_once(':') {
        Some((provider, external)) if provider == crate::chatgpt::PROVIDER_ID => {
            (provider, external)
        }
        _ => ("openrouter", id),
    }
}

/// Завести провайдера, если его нет, и включить/выключить. В аудит —
/// только настоящие изменения (а не каждый запуск сервера).
pub async fn ensure_provider(
    pool: &PgPool,
    id: &str,
    kind: &str,
    base_url: &str,
    enabled: bool,
) -> Result<()> {
    let mut tx = pool.begin().await?;
    let before: Option<(String, String, bool)> =
        sqlx::query_as("SELECT kind, base_url, enabled FROM ai_providers WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await?;
    let after = (kind.to_owned(), base_url.to_owned(), enabled);
    if before.as_ref() == Some(&after) {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO ai_providers (id, kind, base_url, enabled) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (id) DO UPDATE SET kind = EXCLUDED.kind, base_url = EXCLUDED.base_url, \
         enabled = EXCLUDED.enabled, updated_at = now()",
    )
    .bind(id)
    .bind(kind)
    .bind(base_url)
    .bind(enabled)
    .execute(&mut *tx)
    .await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            action: "ai.provider_set".into(),
            target_kind: "ai_provider".into(),
            target_id: Some(id.into()),
            before: before
                .map(|(k, u, e)| serde_json::json!({ "kind": k, "base_url": u, "enabled": e })),
            after: Some(
                serde_json::json!({ "kind": kind, "base_url": base_url, "enabled": enabled }),
            ),
            reason: Some("настройки сервера".into()),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Записать цены из каталога и применить allowlist. Одна транзакция,
/// одна запись в аудите (действие системы, а не человека).
pub async fn apply(
    pool: &PgPool,
    provider_id: &str,
    entries: &[CatalogEntry],
    allowlist: &Allowlist,
) -> Result<SyncReport> {
    apply_snapshot(pool, provider_id, entries, allowlist, None).await
}

/// Обновить каталог подписки и записать каждое изменение доступности в аудит.
pub async fn apply_chatgpt(pool: &PgPool, catalog: &chatgpt::ModelCatalog) -> Result<SyncReport> {
    apply_snapshot(
        pool,
        chatgpt::PROVIDER_ID,
        &catalog.entries,
        &Allowlist::Keep,
        Some(&catalog.listed),
    )
    .await
}

async fn apply_snapshot(
    pool: &PgPool,
    provider_id: &str,
    entries: &[CatalogEntry],
    allowlist: &Allowlist,
    listed: Option<&[String]>,
) -> Result<SyncReport> {
    let mut tx = pool.begin().await?;
    // Таймер, вход и CLI могут обновлять один каталог одновременно.
    sqlx::query("SELECT id FROM ai_providers WHERE id = $1 FOR NO KEY UPDATE")
        .bind(provider_id)
        .execute(&mut *tx)
        .await?;
    let previously_listed: Vec<String> = if listed.is_some() {
        sqlx::query_scalar(
            "SELECT lower(external_id) FROM ai_catalog WHERE provider_id = $1 AND listed",
        )
        .bind(provider_id)
        .fetch_all(&mut *tx)
        .await?
    } else {
        Vec::new()
    };
    // Каталог целиком — из него owner выбирает модели (D-210).
    sqlx::query("DELETE FROM ai_catalog WHERE provider_id = $1")
        .bind(provider_id)
        .execute(&mut *tx)
        .await?;
    for entry in entries {
        sqlx::query(
            "INSERT INTO ai_catalog (provider_id, external_id, context_tokens, price_in_per_mtok, \
             price_out_per_mtok, listed) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING",
        )
        .bind(provider_id)
        .bind(&entry.external_id)
        .bind(entry.context_tokens.max(0))
        .bind(entry.price_in_per_mtok)
        .bind(entry.price_out_per_mtok)
        .bind(listed.is_some_and(|models| models.contains(&entry.external_id)))
        .execute(&mut *tx)
        .await?;
    }
    let known: Vec<(String, bool)> =
        sqlx::query_as("SELECT id, enabled FROM ai_models WHERE provider_id = $1 FOR UPDATE")
            .bind(provider_id)
            .fetch_all(&mut *tx)
            .await?;
    let wanted: Option<Vec<&str>> = match allowlist {
        Allowlist::Exact(list) => Some(list.iter().map(String::as_str).collect()),
        Allowlist::Keep => None,
    };
    let mut report = SyncReport::default();

    for entry in entries {
        let id = model_id_for(provider_id, &entry.external_id);
        let existing = known.iter().find(|(known_id, _)| known_id == &id);
        let was_enabled = existing.is_some_and(|(_, enabled)| *enabled);
        let newly_listed = listed.is_some_and(|models| models.contains(&entry.external_id))
            && !previously_listed.contains(&model_id(&entry.external_id));
        let enabled = match &wanted {
            Some(list) => list.contains(&entry.external_id.as_str()),
            None => was_enabled || newly_listed,
        };
        if existing.is_none() && !enabled {
            continue; // весь каталог в базу не тащим — только нужные модели
        }
        if !id.as_bytes().first().is_some_and(u8::is_ascii_alphanumeric)
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b"_.:/-".contains(&b))
        {
            tracing::warn!(model = entry.external_id, "имя модели не подходит для ID Qubite");
            continue;
        }
        if report.updated.contains(&id) {
            continue;
        }
        let written = sqlx::query(
            "INSERT INTO ai_models (id, provider_id, external_id, price_in_per_mtok, \
             price_out_per_mtok, context_tokens, enabled) VALUES ($1, $2, $3, $4, $5, $6, $7) \
             ON CONFLICT (id) DO UPDATE SET external_id = EXCLUDED.external_id, \
             price_in_per_mtok = EXCLUDED.price_in_per_mtok, \
             price_out_per_mtok = EXCLUDED.price_out_per_mtok, \
             context_tokens = EXCLUDED.context_tokens, enabled = EXCLUDED.enabled, \
             prices_updated_at = now() WHERE ai_models.provider_id = EXCLUDED.provider_id",
        )
        .bind(&id)
        .bind(provider_id)
        .bind(&entry.external_id)
        .bind(entry.price_in_per_mtok)
        .bind(entry.price_out_per_mtok)
        .bind(entry.context_tokens.max(0))
        .bind(enabled)
        .execute(&mut *tx)
        .await?;
        if written.rows_affected() == 0 {
            tracing::warn!(
                model = id,
                "модель с таким ID принадлежит другому провайдеру"
            );
            continue;
        }
        if newly_listed && !was_enabled {
            record_availability(&mut tx, &id, true).await?;
        }
        report.updated.push(id.clone());
        if enabled {
            report.enabled.push(id);
        }
    }

    if listed.is_some() {
        let removed: Vec<String> = sqlx::query_scalar(
            "UPDATE ai_models m SET enabled = false WHERE m.provider_id = $1 AND m.enabled \
             AND NOT ('realtime' = ANY(m.capabilities)) AND NOT EXISTS (\
               SELECT 1 FROM ai_catalog c WHERE c.provider_id = m.provider_id \
               AND lower(c.external_id) = lower(m.external_id)\
             ) RETURNING m.id",
        )
        .bind(provider_id)
        .fetch_all(&mut *tx)
        .await?;
        for id in removed {
            record_availability(&mut tx, &id, false).await?;
        }
    }
    if let Some(list) = &wanted {
        for external in list {
            if !report
                .enabled
                .contains(&model_id_for(provider_id, external))
            {
                report.missing.push((*external).to_owned());
            }
        }
        // Всё, чего нет в списке, выключается — даже если пропало из каталога.
        sqlx::query(
            "UPDATE ai_models SET enabled = false WHERE provider_id = $1 AND enabled \
             AND NOT (id = ANY($2))",
        )
        .bind(provider_id)
        .bind(&report.enabled)
        .execute(&mut *tx)
        .await?;
    }
    if !report.missing.is_empty() {
        tracing::warn!(missing = ?report.missing, "этих моделей нет в каталоге — не разрешены");
    }
    audit::record(
        &mut tx,
        NewAuditEntry {
            action: "ai.catalog_synced".into(),
            target_kind: "ai_provider".into(),
            target_id: Some(provider_id.into()),
            after: Some(serde_json::to_value(&report).expect("отчёт сериализуется")),
            reason: Some("каталог провайдера".into()),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    tx.commit().await?;
    Ok(report)
}

async fn record_availability(conn: &mut sqlx::PgConnection, id: &str, enabled: bool) -> Result<()> {
    audit::record(
        conn,
        NewAuditEntry {
            action: "ai.model_enabled_set".into(),
            target_kind: "ai_model".into(),
            target_id: Some(id.into()),
            after: Some(serde_json::json!({ "enabled": enabled, "from_catalog": chatgpt::PROVIDER_ID })),
            reason: Some("каталог подписки ChatGPT".into()),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    Ok(())
}

/// Самая новая включённая модель Sol. Части версии сравниваются числами.
pub async fn latest_sol(pool: &PgPool) -> Result<Option<String>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT m.id FROM ai_models m JOIN ai_providers p ON p.id = m.provider_id \
         WHERE m.provider_id = $1 AND m.enabled AND p.enabled AND m.id LIKE 'chatgpt:gpt-%-sol'",
    )
    .bind(chatgpt::PROVIDER_ID)
    .fetch_all(pool)
    .await?;
    Ok(ids
        .into_iter()
        .filter_map(|id| {
            let version = id.strip_prefix("chatgpt:gpt-")?.strip_suffix("-sol")?;
            let parts = version
                .split('.')
                .map(|part| {
                    if part.bytes().all(|b| b.is_ascii_digit()) {
                        part.parse::<u64>().ok()
                    } else {
                        None
                    }
                })
                .collect::<Option<Vec<_>>>()?;
            Some((parts, id))
        })
        .max()
        .map(|(_, id)| id))
}

/// Есть ли у провайдера хоть одна модель в базе (первый запуск или нет).
pub async fn has_models(pool: &PgPool, provider_id: &str) -> Result<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM ai_models WHERE provider_id = $1)")
            .bind(provider_id)
            .fetch_one(pool)
            .await?,
    )
}
