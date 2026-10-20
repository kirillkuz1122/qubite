//! Колокольчик: сообщения человеку, прочитано / не прочитано.

use serde::Serialize;
use serde_json::json;
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, Result, settings};

/// Задачи очереди: доставить наружу, погасить прочитанное, повторить позже.
pub const DELIVER_JOB: &str = "notify.deliver";
pub const CLOSE_JOB: &str = "notify.close";
pub const REPEAT_JOB: &str = "notify.repeat";
/// «Напомнить позже» в Telegram.
pub const SNOOZE_MINUTES: i64 = 15;

/// Что за сообщение.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Напоминание о деле.
    Reminder,
    /// Агент пишет первым (AGT-004).
    Agent,
    /// Служебное (например, пробное сообщение из профиля).
    System,
}

/// Кто начал разговор: от этого зависит тишина.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    /// Человек сам попросил (или это его дело) — приходит всегда.
    Owner,
    /// Агент пишет первым — молчит в тишину.
    Agent,
    /// Служебное — как `Owner`.
    System,
}

macro_rules! as_text {
    ($name:ident { $($variant:ident = $text:literal),+ }) => {
        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }
            fn parse(text: &str) -> Result<Self> {
                match text {
                    $($text => Ok(Self::$variant),)+
                    other => Err(Error::Invalid(format!("неизвестное значение {other}"))),
                }
            }
        }
    };
}
as_text!(Kind { Reminder = "reminder", Agent = "agent", System = "system" });
as_text!(Origin { Owner = "owner", Agent = "agent", System = "system" });

/// Сообщение в колокольчике.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Notice {
    pub id: Uuid,
    pub account_id: Uuid,
    pub kind: Kind,
    pub origin: Origin,
    pub title: String,
    pub body: String,
    pub why: String,
    pub object_id: Option<Uuid>,
    /// Пришло в тишину — только в колокольчик.
    pub held: bool,
    /// Куда ушло наружу (`push`, `telegram`); нет — только колокольчик.
    pub channel: Option<String>,
    pub created_at: OffsetDateTime,
    pub read_at: Option<OffsetDateTime>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    account_id: Uuid,
    kind: String,
    origin: String,
    title: String,
    body: String,
    why: String,
    object_id: Option<Uuid>,
    held: bool,
    channel: Option<String>,
    created_at: OffsetDateTime,
    read_at: Option<OffsetDateTime>,
}

const SELECT: &str = "SELECT id, account_id, kind, origin, title, body, why, object_id, held, \
     channel, created_at, read_at FROM notifications";

impl TryFrom<Row> for Notice {
    type Error = Error;
    fn try_from(row: Row) -> Result<Self> {
        Ok(Self {
            id: row.id,
            account_id: row.account_id,
            kind: Kind::parse(&row.kind)?,
            origin: Origin::parse(&row.origin)?,
            title: row.title,
            body: row.body,
            why: row.why,
            object_id: row.object_id,
            held: row.held,
            channel: row.channel,
            created_at: row.created_at,
            read_at: row.read_at,
        })
    }
}

/// Новое сообщение.
#[derive(Debug, Clone)]
pub struct NewNotice {
    pub account_id: Uuid,
    pub kind: Kind,
    pub origin: Origin,
    pub title: String,
    pub body: String,
    pub why: String,
    pub object_id: Option<Uuid>,
    /// Одно событие — одно сообщение.
    pub dedup_key: Option<String>,
}

fn clip(text: &str, max: usize) -> String {
    text.trim().chars().take(max).collect()
}

/// Положить сообщение в колокольчик и (если не тишина) поставить доставку
/// наружу. С тем же `dedup_key` второй раз не кладётся — `None`.
///
/// Тишину и «урок сейчас» проверяет сервер, а не модель (D-294): агентское
/// сообщение в тишину остаётся только в колокольчике.
pub async fn send(conn: &mut PgConnection, new: NewNotice) -> Result<Option<Notice>> {
    let title = clip(&new.title, 500);
    if title.is_empty() {
        return Err(Error::Invalid("у сообщения нужен заголовок".into()));
    }
    let held = if new.origin == Origin::Agent {
        let prefs = settings::load(conn, new.account_id).await?;
        let local = settings::local_now(conn).await?;
        prefs.quiet_at(local) || settings::busy_slot(conn, new.account_id).await?.is_some()
    } else {
        false
    };
    let row: Option<Row> = sqlx::query_as(
        "INSERT INTO notifications (id, account_id, kind, origin, title, body, why, object_id, \
             dedup_key, held) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) \
         ON CONFLICT (dedup_key) DO NOTHING \
         RETURNING id, account_id, kind, origin, title, body, why, object_id, held, channel, \
             created_at, read_at",
    )
    .bind(Uuid::now_v7())
    .bind(new.account_id)
    .bind(new.kind.as_str())
    .bind(new.origin.as_str())
    .bind(&title)
    .bind(clip(&new.body, 2000))
    .bind(clip(&new.why, 300))
    .bind(new.object_id)
    .bind(&new.dedup_key)
    .bind(held)
    .fetch_optional(&mut *conn)
    .await?;
    let Some(notice) = row.map(Notice::try_from).transpose()? else {
        return Ok(None);
    };
    if !notice.held {
        qubite_jobs::enqueue_in(
            conn,
            qubite_jobs::NewJob::new(DELIVER_JOB, json!({ "id": notice.id }))
                .max_attempts(5)
                .idempotency_key(format!("deliver:{}", notice.id)),
        )
        .await?;
    }
    Ok(Some(notice))
}

pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<Notice>> {
    let row: Option<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!("{SELECT} WHERE id = $1")))
        .bind(id)
        .fetch_optional(conn)
        .await?;
    row.map(Notice::try_from).transpose()
}

/// Последние сообщения человека и сколько не прочитано.
pub async fn list(
    conn: &mut PgConnection,
    account: Uuid,
    limit: i64,
) -> Result<(Vec<Notice>, i64)> {
    let rows: Vec<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE account_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2"
    )))
    .bind(account)
    .bind(limit.clamp(1, 200))
    .fetch_all(&mut *conn)
    .await?;
    let unread: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM notifications WHERE account_id = $1 AND read_at IS NULL",
    )
    .bind(account)
    .fetch_one(conn)
    .await?;
    Ok((
        rows.into_iter()
            .map(Notice::try_from)
            .collect::<Result<_>>()?,
        unread,
    ))
}

/// Прочитано (в любом канале): погасить и в остальных. Чужое — `NotFound`.
/// Возвращает `false`, если уже было прочитано.
pub async fn mark_read(conn: &mut PgConnection, account: Uuid, id: Uuid) -> Result<bool> {
    let owner: Option<(Uuid, Option<OffsetDateTime>)> =
        sqlx::query_as("SELECT account_id, read_at FROM notifications WHERE id = $1")
            .bind(id)
            .fetch_optional(&mut *conn)
            .await?;
    match owner {
        Some((owner, _)) if owner != account => Err(Error::NotFound),
        None => Err(Error::NotFound),
        Some((_, Some(_))) => Ok(false),
        Some((_, None)) => {
            sqlx::query("UPDATE notifications SET read_at = now() WHERE id = $1")
                .bind(id)
                .execute(&mut *conn)
                .await?;
            close_later(conn, &[id]).await?;
            Ok(true)
        }
    }
}

/// Прочитать всё. Возвращает, сколько погашено.
pub async fn mark_all_read(conn: &mut PgConnection, account: Uuid) -> Result<usize> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "UPDATE notifications SET read_at = now() WHERE account_id = $1 AND read_at IS NULL \
         RETURNING id",
    )
    .bind(account)
    .fetch_all(&mut *conn)
    .await?;
    close_later(conn, &ids).await?;
    Ok(ids.len())
}

/// Погасить в Telegram то, что туда ушло.
async fn close_later(conn: &mut PgConnection, ids: &[Uuid]) -> Result<()> {
    let sent: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT notification_id FROM notification_deliveries \
         WHERE notification_id = ANY($1) AND channel = 'telegram' AND status = 'sent'",
    )
    .bind(ids)
    .fetch_all(&mut *conn)
    .await?;
    for id in sent {
        qubite_jobs::enqueue_in(
            conn,
            qubite_jobs::NewJob::new(CLOSE_JOB, json!({ "id": id }))
                .max_attempts(3)
                .idempotency_key(format!("close:{id}")),
        )
        .await?;
    }
    Ok(())
}

/// «Через 15 минут»: это прочитано, такое же придёт позже.
pub async fn snooze(conn: &mut PgConnection, account: Uuid, id: Uuid) -> Result<OffsetDateTime> {
    mark_read(conn, account, id).await?;
    let at = OffsetDateTime::now_utc() + time::Duration::minutes(SNOOZE_MINUTES);
    qubite_jobs::enqueue_in(
        conn,
        qubite_jobs::NewJob::new(REPEAT_JOB, json!({ "id": id }))
            .run_at(at)
            .max_attempts(3)
            .idempotency_key(format!("repeat:{id}")),
    )
    .await?;
    Ok(at)
}

/// Повтор отложенного: такое же сообщение заново.
pub async fn repeat(conn: &mut PgConnection, id: Uuid) -> Result<Option<Notice>> {
    let Some(old) = get(conn, id).await? else {
        return Ok(None);
    };
    send(
        conn,
        NewNotice {
            account_id: old.account_id,
            kind: old.kind,
            origin: old.origin,
            title: old.title,
            body: old.body,
            why: "ты попросил напомнить ещё раз".into(),
            object_id: old.object_id,
            dedup_key: Some(format!("repeat:{id}")),
        },
    )
    .await
}
