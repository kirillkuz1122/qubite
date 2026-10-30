//! AGT-006a. Исходная точка — только в теле запроса и памяти вызова.
//! В синхронизацию, историю и базу попадают только место назначения и минуты.

use axum::{
    Json,
    extract::{Path, State},
    http::StatusCode,
};
use qubite_policy::Write;
use qubite_route::Point;
use qubite_sync::{OpKind, OpResult, Operation, RejectReason};
use qubite_sync_server::Rules;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::authorize,
};

#[derive(Clone, Copy, Deserialize, Serialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct RoutePoint {
    pub lat: f64,
    pub lon: f64,
}

impl From<RoutePoint> for Point {
    fn from(point: RoutePoint) -> Self {
        Self {
            lat: point.lat,
            lon: point.lon,
        }
    }
}

impl From<Point> for RoutePoint {
    fn from(point: Point) -> Self {
        Self {
            lat: point.lat,
            lon: point.lon,
        }
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct TaskRouteRequest {
    pub from: RoutePoint,
}

#[derive(Serialize, ToSchema)]
pub struct TaskRouteResponse {
    pub minutes: i32,
    pub meters: f64,
    pub geometry: Vec<RoutePoint>,
    pub place_text: Option<String>,
    pub to: RoutePoint,
    pub provider: String,
    pub attribution: String,
}

/// Место дела в create.fields и patch.fields; null очищает поле.
#[derive(Serialize, ToSchema)]
pub struct TaskPlaceFields {
    pub place_text: Option<String>,
    pub place_lat: Option<f64>,
    pub place_lon: Option<f64>,
    pub travel_minutes: Option<i32>,
}

fn unavailable() -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "route_unavailable",
        "Сервис маршрутов сейчас недоступен. Попробуйте позже.",
    )
}

fn not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "not_found", "Дело не найдено")
}

async fn save(
    state: &AppState,
    session: &Authenticated,
    id: Uuid,
    revision: i64,
    fields: Value,
) -> Result<i64, ApiError> {
    // Во время внешнего запроса право могли отозвать.
    authorize::<Write>(state, session, qubite_planner::MODULE).await?;
    let result = qubite_sync_server::apply_one(
        state.db.pool(),
        session.0.account_id,
        session.0.id,
        &Operation {
            op_id: Uuid::now_v7(),
            object_id: id,
            base_revision: Some(revision),
            kind: OpKind::Patch { fields },
        },
        &Rules {
            registry: state.sync.clone(),
            strict: true,
            writable: Some([qubite_planner::MODULE.to_owned()].into()),
            readable: None,
        },
    )
    .await
    .map_err(|_| ApiError::internal())?;
    match result {
        OpResult::Applied { revision, .. } => Ok(revision),
        OpResult::Conflict { .. } => Err(ApiError::new(
            StatusCode::CONFLICT,
            "conflict",
            "Дело изменили. Повторите расчёт маршрута.",
        )),
        OpResult::Rejected {
            reason: RejectReason::NotFound | RejectReason::Forbidden,
            ..
        } => Err(not_found()),
        OpResult::Rejected { .. } => Err(ApiError::internal()),
    }
}

/// Рассчитать дорогу до дела. Исходные координаты не сохраняются.
#[utoipa::path(post, path = "/api/v1/planner/tasks/{id}/route", tag = "planner",
    params(("id" = Uuid, Path, description = "ID дела")),
    request_body = TaskRouteRequest,
    responses(
        (status = 200, description = "Маршрут до дела", body = TaskRouteResponse),
        (status = 400, description = "place_missing или неверные координаты", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет права менять Planner", body = ApiErrorBody),
        (status = 404, description = "Дело не найдено или place_not_found", body = ApiErrorBody),
        (status = 409, description = "Дело изменили во время расчёта", body = ApiErrorBody),
        (status = 503, description = "route_unavailable", body = ApiErrorBody),
    ))]
pub async fn task_route(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(input): Json<TaskRouteRequest>,
) -> Result<Json<TaskRouteResponse>, ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    let from = Point::from(input.from);
    if !from.valid() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid",
            "Неверные координаты",
        ));
    }
    let task = {
        let mut conn = state
            .db
            .pool()
            .acquire()
            .await
            .map_err(|_| ApiError::internal())?;
        qubite_planner::get_task(&mut conn, session.0.account_id, id)
            .await
            .map_err(|_| ApiError::internal())?
            .filter(|task| !task.deleted)
            .ok_or_else(not_found)?
    };
    // Ограничиваем и ожидание общей очереди; HTTP-вызов каждого провайдера — 8 с.
    tokio::time::timeout(std::time::Duration::from_secs(25), async {
        let mut revision = task.revision;
        let to = match (task.place_lat, task.place_lon) {
            (Some(lat), Some(lon)) => Point { lat, lon },
            _ => {
                let text = task
                    .place_text
                    .as_deref()
                    .filter(|text| !text.trim().is_empty())
                    .ok_or_else(|| {
                        ApiError::new(
                            StatusCode::BAD_REQUEST,
                            "place_missing",
                            "Укажите место дела",
                        )
                    })?;
                let point = state
                    .route
                    .geocode(text)
                    .await
                    .map_err(|_| unavailable())?
                    .ok_or_else(|| {
                        ApiError::new(
                            StatusCode::NOT_FOUND,
                            "place_not_found",
                            "Не удалось найти место. Уточните адрес.",
                        )
                    })?;
                revision = save(
                    &state,
                    &session,
                    id,
                    revision,
                    json!({"place_lat": point.lat, "place_lon": point.lon}),
                )
                .await?;
                point
            }
        };
        let route = state
            .route
            .route(from, to)
            .await
            .map_err(|_| unavailable())?;
        let minutes = (route.seconds / 60.0).ceil();
        if !minutes.is_finite()
            || !(0.0..=f64::from(qubite_planner::MAX_TRAVEL_MINUTES)).contains(&minutes)
        {
            return Err(unavailable());
        }
        let minutes = minutes as i32;
        save(
            &state,
            &session,
            id,
            revision,
            json!({"travel_minutes": minutes}),
        )
        .await?;
        Ok(Json(TaskRouteResponse {
            minutes,
            meters: route.meters,
            geometry: route.geometry.into_iter().map(RoutePoint::from).collect(),
            place_text: task.place_text,
            to: to.into(),
            provider: "osrm".into(),
            attribution: "© OpenStreetMap".into(),
        }))
    })
    .await
    .map_err(|_| unavailable())?
}
