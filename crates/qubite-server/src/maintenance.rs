//! Техработы по HTTP (ACC-005): включение из Owner Console и пропуск owner.
//!
//! - `POST /api/owner/maintenance` — включить/выключить, «вернёмся к …», текст;
//! - `POST /api/owner/maintenance/pass` — одноразовая ссылка-пропуск на 10 минут;
//! - `GET /api/maintenance/pass?token=…` — страница с кнопкой «Войти»: ссылку
//!   может заранее открыть программа предпросмотра (Telegram), поэтому сам
//!   вход — только по нажатию (`POST`), иначе пропуск сгорел бы впустую.

use std::net::SocketAddr;

use axum::{
    Form, Json,
    extract::{ConnectInfo, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Response},
};
use qubite_auth::{
    maintenance::{self, Switch},
    platform::PlatformSettings,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated, client_info, session_cookies, with_cookies},
    modules::Owner,
};

#[derive(Debug, Deserialize, ToSchema)]
pub struct MaintenanceRequest {
    /// Включить (`true`) или выключить (`false`).
    enabled: bool,
    /// «Вернёмся к …»: `10:00` (ближайшее такое время в поясе платформы) или
    /// RFC 3339. Не задано — экран время не показывает.
    until: Option<String>,
    /// Новый текст экрана; не задан — прежний.
    message: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MaintenanceState {
    /// Тумблер owner.
    enabled: bool,
    /// Действуют ли техработы на самом деле (тумблер или `QUBITE_MAINTENANCE`).
    effective: bool,
    /// Включены переменной окружения — выключить можно только на сервере.
    locked_by_env: bool,
    /// «Вернёмся к …» (RFC 3339), если задано.
    until: Option<String>,
    message: String,
}

fn state_of(state: &AppState, settings: &PlatformSettings) -> MaintenanceState {
    MaintenanceState {
        enabled: settings.maintenance,
        effective: settings.maintenance || state.auth.overrides.maintenance,
        locked_by_env: state.auth.overrides.maintenance,
        until: settings.maintenance_until.clone(),
        message: settings.maintenance_message.clone(),
    }
}

/// Owner Console: включить или выключить техработы.
#[utoipa::path(post, path = "/api/owner/maintenance", tag = "owner", request_body = MaintenanceRequest,
    responses(
        (status = 403, description = "`confirm_required`: нужен пароль (D-285)", body = ApiErrorBody),
        (status = 200, description = "Готово; открытые соединения не-owner закрываются сразу", body = MaintenanceState),
        (status = 400, description = "Неверное время или текст", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn switch(
    State(state): State<AppState>,
    _owner: Owner,
    authenticated: Authenticated,
    Json(body): Json<MaintenanceRequest>,
) -> Result<Json<MaintenanceState>, ApiError> {
    crate::console::require_confirmed(&state, &authenticated).await?;
    let Authenticated(session) = authenticated;
    let settings = maintenance::switch(
        state.db.pool(),
        Some(session.account_id),
        Switch {
            on: body.enabled,
            until: body.until.as_deref(),
            message: body.message.as_deref(),
        },
    )
    .await?;
    Ok(Json(state_of(&state, &settings)))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct PassIssued {
    /// Ссылка-пропуск: открыть и нажать «Войти». Одноразовая.
    link: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    expires_at: OffsetDateTime,
}

/// Owner Console: выдать себе одноразовый пропуск на 10 минут (войти в другом браузере).
#[utoipa::path(post, path = "/api/owner/maintenance/pass", tag = "owner",
    responses(
        (status = 200, description = "Ссылка-пропуск", body = PassIssued),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn issue_pass(
    State(state): State<AppState>,
    _owner: Owner,
    Authenticated(session): Authenticated,
) -> Result<Json<PassIssued>, ApiError> {
    let (token, expires_at) = maintenance::issue_pass(state.db.pool(), session.account_id).await?;
    Ok(Json(PassIssued {
        link: maintenance::pass_link(&state.auth.config.email.auth_url, &token),
        expires_at,
    }))
}

#[derive(Debug, Deserialize, IntoParams, ToSchema)]
pub struct PassToken {
    /// Токен из ссылки-пропуска.
    token: String,
}

fn escape(value: &str) -> String {
    qubite_mail::templates::escape(value)
}

fn page(body: &str) -> Response {
    let html = format!(
        r#"<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Qubite — вход владельца</title></head><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f3eee5;color:#1f1a17;font-family:-apple-system,'Segoe UI',Roboto,sans-serif"><main style="max-width:420px;padding:32px;background:#fbf8f2;border-radius:28px;text-align:center">{body}</main></body></html>"#
    );
    let mut response = Html(html).into_response();
    let headers = response.headers_mut();
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("no-referrer"),
    );
    response
}

/// Страница пропуска: кнопка «Войти». Сама страница пропуск не тратит.
#[utoipa::path(get, path = "/api/maintenance/pass", tag = "auth", params(PassToken),
    responses((status = 200, description = "HTML-страница с кнопкой «Войти»")))]
pub async fn pass_page(Query(query): Query<PassToken>) -> Response {
    page(&format!(
        r#"<p style="font-size:22px;font-weight:700;margin:0 0 12px">Вход владельца</p><p style="margin:0 0 24px;line-height:1.5">Ссылка одноразовая и действует 10 минут.</p><form method="post" action="/api/maintenance/pass"><input type="hidden" name="token" value="{}"><button type="submit" style="border:0;border-radius:999px;background:#ff9852;color:#1f1a17;font-size:16px;font-weight:700;padding:14px 28px;cursor:pointer">Войти</button></form>"#,
        escape(&query.token)
    ))
}

/// Войти по пропуску: открывается обычная сессия owner, переход на главную.
#[utoipa::path(post, path = "/api/maintenance/pass", tag = "auth", request_body(content = PassToken, content_type = "application/x-www-form-urlencoded"),
    responses(
        (status = 303, description = "Вход выполнен — на главную; не вышло — `/auth?error=pass_invalid`")
    ))]
pub async fn redeem_pass(
    State(state): State<AppState>,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Form(form): Form<PassToken>,
) -> Response {
    let settings = &state.auth;
    let client = client_info(settings, &headers, peer.map(|peer| peer.0.0));
    match maintenance::login_with_pass(state.db.pool(), &settings.config, &form.token, &client)
        .await
    {
        Ok(issued) => {
            let mut response = StatusCode::SEE_OTHER.into_response();
            response
                .headers_mut()
                .insert(header::LOCATION, HeaderValue::from_static("/"));
            with_cookies(
                response,
                session_cookies(
                    settings,
                    &issued.token,
                    &issued.csrf_token,
                    issued.expires_at,
                ),
            )
        }
        Err(error) => {
            tracing::warn!(%error, "пропуск owner не принят");
            let mut response = StatusCode::SEE_OTHER.into_response();
            response.headers_mut().insert(
                header::LOCATION,
                HeaderValue::from_static("/auth?error=pass_invalid"),
            );
            response
        }
    }
}
