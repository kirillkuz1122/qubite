//! Каталог моделей провайдера в базе: цены с датой обновления и allowlist
//! (AI-002). Цены берутся только из каталога провайдера — своих «примерных»
//! цен нет: модель без цены из каталога в allowlist не попадает.

use qubite_objects::{NewAuditEntry, audit};
use serde::Serialize;
use sqlx::PgPool;

use crate::{AiError, Result, openrouter::CatalogEntry};

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
    let mut tx = pool.begin().await?;
    // Каталог целиком — из него owner выбирает модели (D-210).
    sqlx::query("DELETE FROM ai_catalog WHERE provider_id = $1")
        .bind(provider_id)
        .execute(&mut *tx)
        .await?;
    for entry in entries {
        sqlx::query(
            "INSERT INTO ai_catalog (provider_id, external_id, context_tokens, price_in_per_mtok, \
             price_out_per_mtok) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING",
        )
        .bind(provider_id)
        .bind(&entry.external_id)
        .bind(entry.context_tokens.max(0))
        .bind(entry.price_in_per_mtok)
        .bind(entry.price_out_per_mtok)
        .execute(&mut *tx)
        .await?;
    }
    let known: Vec<(String, bool)> =
        sqlx::query_as("SELECT external_id, enabled FROM ai_models WHERE provider_id = $1")
            .bind(provider_id)
            .fetch_all(&mut *tx)
            .await?;
    let wanted: Option<Vec<&str>> = match allowlist {
        Allowlist::Exact(list) => Some(list.iter().map(String::as_str).collect()),
        Allowlist::Keep => None,
    };
    let mut report = SyncReport::default();

    for entry in entries {
        let existing = known.iter().find(|(id, _)| id == &entry.external_id);
        let enabled = match &wanted {
            Some(list) => list.contains(&entry.external_id.as_str()),
            None => existing.is_some_and(|(_, enabled)| *enabled),
        };
        if existing.is_none() && !enabled {
            continue; // весь каталог в базу не тащим — только нужные модели
        }
        let id = model_id_for(provider_id, &entry.external_id);
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
        .await;
        match written {
            Ok(done) if done.rows_affected() == 1 => {
                report.updated.push(id.clone());
                if enabled {
                    report.enabled.push(id);
                }
            }
            Ok(_) => tracing::warn!(
                model = id,
                "модель с таким ID принадлежит другому провайдеру"
            ),
            Err(sqlx::Error::Database(db)) if db.code().as_deref() == Some("23514") => {
                tracing::warn!(
                    model = entry.external_id,
                    "имя модели не подходит для ID Qubite"
                );
            }
            Err(error) => return Err(AiError::Db(error)),
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

/// Есть ли у провайдера хоть одна модель в базе (первый запуск или нет).
pub async fn has_models(pool: &PgPool, provider_id: &str) -> Result<bool> {
    Ok(
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM ai_models WHERE provider_id = $1)")
            .bind(provider_id)
            .fetch_one(pool)
            .await?,
    )
}
