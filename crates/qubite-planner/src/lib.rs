//! Модуль Planner (PLAN-001): проекты и дела.
//!
//! Проект (`planner.project`) и дело (`planner.task`) — объекты ядра
//! (заголовок, версия, корзина, история) плюс строка в таблице модуля. Дело
//! принадлежит проекту через обычную связь ядра `part_of` (дело → проект);
//! дело, сделанное из мысли во Входящих, связано с ней `derived_from`.
//!
//! У дела сразу есть шаги с галочками, важность (обычное / важное / срочное),
//! срок (день и, если надо, время) и повторение. Следующее повторяющееся дело
//! создаёт сервер, **когда текущее выполнено** ([`recurrence`]) — в той же
//! операции синхронизации, поэтому оно появится ровно один раз, даже если
//! дело отметили на двух устройствах без сети.
//!
//! Создавать и менять можно только через движок синхронизации
//! (`/api/v1/sync/push` или [`qubite_sync_server::apply_one`]): одна
//! проверка, одна история, права — модуль `planner` в Policy Gate.
//! Решения — D-250…D-264.

pub mod event;
pub mod folder;
pub mod recurrence;
pub mod reminder;
pub mod ydoc;

pub use qubite_objects::{Error, Result};
use qubite_objects::{NewObject, NewRelation, Object, objects, relations};
use qubite_sync_server::{BoxFuture, FieldsError, TypeFields};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Value, json};
use sqlx::PgConnection;
use time::{Date, Month, OffsetDateTime, Time};
use uuid::Uuid;

pub use recurrence::{Freq, Recurrence, next_due};
pub use reminder::Remind;

/// Модуль в каталоге (права выдаются на него).
pub const MODULE: &str = "planner";
pub const PROJECT_TYPE: &str = "planner.project";
pub const TASK_TYPE: &str = "planner.task";
/// Связь «дело входит в проект».
pub const PART_OF: &str = "part_of";
/// Связь «дело сделано из мысли во Входящих».
pub const DERIVED_FROM: &str = "derived_from";
pub const MAX_NOTES_CHARS: usize = 20_000;
pub const MAX_SUBTASKS: usize = 100;
pub const MAX_SUBTASK_CHARS: usize = 500;
pub const MAX_TAG_CHARS: usize = 64;
pub const MAX_REMIND_WHY_CHARS: usize = 300;
pub const MAX_TRAVEL_MINUTES: i32 = 525_600;
/// Пояс, если владелец платформы его не задал (как `platform.timezone`).
pub const DEFAULT_TIMEZONE: &str = "Asia/Yekaterinburg";

// ---------------------------------------------------------------- значения

macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }
        }

        impl std::str::FromStr for $name {
            type Err = String;
            fn from_str(value: &str) -> std::result::Result<Self, String> {
                match value {
                    $($text => Ok(Self::$variant),)+
                    other => Err(format!("неизвестное значение {other}")),
                }
            }
        }
    };
}

text_enum!(
    /// `todo` — надо, `doing` — в работе, `done` — сделано.
    Status { Todo = "todo", Doing = "doing", Done = "done" }
);
text_enum!(
    /// Важность дела.
    Priority { Normal = "normal", Important = "important", Urgent = "urgent" }
);
text_enum!(
    /// Кто выбрал время напоминания: `auto` — Qubite по смыслу дела,
    /// `owner` — сам человек, `agent` — агент (с «почему»).
    RemindBy { Auto = "auto", Owner = "owner", Agent = "agent" }
);
text_enum!(
    /// `active` — идёт, `archived` — закончен или отложен.
    ProjectStatus { Active = "active", Archived = "archived" }
);
text_enum!(
    /// Цвет точки проекта из палитры «Частиц».
    Color { Orange = "orange", Sky = "sky", Yellow = "yellow", Green = "green", Peach = "peach" }
);

fn parse<T: std::str::FromStr<Err = String>>(value: &str) -> Result<T> {
    value.parse().map_err(Error::Invalid)
}

pub fn millis(at: OffsetDateTime) -> i64 {
    i64::try_from(at.unix_timestamp_nanos() / 1_000_000).unwrap_or(i64::MAX)
}

/// `2026-10-20`.
pub fn format_date(date: Date) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}

/// `16:00`.
pub fn format_time(time: Time) -> String {
    format!("{:02}:{:02}", time.hour(), time.minute())
}

pub fn parse_date(text: &str) -> Result<Date, String> {
    let bad = || format!("неверная дата «{text}», нужно ГГГГ-ММ-ДД");
    let mut parts = text.split('-');
    let (Some(year), Some(month), Some(day), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(bad());
    };
    if year.len() != 4 || month.len() != 2 || day.len() != 2 {
        return Err(bad());
    }
    let year: i32 = year.parse().map_err(|_| bad())?;
    let month: u8 = month.parse().map_err(|_| bad())?;
    let day: u8 = day.parse().map_err(|_| bad())?;
    let month = Month::try_from(month).map_err(|_| bad())?;
    Date::from_calendar_date(year, month, day).map_err(|_| bad())
}

pub fn parse_time(text: &str) -> Result<Time, String> {
    let bad = || format!("неверное время «{text}», нужно ЧЧ:ММ");
    let (hour, minute) = text.split_once(':').ok_or_else(bad)?;
    if hour.is_empty() || hour.len() > 2 || minute.len() != 2 {
        return Err(bad());
    }
    let hour: u8 = hour.parse().map_err(|_| bad())?;
    let minute: u8 = minute.parse().map_err(|_| bad())?;
    Time::from_hms(hour, minute, 0).map_err(|_| bad())
}

/// Тег проекта для Command: без «#», строчными, пробелы — «_».
/// «Олимпиада по информатике» → `олимпиада_по_информатике`.
pub fn tag_from(text: &str) -> String {
    let words: Vec<String> = text
        .split(|c: char| c.is_whitespace() || c == '#')
        .filter(|word| !word.is_empty())
        .map(str::to_lowercase)
        .collect();
    let tag: String = words.join("_").chars().take(MAX_TAG_CHARS).collect();
    if tag.is_empty() {
        "проект".into()
    } else {
        tag
    }
}

/// Сегодняшний день по поясу платформы (`platform.timezone`).
pub async fn today(conn: &mut PgConnection) -> sqlx::Result<Date> {
    sqlx::query_scalar(
        "SELECT (now() AT TIME ZONE coalesce( \
             (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), $1) \
         )::date",
    )
    .bind(DEFAULT_TIMEZONE)
    .fetch_one(conn)
    .await
}

// ---------------------------------------------------------------- проект

/// Проект целиком.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Project {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub title: String,
    pub revision: i64,
    pub deleted: bool,
    pub color: Color,
    pub tag: String,
    pub status: ProjectStatus,
    pub notes: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct ProjectRow {
    id: Uuid,
    owner_id: Uuid,
    title: String,
    revision: i64,
    deleted_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    color: String,
    tag: String,
    status: String,
    notes: String,
}

const PROJECT_SELECT: &str = "SELECT o.id, o.owner_id, o.title, o.revision, o.deleted_at, \
     o.created_at, o.updated_at, p.color, p.tag, p.status, p.notes \
     FROM objects o JOIN planner_projects p ON p.object_id = o.id";

impl TryFrom<ProjectRow> for Project {
    type Error = Error;
    fn try_from(row: ProjectRow) -> Result<Self> {
        Ok(Self {
            id: row.id,
            owner_id: row.owner_id,
            title: row.title,
            revision: row.revision,
            deleted: row.deleted_at.is_some(),
            color: parse(&row.color)?,
            tag: row.tag,
            status: parse(&row.status)?,
            notes: row.notes,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

impl Project {
    /// Поля модуля для снимка синхронизации.
    pub fn fields(&self) -> Value {
        json!({
            "color": self.color,
            "tag": self.tag,
            "status": self.status,
            "notes": self.notes,
        })
    }
}

async fn project_any(conn: &mut PgConnection, id: Uuid) -> Result<Option<Project>> {
    let row: Option<ProjectRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{PROJECT_SELECT} WHERE o.id = $1"
    )))
    .bind(id)
    .fetch_optional(conn)
    .await?;
    row.map(Project::try_from).transpose()
}

/// Проект владельца (в том числе из корзины). Чужой — `None`.
pub async fn get_project(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
) -> Result<Option<Project>> {
    Ok(project_any(conn, id)
        .await?
        .filter(|project| project.owner_id == owner))
}

/// Живые проекты владельца: идущие сверху, потом по названию.
pub async fn list_projects(conn: &mut PgConnection, owner: Uuid) -> Result<Vec<Project>> {
    let rows: Vec<ProjectRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{PROJECT_SELECT} WHERE o.owner_id = $1 AND o.deleted_at IS NULL \
         ORDER BY p.status, lower(o.title), o.id"
    )))
    .bind(owner)
    .fetch_all(conn)
    .await?;
    rows.into_iter().map(Project::try_from).collect()
}

/// Проект по `#тегу` из Command: точное совпадение тега (без регистра), а
/// если такого нет — единственный проект, чей тег начинается так же
/// (`#олимп` → «Олимпиада по информатике»). Только живые проекты владельца;
/// при одинаковых тегах — самый старый.
pub async fn project_by_tag(
    conn: &mut PgConnection,
    owner: Uuid,
    tag: &str,
) -> Result<Option<Project>> {
    let tag = tag_from(tag);
    let rows: Vec<ProjectRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{PROJECT_SELECT} WHERE o.owner_id = $1 AND o.deleted_at IS NULL \
           AND starts_with(lower(p.tag), $2) \
         ORDER BY (lower(p.tag) = $2) DESC, o.created_at, o.id"
    )))
    .bind(owner)
    .bind(&tag)
    .fetch_all(conn)
    .await?;
    let projects = rows
        .into_iter()
        .map(Project::try_from)
        .collect::<Result<Vec<_>>>()?;
    let exact = projects
        .iter()
        .find(|project| project.tag.to_lowercase() == tag);
    Ok(match (exact, projects.len()) {
        (Some(project), _) => Some(project.clone()),
        (None, 1) => projects.into_iter().next(),
        _ => None,
    })
}

// ---------------------------------------------------------------- дело

/// Шаг дела с галочкой.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Subtask {
    /// Придумывает устройство (любая строка до 64 символов).
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub done: bool,
}

text_enum! {
    /// Кто указал длительность дела.
    DurationBy { Owner = "owner", Agent = "agent" }
}

/// Дело целиком.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Task {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub title: String,
    pub revision: i64,
    pub deleted: bool,
    pub notes: String,
    pub status: Status,
    pub priority: Priority,
    pub due_date: Option<Date>,
    pub due_time: Option<Time>,
    pub place_text: Option<String>,
    pub place_lat: Option<f64>,
    pub place_lon: Option<f64>,
    pub travel_minutes: Option<i32>,
    pub duration_minutes: Option<i32>,
    pub duration_by: Option<DurationBy>,
    pub subtasks: Vec<Subtask>,
    pub recurrence: Option<Recurrence>,
    /// Своё время напоминания; нет — «само» по смыслу дела ([`reminder`]).
    pub remind: Option<Remind>,
    /// Почему тогда (пишет тот, кто выбрал время).
    pub remind_why: String,
    pub remind_by: RemindBy,
    pub completed_at: Option<OffsetDateTime>,
    /// Проект (связь `part_of`), даже если он в корзине.
    pub project_id: Option<Uuid>,
    /// Первое дело серии повторений.
    pub series_id: Option<Uuid>,
    /// Следующее дело серии, созданное при выполнении этого.
    pub next_id: Option<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct TaskRow {
    id: Uuid,
    owner_id: Uuid,
    title: String,
    revision: i64,
    deleted_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    notes: String,
    status: String,
    priority: String,
    due_date: Option<Date>,
    due_time: Option<Time>,
    place_text: Option<String>,
    place_lat: Option<f64>,
    place_lon: Option<f64>,
    travel_minutes: Option<i32>,
    duration_minutes: Option<i32>,
    duration_by: Option<String>,
    subtasks: Value,
    recurrence: Option<Value>,
    remind: Option<Value>,
    remind_why: String,
    remind_by: String,
    completed_at: Option<OffsetDateTime>,
    series_id: Option<Uuid>,
    next_id: Option<Uuid>,
    project_id: Option<Uuid>,
}

const TASK_SELECT: &str = "SELECT o.id, o.owner_id, o.title, o.revision, o.deleted_at, \
     o.created_at, o.updated_at, t.notes, t.status, t.priority, t.due_date, t.due_time, \
     t.subtasks, t.recurrence, t.remind, t.remind_why, t.remind_by, t.completed_at, \
     t.series_id, t.next_id, t.place_text, t.place_lat, t.place_lon, t.travel_minutes, t.duration_minutes, t.duration_by, \
     (SELECT r.to_id FROM relations r JOIN objects p ON p.id = r.to_id \
       WHERE r.from_id = o.id AND r.type = 'part_of' AND r.deleted_at IS NULL \
         AND p.type = 'planner.project' ORDER BY r.created_at DESC LIMIT 1) AS project_id \
     FROM objects o JOIN planner_tasks t ON t.object_id = o.id";

impl TryFrom<TaskRow> for Task {
    type Error = Error;
    fn try_from(row: TaskRow) -> Result<Self> {
        let invalid = |error: serde_json::Error| Error::Invalid(error.to_string());
        Ok(Self {
            id: row.id,
            owner_id: row.owner_id,
            title: row.title,
            revision: row.revision,
            deleted: row.deleted_at.is_some(),
            notes: row.notes,
            status: parse(&row.status)?,
            priority: parse(&row.priority)?,
            due_date: row.due_date,
            due_time: row.due_time,
            place_text: row.place_text,
            place_lat: row.place_lat,
            place_lon: row.place_lon,
            travel_minutes: row.travel_minutes,
            duration_minutes: row.duration_minutes,
            duration_by: row.duration_by.as_deref().map(parse).transpose()?,
            subtasks: serde_json::from_value(row.subtasks).map_err(invalid)?,
            recurrence: row
                .recurrence
                .map(serde_json::from_value)
                .transpose()
                .map_err(invalid)?,
            remind: row
                .remind
                .map(serde_json::from_value)
                .transpose()
                .map_err(invalid)?,
            remind_why: row.remind_why,
            remind_by: parse(&row.remind_by)?,
            completed_at: row.completed_at,
            project_id: row.project_id,
            series_id: row.series_id,
            next_id: row.next_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

impl Task {
    /// Поля модуля со значениями «само» по умолчанию (снимки ленты агента).
    pub fn fields(&self) -> Value {
        self.fields_with(reminder::Defaults::default())
    }

    /// Поля модуля для снимка синхронизации. `remind_at` и `remind_why` —
    /// когда и почему напомнит сервер (с учётом «само» человека), если напомнит.
    pub fn fields_with(&self, defaults: reminder::Defaults) -> Value {
        let plan = reminder::plan(self, defaults);
        json!({
            "notes": self.notes,
            "status": self.status,
            "priority": self.priority,
            "due_date": self.due_date.map(format_date),
            "due_time": self.due_time.map(format_time),
            "place_text": self.place_text,
            "place_lat": self.place_lat,
            "place_lon": self.place_lon,
            "travel_minutes": self.travel_minutes,
            "duration_minutes": self.duration_minutes,
            "duration_by": self.duration_by,
            "subtasks": self.subtasks,
            "recurrence": self.recurrence,
            "remind": self.remind,
            "remind_by": self.remind_by,
            "remind_at": plan.as_ref().map(|plan| reminder::format_local(plan.at)),
            "remind_why": plan.map_or_else(|| self.remind_why.clone(), |plan| plan.why),
            "completed_at_ms": self.completed_at.map(millis),
            "project_id": self.project_id,
            "series_id": self.series_id,
            "next_id": self.next_id,
        })
    }
}

pub(crate) async fn task_any(conn: &mut PgConnection, id: Uuid) -> Result<Option<Task>> {
    let row: Option<TaskRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{TASK_SELECT} WHERE o.id = $1"
    )))
    .bind(id)
    .fetch_optional(conn)
    .await?;
    row.map(Task::try_from).transpose()
}

/// Дело владельца (в том числе из корзины). Чужое — `None`.
pub async fn get_task(conn: &mut PgConnection, owner: Uuid, id: Uuid) -> Result<Option<Task>> {
    Ok(task_any(conn, id)
        .await?
        .filter(|task| task.owner_id == owner))
}

/// Живые дела владельца (или одного его проекта): по сроку, без срока — в конце.
pub async fn list_tasks(
    conn: &mut PgConnection,
    owner: Uuid,
    project: Option<Uuid>,
    limit: i64,
) -> Result<Vec<Task>> {
    let rows: Vec<TaskRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT * FROM ({TASK_SELECT} WHERE o.owner_id = $1 AND o.deleted_at IS NULL) t \
         WHERE ($2::uuid IS NULL OR t.project_id = $2) \
         ORDER BY t.due_date NULLS LAST, t.due_time NULLS LAST, t.created_at, t.id LIMIT $3"
    )))
    .bind(owner)
    .bind(project)
    .bind(limit.clamp(1, 1000))
    .fetch_all(conn)
    .await?;
    rows.into_iter().map(Task::try_from).collect()
}

/// Выполненные дела с длительностью, свежие первыми, — история для оценки
/// длительности (отбор до лимита, чтобы старые дела без неё не вытесняли её).
pub async fn done_with_duration(
    conn: &mut PgConnection,
    owner: Uuid,
    limit: i64,
) -> Result<Vec<Task>> {
    let rows: Vec<TaskRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT * FROM ({TASK_SELECT} WHERE o.owner_id = $1 AND o.deleted_at IS NULL) t \
         WHERE t.duration_minutes IS NOT NULL AND t.status = 'done' \
         ORDER BY t.updated_at DESC, t.id LIMIT $2"
    )))
    .bind(owner)
    .bind(limit.clamp(1, 1000))
    .fetch_all(conn)
    .await?;
    rows.into_iter().map(Task::try_from).collect()
}

// ---------------------------------------------------------------- поля для синхронизации

/// Поле, которое можно явно очистить: нет ключа — не трогать, `null` — очистить.
fn some<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}

/// Поля проекта при создании и изменении. Всё необязательное.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectFields {
    pub color: Option<Color>,
    pub tag: Option<String>,
    pub status: Option<ProjectStatus>,
    pub notes: Option<String>,
}

/// Поля дела при создании (`create.fields`) и изменении (`patch.fields`).
/// При изменении — только меняющиеся; `null` очищает срок, время,
/// повторение, проект, место и время дороги.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TaskFields {
    pub notes: Option<String>,
    pub status: Option<Status>,
    pub priority: Option<Priority>,
    /// `ГГГГ-ММ-ДД`.
    #[serde(default, deserialize_with = "some")]
    pub due_date: Option<Option<String>>,
    /// `ЧЧ:ММ`; без даты нельзя.
    #[serde(default, deserialize_with = "some")]
    pub due_time: Option<Option<String>>,
    /// Адрес или название места назначения (до 1000 символов).
    #[serde(default, deserialize_with = "some")]
    pub place_text: Option<Option<String>>,
    #[serde(default, deserialize_with = "some")]
    pub place_lat: Option<Option<f64>>,
    #[serde(default, deserialize_with = "some")]
    pub place_lon: Option<Option<f64>>,
    #[serde(default, deserialize_with = "some")]
    pub travel_minutes: Option<Option<i32>>,
    #[serde(default, deserialize_with = "some")]
    pub duration_minutes: Option<Option<i32>>,
    #[serde(default, deserialize_with = "some")]
    pub duration_by: Option<Option<DurationBy>>,
    /// Весь список шагов целиком.
    pub subtasks: Option<Vec<Subtask>>,
    /// Повторение; без срока нельзя.
    #[serde(default, deserialize_with = "some")]
    pub recurrence: Option<Option<Recurrence>>,
    /// Своё время напоминания; `null` — снова «само» (по смыслу дела).
    #[serde(default, deserialize_with = "some")]
    pub remind: Option<Option<Remind>>,
    /// Почему тогда (до 300 символов).
    pub remind_why: Option<String>,
    /// Кто выбрал время: `owner` (по умолчанию) или `agent`.
    pub remind_by: Option<RemindBy>,
    /// Проект владельца.
    #[serde(default, deserialize_with = "some")]
    pub project_id: Option<Option<Uuid>>,
    /// Только при создании: мысль во Входящих, из которой сделано дело.
    pub from_inbox: Option<Uuid>,
}

fn bad(message: impl Into<String>) -> FieldsError {
    FieldsError::Invalid(message.into())
}

fn objects_error(error: Error) -> FieldsError {
    match error {
        Error::Db(error) => FieldsError::Db(error),
        other => FieldsError::Invalid(other.to_string()),
    }
}

fn check_notes(notes: &str) -> Result<(), FieldsError> {
    if notes.chars().count() > MAX_NOTES_CHARS {
        return Err(bad(format!("заметка длиннее {MAX_NOTES_CHARS} символов")));
    }
    Ok(())
}

fn check_subtasks(subtasks: &[Subtask]) -> Result<(), FieldsError> {
    if subtasks.len() > MAX_SUBTASKS {
        return Err(bad(format!("шагов больше {MAX_SUBTASKS}")));
    }
    let mut seen = std::collections::HashSet::new();
    for step in subtasks {
        if step.id.is_empty() || step.id.chars().count() > 64 {
            return Err(bad("у шага нужен ID до 64 символов"));
        }
        if !seen.insert(step.id.as_str()) {
            return Err(bad("у двух шагов одинаковый ID"));
        }
        let title = step.title.trim();
        if title.is_empty() || title.chars().count() > MAX_SUBTASK_CHARS {
            return Err(bad(format!("шаг — от 1 до {MAX_SUBTASK_CHARS} символов")));
        }
    }
    Ok(())
}

fn check_tag(tag: &str) -> Result<String, FieldsError> {
    let tag = tag_from(tag);
    if tag.chars().count() > MAX_TAG_CHARS {
        return Err(bad(format!("тег длиннее {MAX_TAG_CHARS} символов")));
    }
    Ok(tag)
}

fn invalid_json(what: &str) -> impl Fn(serde_json::Error) -> FieldsError + '_ {
    move |error| bad(format!("поля {what}: {error}"))
}

/// Состояние дела, которое пишется в таблицу целиком.
#[derive(Debug, Clone)]
struct TaskState {
    notes: String,
    status: Status,
    priority: Priority,
    due_date: Option<Date>,
    due_time: Option<Time>,
    place_text: Option<String>,
    place_lat: Option<f64>,
    place_lon: Option<f64>,
    travel_minutes: Option<i32>,
    duration_minutes: Option<i32>,
    duration_by: Option<DurationBy>,
    subtasks: Vec<Subtask>,
    recurrence: Option<Recurrence>,
    remind: Option<Remind>,
    remind_why: String,
    remind_by: RemindBy,
}

impl TaskState {
    fn of(task: &Task) -> Self {
        Self {
            notes: task.notes.clone(),
            status: task.status,
            priority: task.priority,
            due_date: task.due_date,
            due_time: task.due_time,
            place_text: task.place_text.clone(),
            place_lat: task.place_lat,
            place_lon: task.place_lon,
            travel_minutes: task.travel_minutes,
            duration_minutes: task.duration_minutes,
            duration_by: task.duration_by,
            subtasks: task.subtasks.clone(),
            recurrence: task.recurrence.clone(),
            remind: task.remind.clone(),
            remind_why: task.remind_why.clone(),
            remind_by: task.remind_by,
        }
    }

    fn fresh() -> Self {
        Self {
            notes: String::new(),
            status: Status::Todo,
            priority: Priority::Normal,
            due_date: None,
            due_time: None,
            place_text: None,
            place_lat: None,
            place_lon: None,
            travel_minutes: None,
            duration_minutes: None,
            duration_by: None,
            subtasks: Vec::new(),
            recurrence: None,
            remind: None,
            remind_why: String::new(),
            remind_by: RemindBy::Auto,
        }
    }

    /// Применить поля и вернуть имена изменённых.
    fn apply(&mut self, fields: &TaskFields) -> Result<Vec<String>, FieldsError> {
        let mut changed = Vec::new();
        if let Some(notes) = &fields.notes {
            check_notes(notes)?;
            self.notes.clone_from(notes);
            changed.push("notes");
        }
        if let Some(status) = fields.status {
            self.status = status;
            changed.push("status");
        }
        if let Some(priority) = fields.priority {
            self.priority = priority;
            changed.push("priority");
        }
        if let Some(due) = &fields.due_date {
            self.due_date = due.as_deref().map(parse_date).transpose().map_err(bad)?;
            changed.push("due_date");
        }
        if let Some(time) = &fields.due_time {
            self.due_time = time.as_deref().map(parse_time).transpose().map_err(bad)?;
            changed.push("due_time");
        }
        let text_changed = fields
            .place_text
            .as_ref()
            .is_some_and(|text| text != &self.place_text);
        let point_changed = fields.place_lat.is_some_and(|lat| lat != self.place_lat)
            || fields.place_lon.is_some_and(|lon| lon != self.place_lon);
        if text_changed || point_changed {
            self.travel_minutes = None;
            changed.push("travel_minutes");
        }
        // Новый адрес без явной точки больше не использует прежние координаты.
        if text_changed && fields.place_lat.is_none() && fields.place_lon.is_none() {
            self.place_lat = None;
            self.place_lon = None;
            changed.extend(["place_lat", "place_lon"]);
        }
        if let Some(text) = &fields.place_text {
            if text
                .as_ref()
                .is_some_and(|text| text.chars().count() > 1000)
            {
                return Err(bad("место длиннее 1000 символов"));
            }
            self.place_text = text
                .as_ref()
                .map(|text| text.trim().to_owned())
                .filter(|text| !text.is_empty());
            changed.push("place_text");
        }
        if let Some(lat) = fields.place_lat {
            self.place_lat = lat;
            changed.push("place_lat");
        }
        if let Some(lon) = fields.place_lon {
            self.place_lon = lon;
            changed.push("place_lon");
        }
        match (self.place_lat, self.place_lon) {
            (None, None) => {}
            (Some(lat), Some(lon))
                if lat.is_finite()
                    && lon.is_finite()
                    && (-90.0..=90.0).contains(&lat)
                    && (-180.0..=180.0).contains(&lon) => {}
            _ => return Err(bad("у места нужна пара верных координат")),
        }
        if let Some(minutes) = fields.travel_minutes {
            if minutes.is_some_and(|minutes| !(0..=MAX_TRAVEL_MINUTES).contains(&minutes)) {
                return Err(bad("неверное время в пути"));
            }
            self.travel_minutes = minutes;
            changed.push("travel_minutes");
        }
        // Атомарно с записью: агент (duration_by = agent) не перетирает длительность человека.
        if fields.duration_by == Some(Some(DurationBy::Agent))
            && self.duration_by == Some(DurationBy::Owner)
        {
            return Err(bad("длительность человека агент не меняет"));
        }
        if let Some(minutes) = fields.duration_minutes {
            if minutes.is_some_and(|minutes| !(1..=1440).contains(&minutes)) {
                return Err(bad("длительность — от 1 до 1440 минут"));
            }
            self.duration_minutes = minutes;
            self.duration_by =
                minutes.map(|_| fields.duration_by.flatten().unwrap_or(DurationBy::Owner));
            changed.extend(["duration_minutes", "duration_by"]);
        } else if fields.duration_by.is_some() {
            return Err(bad("duration_by ставится вместе с duration_minutes"));
        }
        if let Some(subtasks) = &fields.subtasks {
            check_subtasks(subtasks)?;
            self.subtasks.clone_from(subtasks);
            changed.push("subtasks");
        }
        if let Some(rule) = &fields.recurrence {
            self.recurrence.clone_from(rule);
            changed.push("recurrence");
        }
        if let Some(remind) = &fields.remind {
            match remind {
                None => {
                    self.remind = None;
                    self.remind_by = RemindBy::Auto;
                    self.remind_why.clear();
                }
                Some(remind) => {
                    self.remind = Some(remind.clone().normalized().map_err(bad)?);
                    self.remind_by = match fields.remind_by {
                        Some(RemindBy::Agent) => RemindBy::Agent,
                        _ => RemindBy::Owner,
                    };
                    self.remind_why.clear();
                }
            }
            changed.push("remind");
        } else if fields.remind_by.is_some() {
            return Err(bad("remind_by ставится вместе с remind"));
        }
        if let Some(why) = &fields.remind_why {
            if why.chars().count() > MAX_REMIND_WHY_CHARS {
                return Err(bad(format!(
                    "«почему» длиннее {MAX_REMIND_WHY_CHARS} символов"
                )));
            }
            self.remind_why = why.trim().to_owned();
            changed.push("remind");
        }
        if fields.project_id.is_some() {
            changed.push("project");
        }
        // Без даты нет ни времени, ни повторения: убрали срок — убрали и их.
        if self.due_date.is_none() {
            if fields.due_time.as_ref().is_some_and(Option::is_some) {
                return Err(bad("время без дня не ставится"));
            }
            if fields.recurrence.as_ref().is_some_and(Option::is_some) {
                return Err(bad("для повторения нужен срок первого раза"));
            }
            if self.due_time.take().is_some() {
                changed.push("due_time");
            }
            if self.recurrence.take().is_some() {
                changed.push("recurrence");
            }
        }
        if let (Some(rule), Some(due)) = (self.recurrence.take(), self.due_date) {
            self.recurrence = Some(rule.normalized(due).map_err(bad)?);
        }
        changed.sort_unstable();
        changed.dedup();
        Ok(changed.into_iter().map(str::to_owned).collect())
    }
}

async fn write_task(
    conn: &mut PgConnection,
    id: Uuid,
    state: &TaskState,
    insert: bool,
) -> Result<(), FieldsError> {
    let subtasks = serde_json::to_value(&state.subtasks).map_err(invalid_json("шагов"))?;
    let recurrence = state
        .recurrence
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(invalid_json("повторения"))?;
    let remind = state
        .remind
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(invalid_json("напоминания"))?;
    let sql = if insert {
        "INSERT INTO planner_tasks (object_id, notes, status, priority, due_date, due_time, \
         subtasks, recurrence, remind, remind_why, remind_by, completed_at, \
         place_text, place_lat, place_lon, travel_minutes, duration_minutes, duration_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, \
                 CASE WHEN $3 = 'done' THEN now() END, $12, $13, $14, $15, $16, $17)"
    } else {
        "UPDATE planner_tasks SET notes = $2, status = $3, priority = $4, due_date = $5, \
         due_time = $6, subtasks = $7, recurrence = $8, remind = $9, remind_why = $10, \
         remind_by = $11, completed_at = CASE WHEN $3 = 'done' THEN coalesce(completed_at, now()) END, \
         place_text = $12, place_lat = $13, place_lon = $14, travel_minutes = $15, \
         duration_minutes = $16, duration_by = $17 \
         WHERE object_id = $1"
    };
    sqlx::query(sql)
        .bind(id)
        .bind(&state.notes)
        .bind(state.status.as_str())
        .bind(state.priority.as_str())
        .bind(state.due_date)
        .bind(state.due_time)
        .bind(subtasks)
        .bind(recurrence)
        .bind(remind)
        .bind(&state.remind_why)
        .bind(state.remind_by.as_str())
        .bind(&state.place_text)
        .bind(state.place_lat)
        .bind(state.place_lon)
        .bind(state.travel_minutes)
        .bind(state.duration_minutes)
        .bind(state.duration_by.map(DurationBy::as_str))
        .execute(conn)
        .await?;
    Ok(())
}

/// Поставить проект дела (или убрать). Проект должен быть живым проектом
/// того же владельца; иначе при `strict` — ошибка, без него — дело остаётся
/// без проекта (дело важнее связи: созданное без сети не теряется).
async fn set_project(
    conn: &mut PgConnection,
    task: &Object,
    project: Option<Uuid>,
    strict: bool,
) -> Result<(), FieldsError> {
    let previous: Vec<Uuid> = sqlx::query_scalar(
        "SELECT r.to_id FROM relations r JOIN objects p ON p.id = r.to_id \
         WHERE r.from_id = $1 AND r.type = $2 AND r.deleted_at IS NULL AND p.type = $3",
    )
    .bind(task.id)
    .bind(PART_OF)
    .bind(PROJECT_TYPE)
    .fetch_all(&mut *conn)
    .await?;
    if let Some(project) = project
        && previous == [project]
    {
        return Ok(());
    }
    let target = match project {
        Some(id) => objects::get_any(conn, id).await.map_err(objects_error)?,
        None => None,
    };
    let ok = target.as_ref().is_some_and(|target| {
        target.owner_id == task.owner_id
            && target.object_type == PROJECT_TYPE
            && !target.is_deleted()
    });
    if project.is_some() && !ok {
        if strict {
            return Err(bad("проект не найден"));
        }
        return Ok(());
    }
    for old in previous {
        relations::unlink(conn, task.id, old, PART_OF, task.updated_by)
            .await
            .map_err(objects_error)?;
    }
    if let Some(project) = project {
        relations::link(
            conn,
            NewRelation::manual(task.id, project, PART_OF, task.updated_by),
        )
        .await
        .map_err(objects_error)?;
    }
    Ok(())
}

/// Поставить напоминание о деле в очередь (в той же транзакции).
async fn remind_later(conn: &mut PgConnection, id: Uuid) -> Result<(), FieldsError> {
    reminder::schedule(conn, id)
        .await
        .map(drop)
        .map_err(|error| match error {
            qubite_jobs::Error::Db(error) => FieldsError::Db(error),
            other => FieldsError::Invalid(other.to_string()),
        })
}

/// Дело выполнено: если оно повторяется и следующее ещё не создано —
/// создать следующее (тот же проект, важность, шаги без галочек).
async fn spawn_next(conn: &mut PgConnection, task: &Task) -> Result<Option<Uuid>, FieldsError> {
    let (Some(rule), Some(due)) = (&task.recurrence, task.due_date) else {
        return Ok(None);
    };
    if task.next_id.is_some() || task.status != Status::Done {
        return Ok(None);
    }
    let today = today(conn).await?;
    let Some(next_date) = next_due(rule, due, today) else {
        return Ok(None);
    };
    let mut new = NewObject::new(TASK_TYPE, task.owner_id, task.title.clone());
    new.actor = task.owner_id;
    let next = objects::create(conn, new).await.map_err(objects_error)?;
    let state = TaskState {
        status: Status::Todo,
        due_date: Some(next_date),
        subtasks: task
            .subtasks
            .iter()
            .map(|step| Subtask {
                done: false,
                ..step.clone()
            })
            .collect(),
        remind: reminder::shifted(task.remind.as_ref(), due, next_date),
        ..TaskState::of(task)
    };
    write_task(conn, next.id, &state, true).await?;
    let series = task.series_id.unwrap_or(task.id);
    sqlx::query("UPDATE planner_tasks SET series_id = $2 WHERE object_id = $1")
        .bind(next.id)
        .bind(series)
        .execute(&mut *conn)
        .await?;
    sqlx::query("UPDATE planner_tasks SET series_id = $2, next_id = $3 WHERE object_id = $1")
        .bind(task.id)
        .bind(series)
        .bind(next.id)
        .execute(&mut *conn)
        .await?;
    if task.project_id.is_some() {
        set_project(conn, &next, task.project_id, false).await?;
    }
    remind_later(conn, next.id).await?;
    Ok(Some(next.id))
}

/// Обработчик полей `planner.project` для движка синхронизации.
pub struct ProjectFieldsHandler;

impl TypeFields for ProjectFieldsHandler {
    fn object_type(&self) -> &'static str {
        PROJECT_TYPE
    }

    fn create<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: Option<&'a Value>,
    ) -> BoxFuture<'a, Result<(), FieldsError>> {
        Box::pin(async move {
            let fields: ProjectFields = match fields {
                Some(value) => {
                    serde_json::from_value(value.clone()).map_err(invalid_json("проекта"))?
                }
                None => ProjectFields::default(),
            };
            if object.title.trim().is_empty() {
                return Err(bad("у проекта нужно название"));
            }
            let notes = fields.notes.unwrap_or_default();
            check_notes(&notes)?;
            let tag = check_tag(fields.tag.as_deref().unwrap_or(&object.title))?;
            sqlx::query(
                "INSERT INTO planner_projects (object_id, color, tag, status, notes) \
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(object.id)
            .bind(fields.color.unwrap_or(Color::Orange).as_str())
            .bind(tag)
            .bind(fields.status.unwrap_or(ProjectStatus::Active).as_str())
            .bind(notes)
            .execute(conn)
            .await?;
            Ok(())
        })
    }

    fn patch<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: &'a Value,
    ) -> BoxFuture<'a, Result<Vec<String>, FieldsError>> {
        Box::pin(async move {
            let fields: ProjectFields =
                serde_json::from_value(fields.clone()).map_err(invalid_json("проекта"))?;
            let mut changed = Vec::new();
            if let Some(color) = fields.color {
                sqlx::query("UPDATE planner_projects SET color = $2 WHERE object_id = $1")
                    .bind(object.id)
                    .bind(color.as_str())
                    .execute(&mut *conn)
                    .await?;
                changed.push("color".to_owned());
            }
            if let Some(tag) = &fields.tag {
                sqlx::query("UPDATE planner_projects SET tag = $2 WHERE object_id = $1")
                    .bind(object.id)
                    .bind(check_tag(tag)?)
                    .execute(&mut *conn)
                    .await?;
                changed.push("tag".to_owned());
            }
            if let Some(status) = fields.status {
                sqlx::query("UPDATE planner_projects SET status = $2 WHERE object_id = $1")
                    .bind(object.id)
                    .bind(status.as_str())
                    .execute(&mut *conn)
                    .await?;
                changed.push("status".to_owned());
            }
            if let Some(notes) = &fields.notes {
                check_notes(notes)?;
                sqlx::query("UPDATE planner_projects SET notes = $2 WHERE object_id = $1")
                    .bind(object.id)
                    .bind(notes)
                    .execute(&mut *conn)
                    .await?;
                changed.push("notes".to_owned());
            }
            if changed.is_empty() {
                return Err(bad("нечего менять"));
            }
            Ok(changed)
        })
    }

    fn read<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object_id: Uuid,
    ) -> BoxFuture<'a, Result<Option<Value>, FieldsError>> {
        Box::pin(async move {
            Ok(project_any(conn, object_id)
                .await
                .map_err(objects_error)?
                .map(|project| project.fields()))
        })
    }
}

/// Обработчик полей `planner.task` для движка синхронизации.
pub struct TaskFieldsHandler;

impl TypeFields for TaskFieldsHandler {
    fn object_type(&self) -> &'static str {
        TASK_TYPE
    }

    fn create<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: Option<&'a Value>,
    ) -> BoxFuture<'a, Result<(), FieldsError>> {
        Box::pin(async move {
            let fields: TaskFields = match fields {
                Some(value) => {
                    serde_json::from_value(value.clone()).map_err(invalid_json("дела"))?
                }
                None => TaskFields::default(),
            };
            if object.title.trim().is_empty() {
                return Err(bad("у дела нужно название"));
            }
            let mut state = TaskState::fresh();
            state.apply(&fields)?;
            write_task(conn, object.id, &state, true).await?;
            if let Some(Some(project)) = fields.project_id {
                set_project(conn, object, Some(project), false).await?;
            }
            if let Some(item) = fields.from_inbox {
                // Своя живая мысль — связываем; иначе дело просто без связи.
                let source = objects::get_any(conn, item).await.map_err(objects_error)?;
                if source.is_some_and(|source| {
                    source.owner_id == object.owner_id && !source.is_deleted()
                }) {
                    relations::link(
                        conn,
                        NewRelation::manual(object.id, item, DERIVED_FROM, object.updated_by),
                    )
                    .await
                    .map_err(objects_error)?;
                }
            }
            if state.status == Status::Done {
                let task = task_any(conn, object.id)
                    .await
                    .map_err(objects_error)?
                    .ok_or_else(|| bad("дело пропало"))?;
                spawn_next(conn, &task).await?;
            }
            remind_later(conn, object.id).await?;
            Ok(())
        })
    }

    fn patch<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: &'a Value,
    ) -> BoxFuture<'a, Result<Vec<String>, FieldsError>> {
        Box::pin(async move {
            let fields: TaskFields =
                serde_json::from_value(fields.clone()).map_err(invalid_json("дела"))?;
            if fields.from_inbox.is_some() {
                return Err(bad("from_inbox ставится только при создании"));
            }
            let current = task_any(conn, object.id)
                .await
                .map_err(objects_error)?
                .ok_or_else(|| bad("дело не найдено"))?;
            let mut state = TaskState::of(&current);
            let mut changed = state.apply(&fields)?;
            if changed.is_empty() {
                return Err(bad("нечего менять"));
            }
            write_task(conn, object.id, &state, false).await?;
            if let Some(project) = fields.project_id {
                set_project(conn, object, project, true).await?;
            }
            if current.status != Status::Done && state.status == Status::Done {
                let task = task_any(conn, object.id)
                    .await
                    .map_err(objects_error)?
                    .ok_or_else(|| bad("дело не найдено"))?;
                if spawn_next(conn, &task).await?.is_some() {
                    changed.push("next_id".to_owned());
                }
            }
            remind_later(conn, object.id).await?;
            Ok(changed)
        })
    }

    fn read<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object_id: Uuid,
    ) -> BoxFuture<'a, Result<Option<Value>, FieldsError>> {
        Box::pin(async move {
            let Some(task) = task_any(conn, object_id).await.map_err(objects_error)? else {
                return Ok(None);
            };
            let defaults = reminder::defaults(conn, task.owner_id).await?;
            Ok(Some(task.fields_with(defaults)))
        })
    }
}

#[cfg(test)]
mod duration_tests {
    use super::*;

    fn fields(value: Value) -> TaskFields {
        serde_json::from_value(value).unwrap()
    }

    #[test]
    fn duration_bounds_source_and_clear() {
        for minutes in [1, 1440] {
            let mut state = TaskState::fresh();
            state
                .apply(&fields(json!({"duration_minutes": minutes})))
                .unwrap();
            assert_eq!(state.duration_minutes, Some(minutes));
            assert_eq!(state.duration_by, Some(DurationBy::Owner));
            let agent = fields(json!({"duration_minutes": minutes, "duration_by": "agent"}));
            // Агент не перетирает длительность человека — проверка в самой записи.
            assert!(state.apply(&agent).is_err());
            assert_eq!(state.duration_by, Some(DurationBy::Owner));
            state
                .apply(&fields(json!({"duration_minutes": null})))
                .unwrap();
            state.apply(&agent).unwrap();
            assert_eq!(state.duration_by, Some(DurationBy::Agent));
            // Человек может перезаписать длительность агента.
            state
                .apply(&fields(json!({"duration_minutes": minutes})))
                .unwrap();
            assert_eq!(state.duration_by, Some(DurationBy::Owner));
            assert!(state.apply(&agent).is_err());
            state
                .apply(&fields(json!({"duration_minutes": null})))
                .unwrap();
            state.apply(&agent).unwrap();
            state
                .apply(&fields(json!({"notes": "другая заметка"})))
                .unwrap();
            assert_eq!(state.duration_minutes, Some(minutes));
            let changed = state
                .apply(&fields(json!({"duration_minutes": null})))
                .unwrap();
            assert_eq!(state.duration_minutes, None);
            assert_eq!(state.duration_by, None);
            assert!(changed.contains(&"duration_by".into()));
        }
        for minutes in [-1, 0, 1441, i32::MAX] {
            assert!(
                TaskState::fresh()
                    .apply(&fields(json!({"duration_minutes": minutes})))
                    .is_err()
            );
        }
        assert!(
            TaskState::fresh()
                .apply(&fields(json!({"duration_by": "agent"})))
                .is_err()
        );
        assert!(
            serde_json::from_value::<TaskFields>(json!({
                "duration_minutes": 10,
                "duration_by": "auto"
            }))
            .is_err()
        );
    }
}
