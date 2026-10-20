//! Колокольчик и каналы напоминаний (PLAN-004): сообщения человеку,
//! «прочитано», вкладка открыта, настройки каналов и тишины, подписка
//! браузера на push. Доставку делает обработчик очереди (`qubite-notify`).

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use qubite_notify::{
    Kind, NewNotice, Notice, Origin,
    deliver::{self, Subscription},
    settings::{self, Channel, Settings},
};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
};

fn notify_error(error: qubite_notify::Error) -> ApiError {
    match error {
        qubite_notify::Error::Invalid(message) => {
            ApiError::new(StatusCode::BAD_REQUEST, "invalid", message)
        }
        qubite_notify::Error::NotFound => {
            ApiError::new(StatusCode::NOT_FOUND, "not_found", "Сообщение не найдено")
        }
        other => {
            tracing::error!(error = %other, "колокольчик: внутренняя ошибка");
            ApiError::internal()
        }
    }
}

async fn conn(state: &AppState) -> Result<sqlx::pool::PoolConnection<sqlx::Postgres>, ApiError> {
    state.db.pool().acquire().await.map_err(|error| {
        tracing::error!(%error, "колокольчик: база недоступна");
        ApiError::internal()
    })
}

/// Сообщение в колокольчике.
#[derive(Debug, Serialize, ToSchema)]
pub struct NoticeItem {
    id: Uuid,
    /// `reminder` — напоминание о деле, `agent` — агент пишет первым, `system` — служебное.
    kind: String,
    /// `owner` — человек сам попросил (приходит всегда), `agent` — агент первым.
    origin: String,
    title: String,
    /// Подробности: «в 16:00».
    body: String,
    /// Почему сейчас: «сходить куда-то — за час, с запасом на дорогу».
    why: String,
    /// Дело, к которому ведёт сообщение.
    object_id: Option<Uuid>,
    /// Пришло в тишину — только сюда, наружу не отправлялось.
    held: bool,
    /// Куда ушло наружу: `push`, `telegram`; нет — только колокольчик.
    channel: Option<String>,
    /// Кнопки ответа («Да», «15 минут», «Позже», «Не сегодня»); пусто — нет.
    options: Vec<NoticeOption>,
    /// Что ответили кнопкой (`id` из `options`).
    answer: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    read_at: Option<OffsetDateTime>,
}

/// Кнопка ответа под сообщением.
#[derive(Debug, Serialize, ToSchema)]
pub struct NoticeOption {
    id: String,
    text: String,
}

impl From<Notice> for NoticeItem {
    fn from(notice: Notice) -> Self {
        Self {
            id: notice.id,
            kind: notice.kind.as_str().into(),
            origin: notice.origin.as_str().into(),
            title: notice.title,
            body: notice.body,
            why: notice.why,
            object_id: notice.object_id,
            held: notice.held,
            channel: notice.channel,
            options: notice
                .options
                .into_iter()
                .map(|choice| NoticeOption {
                    id: choice.id,
                    text: choice.text,
                })
                .collect(),
            answer: notice.answer,
            created_at: notice.created_at,
            read_at: notice.read_at,
        }
    }
}

/// Сообщения и сколько не прочитано.
#[derive(Debug, Serialize, ToSchema)]
pub struct NoticeList {
    items: Vec<NoticeItem>,
    unread: i64,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct NoticeQuery {
    /// До 200, по умолчанию 50.
    limit: Option<i64>,
}

/// Колокольчик: последние сообщения, свежие сверху.
#[utoipa::path(get, path = "/api/v1/notifications", tag = "notifications", params(NoticeQuery),
    responses(
        (status = 200, description = "Сообщения", body = NoticeList),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn list_notices(
    State(state): State<AppState>,
    session: Authenticated,
    Query(query): Query<NoticeQuery>,
) -> Result<Json<NoticeList>, ApiError> {
    let mut conn = conn(&state).await?;
    let (items, unread) =
        qubite_notify::notice::list(&mut conn, session.0.account_id, query.limit.unwrap_or(50))
            .await
            .map_err(notify_error)?;
    Ok(Json(NoticeList {
        items: items.into_iter().map(NoticeItem::from).collect(),
        unread,
    }))
}

/// Прочитано: гаснет и в Telegram.
#[utoipa::path(post, path = "/api/v1/notifications/{id}/read", tag = "notifications",
    params(("id" = Uuid, Path, description = "Сообщение")),
    responses(
        (status = 204, description = "Прочитано"),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 404, description = "Нет такого сообщения", body = ApiErrorBody),
    ))]
pub async fn read_notice(
    State(state): State<AppState>,
    session: Authenticated,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let mut conn = conn(&state).await?;
    qubite_notify::notice::mark_read(&mut conn, session.0.account_id, id)
        .await
        .map_err(notify_error)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Сколько погашено.
#[derive(Debug, Serialize, ToSchema)]
pub struct ReadCount {
    read: usize,
}

/// Прочитать всё.
#[utoipa::path(post, path = "/api/v1/notifications/read-all", tag = "notifications",
    responses(
        (status = 200, description = "Прочитано", body = ReadCount),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn read_all_notices(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<ReadCount>, ApiError> {
    let mut conn = conn(&state).await?;
    let read = qubite_notify::notice::mark_all_read(&mut conn, session.0.account_id)
        .await
        .map_err(notify_error)?;
    Ok(Json(ReadCount { read }))
}

#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct Presence {
    /// Вкладка Qubite видна (раз в минуту, пока видна; `false` — спрятана или закрывается).
    visible: bool,
}

/// Вкладка Qubite видна или нет. Пока видна, напоминания приходят только в
/// колокольчик — без push и Telegram (одно сообщение — один канал).
#[utoipa::path(post, path = "/api/v1/notifications/presence", tag = "notifications",
    request_body = Presence,
    responses(
        (status = 204, description = "Отмечено"),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn notice_presence(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<Presence>,
) -> Result<StatusCode, ApiError> {
    let mut conn = conn(&state).await?;
    settings::presence(&mut conn, session.0.account_id, body.visible)
        .await
        .map_err(notify_error)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Браузер, подписанный на push.
#[derive(Debug, Serialize, ToSchema)]
pub struct PushDevice {
    id: Uuid,
    label: String,
    /// Адрес подписки — по нему браузер узнаёт свою.
    endpoint: String,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
}

impl From<Subscription> for PushDevice {
    fn from(sub: Subscription) -> Self {
        Self {
            id: sub.id,
            label: sub.label,
            endpoint: sub.endpoint,
            created_at: sub.created_at,
        }
    }
}

/// Каналы и тишина.
#[derive(Debug, Serialize, ToSchema)]
pub struct NotifySettings {
    push_enabled: bool,
    telegram_enabled: bool,
    /// Куда сначала, когда тебя нет в Qubite: `push` или `telegram`; не дошло — во второй.
    first_channel: String,
    /// Ночь: агент не пишет первым. `ЧЧ:ММ`.
    quiet_from: String,
    quiet_to: String,
    /// «Само»: за сколько минут до дела со временем.
    before_minutes: u16,
    /// «Само»: за сколько минут до «сходить куда-то» (с запасом на дорогу).
    travel_minutes: u16,
    /// Открытый ключ VAPID для подписки браузера. Нет — push на сервере не настроен.
    push_key: Option<String>,
    push_devices: Vec<PushDevice>,
    /// Telegram привязан в профиле.
    telegram_linked: bool,
    /// Бот Telegram настроен на сервере.
    telegram_ready: bool,
}

async fn settings_reply(
    state: &AppState,
    conn: &mut sqlx::PgConnection,
    account: Uuid,
    prefs: Settings,
) -> Result<NotifySettings, ApiError> {
    let devices = deliver::subscriptions(conn, account)
        .await
        .map_err(notify_error)?;
    let chat = deliver::telegram_chat(conn, account)
        .await
        .map_err(notify_error)?;
    Ok(NotifySettings {
        push_enabled: prefs.push_enabled,
        telegram_enabled: prefs.telegram_enabled,
        first_channel: prefs.first_channel.as_str().into(),
        quiet_from: qubite_planner::format_time(prefs.quiet_from),
        quiet_to: qubite_planner::format_time(prefs.quiet_to),
        before_minutes: prefs.before_minutes,
        travel_minutes: prefs.travel_minutes,
        push_key: state
            .notify
            .push
            .as_ref()
            .map(|push| push.public_key().to_owned()),
        push_devices: devices.into_iter().map(PushDevice::from).collect(),
        telegram_linked: chat.is_some(),
        telegram_ready: state.notify.telegram.is_some(),
    })
}

/// Настройки каналов и тишины.
#[utoipa::path(get, path = "/api/v1/notifications/settings", tag = "notifications",
    responses(
        (status = 200, description = "Настройки", body = NotifySettings),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn notify_settings(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<NotifySettings>, ApiError> {
    let mut conn = conn(&state).await?;
    let account = session.0.account_id;
    let prefs = settings::load(&mut conn, account)
        .await
        .map_err(notify_error)?;
    Ok(Json(
        settings_reply(&state, &mut conn, account, prefs).await?,
    ))
}

/// Изменение настроек: только то, что меняется.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct NotifySettingsChange {
    push_enabled: Option<bool>,
    telegram_enabled: Option<bool>,
    /// `push` или `telegram`.
    first_channel: Option<String>,
    /// `ЧЧ:ММ`.
    quiet_from: Option<String>,
    quiet_to: Option<String>,
    /// 0…1440.
    before_minutes: Option<u16>,
    travel_minutes: Option<u16>,
}

/// Изменить каналы и тишину. Новые «за сколько минут» действуют для новых
/// и изменённых дел.
#[utoipa::path(patch, path = "/api/v1/notifications/settings", tag = "notifications",
    request_body = NotifySettingsChange,
    responses(
        (status = 200, description = "Сохранено", body = NotifySettings),
        (status = 400, description = "Неверные значения", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn change_notify_settings(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<NotifySettingsChange>,
) -> Result<Json<NotifySettings>, ApiError> {
    let first_channel = body
        .first_channel
        .as_deref()
        .map(Channel::parse)
        .transpose()
        .map_err(notify_error)?;
    let change = settings::Change {
        push_enabled: body.push_enabled,
        telegram_enabled: body.telegram_enabled,
        first_channel,
        quiet_from: body.quiet_from,
        quiet_to: body.quiet_to,
        before_minutes: body.before_minutes,
        travel_minutes: body.travel_minutes,
    };
    let mut conn = conn(&state).await?;
    let account = session.0.account_id;
    let prefs = settings::save(&mut conn, account, &change)
        .await
        .map_err(notify_error)?;
    Ok(Json(
        settings_reply(&state, &mut conn, account, prefs).await?,
    ))
}

/// Ключи подписки браузера (`PushSubscription.toJSON().keys`).
#[derive(Debug, Deserialize, ToSchema)]
pub struct PushKeys {
    p256dh: String,
    auth: String,
}

/// Подписка браузера на push (`PushSubscription.toJSON()` и название устройства).
#[derive(Debug, Deserialize, ToSchema)]
pub struct PushSubscribe {
    endpoint: String,
    keys: PushKeys,
    /// «Firefox на телефоне».
    #[serde(default)]
    label: String,
}

fn push_ready(state: &AppState) -> Result<&qubite_notify::WebPush, ApiError> {
    state.notify.push.as_deref().ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "push_not_configured",
            "Push в браузере ещё не настроен на сервере (QUBITE_PUSH_VAPID_KEY)",
        )
    })
}

/// Подписать этот браузер на push.
#[utoipa::path(post, path = "/api/v1/notifications/push", tag = "notifications",
    request_body = PushSubscribe,
    responses(
        (status = 204, description = "Подписан"),
        (status = 400, description = "Не служба push браузера или неверные ключи", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 409, description = "Push не настроен на сервере", body = ApiErrorBody),
    ))]
pub async fn push_subscribe(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<PushSubscribe>,
) -> Result<StatusCode, ApiError> {
    let push = push_ready(&state)?;
    let mut conn = conn(&state).await?;
    deliver::subscribe(
        &mut conn,
        push,
        session.0.account_id,
        &body.endpoint,
        &body.keys.p256dh,
        &body.keys.auth,
        &body.label,
    )
    .await
    .map_err(notify_error)?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct PushUnsubscribe {
    endpoint: String,
}

/// Отписать браузер от push.
#[utoipa::path(post, path = "/api/v1/notifications/push/remove", tag = "notifications",
    request_body = PushUnsubscribe,
    responses(
        (status = 204, description = "Отписан"),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn push_unsubscribe(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<PushUnsubscribe>,
) -> Result<StatusCode, ApiError> {
    let mut conn = conn(&state).await?;
    deliver::unsubscribe(&mut conn, session.0.account_id, &body.endpoint)
        .await
        .map_err(notify_error)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Пробное сообщение: в колокольчик и сразу наружу (push или Telegram), даже
/// если Qubite открыт, — чтобы проверить канал.
#[utoipa::path(post, path = "/api/v1/notifications/test", tag = "notifications",
    responses(
        (status = 200, description = "Отправлено в очередь", body = NoticeItem),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn send_test_notice(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<NoticeItem>, ApiError> {
    let mut conn = conn(&state).await?;
    let notice = qubite_notify::notice::send(
        &mut conn,
        NewNotice {
            account_id: session.0.account_id,
            kind: Kind::System,
            origin: Origin::System,
            title: "Пробное напоминание".into(),
            body: "Так будут приходить напоминания Qubite".into(),
            why: "ты нажал «Прислать пробное»".into(),
            object_id: None,
            dedup_key: None,
            options: Vec::new(),
        },
    )
    .await
    .map_err(notify_error)?
    .ok_or_else(ApiError::internal)?;
    Ok(Json(notice.into()))
}
