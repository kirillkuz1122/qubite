//! Игра английского (GAME.md, D-484): минуты, огонёк, заморозки, опыт и
//! звания, задания дня, достижения и Частицы. Названия — из GAME.md (D-550).
//!
//! Всё считает сервер по настоящей практике: ответы на задания и реплики
//! Нейту. Открытый экран не считается; пауза больше 2 минут — время стоит.
//! Ничего не покупается и ничего не запирает учёбу (D-502).

use serde::Serialize;
use serde_json::{Map, Value, json};
use sqlx::PgConnection;
use time::{Date, Duration, OffsetDateTime, Weekday};
use uuid::Uuid;

/// Дольше этого без действий — время не идёт.
pub const IDLE_SECONDS: i64 = 120;
/// Шаг, если перед ответом была пауза: столько примерно занимает задание.
const STEP_SECONDS: i64 = 30;
/// День засчитан огоньку от стольких минут практики (D-551).
pub const STREAK_SECONDS: i64 = 5 * 60;
/// Заморозок копится не больше.
pub const MAX_FREEZES: i32 = 3;
/// Вернуть погасший огонёк можно столько дней.
const RESTORE_DAYS: i64 = 2;

/// Звания за опыт (не уровень языка).
pub const RANKS: &[(&str, i64)] = &[
    ("Кварк", 0),
    ("Электрон", 100),
    ("Протон", 300),
    ("Атом", 700),
    ("Молекула", 1_500),
    ("Кристалл", 3_000),
    ("Звезда", 6_000),
    ("Туманность", 10_000),
    ("Галактика", 16_000),
    ("Вселенная", 25_000),
];

/// Звание и следующее (с порогом).
pub fn rank(xp: i64) -> (&'static str, Option<(&'static str, i64)>) {
    let at = RANKS.iter().rposition(|(_, from)| xp >= *from).unwrap_or(0);
    (RANKS[at].0, RANKS.get(at + 1).copied())
}

/// Достижения: id, название, условие.
pub const BADGES: &[(&str, &str, &str)] = &[
    ("first_lesson", "Первое слово", "первый урок пройден"),
    ("boss_a0", "Знакомство", "итог A0"),
    ("boss_a1", "Моя жизнь", "итог A1"),
    ("boss_a2", "Интервью", "итог A2"),
    ("say_again", "Say it again ×50", "50 исправленных ошибок"),
    ("ear", "Ухо", "20 заданий «на слух» верно подряд"),
    ("artist", "Художник слов", "10 описанных картинок"),
    ("actor", "Актёр", "10 ролевых диалогов"),
    ("streak_7", "Огонёк 7", "7 дней подряд"),
    ("streak_30", "Огонёк 30", "30 дней подряд"),
    ("streak_100", "Огонёк 100", "100 дней подряд"),
    ("streak_365", "Огонёк 365", "365 дней подряд"),
    (
        "comeback",
        "Возвращение",
        "вернулся после перерыва в неделю",
    ),
    (
        "own_program",
        "Своя программа",
        "агент подстроил программу под тебя",
    ),
];

/// Частицы — помощники Нейта: id, имя, как открыть, что дают.
pub const PARTICLES: &[(&str, &str, &str, &str)] = &[
    (
        "spark",
        "Искра",
        "сразу",
        "живёт с огоньком и растёт на вехах",
    ),
    (
        "echo",
        "Эхо",
        "20 заданий «на слух»",
        "«Диктант»: Нейт говорит — ты пишешь",
    ),
    (
        "wave",
        "Волна",
        "30 «повтори вслух»",
        "«Тень»: говоришь вместе с Нейтом",
    ),
    (
        "prism",
        "Призма",
        "10 описанных картинок",
        "«Картинка дня» по интересам",
    ),
    (
        "knot",
        "Узел",
        "5 уроков без единой ошибки",
        "«Узлы»: фразы-ловушки на время",
    ),
    (
        "spin",
        "Спин",
        "10 ролевых диалогов",
        "новые роли: олимпиада, хакатон, аэропорт",
    ),
    (
        "twins",
        "Кварк-близнецы",
        "огонёк 14 дней",
        "дуэль слов с Нейтом",
    ),
    (
        "photon",
        "Фотонка",
        "итог любого уровня",
        "«Капсула времени»: ты сейчас и в начале",
    ),
];

// ---------------------------------------------------------------- огонёк

/// Огонёк и заморозки — то, что меняется днями.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Streak {
    pub streak: i32,
    pub best: i32,
    /// По этот день огонёк жив (засчитан или прикрыт отдыхом/заморозкой).
    pub day: Option<Date>,
    pub lost: i32,
    pub lost_on: Option<Date>,
    pub freezes: i32,
    pub freeze_week: Option<Date>,
    /// 1 — понедельник … 7 — воскресенье.
    pub rest_weekday: Option<u8>,
    pub paused_until: Option<Date>,
}

/// Что случилось, пока человека не было (для сообщения Нейта).
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize)]
pub struct Settled {
    /// Дни, которые спасла заморозка.
    pub frozen: Vec<Date>,
    /// Огонёк погас (было столько дней).
    pub broke: Option<i32>,
}

fn monday(day: Date) -> Date {
    day - Duration::days(i64::from(day.weekday().number_days_from_monday()))
}

impl Streak {
    /// Догнать календарь до `today`: заморозка за неделю, пропуски — отдых,
    /// пауза, заморозка или огонёк гаснет.
    pub fn settle(&mut self, today: Date) -> Settled {
        let mut out = Settled::default();
        let week = monday(today);
        match self.freeze_week {
            None => self.freeze_week = Some(week),
            Some(last) if last < week => {
                let weeks = ((week - last).whole_days() / 7) as i32;
                self.freezes = (self.freezes + weeks).min(MAX_FREEZES);
                self.freeze_week = Some(week);
            }
            Some(_) => {}
        }
        if let Some(lost_on) = self.lost_on
            && (today - lost_on).whole_days() > RESTORE_DAYS
        {
            self.lost = 0;
            self.lost_on = None;
        }
        let Some(mut day) = self.day else {
            return out;
        };
        if self.streak == 0 {
            return out;
        }
        while day + Duration::days(1) < today {
            let next = day + Duration::days(1);
            let resting = self
                .rest_weekday
                .is_some_and(|w| next.weekday().number_from_monday() == w);
            let paused = self.paused_until.is_some_and(|p| next <= p);
            if resting || paused {
                day = next;
                continue;
            }
            if self.freezes > 0 {
                self.freezes -= 1;
                out.frozen.push(next);
                day = next;
                continue;
            }
            out.broke = Some(self.streak);
            self.lost = self.streak;
            self.lost_on = Some(next);
            self.streak = 0;
            break;
        }
        self.day = Some(day);
        out
    }

    /// День засчитан (5 минут, урок или домашка). `double` — сделана двойная
    /// норма: погасший огонёк возвращается. Возвращает, вырос ли огонёк.
    pub fn count(&mut self, today: Date, double: bool) -> bool {
        if self.day == Some(today) && self.streak > 0 {
            return false;
        }
        if self.streak == 0 && self.lost > 0 && double {
            self.streak = self.lost;
            self.lost = 0;
            self.lost_on = None;
        }
        self.streak += 1;
        self.day = Some(today);
        self.best = self.best.max(self.streak);
        if self.streak % 7 == 0 {
            self.freezes = (self.freezes + 1).min(MAX_FREEZES);
        }
        true
    }
}

// ---------------------------------------------------------------- задания дня

/// Задание дня.
#[derive(Debug, Clone, Serialize)]
pub struct Quest {
    pub id: String,
    pub title: String,
    /// Счётчик дня, по которому оно считается.
    pub counter: String,
    pub target: i64,
    pub done: i64,
}

/// Три задания дня: повторение ошибок (если есть), минуты цели и одно из
/// остальных по кругу — по дню, чтобы у всех было разное и без лотереи.
pub fn quests(
    day: Date,
    goal_minutes: i64,
    review_due: i64,
    counters: &Map<String, Value>,
) -> Vec<Quest> {
    let got = |key: &str| counters.get(key).and_then(Value::as_i64).unwrap_or(0);
    let mut list = Vec::new();
    let mut add = |id: &str, title: String, counter: &str, target: i64| {
        list.push(Quest {
            id: id.into(),
            title,
            counter: counter.into(),
            target,
            done: got(counter).min(target),
        });
    };
    add(
        "minutes",
        format!("Позанимайся {goal_minutes} минут"),
        "seconds",
        goal_minutes * 60,
    );
    if review_due >= 3 {
        add("review", "Исправь 3 свои старые ошибки".into(), "fixed", 3);
    } else {
        add("lesson", "Пройди урок".into(), "lessons", 1);
    }
    let rotate = [
        ("speak", "Скажи вслух 5 фраз", "speak", 5),
        ("listen", "Послушай 5 фраз без текста", "listen", 5),
        ("image", "Опиши картинку", "image", 1),
        ("talk", "Ответь Нейту 3 раза в разговоре", "talk", 3),
    ];
    let (id, title, counter, target) =
        rotate[(day.to_julian_day().unsigned_abs() as usize) % rotate.len()];
    add(id, title.into(), counter, target);
    list
}

// ---------------------------------------------------------------- база

/// Что даёт практика.
#[derive(Debug, Clone, Default)]
pub struct Practice {
    pub xp: i64,
    /// Прибавить к счётчикам дня и всего времени.
    pub counters: Vec<(&'static str, i64)>,
    /// Урок или домашка сданы: день засчитан сразу.
    pub lesson: bool,
}

/// Итог для экрана после действия.
#[derive(Debug, Clone, Serialize)]
pub struct Delta {
    pub xp: i64,
    pub xp_total: i64,
    pub streak: i32,
    /// Огонёк вырос этим действием.
    pub streak_up: bool,
    /// Минут сегодня и цель.
    pub minutes: i64,
    pub goal_minutes: i64,
    /// Кольцо дня закрылось этим действием.
    pub ring_closed: bool,
    /// Все задания дня сделаны этим действием.
    pub quests_closed: bool,
    /// Только что открыто: `{"kind": "badge", "id": …, "title": …}`.
    pub unlocked: Vec<Value>,
}

pub(crate) async fn today(conn: &mut PgConnection) -> sqlx::Result<Date> {
    crate::notes::local_date(conn, OffsetDateTime::now_utc()).await
}

pub(crate) async fn ensure(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<()> {
    sqlx::query(
        "INSERT INTO english_learners (account_id) VALUES ($1) ON CONFLICT (account_id) DO NOTHING",
    )
    .bind(account)
    .execute(&mut *conn)
    .await?;
    sqlx::query(
        "INSERT INTO english_unlocks (account_id, kind, id) VALUES ($1, 'particle', 'spark') \
         ON CONFLICT DO NOTHING",
    )
    .bind(account)
    .execute(conn)
    .await?;
    Ok(())
}

type StreakRow = (
    i32,
    i32,
    Option<Date>,
    i32,
    Option<Date>,
    i32,
    Option<Date>,
    Option<i16>,
    Option<Date>,
);

pub(crate) async fn load_streak(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Streak> {
    let r: StreakRow = sqlx::query_as(
        "SELECT streak, best_streak, streak_day, lost_streak, lost_on, freezes, freeze_week, \
         rest_weekday, paused_until FROM english_learners WHERE account_id = $1 FOR UPDATE",
    )
    .bind(account)
    .fetch_one(conn)
    .await?;
    Ok(Streak {
        streak: r.0,
        best: r.1,
        day: r.2,
        lost: r.3,
        lost_on: r.4,
        freezes: r.5,
        freeze_week: r.6,
        rest_weekday: r.7.and_then(|w| u8::try_from(w).ok()),
        paused_until: r.8,
    })
}

pub(crate) async fn save_streak(
    conn: &mut PgConnection,
    account: Uuid,
    s: &Streak,
) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE english_learners SET streak = $2, best_streak = $3, streak_day = $4, \
         lost_streak = $5, lost_on = $6, freezes = $7, freeze_week = $8 WHERE account_id = $1",
    )
    .bind(account)
    .bind(s.streak)
    .bind(s.best)
    .bind(s.day)
    .bind(s.lost)
    .bind(s.lost_on)
    .bind(s.freezes)
    .bind(s.freeze_week)
    .execute(conn)
    .await?;
    Ok(())
}

/// Догнать календарь (заморозки, пропуски) и записать спасённые дни.
pub(crate) async fn settle(
    conn: &mut PgConnection,
    account: Uuid,
) -> sqlx::Result<(Streak, Settled)> {
    ensure(conn, account).await?;
    let today = today(conn).await?;
    let mut streak = load_streak(conn, account).await?;
    let settled = streak.settle(today);
    for day in &settled.frozen {
        sqlx::query(
            "INSERT INTO english_days (account_id, day, frozen) VALUES ($1, $2, true) \
             ON CONFLICT (account_id, day) DO UPDATE SET frozen = true",
        )
        .bind(account)
        .bind(day)
        .execute(&mut *conn)
        .await?;
    }
    save_streak(conn, account, &streak).await?;
    Ok((streak, settled))
}

fn add_counters(base: &Value, extra: &[(&str, i64)]) -> Value {
    let mut map = base.as_object().cloned().unwrap_or_default();
    for (key, n) in extra {
        let now = map.get(*key).and_then(Value::as_i64).unwrap_or(0);
        map.insert((*key).into(), json!(now + n));
    }
    Value::Object(map)
}

/// Отметить практику: минуты, опыт, счётчики, огонёк, кольцо, задания дня,
/// достижения. Всё — одной транзакцией вызывающего.
pub(crate) async fn practice(
    conn: &mut PgConnection,
    account: Uuid,
    p: Practice,
) -> sqlx::Result<Delta> {
    let (mut streak, _) = settle(conn, account).await?;
    let today = today(conn).await?;
    let (active_at, goal, total): (Option<OffsetDateTime>, i32, Value) = sqlx::query_as(
        "SELECT active_at, goal_minutes, counters FROM english_learners WHERE account_id = $1",
    )
    .bind(account)
    .fetch_one(&mut *conn)
    .await?;
    let now = OffsetDateTime::now_utc();
    let gap = active_at.map_or(STEP_SECONDS, |at| (now - at).whole_seconds());
    let seconds = if (0..=IDLE_SECONDS).contains(&gap) {
        gap
    } else {
        STEP_SECONDS
    };

    let day: Option<(i32, i32, bool, bool, bool, Value)> = sqlx::query_as(
        "SELECT seconds, xp, counted, ring, quests_done, counters FROM english_days \
         WHERE account_id = $1 AND day = $2",
    )
    .bind(account)
    .bind(today)
    .fetch_optional(&mut *conn)
    .await?;
    let (old_seconds, _, counted, ring, quests_done, day_counters) =
        day.unwrap_or((0, 0, false, false, false, json!({})));
    let mut extra = p.counters.clone();
    extra.push(("seconds", seconds));
    if p.lesson {
        extra.push(("lessons", 1));
    }
    let day_counters = add_counters(&day_counters, &extra);
    let new_seconds = i64::from(old_seconds) + seconds;
    let lessons = day_counters["lessons"].as_i64().unwrap_or(0);

    let mut xp = p.xp;
    let mut ring_closed = false;
    if !ring && new_seconds >= i64::from(goal) * 60 {
        ring_closed = true;
        xp += 10;
    }
    let review_due = review_due(conn, account, today).await?;
    let list = quests(
        today,
        i64::from(goal),
        review_due,
        day_counters.as_object().unwrap_or(&Map::new()),
    );
    let mut quests_closed = false;
    if !quests_done && list.iter().all(|q| q.done >= q.target) {
        quests_closed = true;
        xp += 30;
    }
    let mut streak_up = false;
    if !counted && (new_seconds >= STREAK_SECONDS || p.lesson) {
        let double = new_seconds >= 2 * STREAK_SECONDS || lessons >= 2;
        streak_up = streak.count(today, double);
        save_streak(conn, account, &streak).await?;
    }
    let day_xp = i32::try_from(xp).unwrap_or(i32::MAX);
    sqlx::query(
        "INSERT INTO english_days (account_id, day, seconds, xp, counted, ring, quests_done, counters) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
         ON CONFLICT (account_id, day) DO UPDATE SET seconds = $3, xp = english_days.xp + $4, \
         counted = english_days.counted OR $5, ring = english_days.ring OR $6, \
         quests_done = english_days.quests_done OR $7, counters = $8",
    )
    .bind(account)
    .bind(today)
    .bind(i32::try_from(new_seconds).unwrap_or(i32::MAX))
    .bind(day_xp)
    .bind(counted || streak_up)
    .bind(ring || ring_closed)
    .bind(quests_done || quests_closed)
    .bind(&day_counters)
    .execute(&mut *conn)
    .await?;
    let total = add_counters(&total, &p.counters);
    let xp_total: i64 = sqlx::query_scalar(
        "UPDATE english_learners SET xp = xp + $2, active_at = $3, counters = $4 \
         WHERE account_id = $1 RETURNING xp",
    )
    .bind(account)
    .bind(xp)
    .bind(now)
    .bind(&total)
    .fetch_one(&mut *conn)
    .await?;
    let unlocked = unlock(conn, account, &total, streak.best).await?;
    Ok(Delta {
        xp,
        xp_total,
        streak: streak.streak,
        streak_up,
        minutes: new_seconds / 60,
        goal_minutes: i64::from(goal),
        ring_closed,
        quests_closed,
        unlocked,
    })
}

pub(crate) async fn review_due(
    conn: &mut PgConnection,
    account: Uuid,
    today: Date,
) -> sqlx::Result<i64> {
    sqlx::query_scalar(
        "SELECT count(*) FROM english_review WHERE account_id = $1 AND NOT learned AND due_on <= $2",
    )
    .bind(account)
    .bind(today)
    .fetch_one(conn)
    .await
}

/// Что открыто по счётчикам и огоньку — новое записать и вернуть.
async fn unlock(
    conn: &mut PgConnection,
    account: Uuid,
    total: &Value,
    best: i32,
) -> sqlx::Result<Vec<Value>> {
    let n = |key: &str| total[key].as_i64().unwrap_or(0);
    let best = i64::from(best);
    let badges = [
        ("first_lesson", n("lessons_passed") >= 1),
        ("boss_a0", n("boss_a0") >= 1),
        ("boss_a1", n("boss_a1") >= 1),
        ("boss_a2", n("boss_a2") >= 1),
        ("say_again", n("fixed") >= 50),
        ("ear", n("listen_best_row") >= 20),
        ("artist", n("image") >= 10),
        ("actor", n("roleplay") >= 10),
        ("streak_7", best >= 7),
        ("streak_30", best >= 30),
        ("streak_100", best >= 100),
        ("streak_365", best >= 365),
        ("comeback", n("comeback") >= 1),
        ("own_program", n("own_program") >= 1),
    ];
    let particles = [
        ("echo", n("listen") >= 20),
        ("wave", n("repeat") >= 30),
        ("prism", n("image") >= 10),
        ("knot", n("perfect_lessons") >= 5),
        ("spin", n("roleplay") >= 10),
        ("twins", best >= 14),
        ("photon", n("boss_a0") + n("boss_a1") + n("boss_a2") >= 1),
    ];
    let mut out = Vec::new();
    for (kind, list) in [("badge", &badges[..]), ("particle", &particles[..])] {
        for (id, ok) in list {
            if !ok {
                continue;
            }
            let new = sqlx::query(
                "INSERT INTO english_unlocks (account_id, kind, id) VALUES ($1, $2, $3) \
                 ON CONFLICT DO NOTHING",
            )
            .bind(account)
            .bind(kind)
            .bind(id)
            .execute(&mut *conn)
            .await?
            .rows_affected()
                > 0;
            if new {
                let title = if kind == "badge" {
                    BADGES.iter().find(|b| b.0 == *id).map(|b| b.1)
                } else {
                    PARTICLES.iter().find(|p| p.0 == *id).map(|p| p.1)
                };
                out.push(json!({ "kind": kind, "id": id, "title": title.unwrap_or(id) }));
            }
        }
    }
    Ok(out)
}

/// Неделя по дням: минуты и засчитан ли (для кольца и огонька на экране).
pub(crate) async fn week(
    conn: &mut PgConnection,
    account: Uuid,
    today: Date,
) -> sqlx::Result<Vec<Value>> {
    let rows: Vec<(Date, i32, bool, bool)> = sqlx::query_as(
        "SELECT day, seconds, counted, frozen FROM english_days \
         WHERE account_id = $1 AND day > $2 - 7 AND day <= $2 ORDER BY day",
    )
    .bind(account)
    .bind(today)
    .fetch_all(conn)
    .await?;
    Ok((0..7)
        .rev()
        .map(|back| {
            let day = today - Duration::days(back);
            let row = rows.iter().find(|r| r.0 == day);
            json!({
                "day": day.to_string(),
                "weekday": day.weekday().number_from_monday(),
                "minutes": row.map_or(0, |r| r.1 / 60),
                "counted": row.is_some_and(|r| r.2),
                "frozen": row.is_some_and(|r| r.3),
            })
        })
        .collect())
}

/// День недели по номеру (для текста).
pub fn weekday_ru(n: u8) -> &'static str {
    match Weekday::Monday.nth_next(n.saturating_sub(1)) {
        Weekday::Monday => "понедельник",
        Weekday::Tuesday => "вторник",
        Weekday::Wednesday => "среда",
        Weekday::Thursday => "четверг",
        Weekday::Friday => "пятница",
        Weekday::Saturday => "суббота",
        Weekday::Sunday => "воскресенье",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn ranks_follow_xp() {
        assert_eq!(rank(0).0, "Кварк");
        assert_eq!(rank(150).0, "Электрон");
        assert_eq!(rank(150).1, Some(("Протон", 300)));
        assert_eq!(rank(30_000), ("Вселенная", None));
    }

    #[test]
    fn streak_grows_freezes_and_breaks() {
        let mut s = Streak {
            freezes: 1,
            ..Default::default()
        };
        // четверг 22.10.2026
        let thu = date!(2026 - 10 - 22);
        s.settle(thu);
        assert!(s.count(thu, false));
        assert!(!s.count(thu, false), "второй раз за день — не растёт");
        // пропустил пятницу: заморозка спасает
        let sat = date!(2026 - 10 - 24);
        let out = s.settle(sat);
        assert_eq!(out.frozen, vec![date!(2026 - 10 - 23)]);
        assert_eq!(s.freezes, 0);
        s.count(sat, false);
        assert_eq!(s.streak, 2);
        // понедельник: пришла новая заморозка; воскресенье — день отдыха
        s.rest_weekday = Some(7);
        let mon = date!(2026 - 10 - 26);
        let out = s.settle(mon);
        assert!(out.frozen.is_empty(), "воскресенье — отдых");
        assert_eq!(s.freezes, 1, "заморозка недели");
        s.count(mon, false);
        assert_eq!(s.streak, 3);
        // пропустил вторник и среду: одна заморозка, потом гаснет
        let thu2 = date!(2026 - 10 - 29);
        let out = s.settle(thu2);
        assert_eq!(out.frozen.len(), 1);
        assert_eq!(out.broke, Some(3));
        assert_eq!(s.streak, 0);
        assert_eq!(s.best, 3, "лучший не пропадает");
        // двойная норма в течение 48 часов — огонёк вернулся
        assert!(s.count(thu2, true));
        assert_eq!(s.streak, 4);
    }

    #[test]
    fn seventh_day_gives_freeze() {
        let mut s = Streak::default();
        let mut day = date!(2026 - 10 - 1);
        for _ in 0..7 {
            s.settle(day);
            s.count(day, false);
            day += Duration::days(1);
        }
        assert_eq!(s.streak, 7);
        assert!(s.freezes >= 1);
    }

    #[test]
    fn quests_target_weak_spots() {
        let day = date!(2026 - 10 - 23);
        let q = quests(day, 10, 5, &Map::new());
        assert_eq!(q.len(), 3);
        assert_eq!(q[0].target, 600);
        assert_eq!(q[1].id, "review", "есть ошибки — исправить");
        let q = quests(day, 10, 0, &Map::new());
        assert_eq!(q[1].id, "lesson");
    }
}
