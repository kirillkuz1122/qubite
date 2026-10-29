//! Календарь: события, сроки дел и читаемое расписание одним запросом.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use qubite_agent::files::{self, SCHEDULE_PATH};
use qubite_planner::{event, millis};
use qubite_policy::{Read, Write};
use serde::{Deserialize, Serialize};
use time::{Date, Duration, PrimitiveDateTime, Time};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::authorize,
};

/// Границы [from, to) в UTC-миллисекундах; не больше 62 суток.
#[derive(Debug, Deserialize, IntoParams)]
pub struct CalendarQuery {
    pub from: i64,
    pub to: i64,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CalendarKind {
    Event,
    Task,
    Lesson,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CalendarItem {
    pub kind: CalendarKind,
    /// ID события, дела или файла «Расписание.md». Повтор узнаётся по starts_at.
    pub source_id: Uuid,
    pub starts_at: i64,
    pub ends_at: i64,
    pub all_day: bool,
    pub title: String,
    pub place: String,
}

/// Тот же Recurrence, что у дел. Weekly: дни 1…7; monthly: число 1…31.
#[derive(Debug, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CalendarRecurrence {
    /// daily, weekly или monthly.
    pub freq: String,
    #[serde(default)]
    #[schema(minimum = 1, maximum = 365, default = 1)]
    pub interval: u16,
    #[serde(default)]
    pub weekdays: Vec<u8>,
    pub month_day: Option<u8>,
}

/// Схема нового события; начало и конец — UTC-миллисекунды.
#[derive(Debug, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CalendarEventCreate {
    pub title: String,
    #[serde(default)]
    pub notes: String,
    pub starts_at: i64,
    pub ends_at: i64,
    #[serde(default)]
    pub all_day: bool,
    #[serde(default)]
    pub place: String,
    pub project_id: Option<Uuid>,
    pub recurrence: Option<CalendarRecurrence>,
}

/// Меняет всю серию. null очищает project_id и recurrence.
#[derive(Debug, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CalendarEventPatch {
    pub title: Option<String>,
    pub notes: Option<String>,
    pub starts_at: Option<i64>,
    pub ends_at: Option<i64>,
    pub all_day: Option<bool>,
    pub place: Option<String>,
    pub project_id: Option<Uuid>,
    pub recurrence: Option<CalendarRecurrence>,
    pub revision: Option<i64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CalendarEvent {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub title: String,
    pub notes: String,
    pub starts_at: i64,
    pub ends_at: i64,
    pub all_day: bool,
    pub place: String,
    pub project_id: Option<Uuid>,
    pub recurrence: Option<CalendarRecurrence>,
    pub revision: i64,
    pub deleted: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

fn planner_error(error: qubite_planner::Error) -> ApiError {
    use qubite_planner::Error as E;
    match error {
        E::NotFound | E::Deleted => ApiError::new(StatusCode::NOT_FOUND, "not_found", "Не найдено"),
        E::Invalid(message) => ApiError::new(StatusCode::BAD_REQUEST, "invalid", message),
        E::Conflict { .. } => ApiError::new(
            StatusCode::CONFLICT,
            "conflict",
            "Событие уже изменили — перечитай",
        ),
        other => {
            tracing::error!(error = %other, "календарь: ошибка");
            ApiError::internal()
        }
    }
}

fn database_error(error: sqlx::Error) -> ApiError {
    tracing::error!(%error, "календарь: ошибка базы");
    ApiError::internal()
}

/// События (включая повторы), дела и уроки, пересекающие окно.
#[utoipa::path(get, path = "/api/calendar", tag = "calendar",
    params(CalendarQuery),
    responses(
        (status = 200, description = "Элементы календаря", body = Vec<CalendarItem>),
        (status = 400, description = "Неверное окно", body = ApiErrorBody),
        (status = 403, description = "Нет права читать Planner", body = ApiErrorBody),
    ))]
pub async fn calendar(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<CalendarQuery>,
) -> Result<Json<Vec<CalendarItem>>, ApiError> {
    authorize::<Read>(&state, &session, qubite_planner::MODULE).await?;
    event::window(query.from, query.to).map_err(planner_error)?;
    let owner = session.0.account_id;
    let mut conn = state.db.pool().acquire().await.map_err(database_error)?;
    let mut items = Vec::new();
    let events = event::in_window(&mut conn, owner, query.from, query.to)
        .await
        .map_err(planner_error)?;
    for value in events {
        for (starts_at, ends_at) in event::occurrences(&mut conn, &value, query.from, query.to)
            .await
            .map_err(planner_error)?
        {
            items.push(CalendarItem {
                kind: CalendarKind::Event,
                source_id: value.id,
                starts_at,
                ends_at,
                all_day: value.all_day,
                title: value.title.clone(),
                place: value.place.clone(),
            });
        }
    }

    // Срок дела — местное время платформы; без времени — целый местный день.
    // Фильтруем в SQL, без лимита list_tasks, чтобы не терять дела в большом списке.
    let tasks: Vec<(Uuid, String, i64, i64, bool)> = sqlx::query_as(
        "WITH zone AS (SELECT coalesce( \
           (SELECT value #>> '{}' FROM platform_settings WHERE key='platform.timezone'), $2) AS tz), \
         due AS (SELECT o.id, o.title, t.due_time IS NULL AS all_day, \
           (t.due_date + coalesce(t.due_time, time '00:00')) AT TIME ZONE zone.tz AS start, \
           CASE WHEN t.due_time IS NULL THEN (t.due_date + 1)::timestamp AT TIME ZONE zone.tz \
             ELSE (t.due_date + t.due_time) AT TIME ZONE zone.tz END AS finish \
           FROM objects o JOIN planner_tasks t ON t.object_id=o.id CROSS JOIN zone \
           WHERE o.owner_id=$1 AND o.deleted_at IS NULL AND t.due_date IS NOT NULL) \
         SELECT id, title, (extract(epoch FROM start)*1000)::bigint, \
           (extract(epoch FROM finish)*1000)::bigint, all_day FROM due \
         WHERE start < $4 AND (finish > $3 OR (finish=start AND start >= $3))",
    )
    .bind(owner)
    .bind(qubite_planner::DEFAULT_TIMEZONE)
    .bind(event::instant(query.from).map_err(planner_error)?)
    .bind(event::instant(query.to).map_err(planner_error)?)
    .fetch_all(&mut *conn)
    .await
    .map_err(database_error)?;
    items.extend(tasks.into_iter().map(
        |(source_id, title, starts_at, ends_at, all_day)| CalendarItem {
            kind: CalendarKind::Task,
            source_id,
            starts_at,
            ends_at,
            all_day,
            title,
            place: String::new(),
        },
    ));

    // Как в странице проекта, скрываем данные агента без права читать модуль.
    if authorize::<Read>(&state, &session, qubite_agent::MODULE)
        .await
        .is_ok()
        && let Some(file) = files::by_path(&mut conn, owner, SCHEDULE_PATH)
            .await
            .map_err(database_error)?
    {
        let slots: Vec<(i16, Time, Time, String, String)> = sqlx::query_as(
            "SELECT weekday, starts_at, ends_at, title, place FROM agent_schedule_slots \
             WHERE account_id=$1 AND file_id=$2 ORDER BY weekday, starts_at, id",
        )
        .bind(owner)
        .bind(file.id)
        .fetch_all(&mut *conn)
        .await
        .map_err(database_error)?;
        let (first, last): (Date, Date) = sqlx::query_as(
            "SELECT ($1::timestamptz AT TIME ZONE coalesce( \
               (SELECT value #>> '{}' FROM platform_settings WHERE key='platform.timezone'), $3))::date, \
             ($2::timestamptz AT TIME ZONE coalesce( \
               (SELECT value #>> '{}' FROM platform_settings WHERE key='platform.timezone'), $3))::date",
        )
        .bind(event::instant(query.from).map_err(planner_error)?)
        .bind(event::instant(query.to).map_err(planner_error)?)
        .bind(qubite_planner::DEFAULT_TIMEZONE)
        .fetch_one(&mut *conn)
        .await
        .map_err(database_error)?;
        let mut date = first;
        loop {
            for (weekday, starts, ends, title, place) in &slots {
                if *weekday != i16::from(date.weekday().number_from_monday()) {
                    continue;
                }
                let starts_at = local_millis(&mut conn, date, *starts).await?;
                let ends_at = local_millis(&mut conn, date, *ends).await?;
                if starts_at < query.to && ends_at > query.from {
                    items.push(CalendarItem {
                        kind: CalendarKind::Lesson,
                        source_id: file.id,
                        starts_at,
                        ends_at,
                        all_day: false,
                        title: title.clone(),
                        place: place.clone(),
                    });
                }
            }
            if date >= last {
                break;
            }
            let Some(next) = date.checked_add(Duration::days(1)) else {
                break;
            };
            date = next;
        }
    }
    items.sort_by_key(|item| (item.starts_at, item.ends_at, item.source_id));
    Ok(Json(items))
}

async fn local_millis(conn: &mut sqlx::PgConnection, date: Date, time: Time) -> Result<i64, ApiError> {
    qubite_planner::reminder::to_instant(conn, PrimitiveDateTime::new(date, time))
        .await
        .map(millis)
        .map_err(database_error)
}

#[utoipa::path(post, path = "/api/calendar/events", tag = "calendar",
    request_body = CalendarEventCreate,
    responses(
        (status = 201, description = "Событие создано", body = CalendarEvent),
        (status = 400, description = "Неверные поля", body = ApiErrorBody),
        (status = 403, description = "Нет права менять Planner", body = ApiErrorBody),
        (status = 404, description = "Проект не найден", body = ApiErrorBody),
    ))]
pub async fn create_event(
    State(state): State<AppState>,
    session: Authenticated,
    Json(input): Json<event::NewEvent>,
) -> Result<(StatusCode, Json<event::Event>), ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    let mut conn = state.db.pool().acquire().await.map_err(database_error)?;
    let value = event::create(&mut conn, session.0.account_id, input)
        .await
        .map_err(planner_error)?;
    Ok((StatusCode::CREATED, Json(value)))
}

#[utoipa::path(patch, path = "/api/calendar/events/{id}", tag = "calendar",
    params(("id" = Uuid, Path, description = "ID события")),
    request_body = CalendarEventPatch,
    responses(
        (status = 200, description = "Событие изменено", body = CalendarEvent),
        (status = 400, description = "Неверные поля", body = ApiErrorBody),
        (status = 403, description = "Нет права менять Planner", body = ApiErrorBody),
        (status = 404, description = "Событие или проект не найдены", body = ApiErrorBody),
        (status = 409, description = "Конфликт версии", body = ApiErrorBody),
    ))]
pub async fn patch_event(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(input): Json<event::EventPatch>,
) -> Result<Json<event::Event>, ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    let mut conn = state.db.pool().acquire().await.map_err(database_error)?;
    event::patch(&mut conn, session.0.account_id, id, input)
        .await
        .map(Json)
        .map_err(planner_error)
}

#[utoipa::path(delete, path = "/api/calendar/events/{id}", tag = "calendar",
    params(("id" = Uuid, Path, description = "ID события")),
    responses(
        (status = 204, description = "Событие удалено"),
        (status = 403, description = "Нет права менять Planner", body = ApiErrorBody),
        (status = 404, description = "Событие не найдено", body = ApiErrorBody),
    ))]
pub async fn delete_event(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    let mut conn = state.db.pool().acquire().await.map_err(database_error)?;
    event::delete(&mut conn, session.0.account_id, id)
        .await
        .map_err(planner_error)?;
    Ok(StatusCode::NO_CONTENT)
}
