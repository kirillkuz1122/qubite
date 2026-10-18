//! HTTP-часть входа: cookie сессии, CSRF, маршруты `/api/auth/*`.
//!
//! Как это работает в браузере:
//! 1. `POST /api/auth/login` ставит две cookie: `qubite_session` (`HttpOnly`,
//!    её не видит JavaScript) и `qubite_csrf` (её читает сайт).
//! 2. Каждый изменяющий запрос (POST, PUT, PATCH, DELETE) с сессией должен
//!    нести заголовок `X-CSRF-Token` со значением `qubite_csrf`. Чужой сайт
//!    прочитать эту cookie не может, поэтому подделать запрос не выйдет.
//! 3. Каждый запрос сверяется с базой: отозванная сессия перестаёт работать сразу.

use std::{net::SocketAddr, sync::Arc};

use axum::{
    Json,
    extract::{ConnectInfo, FromRequestParts, Path, Request, State},
    http::{HeaderMap, HeaderValue, Method, StatusCode, header, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use qubite_auth::{
    AuthConfig, ClientInfo, IssuedSession, LoginInput, Passwords, ResolvedSession, RevokeReason,
    SessionView, sessions,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::AppState;

pub const SESSION_COOKIE: &str = "qubite_session";
pub const CSRF_COOKIE: &str = "qubite_csrf";
pub const CSRF_HEADER: &str = "x-csrf-token";

/// Настройки входа на уровне HTTP.
#[derive(Clone)]
pub struct AuthSettings {
    pub config: AuthConfig,
    pub passwords: Passwords,
    /// `Domain` для cookie (например `.qubiteapp.ru`), чтобы вход был общим
    /// для всех поддоменов. Пусто — только текущий адрес.
    pub cookie_domain: Option<String>,
    /// Флаг `Secure`: cookie только по HTTPS (браузеры разрешают и `localhost`).
    pub cookie_secure: bool,
    /// Сервер за прокси (Caddy): адрес клиента — из `X-Forwarded-For`.
    pub trust_proxy: bool,
}

impl Default for AuthSettings {
    fn default() -> Self {
        Self {
            config: AuthConfig::default(),
            passwords: Passwords::default(),
            cookie_domain: None,
            cookie_secure: true,
            trust_proxy: false,
        }
    }
}

// ---------------------------------------------------------------- ошибки

/// Ответ с ошибкой: машиночитаемый код и понятный человеку текст.
#[derive(Debug, Serialize, ToSchema)]
pub struct ApiErrorBody {
    /// Код ошибки, например `invalid_credentials`.
    error: String,
    /// Текст для человека.
    message: String,
}

#[derive(Debug)]
pub struct ApiError {
    status: StatusCode,
    code: &'static str,
    message: String,
    retry_after: Option<u64>,
}

impl ApiError {
    pub(crate) fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            retry_after: None,
        }
    }

    fn unauthenticated() -> Self {
        Self::new(
            StatusCode::UNAUTHORIZED,
            "unauthenticated",
            "Нужно войти в аккаунт",
        )
    }

    pub(crate) fn internal() -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "Внутренняя ошибка сервера",
        )
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let mut response = (
            self.status,
            Json(ApiErrorBody {
                error: self.code.into(),
                message: self.message,
            }),
        )
            .into_response();
        if let Some(seconds) = self.retry_after {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from(seconds));
        }
        response
    }
}

impl From<qubite_policy::Error> for ApiError {
    fn from(error: qubite_policy::Error) -> Self {
        use qubite_policy::Error as E;
        match error {
            E::Denied(reason) => Self::new(
                StatusCode::from_u16(reason.http_status()).unwrap_or(StatusCode::FORBIDDEN),
                reason.code(),
                reason.message(),
            ),
            E::Invalid(message) => Self::new(StatusCode::BAD_REQUEST, "invalid", message),
            other => {
                tracing::error!(error = %other, "ошибка проверки прав");
                Self::internal()
            }
        }
    }
}

impl From<qubite_auth::Error> for ApiError {
    fn from(error: qubite_auth::Error) -> Self {
        use qubite_auth::Error as E;
        match error {
            E::InvalidCredentials => Self::new(
                StatusCode::UNAUTHORIZED,
                "invalid_credentials",
                "Неверная почта или пароль",
            ),
            E::TooManyAttempts { retry_after_secs } => Self {
                retry_after: Some(retry_after_secs),
                ..Self::new(
                    StatusCode::TOO_MANY_REQUESTS,
                    "too_many_attempts",
                    format!(
                        "Слишком много попыток входа. Повторите через {} мин.",
                        retry_after_secs.div_ceil(60)
                    ),
                )
            },
            E::AccountBlocked => Self::new(
                StatusCode::FORBIDDEN,
                "account_blocked",
                "Аккаунт заблокирован",
            ),
            E::EmailNotVerified => Self::new(
                StatusCode::FORBIDDEN,
                "email_not_verified",
                "Сначала подтвердите почту",
            ),
            E::Invalid(message) => Self::new(StatusCode::BAD_REQUEST, "invalid", message),
            E::NotFound => Self::new(StatusCode::NOT_FOUND, "not_found", "Не найдено"),
            other => {
                tracing::error!(error = %other, "ошибка входа");
                Self::internal()
            }
        }
    }
}

// ---------------------------------------------------------------- cookie

fn cookie_value<'a>(headers: &'a HeaderMap, name: &str) -> Option<&'a str> {
    headers
        .get_all(header::COOKIE)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(';'))
        .filter_map(|pair| pair.trim().split_once('='))
        .find(|(key, _)| *key == name)
        .map(|(_, value)| value)
        .filter(|value| !value.is_empty())
}

fn set_cookie(
    settings: &AuthSettings,
    name: &str,
    value: &str,
    max_age: i64,
    http_only: bool,
) -> HeaderValue {
    let mut cookie = format!("{name}={value}; Path=/; Max-Age={max_age}; SameSite=Lax");
    if http_only {
        cookie.push_str("; HttpOnly");
    }
    if settings.cookie_secure {
        cookie.push_str("; Secure");
    }
    if let Some(domain) = &settings.cookie_domain {
        cookie.push_str("; Domain=");
        cookie.push_str(domain);
    }
    HeaderValue::from_str(&cookie).expect("токены и домен — допустимые символы cookie")
}

fn max_age(expires_at: OffsetDateTime) -> i64 {
    // Округляем: срок отсчитан базой чуть раньше, чем пишется ответ.
    #[allow(clippy::cast_possible_truncation)]
    let seconds = (expires_at - OffsetDateTime::now_utc())
        .as_seconds_f64()
        .round() as i64;
    seconds.max(0)
}

fn session_cookies(
    settings: &AuthSettings,
    token: &str,
    csrf: &str,
    expires_at: OffsetDateTime,
) -> [HeaderValue; 2] {
    let age = max_age(expires_at);
    [
        set_cookie(settings, SESSION_COOKIE, token, age, true),
        set_cookie(settings, CSRF_COOKIE, csrf, age, false),
    ]
}

fn clear_cookies(settings: &AuthSettings) -> [HeaderValue; 2] {
    [
        set_cookie(settings, SESSION_COOKIE, "", 0, true),
        set_cookie(settings, CSRF_COOKIE, "", 0, false),
    ]
}

fn with_cookies(mut response: Response, cookies: [HeaderValue; 2]) -> Response {
    let headers = response.headers_mut();
    for cookie in cookies {
        headers.append(header::SET_COOKIE, cookie);
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

// ---------------------------------------------------------------- сессия запроса

/// Текущая сессия запроса. Обработчик с этим аргументом без входа отвечает 401.
#[derive(Clone)]
pub struct Authenticated(pub Arc<ResolvedSession>);

impl Authenticated {
    /// Субъект для Policy Gate: этот аккаунт через эту сессию.
    pub fn subject(&self) -> qubite_policy::Subject {
        qubite_policy::Subject::account(self.0.account_id, Some(self.0.id))
    }
}

/// База не ответила при проверке сессии.
#[derive(Clone)]
struct SessionLookupFailed;

impl<S: Send + Sync> FromRequestParts<S> for Authenticated {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        if let Some(session) = parts.extensions.get::<Authenticated>() {
            return Ok(session.clone());
        }
        if parts.extensions.get::<SessionLookupFailed>().is_some() {
            return Err(ApiError::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "unavailable",
                "Сервер временно не может проверить вход",
            ));
        }
        Err(ApiError::unauthenticated())
    }
}

fn is_unsafe(method: &Method) -> bool {
    !matches!(*method, Method::GET | Method::HEAD | Method::OPTIONS)
}

/// Слой перед всеми маршрутами: находит сессию по cookie, проверяет CSRF у
/// изменяющих запросов, продлевает срок cookie, стирает cookie мёртвой сессии.
pub async fn session_layer(
    State(state): State<AppState>,
    mut request: Request,
    next: Next,
) -> Response {
    let settings = &state.auth;
    let Some(token) = cookie_value(request.headers(), SESSION_COOKIE).map(str::to_owned) else {
        return next.run(request).await;
    };

    let mut refresh = None;
    match sessions::resolve(state.db.pool(), &settings.config, &token).await {
        Ok(Some(session)) => {
            let csrf_cookie = cookie_value(request.headers(), CSRF_COOKIE).map(str::to_owned);
            // Вход по паролю CSRF не требует: у него ещё нет сессии, а
            // запрос с чужого сайта не может отправить JSON без CORS.
            if is_unsafe(request.method()) && request.uri().path() != "/api/auth/login" {
                let header_ok = request
                    .headers()
                    .get(CSRF_HEADER)
                    .and_then(|value| value.to_str().ok())
                    .is_some_and(|value| session.csrf_matches(value));
                if !header_ok {
                    return ApiError::new(
                        StatusCode::FORBIDDEN,
                        "csrf_failed",
                        "Запрос отклонён: нет или неверный CSRF-токен. Обновите страницу.",
                    )
                    .into_response();
                }
            }
            if session.extended
                && let Some(csrf) = csrf_cookie.filter(|csrf| session.csrf_matches(csrf))
            {
                refresh = Some(session_cookies(settings, &token, &csrf, session.expires_at));
            }
            request
                .extensions_mut()
                .insert(Authenticated(Arc::new(session)));
        }
        Ok(None) => {
            let response = next.run(request).await;
            return if response.headers().contains_key(header::SET_COOKIE) {
                response
            } else {
                with_cookies(response, clear_cookies(settings))
            };
        }
        Err(error) => {
            tracing::warn!(%error, "проверка сессии: база недоступна");
            request.extensions_mut().insert(SessionLookupFailed);
        }
    }

    let response = next.run(request).await;
    match refresh {
        // Обработчик сам поставил cookie (выход, новый вход) — не мешаем.
        Some(cookies) if !response.headers().contains_key(header::SET_COOKIE) => {
            with_cookies(response, cookies)
        }
        _ => response,
    }
}

fn client_info(
    settings: &AuthSettings,
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
) -> ClientInfo {
    let forwarded = settings
        .trust_proxy
        .then(|| headers.get("x-forwarded-for")?.to_str().ok())
        .flatten()
        // Последний адрес в цепочке добавил наш прокси — ему и верим.
        .and_then(|value| value.rsplit(',').next())
        .map(|ip| ip.trim().to_owned())
        .filter(|ip| !ip.is_empty());
    ClientInfo {
        ip: forwarded
            .or_else(|| peer.map(|peer| peer.ip().to_string()))
            .unwrap_or_default(),
        user_agent: headers
            .get(header::USER_AGENT)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_owned(),
    }
}

// ---------------------------------------------------------------- маршруты

#[derive(Debug, Deserialize, ToSchema)]
pub struct LoginRequest {
    /// Почта аккаунта; регистр не важен.
    email: String,
    /// Пароль. Не логируется и не сохраняется.
    password: String,
}

/// Кто вошёл.
#[derive(Debug, Serialize, ToSchema)]
pub struct Me {
    id: Uuid,
    email: String,
    display_name: String,
    /// Owner платформы (видит Owner Console).
    is_owner: bool,
    /// ID текущей сессии.
    session_id: Uuid,
    /// Когда сессия истечёт, если ей не пользоваться.
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    session_expires_at: OffsetDateTime,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct LoginResponse {
    account: Me,
    /// CSRF-токен; то же значение лежит в cookie `qubite_csrf`.
    csrf_token: String,
}

/// Сессия в списке «Мои сессии».
#[derive(Debug, Serialize, ToSchema)]
pub struct SessionItem {
    id: Uuid,
    /// `web` или `device`.
    kind: String,
    user_agent: String,
    ip: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    last_seen_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    expires_at: OffsetDateTime,
    /// Это сессия, с которой сделан запрос.
    current: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct RevokedCount {
    /// Сколько сессий закрыто.
    revoked: u64,
}

fn me(session: &ResolvedSession) -> Me {
    Me {
        id: session.account_id,
        email: session.email.clone(),
        display_name: session.display_name.clone(),
        is_owner: session.is_owner,
        session_id: session.id,
        session_expires_at: session.expires_at,
    }
}

/// Войти по почте и паролю.
#[utoipa::path(post, path = "/api/auth/login", tag = "auth", request_body = LoginRequest,
    responses(
        (status = 200, description = "Вход выполнен; ставятся cookie `qubite_session` и `qubite_csrf`", body = LoginResponse),
        (status = 401, description = "Неверная почта или пароль", body = ApiErrorBody),
        (status = 403, description = "Аккаунт заблокирован или почта не подтверждена", body = ApiErrorBody),
        (status = 429, description = "Слишком много попыток; заголовок `Retry-After` — через сколько секунд", body = ApiErrorBody)
    ))]
pub async fn login(
    State(state): State<AppState>,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<LoginRequest>,
) -> Result<Response, ApiError> {
    let settings = &state.auth;
    let client = client_info(settings, &headers, peer.map(|peer| peer.0.0));
    let issued: IssuedSession = qubite_auth::login(
        state.db.pool(),
        &settings.passwords,
        &settings.config,
        LoginInput {
            email: body.email,
            password: body.password,
            client,
        },
    )
    .await?;
    let session = sessions::resolve(state.db.pool(), &settings.config, &issued.token)
        .await?
        .ok_or_else(ApiError::internal)?;
    let cookies = session_cookies(
        settings,
        &issued.token,
        &issued.csrf_token,
        issued.expires_at,
    );
    let response = Json(LoginResponse {
        account: me(&session),
        csrf_token: issued.csrf_token,
    })
    .into_response();
    Ok(with_cookies(response, cookies))
}

/// Выйти: закрыть текущую сессию.
#[utoipa::path(post, path = "/api/auth/logout", tag = "auth",
    responses(
        (status = 204, description = "Сессия закрыта, cookie стёрты"),
        (status = 401, description = "Не выполнен вход", body = ApiErrorBody),
        (status = 403, description = "Нет или неверный CSRF-токен", body = ApiErrorBody)
    ))]
pub async fn logout(
    State(state): State<AppState>,
    Authenticated(session): Authenticated,
) -> Result<Response, ApiError> {
    sessions::revoke(
        state.db.pool(),
        session.account_id,
        session.id,
        RevokeReason::Logout,
    )
    .await?;
    Ok(with_cookies(
        StatusCode::NO_CONTENT.into_response(),
        clear_cookies(&state.auth),
    ))
}

/// Кто вошёл.
#[utoipa::path(get, path = "/api/auth/me", tag = "auth",
    responses(
        (status = 200, description = "Текущий аккаунт и сессия", body = Me),
        (status = 401, description = "Не выполнен вход", body = ApiErrorBody)
    ))]
pub async fn whoami(Authenticated(session): Authenticated) -> Json<Me> {
    Json(me(&session))
}

/// Мои открытые сессии, свежие сверху.
#[utoipa::path(get, path = "/api/auth/sessions", tag = "auth",
    responses(
        (status = 200, description = "Открытые сессии аккаунта", body = Vec<SessionItem>),
        (status = 401, description = "Не выполнен вход", body = ApiErrorBody)
    ))]
pub async fn list_sessions(
    State(state): State<AppState>,
    Authenticated(session): Authenticated,
) -> Result<Json<Vec<SessionItem>>, ApiError> {
    let items = sessions::list(state.db.pool(), session.account_id)
        .await?
        .into_iter()
        .map(|view: SessionView| SessionItem {
            current: view.id == session.id,
            id: view.id,
            kind: view.kind,
            user_agent: view.user_agent,
            ip: view.ip,
            created_at: view.created_at,
            last_seen_at: view.last_seen_at,
            expires_at: view.expires_at,
        })
        .collect();
    Ok(Json(items))
}

/// Закрыть одну свою сессию (например, на потерянном устройстве).
#[utoipa::path(delete, path = "/api/auth/sessions/{id}", tag = "auth",
    params(
        ("id" = Uuid, Path, description = "ID сессии")
    ),
    responses(
        (status = 204, description = "Сессия закрыта"),
        (status = 401, description = "Не выполнен вход", body = ApiErrorBody),
        (status = 403, description = "Нет или неверный CSRF-токен", body = ApiErrorBody),
        (status = 404, description = "Нет такой открытой сессии у этого аккаунта", body = ApiErrorBody)
    ))]
pub async fn revoke_session(
    State(state): State<AppState>,
    Authenticated(session): Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Response, ApiError> {
    let revoked = sessions::revoke(
        state.db.pool(),
        session.account_id,
        id,
        RevokeReason::Revoked,
    )
    .await?;
    if !revoked {
        return Err(qubite_auth::Error::NotFound.into());
    }
    let response = StatusCode::NO_CONTENT.into_response();
    Ok(if id == session.id {
        with_cookies(response, clear_cookies(&state.auth))
    } else {
        response
    })
}

/// «Выйти везде»: закрыть все сессии аккаунта, включая текущую.
#[utoipa::path(post, path = "/api/auth/logout-everywhere", tag = "auth",
    responses(
        (status = 200, description = "Все сессии закрыты, cookie стёрты", body = RevokedCount),
        (status = 401, description = "Не выполнен вход", body = ApiErrorBody),
        (status = 403, description = "Нет или неверный CSRF-токен", body = ApiErrorBody)
    ))]
pub async fn logout_everywhere(
    State(state): State<AppState>,
    Authenticated(session): Authenticated,
) -> Result<Response, ApiError> {
    let revoked = sessions::revoke_all(state.db.pool(), session.account_id).await?;
    Ok(with_cookies(
        Json(RevokedCount { revoked }).into_response(),
        clear_cookies(&state.auth),
    ))
}
