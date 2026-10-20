//! Когда напомнить о деле (PLAN-004, D-310…D-312).
//!
//! Время по умолчанию задаёт **смысл записи**: у дела со временем — за 15
//! минут, «сходить куда-то» — за час, с запасом на дорогу. Дело без времени
//! само не напоминает: о нём вспомнит агент (D-290). Человек или агент может
//! поставить своё — «за N минут» или точное время — и написать «почему»
//! (`remind_why`): так агент (AGT-004) объясняет свой выбор.
//!
//! Напоминание — задача в очереди `jobs` на нужный момент (без постоянного
//! процесса и без расписания по cron). При каждом изменении дела задача
//! ставится заново с ключом «дело + время»: то же время — та же задача.
//! Устаревшую задачу (дело перенесли, сделали, удалили) обработчик узнаёт
//! по [`due`] и пропускает.

use serde::{Deserialize, Serialize};
use serde_json::json;
use sqlx::PgConnection;
use time::{Date, Duration, OffsetDateTime, PrimitiveDateTime};
use uuid::Uuid;

use crate::{
    DEFAULT_TIMEZONE, Status, Task, format_date, format_time, millis, parse_date, parse_time,
    task_any,
};

/// Вид задачи в очереди `jobs`.
pub const JOB: &str = "planner.remind";
/// Дольше недели «за N минут» не бывает.
pub const MAX_BEFORE_MINUTES: u16 = 7 * 24 * 60;

/// Своё время напоминания. Нет — «само» (по смыслу дела).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", deny_unknown_fields)]
pub enum Remind {
    /// За столько минут до срока (нужно время у срока).
    Before(u16),
    /// В это время по часам владельца: `2026-10-20T19:00`.
    At(String),
    /// Не напоминать.
    Off(bool),
}

impl Remind {
    /// Проверить и привести к одному виду.
    pub fn normalized(self) -> Result<Self, String> {
        match self {
            Self::Before(minutes) if minutes > MAX_BEFORE_MINUTES => {
                Err("напомнить можно не раньше чем за неделю".into())
            }
            Self::At(text) => parse_local(&text).map(|at| Self::At(format_local(at))),
            Self::Off(_) => Ok(Self::Off(true)),
            other => Ok(other),
        }
    }
}

/// `2026-10-20T19:00` → дата и время без пояса.
pub fn parse_local(text: &str) -> Result<PrimitiveDateTime, String> {
    let (date, time) = text
        .split_once('T')
        .ok_or_else(|| format!("неверное время напоминания «{text}», нужно ГГГГ-ММ-ДДTЧЧ:ММ"))?;
    Ok(PrimitiveDateTime::new(parse_date(date)?, parse_time(time)?))
}

pub fn format_local(at: PrimitiveDateTime) -> String {
    format!("{}T{}", format_date(at.date()), format_time(at.time()))
}

/// Значения «само» человека (настройки каналов, `notify_settings`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Defaults {
    /// До дела со временем.
    pub before_minutes: u16,
    /// До «сходить куда-то».
    pub travel_minutes: u16,
}

impl Default for Defaults {
    fn default() -> Self {
        Self {
            before_minutes: 15,
            travel_minutes: 60,
        }
    }
}

/// Когда и почему напомнить.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Plan {
    /// По часам владельца.
    pub at: PrimitiveDateTime,
    pub why: String,
}

/// «Сходить куда-то»: выйти из дома, а не сделать за столом. Пока — по
/// словам названия; позже место и дорогу знает агент (память «Обо мне»).
pub fn is_outing(title: &str) -> bool {
    const STEMS: &[&str] = &[
        "сход",
        "пойти",
        "пойду",
        "идти",
        "поех",
        "съезд",
        "съезж",
        "заех",
        "зайти",
        "зайду",
        "встреч",
        "врач",
        "стоматолог",
        "поликлиник",
        "больниц",
        "музей",
        "кино",
        "театр",
        "концерт",
        "выставк",
        "тренировк",
        "секци",
        "бассейн",
        "забрать",
        "отвез",
        "отвести",
        "приём",
        "прием",
        "запись к",
        "экскурси",
        "вокзал",
        "аэропорт",
        "поезд",
    ];
    let lower = title.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    STEMS.iter().any(|stem| {
        if stem.contains(' ') {
            lower.contains(stem)
        } else {
            words.iter().any(|word| word.starts_with(stem))
        }
    })
}

/// «за 15 минут», «за час», «за 2 ч 30 мин».
pub fn minutes_text(minutes: u16) -> String {
    let (hours, rest) = (minutes / 60, minutes % 60);
    match (hours, rest) {
        (0, _) => format!("за {minutes} мин"),
        (1, 0) => "за час".into(),
        (_, 0) => format!("за {hours} ч"),
        _ => format!("за {hours} ч {rest} мин"),
    }
}

/// Когда напомнить (по часам владельца) — или не напоминать.
pub fn plan(task: &Task, defaults: Defaults) -> Option<Plan> {
    if task.deleted || task.status == Status::Done {
        return None;
    }
    let due = match (task.due_date, task.due_time) {
        (Some(date), Some(time)) => Some(PrimitiveDateTime::new(date, time)),
        _ => None,
    };
    let own = |why: String| {
        if task.remind_why.trim().is_empty() {
            why
        } else {
            task.remind_why.trim().to_owned()
        }
    };
    match &task.remind {
        Some(Remind::Off(_)) => None,
        Some(Remind::At(text)) => parse_local(text).ok().map(|at| Plan {
            at,
            why: own("ты выбрал это время".into()),
        }),
        Some(Remind::Before(minutes)) => due.map(|due| Plan {
            at: due - Duration::minutes(i64::from(*minutes)),
            why: own(format!("{} до срока", minutes_text(*minutes))),
        }),
        None => due.map(|due| {
            let (minutes, why) = if is_outing(&task.title) {
                let minutes = defaults.travel_minutes;
                (
                    minutes,
                    format!(
                        "сходить куда-то — {}, с запасом на дорогу",
                        minutes_text(minutes)
                    ),
                )
            } else {
                let minutes = defaults.before_minutes;
                (minutes, format!("{} до срока", minutes_text(minutes)))
            };
            Plan {
                at: due - Duration::minutes(i64::from(minutes)),
                why: own(why),
            }
        }),
    }
}

/// Значения «само» человека.
pub async fn defaults(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Defaults> {
    let row: Option<(i32, i32)> = sqlx::query_as(
        "SELECT before_minutes, travel_minutes FROM notify_settings WHERE account_id = $1",
    )
    .bind(account)
    .fetch_optional(conn)
    .await?;
    Ok(
        row.map_or_else(Defaults::default, |(before, travel)| Defaults {
            before_minutes: u16::try_from(before).unwrap_or(15),
            travel_minutes: u16::try_from(travel).unwrap_or(60),
        }),
    )
}

/// Время по часам владельца → момент (пояс платформы).
pub async fn to_instant(
    conn: &mut PgConnection,
    local: PrimitiveDateTime,
) -> sqlx::Result<OffsetDateTime> {
    sqlx::query_scalar(
        "SELECT $1::timestamp AT TIME ZONE coalesce( \
             (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), $2)",
    )
    .bind(local)
    .bind(DEFAULT_TIMEZONE)
    .fetch_one(conn)
    .await
}

/// Поставить напоминание о деле в очередь (если оно нужно). Вызывается в
/// той же транзакции, что и изменение дела. Возвращает момент напоминания.
pub async fn schedule(
    conn: &mut PgConnection,
    task_id: Uuid,
) -> Result<Option<OffsetDateTime>, qubite_jobs::Error> {
    let Some(task) = task_any(conn, task_id)
        .await
        .map_err(|error| qubite_jobs::Error::Invalid(error.to_string()))?
    else {
        return Ok(None);
    };
    let defaults = defaults(conn, task.owner_id).await?;
    let Some(plan) = plan(&task, defaults) else {
        return Ok(None);
    };
    let at = to_instant(conn, plan.at).await?;
    let now = OffsetDateTime::now_utc();
    if at < now {
        // Опоздали с напоминанием (дело поставили впритык) — напомнить сразу,
        // если само дело ещё впереди; иначе уже незачем.
        let due = match (task.due_date, task.due_time) {
            (Some(date), Some(time)) => {
                Some(to_instant(conn, PrimitiveDateTime::new(date, time)).await?)
            }
            _ => None,
        };
        if !due.is_some_and(|due| due > now) {
            return Ok(None);
        }
    }
    let at_ms = millis(at);
    qubite_jobs::enqueue_in(
        conn,
        qubite_jobs::NewJob::new(JOB, json!({ "task_id": task.id, "at_ms": at_ms }))
            .run_at(at.max(now))
            .max_attempts(3)
            .idempotency_key(format!("remind:{}:{at_ms}", task.id)),
    )
    .await?;
    Ok(Some(at))
}

/// Задача очереди ещё актуальна? Дело живо, не сделано, и время напоминания
/// то же, что при постановке. Возвращает дело и план.
pub async fn due(
    conn: &mut PgConnection,
    task_id: Uuid,
    at_ms: i64,
) -> crate::Result<Option<(Task, Plan)>> {
    let Some(task) = task_any(conn, task_id).await? else {
        return Ok(None);
    };
    let defaults = defaults(conn, task.owner_id).await?;
    let Some(plan) = plan(&task, defaults) else {
        return Ok(None);
    };
    if millis(to_instant(conn, plan.at).await?) != at_ms {
        return Ok(None);
    }
    Ok(Some((task, plan)))
}

/// Следующее дело серии: своё точное время сдвигается вместе со сроком.
pub(crate) fn shifted(remind: Option<&Remind>, from: Date, to: Date) -> Option<Remind> {
    match remind? {
        Remind::At(text) => {
            let at = parse_local(text).ok()?;
            Some(Remind::At(format_local(at + (to - from))))
        }
        other => Some(other.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Priority;
    use time::macros::{date, datetime, time};

    fn task(title: &str) -> Task {
        Task {
            id: Uuid::nil(),
            owner_id: Uuid::nil(),
            title: title.into(),
            revision: 1,
            deleted: false,
            notes: String::new(),
            status: Status::Todo,
            priority: Priority::Normal,
            due_date: Some(date!(2026 - 10 - 20)),
            due_time: Some(time!(16:00)),
            subtasks: Vec::new(),
            recurrence: None,
            remind: None,
            remind_why: String::new(),
            remind_by: crate::RemindBy::Auto,
            completed_at: None,
            project_id: None,
            series_id: None,
            next_id: None,
            created_at: OffsetDateTime::UNIX_EPOCH,
            updated_at: OffsetDateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn meaning_sets_the_default_time() {
        let homework = plan(&task("№ 214–220 по алгебре"), Defaults::default()).unwrap();
        assert_eq!(homework.at, datetime!(2026-10-20 15:45));
        assert_eq!(homework.why, "за 15 мин до срока");

        let museum = plan(&task("Сходить в музей"), Defaults::default()).unwrap();
        assert_eq!(museum.at, datetime!(2026-10-20 15:00));
        assert_eq!(museum.why, "сходить куда-то — за час, с запасом на дорогу");

        let doctor = plan(
            &task("к стоматологу"),
            Defaults {
                before_minutes: 10,
                travel_minutes: 90,
            },
        )
        .unwrap();
        assert_eq!(doctor.at, datetime!(2026-10-20 14:30));
        assert_eq!(
            doctor.why,
            "сходить куда-то — за 1 ч 30 мин, с запасом на дорогу"
        );
    }

    #[test]
    fn no_time_no_reminder_unless_asked() {
        let mut idea = task("Амбициозная идея");
        idea.due_time = None;
        assert_eq!(plan(&idea, Defaults::default()), None);
        idea.remind = Some(Remind::At("2026-10-19T19:00".into()));
        idea.remind_why = "ДЗ — вечером накануне".into();
        let at = plan(&idea, Defaults::default()).unwrap();
        assert_eq!(at.at, datetime!(2026-10-19 19:00));
        assert_eq!(at.why, "ДЗ — вечером накануне");
    }

    #[test]
    fn own_choice_and_off() {
        let mut item = task("Контрольная");
        item.remind = Some(Remind::Before(120));
        assert_eq!(
            plan(&item, Defaults::default()).unwrap(),
            Plan {
                at: datetime!(2026-10-20 14:00),
                why: "за 2 ч до срока".into()
            }
        );
        item.remind = Some(Remind::Off(true));
        assert_eq!(plan(&item, Defaults::default()), None);
        item.remind = None;
        item.status = Status::Done;
        assert_eq!(plan(&item, Defaults::default()), None);
    }

    #[test]
    fn remind_json_and_checks() {
        let parsed: Remind = serde_json::from_value(json!({ "before": 30 })).unwrap();
        assert_eq!(parsed, Remind::Before(30));
        let parsed: Remind = serde_json::from_value(json!({ "at": "2026-10-20T7:05" })).unwrap();
        assert_eq!(
            parsed.normalized().unwrap(),
            Remind::At("2026-10-20T07:05".into())
        );
        assert!(Remind::Before(MAX_BEFORE_MINUTES + 1).normalized().is_err());
        assert!(Remind::At("завтра".into()).normalized().is_err());
        assert!(serde_json::from_value::<Remind>(json!({ "at": "x", "before": 1 })).is_err());
    }

    #[test]
    fn outings() {
        assert!(is_outing("Сходить в музей"));
        assert!(is_outing("встреча с Петей"));
        assert!(is_outing("забрать посылку"));
        assert!(!is_outing("Сделать ДЗ по русскому"));
        assert!(!is_outing("Прочитать главу"));
    }

    #[test]
    fn series_shift_keeps_own_time() {
        let next = shifted(
            Some(&Remind::At("2026-10-19T19:00".into())),
            date!(2026 - 10 - 20),
            date!(2026 - 10 - 27),
        );
        assert_eq!(next, Some(Remind::At("2026-10-26T19:00".into())));
        assert_eq!(
            shifted(
                Some(&Remind::Before(5)),
                date!(2026 - 10 - 20),
                date!(2026 - 10 - 27)
            ),
            Some(Remind::Before(5))
        );
    }
}
