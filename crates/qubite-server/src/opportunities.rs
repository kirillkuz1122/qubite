//! AGT-005a: личный список возможностей и ежедневное пополнение через jobs.

use std::{sync::Arc, time::Duration};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use qubite_home::{Sources, opportunities};
use qubite_jobs::{Job, NewJob, WorkerConfig};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::{sync::watch, task::JoinHandle};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
};

pub const JOB: &str = "opportunities.refresh";

fn api_error(error: qubite_home::Error) -> ApiError {
    match error {
        qubite_home::Error::Invalid(message) => {
            ApiError::new(StatusCode::BAD_REQUEST, "invalid", message)
        }
        qubite_home::Error::Upstream(_) => ApiError::new(
            StatusCode::BAD_GATEWAY,
            "upstream",
            "Источники сейчас не отвечают — прежние записи сохранены",
        ),
        error => {
            tracing::error!(%error, "возможности: ошибка базы");
            ApiError::internal()
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct OpportunitiesQuery {
    /// new, suggested, interested или dismissed.
    status: Option<String>,
    /// olympiad, hackathon или contest.
    kind: Option<String>,
    /// Только ещё не закончившиеся.
    upcoming: Option<bool>,
    /// Сколько строк вернуть (1–200); по умолчанию все.
    limit: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OpportunityItem {
    id: Uuid,
    account_id: Uuid,
    source: String,
    external_id: String,
    kind: String,
    title: String,
    subject: String,
    stage: String,
    grades: String,
    #[serde(with = "time::serde::rfc3339::option")]
    registration_until: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    ends_at: OffsetDateTime,
    place: String,
    url: String,
    tags: Vec<String>,
    status: String,
    why: String,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

impl From<opportunities::Opportunity> for OpportunityItem {
    fn from(item: opportunities::Opportunity) -> Self {
        Self {
            id: item.id,
            account_id: item.account_id,
            source: item.source,
            external_id: item.external_id,
            kind: item.kind,
            title: item.title,
            subject: item.subject,
            stage: item.stage,
            grades: item.grades,
            registration_until: item.registration_until,
            starts_at: item.starts_at,
            ends_at: item.ends_at,
            place: item.place,
            url: item.url,
            tags: item.tags,
            status: item.status,
            why: item.why,
            created_at: item.created_at,
            updated_at: item.updated_at,
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OpportunitiesList {
    items: Vec<OpportunityItem>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct OpportunitiesRefresh {
    inserted: u64,
    failed_sources: Vec<String>,
}

/// Свои возможности по ближайшему сроку регистрации или начала.
#[utoipa::path(get, path = "/api/v1/opportunities", tag = "opportunities", params(OpportunitiesQuery),
    responses(
        (status = 200, description = "Возможности", body = OpportunitiesList),
        (status = 400, description = "Неизвестный фильтр", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn list_opportunities(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<OpportunitiesQuery>,
) -> Result<Json<OpportunitiesList>, ApiError> {
    let items = opportunities::list_upcoming(
        state.db.pool(),
        session.0.account_id,
        query.status.as_deref(),
        query.kind.as_deref(),
        query.upcoming.unwrap_or(false),
        query.limit,
    )
    .await
    .map_err(api_error)?;
    Ok(Json(OpportunitiesList {
        items: items.into_iter().map(Into::into).collect(),
    }))
}

/// Собрать новые возможности из открытых источников для своего аккаунта.
#[utoipa::path(post, path = "/api/v1/opportunities/refresh", tag = "opportunities",
    responses(
        (status = 200, description = "Сбор завершён; failed_sources перечисляет сбои", body = OpportunitiesRefresh),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 502, description = "Все источники недоступны", body = ApiErrorBody),
    ))]
pub async fn refresh_opportunities(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<OpportunitiesRefresh>, ApiError> {
    let result = state
        .home
        .refresh_opportunities(state.db.pool(), session.0.account_id)
        .await
        .map_err(api_error)?;
    Ok(Json(OpportunitiesRefresh {
        inserted: result.inserted,
        failed_sources: result.failed_sources,
    }))
}

/// Результат решения человека. При повторном нажатии новой записи нет.
#[derive(Debug, Serialize, ToSchema)]
pub struct OpportunityDecision {
    action: Option<crate::agent::AgentAction>,
}

/// Создать дела для участия одним откатываемым пакетом.
#[utoipa::path(post, path = "/api/v1/opportunities/{id}/interested", tag = "opportunities",
    params(("id" = Uuid, Path, description = "ID мероприятия")),
    responses(
        (status = 200, description = "Участие запланировано", body = OpportunityDecision),
        (status = 400, description = "Мероприятие уже началось", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту или планеру", body = ApiErrorBody),
        (status = 404, description = "Не найдено", body = ApiErrorBody),
    ))]
pub async fn interested_opportunity(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<OpportunityDecision>, ApiError> {
    let action = qubite_agent::opportunities::decide(
        state.db.pool(),
        &crate::agent::who(&session),
        id,
        true,
    )
    .await
    .map_err(crate::agent::agent_error)?;
    Ok(Json(OpportunityDecision {
        action: action.map(Into::into),
    }))
}

/// Скрыть мероприятие из предложений с возможностью отката.
#[utoipa::path(post, path = "/api/v1/opportunities/{id}/dismiss", tag = "opportunities",
    params(("id" = Uuid, Path, description = "ID мероприятия")),
    responses(
        (status = 200, description = "Мероприятие отклонено", body = OpportunityDecision),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
        (status = 404, description = "Не найдено", body = ApiErrorBody),
    ))]
pub async fn dismiss_opportunity(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<OpportunityDecision>, ApiError> {
    let action = qubite_agent::opportunities::decide(
        state.db.pool(),
        &crate::agent::who(&session),
        id,
        false,
    )
    .await
    .map_err(crate::agent::agent_error)?;
    Ok(Json(OpportunityDecision {
        action: action.map(Into::into),
    }))
}

/// По одной задаче на активный аккаунт и календарный день UTC. Повторный
/// запуск сервера/планировщика не создаёт дублей, новые аккаунты подхватятся.
pub async fn schedule(pool: &PgPool, now: OffsetDateTime) -> qubite_jobs::Result<()> {
    let accounts: Vec<Uuid> =
        sqlx::query_scalar("SELECT id FROM accounts WHERE status = 'active' ORDER BY id")
            .fetch_all(pool)
            .await?;
    let day = qubite_home::format_date(now.to_offset(time::UtcOffset::UTC).date());
    for account in accounts {
        qubite_jobs::enqueue(
            pool,
            NewJob::new(JOB, serde_json::json!({ "account_id": account }))
                .idempotency_key(format!("opportunities:{account}:{day}")),
        )
        .await?;
    }
    Ok(())
}

#[derive(Deserialize)]
struct Payload {
    account_id: Uuid,
}

pub async fn handle(pool: &PgPool, sources: &Sources, job: &Job) -> Result<(), String> {
    if job.kind != JOB {
        return Err("неизвестная задача возможностей".into());
    }
    let payload: Payload =
        serde_json::from_value(job.payload.clone()).map_err(|error| error.to_string())?;
    let active: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM accounts WHERE id = $1 AND status = 'active')",
    )
    .bind(payload.account_id)
    .fetch_one(pool)
    .await
    .map_err(|error| error.to_string())?;
    if !active {
        return Ok(());
    }
    let result = sources
        .refresh_opportunities(pool, payload.account_id)
        .await
        .map_err(|error| error.to_string())?;
    if !result.failed_sources.is_empty() {
        return Err(format!(
            "недоступны источники: {}",
            result.failed_sources.join(", ")
        ));
    }
    Ok(())
}

/// Планировщик и обработчик работают внутри сервера, отдельно от AI-агента.
pub fn spawn(
    pool: PgPool,
    sources: Arc<Sources>,
    mut shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let scheduler_pool = pool.clone();
        let mut scheduler_stop = shutdown.clone();
        let scheduler = async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60 * 60));
            loop {
                if *scheduler_stop.borrow() {
                    return;
                }
                tokio::select! {
                    _ = tick.tick() => {
                        if let Err(error) = schedule(&scheduler_pool, OffsetDateTime::now_utc()).await {
                            tracing::warn!(%error, "возможности: не удалось поставить ежедневные задачи");
                        }
                    }
                    _ = scheduler_stop.changed() => return,
                }
            }
        };
        let worker = async {
            let config = WorkerConfig {
                worker_id: format!("opportunities-{}", Uuid::now_v7()),
                kinds: vec![JOB.into()],
                lease: Duration::from_secs(300),
                idle_poll: Duration::from_secs(5),
            };
            loop {
                let result = qubite_jobs::run_worker(&pool, &config, shutdown.clone(), |job| {
                    let pool = pool.clone();
                    let sources = sources.clone();
                    async move { handle(&pool, &sources, &job).await }
                })
                .await;
                match result {
                    Ok(_) => return,
                    Err(error) => tracing::warn!(%error, "возможности: очередь недоступна"),
                }
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(10)) => {}
                    _ = shutdown.changed() => return,
                }
                if *shutdown.borrow() {
                    return;
                }
            }
        };
        tokio::join!(scheduler, worker);
    })
}
