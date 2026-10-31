//! Обмен Yjs v1. Событие objects::bump будит обычный /sync/ws через PostgreSQL.

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use qubite_planner::{folder::DOCS_MODULE, ydoc};
use qubite_policy::{Read, Write};
use serde::{Deserialize, Serialize};
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
    /// Первое преобразование Markdown; если состояние уже есть — seed_taken.
    #[serde(default)]
    seed: bool,
}

#[derive(Serialize, ToSchema)]
pub struct YStateVector {
    /// Вектор состояния сервера v1, standard base64.
    sv: String,
}

fn error(error: ydoc::Error) -> ApiError {
    use ydoc::Error as E;
    match error {
        E::InvalidUpdate => ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_update",
            "Битое обновление или вектор Yjs",
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

/// Слить обновление Yjs v1 и сохранить простой текст для поиска.
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
    Json(input): Json<YUpdate>,
) -> Result<Json<YStateVector>, ApiError> {
    authorize::<Write>(&state, &session, DOCS_MODULE).await?;
    // Не выделяем память под заведомо слишком большой base64.
    if input.update.len() > ydoc::MAX_UPDATE_BYTES.div_ceil(3) * 4 {
        return Err(error(ydoc::Error::UpdateTooLarge));
    }
    let update = decode_base64(&input.update)?;
    let mut conn = state
        .db
        .pool()
        .acquire()
        .await
        .map_err(|_| ApiError::internal())?;
    let sv = ydoc::apply(
        &mut conn,
        session.0.account_id,
        id,
        &update,
        &input.text,
        input.seed,
    )
    .await
    .map_err(error)?;
    Ok(Json(YStateVector {
        sv: STANDARD.encode(sv),
    }))
}
