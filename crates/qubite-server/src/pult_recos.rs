//! AOS-5d: пятничные предложения и корзина владельца (D-1093…D-1095).

use std::{collections::HashSet, fmt::Write};

use axum::{
    Json,
    body::Bytes,
    extract::{FromRequestParts, Path, Query, State},
    http::{StatusCode, request::Parts},
};
use qubite_objects::{NewAuditEntry, audit};
use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use time::{Date, OffsetDateTime, Weekday};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::Owner,
    pult::{self, RecoWeekResponse},
};

pub struct RecoOwner(Owner);

impl FromRequestParts<AppState> for RecoOwner {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
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

pub struct RecoCollector;

impl FromRequestParts<AppState> for RecoCollector {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let Some(token) = pult::collector_token(&parts.headers) else {
            RecoOwner::from_request_parts(parts, state).await?;
            return Err(ApiError::new(
                StatusCode::FORBIDDEN,
                "collector_required",
                "Нужен токен сборщика",
            ));
        };
        let mut conn = state.db.pool().acquire().await.map_err(pult::db)?;
        pult::authenticate_collector(&mut conn, token).await?;
        Ok(Self)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum RecoArms {
    Apps,
    Routines,
    Memory,
    Skills,
    Jokers,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema, sqlx::Type)]
#[sqlx(type_name = "text")]
pub enum RecoEffort {
    S,
    M,
    L,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum RecoStatus {
    New,
    Basket,
    No,
    Later,
    Applied,
}

#[derive(Debug, Clone, Copy, Deserialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum RecoDecision {
    New,
    Basket,
    No,
    Later,
}

#[derive(Deserialize, ToSchema)]
pub struct RecoPatch {
    status: RecoDecision,
}

#[derive(Deserialize, ToSchema)]
pub struct RecoInput {
    #[serde(rename = "ref")]
    reference: String,
    arms: RecoArms,
    title: String,
    noticed: String,
    will_do: String,
    effort: RecoEffort,
    saving: Option<String>,
    files: Vec<String>,
    joker: bool,
}

#[derive(Deserialize, ToSchema)]
pub struct RecoReport {
    week: String,
    cards: Vec<RecoInput>,
}

#[derive(Serialize, ToSchema, sqlx::FromRow)]
pub struct RecoCard {
    id: Uuid,
    week: String,
    #[serde(rename = "ref")]
    #[sqlx(rename = "ref")]
    reference: String,
    arms: RecoArms,
    title: String,
    noticed: String,
    will_do: String,
    effort: RecoEffort,
    saving: Option<String>,
    files: Vec<String>,
    joker: bool,
    status: RecoStatus,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    updated_at: OffsetDateTime,
}

#[derive(Default, Serialize, ToSchema)]
pub struct RecoCounts {
    all: u32,
    apps: u32,
    routines: u32,
    memory: u32,
    skills: u32,
    jokers: u32,
}

#[derive(Serialize, ToSchema)]
pub struct PultRecos {
    week: Option<String>,
    cards: Vec<RecoCard>,
    counts: RecoCounts,
    older_basket: Vec<RecoCard>,
    basket_count: u32,
    basket_saving: Option<String>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, ToSchema, sqlx::Type)]
#[serde(rename_all = "snake_case")]
#[sqlx(type_name = "text", rename_all = "snake_case")]
pub enum RecoBatchStatus {
    Queued,
    Taken,
}

#[derive(Serialize, ToSchema, sqlx::FromRow)]
pub struct RecoBatch {
    id: Uuid,
    brief: String,
    card_ids: Vec<Uuid>,
    status: RecoBatchStatus,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    taken_at: Option<OffsetDateTime>,
}

#[derive(Deserialize)]
pub struct RecoBatchFilter {
    status: Option<RecoBatchStatus>,
}

fn invalid(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "invalid_recos", message)
}

fn missing(message: &str) -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "reco_not_found", message)
}

fn conflict(code: &'static str, message: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, message)
}

fn valid_week(week: &str) -> bool {
    let bytes = week.as_bytes();
    if bytes.len() != 8
        || &bytes[4..6] != b"-W"
        || !bytes[..4].iter().chain(&bytes[6..]).all(u8::is_ascii_digit)
    {
        return false;
    }
    let year = week[..4].parse().unwrap_or_default();
    let number = week[6..].parse().unwrap_or_default();
    year > 0 && Date::from_iso_week_date(year, number, Weekday::Monday).is_ok()
}

fn valid_text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && !value.contains('\0') && value.chars().count() <= limit
}

fn validate_report(report: &RecoReport) -> Result<(), ApiError> {
    // Пустой отчёт не запоминает неделю, поэтому его не принимаем: от 1 до 10 карточек.
    if !valid_week(&report.week) || report.cards.is_empty() || report.cards.len() > 10 {
        return Err(invalid("Нужна ISO-неделя и от 1 до 10 карточек"));
    }
    let mut refs = HashSet::new();
    for card in &report.cards {
        if !valid_text(&card.reference, 128)
            || !refs.insert(card.reference.as_str())
            || !valid_text(&card.title, 80)
            || !valid_text(&card.noticed, 300)
            || !valid_text(&card.will_do, 300)
            || card
                .saving
                .as_ref()
                .is_some_and(|s| s.contains('\0') || s.chars().count() > 80)
            || card.files.len() > 8
            || card
                .files
                .iter()
                .any(|path| path.trim().is_empty() || path.contains('\0'))
            || card.joker != (card.arms == RecoArms::Jokers)
        {
            return Err(invalid(
                "Проверьте поля карточек, разделы джокеров и уникальность ref",
            ));
        }
    }
    Ok(())
}

async fn audit_owner(
    conn: &mut PgConnection,
    RecoOwner(Owner(owner)): &RecoOwner,
    action: &str,
    target: &str,
    id: Uuid,
    after: serde_json::Value,
) -> Result<(), ApiError> {
    audit::record(
        conn,
        NewAuditEntry {
            actor_id: Some(owner.account_id()),
            action: action.into(),
            target_kind: target.into(),
            target_id: Some(id.to_string()),
            after: Some(after),
            ..NewAuditEntry::default()
        },
    )
    .await
    .map(drop)
    .map_err(|e| ApiError::from(qubite_auth::Error::Audit(e)))
}

#[utoipa::path(post, path = "/api/pult/recos/report", tag = "pult",
    request_body = RecoReport,
    responses(
        (status = 204, description = "Карточки приняты"),
        (status = 400, description = "Некорректный отчёт", body = ApiErrorBody),
        (status = 401, description = "Токен сборщика не подошёл", body = ApiErrorBody),
        (status = 403, description = "Нужен токен сборщика", body = ApiErrorBody),
        (status = 404, description = "Нет входа", body = ApiErrorBody)
    ))]
pub async fn report_recos(
    State(state): State<AppState>,
    _collector: RecoCollector,
    body: Bytes,
) -> Result<StatusCode, ApiError> {
    let report: RecoReport =
        serde_json::from_slice(&body).map_err(|_| invalid("Отчёт не подходит"))?;
    validate_report(&report)?;
    let mut tx = state.db.pool().begin().await.map_err(pult::db)?;
    // Два отчёта не могут перемешаться. Решения владельца тоже ждут окончания замены.
    sqlx::query("LOCK TABLE pult_recos IN SHARE ROW EXCLUSIVE MODE")
        .execute(&mut *tx)
        .await
        .map_err(pult::db)?;
    sqlx::query("DELETE FROM pult_recos WHERE week = $1 AND status = 'new'")
        .bind(&report.week)
        .execute(&mut *tx)
        .await
        .map_err(pult::db)?;
    for card in &report.cards {
        sqlx::query(
            "INSERT INTO pult_recos
             (id, week, ref, arms, title, noticed, will_do, effort, saving, files, joker)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
             ON CONFLICT (week, ref) DO NOTHING",
        )
        .bind(Uuid::now_v7())
        .bind(&report.week)
        .bind(&card.reference)
        .bind(card.arms)
        .bind(&card.title)
        .bind(&card.noticed)
        .bind(&card.will_do)
        .bind(card.effort)
        .bind(&card.saving)
        .bind(&card.files)
        .bind(card.joker)
        .execute(&mut *tx)
        .await
        .map_err(pult::db)?;
    }
    tx.commit().await.map_err(pult::db)?;
    Ok(StatusCode::NO_CONTENT)
}

#[utoipa::path(get, path = "/api/pult/recos", tag = "pult",
    responses(
        (status = 200, description = "Карточки и корзина", body = PultRecos),
        (status = 403, description = "Только для владельца", body = ApiErrorBody),
        (status = 404, description = "Нет входа", body = ApiErrorBody)
    ))]
pub async fn list_recos(
    State(state): State<AppState>,
    _owner: RecoOwner,
) -> Result<Json<PultRecos>, ApiError> {
    let rows: Vec<RecoCard> = sqlx::query_as(
        "SELECT * FROM pult_recos
         WHERE week = (SELECT max(week) FROM pult_recos) OR status = 'basket'
         ORDER BY week DESC, created_at, id",
    )
    .fetch_all(state.db.pool())
    .await
    .map_err(pult::db)?;
    let week = rows.first().map(|card| card.week.clone());
    let (cards, older_basket): (Vec<_>, Vec<_>) = rows
        .into_iter()
        .partition(|card| Some(&card.week) == week.as_ref());
    let mut counts = RecoCounts::default();
    for card in &cards {
        counts.all += 1;
        match card.arms {
            RecoArms::Apps => counts.apps += 1,
            RecoArms::Routines => counts.routines += 1,
            RecoArms::Memory => counts.memory += 1,
            RecoArms::Skills => counts.skills += 1,
            RecoArms::Jokers => counts.jokers += 1,
        }
    }
    let mut basket_count = 0;
    let mut savings = Vec::new();
    for card in cards
        .iter()
        .chain(&older_basket)
        .filter(|card| card.status == RecoStatus::Basket)
    {
        basket_count += 1;
        if let Some(saving) = card.saving.as_deref().filter(|s| !s.trim().is_empty()) {
            savings.push(saving);
        }
    }
    let basket_saving = (!savings.is_empty()).then(|| savings.join(" · "));
    Ok(Json(PultRecos {
        week,
        cards,
        counts,
        older_basket,
        basket_count,
        basket_saving,
    }))
}

#[utoipa::path(patch, path = "/api/pult/recos/{id}", tag = "pult",
    params(("id" = Uuid, Path, description = "Карточка")),
    request_body = RecoPatch,
    responses(
        (status = 200, description = "Решение сохранено", body = RecoCard),
        (status = 403, description = "Только для владельца", body = ApiErrorBody),
        (status = 404, description = "Карточки нет или нет входа", body = ApiErrorBody),
        (status = 409, description = "Карточка уже в задании", body = ApiErrorBody)
    ))]
pub async fn patch_reco(
    State(state): State<AppState>,
    owner: RecoOwner,
    Path(id): Path<Uuid>,
    Json(body): Json<RecoPatch>,
) -> Result<Json<RecoCard>, ApiError> {
    let mut tx = state.db.pool().begin().await.map_err(pult::db)?;
    let updated: Option<RecoCard> = sqlx::query_as(
        "UPDATE pult_recos SET status = $2, updated_at = now()
         WHERE id = $1 AND status <> 'applied' RETURNING *",
    )
    .bind(id)
    .bind(body.status)
    .fetch_optional(&mut *tx)
    .await
    .map_err(pult::db)?;
    let Some(card) = updated else {
        let exists: bool =
            sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pult_recos WHERE id = $1)")
                .bind(id)
                .fetch_one(&mut *tx)
                .await
                .map_err(pult::db)?;
        return Err(if exists {
            conflict("reco_applied", "Карточка уже в задании")
        } else {
            missing("Карточки нет")
        });
    };
    audit_owner(
        &mut tx,
        &owner,
        "pult.reco_decided",
        "pult_reco",
        id,
        serde_json::json!({ "status": card.status }),
    )
    .await?;
    tx.commit().await.map_err(pult::db)?;
    Ok(Json(card))
}

fn brief(cards: &[RecoCard]) -> String {
    let mut brief = String::from(
        "# Применить выбранные Recos\n\nОдна сессия делает всё из этого задания и открывает один PR. \
         Вливает владелец.\n",
    );
    for (index, card) in cards.iter().enumerate() {
        let title = card.title.split_whitespace().collect::<Vec<_>>().join(" ");
        let _ = writeln!(
            brief,
            "\n## {}. {} ({}, {})\n\nЧто заметил: {}\n\nЧто сделаю: {}\n\nУсилие: {:?}",
            index + 1,
            title,
            card.week,
            card.reference,
            card.noticed,
            card.will_do,
            card.effort
        );
        if let Some(saving) = &card.saving {
            let _ = writeln!(brief, "\nЭкономия: {saving}");
        }
        if !card.files.is_empty() {
            brief.push_str("\nТронет файлы:\n");
            for file in &card.files {
                let _ = writeln!(brief, "- {file}");
            }
        }
    }
    brief
}

#[utoipa::path(post, path = "/api/pult/recos/apply", tag = "pult",
    responses(
        (status = 201, description = "Задание в очереди", body = RecoBatch),
        (status = 403, description = "Только для владельца", body = ApiErrorBody),
        (status = 404, description = "Нет входа", body = ApiErrorBody),
        (status = 409, description = "Корзина пуста", body = ApiErrorBody)
    ))]
pub async fn apply_recos(
    State(state): State<AppState>,
    owner: RecoOwner,
) -> Result<(StatusCode, Json<RecoBatch>), ApiError> {
    let mut tx = state.db.pool().begin().await.map_err(pult::db)?;
    // Обновление, запись задания и аудит проходят в одной транзакции.
    let mut cards: Vec<RecoCard> = sqlx::query_as(
        "UPDATE pult_recos SET status = 'applied', updated_at = now()
         WHERE status = 'basket' RETURNING *",
    )
    .fetch_all(&mut *tx)
    .await
    .map_err(pult::db)?;
    if cards.is_empty() {
        return Err(conflict("reco_basket_empty", "Корзина пуста"));
    }
    cards.sort_unstable_by_key(|card| (card.created_at, card.id));
    let card_ids: Vec<Uuid> = cards.iter().map(|card| card.id).collect();
    let batch: RecoBatch = sqlx::query_as(
        "INSERT INTO pult_reco_batches (id, brief, card_ids) VALUES ($1, $2, $3) RETURNING *",
    )
    .bind(Uuid::now_v7())
    .bind(brief(&cards))
    .bind(card_ids)
    .fetch_one(&mut *tx)
    .await
    .map_err(pult::db)?;
    audit_owner(
        &mut tx,
        &owner,
        "pult.reco_applied",
        "pult_reco_batch",
        batch.id,
        serde_json::json!({ "card_ids": batch.card_ids }),
    )
    .await?;
    tx.commit().await.map_err(pult::db)?;
    Ok((StatusCode::CREATED, Json(batch)))
}

#[utoipa::path(get, path = "/api/pult/recos/week", tag = "pult",
    responses(
        (status = 200, description = "Сводка текущей ISO-недели", body = RecoWeekResponse),
        (status = 401, description = "Токен сборщика не подошёл", body = ApiErrorBody),
        (status = 403, description = "Нужен токен сборщика", body = ApiErrorBody),
        (status = 404, description = "Нет входа", body = ApiErrorBody)
    ))]
pub async fn reco_week(
    State(state): State<AppState>,
    _collector: RecoCollector,
) -> Result<Json<RecoWeekResponse>, ApiError> {
    pult::reco_week(state.db.pool()).await.map(Json)
}

#[utoipa::path(get, path = "/api/pult/recos/batches", tag = "pult",
    params(("status" = Option<String>, Query, description = "Статус задания (по умолчанию queued)")),
    responses(
        (status = 200, description = "Список заданий", body = Vec<RecoBatch>),
        (status = 401, description = "Токен сборщика не подошёл", body = ApiErrorBody),
        (status = 403, description = "Нужен токен сборщика", body = ApiErrorBody),
        (status = 404, description = "Нет входа", body = ApiErrorBody)
    ))]
pub async fn list_reco_batches(
    State(state): State<AppState>,
    _collector: RecoCollector,
    Query(filter): Query<RecoBatchFilter>,
) -> Result<Json<Vec<RecoBatch>>, ApiError> {
    sqlx::query_as("SELECT * FROM pult_reco_batches WHERE status = $1 ORDER BY created_at, id")
        .bind(filter.status.unwrap_or(RecoBatchStatus::Queued))
        .fetch_all(state.db.pool())
        .await
        .map(Json)
        .map_err(pult::db)
}

#[utoipa::path(post, path = "/api/pult/recos/batches/{id}/taken", tag = "pult",
    params(("id" = Uuid, Path, description = "Задание")),
    responses(
        (status = 204, description = "Задание взято"),
        (status = 401, description = "Токен сборщика не подошёл", body = ApiErrorBody),
        (status = 403, description = "Нужен токен сборщика", body = ApiErrorBody),
        (status = 404, description = "Задания нет или нет входа", body = ApiErrorBody),
        (status = 409, description = "Задание уже взято", body = ApiErrorBody)
    ))]
pub async fn take_reco_batch(
    State(state): State<AppState>,
    _collector: RecoCollector,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let pool = state.db.pool();
    let updated = sqlx::query(
        "UPDATE pult_reco_batches SET status = 'taken', taken_at = now()
         WHERE id = $1 AND status = 'queued'",
    )
    .bind(id)
    .execute(pool)
    .await
    .map_err(pult::db)?;
    if updated.rows_affected() != 0 {
        return Ok(StatusCode::NO_CONTENT);
    }
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM pult_reco_batches WHERE id = $1)")
            .bind(id)
            .fetch_one(pool)
            .await
            .map_err(pult::db)?;
    Err(if exists {
        conflict("reco_batch_taken", "Задание уже взято")
    } else {
        missing("Задания нет")
    })
}
