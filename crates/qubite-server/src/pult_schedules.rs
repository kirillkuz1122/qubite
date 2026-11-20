//! AOS-4: расписание, учёт запусков и потолки за последние 168 часов (D-1090…D-1092).

use axum::{
    Json,
    body::Bytes,
    extract::{FromRequestParts, Path, State},
    http::{HeaderMap, StatusCode, request::Parts},
};
use qubite_objects::{NewAuditEntry, audit};
use serde::{Deserialize, Deserializer, Serialize};
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::Owner,
    pult,
};

pub struct ScheduleOwner(Owner);

impl FromRequestParts<AppState> for ScheduleOwner {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        // Без входа — как у остальных закрытых маршрутов (политика: «нет такой страницы»);
        // вошедшему не владельцу честно отвечаем 403.
        let signed_in = parts.extensions.get::<Authenticated>().is_some();
        Owner::from_request_parts(parts, state)
            .await
            .map(Self)
            .map_err(|error| {
                if signed_in && error.status == StatusCode::NOT_FOUND {
                    ApiError::new(StatusCode::FORBIDDEN, "owner_only", "Только для владельца")
                } else {
                    error
                }
            })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum ScheduleKind {
    Active,
    Quiet,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum SchedulePlace {
    Pi,
    Cloud,
    Ci,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum ScheduleOutcome {
    Found,
    Quiet,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum ScheduleCap {
    Ok,
    Warn,
    Reached,
}

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct PultSchedule {
    id: Uuid,
    name: String,
    kind: ScheduleKind,
    schedule_text: String,
    /// Понедельник = 0, воскресенье = 6.
    days: Vec<i16>,
    where_run: SchedulePlace,
    model: Option<String>,
    cap_tokens: Option<i64>,
    cap_usd: Option<f64>,
    enabled: bool,
    paused_reason: Option<String>,
    tokens_7d: f64,
    usd_7d: f64,
    cap_percent: Option<f64>,
    cap_status: ScheduleCap,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    last_at: Option<OffsetDateTime>,
    last_outcome: Option<ScheduleOutcome>,
    last_note: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PultSchedules {
    schedules: Vec<PultSchedule>,
    million_tokens_7d: f64,
    usd_7d: f64,
    active: u32,
    quiet: u32,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct NewSchedule {
    name: String,
    kind: ScheduleKind,
    schedule_text: String,
    days: Vec<i16>,
    where_run: SchedulePlace,
    model: Option<String>,
    cap_tokens: Option<i64>,
    cap_usd: Option<f64>,
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SchedulePatch {
    name: Option<String>,
    #[serde(default, deserialize_with = "present_cap")]
    #[schema(value_type = Option<i64>)]
    cap_tokens: Option<Option<i64>>,
    #[serde(default, deserialize_with = "present_cap")]
    #[schema(value_type = Option<f64>)]
    cap_usd: Option<Option<f64>>,
    enabled: Option<bool>,
}

// Пропуск поля оставляет потолок, явный null снимает его.
fn present_cap<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(deserializer).map(Some)
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ScheduleRun {
    /// ID задачи из `due` — надёжнее имени: задачу могут переименовать между запросами.
    schedule_id: Option<Uuid>,
    /// Имя задачи из расписания (если ID не передан).
    name: Option<String>,
    /// Повтор запроса с тем же ID не добавляет расход второй раз.
    id: Option<Uuid>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    at: Option<OffsetDateTime>,
    tokens: i64,
    usd: f64,
    outcome: ScheduleOutcome,
    note: Option<String>,
}

fn invalid(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "invalid_schedule", message)
}

fn missing() -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "schedule_not_found",
        "Такой задачи нет",
    )
}

fn write_error(error: sqlx::Error) -> ApiError {
    if error
        .as_database_error()
        .is_some_and(|e| e.is_unique_violation())
    {
        ApiError::new(
            StatusCode::CONFLICT,
            "schedule_name_taken",
            "Задача с таким именем уже существует",
        )
    } else {
        pult::db(error)
    }
}

fn field<'a>(value: &'a str, max: usize, message: &str) -> Result<&'a str, ApiError> {
    let value = value.trim();
    if value.is_empty() || value.chars().count() > max {
        return Err(invalid(message));
    }
    Ok(value)
}

fn caps(tokens: Option<i64>, usd: Option<f64>) -> Result<Option<String>, ApiError> {
    if tokens.is_some_and(|n| n <= 0) || usd.is_some_and(|n| !valid_usd(n) || n <= 0.0) {
        return Err(invalid(
            "Укажите положительный потолок или оставьте поле пустым",
        ));
    }
    Ok(usd.map(|n| n.to_string()))
}

fn valid_usd(value: f64) -> bool {
    (0.0..=1_000_000_000_000.0).contains(&value)
}

// Пороги сравниваем в numeric, без округления числа для показа.
const SCHEDULES: &str = "
    SELECT s.id, s.name, s.kind, s.schedule_text, s.days, s.where_run, s.model,
           s.cap_tokens, s.cap_usd::float8 AS cap_usd, s.enabled, s.paused_reason,
           usage.tokens::float8 AS tokens_7d, usage.usd::float8 AS usd_7d,
           CASE WHEN s.cap_tokens IS NOT NULL OR s.cap_usd IS NOT NULL THEN
               LEAST(GREATEST(100 * usage.tokens / s.cap_tokens, 100 * usage.usd / s.cap_usd),
                     1e300::numeric)::float8
           END AS cap_percent,
           CASE
               WHEN usage.tokens >= s.cap_tokens OR usage.usd >= s.cap_usd THEN 'reached'
               WHEN usage.tokens * 5 >= s.cap_tokens::numeric * 4
                 OR usage.usd * 5 >= s.cap_usd * 4 THEN 'warn'
               ELSE 'ok'
           END AS cap_status,
           last.at AS last_at, last.outcome AS last_outcome, last.note AS last_note
    FROM pult_schedules s
    CROSS JOIN LATERAL (
        SELECT COALESCE(sum(tokens), 0) AS tokens, COALESCE(sum(usd), 0) AS usd
        FROM pult_schedule_runs
        WHERE schedule_id = s.id
          AND at > statement_timestamp() - interval '168 hours'
          AND at <= statement_timestamp()
    ) usage
    LEFT JOIN LATERAL (
        SELECT at, outcome, note FROM pult_schedule_runs
        WHERE schedule_id = s.id ORDER BY at DESC, id DESC LIMIT 1
    ) last ON true
    WHERE ($1::uuid IS NULL OR s.id = $1)
      AND (NOT $2 OR (s.enabled AND s.paused_reason IS NULL))
    ORDER BY s.name, s.id";

async fn read_one(conn: &mut PgConnection, id: Uuid) -> Result<PultSchedule, ApiError> {
    sqlx::query_as(SCHEDULES)
        .bind(id)
        .bind(false)
        .fetch_one(conn)
        .await
        .map_err(pult::db)
}

#[derive(sqlx::FromRow)]
pub(crate) struct PausedSchedule {
    pub id: Uuid,
    pub name: String,
    pub updated_at: OffsetDateTime,
}

pub(crate) async fn paused(pool: &PgPool) -> Result<Vec<PausedSchedule>, ApiError> {
    sqlx::query_as(
        "SELECT id, name, updated_at FROM pult_schedules WHERE paused_reason = 'cap'
         ORDER BY updated_at DESC, id",
    )
    .fetch_all(pool)
    .await
    .map_err(pult::db)
}

async fn audit_owner(
    conn: &mut PgConnection,
    owner: Option<&ScheduleOwner>,
    action: &str,
    id: Uuid,
    after: serde_json::Value,
) -> Result<(), ApiError> {
    audit::record(
        conn,
        NewAuditEntry {
            actor_id: owner.map(|ScheduleOwner(Owner(owner))| owner.account_id()),
            action: action.into(),
            target_kind: "pult_schedule".into(),
            target_id: Some(id.to_string()),
            after: Some(after),
            ..NewAuditEntry::default()
        },
    )
    .await
    .map(drop)
    .map_err(|e| ApiError::from(qubite_auth::Error::Audit(e)))
}

async fn pause_if_reached(
    conn: &mut PgConnection,
    schedule: &mut PultSchedule,
    owner: Option<&ScheduleOwner>,
) -> Result<(), ApiError> {
    if schedule.cap_status == ScheduleCap::Reached && schedule.paused_reason.is_none() {
        sqlx::query(
            "UPDATE pult_schedules SET enabled = false, paused_reason = 'cap',
             updated_at = clock_timestamp() WHERE id = $1",
        )
        .bind(schedule.id)
        .execute(&mut *conn)
        .await
        .map_err(pult::db)?;
        schedule.enabled = false;
        schedule.paused_reason = Some("cap".into());
        audit_owner(
            conn,
            owner,
            "pult.schedule_paused",
            schedule.id,
            serde_json::json!({ "name": schedule.name, "reason": "cap" }),
        )
        .await?;
    }
    Ok(())
}

#[utoipa::path(get, path = "/api/pult/schedules", tag = "pult",
    responses(
        (status = 200, description = "Расписание и расход за 7 дней", body = PultSchedules),
        (status = 403, description = "Только для владельца", body = ApiErrorBody)
    ))]
pub async fn list_schedules(
    State(state): State<AppState>,
    _owner: ScheduleOwner,
) -> Result<Json<PultSchedules>, ApiError> {
    let schedules: Vec<PultSchedule> = sqlx::query_as(SCHEDULES)
        .bind(None::<Uuid>)
        .bind(false)
        .fetch_all(state.db.pool())
        .await
        .map_err(pult::db)?;
    Ok(Json(PultSchedules {
        million_tokens_7d: schedules.iter().map(|s| s.tokens_7d).sum::<f64>() / 1_000_000.0,
        usd_7d: schedules.iter().map(|s| s.usd_7d).sum(),
        active: schedules
            .iter()
            .filter(|s| s.kind == ScheduleKind::Active)
            .count() as u32,
        quiet: schedules
            .iter()
            .filter(|s| s.kind == ScheduleKind::Quiet)
            .count() as u32,
        schedules,
    }))
}

/// Список разрешённых задач. Время запуска выбирает раннер.
#[utoipa::path(get, path = "/api/pult/schedules/due", tag = "pult",
    responses(
        (status = 200, description = "Задачи, разрешённые к запуску", body = Vec<PultSchedule>),
        (status = 403, description = "Только для владельца", body = ApiErrorBody)
    ))]
pub async fn due_schedules(
    State(state): State<AppState>,
    _owner: ScheduleOwner,
) -> Result<Json<Vec<PultSchedule>>, ApiError> {
    sqlx::query_as(SCHEDULES)
        .bind(None::<Uuid>)
        .bind(true)
        .fetch_all(state.db.pool())
        .await
        .map(Json)
        .map_err(pult::db)
}

#[utoipa::path(post, path = "/api/pult/schedules", tag = "pult",
    request_body = NewSchedule,
    responses(
        (status = 201, description = "Задача создана", body = PultSchedule),
        (status = 400, description = "Некорректные поля", body = ApiErrorBody),
        (status = 403, description = "Только для владельца", body = ApiErrorBody),
        (status = 409, description = "Имя уже занято", body = ApiErrorBody)
    ))]
pub async fn create_schedule(
    State(state): State<AppState>,
    owner: ScheduleOwner,
    Json(mut body): Json<NewSchedule>,
) -> Result<(StatusCode, Json<PultSchedule>), ApiError> {
    let name = field(&body.name, 60, "Имя — от 1 до 60 знаков")?;
    let schedule_text = field(&body.schedule_text, 120, "Расписание — от 1 до 120 знаков")?;
    let model = body
        .model
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if model.is_some_and(|s| s.chars().count() > 80) {
        return Err(invalid("Модель — до 80 знаков"));
    }
    if body.days.is_empty() || body.days.iter().any(|d| !(0..=6).contains(d)) {
        return Err(invalid("Укажите дни недели от 0 до 6"));
    }
    body.days.sort_unstable();
    body.days.dedup();
    let usd = caps(body.cap_tokens, body.cap_usd)?;
    let id = Uuid::now_v7();
    let mut tx = state.db.pool().begin().await.map_err(pult::db)?;
    sqlx::query(
        "INSERT INTO pult_schedules
         (id, name, kind, schedule_text, days, where_run, model, cap_tokens, cap_usd)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::numeric)",
    )
    .bind(id)
    .bind(name)
    .bind(body.kind)
    .bind(schedule_text)
    .bind(&body.days)
    .bind(body.where_run)
    .bind(model)
    .bind(body.cap_tokens)
    .bind(usd)
    .execute(&mut *tx)
    .await
    .map_err(write_error)?;
    let schedule = read_one(&mut tx, id).await?;
    audit_owner(
        &mut tx,
        Some(&owner),
        "pult.schedule_created",
        id,
        serde_json::json!(schedule),
    )
    .await?;
    tx.commit().await.map_err(pult::db)?;
    Ok((StatusCode::CREATED, Json(schedule)))
}

#[utoipa::path(patch, path = "/api/pult/schedules/{id}", tag = "pult",
    params(("id" = Uuid, Path, description = "Задача")),
    request_body = SchedulePatch,
    responses(
        (status = 200, description = "Задача обновлена", body = PultSchedule),
        (status = 400, description = "Некорректные поля", body = ApiErrorBody),
        (status = 403, description = "Только для владельца", body = ApiErrorBody),
        (status = 404, description = "Задачи нет", body = ApiErrorBody),
        (status = 409, description = "Потолок достигнут или имя уже занято", body = ApiErrorBody)
    ))]
pub async fn patch_schedule(
    State(state): State<AppState>,
    owner: ScheduleOwner,
    Path(id): Path<Uuid>,
    Json(body): Json<SchedulePatch>,
) -> Result<Json<PultSchedule>, ApiError> {
    let name = body
        .name
        .as_deref()
        .map(|s| field(s, 60, "Имя — от 1 до 60 знаков"))
        .transpose()?;
    let usd = caps(body.cap_tokens.flatten(), body.cap_usd.flatten())?;
    let mut tx = state.db.pool().begin().await.map_err(pult::db)?;
    // UPDATE берёт ту же блокировку строки, что и приём отчёта.
    let updated = sqlx::query(
        "UPDATE pult_schedules SET name = COALESCE($2, name),
         cap_tokens = CASE WHEN $3 THEN $4 ELSE cap_tokens END,
         cap_usd = CASE WHEN $5 THEN $6::text::numeric ELSE cap_usd END,
         enabled = COALESCE($7, enabled),
         paused_reason = CASE WHEN $7 THEN NULL ELSE paused_reason END,
         updated_at = clock_timestamp() WHERE id = $1",
    )
    .bind(id)
    .bind(name)
    .bind(body.cap_tokens.is_some())
    .bind(body.cap_tokens.flatten())
    .bind(body.cap_usd.is_some())
    .bind(usd)
    .bind(body.enabled)
    .execute(&mut *tx)
    .await
    .map_err(write_error)?;
    if updated.rows_affected() == 0 {
        return Err(missing());
    }
    let mut schedule = read_one(&mut tx, id).await?;
    if body.enabled == Some(true) && schedule.cap_status == ScheduleCap::Reached {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "schedule_cap_reached",
            "Подними потолок, чтобы включить задачу",
        ));
    }
    pause_if_reached(&mut tx, &mut schedule, Some(&owner)).await?;
    audit_owner(
        &mut tx,
        Some(&owner),
        "pult.schedule_updated",
        id,
        serde_json::json!(schedule),
    )
    .await?;
    tx.commit().await.map_err(pult::db)?;
    Ok(Json(schedule))
}

#[utoipa::path(delete, path = "/api/pult/schedules/{id}", tag = "pult",
    params(("id" = Uuid, Path, description = "Задача")),
    responses(
        (status = 204, description = "Задача удалена"),
        (status = 403, description = "Только для владельца", body = ApiErrorBody),
        (status = 404, description = "Задачи нет", body = ApiErrorBody)
    ))]
pub async fn delete_schedule(
    State(state): State<AppState>,
    owner: ScheduleOwner,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let mut tx = state.db.pool().begin().await.map_err(pult::db)?;
    let name: String =
        sqlx::query_scalar("DELETE FROM pult_schedules WHERE id = $1 RETURNING name")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(pult::db)?
            .ok_or_else(missing)?;
    audit_owner(
        &mut tx,
        Some(&owner),
        "pult.schedule_deleted",
        id,
        serde_json::json!({ "name": name }),
    )
    .await?;
    tx.commit().await.map_err(pult::db)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Принять отчёт владельца или сборщика, в том числе о запуске задачи на паузе.
#[utoipa::path(post, path = "/api/pult/schedules/runs", tag = "pult",
    request_body = ScheduleRun,
    responses(
        (status = 204, description = "Запуск учтён"),
        (status = 400, description = "Некорректный отчёт", body = ApiErrorBody),
        (status = 401, description = "Токен сборщика не подошёл", body = ApiErrorBody),
        (status = 403, description = "Только для владельца или сборщика", body = ApiErrorBody),
        (status = 404, description = "Задачи нет", body = ApiErrorBody),
        (status = 409, description = "ID уже использован другой задачей", body = ApiErrorBody)
    ))]
pub async fn record_schedule_run(
    State(state): State<AppState>,
    owner: Result<ScheduleOwner, ApiError>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    let token = pult::collector_token(&headers);
    let owner = match token {
        Some(_) => None,
        None => Some(owner?),
    };
    let mut tx = state.db.pool().begin().await.map_err(pult::db)?;
    let collector = match token {
        Some(token) => Some(pult::authenticate_collector(&mut tx, token).await?),
        None => None,
    };
    let body: ScheduleRun =
        serde_json::from_slice(&body).map_err(|_| invalid("Отчёт не подходит"))?;
    if body.tokens < 0 || !valid_usd(body.usd) {
        return Err(invalid("Укажите неотрицательный расход"));
    }
    if body.note.as_ref().is_some_and(|s| s.chars().count() > 200) {
        return Err(invalid("Заметка — до 200 знаков"));
    }
    let schedule_id: Uuid = match (body.schedule_id, body.name.as_deref()) {
        (Some(id), _) => {
            sqlx::query_scalar("SELECT id FROM pult_schedules WHERE id = $1 FOR UPDATE")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await
        }
        (None, Some(name)) => {
            let name = field(name, 60, "Имя — от 1 до 60 знаков")?;
            sqlx::query_scalar("SELECT id FROM pult_schedules WHERE name = $1 FOR UPDATE")
                .bind(name)
                .fetch_optional(&mut *tx)
                .await
        }
        (None, None) => return Err(invalid("Укажите schedule_id или имя задачи")),
    }
    .map_err(pult::db)?
    .ok_or_else(missing)?;
    let now: OffsetDateTime = sqlx::query_scalar("SELECT clock_timestamp()")
        .fetch_one(&mut *tx)
        .await
        .map_err(pult::db)?;
    let at = body.at.unwrap_or(now);
    if at > now {
        return Err(invalid("Запуск ещё не наступил"));
    }
    let run_id = body.id.unwrap_or_else(Uuid::now_v7);
    // Даже «молчит, всё хорошо» хранится для расхода и времени последнего запуска.
    let inserted = sqlx::query(
        "INSERT INTO pult_schedule_runs (id, schedule_id, at, tokens, usd, outcome, note)
         VALUES ($1, $2, $3, $4, $5::text::numeric, $6, $7) ON CONFLICT (id) DO NOTHING",
    )
    .bind(run_id)
    .bind(schedule_id)
    .bind(at)
    .bind(body.tokens)
    .bind(body.usd.to_string())
    .bind(body.outcome)
    .bind(&body.note)
    .execute(&mut *tx)
    .await
    .map_err(pult::db)?;
    if inserted.rows_affected() == 0 {
        let previous: Option<Uuid> =
            sqlx::query_scalar("SELECT schedule_id FROM pult_schedule_runs WHERE id = $1")
                .bind(run_id)
                .fetch_optional(&mut *tx)
                .await
                .map_err(pult::db)?;
        if previous != Some(schedule_id) {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "schedule_run_id_taken",
                "Этот отчёт уже относится к другой задаче",
            ));
        }
    } else {
        let mut schedule = read_one(&mut tx, schedule_id).await?;
        pause_if_reached(&mut tx, &mut schedule, owner.as_ref()).await?;
        if schedule.kind != ScheduleKind::Quiet || body.outcome != ScheduleOutcome::Quiet {
            audit_owner(
                &mut tx,
                owner.as_ref(),
                "pult.schedule_run",
                schedule_id,
                serde_json::json!({
                    "run_id": run_id,
                    "collector_id": collector,
                    "outcome": body.outcome
                }),
            )
            .await?;
        }
    }
    tx.commit().await.map_err(pult::db)?;
    Ok(StatusCode::NO_CONTENT)
}
