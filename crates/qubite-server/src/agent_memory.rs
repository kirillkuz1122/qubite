//! Папка агента, разговор и вопросы по HTTP (AGT-001).
//!
//! - **«Записи»**: дерево файлов, просмотр, правка руками (твоя поправка в
//!   ленте), выгрузка `.md`, поле «Поправить» (агент исправляет сразу);
//! - **разговор** с агентом — чат раздела «Агент» (Telegram — в `qubite bot`);
//! - **«Агент хочет знать»** — ответить или отмахнуться;
//! - **расписание**, разобранное из «Расписание.md».
//!
//! Читать — право `read` в модуле `agent`; менять и писать агенту — `write`.
//! Ответы агента, урок на поправке и куратор навыков — задачи очереди в
//! `qubite serve` ([`spawn`]): там AI-шлюз. Тесты подменяют модель поддельной.

use std::{sync::Arc, time::Duration};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{StatusCode, header},
    response::{IntoResponse, Response},
};
use qubite_agent::{
    brain,
    chat::{self, Channel, NewMessage},
    files::{self, Kind},
    memory, proactive, questions, skills,
};
use qubite_jobs::Job;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use tokio::{sync::watch, task::JoinHandle};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    agent::{AgentAction, agent_error, who},
    auth::{ApiError, ApiErrorBody, Authenticated},
};

// ---------------------------------------------------------------- файлы

/// Файл папки агента в списке.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentFileInfo {
    id: Uuid,
    /// «Память.md», «Проекты/Алгебра.md», «Навыки/ДЗ.md».
    path: String,
    /// `core` — «Кто я»; `user` — «О тебе»; `memory` — «Память»;
    /// `project` — файл проекта; `skill` — навык; `file` — свой файл агента.
    kind: String,
    /// Знаков сейчас (у «Кто я» — в «Твоих правилах»).
    chars: usize,
    /// Сколько можно.
    limit: usize,
    /// Проект файла «Проекты/…», если такой есть.
    project_id: Option<Uuid>,
    /// Версия — передать при правке руками.
    revision: i64,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    /// Навык закреплён: куратор его не трогает.
    pinned: bool,
    /// Навык в архиве (агент его не видит; вернуть — `/skills/{id}/restore`).
    archived: bool,
}

impl From<&files::File> for AgentFileInfo {
    fn from(file: &files::File) -> Self {
        let (chars, limit) = file.usage();
        Self {
            id: file.id,
            path: file.path.clone(),
            kind: file.kind.as_str().to_owned(),
            chars,
            limit,
            project_id: file.project_id,
            revision: file.revision,
            updated_at: file.updated_at,
            pinned: file.pinned,
            archived: file.archived,
        }
    }
}

/// Папка агента.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentFileList {
    files: Vec<AgentFileInfo>,
}

/// Файл целиком.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentFile {
    #[serde(flatten)]
    info: AgentFileInfo,
    /// Текст, который правится (у «Кто я» — только «Твои правила»).
    body: String,
    /// У «Кто я» — основа: её пишем мы, агент её не меняет.
    core: Option<String>,
}

/// Правка руками.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentFileEdit {
    /// Весь текст (у «Кто я» — «Твои правила»).
    body: String,
    /// Версия, которую ты видел; изменилась — 409, перечитать.
    revision: i64,
}

/// «Поправить»: что не так в файле — агент исправит сразу.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentFixText {
    text: String,
}

async fn authorize(state: &AppState, session: &Authenticated) -> Result<(), ApiError> {
    qubite_agent::timeline::authorize_read(state.db.pool(), &who(session))
        .await
        .map_err(agent_error)
}

fn db_error(error: sqlx::Error) -> ApiError {
    agent_error(qubite_agent::Error::Db(error))
}

/// Папка агента: «Кто я», «О тебе», «Память», проекты, навыки, свои файлы.
/// Новому человеку первые три файла заводятся сами.
#[utoipa::path(get, path = "/api/v1/agent/files", tag = "agent",
    responses(
        (status = 200, description = "Файлы папки", body = AgentFileList),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn list_files(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<AgentFileList>, ApiError> {
    authorize(&state, &session).await?;
    let account = session.0.account_id;
    memory::ensure_base(state.db.pool(), account)
        .await
        .map_err(agent_error)?;
    let mut conn = state.db.pool().acquire().await.map_err(db_error)?;
    let list = files::list(&mut conn, account).await.map_err(db_error)?;
    Ok(Json(AgentFileList {
        files: list.iter().map(AgentFileInfo::from).collect(),
    }))
}

async fn own_file(
    state: &AppState,
    session: &Authenticated,
    id: Uuid,
) -> Result<files::File, ApiError> {
    authorize(state, session).await?;
    let mut conn = state.db.pool().acquire().await.map_err(db_error)?;
    files::by_id(&mut conn, session.0.account_id, id)
        .await
        .map_err(db_error)?
        .ok_or_else(|| agent_error(qubite_agent::Error::NotFound))
}

/// Один файл.
#[utoipa::path(get, path = "/api/v1/agent/files/{id}", tag = "agent",
    params(("id" = Uuid, Path, description = "ID файла")),
    responses(
        (status = 200, description = "Файл", body = AgentFile),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
        (status = 404, description = "Нет такого файла", body = ApiErrorBody),
    ))]
pub async fn get_file(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<AgentFile>, ApiError> {
    let file = own_file(&state, &session, id).await?;
    Ok(Json(AgentFile {
        info: AgentFileInfo::from(&file),
        core: (file.kind == Kind::Core).then(|| files::CORE.to_owned()),
        body: file.body,
    }))
}

/// Поправить файл руками. Это твоя поправка: видна в ленте и откатывается.
/// Пароли и коды вычёркиваются; размер и формат (расписание, навык) проверяются.
#[utoipa::path(put, path = "/api/v1/agent/files/{id}", tag = "agent",
    request_body = AgentFileEdit,
    params(("id" = Uuid, Path, description = "ID файла")),
    responses(
        (status = 200, description = "Правка — строка ленты", body = AgentAction),
        (status = 400, description = "Слишком длинно, неверная таблица расписания или ничего не изменилось", body = ApiErrorBody),
        (status = 403, description = "Нет права менять", body = ApiErrorBody),
        (status = 404, description = "Нет такого файла", body = ApiErrorBody),
        (status = 409, description = "Файл уже изменили — перечитать", body = ApiErrorBody),
    ))]
pub async fn edit_file(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentFileEdit>,
) -> Result<Json<AgentAction>, ApiError> {
    let action = memory::edit(
        state.db.pool(),
        &who(&session),
        id,
        &request.body,
        request.revision,
    )
    .await
    .map_err(agent_error)?;
    Ok(Json(action.into()))
}

/// `filename*` по RFC 5987: имя файла по-русски.
fn encode_filename(name: &str) -> String {
    name.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._".contains(&b) {
                char::from(b).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

/// Выгрузить файл как `.md` (навык — как `SKILL.md`).
#[utoipa::path(get, path = "/api/v1/agent/files/{id}/download", tag = "agent",
    params(("id" = Uuid, Path, description = "ID файла")),
    responses(
        (status = 200, description = "Markdown", content_type = "text/markdown", body = String),
        (status = 404, description = "Нет такого файла", body = ApiErrorBody),
    ))]
pub async fn download_file(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let file = own_file(&state, &session, id).await?;
    let name = match file.kind {
        Kind::Skill => "SKILL.md".to_owned(),
        _ => format!("{}.md", files::display_name(&file.path)),
    };
    let disposition = format!(
        "attachment; filename=\"agent.md\"; filename*=UTF-8''{}",
        encode_filename(&name)
    );
    Ok((
        [
            (
                header::CONTENT_TYPE,
                "text/markdown; charset=utf-8".to_owned(),
            ),
            (header::CONTENT_DISPOSITION, disposition),
        ],
        file.text(),
    )
        .into_response())
}

// ---------------------------------------------------------------- разговор

/// Сообщение разговора с агентом.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentMessage {
    id: Uuid,
    /// Порядок; курсор `after`.
    seq: i64,
    /// `owner` — ты, `agent` — агент.
    role: String,
    /// `web` — чат, `telegram` — бот, `fix` — «Поправить», `question` — ответ на вопрос.
    channel: String,
    text: String,
    /// Файл, к которому «Поправить».
    file_id: Option<Uuid>,
    /// Ответ агента — на какое сообщение.
    reply_to: Option<Uuid>,
    /// У твоего: `pending` — агент думает; `done`; `failed`.
    status: String,
    /// Сколько действий агент сделал в ответ (в ленте).
    actions: i32,
    #[serde(with = "time::serde::rfc3339")]
    at: OffsetDateTime,
}

impl From<chat::Message> for AgentMessage {
    fn from(message: chat::Message) -> Self {
        Self {
            id: message.id,
            seq: message.seq,
            role: message.role,
            channel: message.channel.as_str().to_owned(),
            text: message.text,
            file_id: message.file_id,
            reply_to: message.reply_to,
            status: message.status,
            actions: message.actions,
            at: message.at,
        }
    }
}

/// Разговор.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentChat {
    /// По порядку, старые сверху.
    messages: Vec<AgentMessage>,
    /// Агент ещё отвечает на что-то — спросить снова через секунду-другую.
    pending: bool,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ChatQuery {
    /// Только после этого `seq`; нет — последние `limit`.
    after: Option<i64>,
    /// 1…200, по умолчанию 50.
    limit: Option<i64>,
}

/// Написать агенту.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentSay {
    text: String,
}

/// Разговор с агентом (чат раздела «Агент», бот, «Поправить», ответы).
#[utoipa::path(get, path = "/api/v1/agent/chat", tag = "agent", params(ChatQuery),
    responses(
        (status = 200, description = "Сообщения", body = AgentChat),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn chat_list(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<ChatQuery>,
) -> Result<Json<AgentChat>, ApiError> {
    authorize(&state, &session).await?;
    let account = session.0.account_id;
    let mut conn = state.db.pool().acquire().await.map_err(db_error)?;
    let messages = chat::list(&mut conn, account, query.after, query.limit.unwrap_or(50))
        .await
        .map_err(agent_error)?;
    let pending: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM agent_messages WHERE account_id = $1 \
         AND status = 'pending')",
    )
    .bind(account)
    .fetch_one(&mut *conn)
    .await
    .map_err(db_error)?;
    Ok(Json(AgentChat {
        messages: messages.into_iter().map(AgentMessage::from).collect(),
        pending,
    }))
}

async fn post(
    state: &AppState,
    session: &Authenticated,
    channel: Channel,
    text: String,
    file_id: Option<Uuid>,
) -> Result<(StatusCode, Json<AgentMessage>), ApiError> {
    let message = chat::post(
        state.db.pool(),
        NewMessage {
            account: session.0.account_id,
            channel,
            text,
            file_id,
            telegram: None,
        },
    )
    .await
    .map_err(agent_error)?;
    Ok((StatusCode::ACCEPTED, Json(message.into())))
}

/// Написать агенту. Он ответит в разговоре через несколько секунд (спрашивать
/// `GET /api/v1/agent/chat`, пока `pending`); его действия — в ленте.
#[utoipa::path(post, path = "/api/v1/agent/chat", tag = "agent",
    request_body = AgentSay,
    responses(
        (status = 202, description = "Принято, агент думает", body = AgentMessage),
        (status = 400, description = "Пусто или слишком длинно", body = ApiErrorBody),
        (status = 403, description = "Нет права писать агенту", body = ApiErrorBody),
    ))]
pub async fn chat_say(
    State(state): State<AppState>,
    session: Authenticated,
    Json(request): Json<AgentSay>,
) -> Result<(StatusCode, Json<AgentMessage>), ApiError> {
    post(&state, &session, Channel::Web, request.text, None).await
}

/// «Поправить» файл словами: «это не так, на самом деле…». Агент исправляет
/// сразу, без «да» (D-324); правка видна в ленте и откатывается.
#[utoipa::path(post, path = "/api/v1/agent/files/{id}/fix", tag = "agent",
    request_body = AgentFixText,
    params(("id" = Uuid, Path, description = "ID файла")),
    responses(
        (status = 202, description = "Принято, агент исправляет", body = AgentMessage),
        (status = 403, description = "Нет права писать агенту", body = ApiErrorBody),
        (status = 404, description = "Нет такого файла", body = ApiErrorBody),
    ))]
pub async fn fix_file(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentFixText>,
) -> Result<(StatusCode, Json<AgentMessage>), ApiError> {
    own_file(&state, &session, id).await?;
    post(&state, &session, Channel::Fix, request.text, Some(id)).await
}

// ---------------------------------------------------------------- вопросы

/// Вопрос «Агент хочет знать».
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentQuestion {
    id: Uuid,
    text: String,
    project_id: Option<Uuid>,
    /// Зачем агенту это знать.
    why: String,
    /// Варианты ответа кнопками (можно и словами).
    options: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    asked_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AgentQuestions {
    questions: Vec<AgentQuestion>,
}

/// Ответ на вопрос.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentAnswer {
    answer: String,
}

/// Ответил: строка ленты и сообщение агенту (он запишет ответ, куда нужно).
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentAnswered {
    action: AgentAction,
    message: AgentMessage,
}

/// Открытые вопросы агента.
#[utoipa::path(get, path = "/api/v1/agent/questions", tag = "agent",
    responses(
        (status = 200, description = "Вопросы, старые сверху", body = AgentQuestions),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn list_questions(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<AgentQuestions>, ApiError> {
    authorize(&state, &session).await?;
    let mut conn = state.db.pool().acquire().await.map_err(db_error)?;
    let open = questions::open(&mut conn, session.0.account_id)
        .await
        .map_err(db_error)?;
    Ok(Json(AgentQuestions {
        questions: open
            .into_iter()
            .map(|q| AgentQuestion {
                id: q.id,
                text: q.text,
                project_id: q.project_id,
                why: q.why,
                options: q.options,
                asked_at: q.asked_at,
            })
            .collect(),
    }))
}

/// Ответить на вопрос: агент запишет ответ туда, где он пригодится.
#[utoipa::path(post, path = "/api/v1/agent/questions/{id}/answer", tag = "agent",
    request_body = AgentAnswer,
    params(("id" = Uuid, Path, description = "ID вопроса")),
    responses(
        (status = 202, description = "Ответ принят, агент записывает", body = AgentAnswered),
        (status = 400, description = "Пустой ответ или вопрос уже закрыт", body = ApiErrorBody),
        (status = 404, description = "Нет такого вопроса", body = ApiErrorBody),
    ))]
pub async fn answer_question(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentAnswer>,
) -> Result<(StatusCode, Json<AgentAnswered>), ApiError> {
    if request.answer.trim().is_empty() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid",
            "Нужен ответ (или «Не сейчас»)",
        ));
    }
    let action = memory::answer(state.db.pool(), &who(&session), id, &request.answer)
        .await
        .map_err(agent_error)?;
    let question = {
        let mut conn = state.db.pool().acquire().await.map_err(db_error)?;
        questions::get(&mut conn, session.0.account_id, id)
            .await
            .map_err(db_error)?
            .ok_or_else(|| agent_error(qubite_agent::Error::NotFound))?
    };
    let text = format!("Ответ на вопрос «{}»: {}", question.text, question.answer);
    let (status, Json(message)) = post(&state, &session, Channel::Question, text, None).await?;
    Ok((
        status,
        Json(AgentAnswered {
            action: action.into(),
            message,
        }),
    ))
}

/// «Не сейчас»: вопрос закрывается; агент может спросить снова через неделю.
#[utoipa::path(post, path = "/api/v1/agent/questions/{id}/dismiss", tag = "agent",
    params(("id" = Uuid, Path, description = "ID вопроса")),
    responses(
        (status = 200, description = "Закрыт — строка ленты", body = AgentAction),
        (status = 404, description = "Нет такого вопроса", body = ApiErrorBody),
    ))]
pub async fn dismiss_question(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<AgentAction>, ApiError> {
    let action = memory::answer(state.db.pool(), &who(&session), id, "")
        .await
        .map_err(agent_error)?;
    Ok(Json(action.into()))
}

// ---------------------------------------------------------------- расписание

/// Слот расписания (из «Расписание.md»).
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentSlot {
    /// 1 — понедельник … 7 — воскресенье.
    weekday: u8,
    /// `ЧЧ:ММ`.
    starts_at: String,
    ends_at: String,
    title: String,
    place: String,
    /// «Не беспокоить»: агент молчит.
    quiet: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AgentSchedule {
    slots: Vec<AgentSlot>,
}

/// Расписание, которое сервер разобрал из «Расписание.md» агента (D-322).
#[utoipa::path(get, path = "/api/v1/agent/schedule", tag = "agent",
    responses(
        (status = 200, description = "Слоты по дням и времени", body = AgentSchedule),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn schedule(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<AgentSchedule>, ApiError> {
    authorize(&state, &session).await?;
    let mut conn = state.db.pool().acquire().await.map_err(db_error)?;
    let slots = files::schedule::slots(&mut conn, session.0.account_id)
        .await
        .map_err(db_error)?;
    let hhmm = |t: time::Time| format!("{:02}:{:02}", t.hour(), t.minute());
    Ok(Json(AgentSchedule {
        slots: slots
            .into_iter()
            .map(|slot| AgentSlot {
                weekday: slot.weekday,
                starts_at: hhmm(slot.starts_at),
                ends_at: hhmm(slot.ends_at),
                title: slot.title,
                place: slot.place,
                quiet: slot.quiet,
            })
            .collect(),
    }))
}

// ---------------------------------------------------------------- очередь

/// Задачи агента в очереди `jobs`: ответ в разговоре, фоновый разбор,
/// пробуждения «писать первым» (AGT-004), урок на поправке и куратор навыков
/// раз в неделю (AGT-003).
pub const KINDS: &[&str] = &[
    chat::CHAT_JOB,
    chat::REVIEW_JOB,
    proactive::WAKE_JOB,
    skills::LEARN_JOB,
    skills::CURATE_JOB,
];

#[derive(Deserialize)]
struct ChatPayload {
    message_id: Uuid,
}

#[derive(Deserialize)]
struct ReviewPayload {
    account_id: Uuid,
    upto_seq: i64,
}

#[derive(Deserialize)]
struct LearnPayload {
    account_id: Uuid,
    action_id: Uuid,
}

/// Выполнить одну задачу агента. Ответ на сообщение из Telegram уходит туда же.
pub async fn handle(
    pool: &sqlx::PgPool,
    gateway: &qubite_ai::Gateway,
    channels: &qubite_notify::deliver::Channels,
    job: &Job,
) -> Result<(), String> {
    match job.kind.as_str() {
        chat::CHAT_JOB => {
            let ChatPayload { message_id } =
                serde_json::from_value(job.payload.clone()).map_err(|error| error.to_string())?;
            let reply = brain::chat_turn(pool, gateway, message_id, Some(job.id))
                .await
                .map_err(|error| error.to_string())?;
            if let Some(reply) = reply
                && reply.channel == Channel::Telegram
                && let (Some(chat_id), Some(telegram)) = (reply.telegram_chat, &channels.telegram)
            {
                match telegram.send(chat_id, &reply.text, &[]).await {
                    Ok(sent) => chat::set_telegram_message(pool, reply.id, chat_id, sent)
                        .await
                        .map_err(|error| error.to_string())?,
                    Err(error) => tracing::warn!(%error, "агент: ответ в Telegram не ушёл"),
                }
            }
            Ok(())
        }
        chat::REVIEW_JOB => {
            let ReviewPayload {
                account_id,
                upto_seq,
            } = serde_json::from_value(job.payload.clone()).map_err(|error| error.to_string())?;
            brain::review(pool, gateway, account_id, upto_seq, Some(job.id))
                .await
                .map(drop)
                .map_err(|error| error.to_string())
        }
        proactive::WAKE_JOB => {
            let wake: proactive::Wake =
                serde_json::from_value(job.payload.clone()).map_err(|error| error.to_string())?;
            let outcome = proactive::wake(pool, gateway, &wake, Some(job.id), None)
                .await
                .map_err(|error| error.to_string())?;
            if let proactive::WakeOutcome::Skipped(why) = outcome {
                tracing::debug!(account = %wake.account_id, trigger = wake.trigger.as_str(), %why, "агент: пробуждение пропущено");
            }
            Ok(())
        }
        skills::LEARN_JOB => {
            let LearnPayload {
                account_id,
                action_id,
            } = serde_json::from_value(job.payload.clone()).map_err(|error| error.to_string())?;
            brain::learn(pool, gateway, account_id, action_id, Some(job.id))
                .await
                .map(drop)
                .map_err(|error| error.to_string())
        }
        skills::CURATE_JOB => {
            let now = OffsetDateTime::now_utc();
            let archived = skills::curate_all(pool, now)
                .await
                .map_err(|error| error.to_string())?;
            if archived > 0 {
                tracing::info!(archived, "куратор навыков: убрал в архив");
            }
            // Следующий обход — через неделю (ключ недели не даст двойного).
            skills::schedule_curator(pool, now + skills::CURATE_EVERY)
                .await
                .map_err(|error| error.to_string())
        }
        other => Err(format!("неизвестная задача {other}")),
    }
}

/// Выполнить всё готовое сейчас (тесты, ручной запуск). Возвращает число задач.
pub async fn run_ready(
    pool: &sqlx::PgPool,
    gateway: &qubite_ai::Gateway,
    channels: &qubite_notify::deliver::Channels,
) -> qubite_jobs::Result<usize> {
    let mut done = 0;
    while let Some(job) =
        qubite_jobs::claim(pool, "agent-now", KINDS, Duration::from_secs(120)).await?
    {
        match handle(pool, gateway, channels, &job).await {
            Ok(()) => qubite_jobs::complete(pool, job.id, "agent-now").await?,
            Err(error) => {
                qubite_jobs::fail(pool, job.id, "agent-now", &error).await?;
            }
        }
        done += 1;
    }
    Ok(done)
}

/// Обработчик задач агента в фоне (`qubite serve`). Остановить — `true` в `shutdown`.
pub fn spawn(
    pool: sqlx::PgPool,
    gateway: Arc<qubite_ai::Gateway>,
    channels: qubite_notify::deliver::Channels,
    shutdown: watch::Receiver<bool>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        // Пробуждения «писать первым» сами продлевают себя каждое утро; при
        // старте — завести их всем, у кого есть агент (D-351).
        match proactive::bootstrap(&pool).await {
            Ok(count) => tracing::info!(count, "агент: пробуждения заведены"),
            Err(error) => tracing::warn!(%error, "агент: пробуждения не заведены"),
        }
        // Куратор навыков ходит раз в неделю; первый обход — при запуске
        // (на той же неделе повторный запуск второго не ставит).
        if let Err(error) = skills::schedule_curator(&pool, OffsetDateTime::now_utc()).await {
            tracing::warn!(%error, "куратор навыков не поставлен в очередь");
        }
        let config = qubite_jobs::WorkerConfig {
            worker_id: format!("agent-{}", Uuid::now_v7()),
            kinds: KINDS.iter().map(|kind| (*kind).to_owned()).collect(),
            lease: Duration::from_secs(300),
            idle_poll: Duration::from_secs(2),
        };
        loop {
            let result = qubite_jobs::run_worker(&pool, &config, shutdown.clone(), |job| {
                let pool = pool.clone();
                let gateway = gateway.clone();
                let channels = channels.clone();
                async move { handle(&pool, &gateway, &channels, &job).await }
            })
            .await;
            match result {
                Ok(_) => return,
                Err(error) => {
                    tracing::warn!(%error, "агент: очередь недоступна, повтор через 10 с");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    if *shutdown.borrow() {
                        return;
                    }
                }
            }
        }
    })
}
