//! Навыки агента по HTTP (AGT-003): экран «Навыки» в «Агент → Записи».
//!
//! Читать, править и выгрузить навык — как любой файл папки
//! (`/api/v1/agent/files/{id}`). Здесь — то, что есть только у навыков:
//! список с описаниями и «когда пользовался», закрепить (куратор не трогает),
//! убрать в архив и вернуть одной кнопкой. Каждое действие — строка ленты,
//! откатывается. Читать — право `read` в модуле `agent`, менять — `write`.

use axum::{
    Json,
    extract::{Path, State},
};
use qubite_agent::skills::{self, OwnerChange};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    agent::{AgentAction, agent_error, who},
    auth::{ApiError, ApiErrorBody, Authenticated},
};

/// Навык.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentSkill {
    /// ID файла навыка (читать и править — `/api/v1/agent/files/{id}`).
    id: Uuid,
    /// «Навыки/ДЗ к уроку.md».
    path: String,
    name: String,
    description: String,
    version: Option<u32>,
    /// Какими инструментами пользуется (навык не даёт новых).
    tools: Vec<String>,
    /// Закреплён: куратор не трогает.
    pinned: bool,
    /// В архиве: агент его не видит.
    archived: bool,
    /// Встроенный (написан нами); копия — твоя, правится как любой.
    builtin: bool,
    /// Сколько раз агент им пользовался.
    uses: i32,
    /// Последний раз пользовался (не пользовался — когда завёл).
    #[serde(with = "time::serde::rfc3339")]
    last_used: OffsetDateTime,
    /// Когда куратор уберёт в архив, если не пользоваться (нет — закреплён или уже в архиве).
    #[serde(with = "time::serde::rfc3339::option")]
    archive_after: Option<OffsetDateTime>,
    revision: i64,
}

impl From<skills::Skill> for AgentSkill {
    fn from(skill: skills::Skill) -> Self {
        Self {
            id: skill.id,
            path: skill.path,
            name: skill.name,
            description: skill.description,
            version: skill.version,
            tools: skill.tools,
            pinned: skill.pinned,
            archived: skill.archived,
            builtin: skill.builtin,
            uses: skill.uses,
            last_used: skill.last_used,
            archive_after: skill.archive_after,
            revision: skill.revision,
        }
    }
}

/// Все навыки (и в архиве), по имени.
#[derive(Debug, Serialize, ToSchema)]
pub struct AgentSkillList {
    skills: Vec<AgentSkill>,
    /// Сколько дней без дела навык живёт до архива.
    unused_days: i64,
}

/// Закрепить или открепить.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct AgentSkillPin {
    pinned: bool,
}

/// Навыки агента: что он умеет, когда пользовался, что в архиве.
#[utoipa::path(get, path = "/api/v1/agent/skills", tag = "agent",
    responses(
        (status = 200, description = "Навыки", body = AgentSkillList),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к агенту", body = ApiErrorBody),
    ))]
pub async fn list_skills(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<AgentSkillList>, ApiError> {
    let pool = state.db.pool();
    qubite_agent::timeline::authorize_read(pool, &who(&session))
        .await
        .map_err(agent_error)?;
    let account = session.0.account_id;
    qubite_agent::memory::ensure_base(pool, account)
        .await
        .map_err(agent_error)?;
    let mut conn = pool
        .acquire()
        .await
        .map_err(|error| agent_error(error.into()))?;
    let list = skills::list(&mut conn, account)
        .await
        .map_err(agent_error)?;
    Ok(Json(AgentSkillList {
        skills: list.into_iter().map(AgentSkill::from).collect(),
        unused_days: skills::UNUSED_DAYS,
    }))
}

async fn change(
    state: &AppState,
    session: &Authenticated,
    id: Uuid,
    change: OwnerChange,
) -> Result<Json<AgentAction>, ApiError> {
    let action = skills::owner_set(state.db.pool(), &who(session), id, change)
        .await
        .map_err(agent_error)?;
    Ok(Json(action.into()))
}

/// Закрепить навык (куратор его не уберёт) или открепить.
#[utoipa::path(post, path = "/api/v1/agent/skills/{id}/pin", tag = "agent",
    request_body = AgentSkillPin,
    params(("id" = Uuid, Path, description = "ID навыка")),
    responses(
        (status = 200, description = "Строка ленты", body = AgentAction),
        (status = 400, description = "Уже так", body = ApiErrorBody),
        (status = 403, description = "Нет права менять", body = ApiErrorBody),
        (status = 404, description = "Нет такого навыка", body = ApiErrorBody),
    ))]
pub async fn pin_skill(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<AgentSkillPin>,
) -> Result<Json<AgentAction>, ApiError> {
    change(&state, &session, id, OwnerChange::Pin(request.pinned)).await
}

/// Убрать навык в архив: агент перестаёт его видеть, файл остаётся.
#[utoipa::path(post, path = "/api/v1/agent/skills/{id}/archive", tag = "agent",
    params(("id" = Uuid, Path, description = "ID навыка")),
    responses(
        (status = 200, description = "Строка ленты", body = AgentAction),
        (status = 400, description = "Уже в архиве", body = ApiErrorBody),
        (status = 404, description = "Нет такого навыка", body = ApiErrorBody),
    ))]
pub async fn archive_skill(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<AgentAction>, ApiError> {
    change(&state, &session, id, OwnerChange::Archive).await
}

/// Вернуть навык из архива; часы куратора идут заново.
#[utoipa::path(post, path = "/api/v1/agent/skills/{id}/restore", tag = "agent",
    params(("id" = Uuid, Path, description = "ID навыка")),
    responses(
        (status = 200, description = "Строка ленты", body = AgentAction),
        (status = 400, description = "Не в архиве", body = ApiErrorBody),
        (status = 404, description = "Нет такого навыка", body = ApiErrorBody),
    ))]
pub async fn restore_skill(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<AgentAction>, ApiError> {
    change(&state, &session, id, OwnerChange::Restore).await
}
