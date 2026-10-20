//! Разговор с агентом (D-326): чат в разделе «Агент», Telegram-бот, поле
//! «Поправить» у файла и ответы на вопросы «Агент хочет знать».
//!
//! Сообщение человека сразу ложится сюда «в ожидании» и ставит задачу
//! `agent.chat` в очередь `jobs` (одной транзакцией). Её выполняет `qubite
//! serve`, где есть AI-шлюз ([`crate::brain`]); ответ агента ложится сюда же,
//! а если писали из Telegram — уходит и туда.

use qubite_policy::{ModuleId, Subject, Write};
use serde::Serialize;
use serde_json::json;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, MODULE, Result, files};

/// Задача очереди: ответить на сообщение.
pub const CHAT_JOB: &str = "agent.chat";
/// Задача очереди: фоновый разбор разговора — что запомнить.
pub const REVIEW_JOB: &str = "agent.review";
/// Через сколько после последнего сообщения разбирать разговор.
pub const REVIEW_DELAY: time::Duration = time::Duration::minutes(3);
/// Длина сообщения.
pub const MAX_TEXT: usize = 4000;

/// Откуда сообщение.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    /// Чат в разделе «Агент».
    Web,
    /// Telegram-бот.
    Telegram,
    /// «Поправить» у файла.
    Fix,
    /// Ответ на вопрос «Агент хочет знать».
    Question,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Web => "web",
            Self::Telegram => "telegram",
            Self::Fix => "fix",
            Self::Question => "question",
        }
    }
}

impl std::str::FromStr for Channel {
    type Err = String;
    fn from_str(value: &str) -> std::result::Result<Self, String> {
        match value {
            "web" => Ok(Self::Web),
            "telegram" => Ok(Self::Telegram),
            "fix" => Ok(Self::Fix),
            "question" => Ok(Self::Question),
            other => Err(format!("неизвестный канал {other}")),
        }
    }
}

/// Одно сообщение разговора.
#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: Uuid,
    pub seq: i64,
    /// `owner` — ты, `agent` — агент.
    pub role: String,
    pub channel: Channel,
    pub text: String,
    /// Файл, к которому «Поправить».
    pub file_id: Option<Uuid>,
    pub reply_to: Option<Uuid>,
    pub run_id: Option<Uuid>,
    /// У твоего: `pending` — агент думает, `done`, `failed`.
    pub status: String,
    /// Сколько действий агент сделал в ответ.
    pub actions: i32,
    pub telegram_chat: Option<i64>,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    seq: i64,
    role: String,
    channel: String,
    text: String,
    file_id: Option<Uuid>,
    reply_to: Option<Uuid>,
    run_id: Option<Uuid>,
    status: String,
    actions: i32,
    telegram_chat: Option<i64>,
    at: OffsetDateTime,
}

impl TryFrom<Row> for Message {
    type Error = Error;
    fn try_from(row: Row) -> Result<Self> {
        Ok(Self {
            id: row.id,
            seq: row.seq,
            role: row.role,
            channel: row.channel.parse().map_err(Error::Invalid)?,
            text: row.text,
            file_id: row.file_id,
            reply_to: row.reply_to,
            run_id: row.run_id,
            status: row.status,
            actions: row.actions,
            telegram_chat: row.telegram_chat,
            at: row.at,
        })
    }
}

const SELECT: &str = "SELECT id, seq, role, channel, text, file_id, reply_to, run_id, status, \
     actions, telegram_chat, at FROM agent_messages";

fn convert(rows: Vec<Row>) -> Result<Vec<Message>> {
    rows.into_iter().map(Message::try_from).collect()
}

/// Своё сообщение.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<Message>> {
    let rows: Vec<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!("{SELECT} WHERE id = $1")))
        .bind(id)
        .fetch_all(conn)
        .await?;
    Ok(convert(rows)?.into_iter().next())
}

pub(crate) async fn account_of(conn: &mut PgConnection, id: Uuid) -> Result<Option<Uuid>> {
    Ok(
        sqlx::query_scalar("SELECT account_id FROM agent_messages WHERE id = $1")
            .bind(id)
            .fetch_optional(conn)
            .await?,
    )
}

/// Разговор: после `after` (курсор `seq`) по порядку, или последние `limit`.
pub async fn list(
    conn: &mut PgConnection,
    account: Uuid,
    after: Option<i64>,
    limit: i64,
) -> Result<Vec<Message>> {
    let limit = limit.clamp(1, 200);
    let rows: Vec<Row> = match after {
        Some(after) => {
            sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "{SELECT} WHERE account_id = $1 AND seq > $2 ORDER BY seq LIMIT $3"
            )))
            .bind(account)
            .bind(after)
            .bind(limit)
            .fetch_all(conn)
            .await?
        }
        None => {
            let mut rows: Vec<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "{SELECT} WHERE account_id = $1 ORDER BY seq DESC LIMIT $2"
            )))
            .bind(account)
            .bind(limit)
            .fetch_all(conn)
            .await?;
            rows.reverse();
            rows
        }
    };
    convert(rows)
}

/// Сообщения с `from` (не включая) по `to` (включая) — для разбора.
pub(crate) async fn between(
    conn: &mut PgConnection,
    account: Uuid,
    from: i64,
    to: i64,
) -> Result<Vec<Message>> {
    let rows: Vec<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE account_id = $1 AND seq > $2 AND seq <= $3 ORDER BY seq LIMIT 200"
    )))
    .bind(account)
    .bind(from)
    .bind(to)
    .fetch_all(conn)
    .await?;
    convert(rows)
}

/// Что написал человек.
#[derive(Debug, Clone)]
pub struct NewMessage {
    pub account: Uuid,
    pub channel: Channel,
    pub text: String,
    /// «Поправить» — у какого файла.
    pub file_id: Option<Uuid>,
    /// Из Telegram: чат и ID сообщения.
    pub telegram: Option<(i64, i64)>,
}

/// Написать агенту: сообщение «в ожидании» и задача `agent.chat` — одной
/// транзакцией. Нужно право `write` в модуле `agent` (без гранта агента нет).
pub async fn post(pool: &PgPool, new: NewMessage) -> Result<Message> {
    let mut tx = pool.begin().await?;
    let module = ModuleId::new(MODULE)?;
    qubite_policy::decide_in::<Write>(&mut tx, &Subject::account(new.account, None), &module)
        .await?;
    let text = new.text.trim();
    if text.is_empty() {
        return Err(Error::Invalid("пустое сообщение".into()));
    }
    if text.chars().count() > MAX_TEXT {
        return Err(Error::Invalid(format!(
            "сообщение длиннее {MAX_TEXT} знаков"
        )));
    }
    // Пароли и коды не уходят ни в разговор, ни в модель.
    let (text, _) = files::redact(text);
    if let Some(file) = new.file_id
        && files::by_id(&mut tx, new.account, file).await?.is_none()
    {
        return Err(Error::NotFound);
    }
    let id = Uuid::now_v7();
    let (chat, message) = new.telegram.unzip();
    sqlx::query(
        "INSERT INTO agent_messages (id, account_id, role, channel, text, file_id, \
         telegram_chat, telegram_message, status) \
         VALUES ($1, $2, 'owner', $3, $4, $5, $6, $7, 'pending')",
    )
    .bind(id)
    .bind(new.account)
    .bind(new.channel.as_str())
    .bind(&text)
    .bind(new.file_id)
    .bind(chat)
    .bind(message)
    .execute(&mut *tx)
    .await?;
    qubite_jobs::enqueue_in(
        &mut tx,
        qubite_jobs::NewJob::new(CHAT_JOB, json!({ "message_id": id }))
            .idempotency_key(format!("{CHAT_JOB}:{id}"))
            .max_attempts(2),
    )
    .await
    .map_err(|error| Error::Invalid(error.to_string()))?;
    let message = get(&mut tx, id).await?.ok_or(Error::NotFound)?;
    tx.commit().await?;
    Ok(message)
}

/// Ответ агента на сообщение; твоё сообщение — «готово» или «не вышло».
pub(crate) async fn answer(
    conn: &mut PgConnection,
    to: &Message,
    account: Uuid,
    text: &str,
    run: Option<Uuid>,
    actions: i32,
    ok: bool,
) -> Result<Message> {
    let id = Uuid::now_v7();
    let text: String = text.trim().chars().take(MAX_TEXT).collect();
    let text = if text.is_empty() {
        "…".to_owned()
    } else {
        text
    };
    sqlx::query(
        "INSERT INTO agent_messages (id, account_id, role, channel, text, file_id, run_id, \
         reply_to, telegram_chat, actions) VALUES ($1, $2, 'agent', $3, $4, $5, $6, $7, $8, $9)",
    )
    .bind(id)
    .bind(account)
    .bind(to.channel.as_str())
    .bind(&text)
    .bind(to.file_id)
    .bind(run)
    .bind(to.id)
    .bind(to.telegram_chat)
    .bind(actions)
    .execute(&mut *conn)
    .await?;
    sqlx::query("UPDATE agent_messages SET status = $2, run_id = $3, actions = $4 WHERE id = $1")
        .bind(to.id)
        .bind(if ok { "done" } else { "failed" })
        .bind(run)
        .bind(actions)
        .execute(&mut *conn)
        .await?;
    get(conn, id).await?.ok_or(Error::NotFound)
}

/// Ответ агента отправлен в Telegram: запомнить, чтобы «ответ на него» шёл агенту.
pub async fn set_telegram_message(pool: &PgPool, id: Uuid, chat: i64, message: i64) -> Result<()> {
    sqlx::query(
        "UPDATE agent_messages SET telegram_chat = $2, telegram_message = $3 WHERE id = $1",
    )
    .bind(id)
    .bind(chat)
    .bind(message)
    .execute(pool)
    .await?;
    Ok(())
}

/// Это сообщение агента в Telegram (на него ответили — значит, пишут агенту)?
pub async fn is_agent_telegram(pool: &PgPool, chat: i64, message: i64) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM agent_messages WHERE telegram_chat = $1 \
         AND telegram_message = $2 AND role = 'agent')",
    )
    .bind(chat)
    .bind(message)
    .fetch_one(pool)
    .await?)
}

/// Поставить фоновый разбор разговора через [`REVIEW_DELAY`] после сообщения
/// `seq`. Если разговор продолжится, этот разбор пропустится — разберёт следующий.
pub(crate) async fn schedule_review(
    conn: &mut PgConnection,
    account: Uuid,
    seq: i64,
) -> Result<()> {
    qubite_jobs::enqueue_in(
        conn,
        qubite_jobs::NewJob::new(
            REVIEW_JOB,
            json!({ "account_id": account, "upto_seq": seq }),
        )
        .idempotency_key(format!("{REVIEW_JOB}:{account}:{seq}"))
        .run_at(OffsetDateTime::now_utc() + REVIEW_DELAY)
        .max_attempts(2),
    )
    .await
    .map_err(|error| Error::Invalid(error.to_string()))?;
    Ok(())
}
