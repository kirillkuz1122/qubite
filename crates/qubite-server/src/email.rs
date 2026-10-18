//! Письма с кодами (AUTH-002): подтверждение почты и восстановление пароля.
//!
//! Запрос письма всегда отвечает `202` одним и тем же текстом — по ответу
//! нельзя узнать, есть ли такой аккаунт. Код из письма или ссылку (токен из
//! адреса кнопки) присылают во втором запросе.

use std::net::SocketAddr;

use axum::{
    Json,
    extract::{ConnectInfo, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use qubite_auth::email::{self, Proof, Purpose};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, RevokedCount, clear_cookies, client_info, with_cookies},
};

#[derive(Debug, Deserialize, ToSchema)]
pub struct MailRequest {
    /// Почта аккаунта.
    email: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct MailRequested {
    /// Всегда одинаковый текст: есть аккаунт или нет.
    message: &'static str,
}

/// Код из письма (`email` + `code`) или токен из ссылки (`token`).
#[derive(Debug, Deserialize, ToSchema)]
pub struct VerifyEmailRequest {
    email: Option<String>,
    /// 6 цифр из письма; пробелы и дефисы не мешают.
    code: Option<String>,
    /// Токен из ссылки в письме (`?token=…`).
    token: Option<String>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct ResetPasswordRequest {
    email: Option<String>,
    code: Option<String>,
    token: Option<String>,
    /// Новый пароль, не короче 10 символов.
    password: String,
}

fn proof(
    email: Option<String>,
    code: Option<String>,
    token: Option<String>,
) -> Result<Proof, ApiError> {
    match (email, code, token) {
        (_, _, Some(token)) => Ok(Proof::Link { token }),
        (Some(email), Some(code), None) => Ok(Proof::Code { email, code }),
        _ => Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid",
            "Нужен код из письма вместе с почтой или ссылка из письма",
        )),
    }
}

async fn request_mail(
    state: &AppState,
    purpose: Purpose,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: &HeaderMap,
    body: MailRequest,
) -> Result<Response, ApiError> {
    let settings = &state.auth;
    let client = client_info(settings, headers, peer.map(|peer| peer.0.0));
    email::request(
        state.db.pool(),
        &settings.mailer,
        &settings.config.email,
        purpose,
        &body.email,
        &client.ip,
    )
    .await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(MailRequested {
            message: "Если такой аккаунт есть, письмо уже в пути. Проверьте почту и папку «Спам».",
        }),
    )
        .into_response())
}

/// Прислать письмо для подтверждения почты (аккаунтам, которые её ещё не подтвердили).
#[utoipa::path(post, path = "/api/auth/email/verify/request", tag = "auth", request_body = MailRequest,
    responses(
        (status = 202, description = "Ответ одинаковый для любой почты", body = MailRequested),
        (status = 400, description = "Почта записана неправильно", body = ApiErrorBody)
    ))]
pub async fn request_verification(
    State(state): State<AppState>,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<MailRequest>,
) -> Result<Response, ApiError> {
    request_mail(&state, Purpose::VerifyEmail, peer, &headers, body).await
}

/// Подтвердить почту кодом или ссылкой из письма. После этого можно войти.
#[utoipa::path(post, path = "/api/auth/email/verify", tag = "auth", request_body = VerifyEmailRequest,
    responses(
        (status = 204, description = "Почта подтверждена"),
        (status = 400, description = "Код неверный, устарел или уже использован (`invalid_code`)", body = ApiErrorBody)
    ))]
pub async fn verify(
    State(state): State<AppState>,
    Json(body): Json<VerifyEmailRequest>,
) -> Result<StatusCode, ApiError> {
    let proof = proof(body.email, body.code, body.token)?;
    email::verify_email(state.db.pool(), &state.auth.config.email, &proof).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Забыли пароль: прислать письмо с кодом (только активным аккаунтам).
#[utoipa::path(post, path = "/api/auth/password/forgot", tag = "auth", request_body = MailRequest,
    responses(
        (status = 202, description = "Ответ одинаковый для любой почты", body = MailRequested),
        (status = 400, description = "Почта записана неправильно", body = ApiErrorBody)
    ))]
pub async fn forgot_password(
    State(state): State<AppState>,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<MailRequest>,
) -> Result<Response, ApiError> {
    request_mail(&state, Purpose::ResetPassword, peer, &headers, body).await
}

/// Задать новый пароль по коду или ссылке из письма. Все сессии и устройства закрываются.
#[utoipa::path(post, path = "/api/auth/password/reset", tag = "auth", request_body = ResetPasswordRequest,
    responses(
        (status = 200, description = "Пароль изменён; все сессии закрыты, cookie стёрты", body = RevokedCount),
        (status = 400, description = "Код неверный или устарел (`invalid_code`), слабый пароль (`invalid`)", body = ApiErrorBody)
    ))]
pub async fn reset_password(
    State(state): State<AppState>,
    Json(body): Json<ResetPasswordRequest>,
) -> Result<Response, ApiError> {
    let proof = proof(body.email, body.code, body.token)?;
    let settings = &state.auth;
    let revoked = email::reset_password(
        state.db.pool(),
        &settings.passwords,
        &settings.config.email,
        &proof,
        &body.password,
    )
    .await?;
    Ok(with_cookies(
        Json(RevokedCount { revoked }).into_response(),
        clear_cookies(settings),
    ))
}
