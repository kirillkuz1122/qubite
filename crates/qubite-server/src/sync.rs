//! Адреса синхронизации (CMD-001): `/api/v1/sync/push`, `/pull` и
//! WebSocket `/ws` с подсказкой «есть новое».
//!
//! Все — только после входа и через Policy Gate: менять можно объекты тех
//! модулей, где у человека право `write`, забирать — где `read`. Права
//! проверяются на каждый запрос, а у WebSocket — перед каждым сообщением и
//! каждые 30 секунд: отзыв гранта или сессии закрывает соединение.

use std::{collections::HashSet, time::Duration};

use axum::{
    Json,
    extract::{
        Query, State,
        ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, StatusCode, header},
    response::Response,
};
use qubite_policy::{Authorized, ModuleId, Read, Write};
use qubite_sync::{PullResponse, PushRequest, PushResponse};
use qubite_sync_server::{Registry, Rules};
use serde::Deserialize;
use tokio::sync::broadcast::error::RecvError;
use utoipa::IntoParams;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    changes::Change,
};

/// Типы объектов, которые сейчас синхронизируются.
pub fn registry() -> Registry {
    Registry::default()
        .with(qubite_inbox::InboxFields)
        .with(qubite_planner::ProjectFieldsHandler)
        .with(qubite_planner::TaskFieldsHandler)
}

/// Как часто WebSocket заново проверяет права, даже если ничего не меняется.
const RECHECK_EVERY: Duration = Duration::from_secs(30);

pub(crate) fn sync_error(error: qubite_sync_server::Error) -> ApiError {
    match error {
        qubite_sync_server::Error::InvalidPush(error) => {
            ApiError::new(StatusCode::BAD_REQUEST, "invalid_push", error.to_string())
        }
        other => {
            tracing::error!(error = %other, "синхронизация: внутренняя ошибка");
            ApiError::internal()
        }
    }
}

/// Модули, где у субъекта есть право `A`. Отказ — просто «нет в списке».
async fn allowed<A: qubite_policy::Action>(
    state: &AppState,
    session: &Authenticated,
    modules: impl IntoIterator<Item = String>,
) -> Result<Vec<String>, ApiError> {
    let subject = session.subject();
    let mut allowed = Vec::new();
    for module in modules {
        let id = ModuleId::new(module.clone())?;
        match qubite_policy::decide::<A>(state.db.pool(), &subject, &id).await {
            Ok(_) => allowed.push(module),
            Err(qubite_policy::Error::Denied(_)) => {}
            Err(other) => return Err(other.into()),
        }
    }
    Ok(allowed)
}

/// Отправить пакет операций устройства.
///
/// Тело и ответ — `PushRequest` / `PushResponse` протокола `qubite-sync`
/// (типы — в `@qubite/sync-client`). Операция в модуле без права `write`
/// отклоняется с причиной `forbidden`; остальные применяются.
#[utoipa::path(post, path = "/api/v1/sync/push", tag = "sync",
    request_body(content = Object, description = "PushRequest протокола qubite-sync"),
    responses(
        (status = 200, description = "Результат по каждой операции (PushResponse)", body = Object),
        (status = 400, description = "Пустой пакет, больше 500 операций или повтор op_id", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn push(
    State(state): State<AppState>,
    session: Authenticated,
    Json(request): Json<PushRequest>,
) -> Result<Json<PushResponse>, ApiError> {
    request
        .validate()
        .map_err(|error| sync_error(error.into()))?;
    let account = session.0.account_id;
    // Только синхронизируемые модули: файлы и вопросы агента меняются через
    // его ленту (AGT-001), а не напрямую с устройства.
    let synced = state.sync.modules();
    let modules = qubite_sync_server::modules_of(state.db.pool(), account, &request.ops)
        .await
        .map_err(sync_error)?
        .into_iter()
        .filter(|module| synced.contains(module));
    let writable: HashSet<String> = allowed::<Write>(&state, &session, modules)
        .await?
        .into_iter()
        .collect();
    let rules = Rules {
        registry: state.sync.clone(),
        strict: true,
        writable: Some(writable),
        readable: None,
    };
    let response = qubite_sync_server::push_with(state.db.pool(), account, &request, &rules)
        .await
        .map_err(sync_error)?;
    Ok(Json(response))
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct PullQuery {
    /// Курсор из прошлого ответа; 0 — с начала.
    #[serde(default)]
    cursor: i64,
    /// Сколько изменений за раз (1…500, по умолчанию 200).
    limit: Option<i64>,
}

/// Забрать изменения после курсора — только из модулей с правом `read`.
#[utoipa::path(get, path = "/api/v1/sync/pull", tag = "sync", params(PullQuery),
    responses(
        (status = 200, description = "PullResponse протокола qubite-sync", body = Object),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn pull(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<PullQuery>,
) -> Result<Json<PullResponse>, ApiError> {
    let readable = allowed::<Read>(&state, &session, state.sync.modules()).await?;
    let rules = Rules {
        registry: state.sync.clone(),
        strict: true,
        writable: Some(HashSet::new()),
        readable: Some(readable),
    };
    let response = qubite_sync_server::pull_with(
        state.db.pool(),
        session.0.account_id,
        query.cursor,
        query.limit.unwrap_or(200),
        &rules,
    )
    .await
    .map_err(sync_error)?;
    Ok(Json(response))
}

/// WebSocket «есть новое». Сервер шлёт `{"type":"ready"}` после подключения
/// и `{"type":"changed"}`, когда у аккаунта что-то изменилось (данных в
/// сообщении нет — их забирают через `pull`). Нужно право `read` во
/// Входящих или в Planner. Браузер подключается только со своего сайта
/// (проверка `Origin`).
#[utoipa::path(get, path = "/api/v1/sync/ws", tag = "sync",
    responses(
        (status = 101, description = "Соединение открыто"),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Чужой сайт или нет доступа ни к Входящим, ни к Planner", body = ApiErrorBody),
    ))]
pub async fn socket(
    State(state): State<AppState>,
    session: Authenticated,
    headers: HeaderMap,
    upgrade: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    // Сессия по cookie: браузер сам приложит её и к соединению с чужого
    // сайта, поэтому сверяем Origin с адресом сервера. У приложений с
    // Bearer-токеном cookie нет — им проверка не нужна.
    if session.0.kind == "web" && !same_origin(&headers) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "origin_rejected",
            "Подключение с другого сайта запрещено",
        ));
    }
    // Подсказка без данных: хватает права чтения в любом модуле с синхронизацией.
    let authorized =
        match crate::modules::authorize::<Read>(&state, &session, qubite_inbox::MODULE).await {
            Ok(proof) => proof,
            Err(_) => {
                crate::modules::authorize::<Read>(&state, &session, qubite_planner::MODULE).await?
            }
        };
    let changes = state.changes.subscribe(state.db.pool());
    Ok(upgrade.on_upgrade(move |socket| run_socket(socket, state, authorized, changes)))
}

pub(crate) fn same_origin(headers: &HeaderMap) -> bool {
    let origin = headers
        .get(header::ORIGIN)
        .and_then(|value| value.to_str().ok());
    let host = headers
        .get(header::HOST)
        .and_then(|value| value.to_str().ok());
    match (origin, host) {
        (Some(origin), Some(host)) => origin
            .split_once("://")
            .is_some_and(|(_, origin_host)| origin_host.eq_ignore_ascii_case(host)),
        _ => false,
    }
}

const READY: &str = r#"{"type":"ready"}"#;
const CHANGED: &str = r#"{"type":"changed"}"#;
/// Код закрытия: права отозваны (4000–4999 — коды приложения).
const CLOSE_FORBIDDEN: u16 = 4403;

async fn run_socket(
    mut socket: WebSocket,
    state: AppState,
    mut authorized: Authorized<Read>,
    mut changes: tokio::sync::broadcast::Receiver<Change>,
) {
    let account = authorized.account_id();
    let mut ticker = tokio::time::interval(RECHECK_EVERY);
    ticker.reset();
    if socket.send(Message::Text(READY.into())).await.is_err() {
        return;
    }
    loop {
        let send_changed = tokio::select! {
            change = changes.recv() => match change {
                Ok(change) if change.concerns(account) => true,
                Ok(_) => continue, // чужое изменение
                // Отстали от очереди — что-то могли пропустить: пусть проверит.
                Err(RecvError::Lagged(_)) => true,
                Err(RecvError::Closed) => break,
            },
            _ = ticker.tick() => false,
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_)) | Err(_)) | None => break,
                Some(Ok(_)) => continue, // клиенту говорить не о чем
            },
        };
        // Перед каждым сообщением и по таймеру — права заново.
        authorized = match authorized.recheck(state.db.pool()).await {
            Ok(fresh) => fresh,
            Err(_) => {
                let _ = socket
                    .send(Message::Close(Some(CloseFrame {
                        code: CLOSE_FORBIDDEN,
                        reason: "access revoked".into(),
                    })))
                    .await;
                break;
            }
        };
        if send_changed && socket.send(Message::Text(CHANGED.into())).await.is_err() {
            break;
        }
    }
}
