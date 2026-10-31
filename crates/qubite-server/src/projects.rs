//! Проект как папка по HTTP (PROJ-001, D-470…D-479).
//!
//! Страница проекта одним запросом: заголовок, дела, файлы, документы, память
//! агента о проекте и лента изменений. Сам проект и дела меняются, как и
//! раньше, синхронизацией (без сети — тоже); здесь — то, чего в
//! синхронизации нет: файлы (загрузка и скачивание), привязка документов проекта.
//! Текст редактора передаётся отдельным обменом Yjs (`crate::docs`).
//!
//! Права: смотреть — `read` в `planner`; файлы и привязка документов —
//! `write` в `planner`; документы ещё и в `docs` (`read` / `write`). Нет
//! права на `docs` или на агента — блок просто не приходит (`null`). Чужой
//! проект для человека не существует — 404.

use axum::{
    Json,
    body::Body,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode, header},
    response::{IntoResponse, Response},
};
use futures_util::TryStreamExt;
use qubite_agent::files as agent_files;
use qubite_planner::folder::{self, DOCS_MODULE, Doc, FeedItem};
use qubite_policy::{Read, Write};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use tokio_util::io::StreamReader;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::authorize,
};

// ---------------------------------------------------------------- схемы

/// Заголовок проекта.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectHead {
    id: Uuid,
    title: String,
    /// `orange`, `sky`, `yellow`, `green`, `peach`.
    color: String,
    /// Тег для Command без «#».
    tag: String,
    /// `active` или `archived`.
    status: String,
    /// Описание проекта.
    notes: String,
    revision: i64,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

/// Дело проекта (коротко; целиком — в синхронизации).
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectTaskItem {
    id: Uuid,
    title: String,
    /// `todo`, `doing`, `done`.
    status: String,
    /// `2026-10-23`.
    due_date: Option<String>,
    /// `16:00`.
    due_time: Option<String>,
}

/// Файл проекта.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectFileItem {
    /// Имя в проекте (оно же адрес скачивания).
    name: String,
    /// Байт.
    size: i64,
    mime: String,
    /// sha256 содержимого (hex).
    sha256: String,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

impl From<qubite_objects::Attachment> for ProjectFileItem {
    fn from(file: qubite_objects::Attachment) -> Self {
        Self {
            name: file.name,
            size: file.size,
            mime: file.mime,
            sha256: file.sha256.to_hex(),
            created_at: file.created_at,
        }
    }
}

/// Документ в списке.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectDocItem {
    id: Uuid,
    title: String,
    /// Первая строка текста.
    preview: String,
    revision: i64,
    /// Проекты, в которые он входит.
    project_ids: Vec<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

impl From<&Doc> for ProjectDocItem {
    fn from(doc: &Doc) -> Self {
        Self {
            id: doc.id,
            title: doc.title.clone(),
            preview: doc.preview(),
            revision: doc.revision,
            project_ids: doc.project_ids.clone(),
            updated_at: doc.updated_at,
        }
    }
}

/// Документ целиком.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectDoc {
    #[serde(flatten)]
    item: ProjectDocItem,
    /// Markdown до перехода в редактор; затем простой текст для поиска.
    body: String,
}

impl From<Doc> for ProjectDoc {
    fn from(doc: Doc) -> Self {
        Self {
            item: ProjectDocItem::from(&doc),
            body: doc.body,
        }
    }
}

/// Память агента о проекте — файл «Проекты/<проект>.md» в папке агента.
/// Править — `PUT /api/v1/agent/files/{file_id}` (строка ленты с откатом).
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectMemory {
    file_id: Uuid,
    /// «Проекты/Алгебра.md».
    path: String,
    body: String,
    chars: usize,
    limit: usize,
    revision: i64,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

/// Строка ленты проекта.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectFeedItem {
    /// Курсор `before` для следующей страницы.
    seq: i64,
    #[serde(with = "time::serde::rfc3339")]
    at: OffsetDateTime,
    /// `created`, `changed`, `done`, `deleted`, `restored`, `file_added`,
    /// `file_removed`, `doc_linked`, `doc_unlinked`.
    kind: String,
    /// `project`, `task`, `doc`.
    object: String,
    object_id: Uuid,
    /// Название сейчас.
    title: String,
    /// Что поменялось (`due_date`, `status`, `title`, …) или имя файла.
    details: Vec<String>,
    /// `owner` — ты (или агент от твоего имени — он виден в ленте агента), `system` — сервер.
    by: String,
}

impl From<FeedItem> for ProjectFeedItem {
    fn from(item: FeedItem) -> Self {
        Self {
            seq: item.seq,
            at: item.at,
            kind: item.kind,
            object: item.object,
            object_id: item.object_id,
            title: item.title,
            details: item.details,
            by: item.by,
        }
    }
}

/// Страница проекта.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectPage {
    project: ProjectHead,
    /// Живые дела проекта по сроку.
    tasks: Vec<ProjectTaskItem>,
    files: Vec<ProjectFileItem>,
    /// `null` — нет права на Docs.
    docs: Option<Vec<ProjectDocItem>>,
    /// Есть ли доступ к агенту (иначе память и лента агента не видны).
    agent: bool,
    /// Память агента о проекте; `null` — файла ещё нет (или нет агента).
    memory: Option<ProjectMemory>,
    /// Где завести память, если её нет: «Проекты/<название>.md» без служебных
    /// символов («Сайт: v2» → «Проекты/Сайт v2.md»).
    memory_path: String,
    /// Последние изменения (свежие сверху).
    feed: Vec<ProjectFeedItem>,
    /// События календаря (CAL-001); пока всегда пусто — точка подключения.
    events: Vec<ProjectEventItem>,
}

/// Событие календаря в проекте (появятся с CAL-001, D-472).
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectEventItem {
    id: Uuid,
    title: String,
    /// `2026-10-23`.
    date: String,
    /// `16:00`.
    time: Option<String>,
}

/// Лента: следующая страница.
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectFeed {
    items: Vec<ProjectFeedItem>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct FeedQuery {
    /// Курсор: `seq` последней показанной строки.
    before: Option<i64>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct UploadQuery {
    /// Имя файла («отчёт.pdf»); занято — допишется «(2)».
    name: String,
}

/// Новый документ в проекте.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NewProjectDoc {
    title: String,
    /// Текст Markdown, можно пустой.
    #[serde(default)]
    body: String,
}

/// Правка документа.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct ProjectDocEdit {
    title: String,
    body: String,
    /// Версия, которую ты видел; изменилась — 409, перечитать.
    revision: i64,
}

/// Список документов (привязать к проекту).
#[derive(Debug, Serialize, ToSchema)]
pub struct ProjectDocList {
    docs: Vec<ProjectDocItem>,
}

// ---------------------------------------------------------------- помощники

fn planner_error(error: qubite_planner::Error) -> ApiError {
    use qubite_planner::Error as E;
    match error {
        E::NotFound | E::Deleted => ApiError::new(StatusCode::NOT_FOUND, "not_found", "Не найдено"),
        E::Invalid(message) if message == "use_editor" => ApiError::new(
            StatusCode::CONFLICT,
            "use_editor",
            "Открой документ в редакторе",
        ),
        E::Invalid(message) => ApiError::new(StatusCode::BAD_REQUEST, "invalid", message),
        E::Conflict { .. } => ApiError::new(
            StatusCode::CONFLICT,
            "conflict",
            "Уже изменили в другом месте — перечитай",
        ),
        other => {
            tracing::error!(error = %other, "проект: ошибка");
            ApiError::internal()
        }
    }
}

async fn conn(state: &AppState) -> Result<sqlx::pool::PoolConnection<sqlx::Postgres>, ApiError> {
    state.db.pool().acquire().await.map_err(|error| {
        tracing::error!(%error, "проект: база недоступна");
        ApiError::internal()
    })
}

/// Есть ли у человека право `A` в модуле (без ошибки — для необязательных блоков).
async fn allowed<A: qubite_policy::Action>(
    state: &AppState,
    session: &Authenticated,
    module: &str,
) -> bool {
    authorize::<A>(state, session, module).await.is_ok()
}

fn date(value: Option<time::Date>) -> Option<String> {
    value.map(qubite_planner::format_date)
}

// ---------------------------------------------------------------- страница

/// Страница проекта: заголовок, дела, файлы, документы, память агента, лента.
#[utoipa::path(get, path = "/api/v1/projects/{id}", tag = "planner",
    params(("id" = Uuid, Path, description = "ID проекта")),
    responses(
        (status = 200, description = "Страница проекта", body = ProjectPage),
        (status = 403, description = "Нет доступа к Planner", body = ApiErrorBody),
        (status = 404, description = "Нет такого проекта (или он чужой)", body = ApiErrorBody),
    ))]
pub async fn project_page(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<ProjectPage>, ApiError> {
    authorize::<Read>(&state, &session, qubite_planner::MODULE).await?;
    let owner = session.0.account_id;
    let docs_allowed = allowed::<Read>(&state, &session, DOCS_MODULE).await;
    let agent =
        qubite_agent::timeline::authorize_read(state.db.pool(), &crate::agent::who(&session))
            .await
            .is_ok();
    let mut conn = conn(&state).await?;
    let project = folder::own_project(&mut conn, owner, id)
        .await
        .map_err(planner_error)?;
    let tasks = qubite_planner::list_tasks(&mut conn, owner, Some(id), 1000)
        .await
        .map_err(planner_error)?;
    let files = folder::project_files(&mut conn, owner, id)
        .await
        .map_err(planner_error)?;
    let docs = if docs_allowed {
        Some(
            folder::project_docs(&mut conn, owner, id)
                .await
                .map_err(planner_error)?
                .iter()
                .map(ProjectDocItem::from)
                .collect(),
        )
    } else {
        None
    };
    let memory = if agent {
        agent_files::of_project(&mut conn, owner, id)
            .await
            .map_err(|error| planner_error(error.into()))?
            .map(|file| {
                let (chars, limit) = file.usage();
                ProjectMemory {
                    file_id: file.id,
                    path: file.path,
                    body: file.body,
                    chars,
                    limit,
                    revision: file.revision,
                    updated_at: file.updated_at,
                }
            })
    } else {
        None
    };
    let feed = folder::project_feed(&mut conn, owner, id, None, 50)
        .await
        .map_err(planner_error)?;
    let memory_path = agent_files::project_path(&project.title);
    Ok(Json(ProjectPage {
        project: ProjectHead {
            id: project.id,
            title: project.title,
            color: project.color.as_str().to_owned(),
            tag: project.tag,
            status: project.status.as_str().to_owned(),
            notes: project.notes,
            revision: project.revision,
            created_at: project.created_at,
        },
        tasks: tasks
            .into_iter()
            .map(|task| ProjectTaskItem {
                id: task.id,
                title: task.title,
                status: task.status.as_str().to_owned(),
                due_date: date(task.due_date),
                due_time: task.due_time.map(qubite_planner::format_time),
            })
            .collect(),
        files: files.into_iter().map(ProjectFileItem::from).collect(),
        docs,
        agent,
        memory,
        memory_path,
        feed: feed.into_iter().map(ProjectFeedItem::from).collect(),
        events: Vec::new(),
    }))
}

/// Лента проекта: следующая страница (старше `before`).
#[utoipa::path(get, path = "/api/v1/projects/{id}/feed", tag = "planner",
    params(("id" = Uuid, Path, description = "ID проекта"), FeedQuery),
    responses(
        (status = 200, description = "Строки ленты", body = ProjectFeed),
        (status = 404, description = "Нет такого проекта", body = ApiErrorBody),
    ))]
pub async fn project_feed(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Query(query): Query<FeedQuery>,
) -> Result<Json<ProjectFeed>, ApiError> {
    authorize::<Read>(&state, &session, qubite_planner::MODULE).await?;
    let mut conn = conn(&state).await?;
    let items = folder::project_feed(&mut conn, session.0.account_id, id, query.before, 50)
        .await
        .map_err(planner_error)?;
    Ok(Json(ProjectFeed {
        items: items.into_iter().map(ProjectFeedItem::from).collect(),
    }))
}

// ---------------------------------------------------------------- файлы

/// Положить файл в проект: тело запроса — сам файл, `Content-Type` — его тип.
/// До 25 МБ.
#[utoipa::path(post, path = "/api/v1/projects/{id}/files", tag = "planner",
    params(("id" = Uuid, Path, description = "ID проекта"), UploadQuery),
    request_body(content = Vec<u8>, content_type = "application/octet-stream"),
    responses(
        (status = 201, description = "Файл в проекте", body = ProjectFileItem),
        (status = 400, description = "Нет имени, слишком большой, слишком много файлов", body = ApiErrorBody),
        (status = 403, description = "Нет права менять Planner", body = ApiErrorBody),
        (status = 404, description = "Нет такого проекта", body = ApiErrorBody),
        (status = 429, description = "Все слоты загрузки заняты", body = ApiErrorBody),
    ))]
pub async fn upload_project_file(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Query(query): Query<UploadQuery>,
    headers: HeaderMap,
    body: Body,
) -> Result<(StatusCode, Json<ProjectFileItem>), ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    if headers
        .get(header::CONTENT_LENGTH)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .is_some_and(|size| size > folder::MAX_FILE_BYTES as u64)
    {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid",
            format!("файл больше {} МБ", folder::MAX_FILE_BYTES / 1024 / 1024),
        ));
    }
    // Разрешение живёт до конца обработчика и освобождается также при ошибке
    // или отмене запроса. Не ждём слот и не читаем тело в очереди.
    let _permit = state.project_uploads.try_acquire().map_err(|_| {
        ApiError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "too_many_uploads",
            "Уже загружаются четыре файла. Попробуйте позже",
        )
    })?;
    let mime = headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let mut conn = conn(&state).await?;
    let content = StreamReader::new(body.into_data_stream().map_err(std::io::Error::other));
    let file = folder::add_file(
        &mut conn,
        &state.blobs,
        session.0.account_id,
        id,
        &query.name,
        mime,
        content,
    )
    .await
    .map_err(planner_error)?;
    Ok((StatusCode::CREATED, Json(file.into())))
}

/// Картинки можно показать прямо на странице; остальное — только скачать
/// (HTML или SVG с нашего адреса мог бы выполнить чужой код).
fn inline_safe(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "application/pdf"
    )
}

/// Скачать файл проекта.
#[utoipa::path(get, path = "/api/v1/projects/{id}/files/{name}", tag = "planner",
    params(("id" = Uuid, Path, description = "ID проекта"), ("name" = String, Path, description = "Имя файла")),
    responses(
        (status = 200, description = "Файл", content_type = "application/octet-stream", body = Vec<u8>),
        (status = 404, description = "Нет такого файла или проекта", body = ApiErrorBody),
    ))]
pub async fn download_project_file(
    State(state): State<AppState>,
    session: Authenticated,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result<Response, ApiError> {
    authorize::<Read>(&state, &session, qubite_planner::MODULE).await?;
    let mut conn = conn(&state).await?;
    let file = folder::project_file(&mut conn, session.0.account_id, id, &name)
        .await
        .map_err(planner_error)?;
    drop(conn);
    // Потоком с диска: файл до 25 МБ не держим в памяти целиком.
    let content = state
        .blobs
        .open(file.sha256)
        .await
        .map(|f| Body::from_stream(tokio_util::io::ReaderStream::new(f)))
        .map_err(|error| {
            tracing::error!(%error, "проект: файл пропал с диска");
            ApiError::new(
                StatusCode::NOT_FOUND,
                "not_found",
                "Файл не найден на диске",
            )
        })?;
    let (mime, disposition) = if inline_safe(&file.mime) {
        (file.mime.clone(), "inline")
    } else {
        ("application/octet-stream".to_owned(), "attachment")
    };
    let disposition = format!(
        "{disposition}; filename=\"file\"; filename*=UTF-8''{}",
        crate::agent_memory::encode_filename(&file.name)
    );
    Ok((
        [
            (header::CONTENT_TYPE, mime),
            (header::CONTENT_DISPOSITION, disposition),
            (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_owned()),
            (
                header::CONTENT_SECURITY_POLICY,
                "sandbox; default-src 'none'".to_owned(),
            ),
            (header::CACHE_CONTROL, "private, max-age=0".to_owned()),
            (header::CONTENT_LENGTH, file.size.to_string()),
        ],
        content,
    )
        .into_response())
}

/// Убрать файл из проекта.
#[utoipa::path(delete, path = "/api/v1/projects/{id}/files/{name}", tag = "planner",
    params(("id" = Uuid, Path, description = "ID проекта"), ("name" = String, Path, description = "Имя файла")),
    responses(
        (status = 204, description = "Убран"),
        (status = 403, description = "Нет права менять Planner", body = ApiErrorBody),
        (status = 404, description = "Нет такого файла или проекта", body = ApiErrorBody),
    ))]
pub async fn remove_project_file(
    State(state): State<AppState>,
    session: Authenticated,
    Path((id, name)): Path<(Uuid, String)>,
) -> Result<StatusCode, ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    let mut conn = conn(&state).await?;
    folder::remove_file(&mut conn, session.0.account_id, id, &name)
        .await
        .map_err(planner_error)?;
    Ok(StatusCode::NO_CONTENT)
}

// ---------------------------------------------------------------- документы

/// Новый документ сразу в проекте.
#[utoipa::path(post, path = "/api/v1/projects/{id}/docs", tag = "planner",
    request_body = NewProjectDoc,
    params(("id" = Uuid, Path, description = "ID проекта")),
    responses(
        (status = 201, description = "Документ", body = ProjectDoc),
        (status = 400, description = "Нет названия или слишком длинный", body = ApiErrorBody),
        (status = 403, description = "Нет права менять Planner или Docs", body = ApiErrorBody),
        (status = 404, description = "Нет такого проекта", body = ApiErrorBody),
    ))]
pub async fn create_project_doc(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<NewProjectDoc>,
) -> Result<(StatusCode, Json<ProjectDoc>), ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    authorize::<Write>(&state, &session, DOCS_MODULE).await?;
    let mut conn = conn(&state).await?;
    let doc = folder::create_doc(
        &mut conn,
        session.0.account_id,
        id,
        &request.title,
        &request.body,
    )
    .await
    .map_err(planner_error)?;
    Ok((StatusCode::CREATED, Json(doc.into())))
}

/// Привязать свой документ к проекту.
#[utoipa::path(post, path = "/api/v1/projects/{id}/docs/{doc}", tag = "planner",
    params(("id" = Uuid, Path, description = "ID проекта"), ("doc" = Uuid, Path, description = "ID документа")),
    responses(
        (status = 200, description = "Документ в проекте", body = ProjectDocItem),
        (status = 404, description = "Нет такого проекта или документа", body = ApiErrorBody),
    ))]
pub async fn link_project_doc(
    State(state): State<AppState>,
    session: Authenticated,
    Path((id, doc)): Path<(Uuid, Uuid)>,
) -> Result<Json<ProjectDocItem>, ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    authorize::<Read>(&state, &session, DOCS_MODULE).await?;
    let mut conn = conn(&state).await?;
    let doc = folder::link_doc(&mut conn, session.0.account_id, id, doc)
        .await
        .map_err(planner_error)?;
    Ok(Json(ProjectDocItem::from(&doc)))
}

/// Убрать документ из проекта (сам документ остаётся).
#[utoipa::path(delete, path = "/api/v1/projects/{id}/docs/{doc}", tag = "planner",
    params(("id" = Uuid, Path, description = "ID проекта"), ("doc" = Uuid, Path, description = "ID документа")),
    responses(
        (status = 204, description = "Убран из проекта"),
        (status = 404, description = "Не был в проекте", body = ApiErrorBody),
    ))]
pub async fn unlink_project_doc(
    State(state): State<AppState>,
    session: Authenticated,
    Path((id, doc)): Path<(Uuid, Uuid)>,
) -> Result<StatusCode, ApiError> {
    authorize::<Write>(&state, &session, qubite_planner::MODULE).await?;
    authorize::<Read>(&state, &session, DOCS_MODULE).await?;
    let mut conn = conn(&state).await?;
    folder::unlink_doc(&mut conn, session.0.account_id, id, doc)
        .await
        .map_err(planner_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct DocsQuery {
    /// Поиск по названию и тексту (русская морфология).
    q: Option<String>,
}

/// Мои документы (свежие сверху); q — поиск по названию и тексту.
#[utoipa::path(get, path = "/api/v1/docs", tag = "planner",
    params(DocsQuery),
    responses(
        (status = 200, description = "Документы", body = ProjectDocList),
        (status = 403, description = "Нет доступа к Docs", body = ApiErrorBody),
    ))]
pub async fn list_my_docs(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<DocsQuery>,
) -> Result<Json<ProjectDocList>, ApiError> {
    authorize::<Read>(&state, &session, DOCS_MODULE).await?;
    let mut conn = conn(&state).await?;
    let docs = folder::search_docs(
        &mut conn,
        session.0.account_id,
        query.q.as_deref().unwrap_or_default(),
    )
    .await
    .map_err(planner_error)?;
    Ok(Json(ProjectDocList {
        docs: docs.iter().map(ProjectDocItem::from).collect(),
    }))
}

/// Документ целиком.
#[utoipa::path(get, path = "/api/v1/docs/{id}", tag = "planner",
    params(("id" = Uuid, Path, description = "ID документа")),
    responses(
        (status = 200, description = "Документ", body = ProjectDoc),
        (status = 404, description = "Нет такого документа", body = ApiErrorBody),
    ))]
pub async fn get_my_doc(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<ProjectDoc>, ApiError> {
    authorize::<Read>(&state, &session, DOCS_MODULE).await?;
    let mut conn = conn(&state).await?;
    let doc = folder::get_doc(&mut conn, session.0.account_id, id)
        .await
        .map_err(planner_error)?;
    Ok(Json(doc.into()))
}

/// Поправить документ: название и текст.
#[utoipa::path(put, path = "/api/v1/docs/{id}", tag = "planner",
    request_body = ProjectDocEdit,
    params(("id" = Uuid, Path, description = "ID документа")),
    responses(
        (status = 200, description = "Документ", body = ProjectDoc),
        (status = 400, description = "Нет названия или слишком длинный", body = ApiErrorBody),
        (status = 404, description = "Нет такого документа", body = ApiErrorBody),
        (status = 409, description = "conflict: перечитать; use_editor: текст меняется в редакторе", body = ApiErrorBody),
    ))]
pub async fn edit_my_doc(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Json(request): Json<ProjectDocEdit>,
) -> Result<Json<ProjectDoc>, ApiError> {
    authorize::<Write>(&state, &session, DOCS_MODULE).await?;
    let mut conn = conn(&state).await?;
    let doc = folder::edit_doc(
        &mut conn,
        session.0.account_id,
        id,
        &request.title,
        &request.body,
        request.revision,
    )
    .await
    .map_err(planner_error)?;
    Ok(Json(doc.into()))
}
