//! Каталог модулей для пользователя и раздел модулей Owner Console.
//!
//! Каждый маршрут модуля начинается с [`authorize`] — без этого вызова у
//! обработчика нет `Authorized<A>`, а без него нельзя вызвать код модуля.
//! Маршруты `/api/owner/*` видит только owner; остальным (и гостям) — 404.

use axum::{
    Json,
    extract::{FromRequestParts, Path, State},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use qubite_policy::{
    Action, Authorized, CatalogEntry, Flags, ModuleId, ModulePatch, ModuleStatus, OwnerConsole,
    catalog, grants,
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
};

/// Проверить права текущего пользователя в модуле. Любой маршрут модуля
/// вызывает это первым делом.
pub async fn authorize<A: Action>(
    state: &AppState,
    session: &Authenticated,
    module: &str,
) -> Result<Authorized<A>, ApiError> {
    let module = ModuleId::new(module)?;
    Ok(qubite_policy::decide::<A>(state.db.pool(), &session.subject(), &module).await?)
}

/// Owner лично. Для всех остальных, включая гостей, — 404.
pub struct Owner(pub OwnerConsole);

impl FromRequestParts<AppState> for Owner {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let not_found = || qubite_policy::Error::Denied(qubite_policy::DenyReason::NotFound).into();
        let Some(session) = parts.extensions.get::<Authenticated>().cloned() else {
            return Err(not_found());
        };
        qubite_policy::decide_owner(state.db.pool(), &session.subject())
            .await
            .map(Owner)
            .map_err(ApiError::from)
    }
}

// ---------------------------------------------------------------- схемы

/// Права в модуле.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, ToSchema)]
pub struct ModuleFlags {
    pub read: bool,
    pub write: bool,
    pub manage: bool,
    pub ai: bool,
}

impl From<Flags> for ModuleFlags {
    fn from(flags: Flags) -> Self {
        Self {
            read: flags.read,
            write: flags.write,
            manage: flags.manage,
            ai: flags.ai,
        }
    }
}

impl From<ModuleFlags> for Flags {
    fn from(flags: ModuleFlags) -> Self {
        Self {
            read: flags.read,
            write: flags.write,
            manage: flags.manage,
            ai: flags.ai,
        }
    }
}

/// Модуль в каталоге пользователя.
#[derive(Debug, Serialize, ToSchema)]
pub struct CatalogItem {
    id: String,
    title: String,
    /// `available` — можно пользоваться; `locked` — замок, доступ выдаёт owner;
    /// `preparing` — «Готовится»; `unavailable` — «Временно недоступен».
    #[schema(example = "locked")]
    status: String,
    /// Права пользователя; все `false`, если модуль недоступен.
    flags: ModuleFlags,
}

impl From<CatalogEntry> for CatalogItem {
    fn from(entry: CatalogEntry) -> Self {
        Self {
            id: entry.id,
            title: entry.title,
            status: match entry.status {
                ModuleStatus::Available => "available",
                ModuleStatus::Locked => "locked",
                ModuleStatus::Preparing => "preparing",
                ModuleStatus::Unavailable => "unavailable",
            }
            .into(),
            flags: entry.flags.into(),
        }
    }
}

/// Модуль глазами owner.
#[derive(Debug, Serialize, ToSchema)]
pub struct ModuleItem {
    id: String,
    title: String,
    installed: bool,
    /// `enabled`, `disabled` или `maintenance`.
    state: String,
    /// `planned`, `beta` или `stable`.
    readiness: String,
    /// `locked` или `hidden` — как модуль виден без доступа.
    visibility: String,
    version: i64,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    updated_at: OffsetDateTime,
}

impl From<qubite_policy::Module> for ModuleItem {
    fn from(module: qubite_policy::Module) -> Self {
        Self {
            id: module.id,
            title: module.title,
            installed: module.installed,
            state: module.state,
            readiness: module.readiness,
            visibility: module.visibility,
            version: module.version,
            updated_at: module.updated_at,
        }
    }
}

/// Что поменять в модуле. Пустые поля не меняются.
#[derive(Debug, Default, Deserialize, ToSchema)]
pub struct ModuleChange {
    installed: Option<bool>,
    state: Option<String>,
    readiness: Option<String>,
    visibility: Option<String>,
    /// Версия, которую видел owner; если модуль уже изменили — 400.
    expected_version: Option<i64>,
}

/// Грант пользователя в модуле.
#[derive(Debug, Serialize, ToSchema)]
pub struct GrantItem {
    module_id: String,
    flags: ModuleFlags,
    granted_by: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    granted_at: OffsetDateTime,
    version: i64,
}

impl From<qubite_policy::Grant> for GrantItem {
    fn from(grant: qubite_policy::Grant) -> Self {
        Self {
            module_id: grant.module_id,
            flags: grant.flags.into(),
            granted_by: grant.granted_by,
            granted_at: grant.granted_at,
            version: grant.version,
        }
    }
}

/// Какие права выдать. Все `false` — то же, что отзыв.
#[derive(Debug, Deserialize, ToSchema)]
pub struct GrantChange {
    #[serde(flatten)]
    flags: ModuleFlags,
    /// Зачем (попадёт в журнал).
    reason: Option<String>,
}

// ---------------------------------------------------------------- пользователь

/// Каталог модулей для текущего пользователя. Скрытые модули без доступа не показываются.
#[utoipa::path(get, path = "/api/modules", tag = "modules",
    responses(
        (status = 200, description = "Модули с состоянием для этого пользователя", body = Vec<CatalogItem>),
        (status = 401, description = "Не выполнен вход", body = ApiErrorBody)
    ))]
pub async fn my_catalog(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<Vec<CatalogItem>>, ApiError> {
    let entries = catalog::catalog_for(state.db.pool(), &session.subject()).await?;
    Ok(Json(entries.into_iter().map(CatalogItem::from).collect()))
}

/// Один модуль глазами текущего пользователя.
#[utoipa::path(get, path = "/api/modules/{id}", tag = "modules",
    params(("id" = String, Path, description = "ID модуля, например `docs`")),
    responses(
        (status = 200, description = "Состояние модуля и права пользователя", body = CatalogItem),
        (status = 401, description = "Не выполнен вход", body = ApiErrorBody),
        (status = 404, description = "Нет такого модуля или он скрыт", body = ApiErrorBody)
    ))]
pub async fn my_module(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<String>,
) -> Result<Json<CatalogItem>, ApiError> {
    catalog::catalog_for(state.db.pool(), &session.subject())
        .await?
        .into_iter()
        .find(|entry| entry.id == id)
        .map(|entry| Json(entry.into()))
        .ok_or_else(|| qubite_policy::Error::Denied(qubite_policy::DenyReason::NotFound).into())
}

// ---------------------------------------------------------------- owner

/// Owner Console: все модули.
#[utoipa::path(get, path = "/api/owner/modules", tag = "owner",
    responses(
        (status = 200, description = "Весь каталог", body = Vec<ModuleItem>),
        (status = 404, description = "Не owner (раздел для остальных не существует)", body = ApiErrorBody)
    ))]
pub async fn owner_modules(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<Vec<ModuleItem>>, ApiError> {
    let modules = catalog::list_all(state.db.pool()).await?;
    Ok(Json(modules.into_iter().map(ModuleItem::from).collect()))
}

/// Owner Console: установить, включить, выключить модуль, сменить готовность и видимость.
#[utoipa::path(patch, path = "/api/owner/modules/{id}", tag = "owner", request_body = ModuleChange,
    params(("id" = String, Path, description = "ID модуля")),
    responses(
        (status = 200, description = "Модуль изменён", body = ModuleItem),
        (status = 400, description = "Неверное значение или модуль уже изменён", body = ApiErrorBody),
        (status = 404, description = "Нет модуля или не owner", body = ApiErrorBody)
    ))]
pub async fn owner_update_module(
    State(state): State<AppState>,
    Owner(owner): Owner,
    Path(id): Path<String>,
    Json(change): Json<ModuleChange>,
) -> Result<Json<ModuleItem>, ApiError> {
    let id = ModuleId::new(id)?;
    let module = catalog::update(
        state.db.pool(),
        &owner,
        &id,
        ModulePatch {
            installed: change.installed,
            state: change.state,
            readiness: change.readiness,
            visibility: change.visibility,
            expected_version: change.expected_version,
        },
    )
    .await?;
    Ok(Json(module.into()))
}

/// Owner Console: гранты пользователя.
#[utoipa::path(get, path = "/api/owner/accounts/{account_id}/grants", tag = "owner",
    params(("account_id" = Uuid, Path, description = "ID аккаунта")),
    responses(
        (status = 200, description = "Живые гранты", body = Vec<GrantItem>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn owner_grants(
    State(state): State<AppState>,
    _owner: Owner,
    Path(account_id): Path<Uuid>,
) -> Result<Json<Vec<GrantItem>>, ApiError> {
    let grants = grants::for_account(state.db.pool(), account_id).await?;
    Ok(Json(grants.into_iter().map(GrantItem::from).collect()))
}

/// Owner Console: выдать или изменить права пользователя в модуле.
#[utoipa::path(put, path = "/api/owner/accounts/{account_id}/grants/{module_id}", tag = "owner",
    request_body = GrantChange,
    params(
        ("account_id" = Uuid, Path, description = "ID аккаунта"),
        ("module_id" = String, Path, description = "ID модуля")
    ),
    responses(
        (status = 200, description = "Грант выдан", body = GrantItem),
        (status = 204, description = "Все права сняты — грант отозван"),
        (status = 404, description = "Нет аккаунта, модуля или не owner", body = ApiErrorBody)
    ))]
pub async fn owner_set_grant(
    State(state): State<AppState>,
    Owner(owner): Owner,
    Path((account_id, module_id)): Path<(Uuid, String)>,
    Json(change): Json<GrantChange>,
) -> Result<Response, ApiError> {
    let module = ModuleId::new(module_id)?;
    let grant = grants::set(
        state.db.pool(),
        &owner,
        account_id,
        &module,
        change.flags.into(),
        change.reason.as_deref(),
    )
    .await?;
    Ok(match grant {
        Some(grant) => Json(GrantItem::from(grant)).into_response(),
        None => StatusCode::NO_CONTENT.into_response(),
    })
}

/// Owner Console: отозвать права пользователя в модуле. Действует сразу.
#[utoipa::path(delete, path = "/api/owner/accounts/{account_id}/grants/{module_id}", tag = "owner",
    params(
        ("account_id" = Uuid, Path, description = "ID аккаунта"),
        ("module_id" = String, Path, description = "ID модуля")
    ),
    responses(
        (status = 204, description = "Грант отозван"),
        (status = 404, description = "Гранта не было или не owner", body = ApiErrorBody)
    ))]
pub async fn owner_revoke_grant(
    State(state): State<AppState>,
    Owner(owner): Owner,
    Path((account_id, module_id)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    let module = ModuleId::new(module_id)?;
    if grants::revoke(state.db.pool(), &owner, account_id, &module, None).await? {
        Ok(StatusCode::NO_CONTENT)
    } else {
        Err(qubite_policy::Error::Denied(qubite_policy::DenyReason::NotFound).into())
    }
}
