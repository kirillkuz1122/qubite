//! Неправильные глаголы по HTTP (ENG-008, D-887…D-889). Логика —
//! `qubite_english::verbs`, права — модуль `agent` (как у всего «Английского»).
//!
//! - `GET /api/v1/english/verbs` — набор по звуковым группам и как идёт каждый
//!   глагол: пора ли повторять, трудный ли, выучен ли; счётчики вкладки;
//! - `POST /api/v1/english/verbs/answer` — ответ из карточек или любой игры:
//!   одна точка записи в повторение (ошибка где угодно — «не знал»), минуты и
//!   опыт как у остальной практики.
//!
//! Тела ответов — JSON из `qubite_english::verbs` (в схеме — объект).

use axum::{Json, extract::State};
use qubite_english::verbs::{self, Answer, Forms, Grade};
use serde::Deserialize;
use serde_json::Value;
use utoipa::ToSchema;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    english::english_error,
};

fn ok<T: serde::Serialize>(value: T) -> Result<Json<Value>, ApiError> {
    Ok(Json(
        serde_json::to_value(value).map_err(|_| ApiError::internal())?,
    ))
}

#[utoipa::path(get, path = "/api/v1/english/verbs", tag = "english",
    responses(
        (status = 200, description = "Глаголы по группам с прогрессом и счётчики (verbs::Overview)", body = Object),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn english_verbs(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<Value>, ApiError> {
    ok(verbs::overview(state.db.pool(), session.0.account_id)
        .await
        .map_err(english_error)?)
}

/// Вписанные формы глагола.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishVerbForms {
    /// Первая форма — если спрашивали по переводу.
    v1: Option<String>,
    v2: String,
    v3: String,
}

/// Ответ на глагол. Что-то одно: `given` (впиши формы — сверяет сервер), `said`
/// (скажи вслух — сверяет сервер), `grade` (карточки) или `correct` (остальные игры).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishVerbAnswer {
    /// Глагол из набора, например `go`.
    verb_id: String,
    /// `cards`, `match`, `quiz`, `type`, `anagram`, `search`, `speak` или `sprint`.
    mode: String,
    correct: Option<bool>,
    /// `again`, `good` или `easy`.
    #[schema(value_type = Option<String>)]
    grade: Option<Grade>,
    given: Option<EnglishVerbForms>,
    /// Распознанная речь: три формы подряд.
    said: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/english/verbs/answer", tag = "english",
    request_body = EnglishVerbAnswer,
    responses(
        (status = 200, description = "Верно ли, правильные формы, новое состояние глагола, опыт (verbs::Answered)", body = Object),
        (status = 400, description = "Нет такого глагола или игры, лишние или слишком длинные поля", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn english_verb_answer(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<EnglishVerbAnswer>,
) -> Result<Json<Value>, ApiError> {
    ok(verbs::answer(
        state.db.pool(),
        session.0.account_id,
        Answer {
            verb_id: body.verb_id,
            mode: body.mode,
            correct: body.correct,
            grade: body.grade,
            given: body.given.map(|g| Forms {
                v1: g.v1,
                v2: g.v2,
                v3: g.v3,
            }),
            said: body.said,
        },
    )
    .await
    .map_err(english_error)?)
}
