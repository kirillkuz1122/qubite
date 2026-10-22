//! «Английский» по HTTP (ENG-001): разговор с AI-репетитором голосом и
//! текстом.
//!
//! - `GET /api/v1/english` — экран: идущий разговор, прошлый, итоги, готов ли голос;
//! - `POST /api/v1/english/session` — начать (репетитор здоровается);
//! - `POST /api/v1/english/session/finish` — закончить, итог — в «Английский.md»;
//! - `POST /api/v1/english/turn` — сказать (текст или запись голоса);
//! - `POST /api/v1/english/messages/{id}/speech` — голос реплики репетитора (MP3).
//!
//! Права — модуль `agent`: `read` — смотреть, `write` — разговаривать, `ai`
//! и бюджет — модель и голос (всё через AI-шлюз). Логика — `qubite-english`.

use axum::{
    Json,
    extract::{Path, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use base64::Engine;
use qubite_english::{Error, Said};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
};

/// Разговор.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishSession {
    id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    started_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    last_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    finished_at: Option<OffsetDateTime>,
    /// Реплик ученика.
    turns: i32,
    /// Верно с первого раза.
    correct: i32,
    /// С ошибками.
    mistakes: i32,
    /// Строка ленты агента: итог записан в «Английский.md».
    memory_action: Option<Uuid>,
}

impl From<qubite_english::Session> for EnglishSession {
    fn from(s: qubite_english::Session) -> Self {
        Self {
            id: s.id,
            started_at: s.started_at,
            last_at: s.last_at,
            finished_at: s.finished_at,
            turns: s.turns,
            correct: s.correct,
            mistakes: s.mistakes,
            memory_action: s.memory_action,
        }
    }
}

/// Ошибка ученика: что сказал, как правильно, почему.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishMistake {
    wrong: String,
    right: String,
    /// Почему — по-русски, коротко.
    why: String,
}

/// Реплика.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishMessage {
    id: Uuid,
    seq: i64,
    /// `learner` — ученик, `tutor` — репетитор.
    role: String,
    text: String,
    /// У ученика: `text` или `voice`.
    via: String,
    /// У репетитора: `ok` — верно, `mistake` — ошибки, `none` — не о языке.
    verdict: Option<String>,
    mistakes: Vec<EnglishMistake>,
    /// Что повторить правильно (пусто — ничего).
    repeat: String,
    /// Ученик правильно повторил то, что просили.
    repeated: bool,
    /// Голос уже готов (повтор бесплатно).
    has_speech: bool,
    /// Замеры задержки ответа (разговор потоком).
    latency: Option<EnglishLatency>,
    #[serde(with = "time::serde::rfc3339")]
    at: OffsetDateTime,
}

/// Замеры одного хода, мс от конца фразы.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishLatency {
    /// До первого звука ответа — «через сколько ответил».
    first_audio_ms: Option<u64>,
    /// До первого слова ответа.
    first_text_ms: Option<u64>,
    /// Распознавание после конца фразы.
    heard_ms: Option<u64>,
    /// Модель дописала ответ.
    reply_ms: u64,
}

impl From<qubite_english::live::Latency> for EnglishLatency {
    fn from(l: qubite_english::live::Latency) -> Self {
        Self {
            first_audio_ms: l.first_audio_ms,
            first_text_ms: l.first_text_ms,
            heard_ms: l.heard_ms,
            reply_ms: l.reply_ms,
        }
    }
}

impl From<qubite_english::Message> for EnglishMessage {
    fn from(m: qubite_english::Message) -> Self {
        Self {
            id: m.id,
            seq: m.seq,
            role: m.role,
            text: m.text,
            via: m.via,
            verdict: m.verdict.map(|v| v.as_str().to_owned()),
            mistakes: m
                .mistakes
                .into_iter()
                .map(|x| EnglishMistake {
                    wrong: x.wrong,
                    right: x.right,
                    why: x.why,
                })
                .collect(),
            repeat: m.repeat,
            repeated: m.repeated,
            has_speech: m.has_speech,
            latency: m.latency.map(Into::into),
            at: m.at,
        }
    }
}

/// Готов ли голос на сервере.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishVoice {
    /// Распознавание речи (можно говорить).
    listen: bool,
    /// Речь репетитора (он говорит вслух).
    speak: bool,
    /// Распознавание на ходу: ответ почти сразу после паузы (`/english/live`).
    live: bool,
}

/// Итоги по всем разговорам.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishTotals {
    sessions: i64,
    turns: i64,
    correct: i64,
    mistakes: i64,
}

/// Экран «Английский».
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishOverview {
    /// Идущий разговор; `null` — не начат.
    session: Option<EnglishSession>,
    messages: Vec<EnglishMessage>,
    /// Прошлый законченный разговор.
    last: Option<EnglishSession>,
    totals: EnglishTotals,
    voice: EnglishVoice,
}

/// Начатый (или идущий) разговор.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishStarted {
    session: EnglishSession,
    messages: Vec<EnglishMessage>,
}

/// Законченный разговор (`null` — нечего было заканчивать).
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishFinished {
    session: Option<EnglishSession>,
}

/// Реплика ученика: текст **или** запись голоса.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct EnglishSay {
    /// ID действия с экрана: повтор с тем же ключом не платится дважды.
    key: Uuid,
    text: Option<String>,
    /// Запись (base64), до 1,2 МБ.
    audio_base64: Option<String>,
    /// `audio/webm;codecs=opus`, `audio/mp4` …
    mime: Option<String>,
    /// Длина записи, мс (до 120 000).
    duration_ms: Option<u64>,
}

/// Ход: реплика ученика и ответ репетитора.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishTurn {
    session: EnglishSession,
    learner: EnglishMessage,
    tutor: EnglishMessage,
    /// Цена хода (распознавание + модель), миллионные доли доллара.
    cost_usd_micros: i64,
}

/// Отказ хода: как обычная ошибка, плюс что успели распознать.
#[derive(Debug, Serialize, ToSchema)]
pub struct EnglishTurnError {
    error: String,
    message: String,
    /// Распознанный текст, если запись уже распознали, а ответить не вышло:
    /// экран кладёт его в поле — можно отправить текстом.
    heard: Option<String>,
}

fn english_error(error: Error) -> ApiError {
    match error {
        Error::Denied(reason) => qubite_policy::Error::Denied(reason).into(),
        Error::NotFound => ApiError::new(StatusCode::NOT_FOUND, "not_found", "Не найдено"),
        Error::Invalid(message) => ApiError::new(StatusCode::BAD_REQUEST, "invalid", message),
        Error::Ai { error, .. } => error.into(),
        other => {
            tracing::error!(error = %other, "английский: внутренняя ошибка");
            ApiError::internal()
        }
    }
}

fn messages(list: Vec<qubite_english::Message>) -> Vec<EnglishMessage> {
    list.into_iter().map(Into::into).collect()
}

/// Экран: идущий разговор, прошлый, итоги и готов ли голос.
#[utoipa::path(get, path = "/api/v1/english", tag = "english",
    responses(
        (status = 200, description = "Экран «Английский»", body = EnglishOverview),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn english_overview(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<EnglishOverview>, ApiError> {
    let o = qubite_english::overview(state.db.pool(), &state.ai, session.0.account_id)
        .await
        .map_err(english_error)?;
    Ok(Json(EnglishOverview {
        session: o.session.map(Into::into),
        messages: messages(o.messages),
        last: o.last.map(Into::into),
        totals: EnglishTotals {
            sessions: o.totals.sessions,
            turns: o.totals.turns,
            correct: o.totals.correct,
            mistakes: o.totals.mistakes,
        },
        voice: EnglishVoice {
            listen: o.voice.listen,
            speak: o.voice.speak,
            live: o.voice.live,
        },
    }))
}

/// Начать разговор (или вернуть идущий): репетитор здоровается.
#[utoipa::path(post, path = "/api/v1/english/session", tag = "english",
    responses(
        (status = 200, description = "Разговор", body = EnglishStarted),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn english_start(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<EnglishStarted>, ApiError> {
    let (s, list) = qubite_english::start(state.db.pool(), session.0.account_id)
        .await
        .map_err(english_error)?;
    Ok(Json(EnglishStarted {
        session: s.into(),
        messages: messages(list),
    }))
}

/// Закончить разговор: итог — в «Английский.md» (строка ленты агента).
#[utoipa::path(post, path = "/api/v1/english/session/finish", tag = "english",
    responses(
        (status = 200, description = "Разговор закончен", body = EnglishFinished),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn english_finish(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<EnglishFinished>, ApiError> {
    let s = qubite_english::finish(state.db.pool(), session.0.account_id)
        .await
        .map_err(english_error)?;
    Ok(Json(EnglishFinished {
        session: s.map(Into::into),
    }))
}

/// Сказать репетитору: текст или запись голоса (распознаётся через AI-шлюз).
#[utoipa::path(post, path = "/api/v1/english/turn", tag = "english",
    request_body = EnglishSay,
    responses(
        (status = 200, description = "Ответ репетитора с разбором ошибок", body = EnglishTurn),
        (status = 400, description = "Пусто, слишком длинно, не расслышал", body = ApiErrorBody),
        (status = 403, description = "Нет доступа или AI-гранта", body = ApiErrorBody),
        (status = 409, description = "Отказ AI-шлюза (бюджет, провайдер); heard — что распознали",
         body = EnglishTurnError),
    ))]
pub async fn english_turn(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<EnglishSay>,
) -> Result<Response, ApiError> {
    let said = match (body.text, body.audio_base64) {
        (Some(text), None) => Said::Text(text),
        (None, Some(audio)) => {
            let audio = base64::engine::general_purpose::STANDARD
                .decode(audio.trim())
                .map_err(|_| {
                    ApiError::new(StatusCode::BAD_REQUEST, "invalid", "запись не прочитана")
                })?;
            Said::Voice {
                audio,
                mime: body.mime.unwrap_or_else(|| "audio/webm".into()),
                duration_ms: body.duration_ms.unwrap_or(0),
            }
        }
        _ => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid",
                "нужен текст или запись — что-то одно",
            ));
        }
    };
    match qubite_english::turn(
        state.db.pool(),
        &state.ai,
        &state.english,
        session.0.account_id,
        body.key,
        said,
    )
    .await
    {
        Ok(t) => Ok(Json(EnglishTurn {
            session: t.session.into(),
            learner: t.learner.into(),
            tutor: t.tutor.into(),
            cost_usd_micros: t.cost_usd_micros,
        })
        .into_response()),
        Err(Error::Ai {
            error,
            heard: Some(heard),
        }) => {
            let api: ApiError = error.into();
            let status = api.status;
            let body = serde_json::to_value(EnglishTurnError {
                error: api.code.into(),
                message: api.message,
                heard: Some(heard),
            })
            .unwrap_or(Value::Null);
            Ok((status, Json(body)).into_response())
        }
        Err(error) => Err(english_error(error)),
    }
}

/// Голос реплики репетитора (MP3). Готовый — бесплатно; новый — через AI-шлюз.
#[utoipa::path(post, path = "/api/v1/english/messages/{id}/speech", tag = "english",
    params(("id" = Uuid, Path, description = "ID реплики репетитора")),
    responses(
        (status = 200, description = "Речь", content_type = "audio/mpeg", body = Vec<u8>),
        (status = 404, description = "Нет такой реплики", body = ApiErrorBody),
        (status = 409, description = "Голос не настроен или отказ AI-шлюза", body = ApiErrorBody),
    ))]
pub async fn english_speech(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let speech = qubite_english::speech(
        state.db.pool(),
        &state.ai,
        &state.english,
        session.0.account_id,
        id,
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

// ---------------------------------------------------------------- потоком

/// Разговор потоком (WebSocket): ответ почти сразу, как у живого собеседника.
///
/// С экрана: двоичные кадры — PCM 16 бит, 16 кГц, моно (микрофон); текстом —
/// `{"type":"listen"}` (начал говорить), `{"type":"done"}` (пауза / «Готово»),
/// `{"type":"text","text":"…"}`, `{"type":"interrupt"}` (перебил).
/// На экран: двоичные кадры — голос репетитора, PCM 16 бит, 24 кГц, моно,
/// кусками по мере синтеза; текстом — `{"type":"partial","text"}`,
/// `{"type":"heard","text"}`, `{"type":"say","text"}` (кусок ответа),
/// `{"type":"metrics", …}` ([`EnglishLatency`]), `{"type":"reply","turn"}`
/// ([`EnglishTurn`]), `{"type":"error","error","message","heard","stop"}`
/// (`stop` — повтор не поможет: выключить микрофон и ждать «Попробовать снова»).
/// Права — как у хода; браузер подключается только со своего сайта.
#[utoipa::path(get, path = "/api/v1/english/live", tag = "english",
    responses(
        (status = 101, description = "Соединение открыто"),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Чужой сайт или нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn english_live(
    State(state): State<AppState>,
    session: Authenticated,
    headers: axum::http::HeaderMap,
    upgrade: axum::extract::ws::WebSocketUpgrade,
) -> Result<Response, ApiError> {
    if session.0.kind == "web" && !crate::sync::same_origin(&headers) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "origin_rejected",
            "Подключение с другого сайта запрещено",
        ));
    }
    crate::modules::authorize::<qubite_policy::Write>(&state, &session, qubite_english::MODULE)
        .await?;
    let account = session.0.account_id;
    Ok(upgrade.on_upgrade(move |socket| run_live(socket, state, account)))
}

async fn run_live(socket: axum::extract::ws::WebSocket, state: AppState, account: Uuid) {
    use axum::extract::ws::Message;
    use futures_util::{SinkExt, StreamExt};
    use qubite_english::live::{In, Out};

    let (mut sink, mut stream) = socket.split();
    let (in_tx, in_rx) = tokio::sync::mpsc::channel::<In>(256);
    let (out_tx, mut out_rx) = tokio::sync::mpsc::channel::<Out>(256);
    let reader = tokio::spawn(async move {
        while let Some(Ok(frame)) = stream.next().await {
            let msg = match frame {
                Message::Binary(pcm) => In::Audio(pcm.to_vec()),
                Message::Text(text) => {
                    let Ok(json) = serde_json::from_str::<Value>(text.as_str()) else {
                        continue;
                    };
                    match json["type"].as_str().unwrap_or_default() {
                        "listen" => In::Listen,
                        "done" => In::Done,
                        "interrupt" => In::Interrupt,
                        "text" => In::Text(json["text"].as_str().unwrap_or_default().to_owned()),
                        _ => continue,
                    }
                }
                Message::Close(_) => break,
                _ => continue,
            };
            if in_tx.send(msg).await.is_err() {
                break;
            }
        }
    });
    let writer = tokio::spawn(async move {
        while let Some(out) = out_rx.recv().await {
            let frame = match out {
                Out::Audio(pcm) => Message::Binary(pcm.into()),
                Out::Partial(text) => {
                    text_frame(serde_json::json!({"type": "partial", "text": text}))
                }
                Out::Heard(text) => text_frame(serde_json::json!({"type": "heard", "text": text})),
                Out::Say(text) => text_frame(serde_json::json!({"type": "say", "text": text})),
                Out::Metrics(latency) => {
                    let mut json =
                        serde_json::to_value(EnglishLatency::from(latency)).unwrap_or_default();
                    json["type"] = "metrics".into();
                    text_frame(json)
                }
                Out::Reply(turn) => {
                    let t = *turn;
                    let turn = EnglishTurn {
                        session: t.session.into(),
                        learner: t.learner.into(),
                        tutor: t.tutor.into(),
                        cost_usd_micros: t.cost_usd_micros,
                    };
                    text_frame(serde_json::json!({"type": "reply", "turn": turn}))
                }
                Out::Error {
                    code,
                    message,
                    heard,
                    stop,
                } => text_frame(serde_json::json!({
                    "type": "error", "error": code, "message": message, "heard": heard, "stop": stop,
                })),
            };
            if sink.send(frame).await.is_err() {
                break;
            }
        }
        let _ = sink.close().await;
    });
    if let Err(error) = qubite_english::live::serve(
        state.db.pool(),
        &state.ai,
        &state.english,
        account,
        in_rx,
        out_tx,
    )
    .await
    {
        tracing::warn!(%error, "английский потоком: разговор оборвался");
    }
    reader.abort();
    let _ = writer.await;
}

fn text_frame(json: Value) -> axum::extract::ws::Message {
    axum::extract::ws::Message::Text(json.to_string().into())
}
