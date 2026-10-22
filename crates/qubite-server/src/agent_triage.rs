//! Агент раскладывает Входящие (CMD-004) по HTTP: что он сейчас обдумывает и
//! что разложил («разложил → Русский · дело на чт» с «Откатить» — откат идёт
//! обычным `POST /api/v1/agent/batches/{id}/revert`), ответ владельца на
//! вопрос «посмотри сам». Сам разбор — задача очереди `agent.triage` в
//! `qubite serve` ([`crate::agent_memory::spawn`]).

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use qubite_agent::triage;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    agent::{agent_error, who},
    auth::{ApiError, ApiErrorBody, Authenticated},
};

/// Что агент разложил из Входящих.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentFiled {
    item_id: Uuid,
    /// Мысль, как её записали.
    thought: String,
    /// «Русский · дело на чт», «идея», «в архив».
    label: String,
    action_id: Uuid,
    /// Пакет — «Откатить» откатывает его целиком.
    batch_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    at: OffsetDateTime,
    /// Почему так.
    reason: Option<String>,
}

/// Агент и Входящие сейчас.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentTriage {
    /// Мысли, за которые агент вот-вот возьмётся (Элик думает).
    thinking: Vec<Uuid>,
    /// Разложенное за сутки и не откаченное, новые сверху.
    filed: Vec<AgentFiled>,
}

/// Ответ владельца на вопрос агента о мысли.
#[derive(Debug, Deserialize, ToSchema)]
pub struct AgentTriageAnswer {
    /// Вариант из вопроса или свои слова: «Информатика», «это идея».
    answer: String,
}

/// Что агент обдумывает и что разложил во Входящих.
#[utoipa::path(get, path = "/api/v1/agent/triage", tag = "agent",
    responses(
        (status = 200, description = "Обдумывает и разложил", body = AgentTriage),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn triage_overview(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<AgentTriage>, ApiError> {
    let overview = triage::overview(state.db.pool(), &who(&session))
        .await
        .map_err(agent_error)?;
    Ok(Json(AgentTriage {
        thinking: overview.thinking,
        filed: overview
            .filed
            .into_iter()
            .map(|filed| AgentFiled {
                item_id: filed.item_id,
                thought: filed.thought,
                label: filed.label,
                action_id: filed.action_id,
                batch_id: filed.batch_id,
                at: filed.at,
                reason: filed.reason,
            })
            .collect(),
    }))
}

/// Ответить на вопрос агента «посмотри сам»: агент разложит мысль по ответу
/// и запомнит, чтобы в следующий раз не спрашивать.
#[utoipa::path(post, path = "/api/v1/agent/triage/{id}/answer", tag = "agent",
    request_body = AgentTriageAnswer,
    params(("id" = Uuid, Path, description = "ID мысли во Входящих")),
    responses(
        (status = 202, description = "Агент разложит по ответу"),
        (status = 400, description = "Пустой ответ или агент об этом не спрашивал", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
        (status = 404, description = "Нет такой мысли", body = ApiErrorBody),
    ))]
pub async fn triage_answer(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentTriageAnswer>,
) -> Result<StatusCode, ApiError> {
    triage::answer(state.db.pool(), &who(&session), id, &request.answer)
        .await
        .map_err(agent_error)?;
    Ok(StatusCode::ACCEPTED)
}
