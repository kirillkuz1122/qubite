//! Возможности: предложения агента и дела по решению человека. Снимки
//! собственной таблицы хранятся в общей ленте; откат идёт той же транзакцией.

use qubite_sync::{ObjectSnapshot, OpKind};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use time::{Duration, OffsetDateTime, PrimitiveDateTime};
use uuid::Uuid;

use crate::{
    Actor, Error, Result, Who,
    timeline::{self, Action, Plan, Step, check_agent, execute_in, lock},
};

pub const SUGGEST_TOOL: &str = "opportunity.suggest";
pub const ADD_TOOL: &str = "opportunity.add";
pub(crate) const TYPE: &str = "agent.opportunity";
pub(crate) const FIELDS: &[&str] = &[
    "source",
    "external_id",
    "kind",
    "subject",
    "stage",
    "grades",
    "registration_until",
    "starts_at",
    "ends_at",
    "place",
    "url",
    "tags",
    "status",
    "why",
];

/// Полный снимок включает сведения источника, чтобы откат удаления ручной
/// записи мог её вернуть. Метки времени не участвуют в сравнении полей.
pub(crate) async fn snapshot(
    conn: &mut PgConnection,
    account: Uuid,
    id: Uuid,
) -> Result<Option<ObjectSnapshot>> {
    let row: Option<(String, Value)> = sqlx::query_as(
        "SELECT title, to_jsonb(o) - 'id' - 'account_id' - 'title' - 'updated_at' \
         FROM opportunities o WHERE account_id = $1 AND id = $2 FOR UPDATE",
    )
    .bind(account)
    .bind(id)
    .fetch_optional(conn)
    .await?;
    Ok(row.map(|(title, fields)| ObjectSnapshot {
        id,
        object_type: TYPE.into(),
        title,
        revision: 1,
        deleted: false,
        updated_at_ms: 0,
        fields: Some(fields),
    }))
}

/// Внутренний шаг собственной таблицы. Он не передаётся движку синхронизации.
pub(crate) fn step(target: ObjectSnapshot) -> Result<Step> {
    Ok(Step {
        object_id: target.id,
        kind: OpKind::Create {
            object_type: TYPE.into(),
            title: target.title.clone(),
            fields: Some(serde_json::to_value(target)?),
        },
    })
}

/// Обновляем только личный статус/пояснение: сведения сборщика не меняем.
/// Удаление используется для отката ручного добавления; снимок остаётся.
pub(crate) async fn apply(
    conn: &mut PgConnection,
    account: Uuid,
    target: &ObjectSnapshot,
    exists: bool,
) -> Result<()> {
    if target.deleted {
        sqlx::query("DELETE FROM opportunities WHERE account_id = $1 AND id = $2")
            .bind(account)
            .bind(target.id)
            .execute(conn)
            .await?;
    } else if exists {
        let fields = target.fields.as_ref().ok_or(Error::NotFound)?;
        sqlx::query(
            "UPDATE opportunities SET status = $3, why = $4, updated_at = now() \
             WHERE account_id = $1 AND id = $2",
        )
        .bind(account)
        .bind(target.id)
        .bind(fields["status"].as_str().unwrap_or("new"))
        .bind(fields["why"].as_str().unwrap_or_default())
        .execute(conn)
        .await?;
    } else {
        let mut data = target.fields.clone().ok_or(Error::NotFound)?;
        data["id"] = json!(target.id);
        data["account_id"] = json!(account);
        data["title"] = json!(target.title);
        // Данные — только из проверенного внутреннего снимка. PostgreSQL
        // восстанавливает свои даты без потери часового пояса.
        sqlx::query(
            "INSERT INTO opportunities SELECT (jsonb_populate_record(NULL::opportunities, \
             $1 || jsonb_build_object('updated_at', now()))).*",
        )
        .bind(data)
        .execute(conn)
        .await?;
    }
    Ok(())
}

fn text(value: &str, max: usize, required: bool) -> Result<String> {
    let value = value.trim();
    if (required && value.is_empty()) || value.chars().count() > max {
        return Err(Error::Invalid(format!("нужен текст до {max} символов")));
    }
    Ok(value.to_owned())
}

fn timestamp(value: OffsetDateTime) -> Result<String> {
    value
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|error| Error::Invalid(error.to_string()))
}

fn status(snapshot: &ObjectSnapshot) -> Option<&str> {
    snapshot.fields.as_ref()?.get("status")?.as_str()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SuggestItem {
    id: Uuid,
    why: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Suggest {
    items: Vec<SuggestItem>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Add {
    title: String,
    kind: String,
    #[serde(with = "time::serde::rfc3339")]
    starts_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    ends_at: OffsetDateTime,
    #[serde(default, with = "time::serde::rfc3339::option")]
    registration_until: Option<OffsetDateTime>,
    place: Option<String>,
    url: Option<String>,
    why: Option<String>,
}

/// Мероприятие ещё не закончилось: идущий хакатон и открытая регистрация подходят.
async fn open(conn: &mut PgConnection, account: Uuid, id: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT ends_at > now() FROM opportunities WHERE account_id = $1 AND id = $2",
    )
    .bind(account)
    .bind(id)
    .fetch_one(conn)
    .await?)
}

async fn suggestions(conn: &mut PgConnection, account: Uuid, args: Value) -> Result<Vec<Step>> {
    let args: Suggest =
        serde_json::from_value(args).map_err(|error| Error::Invalid(error.to_string()))?;
    if args.items.is_empty() || args.items.len() > 3 {
        return Err(Error::Invalid(
            "предложить можно от 1 до 3 мероприятий".into(),
        ));
    }
    let mut steps = Vec::new();
    let mut seen = std::collections::HashSet::new();
    for item in args.items {
        if !seen.insert(item.id) {
            return Err(Error::Invalid("мероприятие повторяется".into()));
        }
        let mut target = snapshot(conn, account, item.id)
            .await?
            .ok_or(Error::NotFound)?;
        if status(&target) != Some("new") || !open(conn, account, item.id).await? {
            return Err(Error::Invalid(
                "предлагать можно только новые будущие мероприятия".into(),
            ));
        }
        let fields = target.fields.as_mut().ok_or(Error::NotFound)?;
        fields["status"] = json!("suggested");
        fields["why"] = json!(text(&item.why, 300, true)?);
        steps.push(step(target)?);
    }
    Ok(steps)
}

fn manual(args: Value) -> Result<ObjectSnapshot> {
    let args: Add =
        serde_json::from_value(args).map_err(|error| Error::Invalid(error.to_string()))?;
    if !["olympiad", "hackathon", "contest"].contains(&args.kind.as_str())
        || args.starts_at <= OffsetDateTime::now_utc()
        || args.ends_at < args.starts_at
        || args
            .registration_until
            .is_some_and(|date| date > args.ends_at)
    {
        return Err(Error::Invalid("проверь вид и даты мероприятия".into()));
    }
    let title = text(&args.title, 500, true)?;
    let url = text(args.url.as_deref().unwrap_or_default(), 2000, false)?;
    if !url.is_empty()
        && (!url.starts_with("https://") || url.len() <= 8 || url.contains(char::is_whitespace))
    {
        return Err(Error::Invalid("ссылка — https:// без пробелов".into()));
    }
    Ok(ObjectSnapshot {
        id: Uuid::now_v7(),
        object_type: TYPE.into(),
        title,
        revision: 1,
        deleted: false,
        updated_at_ms: 0,
        fields: Some(json!({
            "source": "manual", "external_id": Uuid::now_v7().to_string(),
            "kind": args.kind, "subject": "", "stage": "", "grades": "",
            "registration_until": args.registration_until.map(timestamp).transpose()?,
            "starts_at": timestamp(args.starts_at)?, "ends_at": timestamp(args.ends_at)?,
            "place": text(args.place.as_deref().unwrap_or_default(), 500, false)?,
            "url": url, "tags": [], "status": "suggested",
            "why": text(args.why.as_deref().unwrap_or_default(), 300, false)?,
            "created_at": timestamp(OffsetDateTime::now_utc())?,
        })),
    })
}

pub(crate) async fn write(
    pool: &PgPool,
    who: &Who,
    tool: &str,
    args: Value,
    reason: Option<&str>,
    batch: Option<Uuid>,
) -> Result<Action> {
    let mut tx = pool.begin().await?;
    lock(&mut tx, who.account()).await?;
    check_agent(&mut tx, who).await?;
    if who.actor() != Actor::Agent {
        return Err(Error::Invalid("мероприятия предлагает агент".into()));
    }
    let (steps, summary) = if tool == SUGGEST_TOOL {
        let steps = suggestions(&mut tx, who.account(), args).await?;
        let summary = format!("Предложил мероприятия: {}", steps.len());
        (steps, summary)
    } else {
        let target = manual(args)?;
        let summary = format!("Добавил мероприятие «{}» со слов владельца", target.title);
        (vec![step(target)?], summary)
    };
    let action = execute_in(
        &mut tx,
        who,
        Plan {
            tool: tool.into(),
            summary,
            reason: reason.map(str::to_owned),
            batch: batch.unwrap_or_else(Uuid::now_v7),
            reverts: None,
            corrects: None,
            steps,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(action)
}

async fn local(conn: &mut PgConnection, instant: OffsetDateTime) -> Result<PrimitiveDateTime> {
    Ok(sqlx::query_scalar(
        "SELECT $1::timestamptz AT TIME ZONE coalesce( \
         (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), $2)",
    )
    .bind(instant)
    .bind(qubite_planner::DEFAULT_TIMEZONE)
    .fetch_one(conn)
    .await?)
}

/// Общий путь создания дел (поля и права проверяет лента, как у task.create).
async fn tasks(conn: &mut PgConnection, account: Uuid, id: Uuid, title: &str) -> Result<Vec<Step>> {
    if !open(conn, account, id).await? {
        return Err(Error::Invalid("мероприятие уже закончилось".into()));
    }
    let (start, end, registration): (OffsetDateTime, OffsetDateTime, Option<OffsetDateTime>) =
        sqlx::query_as(
            "SELECT starts_at, ends_at, registration_until FROM opportunities \
             WHERE account_id = $1 AND id = $2",
        )
        .bind(account)
        .bind(id)
        .fetch_one(&mut *conn)
        .await?;
    // Уже идёт: подготовки нет, «участие» — к сроку окончания (подача работ, конец этапа).
    let started = start <= OffsetDateTime::now_utc();
    let end = local(conn, end).await?;
    let start = local(conn, start).await?;
    let tomorrow = qubite_planner::today(conn)
        .await?
        .next_day()
        .ok_or_else(|| Error::Invalid("дата вне диапазона".into()))?;
    let prepare = (start.date() - Duration::days(7)).max(tomorrow);
    let mut tasks = Vec::new();
    let mut registered = None;
    if let Some(registration) = registration.filter(|date| *date > OffsetDateTime::now_utc()) {
        let due = local(conn, registration).await?;
        registered = Some(due);
        tasks.push((format!("Зарегистрироваться на {title}"), due));
    }
    // Подготовка — не позже начала: если до него меньше дня, отдельного дела нет.
    if !started && prepare < start.date() {
        tasks.push((
            format!("Подготовиться к {title}"),
            PrimitiveDateTime::new(prepare, start.time()),
        ));
    }
    // У этапа «Регистрация» конец совпадает со сроком регистрации — второго дела не нужно.
    if !(started && registered == Some(end)) {
        tasks.push((
            format!("{title} — участие"),
            if started { end } else { start },
        ));
    }
    Ok(tasks
        .into_iter()
        .map(|(title, due)| Step {
            object_id: Uuid::now_v7(),
            kind: OpKind::Create {
                object_type: qubite_planner::TASK_TYPE.into(),
                title,
                fields: Some(json!({
                    "due_date": qubite_planner::format_date(due.date()),
                    "due_time": format!("{:02}:{:02}", due.hour(), due.minute()),
                })),
            },
        })
        .collect())
}

async fn planned(conn: &mut PgConnection, account: Uuid, id: Uuid) -> Result<bool> {
    let rows = timeline::rows_where(
        conn,
        account,
        "a.tool = 'opportunity.interested' AND EXISTS (SELECT 1 FROM agent_action_changes ch \
         WHERE ch.action_id = a.id AND ch.object_id = $2 AND ch.object_type = 'agent.opportunity') \
         AND EXISTS (SELECT 1 FROM agent_action_changes tasks \
         WHERE tasks.action_id = a.id AND tasks.object_type = 'planner.task' AND tasks.before IS NULL)",
        id,
    )
    .await?;
    Ok(timeline::load_actions(conn, account, rows)
        .await?
        .iter()
        .any(|action| action.state.reverted_by.is_none()))
}

/// Кнопка человека: статус и все дела — одна запись и одна транзакция.
/// Повторное нажатие возвращает None и ничего не создаёт.
pub async fn decide(
    pool: &PgPool,
    who: &Who,
    id: Uuid,
    interested: bool,
) -> Result<Option<Action>> {
    if who.actor() != Actor::Owner {
        return Err(Error::NeedsOwner(
            "решение о мероприятии принимает человек".into(),
        ));
    }
    let mut tx = pool.begin().await?;
    lock(&mut tx, who.account()).await?;
    let mut target = snapshot(&mut tx, who.account(), id)
        .await?
        .ok_or(Error::NotFound)?;
    check_agent(&mut tx, who).await?;
    let wanted = if interested {
        "interested"
    } else {
        "dismissed"
    };
    if status(&target) == Some(wanted) {
        return Ok(None);
    }
    let mut steps = Vec::new();
    // Если участие уже запланировано и затем предложение скрыли,
    // «Интересно» возвращает статус без второго набора дел.
    if interested && !planned(&mut tx, who.account(), id).await? {
        steps = tasks(&mut tx, who.account(), id, &target.title).await?;
    }
    target.fields.as_mut().ok_or(Error::NotFound)?["status"] = json!(wanted);
    let title = target.title.clone();
    steps.push(step(target)?);
    let (tool, summary) = if interested {
        (
            "opportunity.interested",
            format!("Запланировал участие: {title}"),
        )
    } else {
        (
            "opportunity.dismiss",
            format!("Отклонил мероприятие: {title}"),
        )
    };
    let action = execute_in(
        &mut tx,
        who,
        Plan {
            tool: tool.into(),
            summary,
            reason: None,
            batch: Uuid::now_v7(),
            reverts: None,
            corrects: None,
            steps,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Some(action))
}

/// До 15 ближайших новых мероприятий — данные, а не инструкции модели.
pub(crate) async fn context(conn: &mut PgConnection, account: Uuid) -> Result<String> {
    let rows: Vec<Value> = sqlx::query_scalar(
        "SELECT jsonb_build_object('id', id, 'title', title, 'kind', kind, 'subject', subject, \
         'starts_at', starts_at, 'ends_at', ends_at, 'registration_until', registration_until, 'grades', grades) \
         FROM opportunities WHERE account_id = $1 AND status = 'new' AND starts_at > now() \
         ORDER BY coalesce(registration_until, starts_at), starts_at, id LIMIT 15",
    )
    .bind(account)
    .fetch_all(conn)
    .await?;
    Ok(serde_json::to_string(&rows)?)
}
