//! Свободное время и «что предложить» (AGT-004, AGENT §6) — чистые расчёты
//! без базы: их проверяют юнит-тесты, а [`crate::proactive`] подставляет
//! данные человека.
//!
//! - **Окна** ([`windows`]): день между ночной тишиной минус занятое —
//!   уроки и слоты «Расписание.md», дела со временем (у «сходить куда-то» —
//!   с дорогой туда). Окно короче [`MIN_WINDOW`] минут — не окно.
//! - **Что предложить** ([`candidates`]): сначала то, у чего ближе срок или
//!   следующий урок (ДЗ), потом важное, потом идеи без срока, которые давно
//!   не вспоминали. У длинного — первый несделанный шаг.
//! - **Сколько писать** ([`limit`]): число в день, «сколько захочет»
//!   (учится по ответам) или ничего.

use std::collections::HashMap;

use qubite_planner::{Priority, Project, Status, Task, reminder};
use serde::Serialize;
use time::{Date, Duration, PrimitiveDateTime, Time};
use uuid::Uuid;

use crate::files::schedule::Slot;

/// Окно короче — не окно (минут).
pub const MIN_WINDOW: i64 = 15;
/// Сколько занимает дело со временем, если не сказано иначе (минут).
pub const TASK_MINUTES: i64 = 30;
/// Сколько занимает «сходить куда-то» после дороги туда (минут).
pub const OUTING_MINUTES: i64 = 120;
/// Не чаще одного сообщения первым за столько минут.
pub const GAP_MINUTES: i64 = 60;
/// Сколько раз за день агент может проснуться сам (бюджет агента внутри
/// лимита AI человека): утро, окна, срок, ответы.
pub const MAX_WAKES: i64 = 10;
/// Окон-пробуждений за день — не больше.
pub const MAX_WINDOW_WAKES: usize = 4;
/// В длинном окне спросить ещё раз через столько минут.
pub const REASK_MINUTES: i64 = 180;
/// «Близкий» срок или урок — в пределах стольких часов.
pub const NEAR_HOURS: i64 = 72;
/// Идею, которую вспоминали недавно, не предлагать столько дней.
pub const IDEA_REST_DAYS: i64 = 3;
/// «Сколько захочет»: с этого начинает, дальше учится по ответам.
pub const AUTO_START: i64 = 3;
pub const AUTO_MAX: i64 = 5;

const DAY_MINUTES: i64 = 24 * 60;

fn minutes(time: Time) -> i64 {
    i64::from(time.hour()) * 60 + i64::from(time.minute())
}

fn clock(minutes: i64) -> String {
    let minutes = minutes.clamp(0, DAY_MINUTES);
    if minutes == DAY_MINUTES {
        return "24:00".into();
    }
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

pub(crate) const SHORT_DAYS: [&str; 7] = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];

pub(crate) fn weekday(date: Date) -> u8 {
    date.weekday().number_from_monday()
}

// ---------------------------------------------------------------- окна

/// Занятое время дня (минуты от полуночи).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Busy {
    pub from: i64,
    pub to: i64,
    /// «Алгебра», «Сходить в музей (с дорогой)», «ночь».
    pub what: String,
}

/// Свободное окно.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Window {
    pub date: Date,
    /// `ЧЧ:ММ`.
    pub from: String,
    pub to: String,
    pub minutes: i64,
    #[serde(skip)]
    pub start: i64,
    #[serde(skip)]
    pub end: i64,
}

impl Window {
    /// Минут осталось от `now` (если окно сейчас).
    pub fn left(&self, now: PrimitiveDateTime) -> Option<i64> {
        let at = minutes(now.time());
        (self.date == now.date() && at >= self.start && at < self.end).then(|| self.end - at)
    }
}

/// Ночь: занятое время дня по настройке тишины (через полночь — два куска).
pub fn night(quiet_from: Time, quiet_to: Time) -> Vec<Busy> {
    let (from, to) = (minutes(quiet_from), minutes(quiet_to));
    let busy = |from, to| Busy {
        from,
        to,
        what: "ночь".into(),
    };
    match from.cmp(&to) {
        std::cmp::Ordering::Equal => Vec::new(),
        std::cmp::Ordering::Less => vec![busy(from, to)],
        std::cmp::Ordering::Greater => vec![busy(0, to), busy(from, DAY_MINUTES)],
    }
}

/// Занятое в этот день: слоты расписания (все — и «не беспокоить», и нет:
/// на тренировке тоже не до ДЗ) и несделанные дела со временем. Перед делом
/// резервируется его рассчитанная дорога; без неё — прежний запас для выходов.
pub fn busy_on(date: Date, slots: &[Slot], tasks: &[Task], travel_minutes: i64) -> Vec<Busy> {
    let mut busy: Vec<Busy> = slots
        .iter()
        .filter(|slot| slot.weekday == weekday(date))
        .map(|slot| Busy {
            from: minutes(slot.starts_at),
            to: minutes(slot.ends_at),
            what: slot.title.clone(),
        })
        .collect();
    for task in tasks {
        let (Some(day), Some(time)) = (task.due_date, task.due_time) else {
            continue;
        };
        if day != date || task.deleted || task.status == Status::Done {
            continue;
        }
        let at = minutes(time);
        if task.travel_minutes.is_some() || reminder::is_outing(&task.title) {
            busy.push(Busy {
                from: at - task.travel_minutes.map(i64::from).unwrap_or(travel_minutes),
                to: at
                    + task
                        .duration_minutes
                        .map(i64::from)
                        .unwrap_or(OUTING_MINUTES),
                what: format!("{} (с дорогой)", task.title),
            });
        } else {
            busy.push(Busy {
                from: at,
                to: at + task.duration_minutes.map(i64::from).unwrap_or(TASK_MINUTES),
                what: task.title.clone(),
            });
        }
    }
    busy
}

/// Свободные окна дня не раньше `earliest` (минуты): весь день минус занятое.
pub fn windows(date: Date, earliest: i64, busy: &[Busy]) -> Vec<Window> {
    let mut taken: Vec<(i64, i64)> = busy
        .iter()
        .map(|b| (b.from.clamp(0, DAY_MINUTES), b.to.clamp(0, DAY_MINUTES)))
        .filter(|(from, to)| from < to)
        .collect();
    taken.sort_unstable();
    let mut free = Vec::new();
    let mut cursor = earliest.clamp(0, DAY_MINUTES);
    let mut push = |from: i64, to: i64| {
        if to - from >= MIN_WINDOW {
            free.push(Window {
                date,
                from: clock(from),
                to: clock(to),
                minutes: to - from,
                start: from,
                end: to,
            });
        }
    };
    for (from, to) in taken {
        if from > cursor {
            push(cursor, from);
        }
        cursor = cursor.max(to);
    }
    push(cursor, DAY_MINUTES);
    free
}

/// Когда в эти окна проснуться и, может быть, спросить «есть время?»: через
/// 10 минут после начала окна (человек успеет выдохнуть), не раньше чем через
/// час после утра, в длинном окне — ещё раз через [`REASK_MINUTES`].
pub fn wake_times(windows: &[Window], morning: Time) -> Vec<i64> {
    let not_before = minutes(morning) + 60;
    let mut times = Vec::new();
    for window in windows {
        let mut at = (window.start + 10).max(not_before);
        while at + MIN_WINDOW <= window.end && times.len() < MAX_WINDOW_WAKES {
            times.push(at);
            at += REASK_MINUTES;
        }
    }
    times
}

/// Подпись окна: «15:00–17:00 (120 мин)».
pub fn window_text(window: &Window) -> String {
    format!("{}–{} ({} мин)", window.from, window.to, window.minutes)
}

// ---------------------------------------------------------------- что предложить

/// Что агент может предложить в окно.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Candidate {
    pub task_id: Uuid,
    pub title: String,
    pub project: Option<String>,
    /// Почему сейчас: «урок «Алгебра» завтра в 08:30», «важное»,
    /// «идея без срока, не вспоминали 12 дн.».
    pub why: String,
    /// Первый несделанный шаг — для длинного дела.
    pub step: Option<String>,
    /// Шагов осталось.
    pub steps_left: usize,
    /// 1 — срок или урок, 2 — важное, 3 — идея без срока.
    pub tier: u8,
}

/// Следующее начало урока по проекту после `now` (в пределах недели).
/// Урок узнаётся по названию: «Алгебра» в расписании — проект «Алгебра» или
/// тег `алгебра`.
fn next_lesson(
    project: &Project,
    slots: &[Slot],
    now: PrimitiveDateTime,
) -> Option<(PrimitiveDateTime, String)> {
    lesson_after(&[project.title.as_str(), project.tag.as_str()], slots, now)
}

/// Ближайший урок после `now` (в пределах недели), чьё название совпадает с
/// одним из `names` («Русский» — урок «Русский язык»). Для «до следующего
/// урока» при разборе Входящих (CMD-004).
pub fn lesson_after(
    names: &[&str],
    slots: &[Slot],
    now: PrimitiveDateTime,
) -> Option<(PrimitiveDateTime, String)> {
    let names: Vec<String> = names
        .iter()
        .map(|name| name.trim().to_lowercase())
        .collect();
    let mut best: Option<(PrimitiveDateTime, String)> = None;
    for slot in slots {
        let title = slot.title.to_lowercase();
        let same = names.iter().any(|name| {
            name.chars().count() >= 3
                && (title.contains(name.as_str()) || name.contains(title.as_str()))
        });
        if !same {
            continue;
        }
        for offset in 0..=7 {
            let date = now.date() + Duration::days(offset);
            if weekday(date) != slot.weekday {
                continue;
            }
            let at = PrimitiveDateTime::new(date, slot.starts_at);
            if at > now && best.as_ref().is_none_or(|(b, _)| at < *b) {
                best = Some((at, slot.title.clone()));
            }
        }
    }
    best
}

/// «сегодня в 14:00», «завтра в 08:30», «в чт в 08:30».
fn when_text(at: PrimitiveDateTime, now: PrimitiveDateTime) -> String {
    let days = (at.date() - now.date()).whole_days();
    let time = format!("{:02}:{:02}", at.hour(), at.minute());
    match days {
        0 => format!("сегодня в {time}"),
        1 => format!("завтра в {time}"),
        _ => format!(
            "в {} в {time}",
            SHORT_DAYS[usize::from(weekday(at.date()) - 1)]
        ),
    }
}

fn due_text(due: Date, today: Date) -> String {
    let days = (due - today).whole_days();
    match days {
        d if d < 0 => format!("просрочено с {}", short_date(due)),
        0 => "срок сегодня".into(),
        1 => "срок завтра".into(),
        _ => format!("срок {}", short_date(due)),
    }
}

fn short_date(date: Date) -> String {
    format!("{:02}.{:02}", date.day(), u8::from(date.month()))
}

/// Что предложить, по порядку (не больше `limit`): срок или урок → важное →
/// давно не вспоминавшиеся идеи без срока. Дела со временем не предлагаются
/// (о них напомнит PLAN-004), как и то, что уже предлагали сегодня.
/// `mentioned` — когда агент последний раз писал об этом деле.
pub fn candidates(
    now: PrimitiveDateTime,
    tasks: &[Task],
    projects: &[Project],
    slots: &[Slot],
    mentioned: &HashMap<Uuid, Date>,
    limit: usize,
) -> Vec<Candidate> {
    let today = now.date();
    let projects: HashMap<Uuid, &Project> = projects.iter().map(|p| (p.id, p)).collect();
    let mut scored: Vec<((u8, i64, i64), Candidate)> = Vec::new();
    for task in tasks {
        if task.deleted || task.status == Status::Done || task.due_time.is_some() {
            continue;
        }
        let last = mentioned.get(&task.id).copied();
        if last == Some(today) {
            continue;
        }
        let project = task.project_id.and_then(|id| projects.get(&id).copied());
        let left: Vec<&qubite_planner::Subtask> =
            task.subtasks.iter().filter(|step| !step.done).collect();
        let base = Candidate {
            task_id: task.id,
            title: task.title.clone(),
            project: project.map(|p| p.title.clone()),
            why: String::new(),
            step: left.first().map(|step| step.title.clone()),
            steps_left: left.len(),
            tier: 0,
        };
        let created = task.created_at.unix_timestamp();

        // 1. Срок или следующий урок близко.
        let lesson = project.and_then(|p| next_lesson(p, slots, now));
        let due_at = task
            .due_date
            .map(|date| PrimitiveDateTime::new(date, Time::MIDNIGHT) + Duration::days(1));
        let mut near: Option<(PrimitiveDateTime, String)> = None;
        if let (Some(date), Some(at)) = (task.due_date, due_at)
            && (at - now).whole_hours() <= NEAR_HOURS
        {
            near = Some((at, due_text(date, today)));
        }
        if let Some((at, title)) = lesson
            && (at - now).whole_hours() <= NEAR_HOURS
            && task.due_date.is_none_or(|date| date >= at.date())
            && near.as_ref().is_none_or(|(due, _)| at < *due)
        {
            near = Some((at, format!("урок «{title}» {}", when_text(at, now))));
        }
        if let Some((at, why)) = near {
            let key = (at - now).whole_minutes();
            scored.push((
                (1, key, created),
                Candidate {
                    why,
                    tier: 1,
                    ..base
                },
            ));
            continue;
        }

        // 2. Важное.
        if task.priority != Priority::Normal {
            let (rank, why) = if task.priority == Priority::Urgent {
                (0, "срочное")
            } else {
                (1, "важное")
            };
            let why = match task.due_date {
                Some(date) => format!("{why}, {}", due_text(date, today)),
                None => why.to_owned(),
            };
            scored.push((
                (2, rank, created),
                Candidate {
                    why,
                    tier: 2,
                    ..base
                },
            ));
            continue;
        }

        // 3. Идея без срока, давно не вспоминали.
        if task.due_date.is_none() {
            let rest = last.map(|day| (today - day).whole_days());
            if rest.is_some_and(|days| days < IDEA_REST_DAYS) {
                continue;
            }
            let why = match rest {
                Some(days) => format!("идея без срока, не вспоминали {days} дн."),
                None => "идея без срока, ещё не вспоминали".into(),
            };
            // Никогда не вспоминали — первыми; дальше — кого дольше.
            let key = rest.map_or(i64::MIN, |days| -days);
            scored.push((
                (3, key, created),
                Candidate {
                    why,
                    tier: 3,
                    ..base
                },
            ));
        }
    }
    scored.sort_by_key(|(key, _)| *key);
    scored.into_iter().take(limit).map(|(_, c)| c).collect()
}

/// Строка кандидата для модели: «[id] «ДЗ» (Алгебра) — урок … ; шаг: «№ 214» (ещё 3)».
pub fn candidate_text(candidate: &Candidate) -> String {
    let mut line = format!("[{}] «{}»", candidate.task_id, candidate.title);
    if let Some(project) = &candidate.project {
        line.push_str(&format!(" ({project})"));
    }
    line.push_str(&format!(" — {}", candidate.why));
    if let Some(step) = &candidate.step {
        line.push_str(&format!("; первый шаг: «{step}»"));
        if candidate.steps_left > 1 {
            line.push_str(&format!(" (всего шагов {})", candidate.steps_left));
        }
    }
    line
}

// ---------------------------------------------------------------- ответы и лимит

/// Ответ на «есть время?».
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Reply {
    Yes,
    Short,
    Later,
    NotToday,
}

impl Reply {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Yes => "yes",
            Self::Short => "short",
            Self::Later => "later",
            Self::NotToday => "not_today",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "yes" => Some(Self::Yes),
            "short" => Some(Self::Short),
            "later" => Some(Self::Later),
            "not_today" => Some(Self::NotToday),
            _ => None,
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Yes => "Да",
            Self::Short => "15 минут",
            Self::Later => "Позже",
            Self::NotToday => "Не сегодня",
        }
    }

    pub fn positive(self) -> bool {
        matches!(self, Self::Yes | Self::Short)
    }
}

/// Ответ с моментом (по часам владельца).
#[derive(Debug, Clone, Copy)]
pub struct Answered {
    pub at: PrimitiveDateTime,
    pub reply: Reply,
}

/// Как часто писать первым (D-294).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// «Сколько Qubite захочет» — учится по ответам (по умолчанию, D-309).
    Auto,
    /// Не больше `per_day` в день.
    Count,
    /// Вообще не писать первым.
    Off,
}

impl Mode {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Auto => "auto",
            Self::Count => "count",
            Self::Off => "off",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        match text {
            "auto" => Some(Self::Auto),
            "count" => Some(Self::Count),
            "off" => Some(Self::Off),
            _ => None,
        }
    }
}

/// «Сколько захочет»: начинает с [`AUTO_START`] в день; «да» и «15 минут»
/// за две недели добавляют, «позже» убавляет, «не сегодня» — вдвое сильнее.
/// Каждые три очка — одно сообщение; от 1 до [`AUTO_MAX`].
pub fn auto_limit(answers: &[Answered]) -> i64 {
    let score: i64 = answers
        .iter()
        .map(|answer| match answer.reply {
            Reply::Yes | Reply::Short => 1,
            Reply::Later => -1,
            Reply::NotToday => -2,
        })
        .sum();
    (AUTO_START + score.div_euclid(3)).clamp(1, AUTO_MAX)
}

/// Сколько сообщений первым можно сегодня.
pub fn limit(mode: Mode, per_day: i64, answers: &[Answered]) -> i64 {
    match mode {
        Mode::Off => 0,
        Mode::Count => per_day,
        Mode::Auto => auto_limit(answers),
    }
}

/// Закономерности из ответов: «вт 16–18: да 3 из 3». Только то, что
/// повторилось хотя бы дважды.
pub fn patterns(answers: &[Answered]) -> Vec<String> {
    let mut groups: HashMap<(u8, u8), (u32, u32)> = HashMap::new();
    for answer in answers {
        let hour = answer.at.hour() / 2 * 2;
        let entry = groups.entry((weekday(answer.at.date()), hour)).or_default();
        if answer.reply.positive() {
            entry.0 += 1;
        } else {
            entry.1 += 1;
        }
    }
    let mut keys: Vec<_> = groups
        .into_iter()
        .filter(|(_, (y, n))| y + n >= 2)
        .collect();
    keys.sort_by_key(|((day, hour), _)| (*day, *hour));
    keys.into_iter()
        .map(|((day, hour), (yes, no))| {
            format!(
                "{} {hour:02}–{:02}: свободен {yes} из {}",
                SHORT_DAYS[usize::from(day - 1)],
                hour + 2,
                yes + no
            )
        })
        .collect()
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use qubite_planner::Subtask;
    use time::{
        OffsetDateTime,
        macros::{date, datetime, time},
    };

    fn slot(weekday: u8, from: Time, to: Time, title: &str) -> Slot {
        Slot {
            weekday,
            starts_at: from,
            ends_at: to,
            title: title.into(),
            place: String::new(),
            quiet: true,
        }
    }

    pub(crate) fn task(title: &str) -> Task {
        Task {
            id: Uuid::now_v7(),
            owner_id: Uuid::nil(),
            title: title.into(),
            revision: 1,
            deleted: false,
            notes: String::new(),
            place_text: None,
            place_lat: None,
            place_lon: None,
            travel_minutes: None,
            duration_minutes: None,
            duration_by: None,
            status: Status::Todo,
            priority: Priority::Normal,
            due_date: None,
            due_time: None,
            subtasks: Vec::new(),
            recurrence: None,
            remind: None,
            remind_why: String::new(),
            remind_by: qubite_planner::RemindBy::Auto,
            completed_at: None,
            project_id: None,
            series_id: None,
            next_id: None,
            created_at: OffsetDateTime::UNIX_EPOCH,
            updated_at: OffsetDateTime::UNIX_EPOCH,
        }
    }

    fn project(title: &str) -> Project {
        Project {
            id: Uuid::now_v7(),
            owner_id: Uuid::nil(),
            title: title.into(),
            revision: 1,
            deleted: false,
            color: qubite_planner::Color::Sky,
            tag: title.to_lowercase(),
            status: qubite_planner::ProjectStatus::Active,
            board: None,
            notes: String::new(),
            created_at: OffsetDateTime::UNIX_EPOCH,
            updated_at: OffsetDateTime::UNIX_EPOCH,
        }
    }

    #[test]
    fn night_and_lessons_and_outings_are_busy() {
        // Вторник 20.10.2026: уроки 08:30–14:00, музей в 18:00 (дорога — час).
        let day = date!(2026 - 10 - 20);
        let slots = [
            slot(2, time!(08:30), time!(14:00), "Уроки"),
            slot(3, time!(09:00), time!(10:00), "Не сегодня"),
        ];
        let mut museum = task("Сходить в музей");
        museum.due_date = Some(day);
        museum.due_time = Some(time!(18:00));
        let mut call = task("Позвонить бабушке");
        call.due_date = Some(day);
        call.due_time = Some(time!(21:00));
        let mut done = task("Сделано");
        done.due_date = Some(day);
        done.due_time = Some(time!(15:00));
        done.status = Status::Done;
        let mut busy = night(time!(23:00), time!(08:00));
        busy.extend(busy_on(day, &slots, &[museum, call, done], 60));
        let free: Vec<String> = windows(day, 0, &busy).iter().map(window_text).collect();
        assert_eq!(
            free,
            [
                "08:00–08:30 (30 мин)",
                "14:00–17:00 (180 мин)",
                "20:00–21:00 (60 мин)",
                "21:30–23:00 (90 мин)",
            ]
        );
        // С 16:00 — только остаток.
        let later: Vec<String> = windows(day, 16 * 60, &busy)
            .iter()
            .map(window_text)
            .collect();
        assert_eq!(later[0], "16:00–17:00 (60 мин)");
        // Окно короче 15 минут — не окно.
        let tight = [
            Busy {
                from: 0,
                to: 600,
                what: "a".into(),
            },
            Busy {
                from: 610,
                to: DAY_MINUTES,
                what: "b".into(),
            },
        ];
        assert!(windows(day, 0, &tight).is_empty());
        // Без ночи (тишина выключена) — весь день.
        assert!(night(time!(00:00), time!(00:00)).is_empty());
        assert_eq!(windows(day, 0, &[])[0].minutes, DAY_MINUTES);
    }

    #[test]
    fn task_route_overrides_default_travel_even_without_outing_words() {
        let day = date!(2026 - 10 - 20);
        let mut visit = task("Важное дело");
        visit.due_date = Some(day);
        visit.due_time = Some(time!(18:00));
        visit.travel_minutes = Some(95);
        let busy = busy_on(day, &[], &[visit.clone()], 60);
        assert_eq!(busy[0].from, 16 * 60 + 25);
        assert_eq!(busy[0].to, 18 * 60 + OUTING_MINUTES);
        visit.title = "Сходить в музей".into();
        visit.travel_minutes = Some(0);
        assert_eq!(busy_on(day, &[], &[visit.clone()], 60)[0].from, 18 * 60);
        visit.travel_minutes = None;
        assert_eq!(busy_on(day, &[], &[visit], 60)[0].from, 17 * 60);
    }

    #[test]
    fn duration_replaces_defaults_and_keeps_travel_separate() {
        let day = date!(2026 - 10 - 20);
        let mut call = task("Позвонить");
        call.due_date = Some(day);
        call.due_time = Some(time!(18:00));
        call.duration_minutes = Some(10);
        let busy = busy_on(day, &[], &[call.clone()], 60);
        assert_eq!((busy[0].from, busy[0].to), (1080, 1090));
        call.travel_minutes = Some(40);
        call.duration_minutes = Some(75);
        let busy = busy_on(day, &[], &[call.clone()], 60);
        assert_eq!((busy[0].from, busy[0].to), (1040, 1155));
        call.duration_minutes = None;
        let busy = busy_on(day, &[], &[call], 60);
        assert_eq!(busy[0].to, 1080 + OUTING_MINUTES);
    }

    #[test]
    fn wake_after_window_starts_and_not_too_often() {
        let day = date!(2026 - 10 - 20);
        let busy = night(time!(23:00), time!(08:00));
        let free = windows(day, 0, &busy);
        // Весь день свободен: первое — через час после утра, дальше раз в 3 часа, не больше 4.
        let times: Vec<String> = wake_times(&free, time!(08:00))
            .into_iter()
            .map(clock)
            .collect();
        assert_eq!(times, ["09:00", "12:00", "15:00", "18:00"]);
        let mut busy = busy;
        busy.push(Busy {
            from: 8 * 60,
            to: 14 * 60,
            what: "уроки".into(),
        });
        let free = windows(day, 0, &busy);
        let times: Vec<String> = wake_times(&free, time!(08:00))
            .into_iter()
            .map(clock)
            .collect();
        assert_eq!(times, ["14:10", "17:10", "20:10"]);
        let now = datetime!(2026-10-20 15:00);
        assert_eq!(free[0].left(now), Some(8 * 60));
        assert_eq!(free[0].left(datetime!(2026-10-20 12:00)), None);
    }

    #[test]
    fn deadline_and_lesson_then_important_then_old_ideas() {
        // Вторник 17:00. Алгебра — в среду 08:30.
        let now = datetime!(2026-10-20 17:00);
        let algebra = project("Алгебра");
        let slots = [slot(3, time!(08:30), time!(09:15), "Алгебра")];
        let mut homework = task("ДЗ: № 214–216");
        homework.project_id = Some(algebra.id);
        homework.subtasks = vec![
            Subtask {
                id: "a".into(),
                title: "№ 214".into(),
                done: true,
            },
            Subtask {
                id: "b".into(),
                title: "№ 215".into(),
                done: false,
            },
            Subtask {
                id: "c".into(),
                title: "№ 216".into(),
                done: false,
            },
        ];
        let mut essay = task("Сочинение");
        essay.due_date = Some(date!(2026 - 10 - 22));
        let mut far = task("Проект по физике");
        far.due_date = Some(date!(2026 - 11 - 20));
        far.priority = Priority::Important;
        let mut urgent = task("Оплатить кружок");
        urgent.priority = Priority::Urgent;
        let fresh_idea = task("Сделать свой сайт");
        let mut old_idea = task("Разобраться с нейросетями");
        old_idea.created_at = OffsetDateTime::UNIX_EPOCH + time::Duration::days(1);
        let recent_idea = task("Выучить слепую печать");
        let mut timed = task("Позвонить в 18:00");
        timed.due_date = Some(date!(2026 - 10 - 20));
        timed.due_time = Some(time!(18:00));
        let told_today = task("Уже предлагал сегодня");
        let mentioned = HashMap::from([
            (old_idea.id, date!(2026 - 10 - 01)),
            (recent_idea.id, date!(2026 - 10 - 19)),
            (told_today.id, date!(2026 - 10 - 20)),
        ]);
        let list = candidates(
            now,
            &[
                fresh_idea,
                old_idea,
                recent_idea,
                timed,
                told_today,
                far,
                urgent,
                essay,
                homework,
            ],
            &[algebra],
            &slots,
            &mentioned,
            10,
        );
        let lines: Vec<String> = list
            .iter()
            .map(|c| format!("{} — {}", c.title, c.why))
            .collect();
        assert_eq!(
            lines,
            [
                "ДЗ: № 214–216 — урок «Алгебра» завтра в 08:30",
                "Сочинение — срок 22.10",
                "Оплатить кружок — срочное",
                "Проект по физике — важное, срок 20.11",
                "Сделать свой сайт — идея без срока, ещё не вспоминали",
                "Разобраться с нейросетями — идея без срока, не вспоминали 19 дн.",
            ]
        );
        // Длинное — шагом: первый несделанный.
        assert_eq!(list[0].step.as_deref(), Some("№ 215"));
        assert!(candidate_text(&list[0]).contains("первый шаг: «№ 215» (всего шагов 2)"));
    }

    #[test]
    fn auto_mode_learns_from_answers() {
        let at = datetime!(2026-10-20 17:00);
        let answer = |reply| Answered { at, reply };
        assert_eq!(auto_limit(&[]), 3);
        assert_eq!(
            auto_limit(&[answer(Reply::NotToday), answer(Reply::Later)]),
            2
        );
        assert_eq!(auto_limit(&[answer(Reply::NotToday); 10]), 1);
        assert_eq!(auto_limit(&[answer(Reply::Yes); 20]), 5);
        assert_eq!(limit(Mode::Off, 3, &[]), 0);
        assert_eq!(limit(Mode::Count, 7, &[]), 7);
    }

    #[test]
    fn patterns_need_repeats() {
        let tue = |hour: u8, reply| Answered {
            at: PrimitiveDateTime::new(date!(2026 - 10 - 20), Time::from_hms(hour, 10, 0).unwrap()),
            reply,
        };
        let lines = patterns(&[
            tue(17, Reply::Yes),
            tue(16, Reply::Yes),
            tue(17, Reply::Short),
            tue(9, Reply::Later),
        ]);
        assert_eq!(lines, ["вт 16–18: свободен 3 из 3"]);
    }
}
