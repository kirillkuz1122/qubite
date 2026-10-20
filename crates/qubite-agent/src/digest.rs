//! Сводка от AI на Главной (HOME-001, AGENT §15): инструмент
//! `home.digest.write` и чтение сводки на сегодня.
//!
//! Сводку пишет только агент. Каждый пункт ведёт к своему делу, проекту,
//! мысли, записи ленты или (у новости) к статье — сервер проверяет, что
//! объект твой и существует. Сводка — строка в ленте: откатил её — она
//! пропала с Главной (откат отката возвращает). Изменений данных у неё нет.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use time::{Date, OffsetDateTime};
use uuid::Uuid;

use crate::{
    Actor, Error, Result, Who,
    timeline::{self, Action, Links, Plan, check_agent, execute_in, lock},
};

/// Имя инструмента.
pub const TOOL: &str = "home.digest.write";
/// Пунктов в сводке — не больше.
pub const MAX_ITEMS: usize = 7;
const MAX_TEXT_CHARS: usize = 300;
const MAX_URL_CHARS: usize = 2000;

/// Что за пункт (помогает экрану расставить значки и порядок).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// Важное на сегодня.
    Important,
    /// Что агент заметил.
    Noticed,
    /// Вопрос агента (§8).
    Question,
    /// Новость по твоим темам.
    News,
    /// Что AI считает нужным.
    Tip,
}

/// Куда ведёт пункт.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Link {
    Task {
        id: Uuid,
        title: String,
    },
    Project {
        id: Uuid,
        title: String,
    },
    Inbox {
        id: Uuid,
        title: String,
    },
    /// Запись в ленте «Что сделал агент».
    Action {
        id: Uuid,
        title: String,
    },
    /// Статья (только у новостей), `https://`.
    Url {
        url: String,
    },
}

/// Пункт сводки.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    pub kind: Kind,
    pub text: String,
    pub link: Link,
}

/// Сводка на день.
#[derive(Debug, Clone, Serialize)]
pub struct Digest {
    pub id: Uuid,
    /// Строка ленты, которой сводка записана.
    pub action_id: Uuid,
    pub day: Date,
    pub items: Vec<Item>,
    pub created_at: OffsetDateTime,
}

/// Пункт, как его передаёт модель: текст и ровно одна ссылка.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ItemArgs {
    kind: Kind,
    text: String,
    task_id: Option<Uuid>,
    project_id: Option<Uuid>,
    inbox_id: Option<Uuid>,
    action_id: Option<Uuid>,
    url: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Args {
    items: Vec<ItemArgs>,
}

fn check_url(url: &str) -> Result<String> {
    let url = url.trim();
    if !url.starts_with("https://")
        || url.chars().count() > MAX_URL_CHARS
        || url.contains(char::is_whitespace)
        || url.len() <= "https://".len()
    {
        return Err(Error::Invalid(
            "ссылка новости — только https:// без пробелов".into(),
        ));
    }
    Ok(url.to_owned())
}

/// Проверить пункт и найти название объекта, к которому он ведёт.
async fn resolve(conn: &mut PgConnection, account: Uuid, args: ItemArgs) -> Result<Item> {
    let text = args.text.split_whitespace().collect::<Vec<_>>().join(" ");
    if text.is_empty() {
        return Err(Error::Invalid("у пункта сводки нужен текст".into()));
    }
    if text.chars().count() > MAX_TEXT_CHARS {
        return Err(Error::Invalid(format!(
            "пункт сводки — не длиннее {MAX_TEXT_CHARS} символов"
        )));
    }
    let links = [
        args.task_id.is_some(),
        args.project_id.is_some(),
        args.inbox_id.is_some(),
        args.action_id.is_some(),
        args.url.is_some(),
    ]
    .into_iter()
    .filter(|set| *set)
    .count();
    if links != 1 {
        return Err(Error::Invalid(
            "каждый пункт сводки ведёт ровно к одному: делу, проекту, мысли, записи ленты или статье"
                .into(),
        ));
    }
    if (args.kind == Kind::News) != args.url.is_some() {
        return Err(Error::Invalid(
            "ссылка на статью — только у новости, и у новости она нужна".into(),
        ));
    }
    let link = if let Some(id) = args.task_id {
        let task = qubite_planner::get_task(conn, account, id)
            .await?
            .filter(|task| !task.deleted)
            .ok_or(Error::NotFound)?;
        Link::Task {
            id,
            title: task.title,
        }
    } else if let Some(id) = args.project_id {
        let project = qubite_planner::get_project(conn, account, id)
            .await?
            .filter(|project| !project.deleted)
            .ok_or(Error::NotFound)?;
        Link::Project {
            id,
            title: project.title,
        }
    } else if let Some(id) = args.inbox_id {
        let item = qubite_inbox::get(conn, account, id)
            .await?
            .filter(|item| !item.deleted)
            .ok_or(Error::NotFound)?;
        Link::Inbox {
            id,
            title: item.title,
        }
    } else if let Some(id) = args.action_id {
        let summary: String = sqlx::query_scalar(
            "SELECT summary FROM agent_actions WHERE id = $1 AND account_id = $2",
        )
        .bind(id)
        .bind(account)
        .fetch_optional(&mut *conn)
        .await?
        .ok_or(Error::NotFound)?;
        Link::Action { id, title: summary }
    } else {
        Link::Url {
            url: check_url(args.url.as_deref().unwrap_or_default())?,
        }
    };
    Ok(Item {
        kind: args.kind,
        text,
        link,
    })
}

fn items_word(n: usize) -> &'static str {
    match (n % 10, n % 100) {
        (1, rem) if rem != 11 => "пункт",
        (2..=4, rem) if !(12..=14).contains(&rem) => "пункта",
        _ => "пунктов",
    }
}

/// `home.digest.write`: записать сводку на сегодня (новая заменяет прежнюю
/// на Главной; прежняя остаётся в ленте).
pub(crate) async fn write(
    pool: &PgPool,
    who: &Who,
    arguments: Value,
    reason: Option<&str>,
    batch: Option<Uuid>,
) -> Result<Action> {
    if who.actor() != Actor::Agent {
        return Err(Error::Invalid("сводку на Главную пишет агент".into()));
    }
    let Args { items } = serde_json::from_value(arguments)
        .map_err(|error| Error::Invalid(format!("{TOOL}: {error}")))?;
    if items.is_empty() || items.len() > MAX_ITEMS {
        return Err(Error::Invalid(format!(
            "в сводке от 1 до {MAX_ITEMS} пунктов"
        )));
    }
    let account = who.account();
    let mut tx = pool.begin().await?;
    lock(&mut tx, account).await?;
    check_agent(&mut tx, who).await?;
    let mut resolved = Vec::with_capacity(items.len());
    for item in items {
        resolved.push(resolve(&mut tx, account, item).await?);
    }
    let day = qubite_planner::today(&mut tx).await?;
    let n = resolved.len();
    let action = execute_in(
        &mut tx,
        who,
        Plan {
            tool: TOOL.into(),
            summary: format!("Написал сводку на Главную: {n} {}", items_word(n)),
            reason: reason.map(str::to_owned),
            batch: batch.unwrap_or_else(Uuid::now_v7),
            reverts: None,
            corrects: None,
            steps: Vec::new(),
        },
    )
    .await?;
    sqlx::query(
        "INSERT INTO home_digests (id, account_id, action_id, day, items) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(Uuid::now_v7())
    .bind(account)
    .bind(action.id)
    .bind(day)
    .bind(serde_json::to_value(&resolved)?)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(action)
}

/// Сводка на сегодня: самая новая не откаченная. Нужен грант `agent`
/// (право `read`); без него — `Denied`, и Главная живёт без сводки.
pub async fn today(pool: &PgPool, who: &Who) -> Result<Option<Digest>> {
    let account = who.account();
    let mut conn = pool.acquire().await?;
    check_agent(&mut conn, who).await?;
    let day = qubite_planner::today(&mut conn).await?;
    let rows: Vec<(Uuid, Uuid, Date, Value, OffsetDateTime)> = sqlx::query_as(
        "SELECT id, action_id, day, items, created_at FROM home_digests \
         WHERE account_id = $1 AND day = $2 ORDER BY created_at DESC, id DESC LIMIT 20",
    )
    .bind(account)
    .bind(day)
    .fetch_all(&mut *conn)
    .await?;
    if rows.is_empty() {
        return Ok(None);
    }
    let links = Links::load(&mut conn, account).await?;
    for (id, action_id, day, items, created_at) in rows {
        if links.reverted_by(action_id).is_some() {
            continue;
        }
        return Ok(Some(Digest {
            id,
            action_id,
            day,
            items: serde_json::from_value(items)?,
            created_at,
        }));
    }
    Ok(None)
}

/// Что агент разложил из Входящих за последние сутки (не откаченное), новые
/// сверху. Для Главной: «новое во Входящих и что агент разложил».
pub async fn recent_filed(pool: &PgPool, who: &Who, limit: usize) -> Result<Vec<Action>> {
    let account = who.account();
    let mut conn = pool.acquire().await?;
    check_agent(&mut conn, who).await?;
    let rows = timeline::rows_where(
        &mut conn,
        account,
        "a.tool = 'inbox.file' AND a.actor = 'agent' \
         AND a.at > now() - interval '1 day' AND a.id <> $2",
        Uuid::nil(),
    )
    .await?;
    let actions = timeline::load_actions(&mut conn, account, rows).await?;
    Ok(actions
        .into_iter()
        .filter(|action| action.state.reverted_by.is_none())
        .take(limit)
        .collect())
}
