//! Инструменты агента. Только ими агент читает и меняет данные человека
//! (AGENT §13). Каждый меняющий инструмент проходит один путь:
//! **права → действие → запись в ленту** ([`timeline::execute`]).
//! Читающие инструменты в ленту не пишут.
//!
//! Чего здесь нет нарочно (Q-66, D-305): удалить навсегда (только корзина),
//! написать другому человеку, менять права, Console и безопасность.
//! «Сделано» за человека агент не ставит — это проверяется здесь, а не
//! моделью. Аргументы — JSON, как их передаст модель (CMD-004).

use qubite_planner::{PROJECT_TYPE, TASK_TYPE};
use qubite_policy::{ModuleId, Read};
use qubite_sync::OpKind;
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Map, Value, json};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{
    Actor, Error, Result, Who,
    timeline::{self, Action, Plan, Step, check_agent},
};

/// Имена инструментов этой версии: читающие и меняющие.
pub const READ_TOOLS: &[&str] = &[
    "task.get",
    "task.search",
    "project.list",
    "project.get",
    crate::proactive::WINDOWS_TOOL,
    crate::proactive::PRESENCE_TOOL,
];
pub const WRITE_TOOLS: &[&str] = &[
    "task.create",
    "task.update",
    "task.reschedule",
    "task.trash",
    "project.create",
    "project.update",
    "inbox.file",
    crate::digest::TOOL,
    crate::opportunities::SUGGEST_TOOL,
    crate::opportunities::ADD_TOOL,
    crate::proactive::SEND_TOOL,
];

/// Что вернул инструмент.
#[derive(Debug, Clone)]
pub enum Outcome {
    /// Прочитанное (в ленту не пишется).
    Read(Value),
    /// Сделанное — строка ленты.
    Done(Box<Action>),
}

impl Outcome {
    /// Действие, если инструмент что-то менял.
    pub fn action(self) -> Option<Action> {
        match self {
            Self::Done(action) => Some(*action),
            Self::Read(_) => None,
        }
    }
}

fn args<T: DeserializeOwned>(tool: &str, value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|error| Error::Invalid(format!("{tool}: {error}")))
}

// ---------------------------------------------------------------- аргументы

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Create {
    title: String,
    /// Поля модуля — как в синхронизации (`TaskFields`, `ProjectFields`).
    #[serde(default)]
    fields: Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskUpdate {
    task_id: Uuid,
    title: Option<String>,
    #[serde(default)]
    fields: Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Reschedule {
    task_id: Uuid,
    /// `ГГГГ-ММ-ДД`; `null` — без срока.
    due_date: Option<String>,
    /// `ЧЧ:ММ`.
    #[serde(default)]
    due_time: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TaskRef {
    task_id: Uuid,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Search {
    /// Часть названия; пусто — все.
    #[serde(default)]
    query: String,
    project_id: Option<Uuid>,
    limit: Option<i64>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectUpdate {
    project_id: Uuid,
    title: Option<String>,
    #[serde(default)]
    fields: Map<String, Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProjectRef {
    project_id: Uuid,
}

/// Куда разложить мысль (CMD-004).
#[derive(Debug, Deserialize, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum FileTo {
    /// Дело (со сроком или без).
    Task,
    /// Идея — дело без срока: агент вспомнит о ней в свободное время (AGT-004).
    Idea,
    /// Новый проект.
    Project,
    /// Заметка: мысль остаётся в архиве Входящих, к проекту (DOC-002 — потом).
    Note,
    /// Просто мысль — в архив.
    Archive,
}

impl FileTo {
    /// «дело», «идея» — как в пометке во Входящих.
    pub fn word(self) -> &'static str {
        match self {
            Self::Task => "дело",
            Self::Idea => "идея",
            Self::Project => "проект",
            Self::Note => "заметка",
            Self::Archive => "в архив",
        }
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InboxFile {
    pub(crate) item_id: Uuid,
    pub(crate) to: FileTo,
    /// Название дела или проекта; нет — первая строка мысли.
    pub(crate) title: Option<String>,
    /// Поля дела (срок, важность, проект).
    #[serde(default)]
    pub(crate) fields: Map<String, Value>,
    /// Проект заметки (у дела — `fields.project_id`).
    #[serde(default)]
    pub(crate) project_id: Option<Uuid>,
    /// Дело или идея — в новый проект с этим названием.
    #[serde(default)]
    pub(crate) new_project: Option<String>,
}

// ---------------------------------------------------------------- фразы для ленты

/// `2026-10-23` → `23.10`.
fn short_date(text: &str) -> String {
    match (text.get(8..10), text.get(5..7)) {
        (Some(day), Some(month)) => format!("{day}.{month}"),
        _ => text.to_owned(),
    }
}

async fn project_title(conn: &mut PgConnection, account: Uuid, id: Uuid) -> Result<Option<String>> {
    Ok(qubite_planner::get_project(conn, account, id)
        .await?
        .map(|project| project.title))
}

/// «в «Русский», срок 23.10 16:00» — что видно из полей дела.
async fn task_details(
    conn: &mut PgConnection,
    account: Uuid,
    fields: &Map<String, Value>,
) -> Result<String> {
    let mut parts = Vec::new();
    match fields.get("project_id") {
        Some(Value::String(id)) => {
            if let Some(title) = match id.parse() {
                Ok(id) => project_title(conn, account, id).await?,
                Err(_) => None,
            } {
                parts.push(format!("в «{title}»"));
            }
        }
        Some(Value::Null) => parts.push("без проекта".to_owned()),
        _ => {}
    }
    match fields.get("due_date") {
        Some(Value::String(date)) => {
            let time = fields
                .get("due_time")
                .and_then(Value::as_str)
                .map(|time| format!(" {time}"))
                .unwrap_or_default();
            parts.push(format!("срок {}{time}", short_date(date)));
        }
        Some(Value::Null) => parts.push("без срока".to_owned()),
        _ => {}
    }
    match fields.get("priority").and_then(Value::as_str) {
        Some("important") => parts.push("важное".to_owned()),
        Some("urgent") => parts.push("срочное".to_owned()),
        Some("normal") => parts.push("обычное".to_owned()),
        _ => {}
    }
    if let Some(status) = fields.get("status").and_then(Value::as_str) {
        parts.push(
            match status {
                "doing" => "в работе",
                "done" => "сделано",
                _ => "надо",
            }
            .to_owned(),
        );
    }
    if fields.contains_key("subtasks") {
        parts.push("шаги".to_owned());
    }
    if fields.contains_key("notes") {
        parts.push("заметка".to_owned());
    }
    if fields.contains_key("recurrence") {
        parts.push("повторение".to_owned());
    }
    Ok(parts.join(", "))
}

fn with_details(base: String, details: &str) -> String {
    if details.is_empty() {
        base
    } else {
        format!("{base}: {details}")
    }
}

// ---------------------------------------------------------------- проверки

/// Q-66: «сделано» за человека агент не ставит (он может спросить «сделал?»).
fn guard_status(who: &Who, fields: &Map<String, Value>) -> Result<()> {
    if who.actor() == Actor::Agent && fields.get("status").and_then(Value::as_str) == Some("done") {
        return Err(Error::NeedsOwner(
            "Отметить дело «сделано» может только ты — агент может спросить «сделал?»".into(),
        ));
    }
    Ok(())
}

fn check_title(title: &str) -> Result<String> {
    let title = title.trim();
    if title.is_empty() {
        return Err(Error::Invalid("нужно название".into()));
    }
    Ok(title.to_owned())
}

async fn can_read(conn: &mut PgConnection, who: &Who, module: &str) -> Result<()> {
    check_agent(conn, who).await?;
    qubite_policy::decide_in::<Read>(conn, &who.subject(), &ModuleId::new(module)?).await?;
    Ok(())
}

async fn own_task(
    conn: &mut PgConnection,
    account: Uuid,
    id: Uuid,
) -> Result<qubite_planner::Task> {
    qubite_planner::get_task(conn, account, id)
        .await?
        .filter(|task| !task.deleted)
        .ok_or(Error::NotFound)
}

async fn own_project(
    conn: &mut PgConnection,
    account: Uuid,
    id: Uuid,
) -> Result<qubite_planner::Project> {
    qubite_planner::get_project(conn, account, id)
        .await?
        .filter(|project| !project.deleted)
        .ok_or(Error::NotFound)
}

fn task_json(task: &qubite_planner::Task) -> Value {
    json!({ "id": task.id, "title": task.title, "revision": task.revision, "fields": task.fields() })
}

fn project_json(project: &qubite_planner::Project) -> Value {
    json!({
        "id": project.id,
        "title": project.title,
        "revision": project.revision,
        "fields": project.fields(),
    })
}

fn edit_steps(
    object_id: Uuid,
    title: Option<String>,
    fields: Map<String, Value>,
) -> Result<Vec<Step>> {
    let mut steps = Vec::new();
    if let Some(title) = title {
        steps.push(Step {
            object_id,
            kind: OpKind::SetTitle {
                title: check_title(&title)?,
            },
        });
    }
    if !fields.is_empty() {
        steps.push(Step {
            object_id,
            kind: OpKind::Patch {
                fields: Value::Object(fields),
            },
        });
    }
    if steps.is_empty() {
        return Err(Error::Invalid("нечего менять".into()));
    }
    Ok(steps)
}

// ---------------------------------------------------------------- разложить мысль

/// Шаги «разложить мысль»: что создать и мысль — в архив, одним действием
/// (откат вернёт всё сразу). Удалять тут нечего: мысль только уходит в архив.
pub(crate) async fn plan_file(
    conn: &mut PgConnection,
    who: &Who,
    file: InboxFile,
) -> Result<(String, Vec<Step>)> {
    let account = who.account();
    let InboxFile {
        item_id,
        to,
        title,
        mut fields,
        project_id,
        new_project,
    } = file;
    let item = qubite_inbox::get(conn, account, item_id)
        .await?
        .filter(|item| !item.deleted)
        .ok_or(Error::NotFound)?;
    if item.status != qubite_inbox::Status::New {
        return Err(Error::Invalid("эта мысль уже разобрана".into()));
    }
    let title = check_title(title.as_deref().unwrap_or(&item.title))?;
    let thought = item.title.chars().take(80).collect::<String>();
    let mut steps = Vec::new();
    let mut new_project_title = None;
    if let Some(name) = new_project
        .as_deref()
        .map(str::trim)
        .filter(|n| !n.is_empty())
        && matches!(to, FileTo::Task | FileTo::Idea)
    {
        let name = check_title(name)?;
        let id = Uuid::now_v7();
        steps.push(Step {
            object_id: id,
            kind: OpKind::Create {
                object_type: PROJECT_TYPE.into(),
                title: name.clone(),
                fields: Some(json!({})),
            },
        });
        fields.insert("project_id".into(), json!(id));
        new_project_title = Some(name);
    }
    let summary = match to {
        FileTo::Task | FileTo::Idea => {
            guard_status(who, &fields)?;
            if to == FileTo::Idea {
                // Идея — без срока: о ней агент вспомнит сам в свободное время.
                fields.remove("due_date");
                fields.remove("due_time");
                fields.remove("recurrence");
            }
            fields.insert("from_inbox".into(), json!(item_id));
            let details = match &new_project_title {
                Some(name) => {
                    let mut rest = fields.clone();
                    rest.remove("project_id");
                    let more = task_details(conn, account, &rest).await?;
                    let base = format!("в новом проекте «{name}»");
                    if more.is_empty() {
                        base
                    } else {
                        format!("{base}, {more}")
                    }
                }
                None => task_details(conn, account, &fields).await?,
            };
            steps.push(Step {
                object_id: Uuid::now_v7(),
                kind: OpKind::Create {
                    object_type: TASK_TYPE.into(),
                    title: title.clone(),
                    fields: Some(Value::Object(fields)),
                },
            });
            with_details(
                format!("Разложил мысль «{thought}» → {} «{title}»", to.word()),
                &details,
            )
        }
        FileTo::Project => {
            steps.push(Step {
                object_id: Uuid::now_v7(),
                kind: OpKind::Create {
                    object_type: PROJECT_TYPE.into(),
                    title: title.clone(),
                    fields: Some(Value::Object(fields)),
                },
            });
            format!("Разложил мысль «{thought}» → проект «{title}»")
        }
        FileTo::Note => {
            let project = match project_id {
                Some(id) => Some(own_project(conn, account, id).await?.title),
                None => None,
            };
            match project {
                Some(project) => {
                    format!("Разложил мысль «{thought}» → заметка к «{project}»")
                }
                None => format!("Разложил мысль «{thought}» → заметка"),
            }
        }
        FileTo::Archive => format!("Разложил мысль «{thought}» → в архив"),
    };
    steps.push(Step {
        object_id: item_id,
        kind: OpKind::Patch {
            fields: json!({ "status": "archived" }),
        },
    });
    Ok((summary, steps))
}

// ---------------------------------------------------------------- вызов

/// Вызвать инструмент. `reason` — почему (память, навык, просьба); `batch` —
/// пакет решения (шаги одного решения откатываются вместе), нет — свой.
pub async fn call(
    pool: &PgPool,
    who: &Who,
    tool: &str,
    arguments: Value,
    reason: Option<&str>,
    batch: Option<Uuid>,
) -> Result<Outcome> {
    if matches!(
        tool,
        crate::opportunities::SUGGEST_TOOL | crate::opportunities::ADD_TOOL
    ) {
        let action = crate::opportunities::write(pool, who, tool, arguments, reason, batch).await?;
        return Ok(Outcome::Done(Box::new(action)));
    }
    if tool == crate::digest::TOOL {
        let action = crate::digest::write(pool, who, arguments, reason, batch).await?;
        return Ok(Outcome::Done(Box::new(action)));
    }
    if tool == crate::proactive::SEND_TOOL {
        let action = crate::proactive::send(pool, who, arguments, reason, batch).await?;
        return Ok(Outcome::Done(Box::new(action)));
    }
    if tool == crate::why::TOOL {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct WhyArgs {
            batch_id: Uuid,
            answer: String,
        }
        let WhyArgs { batch_id, answer } = args(tool, arguments)?;
        let why = crate::why::answer(pool, who, batch_id, &answer).await?;
        let lesson = why.kind.is_some_and(crate::why::Kind::lesson);
        return Ok(Outcome::Read(json!({ "recorded": true, "lesson": lesson })));
    }
    let account = who.account();
    let mut pooled = pool.acquire().await?;
    let conn = &mut *pooled;
    let (summary, steps) = match tool {
        "task.get" => {
            let TaskRef { task_id } = args(tool, arguments)?;
            can_read(conn, who, qubite_planner::MODULE).await?;
            let task = qubite_planner::get_task(conn, account, task_id)
                .await?
                .ok_or(Error::NotFound)?;
            return Ok(Outcome::Read(task_json(&task)));
        }
        "task.search" => {
            let Search {
                query,
                project_id,
                limit,
            } = args(tool, arguments)?;
            can_read(conn, who, qubite_planner::MODULE).await?;
            let query = query.trim().to_lowercase();
            let tasks = qubite_planner::list_tasks(conn, account, project_id, 1000).await?;
            let found: Vec<Value> = tasks
                .iter()
                .filter(|task| query.is_empty() || task.title.to_lowercase().contains(&query))
                .take(usize::try_from(limit.unwrap_or(50).clamp(1, 200)).unwrap_or(50))
                .map(task_json)
                .collect();
            return Ok(Outcome::Read(Value::Array(found)));
        }
        "project.list" => {
            can_read(conn, who, qubite_planner::MODULE).await?;
            let projects = qubite_planner::list_projects(conn, account).await?;
            return Ok(Outcome::Read(Value::Array(
                projects.iter().map(project_json).collect(),
            )));
        }
        crate::proactive::WINDOWS_TOOL | crate::proactive::PRESENCE_TOOL => {
            can_read(conn, who, crate::MODULE).await?;
            return Ok(Outcome::Read(
                crate::proactive::read_tool(conn, account, tool, arguments).await?,
            ));
        }
        "files.list" | "files.read" | "question.list" => {
            can_read(conn, who, crate::MODULE).await?;
            return Ok(Outcome::Read(
                crate::memory::read(conn, account, tool, arguments).await?,
            ));
        }
        "files.create" | "memory.add" | "memory.patch" | "memory.remove" | "question.ask"
        | "question.close" => crate::memory::plan(conn, account, tool, arguments).await?,
        "skill.list" | "skill.view" => {
            can_read(conn, who, crate::MODULE).await?;
            return Ok(Outcome::Read(
                crate::skills::read(conn, account, tool, arguments).await?,
            ));
        }
        "skill.create" | "skill.patch" | "skill.archive" => {
            crate::skills::plan(conn, account, tool, arguments, reason).await?
        }
        "project.get" => {
            let ProjectRef { project_id } = args(tool, arguments)?;
            can_read(conn, who, qubite_planner::MODULE).await?;
            let project = qubite_planner::get_project(conn, account, project_id)
                .await?
                .ok_or(Error::NotFound)?;
            return Ok(Outcome::Read(project_json(&project)));
        }

        "task.create" => {
            let Create { title, mut fields } = args(tool, arguments)?;
            let title = check_title(&title)?;
            guard_status(who, &fields)?;
            let mut duration_note = String::new();
            if who.actor() == Actor::Agent && !fields.contains_key("duration_minutes") {
                can_read(conn, who, qubite_planner::MODULE).await?;
                let history = qubite_planner::list_tasks(conn, account, None, 1000).await?;
                let notes = fields.get("notes").and_then(Value::as_str).unwrap_or("");
                let estimate = crate::duration::estimate(&title, notes, &history);
                if estimate.sure {
                    fields.insert("duration_minutes".into(), json!(estimate.minutes));
                    fields.insert("duration_by".into(), json!("agent"));
                    duration_note = estimate.why;
                } else {
                    let short: String = title.chars().take(260).collect();
                    let question = crate::files::redact(&format!("Сколько займёт «{short}»?")).0;
                    if crate::questions::may_ask(conn, account, &question)
                        .await?
                        .is_ok()
                    {
                        duration_note = format!(
                            "Длительность неизвестна; спроси через question.ask с text={}: {}",
                            json!(question),
                            estimate.why
                        );
                    }
                }
            }
            let details = task_details(conn, account, &fields).await?;
            (
                with_details(
                    with_details(format!("Создал дело «{title}»"), &details),
                    &duration_note,
                ),
                vec![Step {
                    object_id: Uuid::now_v7(),
                    kind: OpKind::Create {
                        object_type: TASK_TYPE.into(),
                        title,
                        fields: Some(Value::Object(fields)),
                    },
                }],
            )
        }
        "task.update" => {
            let TaskUpdate {
                task_id,
                title,
                fields,
            } = args(tool, arguments)?;
            guard_status(who, &fields)?;
            let task = own_task(conn, account, task_id).await?;
            if who.actor() == Actor::Agent
                && task.duration_by == Some(qubite_planner::DurationBy::Owner)
                && (fields.contains_key("duration_minutes") || fields.contains_key("duration_by"))
            {
                return Err(Error::NeedsOwner(
                    "длительность человека агент не меняет".into(),
                ));
            }
            let mut details = task_details(conn, account, &fields).await?;
            if let Some(title) = &title {
                let renamed = format!("название «{}»", title.trim());
                details = if details.is_empty() {
                    renamed
                } else {
                    format!("{renamed}, {details}")
                };
            }
            (
                with_details(format!("Изменил дело «{}»", task.title), &details),
                edit_steps(task_id, title, fields)?,
            )
        }
        "task.reschedule" => {
            let Reschedule {
                task_id,
                due_date,
                due_time,
            } = args(tool, arguments)?;
            if reason.is_none_or(|reason| reason.trim().is_empty()) {
                return Err(Error::Invalid("у переноса нужна причина".into()));
            }
            let task = own_task(conn, account, task_id).await?;
            let when = match &due_date {
                Some(date) => format!(
                    "на {}{}",
                    short_date(date),
                    due_time
                        .as_deref()
                        .map(|time| format!(" {time}"))
                        .unwrap_or_default()
                ),
                None => "без срока".to_owned(),
            };
            let mut fields = Map::new();
            fields.insert("due_date".into(), json!(due_date));
            fields.insert("due_time".into(), json!(due_time));
            (
                format!("Перенёс «{}» {when}", task.title),
                edit_steps(task_id, None, fields)?,
            )
        }
        "task.trash" => {
            let TaskRef { task_id } = args(tool, arguments)?;
            let task = own_task(conn, account, task_id).await?;
            (
                format!("Убрал в корзину дело «{}»", task.title),
                vec![Step {
                    object_id: task_id,
                    kind: OpKind::Delete,
                }],
            )
        }
        "project.create" => {
            let Create { title, fields } = args(tool, arguments)?;
            let title = check_title(&title)?;
            (
                format!("Создал проект «{title}»"),
                vec![Step {
                    object_id: Uuid::now_v7(),
                    kind: OpKind::Create {
                        object_type: PROJECT_TYPE.into(),
                        title,
                        fields: Some(Value::Object(fields)),
                    },
                }],
            )
        }
        "project.update" => {
            let ProjectUpdate {
                project_id,
                title,
                fields,
            } = args(tool, arguments)?;
            let project = own_project(conn, account, project_id).await?;
            let what = match &title {
                Some(title) => format!(": название «{}»", title.trim()),
                None => String::new(),
            };
            (
                format!("Изменил проект «{}»{what}", project.title),
                edit_steps(project_id, title, fields)?,
            )
        }
        "inbox.file" => plan_file(conn, who, args(tool, arguments)?).await?,
        other => return Err(Error::Invalid(format!("нет инструмента {other}"))),
    };
    drop(pooled);
    let plan = Plan {
        tool: tool.to_owned(),
        summary,
        reason: reason.map(str::to_owned),
        batch: batch.unwrap_or_else(Uuid::now_v7),
        reverts: None,
        corrects: None,
        steps,
    };
    Ok(Outcome::Done(Box::new(
        timeline::execute(pool, who, plan).await?,
    )))
}

/// «Исправить»: человек поправляет результат действия агента (`object_id` —
/// дело или проект из этого действия). Это его действие с пометкой
/// «поправка» — по ней агент учится: задача `agent.learn` ставится той же
/// транзакцией (AGT-003).
pub async fn fix(
    pool: &PgPool,
    who: &Who,
    action_id: Uuid,
    object_id: Uuid,
    title: Option<String>,
    fields: Map<String, Value>,
) -> Result<Action> {
    if who.actor() != Actor::Owner {
        return Err(Error::NeedsOwner("исправляет только человек".into()));
    }
    let account = who.account();
    let action = timeline::get(pool, account, action_id)
        .await?
        .ok_or(Error::NotFound)?;
    let change = action
        .changes
        .iter()
        .find(|change| change.object_id == object_id)
        .ok_or(Error::NotFound)?;
    let mut conn = pool.acquire().await?;
    let (tool, summary) = match change.object_type.as_str() {
        TASK_TYPE => {
            let task = own_task(&mut conn, account, object_id).await?;
            let mut details = task_details(&mut conn, account, &fields).await?;
            if let Some(title) = &title {
                let renamed = format!("название «{}»", title.trim());
                details = if details.is_empty() {
                    renamed
                } else {
                    format!("{renamed}, {details}")
                };
            }
            (
                "task.update",
                with_details(format!("Поправил дело «{}»", task.title), &details),
            )
        }
        PROJECT_TYPE => {
            let project = own_project(&mut conn, account, object_id).await?;
            (
                "project.update",
                format!("Поправил проект «{}»", project.title),
            )
        }
        _ => {
            return Err(Error::Invalid(
                "исправить можно дело или проект, остальное — откатить".into(),
            ));
        }
    };
    drop(conn);
    let plan = Plan {
        tool: tool.to_owned(),
        summary,
        reason: Some(format!("поправка к: {}", action.summary)),
        batch: Uuid::now_v7(),
        reverts: None,
        corrects: Some(action_id),
        steps: edit_steps(object_id, title, fields)?,
    };
    // Поправка — повод агенту научиться: уточнить навык или завести новый (AGT-003).
    let mut tx = pool.begin().await?;
    timeline::lock(&mut tx, account).await?;
    let correction = timeline::execute_in(&mut tx, who, plan).await?;
    crate::skills::schedule_learn(&mut tx, account, correction.id).await?;
    tx.commit().await?;
    Ok(correction)
}
