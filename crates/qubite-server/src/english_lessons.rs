//! Уроки английского по HTTP (ENG-002): программа, входной тест, уроки,
//! повторение, игра, настройки модуля, голос фраз. Логика —
//! `qubite_english::lessons`, права — модуль `agent` (как у разговора).
//!
//! - `GET /api/v1/english/home` — где ты: программа с личным слоем, игра;
//! - `GET|POST /api/v1/english/placement` — входной тест и его сдача;
//! - `GET /api/v1/english/lessons/{id}` — урок (теория и задания);
//! - `POST /api/v1/english/lessons/{id}/start` — начать урок, домашку, повторение;
//! - `POST /api/v1/english/runs/{id}/answer` — ответ (текстом или голосом);
//! - `POST /api/v1/english/runs/{id}/finish` — итог, опыт, домашка, разбор;
//! - `POST /api/v1/english/runs/{id}/feedback` — отметка у задания (ENG-006);
//! - `POST /api/v1/english/lessons/{id}/ask` — спросить Нейта (можно по-русски);
//! - `POST /api/v1/english/program/adapt` — агент подстраивает программу;
//! - `GET|PATCH /api/v1/english/settings` — настройки модуля;
//! - `POST /api/v1/english/phrase` — голос фразы урока или образец голоса (MP3).
//!
//! Тела ответов — JSON из `qubite_english::lessons` (в схеме — объект).

use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use qubite_english::lessons::{self, FeedbackKind, Given, LearnerChange};
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

#[utoipa::path(get, path = "/api/v1/english/home", tag = "english",
    responses(
        (status = 200, description = "Программа, где ты, игра (lessons::Home)", body = Object),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn english_home(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<Value>, ApiError> {
    ok(lessons::home(state.db.pool(), session.0.account_id)
        .await
        .map_err(english_error)?)
}

#[utoipa::path(get, path = "/api/v1/english/placement", tag = "english",
    responses((status = 200, description = "Входной тест: ступени с вопросами", body = Object)))]
pub async fn english_placement(_session: Authenticated) -> Json<Value> {
    Json(lessons::placement_test())
}

/// Ответы входного теста.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishPlace {
    /// `{"p1": "…", "p3": ["am"]}`.
    #[schema(value_type = Object)]
    answers: Value,
    /// «Легко» (+1) или «трудно» (−1).
    #[serde(default)]
    shift: i8,
}

#[utoipa::path(post, path = "/api/v1/english/placement", tag = "english",
    request_body = EnglishPlace,
    responses(
        (status = 200, description = "Уровень и первый урок", body = Object),
        (status = 400, description = "Неверный сдвиг", body = ApiErrorBody),
    ))]
pub async fn english_place(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<EnglishPlace>,
) -> Result<Json<Value>, ApiError> {
    ok(lessons::place(
        state.db.pool(),
        session.0.account_id,
        &body.answers,
        body.shift,
    )
    .await
    .map_err(english_error)?)
}

#[utoipa::path(get, path = "/api/v1/english/lessons/{id}", tag = "english",
    params(("id" = String, Path, description = "Урок, например a0-m1-l1")),
    responses(
        (status = 200, description = "Урок с личным слоем (lessons::LessonView)", body = Object),
        (status = 404, description = "Нет такого урока (или он ещё планом)", body = ApiErrorBody),
    ))]
pub async fn english_lesson(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    ok(lessons::lesson(state.db.pool(), session.0.account_id, &id)
        .await
        .map_err(english_error)?)
}

/// Что начать.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishStart {
    /// `lesson`, `homework` или `review`.
    kind: String,
}

#[utoipa::path(post, path = "/api/v1/english/lessons/{id}/start", tag = "english",
    params(("id" = String, Path, description = "Урок (у повторения — review)")),
    request_body = EnglishStart,
    responses((status = 200, description = "Прохождение (lessons::RunView)", body = Object)))]
pub async fn english_lesson_start(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<String>,
    Json(body): Json<EnglishStart>,
) -> Result<Json<Value>, ApiError> {
    ok(
        lessons::start(state.db.pool(), session.0.account_id, &id, &body.kind)
            .await
            .map_err(english_error)?,
    )
}

/// Ответ на задание: значение с экрана или запись голоса.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishAnswer {
    /// ID действия экрана: повтор не платится дважды.
    key: Uuid,
    task_id: String,
    /// У повторения — урок задания.
    lesson_id: Option<String>,
    /// Строка, список (пропуски) или пары (соединить).
    #[schema(value_type = Object)]
    answer: Option<Value>,
    audio_base64: Option<String>,
    mime: Option<String>,
    duration_ms: Option<u64>,
    /// Ответ голосом, уже распознанный диктовкой у поля (ENG-006).
    dictated: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/english/runs/{id}/answer", tag = "english",
    params(("id" = Uuid, Path, description = "Прохождение")),
    request_body = EnglishAnswer,
    responses(
        (status = 200, description = "Верно ли, как правильно, опыт (lessons::Answered)", body = Object),
        (status = 400, description = "Пусто, не расслышал, прохождение закончено", body = ApiErrorBody),
        (status = 409, description = "Отказ AI-шлюза (голос)", body = ApiErrorBody),
    ))]
pub async fn english_answer(
    State(state): State<AppState>,
    session: Authenticated,
    Path(run): Path<Uuid>,
    Json(body): Json<EnglishAnswer>,
) -> Result<Json<Value>, ApiError> {
    let given = match (body.answer, body.audio_base64, body.dictated) {
        (Some(value), None, None) => Given::Value(value),
        (None, None, Some(said)) => Given::Dictated(said),
        (None, Some(audio), None) => Given::Voice {
            audio: base64::engine::general_purpose::STANDARD
                .decode(audio.trim())
                .map_err(|_| {
                    ApiError::new(StatusCode::BAD_REQUEST, "invalid", "запись не прочитана")
                })?,
            mime: body.mime.unwrap_or_else(|| "audio/webm".into()),
            duration_ms: body.duration_ms.unwrap_or(0),
        },
        _ => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid",
                "нужен ответ, запись или сказанное — что-то одно",
            ));
        }
    };
    ok(lessons::answer(
        state.db.pool(),
        &state.ai,
        session.0.account_id,
        run,
        body.lesson_id.as_deref(),
        &body.task_id,
        body.key,
        given,
    )
    .await
    .map_err(english_error)?)
}

#[utoipa::path(post, path = "/api/v1/english/runs/{id}/finish", tag = "english",
    params(("id" = Uuid, Path, description = "Прохождение")),
    responses((status = 200, description = "Итог (lessons::Finished)", body = Object)))]
pub async fn english_run_finish(
    State(state): State<AppState>,
    session: Authenticated,
    Path(run): Path<Uuid>,
) -> Result<Json<Value>, ApiError> {
    ok(
        lessons::finish(state.db.pool(), &state.ai, session.0.account_id, run)
            .await
            .map_err(english_error)?,
    )
}

/// Отметка у задания: слишком легко, слишком трудно, ошибка в задании.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishFeedback {
    task_id: String,
    /// Урок задания — только у повторения (там задания из разных уроков).
    lesson_id: Option<String>,
    /// `easy`, `hard` или `broken`.
    #[schema(value_type = String)]
    kind: FeedbackKind,
    /// Что не так — своими словами (до 500 знаков).
    note: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/english/runs/{id}/feedback", tag = "english",
    params(("id" = Uuid, Path, description = "Прохождение")),
    request_body = EnglishFeedback,
    responses(
        (status = 200, description = "{\"action\", \"summary_ru\"} — строка ленты агента", body = Object),
        (status = 404, description = "Нет такого прохождения или задания", body = ApiErrorBody),
    ))]
pub async fn english_feedback(
    State(state): State<AppState>,
    session: Authenticated,
    Path(run): Path<Uuid>,
    Json(body): Json<EnglishFeedback>,
) -> Result<Json<Value>, ApiError> {
    ok(lessons::feedback(
        state.db.pool(),
        session.0.account_id,
        run,
        body.lesson_id.as_deref(),
        &body.task_id,
        body.kind,
        body.note.as_deref(),
    )
    .await
    .map_err(english_error)?)
}

/// Вопрос Нейту.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishAsk {
    text: String,
}

#[utoipa::path(post, path = "/api/v1/english/lessons/{id}/ask", tag = "english",
    params(("id" = String, Path, description = "Урок")),
    request_body = EnglishAsk,
    responses(
        (status = 200, description = "{\"say\": ответ Нейта}", body = Object),
        (status = 409, description = "Отказ AI-шлюза", body = ApiErrorBody),
    ))]
pub async fn english_ask(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<String>,
    Json(body): Json<EnglishAsk>,
) -> Result<Json<Value>, ApiError> {
    let say = lessons::ask(
        state.db.pool(),
        &state.ai,
        session.0.account_id,
        &id,
        &body.text,
    )
    .await
    .map_err(english_error)?;
    Ok(Json(json!({ "say": say })))
}

#[utoipa::path(post, path = "/api/v1/english/program/adapt", tag = "english",
    responses(
        (status = 200, description = "{\"summary_ru\", \"actions\"} — правки в ленте агента", body = Object),
        (status = 409, description = "Отказ AI-шлюза", body = ApiErrorBody),
    ))]
pub async fn english_adapt(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<Value>, ApiError> {
    let (summary, actions) = lessons::adapt(state.db.pool(), &state.ai, session.0.account_id)
        .await
        .map_err(english_error)?;
    Ok(Json(json!({ "summary_ru": summary, "actions": actions })))
}

#[utoipa::path(get, path = "/api/v1/english/settings", tag = "english",
    responses((status = 200, description = "Настройки и голоса на выбор", body = Object)))]
pub async fn english_settings(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<Value>, ApiError> {
    let learner = lessons::settings(state.db.pool(), session.0.account_id)
        .await
        .map_err(english_error)?;
    settings_body(&state, session.0.account_id, learner).await
}

/// Настройки, голоса ElevenLabs и ChatGPT на выбор, какой голос работает (ENG-005).
async fn settings_body(
    state: &AppState,
    account: uuid::Uuid,
    learner: lessons::Learner,
) -> Result<Json<Value>, ApiError> {
    let engine = qubite_english::realtime::engine(state.db.pool(), &state.ai, account)
        .await
        .map_err(english_error)?;
    use qubite_ai::realtime as rt;
    Ok(Json(json!({
        "settings": learner,
        "voices": lessons::VOICES.iter().map(|(id, name, about)| json!({"id": id, "name": name, "about": about})).collect::<Vec<_>>(),
        "sample": lessons::SAMPLE,
        "engine": crate::english::EnglishEngine::from(engine),
        "realtime_models": rt::MODELS.iter().map(|(id, name, about)| json!({"id": id, "name": name, "about": about})).collect::<Vec<_>>(),
        "realtime_voices": rt::VOICES.iter().map(|(id, about)| json!({"id": id, "about": about})).collect::<Vec<_>>(),
    })))
}

/// Поменять настройки (пустое — не трогать).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishSettingsChange {
    level: Option<String>,
    goal_minutes: Option<i32>,
    strictness: Option<i16>,
    voice: Option<String>,
    remind: Option<bool>,
    remind_at: Option<String>,
    rest_weekday: Option<i16>,
    pause_days: Option<i64>,
    companion: Option<String>,
    /// Голос разговора: `chatgpt` (живой, подписка), `elevenlabs`; пусто — сам.
    voice_engine: Option<String>,
    /// Модель живого голоса (`chatgpt:gpt-realtime-1.5` …); пусто — по умолчанию.
    realtime_model: Option<String>,
    /// Голос ChatGPT (`marin` …); пусто — по умолчанию.
    realtime_voice: Option<String>,
}

#[utoipa::path(patch, path = "/api/v1/english/settings", tag = "english",
    request_body = EnglishSettingsChange,
    responses(
        (status = 200, description = "Настройки", body = Object),
        (status = 400, description = "Неверное значение", body = ApiErrorBody),
    ))]
pub async fn english_change_settings(
    State(state): State<AppState>,
    session: Authenticated,
    Json(b): Json<EnglishSettingsChange>,
) -> Result<Json<Value>, ApiError> {
    let learner = lessons::change_settings(
        state.db.pool(),
        session.0.account_id,
        LearnerChange {
            level: b.level,
            goal_minutes: b.goal_minutes,
            strictness: b.strictness,
            voice: b.voice,
            remind: b.remind,
            remind_at: b.remind_at,
            rest_weekday: b.rest_weekday,
            pause_days: b.pause_days,
            companion: b.companion,
            voice_engine: b.voice_engine,
            realtime_model: b.realtime_model,
            realtime_voice: b.realtime_voice,
        },
    )
    .await
    .map_err(english_error)?;
    settings_body(&state, session.0.account_id, learner).await
}

/// Какую фразу озвучить.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishPhrase {
    /// Текст из урока (или образец голоса).
    text: String,
    /// Голос для прослушивания (иначе — свой).
    voice: Option<String>,
}

#[utoipa::path(post, path = "/api/v1/english/phrase", tag = "english",
    request_body = EnglishPhrase,
    responses(
        (status = 200, description = "Речь", content_type = "audio/mpeg", body = Vec<u8>),
        (status = 400, description = "Текст не из уроков", body = ApiErrorBody),
        (status = 409, description = "Голос не настроен или отказ AI-шлюза", body = ApiErrorBody),
    ))]
pub async fn english_phrase(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<EnglishPhrase>,
) -> Result<Response, ApiError> {
    let speech = qubite_english::remind::phrase(
        state.db.pool(),
        &state.ai,
        &state.english,
        session.0.account_id,
        &body.text,
        body.voice.as_deref(),
    )
    .await
    .map_err(english_error)?;
    Ok((
        [
            (header::CONTENT_TYPE, speech.mime),
            (header::CACHE_CONTROL, "private, max-age=86400".to_owned()),
        ],
        speech.audio,
    )
        .into_response())
}
