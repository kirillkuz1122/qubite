//! Входящие по обычному HTTP (CMD-001): список, запись мысли, архив, корзина.
//!
//! Изменения идут через тот же движок синхронизации, что и `/api/v1/sync/push`
//! (одна проверка полей, одна история, «есть новое» на все устройства).
//! Права — модуль `inbox`: `read` для чтения, `write` для изменений.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use qubite_inbox::{Item, Link, View};
use qubite_policy::{Read, Write};
use qubite_sync::{OpKind, OpResult, Operation, RejectReason};
use qubite_sync_server::Rules;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::authorize,
    sync::sync_error,
};

/// Элемент Входящих.
#[derive(Debug, Serialize, ToSchema)]
pub struct InboxItem {
    id: Uuid,
    /// Первая строка мысли.
    title: String,
    /// Полный текст.
    body: String,
    /// Версия: её передают при изменении, чтобы не затереть чужую правку.
    revision: i64,
    /// `text`, `link`, `file`, `voice`.
    kind: String,
    url: Option<String>,
    /// `web`, `desktop`, `android`, `telegram`, `api`.
    source: String,
    /// `new` — ждёт разбора; `archived` — разобрано или в архиве.
    status: String,
    /// В корзине (можно вернуть).
    deleted: bool,
    #[serde(with = "time::serde::rfc3339")]
    captured_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    archived_at: Option<OffsetDateTime>,
    /// Command не уверен, что это и куда положить, — «посмотри сам».
    needs_review: bool,
    review_reason: Option<String>,
    triage: InboxTriage,
}

/// Результат разбора (заполняют CMD-003 и CMD-004).
#[derive(Debug, Serialize, ToSchema)]
pub struct InboxTriage {
    /// `pending`, `suggested`, `confirmed`, `skipped`.
    status: String,
    /// `task`, `note`, `project_thought`, `agent_request`, `other`.
    intent: Option<String>,
    /// Кто разобрал (`by`), уверенность, краткая суть.
    #[schema(value_type = Object)]
    details: Value,
}

/// Объект, с которым связан элемент.
#[derive(Debug, Serialize, ToSchema)]
pub struct InboxLink {
    to_id: Uuid,
    /// Тип объекта, например `planner.project`.
    to_type: String,
    title: String,
    /// `manual`, `ai`, `system`.
    source: String,
    confidence: Option<f32>,
}

/// Элемент вместе со связями.
#[derive(Debug, Serialize, ToSchema)]
pub struct InboxItemDetail {
    item: InboxItem,
    links: Vec<InboxLink>,
}

fn as_text<T: Serialize>(value: T) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|value| value.as_str().map(str::to_owned))
        .unwrap_or_default()
}

impl From<Item> for InboxItem {
    fn from(item: Item) -> Self {
        Self {
            id: item.id,
            title: item.title,
            body: item.body,
            revision: item.revision,
            kind: as_text(item.kind),
            url: item.url,
            source: as_text(item.source),
            status: as_text(item.status),
            deleted: item.deleted,
            captured_at: item.captured_at,
            archived_at: item.archived_at,
            needs_review: item.needs_review,
            review_reason: item.review_reason,
            triage: InboxTriage {
                status: as_text(item.triage.status),
                intent: item.triage.intent.map(as_text),
                details: item.triage.details,
            },
        }
    }
}

impl From<Link> for InboxLink {
    fn from(link: Link) -> Self {
        Self {
            to_id: link.to_id,
            to_type: link.to_type,
            title: link.title,
            source: link.source,
            confidence: link.confidence,
        }
    }
}

fn not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "not_found", "Элемент не найден")
}

fn objects_error(error: qubite_objects::Error) -> ApiError {
    tracing::error!(%error, "Входящие: ошибка чтения");
    ApiError::internal()
}

async fn load(state: &AppState, owner: Uuid, id: Uuid) -> Result<Item, ApiError> {
    let mut conn = state.db.pool().acquire().await.map_err(|error| {
        tracing::error!(%error, "Входящие: база недоступна");
        ApiError::internal()
    })?;
    qubite_inbox::get(&mut conn, owner, id)
        .await
        .map_err(objects_error)?
        .ok_or_else(not_found)
}

/// Применить одну операцию от имени сессии (устройство — сама сессия).
async fn apply(
    state: &AppState,
    session: &Authenticated,
    object_id: Uuid,
    base_revision: Option<i64>,
    kind: OpKind,
) -> Result<OpResult, ApiError> {
    let rules = Rules {
        registry: state.sync.clone(),
        strict: true,
        // Право write во Входящих уже проверено.
        writable: Some([qubite_inbox::MODULE.to_owned()].into()),
        readable: None,
    };
    let op = Operation {
        op_id: Uuid::now_v7(),
        object_id,
        base_revision,
        kind,
    };
    qubite_sync_server::apply_one(
        state.db.pool(),
        session.0.account_id,
        session.0.id,
        &op,
        &rules,
    )
    .await
    .map_err(sync_error)
}

/// Ответ на изменение: применено — свежий элемент; иначе понятная ошибка.
async fn finish(
    state: &AppState,
    owner: Uuid,
    id: Uuid,
    result: OpResult,
) -> Result<Json<InboxItem>, ApiError> {
    match result {
        OpResult::Applied { .. } => Ok(Json(load(state, owner, id).await?.into())),
        OpResult::Conflict { current, .. } => Err(ApiError::new(
            StatusCode::CONFLICT,
            "conflict",
            format!(
                "Элемент уже изменили (версия {}). Обновите и повторите.",
                current.revision
            ),
        )),
        // Объект другого модуля для Входящих — «нет такого элемента».
        OpResult::Rejected {
            reason: RejectReason::NotFound | RejectReason::Forbidden,
            ..
        } => Err(not_found()),
        OpResult::Rejected { message, .. } => {
            Err(ApiError::new(StatusCode::BAD_REQUEST, "invalid", message))
        }
    }
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct ListQuery {
    /// `new` (по умолчанию), `review` («посмотри сам»), `archived` или `trash`.
    view: Option<String>,
    /// До 500, по умолчанию 100.
    limit: Option<i64>,
}

/// Элементы Входящих, свежие сверху.
#[utoipa::path(get, path = "/api/v1/inbox", tag = "inbox", params(ListQuery),
    responses(
        (status = 200, description = "Список", body = [InboxItem]),
        (status = 400, description = "Неизвестный вид списка", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет доступа к Входящим", body = ApiErrorBody),
    ))]
pub async fn list(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<ListQuery>,
) -> Result<Json<Vec<InboxItem>>, ApiError> {
    let proof = authorize::<Read>(&state, &session, qubite_inbox::MODULE).await?;
    let view: View = serde_json::from_value(json!(query.view.as_deref().unwrap_or("new")))
        .map_err(|_| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid",
                "Вид: new, review, archived или trash",
            )
        })?;
    let mut conn = state.db.pool().acquire().await.map_err(|error| {
        tracing::error!(%error, "Входящие: база недоступна");
        ApiError::internal()
    })?;
    let items = qubite_inbox::list(
        &mut conn,
        proof.account_id(),
        view,
        query.limit.unwrap_or(100),
    )
    .await
    .map_err(objects_error)?;
    Ok(Json(items.into_iter().map(InboxItem::from).collect()))
}

/// Записать мысль.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct CaptureRequest {
    /// ID, придуманный клиентом (UUIDv7). Повтор с тем же ID не создаёт дубль.
    id: Option<Uuid>,
    text: String,
    url: Option<String>,
    /// `web` (по умолчанию), `desktop`, `android`, `api`.
    source: Option<String>,
}

/// Записать мысль во Входящие.
#[utoipa::path(post, path = "/api/v1/inbox", tag = "inbox", request_body = CaptureRequest,
    responses(
        (status = 201, description = "Записано", body = InboxItem),
        (status = 200, description = "Такой ID уже записан — возвращается он же", body = InboxItem),
        (status = 400, description = "Пустая мысль, неверная ссылка или слишком длинный текст", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет права записывать во Входящие", body = ApiErrorBody),
    ))]
pub async fn capture(
    State(state): State<AppState>,
    session: Authenticated,
    Json(request): Json<CaptureRequest>,
) -> Result<(StatusCode, Json<InboxItem>), ApiError> {
    let proof = authorize::<Write>(&state, &session, qubite_inbox::MODULE).await?;
    let owner = proof.account_id();
    if request.source.as_deref() == Some("telegram") {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid",
            "Источник telegram ставит только бот",
        ));
    }
    let id = request.id.unwrap_or_else(Uuid::now_v7);
    let mut fields = json!({ "body": request.text });
    if let Some(url) = &request.url {
        fields["url"] = json!(url);
    }
    if let Some(source) = &request.source {
        fields["source"] = json!(source);
    }
    let title = qubite_inbox::title_from(&request.text);
    let title = if title.is_empty() {
        request
            .url
            .clone()
            .map(|url| qubite_inbox::title_from(&url))
            .unwrap_or_default()
    } else {
        title
    };
    let result = apply(
        &state,
        &session,
        id,
        None,
        OpKind::Create {
            object_type: qubite_inbox::ITEM_TYPE.into(),
            title,
            fields: Some(fields),
        },
    )
    .await?;
    if let OpResult::Rejected { .. } = &result
        && request.id.is_some()
        && let Ok(existing) = load(&state, owner, id).await
    {
        return Ok((StatusCode::OK, Json(existing.into())));
    }
    let item = finish(&state, owner, id, result).await?;
    Ok((StatusCode::CREATED, item))
}

/// Элемент со связями.
#[utoipa::path(get, path = "/api/v1/inbox/{id}", tag = "inbox",
    params(("id" = Uuid, Path, description = "ID элемента")),
    responses(
        (status = 200, description = "Элемент", body = InboxItemDetail),
        (status = 404, description = "Нет такого (или чужой)", body = ApiErrorBody),
    ))]
pub async fn detail(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<InboxItemDetail>, ApiError> {
    let proof = authorize::<Read>(&state, &session, qubite_inbox::MODULE).await?;
    let item = load(&state, proof.account_id(), id).await?;
    let mut conn = state.db.pool().acquire().await.map_err(|error| {
        tracing::error!(%error, "Входящие: база недоступна");
        ApiError::internal()
    })?;
    let links = qubite_inbox::links(&mut conn, id)
        .await
        .map_err(objects_error)?;
    Ok(Json(InboxItemDetail {
        item: item.into(),
        links: links.into_iter().map(InboxLink::from).collect(),
    }))
}

/// Изменение элемента.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ChangeRequest {
    /// Версия, которую видел клиент.
    revision: i64,
    /// `new` или `archived`.
    status: Option<String>,
    body: Option<String>,
}

/// Изменить текст или статус (в архив и обратно).
#[utoipa::path(patch, path = "/api/v1/inbox/{id}", tag = "inbox", request_body = ChangeRequest,
    params(("id" = Uuid, Path, description = "ID элемента")),
    responses(
        (status = 200, description = "Изменено", body = InboxItem),
        (status = 404, description = "Нет такого (или чужой)", body = ApiErrorBody),
        (status = 409, description = "Элемент уже изменили — версия устарела", body = ApiErrorBody),
    ))]
pub async fn change(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<ChangeRequest>,
) -> Result<Json<InboxItem>, ApiError> {
    let proof = authorize::<Write>(&state, &session, qubite_inbox::MODULE).await?;
    let mut fields = json!({});
    if let Some(status) = request.status {
        fields["status"] = json!(status);
    }
    if let Some(body) = request.body {
        fields["body"] = json!(body);
    }
    let result = apply(
        &state,
        &session,
        id,
        Some(request.revision),
        OpKind::Patch { fields },
    )
    .await?;
    finish(&state, proof.account_id(), id, result).await
}

/// Версия для удаления и возврата.
#[derive(Debug, Deserialize, ToSchema, IntoParams)]
pub struct RevisionBody {
    revision: i64,
}

/// Убрать в корзину (вернуть — `restore`).
#[utoipa::path(delete, path = "/api/v1/inbox/{id}", tag = "inbox",
    params(("id" = Uuid, Path, description = "ID элемента"), RevisionBody),
    responses(
        (status = 200, description = "В корзине", body = InboxItem),
        (status = 404, description = "Нет такого (или чужой)", body = ApiErrorBody),
        (status = 409, description = "Версия устарела", body = ApiErrorBody),
    ))]
pub async fn remove(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Query(query): Query<RevisionBody>,
) -> Result<Json<InboxItem>, ApiError> {
    let proof = authorize::<Write>(&state, &session, qubite_inbox::MODULE).await?;
    let result = apply(&state, &session, id, Some(query.revision), OpKind::Delete).await?;
    finish(&state, proof.account_id(), id, result).await
}

/// Вернуть из корзины (отмена удаления).
#[utoipa::path(post, path = "/api/v1/inbox/{id}/restore", tag = "inbox", request_body = RevisionBody,
    params(("id" = Uuid, Path, description = "ID элемента")),
    responses(
        (status = 200, description = "Возвращён", body = InboxItem),
        (status = 404, description = "Нет такого (или чужой)", body = ApiErrorBody),
        (status = 409, description = "Версия устарела", body = ApiErrorBody),
    ))]
pub async fn restore(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<RevisionBody>,
) -> Result<Json<InboxItem>, ApiError> {
    let proof = authorize::<Write>(&state, &session, qubite_inbox::MODULE).await?;
    let result = apply(
        &state,
        &session,
        id,
        Some(request.revision),
        OpKind::Restore,
    )
    .await?;
    finish(&state, proof.account_id(), id, result).await
}

/// Решение владельца: что это и с чем связать.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct DecideRequest {
    revision: i64,
    /// `task`, `note`, `project_thought`, `agent_request`, `other`.
    intent: String,
    /// Свои объекты (проекты, задачи, документы), к которым относится элемент.
    #[serde(default)]
    link_to: Vec<Uuid>,
}

/// Владелец решил сам («посмотри сам»): элемент разобран и уходит в архив.
#[utoipa::path(post, path = "/api/v1/inbox/{id}/decide", tag = "inbox", request_body = DecideRequest,
    params(("id" = Uuid, Path, description = "ID элемента")),
    responses(
        (status = 200, description = "Разобрано, в архиве", body = InboxItem),
        (status = 400, description = "Неизвестный вид", body = ApiErrorBody),
        (status = 404, description = "Нет такого элемента или объекта для связи", body = ApiErrorBody),
        (status = 409, description = "Версия устарела", body = ApiErrorBody),
    ))]
pub async fn decide(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<DecideRequest>,
) -> Result<Json<InboxItem>, ApiError> {
    let proof = authorize::<Write>(&state, &session, qubite_inbox::MODULE).await?;
    let intent: qubite_inbox::Intent = request
        .intent
        .parse()
        .map_err(|message: String| ApiError::new(StatusCode::BAD_REQUEST, "invalid", message))?;
    let mut conn = state.db.pool().acquire().await.map_err(|error| {
        tracing::error!(%error, "Входящие: база недоступна");
        ApiError::internal()
    })?;
    let item = qubite_inbox::decide(
        &mut conn,
        proof.account_id(),
        id,
        request.revision,
        proof.account_id(),
        intent,
        request.link_to,
    )
    .await
    .map_err(|error| match error {
        qubite_objects::Error::NotFound | qubite_objects::Error::Deleted => not_found(),
        qubite_objects::Error::Conflict { current, .. } => ApiError::new(
            StatusCode::CONFLICT,
            "conflict",
            format!("Элемент уже изменили (версия {current}). Обновите и повторите."),
        ),
        qubite_objects::Error::Invalid(message) => {
            ApiError::new(StatusCode::BAD_REQUEST, "invalid", message)
        }
        other => objects_error(other),
    })?;
    Ok(Json(item.into()))
}

/// Раз в час удалять навсегда то, что лежит в корзине Входящих дольше `days`
/// дней (D-199). `0` — не чистить.
pub fn spawn_trash_cleanup(pool: sqlx::PgPool, days: u32) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        if days == 0 {
            return;
        }
        let mut every = tokio::time::interval(std::time::Duration::from_secs(60 * 60));
        loop {
            every.tick().await;
            let result = async {
                let mut conn = pool.acquire().await?;
                qubite_inbox::purge_trash(&mut conn, days).await
            }
            .await;
            match result {
                Ok(0) => {}
                Ok(count) => tracing::info!(count, days, "корзина Входящих очищена"),
                Err(error) => tracing::warn!(%error, "корзина Входящих не очищена"),
            }
        }
    })
}
