//! Неправильные глаголы (ENG-008, D-887…D-889): встроенный набор ~150 глаголов
//! по звуковым группам и интервальное повторение по каждому.
//!
//! - **Набор** — `content/english/verbs.json`, встроен в бинарник ([`set`]).
//!   Запасные формы (`learnt|learned`) принимаются, показывается первая.
//! - **Повторение** ([`Card::next`]) — как SM-2: у глагола «лёгкость» и
//!   интервал. «Не знал» — вернётся сегодня же и станет трудным; «знал» —
//!   через 1, 3 дня, дальше интервал × лёгкость; «легко» — ещё дальше.
//! - **Одна точка записи** ([`answer`]) для карточек и всех игр: ошибка в любой
//!   игре — «не знал». Верный ответ двигает срок, только если глагол новый или
//!   его пора повторять: сто раз сыграть в «Соедини» за вечер не значит выучить.
//! - **Трудный** ([`Card::hard`]) — ошибался за последние три дня или ошибался
//!   много и ещё не дошёл до недельного интервала. Трудные идут в ежедневное
//!   повторение ([`review_tasks`]) и Нейту в разговор ([`nate_block`]).
//!
//! Права — модуль `agent`, как у всего «Английского».

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use time::{Date, Duration};
use uuid::Uuid;

use crate::{Error, Result, course, game, may_read, may_write};

/// «Урок» глаголов в повторении: задания с таким `lesson_id` — глаголы.
pub const REVIEW_LESSON: &str = "verbs";
/// Сколько трудных глаголов подмешивается в повторение за раз.
pub const REVIEW_VERBS: usize = 3;
/// Сколько трудных глаголов знает Нейт.
const NATE_VERBS: i64 = 5;
/// С какого интервала (дней) глагол считается выученным.
pub const LEARNED_DAYS: i32 = 7;
/// Сколько дней после ошибки глагол трудный.
const HARD_DAYS: i64 = 3;
const EASE_START: f32 = 2.5;
const EASE_MIN: f32 = 1.3;
const EASE_MAX: f32 = 3.0;
const MAX_INTERVAL: i32 = 365;
/// Длина ответа с экрана (форма или сказанное).
const MAX_FORM: usize = 60;
const MAX_SAID: usize = 300;

// ---------------------------------------------------------------- набор

/// Звуковая группа: глаголы внутри меняются одинаково.
#[derive(Debug, Clone, Serialize)]
pub struct Group {
    pub id: String,
    pub title_ru: String,
    /// Пример: `sing – sang – sung`.
    pub hint: String,
}

/// Глагол: три формы и перевод. `v2`/`v3` — как показывать; `*_alt` — что ещё
/// принимается (`gotten`, `learned`).
#[derive(Debug, Clone, Serialize)]
pub struct Verb {
    pub id: String,
    pub v1: String,
    pub v2: String,
    pub v3: String,
    pub v2_alt: Vec<String>,
    pub v3_alt: Vec<String>,
    pub ru: String,
    pub group: String,
}

/// Встроенный набор.
#[derive(Debug)]
pub struct Set {
    pub groups: Vec<Group>,
    pub verbs: Vec<Verb>,
}

fn forms(raw: &str) -> (String, Vec<String>) {
    let mut parts = raw.split('|').map(|p| p.trim().to_owned());
    let main = parts.next().unwrap_or_default();
    (main, parts.collect())
}

impl Set {
    fn load() -> Self {
        let data: Value = serde_json::from_str(course::file_text("verbs.json"))
            .unwrap_or_else(|e| panic!("verbs.json: {e}"));
        let text = |v: &Value, key: &str| v[key].as_str().unwrap_or_default().to_owned();
        let groups = data["groups"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|g| Group {
                id: text(g, "id"),
                title_ru: text(g, "title_ru"),
                hint: text(g, "hint"),
            })
            .collect();
        let verbs = data["verbs"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|v| {
                let (v2, v2_alt) = forms(&text(v, "v2"));
                let (v3, v3_alt) = forms(&text(v, "v3"));
                Verb {
                    id: text(v, "id"),
                    v1: text(v, "v1"),
                    v2,
                    v3,
                    v2_alt,
                    v3_alt,
                    ru: text(v, "ru"),
                    group: text(v, "group"),
                }
            })
            .collect();
        Self { groups, verbs }
    }

    pub fn verb(&self, id: &str) -> Option<&Verb> {
        self.verbs.iter().find(|v| v.id == id)
    }
}

/// Набор глаголов (встроен в бинарник, читается один раз).
pub fn set() -> &'static Set {
    static SET: OnceLock<Set> = OnceLock::new();
    SET.get_or_init(Set::load)
}

impl Verb {
    /// `go – went – gone`.
    pub fn line(&self) -> String {
        format!("{} – {} – {}", self.v1, self.v2, self.v3)
    }

    /// Задание повторения «впиши формы» — обычное задание уроков с пропусками.
    pub(crate) fn review_task(&self) -> Value {
        let with_alt = |main: &str, alt: &[String]| {
            std::iter::once(main)
                .chain(alt.iter().map(String::as_str))
                .collect::<Vec<_>>()
                .join("|")
        };
        json!({
            "id": self.id,
            "type": "fill",
            "skill": "grammar",
            "ask_ru": format!("Впиши вторую и третью форму: {} — {}.", self.v1, self.ru),
            "text": format!("{} – ___ – ___", self.v1),
            "answers": [with_alt(&self.v2, &self.v2_alt), with_alt(&self.v3, &self.v3_alt)],
            "example": self.line(),
        })
    }
}

// ---------------------------------------------------------------- сверка

/// Вписанная форма: регистр, пробелы и знаки не важны; запасные формы годятся.
pub fn form_ok(given: &str, main: &str, alt: &[String]) -> bool {
    let given = course::normalize(given);
    !given.is_empty()
        && std::iter::once(main)
            .chain(alt.iter().map(String::as_str))
            .any(|f| course::normalize(f) == given)
}

/// Слова, которые распознавание пишет вместо формы глагола: звучат так же.
const SOUNDS_LIKE: &[(&str, &str)] = &[
    ("red", "read"),
    ("one", "won"),
    ("1", "won"),
    ("through", "threw"),
    ("thru", "threw"),
    ("new", "knew"),
    ("eight", "ate"),
    ("8", "ate"),
    ("road", "rode"),
    ("blue", "blew"),
    ("flu", "flew"),
    ("flue", "flew"),
    ("cent", "sent"),
    ("scent", "sent"),
    ("herd", "heard"),
    ("maid", "made"),
    ("scene", "seen"),
    ("led", "lead"),
    ("bread", "bred"),
    ("lane", "lain"),
    ("wrung", "rung"),
    ("wring", "ring"),
    ("bean", "been"),
    ("bin", "been"),
    ("beet", "beat"),
    ("boar", "bore"),
    ("warn", "worn"),
    ("rows", "rose"),
    ("groan", "grown"),
    ("throne", "thrown"),
    ("sort", "sought"),
    ("court", "caught"),
    ("taut", "taught"),
    ("fort", "fought"),
    ("shown", "shone"),
    ("dun", "done"),
    ("sea", "see"),
    ("by", "buy"),
    ("bye", "buy"),
    ("no", "know"),
    ("right", "write"),
    ("rote", "wrote"),
    ("here", "hear"),
    ("meat", "meet"),
    ("cell", "sell"),
    ("steel", "steal"),
    ("brake", "break"),
    ("where", "wear"),
    ("bare", "bear"),
    ("bee", "be"),
    ("due", "do"),
    ("tolled", "told"),
    ("lye", "lie"),
    ("weak", "wake"),
    ("bot", "bought"),
];

fn sound(word: &str) -> &str {
    SOUNDS_LIKE
        .iter()
        .find(|(heard, _)| *heard == word)
        .map_or(word, |(_, form)| form)
}

/// Слова формы для сверки на слух: `was/were` — годится любое.
fn spoken_options(main: &str, alt: &[String]) -> Vec<String> {
    std::iter::once(main)
        .chain(alt.iter().map(String::as_str))
        .flat_map(|f| {
            course::normalize(f)
                .split(' ')
                .map(|w| sound(w).to_owned())
                .collect::<Vec<_>>()
        })
        .filter(|w| !w.is_empty())
        .collect()
}

/// «Скажи вслух»: три формы прозвучали по порядку. Лишние слова («and», «um»)
/// не мешают; одинаково звучащие слова распознавания (`red` = `read`) годятся.
pub fn said_ok(verb: &Verb, said: &str) -> bool {
    let normal = course::normalize(said);
    let mut words = normal.split(' ').map(sound);
    [
        spoken_options(&verb.v1, &[]),
        spoken_options(&verb.v2, &verb.v2_alt),
        spoken_options(&verb.v3, &verb.v3_alt),
    ]
    .iter()
    .all(|options| words.any(|w| options.iter().any(|o| o == w)))
}

// ---------------------------------------------------------------- повторение

/// Оценка ответа.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Grade {
    /// Не знал, ошибся.
    Again,
    /// Знал.
    Good,
    /// Знал легко.
    Easy,
}

/// Как идёт глагол у человека.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Card {
    pub ease: f32,
    pub interval_days: i32,
    pub due_on: Date,
    pub reps: i32,
    pub lapses: i32,
    pub last_wrong_on: Option<Date>,
}

fn grow(interval: i32, factor: f32) -> i32 {
    let next = (interval.max(1) as f32 * factor).round() as i32;
    next.max(interval + 1).min(MAX_INTERVAL)
}

impl Card {
    /// Новый глагол: повторять сегодня.
    pub fn new(today: Date) -> Self {
        Self {
            ease: EASE_START,
            interval_days: 0,
            due_on: today,
            reps: 0,
            lapses: 0,
            last_wrong_on: None,
        }
    }

    /// Пора повторять (или глагол ещё ни разу не знали).
    pub fn due(&self, today: Date) -> bool {
        self.due_on <= today
    }

    /// Трудный: ошибка за последние три дня — или ошибок много, лёгкость
    /// низкая и до недельного интервала глагол ещё не дошёл.
    pub fn hard(&self, today: Date) -> bool {
        self.last_wrong_on
            .is_some_and(|day| (today - day).whole_days() <= HARD_DAYS)
            || (self.lapses >= 2 && self.ease < 2.0 && self.interval_days < LEARNED_DAYS)
    }

    pub fn learned(&self) -> bool {
        self.interval_days >= LEARNED_DAYS
    }

    /// Следующее состояние после ответа.
    pub fn next(&self, grade: Grade, today: Date) -> Self {
        let mut card = *self;
        match grade {
            Grade::Again => {
                card.ease = (self.ease - 0.2).max(EASE_MIN);
                card.interval_days = 0;
                card.reps = 0;
                card.lapses = self.lapses + 1;
                card.last_wrong_on = Some(today);
            }
            Grade::Good => {
                card.interval_days = match self.interval_days {
                    0 => 1,
                    1 | 2 => 3,
                    days => grow(days, self.ease),
                };
                card.reps = self.reps + 1;
            }
            Grade::Easy => {
                card.ease = (self.ease + 0.15).min(EASE_MAX);
                card.interval_days = match self.interval_days {
                    0 => 4,
                    days => grow(days, self.ease * 1.3),
                };
                card.reps = self.reps + 1;
            }
        }
        card.due_on = today + Duration::days(i64::from(card.interval_days));
        card
    }
}

#[derive(sqlx::FromRow)]
struct CardRow {
    verb_id: String,
    ease: f32,
    interval_days: i32,
    due_on: Date,
    reps: i32,
    lapses: i32,
    last_wrong_on: Option<Date>,
}

impl From<&CardRow> for Card {
    fn from(row: &CardRow) -> Self {
        Self {
            ease: row.ease,
            interval_days: row.interval_days,
            due_on: row.due_on,
            reps: row.reps,
            lapses: row.lapses,
            last_wrong_on: row.last_wrong_on,
        }
    }
}

const CARD: &str = "SELECT verb_id, ease, interval_days, due_on, reps, lapses, last_wrong_on \
                    FROM english_verb_progress WHERE account_id = $1";

/// Записать ответ. Возвращает новое состояние и сдвинулся ли срок: верный
/// ответ на глагол, который ещё не пора повторять, ничего не меняет.
pub(crate) async fn record(
    conn: &mut PgConnection,
    account: Uuid,
    verb: &str,
    grade: Grade,
    today: Date,
) -> sqlx::Result<(Card, bool)> {
    // Строка создаётся до чтения с блокировкой: иначе два первых ответа сразу (с двух
    // устройств) оба посчитали бы от «нового» глагола, и одна ошибка пропала бы.
    sqlx::query(
        "INSERT INTO english_verb_progress (account_id, verb_id, due_on) VALUES ($1, $2, $3) \
         ON CONFLICT (account_id, verb_id) DO NOTHING",
    )
    .bind(account)
    .bind(verb)
    .bind(today)
    .execute(&mut *conn)
    .await?;
    let row: CardRow = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{CARD} AND verb_id = $2 FOR UPDATE"
    )))
    .bind(account)
    .bind(verb)
    .fetch_one(&mut *conn)
    .await?;
    let before = Card::from(&row);
    if grade != Grade::Again && !before.due(today) {
        return Ok((before, false));
    }
    let next = before.next(grade, today);
    sqlx::query(
        "UPDATE english_verb_progress SET ease = $3, interval_days = $4, due_on = $5, reps = $6, \
         lapses = $7, last_wrong_on = $8, updated_at = now() \
         WHERE account_id = $1 AND verb_id = $2",
    )
    .bind(account)
    .bind(verb)
    .bind(next.ease)
    .bind(next.interval_days)
    .bind(next.due_on)
    .bind(next.reps)
    .bind(next.lapses)
    .bind(next.last_wrong_on)
    .execute(conn)
    .await?;
    Ok((next, true))
}

/// Группа своих слов человека (ENG-008: набор со списка или с фото).
pub const MY_GROUP: &str = "my";
/// С чего начинается ID своего глагола.
pub const MY_PREFIX: &str = "my:";

/// Свои глаголы человека — в порядке добавления.
pub(crate) async fn custom(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Vec<Verb>> {
    let rows: Vec<(String, String, String, String, String)> = sqlx::query_as(
        "SELECT verb_id, v1, v2, v3, ru FROM english_verb_custom WHERE account_id = $1 \
         ORDER BY created_at, verb_id",
    )
    .bind(account)
    .fetch_all(conn)
    .await?;
    // `learnt/learned` у своего глагола — обе формы годятся, показываем как записано.
    let alt = |raw: &str| -> Vec<String> {
        if raw.contains('/') {
            raw.split('/').map(|f| f.trim().to_owned()).collect()
        } else {
            Vec::new()
        }
    };
    Ok(rows
        .into_iter()
        .map(|(id, v1, v2, v3, ru)| Verb {
            id,
            v1,
            v2_alt: alt(&v2),
            v3_alt: alt(&v3),
            v2,
            v3,
            ru,
            group: MY_GROUP.into(),
        })
        .collect())
}

/// Глагол по ID: из встроенного набора или свой.
pub(crate) async fn verb_of(
    conn: &mut PgConnection,
    account: Uuid,
    id: &str,
) -> sqlx::Result<Option<Verb>> {
    if let Some(verb) = set().verb(id) {
        return Ok(Some(verb.clone()));
    }
    if !id.starts_with(MY_PREFIX) || id.len() > 64 {
        return Ok(None);
    }
    Ok(custom(conn, account)
        .await?
        .into_iter()
        .find(|v| v.id == id))
}

/// Трудные глаголы: сначала те, на которых ошибся последним.
async fn hard(
    conn: &mut PgConnection,
    account: Uuid,
    today: Date,
    only_due: bool,
    limit: i64,
) -> sqlx::Result<Vec<Verb>> {
    let ids: Vec<String> = sqlx::query_scalar(
        "SELECT verb_id FROM english_verb_progress WHERE account_id = $1 \
         AND (last_wrong_on >= $2 OR (lapses >= 2 AND ease < 2.0 AND interval_days < $3)) \
         AND (NOT $4 OR due_on <= $5) \
         ORDER BY last_wrong_on DESC NULLS LAST, lapses DESC, verb_id LIMIT $6",
    )
    .bind(account)
    .bind(today - Duration::days(HARD_DAYS))
    .bind(LEARNED_DAYS)
    .bind(only_due)
    .bind(today)
    .bind(limit)
    .fetch_all(&mut *conn)
    .await?;
    let mine = if ids.iter().any(|id| id.starts_with(MY_PREFIX)) {
        custom(conn, account).await?
    } else {
        Vec::new()
    };
    Ok(ids
        .iter()
        .filter_map(|id| {
            set()
                .verb(id)
                .or_else(|| mine.iter().find(|v| v.id == *id))
                .cloned()
        })
        .collect())
}

/// Сколько трудных глаголов ждёт в ежедневном повторении (не больше трёх).
pub(crate) async fn review_due(
    conn: &mut PgConnection,
    account: Uuid,
    today: Date,
) -> sqlx::Result<i64> {
    Ok(hard(conn, account, today, true, REVIEW_VERBS as i64)
        .await?
        .len() as i64)
}

/// Задания «впиши формы» для ежедневного повторения: `{lesson_id, task}`.
pub(crate) async fn review_tasks(
    conn: &mut PgConnection,
    account: Uuid,
    today: Date,
) -> sqlx::Result<Vec<Value>> {
    Ok(hard(conn, account, today, true, REVIEW_VERBS as i64)
        .await?
        .into_iter()
        .map(|v| json!({ "lesson_id": REVIEW_LESSON, "task": v.review_task(), "wrong": "" }))
        .collect())
}

/// Ответ на задание повторения: список из двух форм, вторая и третья.
pub(crate) fn review_ok(verb: &Verb, answer: &Value) -> bool {
    let given: Vec<&str> = answer
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    matches!(given[..], [v2, v3]
        if form_ok(v2, &verb.v2, &verb.v2_alt) && form_ok(v3, &verb.v3, &verb.v3_alt))
}

/// Слабые глаголы для Нейта — данные для блока `verbs` (или ничего).
pub(crate) async fn nate_block(
    conn: &mut PgConnection,
    account: Uuid,
) -> sqlx::Result<Option<String>> {
    let today = game::today(conn).await?;
    let list = hard(conn, account, today, false, NATE_VERBS).await?;
    if list.is_empty() {
        return Ok(None);
    }
    let lines: Vec<String> = list.iter().map(|v| v.line()).collect();
    Ok(Some(format!(
        "слабые неправильные глаголы: {}; если уместно — проверь форму",
        lines.join(", ")
    )))
}

// ---------------------------------------------------------------- экран

/// Глагол с тем, как он идёт у человека.
#[derive(Debug, Clone, Serialize)]
pub struct VerbView {
    #[serde(flatten)]
    pub verb: Verb,
    pub progress: Progress,
}

/// Дата для экрана — строкой `2026-11-16` (сама `time::Date` в JSON — пара чисел).
fn iso(day: Date) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        day.year(),
        u8::from(day.month()),
        day.day()
    )
}

fn iso_date<S: serde::Serializer>(day: &Date, to: S) -> Result<S::Ok, S::Error> {
    to.serialize_str(&iso(*day))
}

fn iso_date_option<S: serde::Serializer>(day: &Option<Date>, to: S) -> Result<S::Ok, S::Error> {
    match day {
        Some(day) => to.serialize_some(&iso(*day)),
        None => to.serialize_none(),
    }
}

/// Состояние глагола для экрана.
#[derive(Debug, Clone, Serialize)]
pub struct Progress {
    /// Ещё ни разу не отвечал.
    pub new: bool,
    /// Пора повторять сегодня (новые — тоже).
    pub due: bool,
    pub hard: bool,
    pub learned: bool,
    pub reps: i32,
    pub lapses: i32,
    pub interval_days: i32,
    /// `2026-11-16`; у нового глагола — нет.
    #[serde(serialize_with = "iso_date_option")]
    pub due_on: Option<Date>,
}

fn progress(card: Option<&Card>, today: Date) -> Progress {
    match card {
        Some(c) => Progress {
            new: false,
            due: c.due(today),
            hard: c.hard(today),
            learned: c.learned(),
            reps: c.reps,
            lapses: c.lapses,
            interval_days: c.interval_days,
            due_on: Some(c.due_on),
        },
        None => Progress {
            new: true,
            due: true,
            hard: false,
            learned: false,
            reps: 0,
            lapses: 0,
            interval_days: 0,
            due_on: None,
        },
    }
}

/// Счётчики вкладки.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Counts {
    pub total: usize,
    /// Хоть раз отвечал.
    pub started: usize,
    pub learned: usize,
    /// Начатые, которые пора повторять сегодня.
    pub due: usize,
    pub hard: usize,
}

/// Вкладка «Глаголы».
#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    pub groups: Vec<Group>,
    pub verbs: Vec<VerbView>,
    /// Свои наборы (со списка или с фото) — новые первыми.
    pub sets: Vec<crate::verb_sets::SetView>,
    pub counts: Counts,
    /// Сегодня по часам платформы, `2026-11-16`.
    #[serde(serialize_with = "iso_date")]
    pub today: Date,
}

/// Набор с прогрессом человека.
pub async fn overview(pool: &PgPool, account: Uuid) -> Result<Overview> {
    may_read(pool, account).await?;
    let mut conn = pool.acquire().await?;
    let today = game::today(&mut conn).await?;
    let rows: Vec<CardRow> = sqlx::query_as(CARD)
        .bind(account)
        .fetch_all(&mut *conn)
        .await?;
    let cards: std::collections::HashMap<&str, Card> = rows
        .iter()
        .map(|r| (r.verb_id.as_str(), Card::from(r)))
        .collect();
    let mine = custom(&mut conn, account).await?;
    let sets = crate::verb_sets::list(&mut conn, account).await?;
    let set = set();
    let mut groups = set.groups.clone();
    if !mine.is_empty() {
        groups.push(Group {
            id: MY_GROUP.into(),
            title_ru: "Мои слова".into(),
            hint: "добавлены списком или с фото".into(),
        });
    }
    let mut counts = Counts {
        total: set.verbs.len() + mine.len(),
        ..Counts::default()
    };
    let verbs = set
        .verbs
        .iter()
        .chain(&mine)
        .map(|verb| {
            let p = progress(cards.get(verb.id.as_str()), today);
            if !p.new {
                counts.started += 1;
                counts.due += usize::from(p.due);
            }
            counts.learned += usize::from(p.learned);
            counts.hard += usize::from(p.hard);
            VerbView {
                verb: verb.clone(),
                progress: p,
            }
        })
        .collect();
    Ok(Overview {
        groups,
        verbs,
        sets,
        counts,
        today,
    })
}

/// Чем играли: карточки, «Соедини», викторина, впиши формы, анаграмма, поиск
/// слов, скажи вслух, на время.
pub const MODES: &[&str] = &[
    "cards", "match", "quiz", "type", "anagram", "search", "speak", "sprint",
];

/// Вписанные формы (`v1` — если спрашивали по переводу).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Forms {
    pub v1: Option<String>,
    pub v2: String,
    pub v3: String,
}

/// Ответ на глагол из карточек или игры. Что-то одно: `given` (впиши формы),
/// `said` (скажи вслух), `grade` (карточки) или `correct` (остальные игры).
#[derive(Debug, Clone, Default)]
pub struct Answer {
    pub verb_id: String,
    pub mode: String,
    pub correct: Option<bool>,
    pub grade: Option<Grade>,
    pub given: Option<Forms>,
    pub said: Option<String>,
}

/// Правильные формы — показать после ответа.
#[derive(Debug, Clone, Serialize)]
pub struct Expected {
    pub v1: String,
    pub v2: String,
    pub v3: String,
}

/// Итог ответа.
#[derive(Debug, Clone, Serialize)]
pub struct Answered {
    pub verb_id: String,
    pub correct: bool,
    pub expected: Expected,
    pub progress: Progress,
    /// Срок повторения сдвинулся (иначе глагол ещё рано повторять).
    pub moved: bool,
    pub game: game::Delta,
}

fn short(text: &str, max: usize, what: &str) -> Result<()> {
    if text.chars().count() > max {
        return Err(Error::Invalid(format!("{what} — до {max} знаков")));
    }
    Ok(())
}

/// Ответ из карточек или любой игры: сверить (где сверяет сервер), записать в
/// повторение, начислить минуты и опыт как за обычную практику.
pub async fn answer(pool: &PgPool, account: Uuid, a: Answer) -> Result<Answered> {
    may_write(pool, account).await?;
    let mut conn = pool.acquire().await?;
    let verb = verb_of(&mut conn, account, &a.verb_id)
        .await?
        .ok_or_else(|| Error::Invalid("нет такого глагола".into()))?;
    drop(conn);
    let verb = &verb;
    if !MODES.contains(&a.mode.as_str()) {
        return Err(Error::Invalid("неизвестная игра".into()));
    }
    let grade = match (&a.given, &a.said, a.grade, a.correct) {
        (Some(given), None, None, None) => {
            for form in [
                given.v1.as_deref().unwrap_or_default(),
                &given.v2,
                &given.v3,
            ] {
                short(form, MAX_FORM, "форма глагола")?;
            }
            let ok = given
                .v1
                .as_deref()
                .is_none_or(|v1| form_ok(v1, &verb.v1, &[]))
                && form_ok(&given.v2, &verb.v2, &verb.v2_alt)
                && form_ok(&given.v3, &verb.v3, &verb.v3_alt);
            if ok { Grade::Good } else { Grade::Again }
        }
        (None, Some(said), None, None) => {
            short(said, MAX_SAID, "сказанное")?;
            if said.trim().is_empty() {
                return Err(Error::Invalid(
                    "не расслышал ни слова — скажи ещё раз, ближе к микрофону".into(),
                ));
            }
            if said_ok(verb, said) {
                Grade::Good
            } else {
                Grade::Again
            }
        }
        (None, None, Some(grade), None) => grade,
        (None, None, None, Some(correct)) => {
            if correct {
                Grade::Good
            } else {
                Grade::Again
            }
        }
        _ => {
            return Err(Error::Invalid(
                "нужно что-то одно: формы, сказанное, оценка или верно/неверно".into(),
            ));
        }
    };
    let correct = grade != Grade::Again;
    let mut tx = pool.begin().await?;
    game::ensure(&mut tx, account).await?;
    let today = game::today(&mut tx).await?;
    let (card, moved) = record(&mut tx, account, &verb.id, grade, today).await?;
    let mut counters: Vec<(&'static str, i64)> = vec![("tasks", 1)];
    let mut xp = 0;
    if correct && moved {
        xp = if matches!(a.mode.as_str(), "type" | "speak") {
            2
        } else {
            1
        };
        counters.push(("verbs", 1));
    }
    let delta = game::practice(
        &mut tx,
        account,
        game::Practice {
            xp,
            counters,
            lesson: false,
        },
    )
    .await?;
    tx.commit().await?;
    Ok(Answered {
        verb_id: verb.id.clone(),
        correct,
        expected: Expected {
            v1: verb.v1.clone(),
            v2: verb.v2.clone(),
            v3: verb.v3.clone(),
        },
        progress: progress(Some(&card), today),
        moved,
        game: delta,
    })
}

#[cfg(test)]
mod tests {
    use time::macros::date;

    use super::*;

    #[test]
    fn set_is_complete_and_grouped() {
        let set = set();
        assert!(set.verbs.len() >= 140, "глаголов: {}", set.verbs.len());
        assert!(set.groups.len() >= 12);
        let mut seen = std::collections::HashSet::new();
        let mut closed = std::collections::HashSet::new();
        let mut last = "";
        for v in &set.verbs {
            assert!(seen.insert(v.id.as_str()), "дубль {}", v.id);
            for field in [&v.id, &v.v1, &v.v2, &v.v3, &v.ru] {
                assert!(!field.trim().is_empty(), "пустое поле у {}", v.id);
            }
            assert!(
                set.groups.iter().any(|g| g.id == v.group),
                "нет группы {} у {}",
                v.group,
                v.id
            );
            // Глаголы одной группы стоят рядом.
            if v.group != last {
                assert!(closed.insert(last), "группа {last} разорвана у {}", v.id);
                last = &v.group;
            }
        }
        for g in &set.groups {
            assert!(
                set.verbs.iter().any(|v| v.group == g.id),
                "пустая группа {}",
                g.id
            );
        }
        let sing = set.verb("sing").unwrap();
        assert_eq!(sing.line(), "sing – sang – sung");
        assert_eq!(set.verb("swim").unwrap().group, sing.group);
        let get = set.verb("get").unwrap();
        assert_eq!(
            (get.v3.as_str(), get.v3_alt.as_slice()),
            ("got", &["gotten".to_owned()][..])
        );
    }

    #[test]
    fn typed_forms_accept_case_and_spare_forms() {
        let set = set();
        let learn = set.verb("learn").unwrap();
        assert!(form_ok(" Learnt ", &learn.v2, &learn.v2_alt));
        assert!(form_ok("LEARNED", &learn.v2, &learn.v2_alt));
        assert!(!form_ok("learn", &learn.v2, &learn.v2_alt));
        assert!(!form_ok("", &learn.v2, &learn.v2_alt));
        let be = set.verb("be").unwrap();
        for ok in ["was", "were", "was/were", "Was, were"] {
            assert!(form_ok(ok, &be.v2, &be.v2_alt), "{ok}");
        }
        assert!(!form_ok("been", &be.v2, &be.v2_alt));
    }

    #[test]
    fn spoken_forms_in_order_with_soundalikes() {
        let set = set();
        let go = set.verb("go").unwrap();
        assert!(said_ok(go, "go went gone"));
        assert!(said_ok(go, "Um, go, went and gone."));
        assert!(!said_ok(go, "go gone went"));
        assert!(!said_ok(go, "go goed gone"));
        assert!(!said_ok(go, "went gone"));
        // Распознавание пишет слова, которые звучат так же.
        assert!(said_ok(set.verb("read").unwrap(), "read red red"));
        assert!(said_ok(set.verb("win").unwrap(), "win one one"));
        assert!(said_ok(set.verb("eat").unwrap(), "eat eight eaten"));
        assert!(said_ok(set.verb("be").unwrap(), "be was been"));
        assert!(said_ok(set.verb("be").unwrap(), "be was were been"));
        assert!(said_ok(set.verb("get").unwrap(), "get got gotten"));
        // Одинаковые формы нужно сказать трижды.
        assert!(said_ok(set.verb("cut").unwrap(), "cut cut cut"));
        assert!(!said_ok(set.verb("cut").unwrap(), "cut cut"));
    }

    #[test]
    fn schedule_again_good_easy() {
        let today = date!(2026 - 11 - 15);
        let new = Card::new(today);
        assert!(new.due(today) && !new.hard(today) && !new.learned());

        // «Знал»: 1 день, 3 дня, дальше × лёгкость.
        let a = new.next(Grade::Good, today);
        assert_eq!(
            (a.interval_days, a.due_on, a.reps),
            (1, date!(2026 - 11 - 16), 1)
        );
        let b = a.next(Grade::Good, a.due_on);
        assert_eq!((b.interval_days, b.due_on), (3, date!(2026 - 11 - 19)));
        let c = b.next(Grade::Good, b.due_on);
        assert_eq!(c.interval_days, 8);
        assert!(c.learned() && (c.ease - 2.5).abs() < 1e-6);

        // «Легко»: дальше и лёгкость растёт (до потолка).
        let e = new.next(Grade::Easy, today);
        assert_eq!(e.interval_days, 4);
        assert!((e.ease - 2.65).abs() < 1e-6);
        let e2 = e.next(Grade::Easy, e.due_on);
        assert_eq!(e2.interval_days, 14);
        let mut top = e2;
        for _ in 0..10 {
            top = top.next(Grade::Easy, top.due_on);
        }
        assert!(top.ease <= EASE_MAX && top.interval_days <= MAX_INTERVAL);

        // «Не знал»: сегодня же, лёгкость ниже (до пола), ошибка записана.
        let w = c.next(Grade::Again, c.due_on);
        assert_eq!(
            (w.interval_days, w.due_on, w.reps, w.lapses),
            (0, c.due_on, 0, 1)
        );
        assert!((w.ease - 2.3).abs() < 1e-6);
        assert_eq!(w.last_wrong_on, Some(c.due_on));
        let mut low = w;
        for _ in 0..10 {
            low = low.next(Grade::Again, today);
        }
        assert!((low.ease - EASE_MIN).abs() < 1e-6);
    }

    #[test]
    fn hard_after_mistake_or_many_lapses() {
        let today = date!(2026 - 11 - 15);
        let wrong = Card::new(today).next(Grade::Again, today);
        assert!(wrong.hard(today));
        assert!(wrong.hard(today + Duration::days(3)));
        assert!(!wrong.hard(today + Duration::days(4)));

        // Три ошибки: лёгкость 1.9 — трудный и через неделю после ошибки…
        let mut many = Card::new(today);
        for _ in 0..3 {
            many = many.next(Grade::Again, today);
        }
        let later = today + Duration::days(10);
        assert!(many.ease < 2.0 && many.hard(later));
        // …пока не дойдёт до недельного интервала.
        let mut ok = many;
        let mut day = later;
        while ok.interval_days < LEARNED_DAYS {
            ok = ok.next(Grade::Good, day);
            day = ok.due_on;
        }
        assert!(!ok.hard(day + Duration::days(4)));
    }
}
