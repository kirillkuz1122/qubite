//! Программа английского (ENG-000) внутри сервера (D-481): оглавление,
//! уроки, входной тест — из `content/english`, встроены при сборке.
//!
//! Программа человека = база + его личный слой (D-485): `skip`, `repeat`,
//! `move` меняют порядок, `note`, `add_words`, `add_tasks`, `remove_tasks`,
//! `set_pass` — содержимое урока. `insert` и `swap_theme` пока не
//! применяются (видны как «ждёт», ENG-003). Урок пропал из базы — операция
//! «устарела» и не применяется.
//!
//! Здесь же — сверка ответа без модели ([`check`]): выбрать, собрать,
//! вставить, соединить, перевести (с готовыми вариантами) и «повтори вслух».
//! Свой ответ голосом, картинку и роль — модель (`lib.rs → lessons`).

use std::{collections::HashMap, sync::OnceLock};

use serde::Serialize;
use serde_json::{Value, json};

mod files {
    include!(concat!(env!("OUT_DIR"), "/content.rs"));
}

/// Уровень языка.
#[derive(Debug, Clone, Serialize)]
pub struct Level {
    pub id: String,
    pub cefr: String,
    pub title_ru: String,
    pub about_ru: String,
    /// `ru_heavy`, `ru_support`, `en_simple`, `en` (D-491).
    pub tutor_mode: String,
    pub tutor_rules_ru: String,
    /// Итоговый урок-«босс».
    pub boss: Option<String>,
}

/// Урок в оглавлении.
#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub id: String,
    pub level: String,
    pub module: String,
    pub module_title_ru: String,
    pub title_ru: String,
    pub goal_ru: String,
    /// `full`, `detailed`, `outline` (план — уроки B1–B2, ENG-003).
    pub detail: String,
}

/// Вся программа.
#[derive(Debug)]
pub struct Course {
    pub version: i64,
    pub levels: Vec<Level>,
    pub entries: Vec<Entry>,
    lessons: HashMap<String, Value>,
    pub placement: Value,
}

impl Course {
    fn load() -> Self {
        let file = |path: &str| -> Value {
            let text = files::FILES
                .iter()
                .find(|(p, _)| *p == path)
                .map(|(_, t)| *t)
                .unwrap_or_else(|| panic!("нет {path} в программе"));
            serde_json::from_str(text).unwrap_or_else(|e| panic!("{path}: {e}"))
        };
        let course = file("course.json");
        let text = |v: &Value, key: &str| v[key].as_str().unwrap_or_default().to_owned();
        let mut levels = Vec::new();
        let mut entries = Vec::new();
        let mut lessons = HashMap::new();
        for level in course["levels"].as_array().into_iter().flatten() {
            levels.push(Level {
                id: text(level, "id"),
                cefr: text(level, "cefr"),
                title_ru: text(level, "title_ru"),
                about_ru: text(level, "about_ru"),
                tutor_mode: text(&level["tutor_language"], "mode"),
                tutor_rules_ru: text(&level["tutor_language"], "rules_ru"),
                boss: level["exit"]["boss_lesson"].as_str().map(str::to_owned),
            });
            for module in level["modules"].as_array().into_iter().flatten() {
                for lesson in module["lessons"].as_array().into_iter().flatten() {
                    let id = text(lesson, "id");
                    if let Some(path) = lesson["file"].as_str() {
                        lessons.insert(id.clone(), file(path));
                    }
                    entries.push(Entry {
                        id,
                        level: text(level, "id"),
                        module: text(module, "id"),
                        module_title_ru: text(module, "title_ru"),
                        title_ru: text(lesson, "title_ru"),
                        goal_ru: text(lesson, "goal_ru"),
                        detail: text(lesson, "detail"),
                    });
                }
            }
        }
        Self {
            version: course["version"].as_i64().unwrap_or(1),
            levels,
            entries,
            lessons,
            placement: file("placement.json"),
        }
    }

    pub fn level(&self, id: &str) -> Option<&Level> {
        self.levels.iter().find(|l| l.id == id)
    }

    pub fn entry(&self, id: &str) -> Option<&Entry> {
        self.entries.iter().find(|e| e.id == id)
    }

    /// Урок базы целиком (у плана B1–B2 — `None`).
    pub fn base_lesson(&self, id: &str) -> Option<&Value> {
        self.lessons.get(id)
    }

    /// Первый урок уровня.
    pub fn start_of(&self, level: &str) -> Option<&str> {
        self.placement["result"]["start_lesson"][level].as_str()
    }
}

/// Программа (встроена в бинарник, читается один раз).
pub fn course() -> &'static Course {
    static COURSE: OnceLock<Course> = OnceLock::new();
    COURSE.get_or_init(Course::load)
}

// ---------------------------------------------------------------- личный слой

/// Операция слоя, как её видит экран.
#[derive(Debug, Clone, Serialize)]
pub struct OverlayOp {
    pub id: uuid::Uuid,
    pub op: String,
    pub lesson: String,
    pub summary: String,
    /// `applied` — действует; `stale` — урока нет в базе; `waiting` — такой
    /// операции программа пока не умеет (свой урок, смена темы — ENG-003).
    pub state: String,
}

/// Урок в программе человека.
#[derive(Debug, Clone, Serialize)]
pub struct Step {
    #[serde(flatten)]
    pub entry: Entry,
    /// Агент пропустил (знает и так).
    pub skipped: bool,
    /// Агент просит повторить (с чем).
    pub repeat: Option<String>,
    /// Заметки агента к уроку.
    pub notes: Vec<String>,
}

/// Программа человека.
#[derive(Debug, Clone, Serialize)]
pub struct Program {
    pub steps: Vec<Step>,
    pub ops: Vec<OverlayOp>,
}

fn op_lesson(op: &Value) -> String {
    op["lesson"]
        .as_str()
        .map(str::to_owned)
        .or_else(|| op["lesson"]["id"].as_str().map(str::to_owned))
        .unwrap_or_default()
}

/// Собрать программу: база + операции по порядку.
pub fn program(course: &Course, ops: &[qubite_agent::english::Op]) -> Program {
    let mut steps: Vec<Step> = course
        .entries
        .iter()
        .map(|entry| Step {
            entry: entry.clone(),
            skipped: false,
            repeat: None,
            notes: Vec::new(),
        })
        .collect();
    let mut seen = Vec::new();
    for op in ops {
        let kind = op.op["op"].as_str().unwrap_or_default().to_owned();
        let lesson = op_lesson(&op.op);
        let known = |id: &str| course.entry(id).is_some();
        let state = if matches!(kind.as_str(), "insert" | "swap_theme") {
            "waiting"
        } else if !known(&lesson) {
            "stale"
        } else {
            "applied"
        };
        if state == "applied" {
            let at = steps.iter().position(|s| s.entry.id == lesson);
            match (kind.as_str(), at) {
                ("skip", Some(i)) => steps[i].skipped = true,
                ("repeat", Some(i)) => {
                    steps[i].repeat =
                        Some(op.op["focus_ru"].as_str().unwrap_or("повторить").to_owned());
                    steps[i].skipped = false;
                }
                ("note", Some(i)) => {
                    if let Some(note) = op.op["note_ru"].as_str() {
                        steps[i].notes.push(note.to_owned());
                    }
                }
                ("move", Some(i)) => {
                    let after = op.op["after"].as_str().unwrap_or_default();
                    if known(after) && after != lesson {
                        let step = steps.remove(i);
                        let j = steps
                            .iter()
                            .position(|s| s.entry.id == after)
                            .map_or(steps.len(), |j| j + 1);
                        steps.insert(j, step);
                    }
                }
                _ => {}
            }
        }
        seen.push(OverlayOp {
            id: op.id,
            op: kind,
            lesson,
            summary: op.summary.clone(),
            state: state.into(),
        });
    }
    Program { steps, ops: seen }
}

/// Урок человека: база + правки содержимого из слоя. Плана (B1–B2) нет.
pub fn lesson(course: &Course, id: &str, ops: &[qubite_agent::english::Op]) -> Option<Value> {
    let mut lesson = course.base_lesson(id)?.clone();
    let mut notes = Vec::new();
    for op in ops.iter().map(|o| &o.op) {
        if op_lesson(op) != id {
            continue;
        }
        match op["op"].as_str().unwrap_or_default() {
            "note" => {
                if let Some(note) = op["note_ru"].as_str() {
                    notes.push(Value::String(note.to_owned()));
                }
            }
            "repeat" => {
                if let Some(focus) = op["focus_ru"].as_str() {
                    notes.push(Value::String(format!("Повтор: {focus}")));
                }
            }
            "add_words" => {
                if let (Some(words), Some(extra)) =
                    (lesson["words"].as_array_mut(), op["words"].as_array())
                {
                    words.extend(extra.iter().cloned());
                }
            }
            "add_tasks" => {
                if let (Some(tasks), Some(extra)) =
                    (lesson["tasks"].as_array_mut(), op["tasks"].as_array())
                {
                    for task in extra {
                        let id = task["id"].as_str().unwrap_or_default();
                        if !id.is_empty() && !tasks.iter().any(|t| t["id"] == task["id"]) {
                            tasks.push(task.clone());
                        }
                    }
                }
            }
            "remove_tasks" => {
                let drop: Vec<&str> = op["tasks"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .collect();
                let required: Vec<String> = lesson["pass"]["required"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect();
                if let Some(tasks) = lesson["tasks"].as_array_mut() {
                    // Обязательное задание урока агент не убирает.
                    tasks.retain(|t| {
                        let id = t["id"].as_str().unwrap_or_default();
                        !drop.contains(&id) || required.iter().any(|r| r == id)
                    });
                }
            }
            "set_pass" => {
                if let Some(pass) = op["pass"].as_object() {
                    for (key, value) in pass {
                        if matches!(key.as_str(), "min_accuracy" | "min_speak" | "about_ru") {
                            lesson["pass"][key] = value.clone();
                        }
                    }
                }
            }
            _ => {}
        }
    }
    if !notes.is_empty() {
        lesson["agent_notes_ru"] = Value::Array(notes);
    }
    Some(lesson)
}

/// Задание урока по `id` (`t…` — урок, `h…` — домашка).
pub fn task<'a>(lesson: &'a Value, id: &str) -> Option<&'a Value> {
    lesson["tasks"]
        .as_array()
        .into_iter()
        .flatten()
        .chain(lesson["homework"]["tasks"].as_array().into_iter().flatten())
        .find(|t| t["id"] == id)
}

// ---------------------------------------------------------------- сверка

/// Чем кончилась сверка без модели.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Check {
    Right,
    Wrong {
        right: String,
    },
    /// Свой ответ: решает модель (или запасная сверка [`fallback`]).
    Model,
}

const CONTRACTIONS: &[(&str, &str)] = &[
    ("i'm", "i am"),
    ("you're", "you are"),
    ("we're", "we are"),
    ("they're", "they are"),
    ("he's", "he is"),
    ("she's", "she is"),
    ("it's", "it is"),
    ("what's", "what is"),
    ("where's", "where is"),
    ("who's", "who is"),
    ("that's", "that is"),
    ("there's", "there is"),
    ("isn't", "is not"),
    ("aren't", "are not"),
    ("wasn't", "was not"),
    ("weren't", "were not"),
    ("don't", "do not"),
    ("doesn't", "does not"),
    ("didn't", "did not"),
    ("can't", "cannot"),
    ("couldn't", "could not"),
    ("won't", "will not"),
    ("i've", "i have"),
    ("you've", "you have"),
    ("i'll", "i will"),
    ("you'll", "you will"),
    ("i'd", "i would"),
    ("let's", "let us"),
    ("haven't", "have not"),
    ("hasn't", "has not"),
];

/// Для сравнения: регистр, знаки препинания, сокращения (I'm = I am) и
/// лишние пробелы не важны.
pub fn normalize(text: &str) -> String {
    let lower = text.to_lowercase().replace(['’', '`', '‘'], "'");
    let cleaned: String = lower
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '\'' || c.is_whitespace() {
                c
            } else {
                ' '
            }
        })
        .collect();
    cleaned
        .split_whitespace()
        .map(|w| {
            let w = w.trim_matches('\'');
            CONTRACTIONS
                .iter()
                .find(|(short, _)| *short == w)
                .map_or(w, |(_, long)| long)
        })
        .collect::<Vec<_>>()
        .join(" ")
}

fn strs(value: &Value) -> Vec<String> {
    match value {
        Value::String(s) => vec![s.clone()],
        Value::Array(list) => list
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

fn same(given: &str, right: &[String]) -> bool {
    let given = normalize(given);
    !given.is_empty() && right.iter().any(|r| normalize(r) == given)
}

/// Доля слов образца, которые прозвучали по порядку (для «повтори вслух»).
pub fn overlap(said: &str, sample: &str) -> f64 {
    let said: Vec<String> = normalize(said).split(' ').map(str::to_owned).collect();
    let sample: Vec<String> = normalize(sample).split(' ').map(str::to_owned).collect();
    if sample.is_empty() || sample[0].is_empty() {
        return 0.0;
    }
    // Наибольшая общая подпоследовательность слов.
    let mut dp = vec![vec![0usize; sample.len() + 1]; said.len() + 1];
    for i in 1..=said.len() {
        for j in 1..=sample.len() {
            dp[i][j] = if said[i - 1] == sample[j - 1] {
                dp[i - 1][j - 1] + 1
            } else {
                dp[i - 1][j].max(dp[i][j - 1])
            };
        }
    }
    let common = dp[said.len()][sample.len()] as f64;
    common / sample.len().max(said.len()) as f64
}

/// Порог «повтори вслух» по строгости (1 — мягче, 3 — строже).
pub fn repeat_threshold(strictness: i16) -> f64 {
    match strictness {
        1 => 0.6,
        3 => 0.9,
        _ => 0.75,
    }
}

/// Ответ экрана: строка, список (вставить слово), пары (соединить).
pub fn check(task: &Value, answer: &Value, strictness: i16) -> Check {
    let kind = task["type"].as_str().unwrap_or_default();
    let given = answer.as_str().unwrap_or_default();
    let verdict = |ok: bool, right: String| {
        if ok {
            Check::Right
        } else {
            Check::Wrong { right }
        }
    };
    match kind {
        "choose" | "listen" => {
            let mut right = strs(&task["answer"]);
            right.extend(strs(&task["also"]));
            verdict(
                same(given, &right),
                right.first().cloned().unwrap_or_default(),
            )
        }
        "build" => {
            let mut right = strs(&task["answer"]);
            right.extend(strs(&task["also"]));
            verdict(
                same(given, &right),
                right.first().cloned().unwrap_or_default(),
            )
        }
        "fill" => {
            let right = strs(&task["answers"]);
            let given = strs(answer);
            let ok = given.len() == right.len()
                && given.iter().zip(&right).all(|(g, r)| {
                    // «a / an», «am|'m» — варианты через «/» или «|».
                    r.split(['/', '|'])
                        .any(|alt| normalize(alt) == normalize(g))
                });
            verdict(ok, right.join(" · "))
        }
        "match" => {
            let pairs: Vec<(String, String)> = task["pairs"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| {
                    (
                        p["en"].as_str().unwrap_or_default().to_owned(),
                        p["ru"].as_str().unwrap_or_default().to_owned(),
                    )
                })
                .collect();
            let given: Vec<(String, String)> = answer
                .as_array()
                .into_iter()
                .flatten()
                .map(|p| {
                    let pair = strs(p);
                    (
                        pair.first().cloned().unwrap_or_default(),
                        pair.get(1).cloned().unwrap_or_default(),
                    )
                })
                .collect();
            let ok = given.len() == pairs.len() && pairs.iter().all(|p| given.contains(p));
            let right = pairs
                .iter()
                .map(|(en, ru)| format!("{en} — {ru}"))
                .collect::<Vec<_>>()
                .join(", ");
            verdict(ok, right)
        }
        "translate" => {
            let right = strs(&task["answers"]);
            if same(given, &right) {
                Check::Right
            } else {
                Check::Model
            }
        }
        "speak" if task["mode"] == "repeat" => {
            let sample = task["say"].as_str().unwrap_or_default();
            verdict(
                overlap(given, sample) >= repeat_threshold(strictness),
                sample.to_owned(),
            )
        }
        _ => Check::Model,
    }
}

/// Запасная сверка своего ответа, когда модели нет (лимит, нет AI): все
/// обязательные слова на месте и ответ не короче нужного.
pub fn fallback(task: &Value, given: &str) -> bool {
    let said = format!(" {} ", normalize(given));
    let words = normalize(given)
        .split(' ')
        .filter(|w| !w.is_empty())
        .count();
    let must = strs(&task["must_use"]);
    let has_all = must
        .iter()
        .all(|m| said.contains(&format!(" {} ", normalize(m))));
    let min_words = match task["type"].as_str() {
        Some("describe_image") => 3 * task["min_sentences"].as_u64().unwrap_or(1) as usize,
        Some("translate") => {
            let right = strs(&task["answers"]);
            return right.iter().any(|r| overlap(given, r) >= 0.8);
        }
        _ => 3,
    };
    has_all && words >= min_words
}

/// Образец ответа для показа после неверного.
pub fn sample(task: &Value) -> String {
    let first = |v: &Value| strs(v).first().cloned().unwrap_or_default();
    match task["type"].as_str().unwrap_or_default() {
        "translate" => first(&task["answers"]),
        "speak" if task["mode"] == "repeat" => first(&task["say"]),
        "roleplay" => strs(&task["example"]).join(" / "),
        _ => first(&task["example"]),
    }
}

/// XP за задание (GAME.md §3).
pub fn task_xp(task: &Value) -> i64 {
    match task["type"].as_str().unwrap_or_default() {
        "choose" | "match" => 1,
        "build" | "fill" | "translate" | "listen" => 2,
        "speak" if task["mode"] == "repeat" => 2,
        "speak" => 3,
        "describe_image" => 5,
        "roleplay" => 8,
        _ => 1,
    }
}

/// Как отвечать на задание (ENG-006, слова владельца 25.10): `text` — только текстом
/// (написание, грамматика, порядок слов), `voice_or_text` — голосом или текстом (понимание,
/// быстрый перевод, разговорные фразы), `voice` — голосом (произношение; без микрофона задание заменяется).
/// Ответ, который сверяется буква в букву (число, имя на слух), — текстом:
/// распознавание напишет «fourteen» вместо «14». Своё `answer_by` у задания — главнее.
pub fn answer_by(task: &Value) -> &str {
    if let Some(by) = task["answer_by"].as_str() {
        return by;
    }
    match task["type"].as_str().unwrap_or_default() {
        "translate" if task["from"] == "en" => "voice_or_text",
        "speak" if task["mode"] == "repeat" => "voice",
        "speak" | "describe_image" | "roleplay" => "voice_or_text",
        _ => "text",
    }
}

/// Задание говорят вслух.
pub fn is_spoken(task: &Value) -> bool {
    matches!(
        task["type"].as_str(),
        Some("speak" | "describe_image" | "roleplay")
    )
}

// ---------------------------------------------------------------- входной тест

/// ENG-007b, D-579: при такой доле «Не знаю» ступень не пройдена.
pub const PLACEMENT_SKIP_LIMIT_PERCENT: usize = 30;

/// Итог входного теста.
#[derive(Debug, Clone, Serialize)]
pub struct Placement {
    pub level: String,
    pub start_lesson: String,
    /// По ступеням: уровень, верно, пропущено («Не знаю»), пройдена.
    pub stages: Vec<Value>,
}

/// Посчитать тест: ступени снизу вверх, первая непройденная — уровень;
/// `shift` — поправка после разговора или «легко / трудно» (±1).
pub fn place(course: &Course, answers: &Value, shift: i8) -> Placement {
    let mut stages = Vec::new();
    let mut level = None;
    let order: Vec<String> = course.levels.iter().map(|l| l.id.clone()).collect();
    for stage in course.placement["stages"].as_array().into_iter().flatten() {
        let id = stage["level"].as_str().unwrap_or_default().to_owned();
        let need = stage["pass_min"].as_u64().unwrap_or(3) as usize;
        let items = stage["items"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or_default();
        let skipped = items
            .iter()
            .filter(|item| {
                let key = item["id"].as_str().unwrap_or_default();
                answers.get(key).is_some_and(Value::is_null)
            })
            .count();
        let right = items
            .iter()
            .filter(|item| {
                let key = item["id"].as_str().unwrap_or_default();
                answers
                    .get(key)
                    .is_some_and(|a| !a.is_null() && check(item, a, 2) == Check::Right)
            })
            .count();
        let too_many_skips =
            skipped > 0 && skipped * 100 >= items.len() * PLACEMENT_SKIP_LIMIT_PERCENT;
        let passed = right >= need && !too_many_skips;
        stages.push(json!({
            "level": id, "right": right, "skipped": skipped, "passed": passed
        }));
        if !passed && level.is_none() {
            level = Some(id);
        }
    }
    let base = level.unwrap_or_else(|| order.last().cloned().unwrap_or_else(|| "a0".into()));
    let at = order.iter().position(|l| *l == base).unwrap_or(0) as i64;
    // Уроки B1–B2 — пока планом (ENG-003): выше A2 сдвиг не уводит, а итог
    // «знаешь всё» тоже начинает с A2 — повторять и говорить.
    let top = order
        .iter()
        .position(|l| l == "a2")
        .unwrap_or(order.len() - 1) as i64;
    let at = (at + i64::from(shift)).clamp(0, top) as usize;
    let level = order[at].clone();
    let start_lesson = course.start_of(&level).unwrap_or("a0-m1-l1").to_owned();
    Placement {
        level,
        start_lesson,
        stages,
    }
}

/// Письменная замена «только голос» из материала того же урока (D-582).
/// Повторение фразы становится сборкой этой фразы; свободный ответ остаётся свободным,
/// но текстом. ID сохраняется: обязательное задание нужно решить, а не пропустить.
pub fn without_microphone(task: &Value) -> Option<Value> {
    if answer_by(task) != "voice" {
        return None;
    }
    if task["type"] == "speak" && task["mode"] == "repeat" {
        let phrase = task["say"].as_str().filter(|s| !s.trim().is_empty())?;
        return Some(json!({
            "id": task["id"],
            "type": "build",
            "answer_by": "text",
            "ask_ru": "Собери фразу из слов.",
            "answer": phrase,
            "extra": [],
            "explain_ru": task["explain_ru"],
        }));
    }
    let mut replacement = task.clone();
    replacement["answer_by"] = json!("text");
    replacement["ask_ru"] = json!("Ответь письменно: выполни задание ниже.");
    replacement["hint_ru"] = task.get("ask_ru").cloned().unwrap_or(Value::Null);
    Some(replacement)
}

#[cfg(test)]
mod tests {
    use super::*;
    use qubite_agent::english::Op;
    use uuid::Uuid;

    fn op(value: Value) -> Op {
        Op {
            id: Uuid::now_v7(),
            summary: "правка".into(),
            op: value,
        }
    }

    #[test]
    fn answer_by_text_voice_or_both() {
        let by = |t: Value| answer_by(&t).to_owned();
        assert_eq!(by(json!({"type": "translate", "from": "ru"})), "text");
        assert_eq!(
            by(json!({"type": "translate", "from": "en"})),
            "voice_or_text"
        );
        assert_eq!(by(json!({"type": "fill", "text": "I ___ ok"})), "text");
        assert_eq!(by(json!({"type": "listen", "audio": "I'm 14."})), "text");
        assert_eq!(by(json!({"type": "speak", "mode": "repeat"})), "voice");
        assert_eq!(
            by(json!({"type": "speak", "mode": "transform"})),
            "voice_or_text"
        );
        assert_eq!(by(json!({"type": "roleplay"})), "voice_or_text");
        assert_eq!(
            by(json!({"type": "translate", "from": "en", "answer_by": "text"})),
            "text",
            "своё у задания главнее"
        );
    }

    #[test]
    fn course_is_embedded() {
        let c = course();
        assert_eq!(c.levels.len(), 5);
        assert!(c.entries.len() >= 100);
        let first = c.base_lesson("a0-m1-l1").expect("первый урок");
        assert!(task(first, "t1").is_some());
        assert!(task(first, "h1").is_some(), "домашка тоже задания");
        assert!(c.base_lesson("b1-m1-l1").is_none(), "B1 — пока план");
        assert_eq!(c.level("a0").unwrap().boss.as_deref(), Some("a0-m3-l4"));
    }

    #[test]
    fn normalize_ignores_case_marks_and_contractions() {
        assert_eq!(normalize("I'm Kirill."), "i am kirill");
        assert_eq!(normalize("i am  KIRILL"), "i am kirill");
        assert_eq!(normalize("What’s your name?"), "what is your name");
    }

    #[test]
    fn checks_without_model() {
        let c = course();
        let l = c.base_lesson("a0-m1-l1").unwrap();
        let t = |id| task(l, id).unwrap();
        assert_eq!(check(t("t3"), &json!("I am Kirill"), 2), Check::Right);
        assert!(matches!(
            check(t("t3"), &json!("I Kirill."), 2),
            Check::Wrong { .. }
        ));
        assert_eq!(check(t("t4"), &json!("What's your name"), 2), Check::Right);
        assert_eq!(check(t("t5"), &json!(["is"]), 2), Check::Right);
        assert!(matches!(
            check(t("t5"), &json!(["am"]), 2),
            Check::Wrong { .. }
        ));
        let pairs = json!([
            ["hello", "привет"],
            ["bye", "пока"],
            ["name", "имя"],
            ["my", "мой"],
            ["your", "твой"]
        ]);
        assert_eq!(check(t("t1"), &pairs, 2), Check::Right);
        let swapped = json!([
            ["hello", "пока"],
            ["bye", "привет"],
            ["name", "имя"],
            ["my", "мой"],
            ["your", "твой"]
        ]);
        assert!(matches!(check(t("t1"), &swapped, 2), Check::Wrong { .. }));
        assert_eq!(
            check(t("t6"), &json!("hi! nice to meet you"), 2),
            Check::Right
        );
        assert_eq!(
            check(t("t6"), &json!("Hello, glad to see you"), 2),
            Check::Model
        );
        assert_eq!(check(t("t7"), &json!("nice to meet you"), 2), Check::Right);
        assert!(matches!(
            check(t("t7"), &json!("nice"), 2),
            Check::Wrong { .. }
        ));
        assert_eq!(check(t("t8"), &json!("Hello I'm Kirill"), 2), Check::Model);
        assert!(fallback(t("t8"), "Hello! I'm Kirill."));
        assert!(!fallback(t("t8"), "Kirill"));
    }

    #[test]
    fn overlay_changes_order_and_content() {
        let c = course();
        let ops = vec![
            op(json!({"op": "skip", "lesson": "a0-m1-l2"})),
            op(json!({"op": "note", "lesson": "a0-m1-l1", "note_ru": "теряет am"})),
            op(json!({"op": "move", "lesson": "a0-m2-l1", "after": "a0-m1-l1"})),
            op(json!({"op": "add_tasks", "lesson": "a0-m1-l1", "tasks": [
                {"id": "t101", "type": "choose", "skill": "grammar", "ask_ru": "?", "question": "q",
                 "options": ["I am", "I"], "answer": "I am"}
            ]})),
            op(json!({"op": "remove_tasks", "lesson": "a0-m1-l1", "tasks": ["t1", "t8"]})),
            op(json!({"op": "skip", "lesson": "zz-m9-l9"})),
            op(json!({"op": "insert", "lesson": {"id": "my-a0-1"}, "after": "a0-m1-l1"})),
        ];
        let p = program(c, &ops);
        assert!(
            p.steps
                .iter()
                .find(|s| s.entry.id == "a0-m1-l2")
                .unwrap()
                .skipped
        );
        assert_eq!(p.steps[1].entry.id, "a0-m2-l1", "урок переставлен");
        assert_eq!(p.ops[5].state, "stale");
        assert_eq!(p.ops[6].state, "waiting");
        let l = lesson(c, "a0-m1-l1", &ops).unwrap();
        assert!(task(&l, "t101").is_some());
        assert!(task(&l, "t1").is_none());
        assert!(
            task(&l, "t8").is_some(),
            "обязательное задание не убирается"
        );
        assert_eq!(l["agent_notes_ru"][0], "теряет am");
    }

    #[test]
    fn placement_skip_limit_includes_thirty_percent() {
        // Десять вопросов позволяют проверить ровно 30%, оставляя pass_min
        // настоящей ступени прежним. В программе сейчас по четыре вопроса.
        let mut c = Course::load();
        let mut stage = c.placement["stages"][0].clone();
        let items: Vec<Value> = (0..10)
            .map(|i| {
                let mut item = stage["items"][0].clone();
                item["id"] = json!(format!("limit-{i}"));
                item
            })
            .collect();
        stage["items"] = json!(items);
        c.placement["stages"][0] = stage;
        let need = c.placement["stages"][0]["pass_min"].as_u64().unwrap() as usize;

        for (skips, passed) in [(2, true), (3, false), (4, false)] {
            let answers: serde_json::Map<String, Value> = items
                .iter()
                .enumerate()
                .map(|(i, item)| {
                    let answer = if i < skips {
                        Value::Null
                    } else {
                        item["answer"].clone()
                    };
                    (item["id"].as_str().unwrap().to_owned(), answer)
                })
                .collect();
            let result = place(&c, &Value::Object(answers), 0);
            assert_eq!(result.stages[0]["right"], json!(10 - skips));
            assert_eq!(result.stages[0]["skipped"], json!(skips));
            assert_eq!(result.stages[0]["passed"], passed);
            assert_eq!(result.level, if passed { "a1" } else { "a0" });
            assert!(10 - skips >= need);
        }
    }

    #[test]
    fn placement_finds_first_failed_stage() {
        let c = course();
        let right = |level: &str| -> Vec<(String, Value)> {
            c.placement["stages"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|s| s["level"] == level)
                .flat_map(|s| s["items"].as_array().unwrap().iter())
                .map(|i| {
                    let answer = match i["type"].as_str().unwrap() {
                        "fill" => i["answers"].clone(),
                        _ => i["answer"].clone(),
                    };
                    (i["id"].as_str().unwrap().to_owned(), answer)
                })
                .collect()
        };
        let none = place(c, &json!({}), 0);
        assert_eq!(none.level, "a0");
        assert_eq!(none.start_lesson, "a0-m1-l1");
        let a0: serde_json::Map<String, Value> = right("a0").into_iter().collect();
        let after_a0 = place(c, &Value::Object(a0.clone()), 0);
        assert_eq!(after_a0.level, "a1");
        assert_eq!(after_a0.start_lesson, "a1-m1-l1");
        assert_eq!(
            place(c, &Value::Object(a0), -1).level,
            "a0",
            "«трудно» — на ступень ниже"
        );
        let all: serde_json::Map<String, Value> = ["a0", "a1", "a2", "b1", "b2"]
            .iter()
            .flat_map(|l| right(l))
            .collect();
        assert_eq!(
            place(c, &Value::Object(all), 1).level,
            "a2",
            "выше A2 уроков пока нет"
        );
    }
}
