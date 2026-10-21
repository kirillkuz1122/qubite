//! Лента «Что сделал агент» по HTTP (AGT-002): смотреть, откатить действие
//! или пакет, исправить результат.
//!
//! Права — модуль `agent` (`read`): без гранта ленты нет, как и агента.
//! Откат и исправление меняют данные от имени человека, поэтому ещё нужно
//! право `write` в модуле каждого объекта (Planner, Входящие) — это
//! проверяет `qubite-agent`. Сами инструменты агента по HTTP не вызываются:
//! ими пользуется только агент на сервере.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use qubite_agent::{Feed, RevertOutcome, Who};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
};

/// Одно поле: было и стало (`null` — пусто или объекта не было).
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentFieldChange {
    /// `title`, `deleted` или поле модуля: `due_date`, `due_time`,
    /// `project_id`, `priority`, `status`, `notes`, `subtasks`, `recurrence`,
    /// `color`, `tag`, `body`; у навыка ещё `pinned`, `archived`.
    field: String,
    #[schema(value_type = Object)]
    before: Value,
    #[schema(value_type = Object)]
    after: Value,
}

/// «Было → стало» по одному объекту.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentChange {
    object_id: Uuid,
    /// `planner.task`, `planner.project`, `inbox.item`.
    object_type: String,
    /// Название после действия.
    title: String,
    /// Объект создан этим действием.
    created: bool,
    diff: Vec<AgentFieldChange>,
}

/// Что с действием сейчас.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentActionState {
    /// Откачено этим действием (если откат не откатили обратно).
    reverted_by: Option<Uuid>,
    /// Твои поправки к действию.
    corrected_by: Vec<Uuid>,
    /// Шагов в пакете (1 — одиночное действие).
    batch_size: i64,
    /// У отката действия агента — вопрос «почему откатил» (D-397).
    why: Option<AgentRevertWhy>,
}

/// «Почему откатил?» и ответ.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentRevertWhy {
    /// `mistake` — ошибся, `not_now` — не сейчас, `never` — не надо такого,
    /// `own` — свой текст; `null` — ещё не ответил.
    kind: Option<String>,
    /// Свой текст (у кнопок пусто).
    answer: String,
    /// Агент на этом учится («не сейчас» и молчание — не урок).
    lesson: bool,
}

impl From<qubite_agent::why::Why> for AgentRevertWhy {
    fn from(why: qubite_agent::why::Why) -> Self {
        Self {
            kind: why.kind.map(|kind| kind.as_str().to_owned()),
            answer: why.answer,
            lesson: why.kind.is_some_and(qubite_agent::why::Kind::lesson),
        }
    }
}

/// Ответ на «почему откатил»: `ошибся`, `не сейчас`, `не надо такого` или свои слова.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentRevertWhyAnswer {
    answer: String,
}

/// Строка ленты.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentAction {
    id: Uuid,
    /// Порядок ленты; курсор «ещё».
    seq: i64,
    #[serde(with = "time::serde::rfc3339")]
    at: OffsetDateTime,
    /// `agent` — агент, `owner` — ты, `system` — Qubite.
    actor: String,
    run_id: Option<Uuid>,
    /// Шаги одного решения откатываются вместе.
    batch_id: Uuid,
    skill_id: Option<Uuid>,
    /// `task.create`, `task.update`, `task.reschedule`, `task.trash`,
    /// `project.create`, `project.update`, `inbox.file`, `home.digest.write`,
    /// `skill.create`, `skill.patch`, `skill.archive`, `skill.pin`,
    /// `skill.restore`, `skill.curate` (куратор), `timeline.revert`.
    tool: String,
    /// Что сделано.
    summary: String,
    /// Почему.
    reason: Option<String>,
    /// Это откат действия …
    reverts: Option<Uuid>,
    /// … или поправка к действию.
    corrects: Option<Uuid>,
    /// Цена вызова AI, миллионные доли доллара.
    cost_usd_micros: Option<i64>,
    changes: Vec<AgentChange>,
    state: AgentActionState,
}

impl From<qubite_agent::Action> for AgentAction {
    fn from(action: qubite_agent::Action) -> Self {
        Self {
            id: action.id,
            seq: action.seq,
            at: action.at,
            actor: action.actor.as_str().to_owned(),
            run_id: action.run_id,
            batch_id: action.batch_id,
            skill_id: action.skill_id,
            tool: action.tool,
            summary: action.summary,
            reason: action.reason,
            reverts: action.reverts,
            corrects: action.corrects,
            cost_usd_micros: action.cost_usd_micros,
            changes: action
                .changes
                .into_iter()
                .map(|change| AgentChange {
                    object_id: change.object_id,
                    object_type: change.object_type,
                    title: change.title,
                    created: change.created,
                    diff: change
                        .diff
                        .into_iter()
                        .map(|field| AgentFieldChange {
                            field: field.field,
                            before: field.before,
                            after: field.after,
                        })
                        .collect(),
                })
                .collect(),
            state: AgentActionState {
                reverted_by: action.state.reverted_by,
                corrected_by: action.state.corrected_by,
                batch_size: action.state.batch_size,
                why: action.state.why.map(AgentRevertWhy::from),
            },
        }
    }
}

/// Страница ленты: новые сверху.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentTimelinePage {
    items: Vec<AgentAction>,
    /// Передать как `before`, чтобы получить ещё; нет — дальше пусто.
    next: Option<i64>,
}

/// Поле, которое поменяли после действия: три значения.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentConflict {
    action_id: Uuid,
    object_id: Uuid,
    object_type: String,
    /// Название сейчас.
    title: String,
    field: String,
    /// До действия (`null` — объекта не было).
    #[schema(value_type = Object)]
    before: Value,
    /// Что сделало действие.
    #[schema(value_type = Object)]
    action: Value,
    /// Что сейчас.
    #[schema(value_type = Object)]
    now: Value,
}

/// Чем кончился откат.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentRevertResult {
    /// `reverted` — откачено; `conflict` — ничего не изменено, после
    /// действия объект меняли: решить и повторить с `force`.
    status: String,
    /// Новые действия-откаты.
    actions: Vec<AgentAction>,
    conflicts: Vec<AgentConflict>,
}

impl From<RevertOutcome> for AgentRevertResult {
    fn from(outcome: RevertOutcome) -> Self {
        match outcome {
            RevertOutcome::Reverted { actions } => Self {
                status: "reverted".into(),
                actions: actions.into_iter().map(AgentAction::from).collect(),
                conflicts: Vec::new(),
            },
            RevertOutcome::Conflict { conflicts } => Self {
                status: "conflict".into(),
                actions: Vec::new(),
                conflicts: conflicts
                    .into_iter()
                    .map(|conflict| AgentConflict {
                        action_id: conflict.action_id,
                        object_id: conflict.object_id,
                        object_type: conflict.object_type,
                        title: conflict.title,
                        field: conflict.field,
                        before: conflict.before,
                        action: conflict.action,
                        now: conflict.now,
                    })
                    .collect(),
            },
        }
    }
}

/// Откатить.
#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentRevertRequest {
    /// Вернуть как было, даже если после действия объект меняли.
    #[serde(default)]
    force: bool,
}

/// Исправить результат действия (это твоя поправка — агент на ней учится).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentFixRequest {
    /// Дело или проект из этого действия.
    object_id: Uuid,
    /// Новое название.
    title: Option<String>,
    /// Поля, как в синхронизации: `due_date`, `due_time`, `project_id`,
    /// `priority`, … (`null` очищает).
    #[serde(default)]
    #[schema(value_type = Object)]
    fields: Map<String, Value>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct TimelineQuery {
    /// Лента одного объекта (дело, мысль).
    object: Option<Uuid>,
    /// Лента проекта: сам проект и дела, которые были или стали в нём.
    project: Option<Uuid>,
    /// Шаги одного пакета.
    batch: Option<Uuid>,
    /// Курсор `next` прошлой страницы.
    before: Option<i64>,
    /// 1…100, по умолчанию 50.
    limit: Option<i64>,
}

pub(crate) fn who(session: &Authenticated) -> Who {
    Who::owner(session.0.account_id, Some(session.0.id))
}

pub(crate) fn agent_error(error: qubite_agent::Error) -> ApiError {
    use qubite_agent::Error as E;
    match error {
        E::Denied(reason) => qubite_policy::Error::Denied(reason).into(),
        E::NotFound => ApiError::new(StatusCode::NOT_FOUND, "not_found", "Не найдено"),
        E::Invalid(message) => ApiError::new(StatusCode::BAD_REQUEST, "invalid", message),
        E::NeedsOwner(message) => ApiError::new(StatusCode::FORBIDDEN, "needs_owner", message),
        E::Busy => ApiError::new(
            StatusCode::CONFLICT,
            "busy",
            "Объект только что изменили — повторите",
        ),
        E::NotRevertible(message) => ApiError::new(StatusCode::CONFLICT, "not_revertible", message),
        other => {
            tracing::error!(error = %other, "агент: внутренняя ошибка");
            ApiError::internal()
        }
    }
}

/// Лента «Что сделал агент» — вся, у дела, у проекта или одного пакета.
#[utoipa::path(get, path = "/api/v1/agent/timeline", tag = "agent", params(TimelineQuery),
    responses(
        (status = 200, description = "Страница ленты, новые сверху", body = AgentTimelinePage),
        (status = 400, description = "Сразу несколько фильтров", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn timeline(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<TimelineQuery>,
) -> Result<Json<AgentTimelinePage>, ApiError> {
    let who = who(&session);
    qubite_agent::timeline::authorize_read(state.db.pool(), &who)
        .await
        .map_err(agent_error)?;
    let feed = match (query.object, query.project, query.batch) {
        (None, None, None) => Feed::All,
        (Some(id), None, None) => Feed::Object(id),
        (None, Some(id), None) => Feed::Project(id),
        (None, None, Some(id)) => Feed::Batch(id),
        _ => {
            return Err(ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid",
                "Только один из object, project, batch",
            ));
        }
    };
    let page = qubite_agent::timeline::list(
        state.db.pool(),
        who.account(),
        feed,
        query.before,
        query.limit.unwrap_or(50),
    )
    .await
    .map_err(agent_error)?;
    Ok(Json(AgentTimelinePage {
        items: page.items.into_iter().map(AgentAction::from).collect(),
        next: page.next,
    }))
}

/// Одно действие.
#[utoipa::path(get, path = "/api/v1/agent/actions/{id}", tag = "agent",
    params(("id" = Uuid, Path, description = "ID действия")),
    responses(
        (status = 200, description = "Действие", body = AgentAction),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
        (status = 404, description = "Нет такого действия", body = ApiErrorBody),
    ))]
pub async fn action(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<AgentAction>, ApiError> {
    let who = who(&session);
    qubite_agent::timeline::authorize_read(state.db.pool(), &who)
        .await
        .map_err(agent_error)?;
    let action = qubite_agent::timeline::get(state.db.pool(), who.account(), id)
        .await
        .map_err(agent_error)?
        .ok_or_else(|| agent_error(qubite_agent::Error::NotFound))?;
    Ok(Json(action.into()))
}

/// Откатить действие (как `git revert`: новое обратное действие, его тоже
/// можно откатить). Если после действия объект меняли — `conflict` с тремя
/// значениями и ничего не изменено; повторить с `force`, чтобы вернуть как было.
#[utoipa::path(post, path = "/api/v1/agent/actions/{id}/revert", tag = "agent",
    request_body = AgentRevertRequest,
    params(("id" = Uuid, Path, description = "ID действия")),
    responses(
        (status = 200, description = "Откачено или конфликт", body = AgentRevertResult),
        (status = 403, description = "Нет доступа к агенту или к модулю объекта", body = ApiErrorBody),
        (status = 404, description = "Нет такого действия", body = ApiErrorBody),
        (status = 409, description = "Уже откачено, объекта больше нет или его только что изменили", body = ApiErrorBody),
    ))]
pub async fn revert(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentRevertRequest>,
) -> Result<Json<AgentRevertResult>, ApiError> {
    let outcome = qubite_agent::revert_action(state.db.pool(), &who(&session), id, request.force)
        .await
        .map_err(agent_error)?;
    Ok(Json(outcome.into()))
}

/// Откатить пакет — все шаги одного решения одной кнопкой.
#[utoipa::path(post, path = "/api/v1/agent/batches/{id}/revert", tag = "agent",
    request_body = AgentRevertRequest,
    params(("id" = Uuid, Path, description = "ID пакета")),
    responses(
        (status = 200, description = "Откачено или конфликт", body = AgentRevertResult),
        (status = 403, description = "Нет доступа к агенту или к модулю объекта", body = ApiErrorBody),
        (status = 404, description = "Нет такого пакета", body = ApiErrorBody),
        (status = 409, description = "Уже откачено, объекта больше нет или его только что изменили", body = ApiErrorBody),
    ))]
pub async fn revert_batch(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentRevertRequest>,
) -> Result<Json<AgentRevertResult>, ApiError> {
    let outcome = qubite_agent::revert_batch(state.db.pool(), &who(&session), id, request.force)
        .await
        .map_err(agent_error)?;
    Ok(Json(outcome.into()))
}

/// «Почему откатил?» — ответ на пакет отката (по желанию, D-397). «Ошибся»,
/// «не надо такого» и свои слова — урок агенту; «не сейчас» — нет.
#[utoipa::path(post, path = "/api/v1/agent/batches/{id}/why", tag = "agent",
    request_body = AgentRevertWhyAnswer,
    params(("id" = Uuid, Path, description = "ID пакета отката")),
    responses(
        (status = 200, description = "Ответ записан", body = AgentRevertWhy),
        (status = 400, description = "Пустой ответ или уже ответили", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
        (status = 404, description = "Про этот откат не спрашивали", body = ApiErrorBody),
    ))]
pub async fn revert_why(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentRevertWhyAnswer>,
) -> Result<Json<AgentRevertWhy>, ApiError> {
    let why = qubite_agent::why::answer(state.db.pool(), &who(&session), id, &request.answer)
        .await
        .map_err(agent_error)?;
    Ok(Json(why.into()))
}

/// Исправить результат действия: «не в чт, а в ср». Это твоё действие с
/// пометкой «поправка».
#[utoipa::path(post, path = "/api/v1/agent/actions/{id}/fix", tag = "agent",
    request_body = AgentFixRequest,
    params(("id" = Uuid, Path, description = "ID действия")),
    responses(
        (status = 200, description = "Поправка — новое действие в ленте", body = AgentAction),
        (status = 400, description = "Неверные поля или нечего менять", body = ApiErrorBody),
        (status = 403, description = "Нет доступа", body = ApiErrorBody),
        (status = 404, description = "Нет такого действия или объекта в нём", body = ApiErrorBody),
    ))]
pub async fn fix(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentFixRequest>,
) -> Result<Json<AgentAction>, ApiError> {
    let action = qubite_agent::fix(
        state.db.pool(),
        &who(&session),
        id,
        request.object_id,
        request.title,
        request.fields,
    )
    .await
    .map_err(agent_error)?;
    Ok(Json(action.into()))
}

// ---------------------------------------------------------------- команда `qubite agent`

/// Команды агента для owner и разработки.
#[derive(clap::Subcommand, Debug)]
pub enum AgentCommand {
    /// Наполнить ленту примером без AI: агент разложит мысль, создаст
    /// проект и дела, перенесёт одно из них. Чтобы посмотреть экран «Что
    /// сделал агент», откатить, исправить и поймать конфликт.
    Demo {
        /// Чья лента; по умолчанию — owner платформы.
        #[arg(long)]
        email: Option<String>,
    },
}

/// Выполнить команду агента; возвращает текст для терминала.
pub async fn run(db: &qubite_db::Database, command: AgentCommand) -> anyhow::Result<String> {
    let pool = db.pool();
    match command {
        AgentCommand::Demo { email } => {
            let account = match email {
                Some(email) => sqlx_account(pool, &email).await?,
                None => {
                    qubite_auth::owner::current(pool)
                        .await?
                        .ok_or_else(|| anyhow::anyhow!("owner ещё не создан: qubite owner create"))?
                        .id
                }
            };
            demo(pool, account).await
        }
    }
}

async fn sqlx_account(pool: &sqlx::PgPool, email: &str) -> anyhow::Result<Uuid> {
    let id: Option<Uuid> =
        sqlx::query_scalar("SELECT id FROM accounts WHERE lower(email) = lower($1)")
            .bind(email.trim())
            .fetch_optional(pool)
            .await?;
    id.ok_or_else(|| anyhow::anyhow!("нет аккаунта {email}"))
}

async fn demo(pool: &sqlx::PgPool, account: Uuid) -> anyhow::Result<String> {
    use qubite_agent::{Trigger, call, finish_run, start_run};
    use serde_json::json;
    use time::Weekday;

    let today = {
        let mut conn = pool.acquire().await?;
        qubite_planner::today(&mut conn).await?
    };
    let date = |weekday: Weekday| qubite_planner::format_date(today.next_occurrence(weekday));

    // Мысль во Входящих — как будто ты записал её в Command.
    let item = Uuid::now_v7();
    let rules = qubite_sync_server::Rules {
        registry: qubite_agent::timeline::registry(),
        strict: true,
        writable: None,
        readable: None,
    };
    let op = qubite_sync::Operation {
        op_id: Uuid::now_v7(),
        object_id: item,
        base_revision: None,
        kind: qubite_sync::OpKind::Create {
            object_type: qubite_inbox::ITEM_TYPE.into(),
            title: "упр. 145 по русскому".into(),
            fields: Some(json!({ "source": "api" })),
        },
    };
    qubite_sync_server::apply_one(pool, account, Uuid::now_v7(), &op, &rules).await?;

    let run = start_run(pool, account, Trigger::Manual)
        .await
        .map_err(|error| anyhow::anyhow!("агент недоступен: {error}"))?;
    let agent = Who::agent(&run);
    let step = async |tool: &str, args: Value, reason: &str, batch: Option<Uuid>| {
        call(pool, &agent, tool, args, Some(reason), batch)
            .await
            .map_err(|error| anyhow::anyhow!("{tool}: {error}"))?
            .action()
            .ok_or_else(|| anyhow::anyhow!("{tool} ничего не записал"))
    };

    // Одно решение — пакет из двух шагов.
    let batch = Uuid::now_v7();
    let project = step(
        "project.create",
        json!({"title": "Русский (пример)", "fields": {"color": "sky", "tag": "русский_пример"}}),
        "в мысли «по русскому», а такого проекта ещё нет (пример без AI)",
        Some(batch),
    )
    .await?;
    let project_id = project.changes[0].object_id;
    step(
        "inbox.file",
        json!({
            "item_id": item,
            "to": "task",
            "title": "Упр. 145",
            "fields": {"project_id": project_id, "due_date": date(Weekday::Thursday)},
        }),
        "урок русского по четвергам (пример: памяти проектов пока нет)",
        Some(batch),
    )
    .await?;

    let museum = step(
        "task.create",
        json!({"title": "Сходить в музей", "fields": {"due_date": date(Weekday::Saturday), "due_time": "14:00"}}),
        "пример: дело со временем",
        None,
    )
    .await?;
    step(
        "task.reschedule",
        json!({"task_id": museum.changes[0].object_id, "due_date": date(Weekday::Sunday), "due_time": "14:00"}),
        "в субботу обещают дождь (пример)",
        None,
    )
    .await?;
    finish_run(pool, &run, true).await?;
    Ok("Готово: в ленте 4 действия агента. Откройте Qubite → «Агент».\n\
        Чтобы проверить конфликт: перенесите «Сходить в музей» в Planner руками и нажмите «Откатить» у переноса."
        .into())
}
