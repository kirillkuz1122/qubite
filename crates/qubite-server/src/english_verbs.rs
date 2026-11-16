//! Неправильные глаголы по HTTP (ENG-008, D-887…D-889). Логика —
//! `qubite_english::verbs`, права — модуль `agent` (как у всего «Английского»).
//!
//! - `GET /api/v1/english/verbs` — набор по звуковым группам и как идёт каждый
//!   глагол: пора ли повторять, трудный ли, выучен ли; счётчики вкладки;
//! - `POST /api/v1/english/verbs/answer` — ответ из карточек или любой игры:
//!   одна точка записи в повторение (ошибка где угодно — «не знал»), минуты и
//!   опыт как у остальной практики.
//!
//! - `POST /api/v1/english/verbs/recognize` — найти глаголы в списке текстом
//!   (без модели) или на фото (модель «со зрением» через AI-шлюз, бюджет);
//!   ничего не сохраняет — возвращает кандидатов на проверку человеку;
//! - `POST /api/v1/english/verbs/sets` — сохранить набор своих слов;
//! - `DELETE /api/v1/english/verbs/sets/{id}` — удалить набор (глаголы остаются).
//!
//! Тела ответов — JSON из `qubite_english::verbs` (в схеме — объект).

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use base64::Engine;
use qubite_english::{
    verb_sets::{self, Candidate},
    verbs::{self, Answer, Forms, Grade},
};
use serde::Deserialize;
use serde_json::{Value, json};
use utoipa::ToSchema;
use uuid::Uuid;

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

/// Где искать глаголы. Что-то одно: `text` (список, по строке на глагол) или
/// `image_base64` + `mime` (фото доски, учебника, скрин).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishVerbRecognize {
    /// ID действия экрана: повтор распознавания фото не списывается дважды.
    key: Uuid,
    text: Option<String>,
    image_base64: Option<String>,
    /// `image/jpeg`, `image/png` или `image/webp`.
    mime: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/english/verbs/recognize", tag = "english",
    request_body = EnglishVerbRecognize,
    responses(
        (status = 200, description = "{\"verbs\": [{v1, v2, v3, ru, known}]} — кандидаты, не сохранены", body = Object),
        (status = 400, description = "Глаголов не нашлось, не картинка, слишком длинный список", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту или к AI", body = ApiErrorBody),
        (status = 409, description = "Отказ AI-шлюза (бюджет, нет модели)", body = ApiErrorBody),
    ))]
pub async fn english_verbs_recognize(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<EnglishVerbRecognize>,
) -> Result<Json<Value>, ApiError> {
    let account = session.0.account_id;
    let found = match (body.text, body.image_base64) {
        (Some(text), None) => verb_sets::recognize_text(state.db.pool(), account, &text).await,
        (None, Some(image)) => {
            let data = base64::engine::general_purpose::STANDARD
                .decode(image.trim())
                .map_err(|_| {
                    ApiError::new(StatusCode::BAD_REQUEST, "invalid", "картинка не прочитана")
                })?;
            verb_sets::recognize_photo(
                state.db.pool(),
                &state.ai,
                account,
                body.key,
                qubite_ai::Image {
                    mime: body.mime.unwrap_or_else(|| "image/jpeg".into()),
                    data,
                },
            )
            .await
        }
        _ => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid",
                "нужен список текстом или фото — что-то одно",
            ));
        }
    }
    .map_err(english_error)?;
    Ok(Json(json!({ "verbs": found })))
}

/// Глагол набора.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishVerbItem {
    v1: String,
    v2: String,
    v3: String,
    #[serde(default)]
    ru: String,
}

/// Новый набор своих слов.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishVerbSet {
    title: String,
    /// `photo` или `text`.
    source: String,
    verbs: Vec<EnglishVerbItem>,
}

#[utoipa::path(post, path = "/api/v1/english/verbs/sets", tag = "english",
    request_body = EnglishVerbSet,
    responses(
        (status = 200, description = "Вкладка с новым набором (verbs::Overview)", body = Object),
        (status = 400, description = "Пустой набор, неверные формы, слишком много наборов", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn english_verb_set_create(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<EnglishVerbSet>,
) -> Result<Json<Value>, ApiError> {
    let items: Vec<Candidate> = body
        .verbs
        .into_iter()
        .map(|v| Candidate {
            v1: v.v1,
            v2: v.v2,
            v3: v.v3,
            ru: v.ru,
            known: None,
        })
        .collect();
    ok(verb_sets::create(
        state.db.pool(),
        session.0.account_id,
        &body.title,
        &body.source,
        &items,
    )
    .await
    .map_err(english_error)?)
}

#[utoipa::path(delete, path = "/api/v1/english/verbs/sets/{id}", tag = "english",
    params(("id" = Uuid, Path, description = "Набор")),
    responses(
        (status = 200, description = "Вкладка без набора (verbs::Overview)", body = Object),
        (status = 404, description = "Нет такого набора", body = ApiErrorBody),
    ))]
pub async fn english_verb_set_delete(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    ok(verb_sets::delete(state.db.pool(), session.0.account_id, id)
        .await
        .map_err(english_error)?)
}
