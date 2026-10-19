//! Разбор строки Command без AI (CMD-003): что человек написал и куда это положить.
//!
//! «завтра в 18 повторить графы #алгебра !!» → дело «повторить графы», срок завтра 18:00,
//! проект «алгебра», важность 2. Понимает русские даты и время («в пятницу», «через 2 часа»,
//! «15 ноября», «каждый вторник»), команды словами («напомни …», «заметка: …», «найди …»,
//! «дневник: …», «конспект …»), ссылки, покупки и длительность («на 30 мин»).
//!
//! **Источник правды — этот файл.** Тот же разбор есть в web (`packages/ui/src/parse.ts`), чтобы
//! подсказка работала без сети. Расхождений не допускают два файла, которые проверяют обе стороны:
//! `fixtures/examples.json` (фразы и что должно получиться) и `fixtures/golden.json` (сотни
//! сочетаний и ответ этого разборщика; обновить: `QUBITE_PARSE_GOLDEN=update cargo test -p qubite-parse`).
//! Меняешь правило здесь — меняй и в TS, иначе тесты web покраснеют.

use serde::Serialize;

// ---------------------------------------------------------------- календарь

/// Номер дня от 1970-01-01 (без часовых поясов: всё — местное время человека).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = (if y >= 0 { y } else { y - 399 }) / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = (if z >= 0 { z } else { z - 146_096 }) / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// День недели: 1 — понедельник … 7 — воскресенье.
fn weekday(day: i64) -> i64 {
    (day % 7 + 7 + 3) % 7 + 1
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

fn add_months(day: i64, n: i64) -> i64 {
    let (y, m, d) = civil_from_days(day);
    let total = y * 12 + (m - 1) + n;
    let (ny, nm) = (total.div_euclid(12), total.rem_euclid(12) + 1);
    days_from_civil(ny, nm, d.min(days_in_month(ny, nm)))
}

/// «Сейчас» у человека: местные дата и время.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LocalNow {
    pub year: i64,
    pub month: i64,
    pub day: i64,
    pub hour: i64,
    pub minute: i64,
}

impl LocalNow {
    /// `2026-10-19T13:05` (секунды и всё после них не важны).
    pub fn from_iso(s: &str) -> Option<Self> {
        let num = |a: usize, b: usize| s.get(a..b)?.parse::<i64>().ok();
        let now = Self {
            year: num(0, 4)?,
            month: num(5, 7)?,
            day: num(8, 10)?,
            hour: num(11, 13)?,
            minute: num(14, 16)?,
        };
        let ok = (1..=12).contains(&now.month)
            && (1..=days_in_month(now.year, now.month)).contains(&now.day)
            && (0..24).contains(&now.hour)
            && (0..60).contains(&now.minute);
        ok.then_some(now)
    }

    fn day(self) -> i64 {
        days_from_civil(self.year, self.month, self.day)
    }

    fn minutes(self) -> i64 {
        self.hour * 60 + self.minute
    }
}

fn iso_date(day: i64) -> String {
    let (y, m, d) = civil_from_days(day);
    format!("{y:04}-{m:02}-{d:02}")
}

fn hhmm(minutes: i64) -> String {
    format!("{:02}:{:02}", minutes / 60, minutes % 60)
}

// ---------------------------------------------------------------- результат

/// Что это по смыслу.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    Task,
    Note,
    Thought,
    Search,
    Journal,
    Bookmark,
}

/// Команда, которой человек начал строку.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Command {
    Task,
    Thought,
    Note,
    /// конспект
    Summary,
    Journal,
    Search,
    Remind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Due {
    /// `2026-10-23`
    pub date: String,
    /// `18:00`; нет — весь день
    pub time: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Every {
    Day,
    Week,
    Month,
    Year,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Repeat {
    pub every: Every,
    /// каждые `interval` дней/недель/…
    pub interval: i64,
    /// дни недели 1…7 (только для `week`), по порядку
    pub days: Vec<i64>,
}

/// Результат разбора. Те же поля и значения выдаёт разбор в web.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Parsed {
    pub kind: Kind,
    pub command: Option<Command>,
    /// текст без срока, команды, проекта и важности
    pub title: String,
    pub due: Option<Due>,
    pub repeat: Option<Repeat>,
    pub duration_min: Option<i64>,
    pub project: Option<String>,
    /// 0 — обычное, 1 — `!`, 2 — `!!` или «срочно»
    pub priority: i64,
    pub remind: bool,
    pub shopping: bool,
    pub url: Option<String>,
    /// нашлось ли хоть что-то; нет — это просто мысль, разбирать будет AI или человек
    pub recognized: bool,
    /// 0…1; ниже 0,7 — «посмотри сам» (D-199)
    pub confidence: f64,
    /// почему нужно решение человека
    pub review: Option<String>,
    /// срок для человека: «завтра, 18:00», «каждый вт, 18:00»
    pub when: Option<String>,
    /// одной строкой: «Дело: повторить графы · завтра, 18:00 · #алгебра»
    pub summary: String,
}

// ---------------------------------------------------------------- словарь

const MONTHS: [&[&str]; 12] = [
    &["января", "янв"],
    &["февраля", "фев"],
    &["марта", "мар"],
    &["апреля", "апр"],
    &["мая"],
    &["июня", "июн"],
    &["июля", "июл"],
    &["августа", "авг"],
    &["сентября", "сен", "сент"],
    &["октября", "окт"],
    &["ноября", "ноя", "нояб"],
    &["декабря", "дек"],
];
const MONTH_SHORT: [&str; 12] = [
    "янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек",
];

/// Дни недели: кто/что («в пятницу», «каждый вторник») — всегда.
const WEEKDAYS: [&[&str]; 7] = [
    &["понедельник"],
    &["вторник"],
    &["среда", "среду"],
    &["четверг"],
    &["пятница", "пятницу"],
    &["суббота", "субботу"],
    &["воскресенье"],
];
/// Кого/чего — только после «до» и «с»: «до пятницы», «с понедельника».
const WEEKDAYS_GEN: [&str; 7] = [
    "понедельника",
    "вторника",
    "среды",
    "четверга",
    "пятницы",
    "субботы",
    "воскресенья",
];
/// Кому/чему — только после «к»: «к среде» (а «в среде разработки» — не день).
const WEEKDAYS_DAT: [&str; 7] = [
    "понедельнику",
    "вторнику",
    "среде",
    "четвергу",
    "пятнице",
    "субботе",
    "воскресенью",
];
/// «по понедельникам»
const WEEKDAYS_PLURAL: [&str; 7] = [
    "понедельникам",
    "вторникам",
    "средам",
    "четвергам",
    "пятницам",
    "субботам",
    "воскресеньям",
];
const WEEKDAY_SHORT: [&str; 7] = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"];
/// «каждый вт», «каждую ср», «каждое вс»
const EVERY_WEEKDAY: [&str; 7] = [
    "каждый",
    "каждый",
    "каждую",
    "каждый",
    "каждую",
    "каждую",
    "каждое",
];

const NUMBERS: [(&str, i64); 20] = [
    ("один", 1),
    ("одна", 1),
    ("одну", 1),
    ("одного", 1),
    ("два", 2),
    ("две", 2),
    ("три", 3),
    ("четыре", 4),
    ("пять", 5),
    ("шесть", 6),
    ("семь", 7),
    ("восемь", 8),
    ("девять", 9),
    ("десять", 10),
    ("пятнадцать", 15),
    ("двадцать", 20),
    ("тридцать", 30),
    ("сорок", 40),
    ("пару", 2),
    ("пара", 2),
];

/// С чего начинается дело.
const TASK_VERBS: [&str; 40] = [
    "сделать",
    "сделай",
    "купить",
    "купи",
    "позвонить",
    "позвони",
    "написать",
    "напиши",
    "прочитать",
    "прочитай",
    "сдать",
    "сдай",
    "решить",
    "реши",
    "повторить",
    "повтори",
    "отправить",
    "отправь",
    "подготовить",
    "подготовь",
    "выучить",
    "выучи",
    "починить",
    "оплатить",
    "оплати",
    "записаться",
    "забрать",
    "забери",
    "заказать",
    "закажи",
    "убрать",
    "помыть",
    "проверить",
    "проверь",
    "спросить",
    "спроси",
    "договориться",
    "встретить",
    "доделать",
    "посмотреть",
];

/// После «в N» это не время: «в 5 классе», «в 2 раза».
const NOT_TIME: [&str; 8] = ["класс", "кабинет", "лет", "год", "раз", "шт", "рубл", "%"];

const PREP_DATE: [&str; 6] = ["в", "во", "на", "к", "до", "с"];
const PREP_TIME: [&str; 4] = ["в", "к", "до", "с"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Unit {
    Min,
    Hour,
    Day,
    Week,
    Month,
    Year,
}

fn unit(w: &str) -> Option<Unit> {
    Some(match w {
        "мин" | "минута" | "минуту" | "минуты" | "минут" => Unit::Min,
        "ч" | "час" | "часа" | "часов" => Unit::Hour,
        "день" | "дня" | "дней" | "сутки" | "суток" => Unit::Day,
        "неделя" | "неделю" | "недели" | "недель" | "нед" => Unit::Week,
        "месяц" | "месяца" | "месяцев" | "мес" => Unit::Month,
        "год" | "года" | "лет" => Unit::Year,
        _ => return None,
    })
}

fn int(w: &str) -> Option<i64> {
    if w.is_empty() || w.len() > 4 || !w.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    w.parse().ok()
}

fn number(w: &str) -> Option<i64> {
    int(w).or_else(|| NUMBERS.iter().find(|(n, _)| *n == w).map(|(_, v)| *v))
}

fn month_of(w: &str) -> Option<i64> {
    MONTHS
        .iter()
        .position(|forms| forms.contains(&w))
        .map(|i| i as i64 + 1)
}

/// День недели по слову; какие формы годятся, зависит от предлога перед ним.
fn weekday_of(w: &str, prep: &str) -> Option<i64> {
    let at = |list: &[&str]| list.iter().position(|x| *x == w).map(|i| i as i64 + 1);
    if let Some(i) = WEEKDAYS.iter().position(|forms| forms.contains(&w)) {
        return Some(i as i64 + 1);
    }
    match prep {
        "до" | "с" => at(&WEEKDAYS_GEN).or_else(|| at(&WEEKDAY_SHORT)),
        "к" => at(&WEEKDAYS_DAT).or_else(|| at(&WEEKDAY_SHORT)),
        // сокращения («пт») — только после предлога: иначе «вс» и «ср» ловились бы в тексте
        "" => None,
        _ => at(&WEEKDAY_SHORT),
    }
}

/// «18:30» → минуты от полуночи.
fn clock(w: &str, sep: char) -> Option<i64> {
    let (h, m) = w.split_once(sep)?;
    let (h, m) = (int(h)?, int(m)?);
    if h > 24 || m > 59 || w.len() - w.find(sep)? != 3 {
        return None;
    }
    Some((h % 24) * 60 + m)
}

fn plural(n: i64, one: &str, few: &str, many: &str) -> String {
    let (m10, m100) = (n % 10, n % 100);
    let word = if m10 == 1 && m100 != 11 {
        one
    } else if (2..=4).contains(&m10) && !(12..=14).contains(&m100) {
        few
    } else {
        many
    };
    format!("{n} {word}")
}

/// Края слова, которые не важны для сравнения.
fn is_edge(c: char) -> bool {
    matches!(
        c,
        ',' | '.' | ';' | ':' | '!' | '?' | '(' | ')' | '«' | '»' | '"' | '\'' | '—' | '–'
    )
}

// ---------------------------------------------------------------- разбор

struct Token {
    orig: String,
    /// нижний регистр, «ё» → «е», без знаков по краям
    low: String,
}

struct Parser {
    toks: Vec<Token>,
    used: Vec<bool>,
    now: LocalNow,
    dates: Vec<i64>,
    /// время и откуда оно: `с` — начало промежутка «с 18 до 20»
    times: Vec<(i64, bool)>,
    /// «в 5» без «утра/вечера» — догадались, что вечер
    guessed: bool,
    /// «утром», «вечером»: само время или уточнение к «в 7»
    part: Option<i64>,
    past: bool,
    repeat: Option<Repeat>,
    duration: Option<i64>,
    projects: Vec<String>,
    priority: i64,
    url: Option<String>,
}

impl Parser {
    fn w(&self, i: usize) -> &str {
        match self.toks.get(i) {
            Some(t) if !self.used[i] => &t.low,
            _ => "",
        }
    }

    fn date(&mut self, day: i64) {
        if !self.dates.contains(&day) {
            self.dates.push(day);
        }
    }

    /// Ближайший такой день недели после сегодня (сегодня — значит через неделю).
    fn next_weekday(&self, wd: i64) -> i64 {
        let today = self.now.day();
        let mut d = today + 1;
        while weekday(d) != wd {
            d += 1;
        }
        d
    }

    fn try_at(&mut self, i: usize) -> usize {
        let matchers: [fn(&mut Self, usize) -> usize; 13] = [
            Self::m_url,
            Self::m_project,
            Self::m_priority,
            Self::m_repeat,
            Self::m_after,
            Self::m_duration,
            Self::m_day_word,
            Self::m_weekend,
            Self::m_weekday,
            Self::m_day_month,
            Self::m_numeric_date,
            Self::m_time,
            Self::m_part_of_day,
        ];
        for m in matchers {
            let n = m(self, i);
            if n > 0 {
                return n;
            }
        }
        0
    }

    fn m_url(&mut self, i: usize) -> usize {
        let orig = &self.toks[i].orig;
        if !(orig.starts_with("https://") || orig.starts_with("http://"))
            || orig.chars().count() < 10
        {
            return 0;
        }
        let url = orig
            .trim_end_matches([',', '.', ';', ')', '!', '?'])
            .to_owned();
        if self.url.is_none() {
            self.url = Some(url);
        }
        1
    }

    fn m_project(&mut self, i: usize) -> usize {
        let orig = &self.toks[i].orig;
        let Some(rest) = orig.strip_prefix('#') else {
            return 0;
        };
        let name = rest.trim_matches(is_edge).to_lowercase().replace('ё', "е");
        if name.is_empty() || name.starts_with('#') {
            return 0;
        }
        if !self.projects.contains(&name) {
            self.projects.push(name);
        }
        1
    }

    fn m_priority(&mut self, i: usize) -> usize {
        let orig = self.toks[i].orig.as_str();
        if !orig.is_empty() && orig.chars().all(|c| c == '!') {
            self.priority = self.priority.max(if orig.len() == 1 { 1 } else { 2 });
            return 1;
        }
        if self.w(i) == "срочно" {
            self.priority = 2;
            return 1;
        }
        0
    }

    fn m_repeat(&mut self, i: usize) -> usize {
        let w = self.w(i).to_owned();
        let simple = |every| Repeat {
            every,
            interval: 1,
            days: vec![],
        };
        let (repeat, n) = match w.as_str() {
            "ежедневно" => (simple(Every::Day), 1),
            "еженедельно" => (simple(Every::Week), 1),
            "ежемесячно" => (simple(Every::Month), 1),
            "по" => {
                let next = self.w(i + 1).to_owned();
                let days: Vec<i64> = match next.as_str() {
                    "будням" => vec![1, 2, 3, 4, 5],
                    "выходным" => vec![6, 7],
                    _ => match WEEKDAYS_PLURAL.iter().position(|p| *p == next) {
                        Some(d) => vec![d as i64 + 1],
                        None => return 0,
                    },
                };
                let mut repeat = Repeat {
                    every: Every::Week,
                    interval: 1,
                    days,
                };
                let mut n = 2;
                n += self.more_weekdays(i + n, &mut repeat.days, true);
                (repeat, n)
            }
            "каждый" | "каждую" | "каждое" | "каждые" | "каждого" => {
                let next = self.w(i + 1).to_owned();
                if let Some(count) = number(&next) {
                    let every = match unit(self.w(i + 2)) {
                        Some(Unit::Day) => Every::Day,
                        Some(Unit::Week) => Every::Week,
                        Some(Unit::Month) => Every::Month,
                        Some(Unit::Year) => Every::Year,
                        _ => return 0,
                    };
                    let repeat = Repeat {
                        every,
                        interval: count.max(1),
                        days: vec![],
                    };
                    (repeat, 3)
                } else if next == "будний" && self.w(i + 2) == "день" {
                    let repeat = Repeat {
                        every: Every::Week,
                        interval: 1,
                        days: vec![1, 2, 3, 4, 5],
                    };
                    (repeat, 3)
                } else if next == "утро" || next == "вечер" {
                    self.part
                        .get_or_insert(if next == "утро" { 9 * 60 } else { 19 * 60 });
                    (simple(Every::Day), 2)
                } else if let Some(wd) = weekday_of(&next, "в") {
                    let mut repeat = Repeat {
                        every: Every::Week,
                        interval: 1,
                        days: vec![wd],
                    };
                    let mut n = 2;
                    n += self.more_weekdays(i + n, &mut repeat.days, false);
                    (repeat, n)
                } else {
                    let every = match unit(&next) {
                        Some(Unit::Day) => Every::Day,
                        Some(Unit::Week) => Every::Week,
                        Some(Unit::Month) => Every::Month,
                        Some(Unit::Year) => Every::Year,
                        _ => return 0,
                    };
                    (simple(every), 2)
                }
            }
            _ => return 0,
        };
        if self.repeat.is_none() {
            let mut repeat = repeat;
            repeat.days.sort_unstable();
            repeat.days.dedup();
            self.repeat = Some(repeat);
        }
        n
    }

    /// «… и четверг», «…, пятницу»: ещё дни недели после первого.
    fn more_weekdays(&self, mut i: usize, days: &mut Vec<i64>, plural: bool) -> usize {
        let start = i;
        loop {
            let joined = self.w(i) == "и";
            let at = if joined { i + 1 } else { i };
            let w = self.w(at);
            let day = if plural {
                WEEKDAYS_PLURAL
                    .iter()
                    .position(|p| *p == w)
                    .map(|d| d as i64 + 1)
            } else {
                weekday_of(w, "в")
            };
            // без «и» — только если перед этим словом стояла запятая
            let comma = at > 0 && self.toks[at - 1].orig.ends_with(',');
            match day {
                Some(d) if joined || comma => {
                    days.push(d);
                    i = at + 1;
                }
                _ => return i - start,
            }
        }
    }

    /// Сколько: «2», «два», «полтора»; без числа — один («через час»).
    fn amount(&self, i: usize) -> Option<(i64, bool, usize)> {
        let w = self.w(i);
        if let Some(n) = number(w) {
            return Some((n, false, 1));
        }
        if w == "полтора" || w == "полторы" {
            return Some((1, true, 1));
        }
        unit(w).map(|_| (1, false, 0))
    }

    fn m_after(&mut self, i: usize) -> usize {
        if self.w(i) != "через" {
            return 0;
        }
        if self.w(i + 1) == "полчаса" {
            self.relative_minutes(30);
            return 2;
        }
        let Some((n, half, used)) = self.amount(i + 1) else {
            return 0;
        };
        let Some(u) = unit(self.w(i + 1 + used)) else {
            return 0;
        };
        let today = self.now.day();
        match u {
            Unit::Min => self.relative_minutes(n),
            Unit::Hour => self.relative_minutes(n * 60 + if half { 30 } else { 0 }),
            Unit::Day => self.date(today + n),
            Unit::Week => self.date(today + 7 * n),
            Unit::Month => self.date(add_months(today, n)),
            Unit::Year => self.date(add_months(today, 12 * n)),
        }
        2 + used
    }

    fn relative_minutes(&mut self, n: i64) {
        let total = self.now.minutes() + n;
        self.date(self.now.day() + total.div_euclid(1440));
        self.times.push((total.rem_euclid(1440), false));
    }

    fn m_duration(&mut self, i: usize) -> usize {
        if self.w(i) != "на" {
            return 0;
        }
        if self.w(i + 1) == "полчаса" {
            self.duration = Some(30);
            return 2;
        }
        let Some((n, half, used)) = self.amount(i + 1) else {
            return 0;
        };
        let minutes = match unit(self.w(i + 1 + used)) {
            Some(Unit::Min) if !half => n,
            Some(Unit::Hour) => n * 60 + if half { 30 } else { 0 },
            _ => return 0,
        };
        if minutes <= 0 {
            return 0;
        }
        self.duration = Some(minutes);
        2 + used
    }

    /// Предлог перед датой, если есть: сколько слов он занимает.
    fn prep(&self, i: usize, set: &[&str]) -> usize {
        usize::from(set.contains(&self.w(i)))
    }

    fn m_day_word(&mut self, i: usize) -> usize {
        let p = self.prep(i, &PREP_DATE);
        let shift = match self.w(i + p) {
            "сегодня" => 0,
            "завтра" => 1,
            "послезавтра" => 2,
            _ => return 0,
        };
        self.date(self.now.day() + shift);
        p + 1
    }

    /// «на выходных», «в выходные», «на следующей неделе».
    fn m_weekend(&mut self, i: usize) -> usize {
        let (a, b, c) = (self.w(i), self.w(i + 1), self.w(i + 2));
        let today = self.now.day();
        if (a == "на" && b == "выходных") || (a == "в" && b == "выходные") {
            let d = if weekday(today) >= 6 {
                today
            } else {
                self.next_weekday(6)
            };
            self.date(d);
            return 2;
        }
        if a == "на" && b == "следующей" && c == "неделе" {
            self.date(today + 8 - weekday(today));
            return 3;
        }
        0
    }

    fn m_weekday(&mut self, i: usize) -> usize {
        let p = self.prep(i, &PREP_DATE);
        let prep = if p > 0 {
            self.w(i).to_owned()
        } else {
            String::new()
        };
        let mut at = i + p;
        let next = matches!(
            self.w(at),
            "следующий" | "следующую" | "следующее" | "следующей" | "следующего"
        );
        let this = matches!(self.w(at), "этот" | "эту" | "это" | "этой" | "этого");
        if next || this {
            at += 1;
        }
        let Some(wd) = weekday_of(self.w(at), &prep) else {
            return 0;
        };
        let today = self.now.day();
        let mut d = self.next_weekday(wd);
        if this && weekday(today) == wd {
            d = today;
        }
        // «в следующую пятницу» — пятница следующей недели
        if next && d - today < 8 - weekday(today) {
            d += 7;
        }
        self.date(d);
        at + 1 - i
    }

    /// Указанный день без года: если уже прошёл — в следующем году
    /// (29 февраля — в ближайшем году, где он есть).
    fn upcoming(&mut self, y: Option<i64>, m: i64, d: i64) -> bool {
        if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
            return false;
        }
        let today = self.now.day();
        let day = match y {
            Some(year) if d <= days_in_month(year, m) => days_from_civil(year, m, d),
            Some(_) => return false,
            None => {
                let found = (self.now.year..self.now.year + 8)
                    .filter(|year| d <= days_in_month(*year, m))
                    .map(|year| days_from_civil(year, m, d))
                    .find(|day| *day >= today);
                match found {
                    Some(day) => day,
                    None => return false,
                }
            }
        };
        if day < today {
            self.past = true;
        }
        self.date(day);
        true
    }

    fn m_day_month(&mut self, i: usize) -> usize {
        let p = self.prep(i, &PREP_DATE);
        let Some(d) = int(self.w(i + p)) else {
            return 0;
        };
        let w = self.w(i + p + 1).to_owned();
        if w == "числа" {
            let today = self.now.day();
            let (y, m, _) = civil_from_days(today);
            if !(1..=31).contains(&d) {
                return 0;
            }
            let mut day = days_from_civil(y, m, d.min(days_in_month(y, m)));
            if day < today {
                let next = add_months(days_from_civil(y, m, 1), 1);
                let (ny, nm, _) = civil_from_days(next);
                day = days_from_civil(ny, nm, d.min(days_in_month(ny, nm)));
            }
            self.date(day);
            return p + 2;
        }
        let Some(m) = month_of(&w) else {
            return 0;
        };
        let mut n = p + 2;
        let year = int(self.w(i + n)).filter(|y| (2000..=2100).contains(y));
        if year.is_some() {
            n += 1;
            if matches!(self.w(i + n), "года" | "г") {
                n += 1;
            }
        }
        if !self.upcoming(year, m, d) {
            return 0;
        }
        n
    }

    fn m_numeric_date(&mut self, i: usize) -> usize {
        let p = self.prep(i, &PREP_DATE);
        let w = self.w(i + p).to_owned();
        let parts: Vec<&str> = w.split('.').collect();
        if parts.len() < 2 || parts.len() > 3 || parts[0].len() > 2 || parts[1].len() != 2 {
            return 0;
        }
        let (Some(d), Some(m)) = (int(parts[0]), int(parts[1])) else {
            return 0;
        };
        let year = match parts.get(2) {
            Some(y) if y.len() == 4 => Some(int(y).unwrap_or(0)),
            Some(_) => return 0,
            None => None,
        };
        if year.is_some_and(|y| !(2000..=2100).contains(&y)) || !self.upcoming(year, m, d) {
            return 0;
        }
        p + 1
    }

    fn m_time(&mut self, i: usize) -> usize {
        let p = self.prep(i, &PREP_TIME);
        let from = p > 0 && self.w(i) == "с";
        let w = self.w(i + p).to_owned();
        if p > 0 && (w == "полдень" || w == "полночь") {
            self.times
                .push((if w == "полдень" { 720 } else { 0 }, from));
            return 2;
        }
        let mut minutes = clock(&w, ':');
        if minutes.is_none() && p > 0 {
            minutes = clock(&w, '.');
        }
        let explicit = minutes.is_some();
        if minutes.is_none() {
            minutes = int(&w).filter(|h| *h <= 24).map(|h| (h % 24) * 60);
        }
        let Some(mut minutes) = minutes else {
            return 0;
        };
        let mut n = p + 1;
        let q = self.w(i + n).to_owned();
        let qualified = match q.as_str() {
            "утра" => {
                if minutes >= 720 {
                    minutes -= 720;
                }
                true
            }
            "дня" | "вечера" => {
                if minutes < 720 {
                    minutes += 720;
                }
                true
            }
            "ночи" => {
                if minutes == 720 {
                    minutes = 0;
                }
                true
            }
            _ => false,
        };
        if qualified {
            n += 1;
        } else if matches!(q.as_str(), "часов" | "часа" | "час" | "ч") {
            n += 1;
            if !explicit && p == 0 && !matches!(self.w(i + n), "утра" | "дня" | "вечера" | "ночи")
            {
                // «18 часов» без предлога — это время; «2 часа» — длительность, не трогаем
                if minutes < 7 * 60 {
                    return 0;
                }
            }
            match self.w(i + n) {
                "утра" => {
                    if minutes >= 720 {
                        minutes -= 720;
                    }
                    n += 1;
                }
                "дня" | "вечера" => {
                    if minutes < 720 {
                        minutes += 720;
                    }
                    n += 1;
                }
                _ => {}
            }
        } else if !explicit {
            // голое число — время только после предлога и не перед «классом», «разами»…;
            // «с 5 …» — только как «с 5 до 7» (иначе «с 5 друзьями» стало бы временем)
            if p == 0
                || NOT_TIME.iter().any(|s| q.starts_with(s))
                || month_of(&q).is_some()
                || (from && q != "до")
            {
                return 0;
            }
            if (60..7 * 60).contains(&minutes) {
                minutes += 720;
                self.guessed = true;
            }
        }
        self.times.push((minutes, from));
        n
    }

    fn m_part_of_day(&mut self, i: usize) -> usize {
        let minutes = match self.w(i) {
            "утром" => 9 * 60,
            "днем" => 13 * 60,
            "вечером" => 19 * 60,
            "ночью" => 23 * 60,
            _ => return 0,
        };
        self.part.get_or_insert(minutes);
        1
    }
}

/// Команда в начале строки: что это и сколько слов она занимает.
fn command_at_start(toks: &[Token]) -> Option<(Command, usize)> {
    let low = |i: usize| toks.get(i).map_or("", |t| t.low.as_str());
    let colon = |i: usize| toks.get(i).is_some_and(|t| t.orig.ends_with(':'));
    let first = low(0);
    let slash = match toks.first().map(|t| t.orig.to_lowercase()).as_deref() {
        Some("/д") => Some(Command::Task),
        Some("/м") => Some(Command::Thought),
        Some("/к") => Some(Command::Summary),
        Some("/з") => Some(Command::Journal),
        Some("/п") => Some(Command::Search),
        Some("/н") => Some(Command::Note),
        _ => None,
    };
    if let Some(c) = slash {
        return Some((c, 1));
    }
    if (first == "в" && low(1) == "дневник")
        || (first == "запись" && low(1) == "в" && low(2) == "дневник")
    {
        return Some((Command::Journal, if first == "в" { 2 } else { 3 }));
    }
    let with_colon = match first {
        "дело" | "задача" => Some(Command::Task),
        "мысль" | "идея" => Some(Command::Thought),
        "заметка" => Some(Command::Note),
        "дневник" => Some(Command::Journal),
        "поиск" => Some(Command::Search),
        _ => None,
    };
    if let Some(c) = with_colon {
        return colon(0).then_some((c, 1));
    }
    match first {
        "напомни" | "напомнить" => {
            let mut n = 1;
            if low(n) == "мне" {
                n += 1;
            }
            if matches!(low(n), "про" | "о" | "об") {
                n += 1;
            }
            Some((Command::Remind, n))
        }
        "найди" | "найти" => Some((Command::Search, 1)),
        "конспект" => Some((Command::Summary, 1)),
        _ => None,
    }
}

fn date_label(day: i64, now: LocalNow) -> String {
    match day - now.day() {
        0 => "сегодня".to_owned(),
        1 => "завтра".to_owned(),
        2 => "послезавтра".to_owned(),
        _ => {
            let (y, m, d) = civil_from_days(day);
            let wd = WEEKDAY_SHORT[(weekday(day) - 1) as usize];
            let mon = MONTH_SHORT[(m - 1) as usize];
            if y == now.year {
                format!("{wd}, {d} {mon}")
            } else {
                format!("{wd}, {d} {mon} {y}")
            }
        }
    }
}

fn clock_label(minutes: i64) -> String {
    format!("{}:{:02}", minutes / 60, minutes % 60)
}

fn repeat_label(r: &Repeat) -> String {
    match r.every {
        Every::Day if r.interval == 1 => "каждый день".to_owned(),
        Every::Day => format!("каждые {}", plural(r.interval, "день", "дня", "дней")),
        Every::Week if r.days == [1, 2, 3, 4, 5] => "по будням".to_owned(),
        Every::Week if r.days == [6, 7] => "по выходным".to_owned(),
        Every::Week if r.days.len() == 1 => {
            let d = (r.days[0] - 1) as usize;
            format!("{} {}", EVERY_WEEKDAY[d], WEEKDAY_SHORT[d])
        }
        Every::Week if !r.days.is_empty() => {
            let days: Vec<&str> = r
                .days
                .iter()
                .map(|d| WEEKDAY_SHORT[(d - 1) as usize])
                .collect();
            format!("по {}", days.join(", "))
        }
        Every::Week if r.interval == 1 => "каждую неделю".to_owned(),
        Every::Week => format!(
            "каждые {}",
            plural(r.interval, "неделю", "недели", "недель")
        ),
        Every::Month if r.interval == 1 => "каждый месяц".to_owned(),
        Every::Month => format!(
            "каждые {}",
            plural(r.interval, "месяц", "месяца", "месяцев")
        ),
        Every::Year if r.interval == 1 => "каждый год".to_owned(),
        Every::Year => format!("каждые {}", plural(r.interval, "год", "года", "лет")),
    }
}

fn duration_label(minutes: i64) -> String {
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m} мин"),
        (h, 0) => format!("{h} ч"),
        (h, m) => format!("{h} ч {m} мин"),
    }
}

/// Разобрать строку. Пустая строка — `None`.
pub fn parse(input: &str, now: LocalNow) -> Option<Parsed> {
    let raw = input.trim();
    if raw.is_empty() {
        return None;
    }
    let toks: Vec<Token> = raw
        .split_whitespace()
        .map(|orig| Token {
            orig: orig.to_owned(),
            low: orig.trim_matches(is_edge).to_lowercase().replace('ё', "е"),
        })
        .collect();
    let command = command_at_start(&toks);
    let start = command.map_or(0, |(_, n)| n);
    let mut p = Parser {
        used: vec![false; toks.len()],
        toks,
        now,
        dates: vec![],
        times: vec![],
        guessed: false,
        part: None,
        past: false,
        repeat: None,
        duration: None,
        projects: vec![],
        priority: 0,
        url: None,
    };
    for u in p.used.iter_mut().take(start) {
        *u = true;
    }
    let cmd = command.map(|(c, _)| c);
    let question = cmd.is_none() && raw.ends_with('?');
    // в поиске и дневнике слова остаются как написаны: «найди план на завтра»
    let literal = question || matches!(cmd, Some(Command::Search | Command::Journal));
    let mut i = if literal { p.toks.len() } else { start };
    while i < p.toks.len() {
        if p.used[i] {
            i += 1;
            continue;
        }
        let n = p.try_at(i);
        if n == 0 {
            i += 1;
            continue;
        }
        for u in p.used.iter_mut().skip(i).take(n) {
            *u = true;
        }
        i += n;
    }

    let title_words: Vec<&str> = p
        .toks
        .iter()
        .zip(&p.used)
        .filter(|(_, used)| !**used)
        .map(|(t, _)| t.orig.as_str())
        .collect();
    let title = title_words
        .join(" ")
        .trim_matches(|c: char| {
            c.is_whitespace() || matches!(c, ',' | '.' | ';' | ':' | '—' | '-' | '–' | '?' | '!')
        })
        .to_owned();
    let first_word = title
        .split_whitespace()
        .next()
        .map(|w| w.trim_matches(is_edge).to_lowercase().replace('ё', "е"))
        .unwrap_or_default();
    let shopping = matches!(first_word.as_str(), "купить" | "купи");
    let verb = TASK_VERBS.contains(&first_word.as_str());

    // «с 18 до 20» — начало и длительность
    let mut time = p.times.first().map(|(m, _)| *m);
    let mut times_conflict = false;
    if let [(a, true), (b, false), ..] = p.times.as_slice() {
        if b > a && p.duration.is_none() {
            p.duration = Some(b - a);
        }
    } else if p.times.len() > 1 && p.times.iter().any(|(m, _)| Some(*m) != time) {
        times_conflict = true;
    }
    // «вечером в 7» — 19:00, «утром в 5» — 5:00, просто «вечером» — 19:00
    match (time, p.part) {
        (None, Some(part)) => time = Some(part),
        (Some(t), Some(part)) if part >= 12 * 60 && t < 12 * 60 => time = Some(t + 720),
        (Some(t), Some(part)) if part < 12 * 60 && p.guessed && t >= 12 * 60 => {
            time = Some(t - 720);
            p.guessed = false;
        }
        _ => {}
    }

    let has_when = !p.dates.is_empty() || time.is_some() || p.repeat.is_some();
    let kind = match cmd {
        Some(Command::Task | Command::Remind) => Kind::Task,
        Some(Command::Thought) => Kind::Thought,
        Some(Command::Note | Command::Summary) => Kind::Note,
        Some(Command::Journal) => Kind::Journal,
        Some(Command::Search) => Kind::Search,
        None if question => Kind::Search,
        None if p.url.is_some() && !has_when => Kind::Bookmark,
        None if has_when || p.duration.is_some() || p.priority > 0 || verb => Kind::Task,
        None => Kind::Thought,
    };

    // срок: дата, время, повторение
    let today = now.day();
    let mut date = p.dates.first().copied();
    if date.is_none()
        && let Some(r) = &p.repeat
    {
        let late = time.is_some_and(|t| t <= now.minutes());
        let mut d = if late { today + 1 } else { today };
        if r.every == Every::Week && !r.days.is_empty() {
            while !r.days.contains(&weekday(d)) {
                d += 1;
            }
        }
        date = Some(d);
    }
    if date.is_none()
        && let Some(t) = time
    {
        date = Some(if t > now.minutes() { today } else { today + 1 });
    }
    let due = date.map(|d| Due {
        date: iso_date(d),
        time: time.map(hhmm),
    });
    let repeat = p.repeat.clone();

    // насколько уверены и нужно ли решение человека
    let mut confidence: f64 = match (cmd, kind) {
        (Some(_), _) => 0.95,
        (None, Kind::Search) => 0.85,
        (None, Kind::Bookmark) => 0.9,
        (None, Kind::Task) if has_when => 0.9,
        (None, Kind::Task) => 0.8,
        (None, _) if !p.projects.is_empty() => 0.75,
        _ => 0.5,
    };
    if p.guessed {
        confidence = confidence.min(0.85);
    }
    let mut review = None;
    if p.dates.len() > 1 {
        let a = date_label(p.dates[0], now);
        let b = date_label(p.dates[1], now);
        review = Some(format!("Два срока: «{a}» и «{b}» — какой верный?"));
    } else if times_conflict {
        let a = clock_label(p.times[0].0);
        let b = clock_label(p.times[1].0);
        review = Some(format!("Два времени: {a} и {b} — какое верное?"));
    } else if p.projects.len() > 1 {
        review = Some(format!(
            "Два проекта: #{} и #{} — к какому?",
            p.projects[0], p.projects[1]
        ));
    } else if cmd == Some(Command::Remind) && due.is_none() {
        review = Some("Когда напомнить? Срок не нашёл".to_owned());
    } else if p.past && kind == Kind::Task {
        review = Some("Срок уже прошёл — проверь дату".to_owned());
    } else if title.is_empty() && matches!(kind, Kind::Task | Kind::Note) && p.url.is_none() {
        review = Some("Есть срок, но не понял, что сделать".to_owned());
    }
    if review.is_some() {
        confidence = 0.6;
    }
    let recognized = cmd.is_some() || kind != Kind::Thought || !p.projects.is_empty();

    let when = if let Some(r) = &repeat {
        Some(match time {
            Some(t) => format!("{}, {}", repeat_label(r), clock_label(t)),
            None => repeat_label(r),
        })
    } else {
        date.map(|d| match time {
            Some(t) => format!("{}, {}", date_label(d, now), clock_label(t)),
            None => date_label(d, now),
        })
    };

    let label = match (kind, cmd) {
        (Kind::Task, Some(Command::Remind)) => "Напоминание",
        (Kind::Task, _) if shopping => "Покупка",
        (Kind::Task, _) => "Дело",
        (Kind::Note, Some(Command::Summary)) => "Конспект",
        (Kind::Note, _) => "Заметка",
        (Kind::Thought, _) => "Мысль",
        (Kind::Search, _) => "Поиск",
        (Kind::Journal, _) => "Дневник",
        (Kind::Bookmark, _) => "Закладка",
    };
    let shown_title = if title.is_empty() {
        p.url.clone().unwrap_or_default()
    } else {
        title.clone()
    };
    let mut summary = label.to_owned();
    if !shown_title.is_empty() {
        summary = format!("{summary}: {shown_title}");
    }
    let mut extra: Vec<String> = vec![];
    if let Some(w) = &when {
        extra.push(w.clone());
    }
    if let Some(m) = p.duration.filter(|_| kind == Kind::Task) {
        extra.push(duration_label(m));
    }
    if let Some(pr) = p.projects.first() {
        extra.push(format!("#{pr}"));
    }
    if p.priority > 0 {
        extra.push("!".repeat(p.priority as usize));
    }
    for e in extra {
        summary = format!("{summary} · {e}");
    }

    Some(Parsed {
        kind,
        command: cmd,
        title,
        due,
        repeat,
        duration_min: p.duration.filter(|_| kind == Kind::Task),
        project: p.projects.first().cloned(),
        priority: p.priority,
        remind: cmd == Some(Command::Remind),
        shopping: shopping && kind == Kind::Task,
        url: p.url,
        recognized,
        confidence,
        review,
        when,
        summary,
    })
}
