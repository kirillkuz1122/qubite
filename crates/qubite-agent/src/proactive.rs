//! Агент пишет первым (AGT-004, AGENT §6–§7): свободное время, «есть 30
//! минут?», тишина, «не сегодня», поводы проснуться.
//!
//! - **Поводы проснуться** — задачи `agent.wake` в очереди `jobs`, без
//!   постоянного процесса (D-351): утро (сводка на Главную), свободное окно,
//!   срок или урок, ответ на «есть время?». Утренняя задача ставит окна на
//!   сегодня и утро завтра — так цепочка не рвётся; при старте `qubite serve`
//!   её заводит [`bootstrap`].
//! - **Сервер решает, можно ли писать** (D-294), а модель — что писать:
//!   «не писать», «не сегодня», ночь и уроки, лимит дня, не чаще раза в час
//!   проверяются до вызова модели и ещё раз в инструменте `notify.send`.
//! - **Сообщение первым** — строка ленты агента (откат гасит его) и сообщение
//!   колокольчика с кнопками «Да · 15 минут · Позже · Не сегодня». Ответ
//!   ([`answer`]) будит агента: «да» — предложить дело под окно, «позже» —
//!   спросить через час, «не сегодня» — молчать до завтра.
//! - **Бюджет агента** — не больше [`free::MAX_WAKES`] пробуждений в день и
//!   внутри лимита AI человека (AI-шлюз); нет AI — тихо пропускается.

use std::collections::HashMap;

use qubite_ai::{Gateway, Untrusted};
use qubite_notify::notice::{self, Choice};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use time::{Date, Duration, OffsetDateTime, PrimitiveDateTime, Time};
use uuid::Uuid;

use crate::{
    Actor, Error, Result, Run, Trigger, Who, brain,
    files::schedule,
    finish_run,
    free::{self, Answered, Mode, Reply, Window},
    memory, start_run,
    timeline::{Action, Plan, check_agent, execute_in, lock},
};

/// Задача очереди: агент просыпается по поводу.
pub const WAKE_JOB: &str = "agent.wake";
/// Инструменты этого модуля.
pub const SEND_TOOL: &str = "notify.send";
pub const WINDOWS_TOOL: &str = "time.free_windows";
pub const PRESENCE_TOOL: &str = "presence.now";
/// Модель для пробуждений — как у разговора (`qubite ai use … --task agent.wake`).
pub const WAKE_TASK: &str = "agent.wake";
/// Сколько минут «на связи» после ответа в Telegram.
pub const TELEGRAM_FRESH_MINUTES: i64 = 10;
/// «Позже» — спросить снова через столько минут.
pub const LATER_MINUTES: i64 = 60;
/// Сколько дней ответов видит «сколько захочет» и закономерности.
const LEARN_DAYS: i64 = 14;
const PATTERN_DAYS: i64 = 28;

// ---------------------------------------------------------------- настройка

/// Как часто агент пишет первым (D-294, D-309).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Pace {
    pub mode: Mode,
    /// Для `count`: сколько в день.
    pub per_day: i64,
    /// «Не сегодня» — в этот день молчит.
    pub quiet_day: Option<Date>,
}

impl Default for Pace {
    fn default() -> Self {
        Self {
            mode: Mode::Auto,
            per_day: 3,
            quiet_day: None,
        }
    }
}

pub async fn load_pace(conn: &mut PgConnection, account: Uuid) -> Result<Pace> {
    let row: Option<(String, i32, Option<Date>)> =
        sqlx::query_as("SELECT mode, per_day, quiet_day FROM agent_pace WHERE account_id = $1")
            .bind(account)
            .fetch_optional(conn)
            .await?;
    Ok(match row {
        Some((mode, per_day, quiet_day)) => Pace {
            mode: Mode::parse(&mode).unwrap_or(Mode::Auto),
            per_day: i64::from(per_day),
            quiet_day,
        },
        None => Pace::default(),
    })
}

/// Изменение настройки: только то, что пришло.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PaceChange {
    /// `auto` — сколько захочет, `count` — число в день, `off` — не писать.
    pub mode: Option<String>,
    pub per_day: Option<i64>,
    /// `true` — «не сегодня», `false` — снова можно сегодня.
    pub not_today: Option<bool>,
}

/// Сохранить настройку (это делает только сам человек) и переставить
/// пробуждения.
pub async fn save_pace(pool: &PgPool, who: &Who, change: &PaceChange) -> Result<Pace> {
    if who.actor() != Actor::Owner {
        return Err(Error::NeedsOwner(
            "как часто писать первым, решает только человек".into(),
        ));
    }
    let account = who.account();
    let mut tx = pool.begin().await?;
    check_agent(&mut tx, who).await?;
    let mut pace = load_pace(&mut tx, account).await?;
    if let Some(mode) = &change.mode {
        pace.mode = Mode::parse(mode)
            .ok_or_else(|| Error::Invalid("как часто — auto, count или off".into()))?;
    }
    if let Some(per_day) = change.per_day {
        if !(1..=20).contains(&per_day) {
            return Err(Error::Invalid("в день — от 1 до 20 сообщений".into()));
        }
        pace.per_day = per_day;
    }
    if let Some(not_today) = change.not_today {
        let today = brain::local_now(&mut tx).await?.date();
        pace.quiet_day = not_today.then_some(today);
    }
    store_pace(&mut tx, account, &pace).await?;
    tx.commit().await?;
    plan_ahead(pool, account).await?;
    Ok(pace)
}

async fn store_pace(conn: &mut PgConnection, account: Uuid, pace: &Pace) -> Result<()> {
    sqlx::query(
        "INSERT INTO agent_pace (account_id, mode, per_day, quiet_day) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (account_id) DO UPDATE SET mode = $2, per_day = $3, quiet_day = $4, \
             updated_at = now()",
    )
    .bind(account)
    .bind(pace.mode.as_str())
    .bind(i32::try_from(pace.per_day).unwrap_or(3))
    .bind(pace.quiet_day)
    .execute(conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------- что знаем о дне

/// Ответы на «есть время?» за последние `days` дней.
async fn answers(conn: &mut PgConnection, account: Uuid, days: i64) -> Result<Vec<Answered>> {
    let rows: Vec<(PrimitiveDateTime, String)> = sqlx::query_as(
        "SELECT local_at, answer FROM agent_nudges \
         WHERE account_id = $1 AND answer IS NOT NULL \
           AND created_at > now() - make_interval(days => $2) \
         ORDER BY local_at",
    )
    .bind(account)
    .bind(i32::try_from(days).unwrap_or(14))
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .filter_map(|(at, answer)| Reply::parse(&answer).map(|reply| Answered { at, reply }))
        .collect())
}

/// Сколько агент уже написал первым сегодня (в лимите) и когда последний раз.
async fn sent_today(
    conn: &mut PgConnection,
    account: Uuid,
    today: Date,
) -> Result<(i64, Option<OffsetDateTime>)> {
    Ok(sqlx::query_as(
        "SELECT count(*), max(created_at) FROM agent_nudges \
         WHERE account_id = $1 AND counted AND local_at::date = $2",
    )
    .bind(account)
    .bind(today)
    .fetch_one(conn)
    .await?)
}

/// Когда агент последний раз писал о каждом деле.
async fn mentioned(conn: &mut PgConnection, account: Uuid) -> Result<HashMap<Uuid, Date>> {
    let rows: Vec<(Uuid, PrimitiveDateTime)> = sqlx::query_as(
        "SELECT object_id, max(local_at) FROM agent_nudges \
         WHERE account_id = $1 AND object_id IS NOT NULL GROUP BY object_id",
    )
    .bind(account)
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(|(id, at)| (id, at.date())).collect())
}

/// Свободные окна дня: от `now` (сегодня) или с утра, без ночи, уроков и дел
/// со временем.
async fn day_windows(
    conn: &mut PgConnection,
    account: Uuid,
    date: Date,
    now: PrimitiveDateTime,
) -> Result<(Vec<Window>, Vec<free::Busy>)> {
    let settings = qubite_notify::settings::load(conn, account)
        .await
        .map_err(notify_error)?;
    let slots = schedule::slots(conn, account).await?;
    let tasks = qubite_planner::list_tasks(conn, account, None, 1000).await?;
    let mut busy = free::night(settings.quiet_from, settings.quiet_to);
    busy.extend(free::busy_on(
        date,
        &slots,
        &tasks,
        i64::from(settings.travel_minutes),
    ));
    let earliest = if date == now.date() {
        i64::from(now.hour()) * 60 + i64::from(now.minute())
    } else {
        0
    };
    Ok((free::windows(date, earliest, &busy), busy))
}

/// Почему сейчас нельзя писать первым: ночь, урок по расписанию, «не
/// сегодня». Можно — `None`.
fn quiet_reason(
    settings: &qubite_notify::Settings,
    slots: &[schedule::Slot],
    pace: &Pace,
    now: PrimitiveDateTime,
) -> Option<String> {
    if pace.quiet_day == Some(now.date()) {
        return Some("ты сказал «не сегодня»".into());
    }
    if settings.quiet_at(now.time()) {
        return Some("ночь".into());
    }
    let weekday = now.date().weekday().number_from_monday();
    slots
        .iter()
        .find(|slot| {
            slot.quiet
                && slot.weekday == weekday
                && now.time() >= slot.starts_at
                && now.time() < slot.ends_at
        })
        .map(|slot| format!("«{}» по расписанию", slot.title))
}

/// На связи ли человек (`presence.now`).
#[derive(Debug, Clone, Serialize)]
pub struct Presence {
    /// Вкладка Qubite видна (последние 90 секунд).
    pub in_qubite: bool,
    /// Сколько минут назад была видна вкладка.
    pub seen_minutes_ago: Option<i64>,
    /// Сколько минут назад отвечал в Telegram (агенту или кнопкой).
    pub telegram_minutes_ago: Option<i64>,
    /// Почему сейчас тишина (ночь, урок, «не сегодня»); нет — можно.
    pub quiet: Option<String>,
    /// Свободное окно сейчас: сколько минут осталось.
    pub free_minutes: Option<i64>,
}

async fn presence(
    conn: &mut PgConnection,
    account: Uuid,
    now: PrimitiveDateTime,
) -> Result<Presence> {
    let settings = qubite_notify::settings::load(conn, account)
        .await
        .map_err(notify_error)?;
    let pace = load_pace(conn, account).await?;
    let slots = schedule::slots(conn, account).await?;
    let utc = OffsetDateTime::now_utc();
    let telegram: Option<OffsetDateTime> = sqlx::query_scalar(
        "SELECT max(at) FROM ( \
             SELECT max(at) AS at FROM agent_messages \
             WHERE account_id = $1 AND role = 'owner' AND channel = 'telegram' \
             UNION ALL \
             SELECT max(n.answered_at) FROM notifications n \
             JOIN notification_deliveries d ON d.notification_id = n.id AND d.channel = 'telegram' \
             WHERE n.account_id = $1) t",
    )
    .bind(account)
    .fetch_one(&mut *conn)
    .await?;
    let (windows, _) = day_windows(conn, account, now.date(), now).await?;
    Ok(Presence {
        in_qubite: settings.present(utc),
        seen_minutes_ago: settings.seen_at.map(|at| (utc - at).whole_minutes()),
        telegram_minutes_ago: telegram.map(|at| (utc - at).whole_minutes()),
        quiet: quiet_reason(&settings, &slots, &pace, now),
        free_minutes: windows.iter().find_map(|window| window.left(now)),
    })
}

/// Читающие инструменты: `time.free_windows {days?}` и `presence.now {}`.
pub(crate) async fn read_tool(
    conn: &mut PgConnection,
    account: Uuid,
    tool: &str,
    arguments: Value,
) -> Result<Value> {
    let now = brain::local_now(conn).await?;
    match tool {
        WINDOWS_TOOL => {
            #[derive(Deserialize)]
            #[serde(deny_unknown_fields)]
            struct Args {
                days: Option<i64>,
            }
            let Args { days } = serde_json::from_value(arguments)
                .map_err(|error| Error::Invalid(format!("{tool}: {error}")))?;
            let mut out = Vec::new();
            for offset in 0..days.unwrap_or(1).clamp(1, 7) {
                let date = now.date() + Duration::days(offset);
                let (windows, busy) = day_windows(conn, account, date, now).await?;
                out.push(json!({
                    "date": qubite_planner::format_date(date),
                    "free": windows,
                    "busy": busy.iter().filter(|b| b.what != "ночь").map(|b| &b.what).collect::<Vec<_>>(),
                }));
            }
            Ok(Value::Array(out))
        }
        PRESENCE_TOOL => Ok(serde_json::to_value(presence(conn, account, now).await?)?),
        other => Err(Error::Invalid(format!("нет инструмента {other}"))),
    }
}

// ---------------------------------------------------------------- написать первым

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SendArgs {
    /// Заголовок: «Есть 30 минут?», «Завтра алгебра — ДЗ готово?».
    title: String,
    /// Подробности: что предлагаешь.
    #[serde(default)]
    body: String,
    /// «Есть N минут?» — кнопки «Да · 15 минут · Позже · Не сегодня».
    ask_minutes: Option<i64>,
    /// К чему сообщение: дело, проект или мысль.
    task_id: Option<Uuid>,
    project_id: Option<Uuid>,
    inbox_id: Option<Uuid>,
}

fn choices(minutes: i64) -> Vec<Choice> {
    let mut list = vec![Reply::Yes];
    if minutes > 15 {
        list.push(Reply::Short);
    }
    list.extend([Reply::Later, Reply::NotToday]);
    list.into_iter()
        .map(|reply| Choice {
            id: reply.as_str().into(),
            text: reply.label().into(),
        })
        .collect()
}

/// Повод пробуждения, в котором агент работает (ответ на «да» — не в лимите).
async fn run_trigger(conn: &mut PgConnection, who: &Who) -> Result<Option<String>> {
    let Some(run) = who.run else {
        return Ok(None);
    };
    Ok(
        sqlx::query_scalar("SELECT trigger FROM agent_runs WHERE id = $1")
            .bind(run)
            .fetch_optional(conn)
            .await?,
    )
}

/// `notify.send`: написать первым. Сервер проверяет «не писать», «не
/// сегодня», тишину (ночь, урок), лимит дня и «не чаще раза в час» — модель
/// их обойти не может (D-294). Ответ на «да» человека — не в лимите.
pub(crate) async fn send(
    pool: &PgPool,
    who: &Who,
    arguments: Value,
    reason: Option<&str>,
    batch: Option<Uuid>,
) -> Result<Action> {
    if who.actor() != Actor::Agent {
        return Err(Error::Invalid("первым пишет агент".into()));
    }
    let args: SendArgs = serde_json::from_value(arguments)
        .map_err(|error| Error::Invalid(format!("{SEND_TOOL}: {error}")))?;
    let title = args.title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() || title.chars().count() > 200 {
        return Err(Error::Invalid("заголовок — от 1 до 200 знаков".into()));
    }
    if args.body.chars().count() > 1000 {
        return Err(Error::Invalid("текст — до 1000 знаков".into()));
    }
    if let Some(minutes) = args.ask_minutes
        && !(5..=240).contains(&minutes)
    {
        return Err(Error::Invalid("«есть N минут?» — от 5 до 240".into()));
    }
    let object = [args.task_id, args.project_id, args.inbox_id];
    if object.iter().flatten().count() > 1 {
        return Err(Error::Invalid(
            "сообщение — не больше чем к одному объекту".into(),
        ));
    }
    let object = object.into_iter().flatten().next();
    let account = who.account();

    let mut tx = pool.begin().await?;
    lock(&mut tx, account).await?;
    check_agent(&mut tx, who).await?;
    if let Some(id) = object {
        let owner: Option<Uuid> =
            sqlx::query_scalar("SELECT owner_id FROM objects WHERE id = $1 AND deleted_at IS NULL")
                .bind(id)
                .fetch_optional(&mut *tx)
                .await?;
        if owner != Some(account) {
            return Err(Error::NotFound);
        }
    }
    let pace = load_pace(&mut tx, account).await?;
    let now = brain::local_now(&mut tx).await?;
    if pace.mode == Mode::Off {
        return Err(Error::Invalid(
            "владелец просил не писать первым (настройка «не писать»)".into(),
        ));
    }
    if pace.quiet_day == Some(now.date()) {
        return Err(Error::Invalid(
            "владелец сказал «не сегодня» — до завтра первым не пиши".into(),
        ));
    }
    let reply_to_yes = run_trigger(&mut tx, who).await?.as_deref() == Some(Trigger::Reply.as_str());
    if !reply_to_yes {
        if let Some(why) = notice::quiet_now(&mut tx, account)
            .await
            .map_err(notify_error)?
        {
            return Err(Error::Invalid(format!(
                "сейчас тишина ({why}) — первым не пиши"
            )));
        }
        let recent = answers(&mut tx, account, LEARN_DAYS).await?;
        let limit = free::limit(pace.mode, pace.per_day, &recent);
        let (sent, last) = sent_today(&mut tx, account, now.date()).await?;
        if sent >= limit {
            return Err(Error::Invalid(format!(
                "лимит на сегодня исчерпан: {sent} из {limit}"
            )));
        }
        if let Some(last) = last
            && (OffsetDateTime::now_utc() - last).whole_minutes() < free::GAP_MINUTES
        {
            return Err(Error::Invalid(
                "первым — не чаще раза в час; напиши позже".into(),
            ));
        }
    }

    let summary = match args.ask_minutes {
        Some(minutes) => format!("Написал первым: «{title}» (спросил про {minutes} мин)"),
        None => format!("Написал первым: «{title}»"),
    };
    let action = execute_in(
        &mut tx,
        who,
        Plan {
            tool: SEND_TOOL.into(),
            summary,
            reason: reason.map(str::to_owned),
            batch: batch.unwrap_or_else(Uuid::now_v7),
            reverts: None,
            corrects: None,
            steps: Vec::new(),
        },
    )
    .await?;
    let sent = notice::send(
        &mut tx,
        qubite_notify::NewNotice {
            account_id: account,
            kind: qubite_notify::Kind::Agent,
            origin: qubite_notify::Origin::Agent,
            title,
            body: args.body.trim().to_owned(),
            why: reason.unwrap_or_default().to_owned(),
            object_id: object,
            dedup_key: Some(format!("agent:{}", action.id)),
            options: args.ask_minutes.map(choices).unwrap_or_default(),
        },
    )
    .await
    .map_err(notify_error)?
    .ok_or_else(|| Error::Invalid("сообщение уже отправлено".into()))?;
    sqlx::query(
        "INSERT INTO agent_nudges (id, account_id, notice_id, action_id, local_at, ask_minutes, \
             object_id, counted) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
    )
    .bind(Uuid::now_v7())
    .bind(account)
    .bind(sent.id)
    .bind(action.id)
    .bind(now)
    .bind(args.ask_minutes.and_then(|m| i32::try_from(m).ok()))
    .bind(object)
    .bind(!reply_to_yes)
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(action)
}

/// Откат сообщения агента: оно гаснет в колокольчике и Telegram (отправленное
/// не вернуть, но и висеть оно не будет).
pub(crate) async fn on_revert(conn: &mut PgConnection, account: Uuid, action: Uuid) -> Result<()> {
    let notice: Option<Uuid> =
        sqlx::query_scalar("SELECT notice_id FROM agent_nudges WHERE action_id = $1")
            .bind(action)
            .fetch_optional(&mut *conn)
            .await?;
    if let Some(notice) = notice {
        notice::mark_read(conn, account, notice)
            .await
            .map_err(notify_error)?;
    }
    Ok(())
}

// ---------------------------------------------------------------- ответ кнопкой

/// Что сделали с ответом — подсказка в Telegram.
#[derive(Debug, Clone, Serialize)]
pub struct AnswerOutcome {
    pub answer: String,
    pub hint: String,
}

/// Ответ кнопкой под сообщением (колокольчик или Telegram). У сообщения агента
/// «да» и «15 минут» будят его — предложить дело под окно; «позже» —
/// спросить через час; «не сегодня» — молчать до завтра. Уже отвечали — `None`.
pub async fn answer(
    pool: &PgPool,
    account: Uuid,
    notice_id: Uuid,
    choice: &str,
) -> Result<Option<AnswerOutcome>> {
    let mut tx = pool.begin().await?;
    let Some(_) = notice::answer(&mut tx, account, notice_id, choice)
        .await
        .map_err(notify_error)?
    else {
        return Ok(None);
    };
    let nudge: Option<Uuid> = sqlx::query_scalar(
        "UPDATE agent_nudges SET answer = $2, answered_at = now() \
         WHERE notice_id = $1 AND answer IS NULL RETURNING id",
    )
    .bind(notice_id)
    .bind(choice)
    .fetch_optional(&mut *tx)
    .await?;
    let reply = Reply::parse(choice);
    let hint = match (nudge, reply) {
        (Some(nudge), Some(Reply::Yes | Reply::Short)) => {
            enqueue_wake(
                &mut tx,
                account,
                Trigger::Reply,
                Some(nudge),
                None,
                format!("reply:{nudge}"),
            )
            .await?;
            "Хорошо — сейчас предложу, чем заняться"
        }
        (Some(nudge), Some(Reply::Later)) => {
            let at = OffsetDateTime::now_utc() + Duration::minutes(LATER_MINUTES);
            enqueue_wake(
                &mut tx,
                account,
                Trigger::Window,
                None,
                Some(at),
                format!("later:{nudge}"),
            )
            .await?;
            "Понял, спрошу позже"
        }
        (Some(_), Some(Reply::NotToday)) => {
            let mut pace = load_pace(&mut tx, account).await?;
            pace.quiet_day = Some(brain::local_now(&mut tx).await?.date());
            store_pace(&mut tx, account, &pace).await?;
            "Хорошо, сегодня больше не пишу первым"
        }
        _ => "Ответ принят",
    };
    tx.commit().await?;
    Ok(Some(AnswerOutcome {
        answer: choice.to_owned(),
        hint: hint.into(),
    }))
}

// ---------------------------------------------------------------- пробуждения

/// Задача `agent.wake`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Wake {
    pub account_id: Uuid,
    pub trigger: Trigger,
    /// Для ответа: на какое сообщение ответили.
    #[serde(default)]
    pub nudge_id: Option<Uuid>,
}

async fn enqueue_wake(
    conn: &mut PgConnection,
    account: Uuid,
    trigger: Trigger,
    nudge: Option<Uuid>,
    at: Option<OffsetDateTime>,
    key: String,
) -> Result<()> {
    let mut job = qubite_jobs::NewJob::new(
        WAKE_JOB,
        serde_json::to_value(Wake {
            account_id: account,
            trigger,
            nudge_id: nudge,
        })?,
    )
    .idempotency_key(format!("{WAKE_JOB}:{account}:{key}"))
    .max_attempts(2);
    if let Some(at) = at {
        job = job.run_at(at);
    }
    qubite_jobs::enqueue_in(conn, job)
        .await
        .map_err(|error| Error::Invalid(error.to_string()))?;
    Ok(())
}

async fn at_local(conn: &mut PgConnection, date: Date, minutes: i64) -> Result<OffsetDateTime> {
    let local = PrimitiveDateTime::new(date, Time::MIDNIGHT) + Duration::minutes(minutes);
    Ok(qubite_planner::reminder::to_instant(conn, local).await?)
}

fn time_minutes(time: Time) -> i64 {
    i64::from(time.hour()) * 60 + i64::from(time.minute())
}

/// Поставить пробуждения: утро (сегодня, если ещё не наступило, и завтра) и
/// свободные окна до конца сегодня. Если близко срок или урок — одно из
/// вечерних окон будит «по сроку». Повторный вызов ничего не дублирует.
pub async fn plan_ahead(pool: &PgPool, account: Uuid) -> Result<usize> {
    let mut tx = pool.begin().await?;
    let now = brain::local_now(&mut tx).await?;
    let count = plan_day(&mut tx, account, now).await?;
    tx.commit().await?;
    Ok(count)
}

async fn plan_day(conn: &mut PgConnection, account: Uuid, now: PrimitiveDateTime) -> Result<usize> {
    let settings = qubite_notify::settings::load(conn, account)
        .await
        .map_err(notify_error)?;
    let today = now.date();
    let morning = time_minutes(settings.quiet_to);
    let mut planned = 0;
    let tomorrow = today + Duration::days(1);
    let at = at_local(conn, tomorrow, morning).await?;
    enqueue_wake(
        conn,
        account,
        Trigger::Morning,
        None,
        Some(at),
        format!("{tomorrow}:morning"),
    )
    .await?;
    planned += 1;
    if time_minutes(now.time()) < morning {
        let at = at_local(conn, today, morning).await?;
        enqueue_wake(
            conn,
            account,
            Trigger::Morning,
            None,
            Some(at),
            format!("{today}:morning"),
        )
        .await?;
        planned += 1;
    }
    let (windows, _) = day_windows(conn, account, today, now).await?;
    let times = free::wake_times(&windows, settings.quiet_to);
    let tasks = qubite_planner::list_tasks(conn, account, None, 1000).await?;
    let projects = qubite_planner::list_projects(conn, account).await?;
    let slots = schedule::slots(conn, account).await?;
    let urgent = free::candidates(now, &tasks, &projects, &slots, &HashMap::new(), 1)
        .first()
        .is_some_and(|candidate| candidate.tier == 1);
    // «По сроку» — первое окно с 16:00 (вечер накануне), иначе последнее.
    let due_at = urgent
        .then(|| {
            times
                .iter()
                .find(|t| **t >= 16 * 60)
                .or(times.last())
                .copied()
        })
        .flatten();
    for minutes in times {
        if minutes <= time_minutes(now.time()) {
            continue;
        }
        let trigger = if Some(minutes) == due_at {
            Trigger::Due
        } else {
            Trigger::Window
        };
        let at = at_local(conn, today, minutes).await?;
        let key = format!("{today}:{:02}{:02}", minutes / 60, minutes % 60);
        enqueue_wake(conn, account, trigger, None, Some(at), key).await?;
        planned += 1;
    }
    Ok(planned)
}

/// При старте `qubite serve`: завести пробуждения всем, у кого есть агент.
pub async fn bootstrap(pool: &PgPool) -> Result<usize> {
    let accounts: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM accounts ORDER BY id")
        .fetch_all(pool)
        .await?;
    let module = qubite_policy::ModuleId::new(crate::MODULE)?;
    let mut done = 0;
    for account in accounts {
        let subject = Who {
            account,
            actor: Actor::Agent,
            run: None,
            session: None,
            ai_call: None,
            skill: None,
        }
        .subject();
        if qubite_policy::decide::<qubite_policy::Write>(pool, &subject, &module)
            .await
            .is_err()
        {
            continue;
        }
        plan_ahead(pool, account).await?;
        done += 1;
    }
    Ok(done)
}

/// Чем кончилось пробуждение.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WakeOutcome {
    /// Модель не звали: почему.
    Skipped(String),
    /// Агент подумал: сколько действий сделал.
    Done { actions: i32 },
}

const WAKE_TOOLS_TEXT: &str = r#"Ещё инструменты этого пробуждения:
- time.free_windows {"days"?} — свободные окна по дням (без ночи, уроков и дел со временем).
- presence.now {} — на связи ли владелец: Qubite открыт, Telegram, тишина, сколько осталось окна.
- notify.send {"title", "body"?, "ask_minutes"?, "task_id"?} (обязательно "why") — написать владельцу первым. С ask_minutes будут кнопки «Да · 15 минут · Позже · Не сегодня». Лимит дня, тишину и «не чаще раза в час» проверяет сервер — отказ придёт ошибкой.
- home.digest.write {"items": [{"kind": "important|noticed|question|news|tip", "text", "task_id"|"project_id"|"inbox_id"|"action_id"|"url"}]} — сводка на Главную (только утром)."#;

const MORNING_TEXT: &str = "Утро. Напиши сводку на Главную (home.digest.write): важное на \
сегодня (дела со сроком, урок, к которому нужно ДЗ), что заметил, 1–3 вопроса из «Агент хочет \
знать». Каждый пункт ведёт к своему делу. Первым сейчас не пиши — для этого будут свободные окна. \
Дел нет — можно один совет или вопрос.";

const WINDOW_TEXT: &str = "Похоже, у владельца свободное окно (блок situation). Реши, стоит ли \
написать первым. Если да — ОДИН notify.send: спроси «Есть N минут?» (ask_minutes — сколько \
осталось окна, но не больше 60) и в body коротко, что предложишь. Что предложить — бери по порядку \
из блока candidates: сначала срок или урок, потом важное, потом давно не вспоминавшиеся идеи; \
длинное дело — только первым шагом под окно; task_id — то, что предлагаешь. Если в блоке patterns \
закономерность повторилась 3 и больше раз, а в «О тебе» её нет — запиши её memory.add в \
«О тебе.md» одной строкой. Нечего предложить или недавно уже спрашивал — верни {\"tools\": []}.";

const DUE_TEXT: &str = "Приближается срок или урок (первое в блоке candidates). Если дело ещё не \
сделано — напомни ОДНИМ notify.send: спроси «Есть N минут?» (ask_minutes — сколько осталось окна, \
не больше 60), в body — что именно сделать (длинное — первый шаг), task_id — это дело. «Сделано» \
не отмечай — это делает владелец.";

const REPLY_TEXT: &str = "Владелец ответил на твоё «есть время?» (блок situation: ответ и \
сколько минут). Предложи ОДНО конкретное дело из candidates одним notify.send без ask_minutes: \
title — что сделать, body — с чего начать за это время (длинное — только первый шаг), task_id — \
это дело. Можно разбить длинное дело на шаги (task.update, поле subtasks), если шагов ещё нет.";

const MORNING_TOOLS: &[&str] = &[
    "home.digest.write",
    "question.list",
    "question.ask",
    "task.search",
    "task.get",
    "project.list",
    "files.list",
    "files.read",
    "memory.add",
    "skill.list",
    "skill.view",
    WINDOWS_TOOL,
    PRESENCE_TOOL,
];

const WINDOW_TOOLS: &[&str] = &[
    SEND_TOOL,
    WINDOWS_TOOL,
    PRESENCE_TOOL,
    "task.search",
    "task.get",
    "task.update",
    "project.list",
    "files.list",
    "files.read",
    "memory.add",
    "question.ask",
    "skill.list",
    "skill.view",
];

fn weekday_name(date: Date) -> &'static str {
    [
        "понедельник",
        "вторник",
        "среда",
        "четверг",
        "пятница",
        "суббота",
        "воскресенье",
    ][usize::from(date.weekday().number_days_from_monday())]
}

/// Блок situation: повод, окна, лимит, на связи ли, ответ.
#[allow(clippy::too_many_arguments)]
fn situation(
    wake: &Wake,
    now: PrimitiveDateTime,
    pace: &Pace,
    limit: i64,
    sent: i64,
    presence: &Presence,
    windows: &[Window],
    answered: Option<(&str, Option<i32>)>,
) -> String {
    let mut lines = vec![format!(
        "Сейчас: {}, {}, {:02}:{:02}.",
        qubite_planner::format_date(now.date()),
        weekday_name(now.date()),
        now.hour(),
        now.minute()
    )];
    lines.push(format!(
        "Повод: {}.",
        match wake.trigger {
            Trigger::Morning => "утро",
            Trigger::Window => "свободное окно",
            Trigger::Due => "близко срок или урок",
            Trigger::Reply => "владелец ответил",
            _ => "вручную",
        }
    ));
    let mode = match pace.mode {
        Mode::Auto => "сколько сам решишь (учишься по ответам)".to_owned(),
        Mode::Count => format!("не больше {} в день", pace.per_day),
        Mode::Off => "не писать первым".to_owned(),
    };
    lines.push(format!(
        "Писать первым: {mode}; сегодня уже {sent} из {limit}."
    ));
    let online = match (presence.in_qubite, presence.telegram_minutes_ago) {
        (true, _) => "сидит в Qubite".to_owned(),
        (false, Some(m)) if m <= TELEGRAM_FRESH_MINUTES => {
            format!("отвечал в Telegram {m} мин назад")
        }
        _ => "не в Qubite".to_owned(),
    };
    lines.push(format!("Владелец: {online}."));
    if let Some(left) = presence.free_minutes {
        lines.push(format!("Свободно ещё {left} мин."));
    }
    if !windows.is_empty() {
        lines.push(format!(
            "Окна сегодня: {}.",
            windows
                .iter()
                .map(free::window_text)
                .collect::<Vec<_>>()
                .join(", ")
        ));
    }
    if let Some((answer, minutes)) = answered {
        let label =
            Reply::parse(answer).map_or_else(|| answer.to_owned(), |r| r.label().to_owned());
        let minutes = match (Reply::parse(answer), minutes) {
            (Some(Reply::Short), _) => 15,
            (_, Some(m)) => i64::from(m),
            _ => 30,
        };
        lines.push(format!("Ответ: «{label}» — есть {minutes} мин."));
    }
    lines.join("\n")
}

/// Проснуться по поводу (задача `agent.wake`). Сначала — дешёвые проверки
/// без модели (тишина, «не сегодня», лимит, бюджет, AI); прошли — один ход
/// агента. `now` — время по часам владельца (в тестах — своё).
pub async fn wake(
    pool: &PgPool,
    gateway: &Gateway,
    wake: &Wake,
    job: Option<Uuid>,
    now: Option<PrimitiveDateTime>,
) -> Result<WakeOutcome> {
    let account = wake.account_id;
    let mut conn = pool.acquire().await?;
    let now = match now {
        Some(now) => now,
        None => brain::local_now(&mut conn).await?,
    };
    if wake.trigger != Trigger::Reply {
        plan_day(&mut conn, account, now).await?;
    }
    let skip = |why: &str| Ok(WakeOutcome::Skipped(why.to_owned()));

    let settings = qubite_notify::settings::load(&mut conn, account)
        .await
        .map_err(notify_error)?;
    let pace = load_pace(&mut conn, account).await?;
    let slots = schedule::slots(&mut conn, account).await?;
    let recent = answers(&mut conn, account, LEARN_DAYS).await?;
    let limit = free::limit(pace.mode, pace.per_day, &recent);
    let (sent, last) = sent_today(&mut conn, account, now.date()).await?;
    let (windows, _) = day_windows(&mut conn, account, now.date(), now).await?;
    let mut answered: Option<(String, Option<i32>)> = None;
    match wake.trigger {
        Trigger::Window | Trigger::Due => {
            if pace.mode == Mode::Off {
                return skip("настройка «не писать первым»");
            }
            if let Some(why) = quiet_reason(&settings, &slots, &pace, now) {
                return skip(&format!("тишина: {why}"));
            }
            if sent >= limit {
                return skip("лимит дня исчерпан");
            }
            if let Some(last) = last
                && (OffsetDateTime::now_utc() - last).whole_minutes() < free::GAP_MINUTES
            {
                return skip("писал меньше часа назад");
            }
            if !windows.iter().any(|window| window.left(now).is_some()) {
                return skip("сейчас нет свободного окна");
            }
        }
        Trigger::Reply => {
            let row: Option<(Option<String>, Option<i32>)> = sqlx::query_as(
                "SELECT answer, ask_minutes FROM agent_nudges WHERE id = $1 AND account_id = $2",
            )
            .bind(wake.nudge_id)
            .bind(account)
            .fetch_optional(&mut *conn)
            .await?;
            match row {
                Some((Some(answer), minutes))
                    if Reply::parse(&answer).is_some_and(Reply::positive) =>
                {
                    answered = Some((answer, minutes));
                }
                _ => return skip("ответа «да» нет"),
            }
        }
        Trigger::Morning => {}
        _ => return skip("не повод для проактивности"),
    }
    let wakes: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM agent_runs WHERE account_id = $1 \
         AND trigger IN ('morning', 'window', 'due', 'reply') \
         AND started_at > now() - interval '1 day' \
         AND (started_at AT TIME ZONE coalesce( \
             (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), $2))::date = $3",
    )
    .bind(account)
    .bind(qubite_planner::DEFAULT_TIMEZONE)
    .bind(now.date())
    .fetch_one(&mut *conn)
    .await?;
    if wakes >= free::MAX_WAKES {
        return skip("бюджет агента на сегодня исчерпан");
    }
    drop(conn);

    let run = match start_run(pool, account, wake.trigger).await {
        Ok(run) => run,
        Err(Error::Denied(_)) => return skip("нет агента"),
        Err(error) => return Err(error),
    };
    let Ok(auth) = brain::ai_auth(pool, account).await else {
        finish_run(pool, &run, false).await?;
        return skip("нет AI для агента");
    };
    let result = think(
        pool, gateway, &auth, &run, wake, now, &pace, limit, sent, &windows, answered, job,
    )
    .await;
    finish_run(pool, &run, result.is_ok()).await?;
    match result {
        Ok(actions) => Ok(WakeOutcome::Done { actions }),
        // Без AI (бюджет, лимит человека) — тихо пропускаем, ничего не ломаем.
        Err(error) => Ok(WakeOutcome::Skipped(format!("AI не ответил: {error}"))),
    }
}

#[allow(clippy::too_many_arguments)]
async fn think(
    pool: &PgPool,
    gateway: &Gateway,
    auth: &qubite_policy::Authorized<qubite_policy::UseAi>,
    run: &Run,
    wake: &Wake,
    now: PrimitiveDateTime,
    pace: &Pace,
    limit: i64,
    sent: i64,
    windows: &[Window],
    answered: Option<(String, Option<i32>)>,
    job: Option<Uuid>,
) -> std::result::Result<i32, qubite_ai::AiError> {
    let account = wake.account_id;
    let fail = |error: Error| qubite_ai::AiError::Invalid(error.to_string());
    memory::ensure_base(pool, account).await.map_err(fail)?;
    let mut conn = pool.acquire().await?;
    let presence = presence(&mut conn, account, now).await.map_err(fail)?;
    let tasks = qubite_planner::list_tasks(&mut conn, account, None, 1000)
        .await
        .map_err(|error| fail(error.into()))?;
    let projects = qubite_planner::list_projects(&mut conn, account)
        .await
        .map_err(|error| fail(error.into()))?;
    let slots = schedule::slots(&mut conn, account).await?;
    let mentioned = mentioned(&mut conn, account).await.map_err(fail)?;
    let list = free::candidates(now, &tasks, &projects, &slots, &mentioned, 6);
    let history = answers(&mut conn, account, PATTERN_DAYS)
        .await
        .map_err(fail)?;
    let about = list
        .iter()
        .map(|candidate| candidate.title.clone())
        .collect::<Vec<_>>()
        .join(" ");
    let mut data = brain::context(&mut conn, account, &about, None)
        .await
        .map_err(fail)?;
    drop(conn);
    data.push(Untrusted::new(
        "situation",
        situation(
            wake,
            now,
            pace,
            limit,
            sent,
            &presence,
            windows,
            answered.as_ref().map(|(a, m)| (a.as_str(), *m)),
        ),
    ));
    data.push(Untrusted::new(
        "candidates",
        if list.is_empty() {
            "Предложить нечего: нет дел без времени и идей.".to_owned()
        } else {
            list.iter()
                .enumerate()
                .map(|(i, c)| format!("{}. {}", i + 1, free::candidate_text(c)))
                .collect::<Vec<_>>()
                .join("\n")
        },
    ));
    let patterns = free::patterns(&history);
    if !patterns.is_empty() {
        data.push(Untrusted::new("patterns", patterns.join("\n")));
    }
    let (text, tools) = match wake.trigger {
        Trigger::Morning => (MORNING_TEXT, MORNING_TOOLS),
        Trigger::Due => (DUE_TEXT, WINDOW_TOOLS),
        Trigger::Reply => (REPLY_TEXT, WINDOW_TOOLS),
        _ => (WINDOW_TEXT, WINDOW_TOOLS),
    };
    let task = format!("{text}\n\n{WAKE_TOOLS_TEXT}");
    let turn = brain::run_rounds(
        pool,
        gateway,
        auth,
        &Who::agent(run),
        WAKE_TASK,
        &task,
        tools,
        data,
        job,
        &format!("agent-wake:{}", run.id),
    )
    .await?;
    Ok(turn.actions)
}

// ---------------------------------------------------------------- для экрана

/// Что видно на вкладке «Когда писать».
#[derive(Debug, Clone, Serialize)]
pub struct Status {
    pub pace: Pace,
    /// Сегодня сказал «не сегодня».
    pub not_today: bool,
    /// Сколько можно сегодня и сколько уже написал.
    pub limit: i64,
    pub sent: i64,
    pub presence: Presence,
    /// Свободные окна до конца дня.
    pub windows: Vec<Window>,
    /// Закономерности из ответов.
    pub patterns: Vec<String>,
}

/// Состояние для экрана; заодно заводит пробуждения (открыл вкладку — агент
/// точно не «спит» до перезапуска сервера).
pub async fn status(pool: &PgPool, who: &Who) -> Result<Status> {
    let account = who.account();
    let mut conn = pool.acquire().await?;
    check_agent(&mut conn, who).await?;
    let now = brain::local_now(&mut conn).await?;
    let pace = load_pace(&mut conn, account).await?;
    let recent = answers(&mut conn, account, LEARN_DAYS).await?;
    let (sent, _) = sent_today(&mut conn, account, now.date()).await?;
    let presence = presence(&mut conn, account, now).await?;
    let (windows, _) = day_windows(&mut conn, account, now.date(), now).await?;
    let history = answers(&mut conn, account, PATTERN_DAYS).await?;
    drop(conn);
    plan_ahead(pool, account).await?;
    Ok(Status {
        not_today: pace.quiet_day == Some(now.date()),
        pace,
        limit: free::limit(pace.mode, pace.per_day, &recent),
        sent,
        presence,
        windows,
        patterns: free::patterns(&history),
    })
}

/// Последние сообщения, где агент написал первым (для ленты экрана нет —
/// они в «Ленте» агента; здесь для тестов и отладки).
pub async fn recent_nudges(
    pool: &PgPool,
    account: Uuid,
) -> Result<Vec<(Uuid, Option<String>, bool)>> {
    Ok(sqlx::query_as(
        "SELECT notice_id, answer, counted FROM agent_nudges WHERE account_id = $1 \
         ORDER BY created_at DESC LIMIT 50",
    )
    .bind(account)
    .fetch_all(pool)
    .await?)
}

fn notify_error(error: qubite_notify::Error) -> Error {
    match error {
        qubite_notify::Error::Db(error) => Error::Db(error),
        qubite_notify::Error::NotFound => Error::NotFound,
        other => Error::Invalid(other.to_string()),
    }
}
