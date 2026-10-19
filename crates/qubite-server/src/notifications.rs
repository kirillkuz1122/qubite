//! Уведомления владельцу в Telegram (CMD-006): тумблеры видов в Owner Console,
//! привязка Telegram из профиля и сигнал «сервер отвечает ошибками».
//! Отправляет их `qubite bot`.

use axum::{
    Json,
    extract::{ConnectInfo, Path, Request, State},
    http::{HeaderMap, StatusCode},
    middleware::Next,
    response::Response,
};
use qubite_bot::{Kind, notify};
use qubite_objects::{NewAuditEntry, audit};
use serde::{Deserialize, Serialize};
use std::{net::SocketAddr, time::Duration};
use time::OffsetDateTime;
use utoipa::ToSchema;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::Owner,
    oauth::{PasswordConfirm, confirm},
};

fn bot_error(error: qubite_bot::Error) -> ApiError {
    match error {
        qubite_bot::Error::Invalid(message) => {
            ApiError::new(StatusCode::NOT_FOUND, "not_found", message)
        }
        other => {
            tracing::error!(error = %other, "уведомления: внутренняя ошибка");
            ApiError::internal()
        }
    }
}

/// Вид уведомлений и включён ли он.
#[derive(Debug, Serialize, ToSchema)]
pub struct NotificationSetting {
    /// `new_device_login`, `ai_budget_80`, `server_down`…
    kind: String,
    title: String,
    enabled: bool,
}

/// Какие уведомления владелец получает в Telegram.
#[utoipa::path(get, path = "/api/owner/notifications", tag = "owner",
    responses(
        (status = 200, description = "Виды уведомлений", body = [NotificationSetting]),
        (status = 404, description = "Не owner", body = ApiErrorBody),
    ))]
pub async fn notification_settings(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<Vec<NotificationSetting>>, ApiError> {
    let settings = notify::settings(state.db.pool()).await.map_err(bot_error)?;
    Ok(Json(
        settings
            .into_iter()
            .map(|setting| NotificationSetting {
                kind: setting.kind.as_str().into(),
                title: setting.title.into(),
                enabled: setting.enabled,
            })
            .collect(),
    ))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct NotificationChange {
    enabled: bool,
}

/// Включить или выключить вид уведомлений.
#[utoipa::path(put, path = "/api/owner/notifications/{kind}", tag = "owner",
    params(("kind" = String, Path, description = "Вид уведомлений")),
    request_body = NotificationChange,
    responses(
        (status = 204, description = "Сохранено"),
        (status = 404, description = "Не owner или нет такого вида", body = ApiErrorBody),
    ))]
pub async fn change_notification(
    State(state): State<AppState>,
    Owner(owner): Owner,
    Path(kind): Path<String>,
    Json(body): Json<NotificationChange>,
) -> Result<StatusCode, ApiError> {
    let kind: Kind = kind.parse().map_err(bot_error)?;
    notify::set_enabled(state.db.pool(), kind, body.enabled)
        .await
        .map_err(bot_error)?;
    let mut conn = state.db.pool().acquire().await.map_err(|error| {
        tracing::error!(%error, "уведомления: база недоступна");
        ApiError::internal()
    })?;
    audit::record(
        &mut conn,
        NewAuditEntry {
            actor_id: Some(owner.account_id()),
            action: "notify.setting_changed".into(),
            target_kind: "notification_kind".into(),
            target_id: Some(kind.as_str().into()),
            after: Some(serde_json::json!({ "enabled": body.enabled })),
            ..NewAuditEntry::default()
        },
    )
    .await
    .map_err(|error| {
        tracing::error!(%error, "уведомления: аудит не записан");
        ApiError::internal()
    })?;
    Ok(StatusCode::NO_CONTENT)
}

/// Ссылка для привязки Telegram.
#[derive(Debug, Serialize, ToSchema)]
pub struct TelegramLinkCode {
    /// Открыть в Telegram и нажать «Начать»: `https://t.me/<бот>?start=<код>`.
    url: String,
    /// Сколько секунд действует ссылка.
    expires_in: u64,
}

const LINK_TTL: Duration = Duration::from_secs(10 * 60);

/// Привязать Telegram к своему аккаунту через бота (нужен пароль). После
/// привязки сообщения боту попадают во Входящие, owner получает уведомления.
#[utoipa::path(post, path = "/api/v1/telegram/link-code", tag = "auth",
    request_body = PasswordConfirm,
    responses(
        (status = 200, description = "Ссылка на бота с одноразовым кодом (10 минут)", body = TelegramLinkCode),
        (status = 401, description = "Нужно войти или неверный пароль", body = ApiErrorBody),
        (status = 409, description = "Бот не настроен", body = ApiErrorBody),
    ))]
pub async fn link_code(
    State(state): State<AppState>,
    session: Authenticated,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<PasswordConfirm>,
) -> Result<Json<TelegramLinkCode>, ApiError> {
    let bot_name = state.oauth.settings().telegram.bot_name.clone();
    if bot_name.is_empty() {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "bot_not_configured",
            "Бот Telegram ещё не настроен (QUBITE_TELEGRAM_BOT_NAME)",
        ));
    }
    confirm(&state, &session, &headers, peer, body.password()).await?;
    let code =
        qubite_bot::capture::create_link_code(state.db.pool(), session.0.account_id, LINK_TTL)
            .await
            .map_err(bot_error)?;
    Ok(Json(TelegramLinkCode {
        url: format!("https://t.me/{bot_name}?start={code}"),
        expires_in: LINK_TTL.as_secs(),
    }))
}

/// Слой: ответ 5xx → уведомление владельцу «сервер отвечает ошибками»,
/// не чаще одного в час. Только метод и путь — без параметров (там бывают коды).
pub async fn errors_layer(State(state): State<AppState>, request: Request, next: Next) -> Response {
    let method = request.method().clone();
    let path = request.uri().path().to_owned();
    let response = next.run(request).await;
    let status = response.status();
    if status.is_server_error() {
        let pool = state.db.pool().clone();
        tokio::spawn(async move {
            let now = OffsetDateTime::now_utc();
            let hour = format!("{}T{:02}", now.date(), now.hour());
            let text = format!(
                "⚠️ Сервер Qubite отвечает ошибками: {} на {method} {path} ({hour}:00 UTC). Подробности — в журнале сервера.",
                status.as_u16()
            );
            let result = async {
                let mut conn = pool.acquire().await?;
                notify::enqueue(
                    &mut conn,
                    Kind::ServerErrors,
                    &text,
                    Some(&format!("errors:{hour}")),
                )
                .await
                .map_err(|error| match error {
                    qubite_bot::Error::Db(error) => error,
                    other => sqlx::Error::Protocol(other.to_string()),
                })
            }
            .await;
            if let Err(error) = result {
                tracing::warn!(%error, "уведомление об ошибке сервера не записано");
            }
        });
    }
    response
}
