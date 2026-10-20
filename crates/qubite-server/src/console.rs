//! Owner Console (ACC-003): люди, журнал, сервер и подтверждение паролем.
//!
//! Все адреса — только для owner (остальным 404, как и весь `/api/owner/*`).
//! Опасные действия требуют свежего подтверждения паролем — «режим
//! подтверждения»: пароль один раз, дальше 10 минут не спрашивается (D-063,
//! D-232, D-285). Опасные: создать человека, заблокировать, закрыть его
//! сессии; тумблеры платформы и техработ; выдать и снять доступ; модули;
//! AI-модели и выбор модели для задач. Подтверждение хранится в сессии.

use std::{net::SocketAddr, sync::LazyLock};

use axum::{
    Json,
    extract::{ConnectInfo, Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use qubite_auth::{
    Passwords,
    accounts::{self, NewAccount},
};
use qubite_objects::{NewAuditEntry, audit};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::Owner,
};

/// Сколько живёт подтверждение паролем.
pub const CONFIRM_TTL_SECS: i64 = 10 * 60;

/// Когда запущен сервер (для раздела «Сервер»).
static STARTED: LazyLock<OffsetDateTime> = LazyLock::new(OffsetDateTime::now_utc);

/// Запомнить время запуска (вызывается при сборке приложения).
pub fn mark_started() {
    LazyLock::force(&STARTED);
}

fn db(error: sqlx::Error) -> ApiError {
    qubite_auth::Error::Db(error).into()
}

fn audit_error(error: qubite_objects::Error) -> ApiError {
    qubite_auth::Error::Audit(error).into()
}

fn not_found() -> ApiError {
    qubite_policy::Error::Denied(qubite_policy::DenyReason::NotFound).into()
}

// ---------------------------------------------------------------- подтверждение

#[derive(Debug, Deserialize, ToSchema)]
pub struct ConfirmRequest {
    password: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct Confirmed {
    /// До какого времени опасные действия не спрашивают пароль.
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    until: OffsetDateTime,
}

/// Подтвердить паролем: следующие 10 минут опасные действия Console пароль не спрашивают.
#[utoipa::path(post, path = "/api/owner/confirm", tag = "owner", request_body = ConfirmRequest,
    responses(
        (status = 200, description = "Подтверждено", body = Confirmed),
        (status = 401, description = "Неверный пароль", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody),
        (status = 429, description = "Слишком много неверных паролей", body = ApiErrorBody)
    ))]
pub async fn confirm(
    State(state): State<AppState>,
    _owner: Owner,
    session: Authenticated,
    peer: Option<axum::extract::Extension<ConnectInfo<SocketAddr>>>,
    headers: HeaderMap,
    Json(body): Json<ConfirmRequest>,
) -> Result<Json<Confirmed>, ApiError> {
    crate::oauth::confirm(&state, &session, &headers, peer, &body.password).await?;
    let until: OffsetDateTime = sqlx::query_scalar(
        "UPDATE sessions SET confirmed_at = now() WHERE id = $1 \
         RETURNING confirmed_at + $2::bigint * interval '1 second'",
    )
    .bind(session.0.id)
    .bind(CONFIRM_TTL_SECS)
    .fetch_one(state.db.pool())
    .await
    .map_err(db)?;
    Ok(Json(Confirmed { until }))
}

/// Опасное действие: пароль подтверждён в этой сессии не раньше 10 минут назад (D-285).
pub(crate) async fn require_confirmed(
    state: &AppState,
    session: &Authenticated,
) -> Result<(), ApiError> {
    let fresh: bool = sqlx::query_scalar(
        "SELECT coalesce(confirmed_at > now() - $2::bigint * interval '1 second', false) \
         FROM sessions WHERE id = $1",
    )
    .bind(session.0.id)
    .bind(CONFIRM_TTL_SECS)
    .fetch_optional(state.db.pool())
    .await
    .map_err(db)?
    .unwrap_or(false);
    if fresh {
        Ok(())
    } else {
        Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "confirm_required",
            "Подтвердите паролем — это опасное действие",
        ))
    }
}

// ---------------------------------------------------------------- люди

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct AccountItem {
    id: Uuid,
    email: String,
    display_name: String,
    /// `active`, `pending_email` или `blocked`.
    status: String,
    is_owner: bool,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    created_at: OffsetDateTime,
    /// Когда последний раз был в Qubite.
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    last_seen_at: Option<OffsetDateTime>,
    /// Живых сессий.
    sessions: i64,
    /// Модулей с доступом.
    modules: i64,
    /// Есть ли пароль.
    has_password: bool,
    /// Привязанные провайдеры: `yandex`, `vk`, `google`, `telegram`.
    providers: Vec<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct AccountsQuery {
    /// Часть почты или имени.
    q: Option<String>,
    /// `active`, `pending_email` или `blocked`.
    status: Option<String>,
}

/// Общая часть запроса «люди» (литерал — для `concat!`).
macro_rules! account_select {
    () => {
        "SELECT a.id, a.email, a.display_name, a.status, \
       (o.account_id IS NOT NULL) AS is_owner, a.created_at, \
       (SELECT max(s.last_seen_at) FROM sessions s WHERE s.account_id = a.id) AS last_seen_at, \
       (SELECT count(*) FROM sessions s WHERE s.account_id = a.id \
          AND s.revoked_at IS NULL AND s.expires_at > now()) AS sessions, \
       (SELECT count(*) FROM module_grants g WHERE g.account_id = a.id \
          AND g.revoked_at IS NULL) AS modules, \
       EXISTS (SELECT 1 FROM credentials_password c WHERE c.account_id = a.id) AS has_password, \
       ARRAY(SELECT i.provider FROM oauth_identities i WHERE i.account_id = a.id \
          ORDER BY i.provider) AS providers \
     FROM accounts a LEFT JOIN platform_owner o ON o.account_id = a.id"
    };
}

async fn account_item(state: &AppState, id: Uuid) -> Result<AccountItem, ApiError> {
    sqlx::query_as(concat!(account_select!(), " WHERE a.id = $1"))
        .bind(id)
        .fetch_optional(state.db.pool())
        .await
        .map_err(db)?
        .ok_or_else(not_found)
}

/// Люди: список с поиском и фильтром (до 200, новые сверху).
#[utoipa::path(get, path = "/api/owner/accounts", tag = "owner", params(AccountsQuery),
    responses(
        (status = 200, description = "Аккаунты", body = Vec<AccountItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn list_accounts(
    State(state): State<AppState>,
    _owner: Owner,
    Query(query): Query<AccountsQuery>,
) -> Result<Json<Vec<AccountItem>>, ApiError> {
    let q = query.q.unwrap_or_default().trim().to_lowercase();
    let pattern = format!(
        "%{}%",
        q.replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let items: Vec<AccountItem> = sqlx::query_as(concat!(
        account_select!(),
        " WHERE ($1 = '' OR a.email LIKE $2 OR lower(a.display_name) LIKE $2) \
           AND ($3 = '' OR a.status = $3) \
         ORDER BY a.created_at DESC LIMIT 200"
    ))
    .bind(&q)
    .bind(&pattern)
    .bind(query.status.unwrap_or_default())
    .fetch_all(state.db.pool())
    .await
    .map_err(db)?;
    Ok(Json(items))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct NewAccountRequest {
    email: String,
    #[serde(default)]
    display_name: String,
    /// Не короче 10 символов. Человек может сменить его через «Забыли пароль».
    password: String,
}

/// Создать человека вручную: аккаунт сразу активен, почта считается подтверждённой.
/// Модулей у него нет — их выдаёт owner (D-054). Нужно подтверждение паролем.
#[utoipa::path(post, path = "/api/owner/accounts", tag = "owner", request_body = NewAccountRequest,
    responses(
        (status = 201, description = "Создан", body = AccountItem),
        (status = 400, description = "`invalid` (почта, имя, слабый пароль)", body = ApiErrorBody),
        (status = 403, description = "`confirm_required`", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody),
        (status = 409, description = "`email_taken`", body = ApiErrorBody)
    ))]
pub async fn create_account(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Json(body): Json<NewAccountRequest>,
) -> Result<(StatusCode, Json<AccountItem>), ApiError> {
    require_confirmed(&state, &session).await?;
    let passwords: &Passwords = &state.auth.passwords;
    let account = accounts::create(
        state.db.pool(),
        passwords,
        NewAccount {
            email: &body.email,
            display_name: &body.display_name,
            password: &body.password,
            email_verified: true,
        },
        Some(owner.account_id()),
    )
    .await?;
    Ok((
        StatusCode::CREATED,
        Json(account_item(&state, account.id).await?),
    ))
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AccountChange {
    /// `blocked` — заблокировать (все сессии закрываются), `active` — разблокировать.
    status: String,
    /// Зачем (попадёт в журнал).
    reason: Option<String>,
}

/// Заблокировать или разблокировать человека. Себя — нельзя (ACC-12).
#[utoipa::path(patch, path = "/api/owner/accounts/{id}", tag = "owner", request_body = AccountChange,
    params(("id" = Uuid, Path, description = "ID аккаунта")),
    responses(
        (status = 200, description = "Изменено", body = AccountItem),
        (status = 400, description = "`invalid` или `self_forbidden`", body = ApiErrorBody),
        (status = 403, description = "`confirm_required`", body = ApiErrorBody),
        (status = 404, description = "Нет аккаунта или не owner", body = ApiErrorBody)
    ))]
pub async fn change_account(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(body): Json<AccountChange>,
) -> Result<Json<AccountItem>, ApiError> {
    if id == owner.account_id() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "self_forbidden",
            "Себя заблокировать нельзя",
        ));
    }
    let block = match body.status.as_str() {
        "blocked" => true,
        "active" => false,
        _ => {
            return Err(
                qubite_auth::Error::Invalid("статус — `active` или `blocked`".into()).into(),
            );
        }
    };
    require_confirmed(&state, &session).await?;
    let mut tx = state.db.pool().begin().await.map_err(db)?;
    let before: Option<String> =
        sqlx::query_scalar("SELECT status FROM accounts WHERE id = $1 FOR UPDATE")
            .bind(id)
            .fetch_optional(&mut *tx)
            .await
            .map_err(db)?;
    let before = before.ok_or_else(not_found)?;
    // Разблокированный без подтверждённой почты снова ждёт подтверждения.
    let after: String = sqlx::query_scalar(
        "UPDATE accounts SET updated_at = now(), status = CASE WHEN $2 THEN 'blocked' \
           WHEN email_verified_at IS NULL THEN 'pending_email' ELSE 'active' END \
         WHERE id = $1 RETURNING status",
    )
    .bind(id)
    .bind(block)
    .fetch_one(&mut *tx)
    .await
    .map_err(db)?;
    let closed = if block {
        close_sessions(&mut tx, id).await?
    } else {
        0
    };
    if before != after {
        audit::record(
            &mut tx,
            NewAuditEntry {
                actor_id: Some(owner.account_id()),
                action: if block {
                    "account.blocked"
                } else {
                    "account.unblocked"
                }
                .into(),
                target_kind: "account".into(),
                target_id: Some(id.to_string()),
                before: Some(serde_json::json!({ "status": before })),
                after: Some(serde_json::json!({ "status": after, "sessions_revoked": closed })),
                reason: body.reason.map(|reason| reason.chars().take(500).collect()),
                ..NewAuditEntry::default()
            },
        )
        .await
        .map_err(audit_error)?;
    }
    tx.commit().await.map_err(db)?;
    Ok(Json(account_item(&state, id).await?))
}

async fn close_sessions(conn: &mut sqlx::PgConnection, account_id: Uuid) -> Result<i64, ApiError> {
    let closed = sqlx::query(
        "UPDATE sessions SET revoked_at = now(), revoke_reason = 'revoked' \
         WHERE account_id = $1 AND revoked_at IS NULL",
    )
    .bind(account_id)
    .execute(conn)
    .await
    .map_err(db)?
    .rows_affected();
    Ok(i64::try_from(closed).unwrap_or(i64::MAX))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct SessionsClosed {
    /// Сколько сессий закрыто.
    revoked: i64,
}

/// Закрыть все сессии человека: ему придётся войти заново. Свои — через «Аккаунт».
#[utoipa::path(post, path = "/api/owner/accounts/{id}/sessions/revoke", tag = "owner",
    params(("id" = Uuid, Path, description = "ID аккаунта")),
    responses(
        (status = 200, description = "Закрыто", body = SessionsClosed),
        (status = 400, description = "`self_forbidden`", body = ApiErrorBody),
        (status = 403, description = "`confirm_required`", body = ApiErrorBody),
        (status = 404, description = "Нет аккаунта или не owner", body = ApiErrorBody)
    ))]
pub async fn revoke_sessions(
    State(state): State<AppState>,
    Owner(owner): Owner,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<SessionsClosed>, ApiError> {
    if id == owner.account_id() {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "self_forbidden",
            "Свои сессии закрываются на странице «Аккаунт»",
        ));
    }
    require_confirmed(&state, &session).await?;
    account_item(&state, id).await?;
    let mut tx = state.db.pool().begin().await.map_err(db)?;
    let revoked = close_sessions(&mut tx, id).await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(owner.account_id()),
            action: "auth.sessions_revoked_by_owner".into(),
            target_kind: "account".into(),
            target_id: Some(id.to_string()),
            after: Some(serde_json::json!({ "sessions_revoked": revoked })),
            ..NewAuditEntry::default()
        },
    )
    .await
    .map_err(audit_error)?;
    tx.commit().await.map_err(db)?;
    Ok(Json(SessionsClosed { revoked }))
}

// ---------------------------------------------------------------- журнал

#[derive(Debug, Serialize, ToSchema, sqlx::FromRow)]
pub struct AuditItem {
    seq: i64,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    at: OffsetDateTime,
    actor_id: Option<Uuid>,
    /// Почта того, кто сделал (нет — система).
    actor_email: Option<String>,
    /// Например `platform.setting_changed`, `account.blocked`, `auth.login`.
    action: String,
    target_kind: String,
    target_id: Option<String>,
    #[schema(value_type = Option<Object>)]
    before: Option<serde_json::Value>,
    #[schema(value_type = Option<Object>)]
    after: Option<serde_json::Value>,
    reason: Option<String>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct AuditQuery {
    /// Начало действия: `auth`, `account`, `platform`, `module`, `ai`…
    kind: Option<String>,
    /// Только записи этого человека (кто сделал или с кем сделали).
    account: Option<Uuid>,
    /// Записи старше этого номера (для «Ещё»).
    before: Option<i64>,
    /// Сколько, 1…200, по умолчанию 50.
    limit: Option<i64>,
}

/// Журнал: неизменяемая лента действий, новые сверху.
#[utoipa::path(get, path = "/api/owner/audit", tag = "owner", params(AuditQuery),
    responses(
        (status = 200, description = "Записи журнала", body = Vec<AuditItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn audit_log(
    State(state): State<AppState>,
    _owner: Owner,
    Query(query): Query<AuditQuery>,
) -> Result<Json<Vec<AuditItem>>, ApiError> {
    let kind = query
        .kind
        .unwrap_or_default()
        .trim()
        .chars()
        .filter(|c| c.is_ascii_lowercase() || *c == '_' || *c == '.')
        .collect::<String>();
    let items: Vec<AuditItem> = sqlx::query_as(
        "SELECT l.seq, l.at, l.actor_id, a.email AS actor_email, l.action, l.target_kind, \
                l.target_id, l.before, l.after, l.reason \
         FROM audit_log l LEFT JOIN accounts a ON a.id = l.actor_id \
         WHERE ($1 = '' OR l.action = $1 OR l.action LIKE $1 || '.%') \
           AND ($2::uuid IS NULL OR l.actor_id = $2 OR (l.target_kind = 'account' AND l.target_id = $2::text)) \
           AND ($3::bigint IS NULL OR l.seq < $3) \
         ORDER BY l.seq DESC LIMIT $4",
    )
    .bind(&kind)
    .bind(query.account)
    .bind(query.before)
    .bind(query.limit.unwrap_or(50).clamp(1, 200))
    .fetch_all(state.db.pool())
    .await
    .map_err(db)?;
    Ok(Json(items))
}

// ---------------------------------------------------------------- сервер

#[derive(Debug, Serialize, ToSchema)]
pub struct ServerInfo {
    /// Версия сервера.
    version: &'static str,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    started_at: OffsetDateTime,
    uptime_secs: i64,
    /// Последняя применённая миграция базы.
    migration: i64,
    accounts: i64,
    /// Живых сессий у всех.
    sessions: i64,
    /// Записей в журнале.
    audit_entries: i64,
}

/// Сервер (базово): версия, время работы, база.
#[utoipa::path(get, path = "/api/owner/server", tag = "owner",
    responses(
        (status = 200, description = "Состояние сервера", body = ServerInfo),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn server_info(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<ServerInfo>, ApiError> {
    let (migration, accounts, sessions, audit_entries): (i64, i64, i64, i64) = sqlx::query_as(
        "SELECT (SELECT coalesce(max(version), 0) FROM _sqlx_migrations WHERE success), \
                (SELECT count(*) FROM accounts), \
                (SELECT count(*) FROM sessions WHERE revoked_at IS NULL AND expires_at > now()), \
                (SELECT count(*) FROM audit_log)",
    )
    .fetch_one(state.db.pool())
    .await
    .map_err(db)?;
    let started_at = *STARTED;
    Ok(Json(ServerInfo {
        version: env!("CARGO_PKG_VERSION"),
        started_at,
        uptime_secs: (OffsetDateTime::now_utc() - started_at).whole_seconds(),
        migration,
        accounts,
        sessions,
        audit_entries,
    }))
}
