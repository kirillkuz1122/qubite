//! Тумблеры платформы по HTTP (ACC-002): публичное состояние, слой техработ
//! и раздел Owner Console.

use axum::{
    Json,
    extract::{Request, State},
    http::StatusCode,
    middleware::Next,
    response::{IntoResponse, Response},
};
use qubite_auth::platform::{self, Change, Effective, LoginMethod, RegistrationMode, SettingView};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::Owner,
};

/// Действующие правила платформы для этого запроса.
pub(crate) async fn effective(state: &AppState) -> Result<Effective, ApiError> {
    Ok(platform::effective(state.db.pool(), &state.auth.overrides).await?)
}

pub(crate) fn maintenance_error(message: &str) -> ApiError {
    ApiError::new(StatusCode::SERVICE_UNAVAILABLE, "maintenance", message)
}

/// Адреса, которые работают и во время техработ: проверки сервера, состояние
/// платформы, вход (owner должен войти) и выход.
fn open_during_maintenance(path: &str) -> bool {
    matches!(
        path,
        "/api/health"
            | "/api/ready"
            | "/api/openapi.json"
            | "/api/platform/status"
            | "/api/auth/login"
            | "/api/auth/logout"
            | "/api/auth/device/token"
    )
}

/// Слой техработ: всем, кроме owner, — `503 maintenance` с текстом owner.
/// Стоит после слоя сессии, поэтому знает, кто пришёл.
pub async fn maintenance_layer(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Response {
    if !request.uri().path().starts_with("/api/") || open_during_maintenance(request.uri().path()) {
        return next.run(request).await;
    }
    let is_owner = request
        .extensions()
        .get::<Authenticated>()
        .is_some_and(|session| session.0.is_owner);
    // База не ответила — тумблер не прочитать; действует только env
    // (`QUBITE_MAINTENANCE`), а сам адрес сам сообщит, что база недоступна.
    let rules = platform::effective(state.db.pool(), &state.auth.overrides)
        .await
        .unwrap_or_else(|error| {
            tracing::warn!(%error, "техработы: тумблеры не прочитаны, действует только env");
            Effective {
                overrides: state.auth.overrides.clone(),
                ..Effective::default()
            }
        });
    // Способы входа через провайдеров (AUTH-004) включает и выключает owner
    // тумблерами: перед каждым запросом к ним переносим положение тумблеров
    // в `qubite-oauth`, и уже начатый вход у выключенного провайдера не пройдёт.
    if request.uri().path().starts_with("/api/auth/oauth") {
        for provider in qubite_oauth::Provider::ALL {
            if let Some(method) = LoginMethod::parse(provider.as_str()) {
                state
                    .oauth
                    .set_enabled(provider, rules.method_allowed(method, false));
            }
        }
    }
    match rules.maintenance_for(is_owner) {
        Some(message) => maintenance_error(message).into_response(),
        None => next.run(request).await,
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LoginMethods {
    password: bool,
    google: bool,
    yandex: bool,
    vk: bool,
    telegram: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PlatformStatus {
    /// Идут техработы (owner при этом работает).
    maintenance: bool,
    /// Текст техработ, если они идут.
    maintenance_message: Option<String>,
    /// Можно ли сейчас войти (существующие сессии работают в любом случае).
    login_enabled: bool,
    /// Какими способами можно войти.
    login_methods: LoginMethods,
    /// `closed`, `invite_only` или `open`.
    #[schema(value_type = String)]
    registration_mode: RegistrationMode,
    /// Часовой пояс платформы (IANA).
    timezone: String,
}

/// Состояние платформы для сайта и приложений: техработы, вход, регистрация.
#[utoipa::path(get, path = "/api/platform/status", tag = "system",
    responses((status = 200, description = "Как сейчас работает платформа (для обычного пользователя)", body = PlatformStatus)))]
pub async fn status(State(state): State<AppState>) -> Result<Json<PlatformStatus>, ApiError> {
    let rules = effective(&state).await?;
    let method = |m| rules.method_allowed(m, false);
    Ok(Json(PlatformStatus {
        maintenance: rules.maintenance_on(),
        maintenance_message: rules.maintenance_for(false).map(str::to_owned),
        login_enabled: rules.login_allowed(false),
        login_methods: LoginMethods {
            password: method(LoginMethod::Password),
            google: method(LoginMethod::Google),
            yandex: method(LoginMethod::Yandex),
            vk: method(LoginMethod::Vk),
            telegram: method(LoginMethod::Telegram),
        },
        registration_mode: rules.registration_mode(),
        timezone: rules.settings.timezone.clone(),
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SettingItem {
    /// Ключ, например `registration.mode` или `login.methods.vk`.
    key: String,
    #[schema(value_type = Object)]
    value: serde_json::Value,
    /// Значение по умолчанию.
    #[schema(value_type = Object)]
    default: serde_json::Value,
    /// Версия для сохранения; 0 — ни разу не меняли.
    version: i64,
    /// Зажато переменной окружения на сервере — тумблер ничего не изменит.
    locked_by_env: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    updated_at: Option<OffsetDateTime>,
    updated_by: Option<Uuid>,
}

impl From<SettingView> for SettingItem {
    fn from(view: SettingView) -> Self {
        Self {
            key: view.key.into(),
            value: view.value,
            default: view.default,
            version: view.version,
            locked_by_env: view.locked_by_env,
            updated_at: view.updated_at,
            updated_by: view.updated_by,
        }
    }
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SettingChange {
    key: String,
    #[schema(value_type = Object)]
    value: serde_json::Value,
    /// Версия, которую видел owner (из списка).
    version: i64,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct SettingsPatch {
    /// Все изменения сохраняются вместе или не сохраняется ни одно.
    changes: Vec<SettingChange>,
}

async fn list_items(state: &AppState) -> Result<Vec<SettingItem>, ApiError> {
    Ok(platform::list(state.db.pool(), &state.auth.overrides)
        .await?
        .into_iter()
        .map(SettingItem::from)
        .collect())
}

/// Owner Console: все тумблеры платформы с версиями.
#[utoipa::path(get, path = "/api/owner/platform", tag = "owner",
    responses(
        (status = 200, description = "Тумблеры платформы", body = Vec<SettingItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_settings(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<Vec<SettingItem>>, ApiError> {
    Ok(Json(list_items(&state).await?))
}

/// Owner Console: сохранить изменения тумблеров (все вместе или ничего).
#[utoipa::path(patch, path = "/api/owner/platform", tag = "owner", request_body = SettingsPatch,
    responses(
        (status = 200, description = "Сохранено; новый список", body = Vec<SettingItem>),
        (status = 400, description = "Нет такой настройки или неверное значение", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody),
        (status = 409, description = "Кто-то уже изменил настройку (другая вкладка) — обновите страницу", body = ApiErrorBody)
    ))]
pub async fn owner_update(
    State(state): State<AppState>,
    _owner: Owner,
    Authenticated(session): Authenticated,
    Json(body): Json<SettingsPatch>,
) -> Result<Json<Vec<SettingItem>>, ApiError> {
    let changes: Vec<Change> = body
        .changes
        .into_iter()
        .map(|change| Change {
            key: change.key,
            value: change.value,
            version: change.version,
        })
        .collect();
    platform::set_many(state.db.pool(), Some(session.account_id), &changes).await?;
    Ok(Json(list_items(&state).await?))
}
