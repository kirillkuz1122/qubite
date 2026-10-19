//! Вход через Яндекс ID, VK ID, Google и Telegram (AUTH-004).
//!
//! Переход к провайдеру и возврат — это переходы браузера, поэтому ответы
//! здесь — перенаправления: успех ведёт на сайт, ошибка — на `/auth?error=код`
//! (экран входа — AUTH-005). Привязка и отвязка — из открытого аккаунта с
//! паролем (D-060). Правила — в `qubite-oauth`.

use std::{collections::BTreeMap, net::SocketAddr};

use axum::{
    Json,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use qubite_auth::sessions;
use qubite_oauth::{Callback, Error, Intent, Provider};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};

use crate::{
    AppState,
    auth::{
        ApiError, ApiErrorBody, AuthSettings, Authenticated, LoginResponse, client_info,
        cookie_value, me, session_cookies, with_cookies,
    },
};

/// Cookie с секретом начатого входа: привязывает возврат от провайдера к
/// браузеру, который вход начал.
pub const FLOW_COOKIE: &str = "qubite_oauth";
const FLOW_PATH: &str = "/api/auth/oauth";

fn flow_cookie(settings: &AuthSettings, value: &str, max_age: u64) -> HeaderValue {
    let mut cookie = format!(
        "{FLOW_COOKIE}={value}; Path={FLOW_PATH}; Max-Age={max_age}; SameSite=Lax; HttpOnly"
    );
    if settings.cookie_secure {
        cookie.push_str("; Secure");
    }
    HeaderValue::from_str(&cookie).expect("токен — допустимые символы cookie")
}

fn oauth_error(error: Error) -> ApiError {
    let status = match &error {
        Error::UnknownProvider => StatusCode::NOT_FOUND,
        Error::ProviderDisabled | Error::Taken | Error::AlreadyLinked | Error::EmailTaken => {
            StatusCode::CONFLICT
        }
        Error::EmailRequired => StatusCode::BAD_REQUEST,
        Error::InvalidState | Error::Invalid(_) | Error::Provider(_) => StatusCode::BAD_REQUEST,
        Error::NotLinked => StatusCode::UNAUTHORIZED,
        Error::Auth(_) => return auth_error(error),
        Error::Db(_) | Error::Audit(_) => {
            tracing::error!(%error, "вход через провайдера: внутренняя ошибка");
            return ApiError::internal();
        }
    };
    ApiError::new(status, error.code(), error.to_string())
}

fn auth_error(error: Error) -> ApiError {
    match error {
        Error::Auth(error) => error.into(),
        other => oauth_error(other),
    }
}

fn provider(name: &str) -> Result<Provider, ApiError> {
    name.parse().map_err(oauth_error)
}

/// Перенаправить браузер (и, если нужно, поставить cookie).
fn redirect(location: &str) -> Response {
    let mut response = StatusCode::SEE_OTHER.into_response();
    response.headers_mut().insert(
        header::LOCATION,
        HeaderValue::from_str(location).unwrap_or(HeaderValue::from_static("/")),
    );
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

fn error_redirect(settings: &AuthSettings, error: &Error, provider: &str) -> Response {
    if matches!(error, Error::Db(_) | Error::Audit(_)) {
        tracing::error!(%error, "вход через провайдера: внутренняя ошибка");
    } else {
        tracing::info!(
            code = error.code(),
            provider,
            "вход через провайдера отклонён"
        );
    }
    let mut response = redirect(&format!("/auth?error={}&provider={provider}", error.code()));
    response
        .headers_mut()
        .append(header::SET_COOKIE, flow_cookie(settings, "", 0));
    response
}

// ---------------------------------------------------------------- способы входа

/// Способ входа на экране входа.
#[derive(Debug, Serialize, ToSchema)]
pub struct OAuthProviderItem {
    /// `yandex`, `vk`, `google`, `telegram`.
    id: String,
    /// `redirect` — переход на сайт провайдера (`/api/auth/oauth/{id}/login`);
    /// `telegram_widget` — виджет Telegram с именем бота `bot_name`.
    kind: String,
    bot_name: Option<String>,
}

/// Какие способы входа сейчас включены (публично: нужно экрану входа).
#[utoipa::path(get, path = "/api/auth/oauth/providers", tag = "auth",
    responses((status = 200, description = "Включённые и настроенные провайдеры", body = [OAuthProviderItem])))]
pub async fn providers(State(state): State<AppState>) -> Json<Vec<OAuthProviderItem>> {
    Json(
        state
            .oauth
            .available()
            .into_iter()
            .map(|provider| OAuthProviderItem {
                id: provider.as_str().into(),
                kind: if provider.is_redirect() {
                    "redirect"
                } else {
                    "telegram_widget"
                }
                .into(),
                bot_name: (!provider.is_redirect())
                    .then(|| state.oauth.settings().telegram.bot_name.clone()),
            })
            .collect(),
    )
}

// ---------------------------------------------------------------- вход переходом

#[derive(Debug, Deserialize, IntoParams)]
pub struct StartQuery {
    /// Куда вернуть после входа (путь на сайте Qubite), по умолчанию `/`.
    return_to: Option<String>,
    /// Код приглашения — для регистрации через провайдера, если регистрация
    /// «по приглашениям» (D-189).
    invite: Option<String>,
}

/// Начать вход: браузер уходит к провайдеру.
#[utoipa::path(get, path = "/api/auth/oauth/{provider}/login", tag = "auth",
    params(("provider" = String, Path, description = "`yandex`, `vk` или `google`"), StartQuery),
    responses(
        (status = 303, description = "Переход к провайдеру (или на `/auth?error=…`)"),
    ))]
pub async fn start_login(
    State(state): State<AppState>,
    Path(name): Path<String>,
    Query(query): Query<StartQuery>,
) -> Response {
    let settings = &state.auth;
    let started = async {
        let provider: Provider = name.parse()?;
        let intent = Intent::Login {
            return_to: query.return_to.unwrap_or_else(|| "/".into()),
            invite_hash: query
                .invite
                .as_deref()
                .map(str::trim)
                .filter(|code| !code.is_empty())
                .map(qubite_auth::invitations::code_hash),
        };
        state.oauth.start(state.db.pool(), provider, intent).await
    }
    .await;
    match started {
        Ok(started) => {
            let mut response = redirect(&started.authorize_url);
            response.headers_mut().append(
                header::SET_COOKIE,
                flow_cookie(
                    settings,
                    &started.state,
                    state.oauth.settings().flow_ttl.as_secs(),
                ),
            );
            response
        }
        Err(error) => error_redirect(settings, &error, &name),
    }
}

/// Подтверждение паролем.
#[derive(Debug, Deserialize, ToSchema)]
pub struct PasswordConfirm {
    password: String,
}

impl PasswordConfirm {
    pub(crate) fn password(&self) -> &str {
        &self.password
    }
}

/// Адрес провайдера для привязки.
#[derive(Debug, Serialize, ToSchema)]
pub struct LinkStarted {
    authorize_url: String,
}

/// Начать привязку провайдера к своему аккаунту (нужен пароль).
#[utoipa::path(post, path = "/api/auth/oauth/{provider}/link", tag = "auth",
    params(("provider" = String, Path, description = "`yandex`, `vk` или `google`")),
    request_body = PasswordConfirm,
    responses(
        (status = 200, description = "Перейти по `authorize_url`; ставится cookie начатого входа", body = LinkStarted),
        (status = 401, description = "Нужно войти или неверный пароль", body = ApiErrorBody),
        (status = 409, description = "Способ входа выключен", body = ApiErrorBody),
        (status = 429, description = "Слишком много неверных паролей", body = ApiErrorBody),
    ))]
pub async fn start_link(
    State(state): State<AppState>,
    session: Authenticated,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<PasswordConfirm>,
) -> Result<Response, ApiError> {
    let provider = provider(&name)?;
    if !provider.is_redirect() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "oauth_invalid",
            "Telegram привязывается через /api/auth/oauth/telegram/link",
        ));
    }
    confirm(&state, &session, &headers, peer, &body.password).await?;
    let started = state
        .oauth
        .start(
            state.db.pool(),
            provider,
            Intent::Link {
                account_id: session.0.account_id,
                session_id: session.0.id,
            },
        )
        .await
        .map_err(oauth_error)?;
    let mut response = Json(LinkStarted {
        authorize_url: started.authorize_url,
    })
    .into_response();
    response.headers_mut().append(
        header::SET_COOKIE,
        flow_cookie(
            &state.auth,
            &started.state,
            state.oauth.settings().flow_ttl.as_secs(),
        ),
    );
    Ok(response)
}

pub(crate) async fn confirm(
    state: &AppState,
    session: &Authenticated,
    headers: &HeaderMap,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    password: &str,
) -> Result<(), ApiError> {
    if session.0.kind != "web" {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "web_session_required",
            "Привязка входа — только из браузера",
        ));
    }
    let client = client_info(&state.auth, headers, peer.map(|peer| peer.0.0));
    qubite_auth::confirm_password(
        state.db.pool(),
        &state.auth.passwords,
        &state.auth.config,
        session.0.account_id,
        password,
        &client.ip,
    )
    .await?;
    Ok(())
}

/// Провайдер вернул браузер.
#[utoipa::path(get, path = "/api/auth/oauth/{provider}/callback", tag = "auth",
    params(
        ("provider" = String, Path, description = "`yandex`, `vk` или `google`"),
        ("code" = Option<String>, Query, description = "Код от провайдера"),
        ("state" = Option<String>, Query, description = "Секрет начатого входа"),
        ("device_id" = Option<String>, Query, description = "Только VK ID"),
        ("error" = Option<String>, Query, description = "Человек отказался у провайдера"),
    ),
    responses(
        (status = 303, description = "Вход выполнен (cookie сессии) и переход на сайт, или `/auth?error=…`"),
    ))]
pub async fn callback(
    State(state): State<AppState>,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    current: Option<axum::Extension<Authenticated>>,
    Path(name): Path<String>,
    Query(query): Query<Callback>,
) -> Response {
    let settings = &state.auth;
    let client = client_info(settings, &headers, peer.map(|peer| peer.0.0));
    let outcome = async {
        let provider: Provider = name.parse()?;
        let platform =
            qubite_auth::platform::effective(state.db.pool(), &state.auth.overrides).await?;
        let finished = state
            .oauth
            .finish(
                state.db.pool(),
                provider,
                cookie_value(&headers, FLOW_COOKIE),
                &query,
            )
            .await?;
        match &finished.intent {
            Intent::Login {
                return_to,
                invite_hash,
            } => {
                let issued = qubite_oauth::login(
                    state.db.pool(),
                    &settings.config,
                    provider,
                    &finished.identity,
                    &client,
                    &platform,
                    invite_hash.as_deref(),
                )
                .await?;
                Ok((return_to.clone(), Some(issued)))
            }
            Intent::Link {
                account_id,
                session_id,
            } => {
                // Вернулся тот же человек, что начинал привязку.
                if current.as_ref().map(|session| session.0.0.account_id) != Some(*account_id) {
                    return Err(Error::InvalidState);
                }
                qubite_oauth::link(
                    state.db.pool(),
                    *account_id,
                    Some(*session_id),
                    provider,
                    &finished.identity,
                )
                .await?;
                Ok((format!("/settings?linked={provider}"), None))
            }
        }
    }
    .await;
    match outcome {
        Ok((location, issued)) => {
            let mut response = redirect(&location);
            response
                .headers_mut()
                .append(header::SET_COOKIE, flow_cookie(settings, "", 0));
            match issued {
                Some(issued) => with_cookies(
                    response,
                    session_cookies(
                        settings,
                        &issued.token,
                        &issued.csrf_token,
                        issued.expires_at,
                    ),
                ),
                None => response,
            }
        }
        Err(error) => error_redirect(settings, &error, &name),
    }
}

// ---------------------------------------------------------------- Telegram

/// Данные виджета Telegram (как он их отдаёт: `id`, `first_name`, `auth_date`, `hash`…).
#[derive(Debug, Deserialize, ToSchema)]
pub struct TelegramAuth {
    #[schema(value_type = Object)]
    #[serde(flatten)]
    data: BTreeMap<String, serde_json::Value>,
}

impl TelegramAuth {
    fn fields(&self) -> Result<BTreeMap<String, String>, ApiError> {
        self.data
            .iter()
            .map(|(key, value)| {
                let text = match value {
                    serde_json::Value::String(text) => text.clone(),
                    serde_json::Value::Number(number) => number.to_string(),
                    _ => {
                        return Err(ApiError::new(
                            StatusCode::BAD_REQUEST,
                            "oauth_invalid",
                            "Неверные данные Telegram",
                        ));
                    }
                };
                Ok((key.clone(), text))
            })
            .collect()
    }
}

/// Войти через виджет Telegram.
#[utoipa::path(post, path = "/api/auth/oauth/telegram/login", tag = "auth",
    request_body = TelegramAuth,
    responses(
        (status = 200, description = "Вход выполнен; ставятся cookie", body = LoginResponse),
        (status = 400, description = "Подпись не сходится, данные устарели или уже использованы", body = ApiErrorBody),
        (status = 401, description = "Этот Telegram не привязан ни к одному аккаунту", body = ApiErrorBody),
        (status = 409, description = "Вход через Telegram выключен", body = ApiErrorBody),
    ))]
pub async fn telegram_login(
    State(state): State<AppState>,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<TelegramAuth>,
) -> Result<Response, ApiError> {
    let settings = &state.auth;
    let identity = state
        .oauth
        .verify_telegram(state.db.pool(), &body.fields()?)
        .await
        .map_err(oauth_error)?;
    let client = client_info(settings, &headers, peer.map(|peer| peer.0.0));
    let issued = qubite_oauth::login(
        state.db.pool(),
        &settings.config,
        Provider::Telegram,
        &identity,
        &client,
        &crate::platform::effective(&state).await?,
        None,
    )
    .await
    .map_err(auth_error)?;
    let session = sessions::resolve(state.db.pool(), &settings.config, &issued.token)
        .await?
        .ok_or_else(ApiError::internal)?;
    let response =
        Json(LoginResponse::new(me(&session), issued.csrf_token.clone())).into_response();
    Ok(with_cookies(
        response,
        session_cookies(
            settings,
            &issued.token,
            &issued.csrf_token,
            issued.expires_at,
        ),
    ))
}

/// Привязка Telegram: пароль и данные виджета.
#[derive(Debug, Deserialize, ToSchema)]
pub struct TelegramLink {
    password: String,
    auth: TelegramAuth,
}

/// Привязать Telegram к своему аккаунту (нужен пароль).
#[utoipa::path(post, path = "/api/auth/oauth/telegram/link", tag = "auth",
    request_body = TelegramLink,
    responses(
        (status = 204, description = "Привязан"),
        (status = 400, description = "Подпись не сходится или данные устарели", body = ApiErrorBody),
        (status = 401, description = "Нужно войти или неверный пароль", body = ApiErrorBody),
        (status = 409, description = "Выключен или уже привязан к другому аккаунту", body = ApiErrorBody),
    ))]
pub async fn telegram_link(
    State(state): State<AppState>,
    session: Authenticated,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<TelegramLink>,
) -> Result<StatusCode, ApiError> {
    confirm(&state, &session, &headers, peer, &body.password).await?;
    let identity = state
        .oauth
        .verify_telegram(state.db.pool(), &body.auth.fields()?)
        .await
        .map_err(oauth_error)?;
    qubite_oauth::link(
        state.db.pool(),
        session.0.account_id,
        Some(session.0.id),
        Provider::Telegram,
        &identity,
    )
    .await
    .map_err(oauth_error)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- привязки в профиле

/// Привязанный способ входа.
#[derive(Debug, Serialize, ToSchema)]
pub struct IdentityItem {
    provider: String,
    display_name: String,
    email: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    linked_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    last_login_at: Option<OffsetDateTime>,
}

/// Какие провайдеры привязаны к моему аккаунту.
#[utoipa::path(get, path = "/api/auth/oauth/identities", tag = "auth",
    responses(
        (status = 200, description = "Привязки", body = [IdentityItem]),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn identities(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<Vec<IdentityItem>>, ApiError> {
    let list = qubite_oauth::identities(state.db.pool(), session.0.account_id)
        .await
        .map_err(oauth_error)?;
    Ok(Json(
        list.into_iter()
            .map(|identity| IdentityItem {
                provider: identity.provider,
                display_name: identity.display_name,
                email: identity.email,
                linked_at: identity.linked_at,
                last_login_at: identity.last_login_at,
            })
            .collect(),
    ))
}

/// Отвязать провайдера (нужен пароль).
#[utoipa::path(post, path = "/api/auth/oauth/identities/{provider}/unlink", tag = "auth",
    params(("provider" = String, Path, description = "`yandex`, `vk`, `google`, `telegram`")),
    request_body = PasswordConfirm,
    responses(
        (status = 204, description = "Отвязан"),
        (status = 401, description = "Нужно войти или неверный пароль", body = ApiErrorBody),
        (status = 404, description = "Такой привязки нет", body = ApiErrorBody),
    ))]
pub async fn unlink(
    State(state): State<AppState>,
    session: Authenticated,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Path(name): Path<String>,
    Json(body): Json<PasswordConfirm>,
) -> Result<StatusCode, ApiError> {
    let provider = provider(&name)?;
    confirm(&state, &session, &headers, peer, &body.password).await?;
    let removed = qubite_oauth::unlink(state.db.pool(), session.0.account_id, provider)
        .await
        .map_err(oauth_error)?;
    if removed {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "not_found",
            "Такой привязки нет",
        ))
    }
}
