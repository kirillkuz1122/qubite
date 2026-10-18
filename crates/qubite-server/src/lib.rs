//! HTTP-слой сервера Qubite.
//!
//! `router` собирает все маршруты; его же используют интеграционные тесты,
//! поэтому тесты проверяют настоящий сервер, а не копию.

pub mod auth;

use std::{sync::Arc, time::Duration};

use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    middleware,
    response::IntoResponse,
    routing::{delete, get, post},
};
use qubite_db::Database;
use serde::Serialize;
use tower_http::{timeout::TimeoutLayer, trace::TraceLayer};
use utoipa::{OpenApi, ToSchema};

/// Общее состояние, доступное всем обработчикам.
#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub auth: Arc<auth::AuthSettings>,
}

impl AppState {
    /// Состояние с настройками входа по умолчанию.
    pub fn new(db: Database) -> Self {
        Self::with_auth(db, auth::AuthSettings::default())
    }

    pub fn with_auth(db: Database, auth: auth::AuthSettings) -> Self {
        Self {
            db,
            auth: Arc::new(auth),
        }
    }
}

#[derive(OpenApi)]
#[openapi(
    info(
        title = "Qubite API",
        description = "API ядра Qubite 2.0",
        version = "0.1.0"
    ),
    paths(
        health,
        ready,
        auth::login,
        auth::logout,
        auth::whoami,
        auth::list_sessions,
        auth::revoke_session,
        auth::logout_everywhere
    ),
    components(schemas(
        Health,
        Readiness,
        auth::ApiErrorBody,
        auth::LoginRequest,
        auth::LoginResponse,
        auth::Me,
        auth::SessionItem,
        auth::RevokedCount
    )),
    tags(
        (name = "system", description = "Состояние сервера"),
        (name = "auth", description = "Вход, выход и сессии. Изменяющие запросы с сессией требуют заголовок `X-CSRF-Token`.")
    )
)]
pub struct ApiDoc;

/// Собрать все маршруты сервера.
pub fn router(state: AppState) -> Router {
    Router::new()
        .route("/api/health", get(health))
        .route("/api/ready", get(ready))
        .route("/api/openapi.json", get(openapi))
        .route("/api/auth/login", post(auth::login))
        .route("/api/auth/logout", post(auth::logout))
        .route("/api/auth/me", get(auth::whoami))
        .route("/api/auth/sessions", get(auth::list_sessions))
        .route("/api/auth/sessions/{id}", delete(auth::revoke_session))
        .route("/api/auth/logout-everywhere", post(auth::logout_everywhere))
        .layer(middleware::from_fn_with_state(
            state.clone(),
            auth::session_layer,
        ))
        .with_state(state)
        .layer(TimeoutLayer::with_status_code(
            StatusCode::REQUEST_TIMEOUT,
            Duration::from_secs(30),
        ))
        .layer(TraceLayer::new_for_http())
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Health {
    /// Всегда `ok`, если процесс отвечает.
    status: &'static str,
    /// Версия Qubite.
    version: &'static str,
}

/// Жив ли процесс сервера. Не обращается к базе.
#[utoipa::path(get, path = "/api/health", tag = "system",
    responses((status = 200, description = "Сервер отвечает", body = Health)))]
async fn health() -> Json<Health> {
    Json(Health {
        status: "ok",
        version: qubite_kernel::VERSION,
    })
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Readiness {
    /// `ready` или `not_ready`.
    status: &'static str,
    /// `ok` или `unavailable`.
    database: &'static str,
    /// Номер последней применённой миграции.
    schema_version: Option<i64>,
}

/// Готов ли сервер обслуживать запросы: отвечает ли база и применены ли миграции.
#[utoipa::path(get, path = "/api/ready", tag = "system",
    responses(
        (status = 200, description = "Готов", body = Readiness),
        (status = 503, description = "База недоступна или схема не создана", body = Readiness)
    ))]
async fn ready(State(state): State<AppState>) -> impl IntoResponse {
    match state.db.schema_version().await {
        Ok(Some(version)) => (
            StatusCode::OK,
            Json(Readiness {
                status: "ready",
                database: "ok",
                schema_version: Some(version),
            }),
        ),
        Ok(None) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(Readiness {
                status: "not_ready",
                database: "ok",
                schema_version: None,
            }),
        ),
        Err(error) => {
            tracing::warn!(%error, "проверка готовности: база недоступна");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(Readiness {
                    status: "not_ready",
                    database: "unavailable",
                    schema_version: None,
                }),
            )
        }
    }
}

async fn openapi() -> Json<utoipa::openapi::OpenApi> {
    Json(ApiDoc::openapi())
}

/// Описание API в виде отформатированного JSON (для `qubite openapi`).
pub fn openapi_json() -> String {
    ApiDoc::openapi()
        .to_pretty_json()
        .expect("описание API всегда сериализуется")
}
