//! Обмен Yjs v1. Событие objects::bump будит обычный /sync/ws через PostgreSQL.

use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::StatusCode,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use qubite_planner::{folder::DOCS_MODULE, mentions, ydoc};
use qubite_policy::{Read, Write};
use serde::{Deserialize, Deserializer, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::authorize,
};

#[derive(Deserialize, IntoParams)]
pub struct YQuery {
    /// Вектор состояния Yjs v1, standard base64 (URL-encoded); пустой — всё.
    sv: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct YExchange {
    /// Недостающее обновление Yjs v1, standard base64.
    update: String,
    /// Вектор состояния сервера v1, standard base64.
    sv: String,
    /// Старый Markdown только до первого сохранённого Yjs-состояния.
    seed_markdown: Option<String>,
}

#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct YUpdate {
    /// Обновление v1, standard base64; после декодирования не больше 512 КиБ.
    update: String,
    /// Простой текст для поиска; не больше 200 000 знаков.
    text: String,
    /// Снимок копии клиента (вектор и удаления), из которой построен text, v1, standard base64.
    snapshot: Option<String>,
    /// UUID упоминаний без повторов, до 200; отсутствие поля сохраняет прежние связи.
    #[serde(default, deserialize_with = "present_links")]
    #[schema(value_type = Vec<Uuid>, required = false, max_items = 200)]
    links: Option<Vec<String>>,
    /// Первое преобразование Markdown; если состояние уже есть — seed_taken.
    #[serde(default)]
    seed: bool,
}

fn present_links<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<Vec<String>>, D::Error> {
    Vec::deserialize(deserializer).map(Some)
}

#[derive(Serialize, ToSchema)]
pub struct YStateVector {
    /// Вектор состояния сервера v1, standard base64.
    sv: String,
    /// Нужен pull и повторная отправка текста слитого документа.
    text_stale: bool,
}

fn error(error: ydoc::Error) -> ApiError {
    use ydoc::Error as E;
    match error {
        E::InvalidUpdate => ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_update",
            "Битое обновление, вектор, снимок Yjs или список links",
        ),
        E::UpdateTooLarge => ApiError::new(
            StatusCode::BAD_REQUEST,
            "update_too_large",
            "Обновление больше 512 КиБ",
        ),
        E::DocTooLarge => ApiError::new(
            StatusCode::BAD_REQUEST,
            "doc_too_large",
            "Состояние документа больше 4 МиБ",
        ),
        E::TextTooLarge => ApiError::new(
            StatusCode::BAD_REQUEST,
            "text_too_large",
            "Текст длиннее 200 000 знаков",
        ),
        E::SeedTaken => ApiError::new(
            StatusCode::CONFLICT,
            "seed_taken",
            "Документ уже переведён в редактор — забери его состояние",
        ),
        E::Object(qubite_objects::Error::NotFound | qubite_objects::Error::Deleted) => {
            ApiError::new(StatusCode::NOT_FOUND, "not_found", "Документ не найден")
        }
        other => {
            tracing::error!(error = %other, "Yjs: ошибка сохранения");
            ApiError::internal()
        }
    }
}

fn decode_base64(value: &str) -> Result<Vec<u8>, ApiError> {
    STANDARD
        .decode(value)
        .map_err(|_| error(ydoc::Error::InvalidUpdate))
}

/// Забрать недостающее состояние документа Yjs v1.
#[utoipa::path(get, path = "/api/v1/docs/{id}/y", tag = "docs",
    params(("id" = Uuid, Path, description = "ID документа"), YQuery),
    responses(
        (status = 200, description = "Обновление и вектор состояния", body = YExchange),
        (status = 400, description = "invalid_update: неверный sv или base64", body = ApiErrorBody),
        (status = 403, description = "Нет права читать Docs", body = ApiErrorBody),
        (status = 404, description = "Документ не найден или чужой", body = ApiErrorBody),
    ))]
pub async fn get_y(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    Query(query): Query<YQuery>,
) -> Result<Json<YExchange>, ApiError> {
    authorize::<Read>(&state, &session, DOCS_MODULE).await?;
    let sv = decode_base64(query.sv.as_deref().unwrap_or_default())?;
    let mut conn = state
        .db
        .pool()
        .acquire()
        .await
        .map_err(|_| ApiError::internal())?;
    let exchange = ydoc::get(&mut conn, session.0.account_id, id, &sv)
        .await
        .map_err(error)?;
    Ok(Json(YExchange {
        update: STANDARD.encode(exchange.update),
        sv: STANDARD.encode(exchange.sv),
        seed_markdown: exchange.seed_markdown,
    }))
}

/// Слить обновление Yjs v1, сохранить простой текст и упоминания.
#[utoipa::path(post, path = "/api/v1/docs/{id}/y", tag = "docs",
    params(("id" = Uuid, Path, description = "ID документа")), request_body = YUpdate,
    responses(
        (status = 200, description = "Вектор состояния после слияния", body = YStateVector),
        (status = 400, description = "invalid_update, update_too_large, doc_too_large, text_too_large", body = ApiErrorBody),
        (status = 403, description = "Нет права менять Docs", body = ApiErrorBody),
        (status = 404, description = "Документ не найден или чужой", body = ApiErrorBody),
        (status = 409, description = "seed_taken: Markdown уже перенесён", body = ApiErrorBody),
    ))]
pub async fn post_y(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
    input: Result<Json<YUpdate>, JsonRejection>,
) -> Result<Json<YStateVector>, ApiError> {
    authorize::<Write>(&state, &session, DOCS_MODULE).await?;
    let Json(input) = input.map_err(|_| error(ydoc::Error::InvalidUpdate))?;
    let links = input
        .links
        .as_ref()
        .map(|links| {
            if links.len() > mentions::MAX_LINKS {
                return Err(error(ydoc::Error::InvalidUpdate));
            }
            let links = links
                .iter()
                .map(|id| Uuid::parse_str(id).map_err(|_| error(ydoc::Error::InvalidUpdate)))
                .collect::<Result<Vec<_>, _>>()?;
            if !mentions::valid_links(&links) {
                return Err(error(ydoc::Error::InvalidUpdate));
            }
            Ok(links)
        })
        .transpose()?;
    // Не выделяем память под заведомо слишком большой base64.
    if input.update.len() > ydoc::MAX_UPDATE_BYTES.div_ceil(3) * 4 {
        return Err(error(ydoc::Error::UpdateTooLarge));
    }
    let update = decode_base64(&input.update)?;
    let client_snapshot = input.snapshot.as_deref().map(decode_base64).transpose()?;
    let readable_modules = readable_modules(&state, &session).await?;
    let mut conn = state
        .db
        .pool()
        .acquire()
        .await
        .map_err(|_| ApiError::internal())?;
    let applied = ydoc::apply(
        &mut conn,
        session.0.account_id,
        id,
        ydoc::ApplyUpdate {
            update: &update,
            text: &input.text,
            seed: input.seed,
            client_snapshot: client_snapshot.as_deref(),
            links: links.as_deref(),
            readable_modules: &readable_modules,
        },
    )
    .await
    .map_err(error)?;
    Ok(Json(YStateVector {
        sv: STANDARD.encode(applied.sv),
        text_stale: applied.text_stale,
    }))
}

#[derive(Deserialize, IntoParams)]
pub struct LinkTargetsQuery {
    /// Подстрока названия без учёта регистра; пустая — недавние объекты.
    q: Option<String>,
}

#[derive(Serialize, ToSchema)]
pub struct LinkTarget {
    id: Uuid,
    #[serde(rename = "type")]
    object_type: String,
    title: String,
}

impl From<mentions::Target> for LinkTarget {
    fn from(target: mentions::Target) -> Self {
        Self {
            id: target.id,
            object_type: target.object_type,
            title: target.title,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct DocLink {
    id: Uuid,
    #[serde(rename = "type")]
    object_type: String,
    title: String,
    deleted: bool,
}

#[derive(Serialize, ToSchema)]
pub struct LinkTargets {
    targets: Vec<LinkTarget>,
}

#[derive(Serialize, ToSchema)]
pub struct Backlinks {
    backlinks: Vec<LinkTarget>,
}

#[derive(Serialize, ToSchema)]
pub struct DocLinks {
    links: Vec<DocLink>,
}

// Каталог использует тот же Policy Gate, что authorize. Права получаем до
// соединения с БД: каталог сам берёт соединение из пула.
async fn readable_modules(
    state: &AppState,
    session: &Authenticated,
) -> Result<Vec<String>, ApiError> {
    Ok(
        qubite_policy::catalog::catalog_for(state.db.pool(), &session.subject())
            .await?
            .into_iter()
            .filter(|entry| entry.flags.read)
            .map(|entry| entry.id)
            .collect(),
    )
}

fn links_error(error: qubite_objects::Error) -> ApiError {
    self::error(ydoc::Error::Object(error))
}

/// Цели упоминаний: до восьми своих объектов, документы первыми.
#[utoipa::path(get, path = "/api/v1/docs/link-targets", tag = "docs",
    params(LinkTargetsQuery),
    responses(
        (status = 200, description = "Цели упоминаний", body = LinkTargets),
        (status = 403, description = "Нет права читать Docs", body = ApiErrorBody),
    ))]
pub async fn link_targets(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<LinkTargetsQuery>,
) -> Result<Json<LinkTargets>, ApiError> {
    authorize::<Read>(&state, &session, DOCS_MODULE).await?;
    let modules = readable_modules(&state, &session).await?;
    let mut conn = state
        .db
        .pool()
        .acquire()
        .await
        .map_err(|_| ApiError::internal())?;
    let targets = mentions::targets(
        &mut conn,
        session.0.account_id,
        query.q.as_deref().unwrap_or_default(),
        &modules,
    )
    .await
    .map_err(links_error)?;
    Ok(Json(LinkTargets {
        targets: targets.into_iter().map(LinkTarget::from).collect(),
    }))
}

async fn read_backlinks(
    state: &AppState,
    session: &Authenticated,
    id: Uuid,
    doc_only: bool,
) -> Result<Json<Backlinks>, ApiError> {
    authorize::<Read>(state, session, DOCS_MODULE).await?;
    let modules = readable_modules(state, session).await?;
    let mut conn = state
        .db
        .pool()
        .acquire()
        .await
        .map_err(|_| ApiError::internal())?;
    mentions::require_target(&mut conn, session.0.account_id, id, doc_only, &modules)
        .await
        .map_err(links_error)?;
    let backlinks = mentions::backlinks(&mut conn, session.0.account_id, id, &modules)
        .await
        .map_err(links_error)?;
    Ok(Json(Backlinks {
        backlinks: backlinks.into_iter().map(LinkTarget::from).collect(),
    }))
}

/// Объекты, упоминающие документ и доступные читателю.
#[utoipa::path(get, path = "/api/v1/docs/{id}/backlinks", tag = "docs",
    params(("id" = Uuid, Path, description = "ID документа")),
    responses(
        (status = 200, description = "Обратные ссылки", body = Backlinks),
        (status = 403, description = "Нет права читать Docs", body = ApiErrorBody),
        (status = 404, description = "Документ не найден или чужой", body = ApiErrorBody),
    ))]
pub async fn doc_backlinks(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<Backlinks>, ApiError> {
    read_backlinks(&state, &session, id, true).await
}

/// Объекты, упоминающие объект и доступные читателю.
#[utoipa::path(get, path = "/api/v1/objects/{id}/backlinks", tag = "docs",
    params(("id" = Uuid, Path, description = "ID объекта")),
    responses(
        (status = 200, description = "Обратные ссылки", body = Backlinks),
        (status = 403, description = "Нет права читать Docs", body = ApiErrorBody),
        (status = 404, description = "Объект не найден или чужой", body = ApiErrorBody),
    ))]
pub async fn object_backlinks(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<Backlinks>, ApiError> {
    read_backlinks(&state, &session, id, false).await
}

/// Исходящие упоминания документа, включая цели в корзине.
#[utoipa::path(get, path = "/api/v1/docs/{id}/links", tag = "docs",
    params(("id" = Uuid, Path, description = "ID документа")),
    responses(
        (status = 200, description = "Исходящие ссылки", body = DocLinks),
        (status = 403, description = "Нет права читать Docs", body = ApiErrorBody),
        (status = 404, description = "Документ не найден или чужой", body = ApiErrorBody),
    ))]
pub async fn doc_links(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<Json<DocLinks>, ApiError> {
    authorize::<Read>(&state, &session, DOCS_MODULE).await?;
    let modules = readable_modules(&state, &session).await?;
    let mut conn = state
        .db
        .pool()
        .acquire()
        .await
        .map_err(|_| ApiError::internal())?;
    mentions::require_target(&mut conn, session.0.account_id, id, true, &modules)
        .await
        .map_err(links_error)?;
    let links = mentions::links(&mut conn, session.0.account_id, id, &modules)
        .await
        .map_err(links_error)?;
    Ok(Json(DocLinks {
        links: links
            .into_iter()
            .map(|link| DocLink {
                id: link.id,
                object_type: link.object_type,
                title: link.title,
                deleted: link.deleted,
            })
            .collect(),
    }))
}
