//! Один вход Command: права, сводка дня и исполнение решения модели.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use qubite_agent::{
    chat,
    dispatch::{self, OrderTarget, Usage},
    files::redact,
};
use qubite_ai::AiError;
use qubite_policy::{ModuleId, UseAi, Write};
use qubite_sync::{OpKind, OpResult, Operation};
use qubite_sync_server::Rules;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgConnection;
use time::{Date, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    agent::agent_error,
    auth::{ApiError, ApiErrorBody, Authenticated},
    harness, pult,
    sync::sync_error,
};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CommandSource {
    Web,
    Voice,
    Pult,
    Desktop,
    Android,
}

impl CommandSource {
    fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Voice => "voice",
            Self::Pult => "pult",
            Self::Desktop => "desktop",
            Self::Android => "android",
        }
    }

    fn inbox_source(self) -> &'static str {
        match self {
            Self::Desktop => "desktop",
            Self::Android => "android",
            _ => "web",
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct DispatchRequest {
    text: String,
    source: CommandSource,
    /// Идентификатор сообщения. Повторы безопасны с тем же id, текстом и источником.
    id: Option<Uuid>,
    /// Только для уже показанного поручения с тем же id.
    #[serde(default)]
    confirm: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CommandKind {
    Thought,
    Question,
    Order,
}

impl From<dispatch::Kind> for CommandKind {
    fn from(kind: dispatch::Kind) -> Self {
        match kind {
            dispatch::Kind::Thought => Self::Thought,
            dispatch::Kind::Question => Self::Question,
            dispatch::Kind::Order => Self::Order,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DispatchStatus {
    Done,
    NeedsConfirm,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ReclassifyRequest {
    kind: CommandKind,
}

#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct DispatchResult {
    id: Uuid,
    kind: CommandKind,
    confidence: f64,
    status: DispatchStatus,
    message: String,
    model: String,
    /// Фактическая цена показанного вызова модели, микродоллары.
    cost_usd: i64,
    /// Оценка запуска в долларах по данным Пульта.
    estimate_usd: Option<f64>,
    estimate_percent: Option<f64>,
}

#[derive(sqlx::FromRow)]
struct Turn {
    text: String,
    source: String,
    result: sqlx::types::Json<DispatchResult>,
    agent_model: Option<String>,
    inbox_id: Option<Uuid>,
}

type AiAuth = qubite_policy::Authorized<UseAi>;
const MAX_TEXT: usize = chat::MAX_TEXT;

// Шлюзу нужно своё соединение, пока транзакция держит запись Command.
static SLOTS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);

fn db(error: sqlx::Error) -> ApiError {
    tracing::error!(%error, "Command: ошибка базы");
    ApiError::internal()
}

fn invalid(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "invalid_command", message)
}

fn dispatch_ai_error(error: AiError) -> ApiError {
    if matches!(
        error,
        AiError::NoModelForTask(_)
            | AiError::ModelNotAllowed
            | AiError::ModelBlocked(_)
            | AiError::ProviderUnavailable { .. }
            | AiError::SourceNotReady(_)
            | AiError::SubscriptionLimit { .. }
            | AiError::BudgetNotSet
            | AiError::BudgetExhausted { .. }
            | AiError::PlatformCapNotSet
    ) {
        return ApiError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "command_gateway_unavailable",
            "Шлюз Command сейчас недоступен",
        );
    }
    error.into()
}

pub(crate) async fn authorize(
    state: &AppState,
    session: &Authenticated,
) -> Result<AiAuth, ApiError> {
    if !session.0.is_owner {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "command_owner_only",
            "Command с диспетчером доступен только владельцу",
        ));
    }
    crate::modules::authorize::<Write>(state, session, qubite_agent::MODULE).await?;
    crate::modules::authorize::<UseAi>(state, session, qubite_agent::MODULE).await
}

async fn lock(conn: &mut PgConnection, account: Uuid, id: Uuid) -> Result<(), ApiError> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))")
        .bind(format!("command:{account}:{id}"))
        .execute(conn)
        .await
        .map_err(db)?;
    Ok(())
}

async fn load(conn: &mut PgConnection, account: Uuid, id: Uuid) -> Result<Option<Turn>, ApiError> {
    sqlx::query_as(
        "SELECT text, source, result, agent_model, inbox_id FROM command_turns          WHERE account_id = $1 AND id = $2",
    )
    .bind(account)
    .bind(id)
    .fetch_optional(conn)
    .await
    .map_err(db)
}

async fn create_object(
    state: &AppState,
    conn: &mut PgConnection,
    session: &Authenticated,
    object_type: &str,
    title: String,
    fields: Value,
) -> Result<Uuid, ApiError> {
    let module = qubite_sync_server::module_of(object_type);
    qubite_policy::decide_in::<Write>(conn, &session.subject(), &ModuleId::new(module)?).await?;
    let id = Uuid::now_v7();
    let rules = Rules {
        registry: state.sync.clone(),
        strict: true,
        writable: Some([module.to_owned()].into()),
        readable: None,
    };
    let op = Operation {
        op_id: Uuid::now_v7(),
        object_id: id,
        base_revision: None,
        kind: OpKind::Create {
            object_type: object_type.into(),
            title,
            fields: Some(fields),
        },
    };
    match qubite_sync_server::apply_in(conn, session.0.account_id, session.0.id, &op, &rules)
        .await
        .map_err(sync_error)?
    {
        OpResult::Applied { .. } => Ok(id),
        OpResult::Rejected { message, .. } => Err(invalid(&message)),
        _ => Err(ApiError::internal()),
    }
}

async fn thought(
    state: &AppState,
    conn: &mut PgConnection,
    session: &Authenticated,
    text: &str,
    source: &str,
) -> Result<Uuid, ApiError> {
    create_object(
        state,
        conn,
        session,
        qubite_inbox::ITEM_TYPE,
        qubite_inbox::title_from(text),
        json!({ "body": text, "source": source }),
    )
    .await
}

async fn today(conn: &mut PgConnection) -> Result<(Date, OffsetDateTime), ApiError> {
    sqlx::query_as(
        "SELECT (now() AT TIME ZONE zone)::date,           date_trunc('day', now() AT TIME ZONE zone) AT TIME ZONE zone          FROM (SELECT coalesce((SELECT value #>> '{}' FROM platform_settings                                WHERE key = 'platform.timezone'), $1) AS zone) tz",
    )
    .bind(qubite_planner::DEFAULT_TIMEZONE)
    .fetch_one(conn)
    .await
    .map_err(db)
}

async fn day_and_recap(
    state: &AppState,
    conn: &mut PgConnection,
    session: &Authenticated,
    id: Uuid,
) -> Result<(String, String), ApiError> {
    let (date, start) = today(conn).await?;
    let account = session.0.account_id;
    let planner = ModuleId::new(qubite_planner::MODULE)?;
    let tasks = match qubite_policy::decide_in::<qubite_policy::Read>(
        conn,
        &session.subject(),
        &planner,
    )
    .await
    {
        Ok(_) => {
            let tasks = qubite_planner::day_tasks(conn, account, date)
                .await
                .map_err(|error| {
                    tracing::error!(%error, "Command: дела дня");
                    ApiError::internal()
                })?;
            Some(
                tasks
                    .into_iter()
                    .map(|t| {
                        json!({
                            "title": harness::clip(&t.title, 120),
                            "time": t.due_time.map(|time| format!("{:02}:{:02}", time.hour(), time.minute())),
                            "status": t.status,
                        })
                    })
                    .collect::<Vec<_>>(),
            )
        }
        Err(qubite_policy::Error::Denied(_)) => None,
        Err(error) => return Err(error.into()),
    };
    let pult = pult::command_day(state, &date.to_string()).await?;
    let day = json!({ "date": date.to_string(), "tasks": tasks, "pult": pult }).to_string();
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT text, result->>'message' FROM command_turns          WHERE account_id = $1 AND created_at >= $2 AND id <> $3            AND source <> 'pult' AND result->>'kind' <> 'thought'          ORDER BY created_at DESC, id DESC LIMIT 6",
    )
    .bind(account)
    .bind(start)
    .bind(id)
    .fetch_all(conn)
    .await
    .map_err(db)?;
    let recap = rows
        .into_iter()
        .rev()
        .map(|(text, answer)| {
            format!(
                "Вопрос или поручение: {}\nИтог: {}",
                harness::clip(&text, 140),
                harness::clip(&answer, 200),
            )
        })
        .collect::<Vec<_>>()
        .join("\n");
    Ok((redact(&day).0, redact(&recap).0))
}

async fn answer(
    state: &AppState,
    conn: &mut PgConnection,
    session: &Authenticated,
    auth: &AiAuth,
    id: Uuid,
    text: &str,
) -> Result<(String, Usage), ApiError> {
    let (day, recap) = day_and_recap(state, conn, session, id).await?;
    Ok(dispatch::answer(&state.ai, auth, Uuid::now_v7(), redact(text).0, day, recap).await?)
}

async fn corrections(conn: &mut PgConnection, account: Uuid) -> Result<String, ApiError> {
    let rows: Vec<(String, String)> = sqlx::query_as(
        "SELECT text, result->>'kind' FROM command_turns          WHERE account_id = $1 AND corrected ORDER BY created_at DESC, id DESC LIMIT 6",
    )
    .bind(account)
    .fetch_all(conn)
    .await
    .map_err(db)?;
    Ok(rows
        .into_iter()
        .map(|(text, kind)| format!("{kind}: {}", harness::clip(&redact(&text).0, 140)))
        .collect::<Vec<_>>()
        .join("\n"))
}

fn issue_answer(text: &str) -> Option<(u64, &str)> {
    let (prefix, rest) = text.split_once(" #")?;
    if prefix.to_lowercase() != "ответить на" {
        return None;
    }
    let (number, body) = rest.split_once(':')?;
    let number = number.parse::<u64>().ok().filter(|n| *n > 0)?;
    Some((number, body.trim()))
}

async fn enqueue(
    conn: &mut PgConnection,
    account: Uuid,
    text: &str,
    model: &str,
) -> Result<(), ApiError> {
    chat::post_in(
        conn,
        chat::NewMessage {
            account,
            channel: chat::Channel::Web,
            text: text.into(),
            file_id: None,
            telegram: None,
        },
        Some(model),
    )
    .await
    .map_err(agent_error)?;
    Ok(())
}

/// Разобрать одно сообщение Command или подтвердить ранее предложенный запуск.
#[utoipa::path(post, path = "/api/command/dispatch", tag = "agent", request_body = DispatchRequest,
    responses(
        (status = 200, description = "Ответ диспетчера", body = DispatchResult),
        (status = 400, description = "Неверный запрос", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа", body = ApiErrorBody),
        (status = 409, description = "Конфликт или отказ шлюза", body = ApiErrorBody),
        (status = 502, description = "GitHub не ответил", body = ApiErrorBody),
        (status = 503, description = "Шлюз Command недоступен", body = ApiErrorBody)
    ))]
pub async fn dispatch_command(
    State(state): State<AppState>,
    session: Authenticated,
    Json(request): Json<DispatchRequest>,
) -> Result<Json<DispatchResult>, ApiError> {
    let auth = authorize(&state, &session).await?;
    let account = session.0.account_id;
    let text = request.text.trim();
    if text.is_empty() || text.chars().count() > MAX_TEXT {
        return Err(invalid("Сообщение должно содержать от 1 до 4000 знаков"));
    }
    let reply = issue_answer(text);
    if request.source == CommandSource::Pult && reply.is_none() {
        return Err(invalid("Ожидается ответ в задачу в формате «ответить на #N: текст»"));
    }
    if let Some((_, body)) = reply
        && (body.is_empty() || body.chars().count() > harness::ANSWER_MAX)
    {
        return Err(invalid("Ответ должен содержать от 1 до 2000 знаков"));
    }
    let source = request.source.as_str();
    let id = request.id.unwrap_or_else(Uuid::now_v7);
    let _slot = SLOTS.acquire().await.map_err(|_| ApiError::internal())?;
    let mut tx = state.db.pool().begin().await.map_err(db)?;
    lock(&mut tx, account, id).await?;
    if let Some(turn) = load(&mut tx, account, id).await? {
        if turn.text != text || turn.source != source {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "command_id_reused",
                "У этого сообщения другой текст или источник",
            ));
        }
        let mut result = turn.result.0;
        if request.confirm
            && result.status == DispatchStatus::NeedsConfirm
            && let Some(model) = turn.agent_model
        {
            enqueue(&mut tx, account, text, &model).await?;
            result.status = DispatchStatus::Done;
            result.message = "Передал поручение агенту".into();
            sqlx::query("UPDATE command_turns SET result = $3 WHERE account_id = $1 AND id = $2")
                .bind(account)
                .bind(id)
                .bind(sqlx::types::Json(&result))
                .execute(&mut *tx)
                .await
                .map_err(db)?;
        }
        tx.commit().await.map_err(db)?;
        return Ok(Json(result));
    }
    if request.confirm {
        return Err(invalid("Сначала отправьте поручение и получите оценку запуска"));
    }

    let examples = corrections(&mut tx, account).await?;
    // Отказ с кодом запасного пути возможен только до действий в GitHub.
    let (decision, usage) =
        dispatch::classify(&state.ai, &auth, Uuid::now_v7(), redact(text).0, examples)
            .await
            .map_err(dispatch_ai_error)?;
    let mut result = DispatchResult {
        id,
        kind: decision.kind.into(),
        confidence: decision.confidence,
        status: DispatchStatus::Done,
        message: String::new(),
        model: usage.model,
        cost_usd: usage.cost_usd,
        estimate_usd: None,
        estimate_percent: None,
    };
    let mut agent_model = None;
    let mut inbox_id = None;
    if let Some((number, body)) = reply {
        harness::post_work_answer(&state, account, number, body).await?;
        result.kind = CommandKind::Order;
        result.confidence = 1.0;
        result.message = format!("Ответ записан в задачу #{number}");
    } else {
        match result.kind {
            CommandKind::Thought => {
                inbox_id = Some(
                    thought(&state, &mut tx, &session, text, request.source.inbox_source()).await?,
                );
                result.message = "✓ записал".into();
            }
            CommandKind::Question => {
                let (message, usage) = answer(&state, &mut tx, &session, &auth, id, text).await?;
                result.message = message;
                result.model = usage.model;
                result.cost_usd = usage.cost_usd;
            }
            CommandKind::Order => match decision.target {
                OrderTarget::Planner => {
                    let title = decision
                        .title
                        .as_deref()
                        .map(str::trim)
                        .filter(|title| !title.is_empty())
                        .unwrap_or(text);
                    let title: String = title.chars().take(qubite_sync::MAX_TITLE_CHARS).collect();
                    create_object(
                        &state,
                        &mut tx,
                        &session,
                        qubite_planner::TASK_TYPE,
                        title,
                        json!({ "notes": text }),
                    )
                    .await?;
                    result.message = "Добавил дело в Planner".into();
                }
                OrderTarget::Agent => {
                    let model = state.ai.model_for(qubite_agent::brain::CHAT_TASK).await?;
                    let external: String =
                        sqlx::query_scalar("SELECT external_id FROM ai_models WHERE id = $1")
                            .bind(&model)
                            .fetch_one(&mut *tx)
                            .await
                            .map_err(db)?;
                    let (usd, percent) = pult::command_estimate(&state, &external).await?;
                    result.estimate_usd = usd;
                    result.estimate_percent = percent;
                    let family = external.to_ascii_lowercase();
                    if family.contains("opus")
                        || family.contains("fable")
                        || percent.is_none_or(|p| p > 5.0)
                    {
                        result.status = DispatchStatus::NeedsConfirm;
                        result.message = if percent.is_some() {
                            "Подтвердите запуск агента".into()
                        } else {
                            "Пульт пока не знает долю недельного лимита. Подтвердите запуск агента"
                                .into()
                        };
                        agent_model = Some(model);
                    } else {
                        enqueue(&mut tx, account, text, &model).await?;
                        result.message = "Передал поручение агенту".into();
                    }
                }
            },
        }
    }
    sqlx::query(
        "INSERT INTO command_turns (account_id, id, text, source, result, agent_model, inbox_id)          VALUES ($1, $2, $3, $4, $5, $6, $7)",
    )
    .bind(account)
    .bind(id)
    .bind(text)
    .bind(source)
    .bind(sqlx::types::Json(&result))
    .bind(agent_model)
    .bind(inbox_id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(Json(result))
}

/// Исправить сортировку сообщения и запомнить пример для следующего разбора.
#[utoipa::path(post, path = "/api/command/dispatch/{id}/reclassify", tag = "agent",
    params(("id" = Uuid, Path, description = "Сообщение Command")), request_body = ReclassifyRequest,
    responses(
        (status = 200, description = "Ответ после исправления", body = DispatchResult),
        (status = 400, description = "Неверный запрос", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа", body = ApiErrorBody),
        (status = 404, description = "Сообщение не найдено", body = ApiErrorBody),
        (status = 409, description = "Конфликт или отказ шлюза", body = ApiErrorBody)
    ))]
pub async fn reclassify(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<ReclassifyRequest>,
) -> Result<Json<DispatchResult>, ApiError> {
    let auth = authorize(&state, &session).await?;
    let account = session.0.account_id;
    let _slot = SLOTS.acquire().await.map_err(|_| ApiError::internal())?;
    let mut tx = state.db.pool().begin().await.map_err(db)?;
    lock(&mut tx, account, id).await?;
    let mut turn = load(&mut tx, account, id).await?.ok_or_else(|| {
        ApiError::new(
            StatusCode::NOT_FOUND,
            "command_not_found",
            "Сообщение Command не найдено",
        )
    })?;
    if turn.source == "pult" || issue_answer(&turn.text).is_some() {
        return Err(invalid("Ответ в задачу нельзя переклассифицировать"));
    }
    let mut result = turn.result.0;
    if result.kind == request.kind {
        return Ok(Json(result));
    }
    match request.kind {
        CommandKind::Thought => {
            if turn.inbox_id.is_none() {
                let source = match turn.source.as_str() {
                    "desktop" => "desktop",
                    "android" => "android",
                    _ => "web",
                };
                turn.inbox_id =
                    Some(thought(&state, &mut tx, &session, &turn.text, source).await?);
            }
            result.message = "✓ записал".into();
            result.model.clear();
            result.cost_usd = 0;
        }
        CommandKind::Question => {
            let (message, usage) = answer(&state, &mut tx, &session, &auth, id, &turn.text).await?;
            result.message = message;
            result.model = usage.model;
            result.cost_usd = usage.cost_usd;
        }
        CommandKind::Order => return Err(invalid("Исправьте на мысль или вопрос")),
    }
    result.kind = request.kind;
    result.confidence = 1.0;
    result.status = DispatchStatus::Done;
    result.estimate_usd = None;
    result.estimate_percent = None;
    sqlx::query(
        "UPDATE command_turns SET result = $3, corrected = true, agent_model = NULL, inbox_id = $4          WHERE account_id = $1 AND id = $2",
    )
    .bind(account)
    .bind(id)
    .bind(sqlx::types::Json(&result))
    .bind(turn.inbox_id)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(Json(result))
}
