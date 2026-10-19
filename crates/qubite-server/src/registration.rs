//! Регистрация и приглашения (AUTH-003).
//!
//! - `GET /api/auth/registration` — какой режим и какую CAPTCHA показать;
//! - `POST /api/auth/register` — зарегистрироваться (почту потом подтвердить);
//! - `/api/owner/invitations` — приглашения (только owner, остальным 404).

use std::{net::SocketAddr, time::Duration};

use axum::{
    Json,
    extract::{ConnectInfo, Path, State},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use qubite_auth::{
    invitations::{self, InvitationView, NewInvitation},
    platform::{CaptchaChoice, Effective, RegistrationMode},
    registration::{self, RegisterInput},
};
use qubite_captcha::Provider;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated, client_info},
    modules::Owner,
};

/// Какая CAPTCHA действует сейчас: тумблер owner и аварийный env-переключатель
/// (`QUBITE_CAPTCHA_DISABLED` сильнее тумблера).
pub(crate) fn captcha_provider(rules: &Effective) -> Option<Provider> {
    match rules.captcha() {
        CaptchaChoice::Turnstile => Some(Provider::Turnstile),
        CaptchaChoice::Smartcaptcha => Some(Provider::SmartCaptcha),
        CaptchaChoice::Off => None,
    }
}

/// Виджет CAPTCHA для входа (D-189): только если у провайдера есть ключи.
pub(crate) fn login_widget(state: &AppState, rules: &Effective) -> Option<CaptchaWidget> {
    let provider = captcha_provider(rules)?;
    let site_key = state.auth.captcha.site_key(provider)?;
    Some(CaptchaWidget {
        provider: provider.as_str(),
        site_key: site_key.to_owned(),
    })
}

#[derive(Debug, Serialize, ToSchema)]
pub struct CaptchaWidget {
    /// `turnstile` или `smartcaptcha`.
    provider: &'static str,
    /// Открытый ключ виджета. Пусто — ключей на сервере нет, открытая
    /// регистрация без приглашения сейчас не работает.
    site_key: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RegistrationInfo {
    /// `closed`, `invite_only` или `open`.
    #[schema(value_type = String)]
    mode: RegistrationMode,
    /// Нужно ли приглашение.
    invite_required: bool,
    /// CAPTCHA для регистрации без приглашения (только в режиме `open`).
    captcha: Option<CaptchaWidget>,
}

/// Можно ли сейчас зарегистрироваться и что для этого показать.
#[utoipa::path(get, path = "/api/auth/registration", tag = "auth",
    responses((status = 200, description = "Режим регистрации", body = RegistrationInfo)))]
pub async fn info(State(state): State<AppState>) -> Result<Json<RegistrationInfo>, ApiError> {
    let rules = crate::platform::effective(&state).await?;
    let mode = rules.registration_mode();
    let captcha = (mode == RegistrationMode::Open)
        .then(|| captcha_provider(&rules))
        .flatten()
        .map(|provider| CaptchaWidget {
            provider: provider.as_str(),
            site_key: state
                .auth
                .captcha
                .site_key(provider)
                .unwrap_or_default()
                .to_owned(),
        });
    Ok(Json(RegistrationInfo {
        mode,
        invite_required: mode == RegistrationMode::InviteOnly,
        captcha,
    }))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct RegisterRequest {
    email: String,
    /// Не короче 10 символов.
    password: String,
    #[serde(default)]
    display_name: String,
    /// Код приглашения (`7KQ2-M9XD-4TPR`) или его вариант без дефисов.
    invite: Option<String>,
    /// Токен виджета CAPTCHA (нужен при открытой регистрации без приглашения).
    captcha_token: Option<String>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Registered {
    /// Одинаковый текст, создан аккаунт или почта уже занята.
    message: &'static str,
}

/// Зарегистрироваться. Войти можно после подтверждения почты (письмо с кодом уходит сразу).
#[utoipa::path(post, path = "/api/auth/register", tag = "auth", request_body = RegisterRequest,
    responses(
        (status = 202, description = "Письмо с кодом отправлено (ответ тот же, если почта уже занята)", body = Registered),
        (status = 400, description = "`invite_required`, `invalid_invite`, `captcha_failed`, `invalid` (почта, имя, слабый пароль)", body = ApiErrorBody),
        (status = 403, description = "`registration_closed`", body = ApiErrorBody),
        (status = 503, description = "`captcha_unavailable`: проверить CAPTCHA сейчас нельзя", body = ApiErrorBody)
    ))]
pub async fn register(
    State(state): State<AppState>,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<RegisterRequest>,
) -> Result<Response, ApiError> {
    let settings = &state.auth;
    let client = client_info(settings, &headers, peer.map(|peer| peer.0.0));
    let rules = crate::platform::effective(&state).await?;
    let mode = rules.registration_mode();
    let has_invite = body
        .invite
        .as_deref()
        .is_some_and(|code| !code.trim().is_empty());

    // Открытая регистрация без приглашения — только человеку (D-187).
    if mode == RegistrationMode::Open
        && !has_invite
        && let Some(provider) = captcha_provider(&rules)
    {
        let token = body.captcha_token.as_deref().unwrap_or_default();
        match settings.captcha.verify(provider, token, &client.ip).await {
            Ok(true) => {}
            Ok(false) => {
                return Err(ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "captcha_failed",
                    "Не получилось проверить, что вы не робот. Попробуйте ещё раз",
                ));
            }
            Err(error) => {
                tracing::warn!(%error, "CAPTCHA недоступна — регистрация не пропущена");
                return Err(ApiError::new(
                    StatusCode::SERVICE_UNAVAILABLE,
                    "captcha_unavailable",
                    "Проверка «не робот» сейчас не работает. Попробуйте позже",
                ));
            }
        }
    }

    // Без почты аккаунт не подтвердить — регистрацию не начинаем.
    if mode != RegistrationMode::Closed && !rules.email_enabled() {
        return Err(qubite_auth::Error::EmailDisabled.into());
    }
    registration::register(
        state.db.pool(),
        &settings.passwords,
        &settings.mailer,
        &settings.config.email,
        mode,
        RegisterInput {
            email: body.email,
            password: body.password,
            display_name: body.display_name,
            invite: body.invite,
            client,
        },
    )
    .await?;
    Ok((
        StatusCode::ACCEPTED,
        Json(Registered {
            message: "Почти готово: мы отправили письмо с кодом. Подтвердите почту, чтобы войти.",
        }),
    )
        .into_response())
}

// ---------------------------------------------------------------- Owner Console

#[derive(Debug, Deserialize, ToSchema)]
pub struct InvitationRequest {
    /// Почта — приглашение только для неё (и уйдёт письмом). Нет — общая ссылка.
    email: Option<String>,
    /// Срок в днях, 1…30. По умолчанию 7.
    days: Option<u32>,
    /// Заметка для себя.
    #[serde(default)]
    note: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct InvitationCreated {
    id: Uuid,
    /// Код приглашения. Показывается **один раз**.
    code: String,
    /// Ссылка с кодом.
    link: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    expires_at: OffsetDateTime,
    /// Письмо с приглашением отправлено.
    emailed: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct InvitationItem {
    id: Uuid,
    /// `email_bound` или `open_link`.
    kind: String,
    email: Option<String>,
    note: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    expires_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    used_at: Option<OffsetDateTime>,
    /// Кто зарегистрировался по приглашению.
    used_by_email: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    revoked_at: Option<OffsetDateTime>,
    /// `active`, `used`, `revoked` или `expired`.
    status: String,
}

impl From<InvitationView> for InvitationItem {
    fn from(view: InvitationView) -> Self {
        Self {
            id: view.id,
            kind: view.kind,
            email: view.email,
            note: view.note,
            created_at: view.created_at,
            expires_at: view.expires_at,
            used_at: view.used_at,
            used_by_email: view.used_by_email,
            revoked_at: view.revoked_at,
            status: view.status,
        }
    }
}

/// Owner Console: создать приглашение.
#[utoipa::path(post, path = "/api/owner/invitations", tag = "owner", request_body = InvitationRequest,
    responses(
        (status = 201, description = "Приглашение создано; код виден только в этом ответе", body = InvitationCreated),
        (status = 400, description = "Неверная почта или срок", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn create_invitation(
    State(state): State<AppState>,
    _owner: Owner,
    Authenticated(session): Authenticated,
    Json(body): Json<InvitationRequest>,
) -> Result<Response, ApiError> {
    let ttl = Duration::from_secs(u64::from(body.days.unwrap_or(7)) * 24 * 60 * 60);
    let send_email = crate::platform::effective(&state).await?.email_enabled();
    let issued = invitations::create(
        state.db.pool(),
        &state.auth.mailer,
        &state.auth.config.email,
        send_email,
        session.account_id,
        NewInvitation {
            email: body.email.filter(|email| !email.trim().is_empty()),
            ttl,
            note: body.note,
        },
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(InvitationCreated {
            id: issued.id,
            code: issued.code,
            link: issued.link,
            expires_at: issued.expires_at,
            emailed: issued.emailed,
        }),
    )
        .into_response())
}

/// Owner Console: все приглашения (без кодов).
#[utoipa::path(get, path = "/api/owner/invitations", tag = "owner",
    responses(
        (status = 200, description = "Приглашения, свежие сверху", body = Vec<InvitationItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn list_invitations(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<Vec<InvitationItem>>, ApiError> {
    Ok(Json(
        invitations::list(state.db.pool())
            .await?
            .into_iter()
            .map(InvitationItem::from)
            .collect(),
    ))
}

/// Owner Console: отозвать приглашение.
#[utoipa::path(delete, path = "/api/owner/invitations/{id}", tag = "owner",
    params(("id" = Uuid, Path, description = "ID приглашения")),
    responses(
        (status = 204, description = "Отозвано"),
        (status = 404, description = "Нет такого действующего приглашения или не owner", body = ApiErrorBody)
    ))]
pub async fn revoke_invitation(
    State(state): State<AppState>,
    _owner: Owner,
    Authenticated(session): Authenticated,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    if invitations::revoke(state.db.pool(), session.account_id, id).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(qubite_auth::Error::NotFound.into())
    }
}
