//! Агент пишет первым (AGT-004) по HTTP: вкладка «Когда писать» раздела
//! «Агент» (как часто, «не сегодня», тишина, свободные окна) и ответ кнопкой
//! под сообщением колокольчика («Да · 15 минут · Позже · Не сегодня»).
//!
//! Решает сервер ([`qubite_agent::proactive`]), не модель: лимит, тишину и
//! «не сегодня» агент обойти не может.

use axum::{
    Json,
    extract::{Path, State},
};
use qubite_agent::{
    free::Window,
    proactive::{self, PaceChange},
};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    agent::{agent_error, who},
    auth::{ApiError, ApiErrorBody, Authenticated},
};

/// Свободное окно.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentWindow {
    /// `ЧЧ:ММ`.
    from: String,
    to: String,
    minutes: i64,
}

impl From<Window> for AgentWindow {
    fn from(window: Window) -> Self {
        Self {
            from: window.from,
            to: window.to,
            minutes: window.minutes,
        }
    }
}

/// Как часто агент пишет первым и что сейчас.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentPace {
    /// `auto` — сколько Qubite захочет (по умолчанию), `count` — не больше
    /// `per_day`, `off` — вообще не писать первым.
    mode: String,
    per_day: i64,
    /// Ты сказал «не сегодня» — до завтра агент молчит.
    not_today: bool,
    /// Сколько можно сегодня (у `auto` — сколько агент выучил по ответам).
    limit: i64,
    /// Сколько уже написал первым сегодня.
    sent: i64,
    /// Почему сейчас тишина: «ночь», «урок по расписанию», «не сегодня».
    quiet: Option<String>,
    /// Вкладка Qubite видна прямо сейчас.
    in_qubite: bool,
    /// Свободные окна до конца дня.
    windows: Vec<AgentWindow>,
    /// Что агент заметил по ответам: «вт 16–18: свободен 3 из 3».
    patterns: Vec<String>,
}

/// Изменить: только то, что пришло.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentPaceChange {
    /// `auto`, `count`, `off`.
    mode: Option<String>,
    /// 1…20, для `count`.
    per_day: Option<i64>,
    /// `true` — «не сегодня», `false` — снова можно.
    not_today: Option<bool>,
}

async fn current(state: &AppState, session: &Authenticated) -> Result<AgentPace, ApiError> {
    let status = proactive::status(state.db.pool(), &who(session))
        .await
        .map_err(agent_error)?;
    Ok(AgentPace {
        mode: status.pace.mode.as_str().to_owned(),
        per_day: status.pace.per_day,
        not_today: status.not_today,
        limit: status.limit,
        sent: status.sent,
        quiet: status.presence.quiet,
        in_qubite: status.presence.in_qubite,
        windows: status.windows.into_iter().map(AgentWindow::from).collect(),
        patterns: status.patterns,
    })
}

/// Как часто агент пишет первым, тишина сейчас и свободные окна сегодня.
#[utoipa::path(get, path = "/api/v1/agent/pace", tag = "agent",
    responses(
        (status = 200, description = "Настройка и что сейчас", body = AgentPace),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn get_pace(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<AgentPace>, ApiError> {
    Ok(Json(current(&state, &session).await?))
}

/// Изменить «как часто писать первым» или сказать «не сегодня».
#[utoipa::path(patch, path = "/api/v1/agent/pace", tag = "agent",
    request_body = AgentPaceChange,
    responses(
        (status = 200, description = "Сохранено", body = AgentPace),
        (status = 400, description = "Неверное значение", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn change_pace(
    State(state): State<AppState>,
    session: Authenticated,
    Json(change): Json<AgentPaceChange>,
) -> Result<Json<AgentPace>, ApiError> {
    proactive::save_pace(
        state.db.pool(),
        &who(&session),
        &PaceChange {
            mode: change.mode,
            per_day: change.per_day,
            not_today: change.not_today,
        },
    )
    .await
    .map_err(agent_error)?;
    Ok(Json(current(&state, &session).await?))
}

/// Ответ кнопкой.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NoticeAnswer {
    /// `id` кнопки из `options` сообщения.
    answer: String,
}

/// Что будет дальше.
#[derive(Debug, Serialize, ToSchema)]
pub struct NoticeAnswered {
    /// Принят ли ответ (уже отвечали — `false`).
    accepted: bool,
    /// «Хорошо — сейчас предложу, чем заняться».
    hint: String,
}

/// Ответить кнопкой под сообщением колокольчика. Сообщение гаснет везде;
/// агент на «да» предложит дело, на «позже» спросит через час, на «не
/// сегодня» замолчит до завтра.
#[utoipa::path(post, path = "/api/v1/notifications/{id}/answer", tag = "notifications",
    request_body = NoticeAnswer,
    params(("id" = Uuid, Path, description = "Сообщение")),
    responses(
        (status = 200, description = "Ответ принят", body = NoticeAnswered),
        (status = 400, description = "Нет такой кнопки", body = ApiErrorBody),
        (status = 404, description = "Нет такого сообщения", body = ApiErrorBody),
    ))]
pub async fn answer_notice(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(body): Json<NoticeAnswer>,
) -> Result<Json<NoticeAnswered>, ApiError> {
    let outcome = proactive::answer(state.db.pool(), session.0.account_id, id, &body.answer)
        .await
        .map_err(agent_error)?;
    Ok(Json(match outcome {
        Some(outcome) => NoticeAnswered {
            accepted: true,
            hint: outcome.hint,
        },
        None => NoticeAnswered {
            accepted: false,
            hint: "На это уже ответили".into(),
        },
    }))
}
