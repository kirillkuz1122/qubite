//! Папка агента (AGT-001, D-320…D-325): Markdown-файлы человека, которые агент
//! ведёт сам, как Hermes Agent (`SOUL.md`, `MEMORY.md`, `USER.md`, навыки) и
//! память Claude Code (оглавление + файлы).
//!
//! - **«Кто я»** — ядро: основа написана нами ([`CORE`], в коде, агент её не
//!   меняет), в базе лежит только раздел «Твои правила»;
//! - **«О тебе»**, **«Память»** (короткие факты и оглавление);
//! - **«Проекты/<проект>.md»** — память проекта;
//! - **«Навыки/<навык>.md»** — SKILL.md (хранение; обучение — AGT-003);
//! - **свои файлы агента** — «Расписание.md» (сервер разбирает таблицу) и любые.
//!
//! Файл — объект ядра `agent.file`: его меняет движок синхронизации, поэтому
//! каждая правка — строка ленты с «было → стало» и откатом (AGT-002). Каждая
//! запись проходит одни проверки ([`FileFieldsHandler`]): размер, вычёркивание
//! паролей и кодов ([`redact`]), строгая таблица расписания ([`schedule`]).

use std::sync::LazyLock;

use qubite_objects::Object;
use qubite_sync_server::{BoxFuture, FieldsError, TypeFields};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgConnection;
use time::Time;
use uuid::Uuid;

/// Тип объекта «файл агента».
pub const FILE_TYPE: &str = "agent.file";

/// «Кто я»: основа — наша и в коде, агент её только видит (D-321).
pub const CORE: &str = include_str!("core.md");
/// Заголовок раздела, который правят владелец и агент.
pub const RULES_HEADING: &str = "## Твои правила";

pub const CORE_PATH: &str = "Кто я.md";
pub const USER_PATH: &str = "О тебе.md";
pub const MEMORY_PATH: &str = "Память.md";
pub const SCHEDULE_PATH: &str = "Расписание.md";
pub const PROJECTS_DIR: &str = "Проекты";
pub const SKILLS_DIR: &str = "Навыки";

/// Что за файл.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// «Кто я»: в базе — только «Твои правила».
    Core,
    /// «О тебе».
    User,
    /// «Память»: короткие факты и оглавление.
    Memory,
    /// «Проекты/<проект>.md».
    Project,
    /// «Навыки/<навык>.md» (SKILL.md).
    Skill,
    /// Свой файл агента («Расписание.md» и любые другие).
    File,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Core => "core",
            Self::User => "user",
            Self::Memory => "memory",
            Self::Project => "project",
            Self::Skill => "skill",
            Self::File => "file",
        }
    }

    /// Сколько знаков помещается (как у Hermes: память короткая, чтобы
    /// целиком входить в каждый запрос и стоить мало). Переполнение —
    /// ошибка, агент сам сжимает (D-323).
    pub fn limit(self) -> usize {
        match self {
            Self::Core => 1500,
            Self::User => 1500,
            Self::Memory => 2200,
            Self::Project => 3000,
            Self::Skill => 6000,
            Self::File => 6000,
        }
    }
}

impl std::str::FromStr for Kind {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "core" => Ok(Self::Core),
            "user" => Ok(Self::User),
            "memory" => Ok(Self::Memory),
            "project" => Ok(Self::Project),
            "skill" => Ok(Self::Skill),
            "file" => Ok(Self::File),
            other => Err(format!("неизвестный вид файла {other}")),
        }
    }
}

// ---------------------------------------------------------------- пути

/// Привести путь к виду «Папка/Имя.md»: без лишних пробелов, с `.md`, не
/// глубже одной папки, без `..` и служебных символов.
pub fn normalize_path(raw: &str) -> Result<String, String> {
    let mut parts = Vec::new();
    for part in raw.trim().trim_matches('/').split('/') {
        let part = part.split_whitespace().collect::<Vec<_>>().join(" ");
        if part.is_empty() || part == "." || part == ".." {
            return Err(format!("неверный путь «{raw}»"));
        }
        if part
            .chars()
            .any(|c| c.is_control() || matches!(c, '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|'))
        {
            return Err(format!("в имени файла «{raw}» служебные символы"));
        }
        parts.push(part);
    }
    if parts.len() > 2 {
        return Err("папка может быть только одна: «Папка/Файл.md»".into());
    }
    let mut path = parts.join("/");
    if !path.to_lowercase().ends_with(".md") {
        path.push_str(".md");
    }
    let chars = path.chars().count();
    if !(4..=200).contains(&chars) {
        return Err("имя файла — до 200 знаков".into());
    }
    Ok(path)
}

/// Вид файла по пути.
pub fn kind_of(path: &str) -> Kind {
    let lower = path.to_lowercase();
    if lower == CORE_PATH.to_lowercase() {
        Kind::Core
    } else if lower == USER_PATH.to_lowercase() {
        Kind::User
    } else if lower == MEMORY_PATH.to_lowercase() {
        Kind::Memory
    } else if folder(path).is_some_and(|dir| dir.to_lowercase() == PROJECTS_DIR.to_lowercase()) {
        Kind::Project
    } else if folder(path).is_some_and(|dir| dir.to_lowercase() == SKILLS_DIR.to_lowercase()) {
        Kind::Skill
    } else {
        Kind::File
    }
}

fn folder(path: &str) -> Option<&str> {
    path.split_once('/').map(|(dir, _)| dir)
}

/// Имя без папки и `.md`: «Проекты/Алгебра.md» → «Алгебра».
pub fn display_name(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.strip_suffix(".md")
        .or_else(|| name.strip_suffix(".MD"))
        .unwrap_or(name)
}

/// Это расписание (его разбирает сервер)?
pub fn is_schedule(path: &str) -> bool {
    path.to_lowercase() == SCHEDULE_PATH.to_lowercase()
}

/// Полный текст для чтения: у «Кто я» — основа + «Твои правила».
pub fn full_text(kind: Kind, body: &str) -> String {
    match kind {
        Kind::Core => {
            let rules = if body.trim().is_empty() {
                "(пока пусто)"
            } else {
                body.trim()
            };
            format!("{}\n{RULES_HEADING}\n\n{rules}\n", CORE.trim_end())
        }
        _ => body.to_owned(),
    }
}

// ---------------------------------------------------------------- вычёркивание

const REDACTED: &str = "[вычеркнуто]";

static SECRET_AFTER_SIGN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(пароль|парол[ья]|password|passwd|pin|пин(?:-?код)?|cvv|cvc|токен|token|api[ _-]?key|ключ api|секрет|secret|код(?: подтверждения| из смс| доступа)?)\b([^\n:=—–]{0,30}?)\s*(?:[:=]|—|–)\s*(\S+)",
    )
    .expect("регулярное выражение")
});

static SECRET_WITH_DIGIT: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(пароль|password|pin|пин(?:-?код)?|cvv|cvc|код(?: подтверждения| из смс| доступа)?)\s+((?:это|is)\s+)?([^\s,.;]*\d[^\s,.;]*)",
    )
    .expect("регулярное выражение")
});

static KEY_LIKE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b(?:sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|\d{8,10}:[A-Za-z0-9_-]{35})\b")
        .expect("регулярное выражение")
});

static CARD_LIKE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\b\d(?:[ -]?\d){12,18}\b").expect("регулярное выражение"));

/// Проверка номера карты (алгоритм Луна).
fn luhn(digits: &str) -> bool {
    let mut sum = 0;
    for (i, c) in digits.chars().rev().enumerate() {
        let Some(mut d) = c.to_digit(10) else {
            return false;
        };
        if i % 2 == 1 {
            d *= 2;
            if d > 9 {
                d -= 9;
            }
        }
        sum += d;
    }
    sum % 10 == 0
}

/// Вычеркнуть пароли, коды, номера карт и ключи (D-291, AGENT §11).
/// Возвращает текст и сколько кусков вычеркнуто.
pub fn redact(text: &str) -> (String, usize) {
    let mut count = 0;
    let text = SECRET_AFTER_SIGN.replace_all(text, |caps: &regex::Captures| {
        if caps[3].starts_with('[') {
            return caps[0].to_owned();
        }
        count += 1;
        let sign_start = caps.get(2).map_or(0, |m| m.end());
        let value_start = caps.get(3).map_or(0, |m| m.start());
        let whole = caps.get(0).map_or(0, |m| m.start());
        let separator = &caps[0][sign_start - whole..value_start - whole];
        // Знак препинания после пароля — не часть пароля: «пароль: abc, запомни».
        let tail = match caps[3].chars().last() {
            Some(c @ (',' | ';' | '.' | ')')) if caps[3].chars().count() > 1 => c.to_string(),
            _ => String::new(),
        };
        format!("{}{}{separator}{REDACTED}{tail}", &caps[1], &caps[2])
    });
    let text = SECRET_WITH_DIGIT.replace_all(&text, |caps: &regex::Captures| {
        count += 1;
        format!(
            "{} {}{REDACTED}",
            &caps[1],
            caps.get(2).map_or("", |m| m.as_str())
        )
    });
    let text = KEY_LIKE.replace_all(&text, |_: &regex::Captures| {
        count += 1;
        "[ключ вычеркнут]".to_owned()
    });
    let text = CARD_LIKE.replace_all(&text, |caps: &regex::Captures| {
        let digits: String = caps[0].chars().filter(char::is_ascii_digit).collect();
        if luhn(&digits) {
            count += 1;
            "[номер карты вычеркнут]".to_owned()
        } else {
            caps[0].to_owned()
        }
    });
    (text.into_owned(), count)
}

// ---------------------------------------------------------------- расписание

/// Разбор «Расписание.md» (D-322): строгая таблица, по ней сервер считает
/// свободное время и «до следующего урока» (AGT-004) и молчит на уроках.
pub mod schedule {
    use super::*;

    /// Как должна выглядеть таблица — подсказка агенту и человеку.
    pub const FORMAT: &str = "Расписание — таблица Markdown с шапкой \
«| День | Начало | Конец | Что | Где | Не беспокоить |» (последние две колонки можно не писать), \
строка на урок: «| пн | 08:30 | 09:15 | Русский | школа | да |». День — пн, вт, ср, чт, пт, сб, вс \
(можно несколько через запятую: «вт, чт»); время — ЧЧ:ММ; «Не беспокоить» — да/нет (по умолчанию да).";

    /// Слот расписания.
    #[derive(Debug, Clone, PartialEq, Eq, Serialize)]
    pub struct Slot {
        /// 1 — понедельник … 7 — воскресенье.
        pub weekday: u8,
        #[serde(with = "hhmm")]
        pub starts_at: Time,
        #[serde(with = "hhmm")]
        pub ends_at: Time,
        pub title: String,
        pub place: String,
        /// «Не беспокоить».
        pub quiet: bool,
    }

    mod hhmm {
        use serde::Serializer;
        use time::Time;

        pub fn serialize<S: Serializer>(time: &Time, s: S) -> Result<S::Ok, S::Error> {
            s.serialize_str(&format!("{:02}:{:02}", time.hour(), time.minute()))
        }
    }

    fn weekday(text: &str) -> Option<u8> {
        let lower = text.trim().trim_end_matches('.').to_lowercase();
        let days = [
            ["пн", "понедельник", "пон"],
            ["вт", "вторник", "втр"],
            ["ср", "среда", "срд"],
            ["чт", "четверг", "чтв"],
            ["пт", "пятница", "птн"],
            ["сб", "суббота", "суб"],
            ["вс", "воскресенье", "вск"],
        ];
        days.iter()
            .position(|names| names.contains(&lower.as_str()))
            .and_then(|i| u8::try_from(i + 1).ok())
    }

    fn time(text: &str) -> Option<Time> {
        let (h, m) = text
            .trim()
            .replace('.', ":")
            .split_once(':')
            .map(|(h, m)| (h.trim().parse::<u8>().ok(), m.trim().parse::<u8>().ok()))?;
        Time::from_hms(h?, m?, 0).ok()
    }

    fn cells(line: &str) -> Option<Vec<String>> {
        let line = line.trim();
        if !line.starts_with('|') {
            return None;
        }
        let inner = line.trim_start_matches('|').trim_end_matches('|');
        Some(inner.split('|').map(|c| c.trim().to_owned()).collect())
    }

    fn is_rule(cells: &[String]) -> bool {
        cells
            .iter()
            .all(|c| !c.is_empty() && c.chars().all(|ch| matches!(ch, '-' | ':' | ' ')))
    }

    /// Разобрать текст файла. Ошибка — что не так, с номером строки и форматом.
    pub fn parse(text: &str) -> Result<Vec<Slot>, String> {
        let mut slots = Vec::new();
        let mut columns: Option<Vec<String>> = None;
        let mut tables = 0;
        for (number, line) in text.lines().enumerate() {
            let number = number + 1;
            let Some(row) = cells(line) else {
                columns = None;
                continue;
            };
            if is_rule(&row) {
                continue;
            }
            let Some(header) = &columns else {
                let lower: Vec<String> = row.iter().map(|c| c.to_lowercase()).collect();
                if lower.first().map(String::as_str) == Some("день") {
                    for need in ["начало", "конец", "что"] {
                        if !lower.iter().any(|c| c == need) {
                            return Err(format!(
                                "строка {number}: в шапке нет колонки «{need}». {FORMAT}"
                            ));
                        }
                    }
                    tables += 1;
                    columns = Some(lower);
                } else {
                    // Чужая таблица (например, список олимпиад) — не расписание.
                    columns = Some(Vec::new());
                }
                continue;
            };
            if header.is_empty() {
                continue;
            }
            let get = |name: &str| {
                header
                    .iter()
                    .position(|c| c == name)
                    .and_then(|i| row.get(i))
                    .map(String::as_str)
                    .unwrap_or("")
            };
            let days: Vec<&str> = get("день")
                .split([',', '/', ' '])
                .filter(|d| !d.trim().is_empty())
                .collect();
            if days.is_empty() {
                return Err(format!("строка {number}: не указан день. {FORMAT}"));
            }
            let starts = time(get("начало"))
                .ok_or_else(|| format!("строка {number}: начало — ЧЧ:ММ. {FORMAT}"))?;
            let ends = time(get("конец"))
                .ok_or_else(|| format!("строка {number}: конец — ЧЧ:ММ. {FORMAT}"))?;
            if ends <= starts {
                return Err(format!(
                    "строка {number}: конец раньше начала (через полночь — двумя строками)"
                ));
            }
            let title = get("что").trim().to_owned();
            if title.is_empty() || title.chars().count() > 200 {
                return Err(format!("строка {number}: «Что» — от 1 до 200 знаков"));
            }
            let place = get("где").trim().chars().take(200).collect::<String>();
            let quiet = match get("не беспокоить").trim().to_lowercase().as_str() {
                "" | "да" | "+" | "yes" => true,
                "нет" | "-" | "no" => false,
                other => {
                    return Err(format!(
                        "строка {number}: «Не беспокоить» — да или нет, а не «{other}»"
                    ));
                }
            };
            for day in days {
                let weekday = weekday(day)
                    .ok_or_else(|| format!("строка {number}: непонятный день «{day}». {FORMAT}"))?;
                slots.push(Slot {
                    weekday,
                    starts_at: starts,
                    ends_at: ends,
                    title: title.clone(),
                    place: place.clone(),
                    quiet,
                });
            }
        }
        if tables == 0 {
            return Err(format!("в расписании нет таблицы. {FORMAT}"));
        }
        if slots.len() > 200 {
            return Err("в расписании больше 200 строк".into());
        }
        slots.sort_by_key(|slot| (slot.weekday, slot.starts_at));
        Ok(slots)
    }

    /// Переписать разобранные слоты файла (в транзакции правки файла).
    pub(crate) async fn store(
        conn: &mut PgConnection,
        file: Uuid,
        account: Uuid,
        slots: &[Slot],
    ) -> sqlx::Result<()> {
        sqlx::query("DELETE FROM agent_schedule_slots WHERE file_id = $1")
            .bind(file)
            .execute(&mut *conn)
            .await?;
        for slot in slots {
            sqlx::query(
                "INSERT INTO agent_schedule_slots \
                 (file_id, account_id, weekday, starts_at, ends_at, title, place, quiet) \
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            )
            .bind(file)
            .bind(account)
            .bind(i16::from(slot.weekday))
            .bind(slot.starts_at)
            .bind(slot.ends_at)
            .bind(&slot.title)
            .bind(&slot.place)
            .bind(slot.quiet)
            .execute(&mut *conn)
            .await?;
        }
        Ok(())
    }

    /// Расписание человека (из живого, не удалённого файла).
    pub async fn slots(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Vec<Slot>> {
        let rows: Vec<(i16, Time, Time, String, String, bool)> = sqlx::query_as(
            "SELECT s.weekday, s.starts_at, s.ends_at, s.title, s.place, s.quiet \
             FROM agent_schedule_slots s JOIN objects o ON o.id = s.file_id \
             WHERE s.account_id = $1 AND o.deleted_at IS NULL \
             ORDER BY s.weekday, s.starts_at",
        )
        .bind(account)
        .fetch_all(conn)
        .await?;
        Ok(rows
            .into_iter()
            .map(|(weekday, starts_at, ends_at, title, place, quiet)| Slot {
                weekday: u8::try_from(weekday).unwrap_or(1),
                starts_at,
                ends_at,
                title,
                place,
                quiet,
            })
            .collect())
    }
}

// ---------------------------------------------------------------- хранение

/// Файл, как он лежит в базе.
#[derive(Debug, Clone, Serialize)]
pub struct File {
    pub id: Uuid,
    pub path: String,
    pub kind: Kind,
    pub project_id: Option<Uuid>,
    /// Что лежит в базе (у «Кто я» — только «Твои правила»).
    pub body: String,
    pub revision: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: time::OffsetDateTime,
}

impl File {
    /// Знаков сейчас и сколько можно.
    pub fn usage(&self) -> (usize, usize) {
        (self.body.chars().count(), self.kind.limit())
    }

    /// Текст для чтения (у «Кто я» — с основой).
    pub fn text(&self) -> String {
        full_text(self.kind, &self.body)
    }
}

#[derive(sqlx::FromRow)]
struct FileRow {
    id: Uuid,
    path: String,
    kind: String,
    project_id: Option<Uuid>,
    body: String,
    revision: i64,
    updated_at: time::OffsetDateTime,
}

impl TryFrom<FileRow> for File {
    type Error = String;
    fn try_from(row: FileRow) -> Result<Self, String> {
        Ok(Self {
            id: row.id,
            path: row.path,
            kind: row.kind.parse()?,
            project_id: row.project_id,
            body: row.body,
            revision: row.revision,
            updated_at: row.updated_at,
        })
    }
}

const FILE_SELECT: &str = "SELECT o.id, f.path, f.kind, f.project_id, f.body, o.revision, \
     o.updated_at FROM agent_files f JOIN objects o ON o.id = f.object_id";

fn convert(rows: Vec<FileRow>) -> sqlx::Result<Vec<File>> {
    rows.into_iter()
        .map(|row| File::try_from(row).map_err(|error| sqlx::Error::Decode(error.into())))
        .collect()
}

/// Все живые файлы человека, по пути.
pub async fn list(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Vec<File>> {
    let rows: Vec<FileRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{FILE_SELECT} WHERE f.account_id = $1 AND o.deleted_at IS NULL \
         ORDER BY CASE f.kind WHEN 'core' THEN 0 WHEN 'user' THEN 1 WHEN 'memory' THEN 2 \
         ELSE 3 END, lower(f.path)"
    )))
    .bind(account)
    .fetch_all(conn)
    .await?;
    convert(rows)
}

/// Живой файл по пути (без учёта регистра; сравнение — здесь, а не в базе:
/// `lower()` PostgreSQL с локалью C не знает кириллицу).
pub async fn by_path(
    conn: &mut PgConnection,
    account: Uuid,
    path: &str,
) -> sqlx::Result<Option<File>> {
    let wanted = path.to_lowercase();
    let mut found: Vec<File> = list(conn, account)
        .await?
        .into_iter()
        .filter(|file| file.path.to_lowercase() == wanted)
        .collect();
    found.sort_by_key(|file| std::cmp::Reverse(file.updated_at));
    Ok(found.into_iter().next())
}

/// Свой живой файл по ID.
pub async fn by_id(conn: &mut PgConnection, account: Uuid, id: Uuid) -> sqlx::Result<Option<File>> {
    let rows: Vec<FileRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{FILE_SELECT} WHERE f.account_id = $1 AND o.id = $2 AND o.deleted_at IS NULL"
    )))
    .bind(account)
    .bind(id)
    .fetch_all(conn)
    .await?;
    Ok(convert(rows)?.into_iter().next())
}

/// Файлы проекта (их может быть один; берётся самый свежий).
pub async fn of_project(
    conn: &mut PgConnection,
    account: Uuid,
    project: Uuid,
) -> sqlx::Result<Option<File>> {
    let rows: Vec<FileRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{FILE_SELECT} WHERE f.account_id = $1 AND f.project_id = $2 \
         AND o.deleted_at IS NULL ORDER BY o.updated_at DESC LIMIT 1"
    )))
    .bind(account)
    .bind(project)
    .fetch_all(conn)
    .await?;
    Ok(convert(rows)?.into_iter().next())
}

/// Проект для «Проекты/<имя>.md»: по названию или тегу (без регистра).
async fn project_for(
    conn: &mut PgConnection,
    account: Uuid,
    name: &str,
) -> sqlx::Result<Option<Uuid>> {
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT o.id, o.title, p.tag FROM objects o JOIN planner_projects p ON p.object_id = o.id \
         WHERE o.owner_id = $1 AND o.deleted_at IS NULL ORDER BY o.updated_at DESC",
    )
    .bind(account)
    .fetch_all(conn)
    .await?;
    let name = name.to_lowercase();
    Ok(rows
        .iter()
        .find(|(_, title, _)| title.to_lowercase() == name)
        .or_else(|| rows.iter().find(|(_, _, tag)| tag.to_lowercase() == name))
        .map(|(id, ..)| *id))
}

// ---------------------------------------------------------------- проверки записи

fn bad(message: impl Into<String>) -> FieldsError {
    FieldsError::Invalid(message.into())
}

/// Шапка навыка в формате SKILL.md (agentskills.io): `name` и `description`.
pub fn check_skill(body: &str) -> Result<(), String> {
    let body = body.trim_start();
    let rest = body.strip_prefix("---").ok_or(
        "навык — SKILL.md: начинается с шапки «---», в ней name: и description:, потом «---»",
    )?;
    let (head, _) = rest
        .split_once("\n---")
        .ok_or("у шапки навыка нет закрывающей строки «---»")?;
    for key in ["name:", "description:"] {
        if !head
            .lines()
            .any(|line| line.trim_start().starts_with(key) && line.len() > key.len() + 1)
        {
            return Err(format!("в шапке навыка нет «{key}»"));
        }
    }
    Ok(())
}

/// Проверить и подготовить текст файла: вычеркнуть секреты, размер, формат.
pub fn prepare(path: &str, kind: Kind, body: &str) -> Result<(String, usize), String> {
    let (body, redacted) = redact(body);
    let chars = body.chars().count();
    if chars > kind.limit() {
        return Err(format!(
            "«{}» переполнен: {chars} из {} знаков. Сожми: объедини строки, убери устаревшее \
             или вынеси подробное в отдельный файл, потом добавь",
            display_name(path),
            kind.limit()
        ));
    }
    if kind == Kind::Skill {
        check_skill(&body)?;
    }
    if is_schedule(path) {
        schedule::parse(&body)?;
    }
    Ok((body, redacted))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateFields {
    path: String,
    #[serde(default)]
    body: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchFields {
    body: String,
}

/// Обработчик полей `agent.file` для движка синхронизации: здесь проходят все
/// записи — агента, владельца руками, отката.
pub struct FileFieldsHandler;

async fn after_write(
    conn: &mut PgConnection,
    object: &Object,
    path: &str,
    body: &str,
) -> Result<(), FieldsError> {
    if is_schedule(path) {
        let slots = schedule::parse(body).map_err(bad)?;
        schedule::store(conn, object.id, object.owner_id, &slots).await?;
    }
    Ok(())
}

impl TypeFields for FileFieldsHandler {
    fn object_type(&self) -> &'static str {
        FILE_TYPE
    }

    fn create<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: Option<&'a Value>,
    ) -> BoxFuture<'a, Result<(), FieldsError>> {
        Box::pin(async move {
            let fields: CreateFields = serde_json::from_value(
                fields
                    .cloned()
                    .ok_or_else(|| bad("у файла нужны поля path и body"))?,
            )
            .map_err(|error| bad(format!("поля файла: {error}")))?;
            let path = normalize_path(&fields.path).map_err(bad)?;
            let account = object.owner_id;
            if by_path(conn, account, &path).await?.is_some() {
                return Err(bad(format!("файл «{path}» уже есть")));
            }
            let kind = kind_of(&path);
            let (body, _) = prepare(&path, kind, &fields.body).map_err(bad)?;
            let project = match kind {
                Kind::Project => project_for(conn, account, display_name(&path)).await?,
                _ => None,
            };
            sqlx::query(
                "INSERT INTO agent_files (object_id, account_id, path, kind, project_id, body) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(object.id)
            .bind(account)
            .bind(&path)
            .bind(kind.as_str())
            .bind(project)
            .bind(&body)
            .execute(&mut *conn)
            .await?;
            after_write(conn, object, &path, &body).await
        })
    }

    fn patch<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: &'a Value,
    ) -> BoxFuture<'a, Result<Vec<String>, FieldsError>> {
        Box::pin(async move {
            let fields: PatchFields = serde_json::from_value(fields.clone())
                .map_err(|error| bad(format!("поля файла: {error}")))?;
            let (path, kind): (String, String) =
                sqlx::query_as("SELECT path, kind FROM agent_files WHERE object_id = $1")
                    .bind(object.id)
                    .fetch_optional(&mut *conn)
                    .await?
                    .ok_or_else(|| bad("файла нет"))?;
            let kind: Kind = kind.parse().map_err(bad)?;
            let (body, _) = prepare(&path, kind, &fields.body).map_err(bad)?;
            sqlx::query("UPDATE agent_files SET body = $2 WHERE object_id = $1")
                .bind(object.id)
                .bind(&body)
                .execute(&mut *conn)
                .await?;
            after_write(conn, object, &path, &body).await?;
            Ok(vec!["body".to_owned()])
        })
    }

    fn read<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object_id: Uuid,
    ) -> BoxFuture<'a, Result<Option<Value>, FieldsError>> {
        Box::pin(async move {
            let row: Option<(String, String, Option<Uuid>, String)> = sqlx::query_as(
                "SELECT path, kind, project_id, body FROM agent_files WHERE object_id = $1",
            )
            .bind(object_id)
            .fetch_optional(conn)
            .await?;
            Ok(row.map(|(path, kind, project_id, body)| {
                json!({ "path": path, "kind": kind, "project_id": project_id, "body": body })
            }))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths() {
        assert_eq!(normalize_path(" Память ").unwrap(), "Память.md");
        assert_eq!(
            normalize_path("Проекты/ Алгебра  9 класс").unwrap(),
            "Проекты/Алгебра 9 класс.md"
        );
        assert!(normalize_path("../секрет").is_err());
        assert!(normalize_path("a/b/c.md").is_err());
        assert_eq!(kind_of("Кто я.md"), Kind::Core);
        assert_eq!(kind_of("проекты/Алгебра.md"), Kind::Project);
        assert_eq!(kind_of("Навыки/ДЗ.md"), Kind::Skill);
        assert_eq!(kind_of("Расписание.md"), Kind::File);
        assert_eq!(display_name("Проекты/Алгебра.md"), "Алгебра");
    }

    #[test]
    fn redacts_secrets_but_keeps_ordinary_words() {
        let (text, n) = redact("пароль от почты: Kirill2009!");
        assert_eq!(text, "пароль от почты: [вычеркнуто]");
        assert_eq!(n, 1);
        let (text, _) = redact("пароль: abc123, а дальше текст");
        assert_eq!(text, "пароль: [вычеркнуто], а дальше текст");
        let (text, _) = redact("код из смс 482913, карта 4111 1111 1111 1111");
        assert_eq!(
            text,
            "код из смс [вычеркнуто], карта [номер карты вычеркнут]"
        );
        let (text, _) = redact("ключ sk-abcdefghijklmnop1234 и password=hunter2");
        assert_eq!(text, "ключ [ключ вычеркнут] и password=[вычеркнуто]");
        // Обычные слова и числа не трогаем.
        let (text, n) = redact("пишу код на Rust; урок 3, кабинет 214; телефон 89991234567");
        assert_eq!(n, 0, "{text}");
        // Повторная проверка ничего не меняет.
        let (again, n) = redact("пароль от почты: [вычеркнуто]");
        assert_eq!((again.as_str(), n), ("пароль от почты: [вычеркнуто]", 0));
    }

    #[test]
    fn schedule_table() {
        let text = "# Расписание\n\n| День | Начало | Конец | Что | Где |\n|---|---|---|---|---|\n\
                    | вт, чт | 10:05 | 10:50 | Русский | школа |\n| пн | 8:30 | 9:15 | Алгебра | |\n\n\
                    Каникулы — с 27.10.";
        let slots = schedule::parse(text).unwrap();
        assert_eq!(slots.len(), 3);
        assert_eq!(slots[0].weekday, 1);
        assert_eq!(slots[0].title, "Алгебра");
        assert_eq!(slots[1].weekday, 2);
        assert!(slots[1].quiet);
        assert!(
            schedule::parse("| День | Начало | Конец | Что |\n|-|-|-|-|\n| пн | 9 | 10:00 | А |")
                .unwrap_err()
                .contains("строка 3")
        );
        assert!(schedule::parse("уроки по вторникам").is_err());
    }

    #[test]
    fn skill_header() {
        assert!(check_skill("---\nname: ДЗ\ndescription: как ставить ДЗ\n---\n# Как").is_ok());
        assert!(check_skill("# ДЗ").is_err());
    }
}
