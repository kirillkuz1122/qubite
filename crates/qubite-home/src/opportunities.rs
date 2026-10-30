//! Возможности (AGT-005a): только открытые источники, без AI и без удаления
//! старых записей при сбое. Личное решение `status`/`why` сборщик не меняет.

use serde::Serialize;
use serde_json::Value;
use sqlx::PgPool;
use time::{Date, Month, OffsetDateTime, Time, UtcOffset};
use uuid::Uuid;

use crate::{Error, Result, Sources, fetch_bytes, fetch_json, news::unescape};

pub const KINDS: [&str; 3] = ["olympiad", "hackathon", "contest"];
pub const STATUSES: [&str; 4] = ["new", "suggested", "interested", "dismissed"];

/// Разобранная запись источника, ещё без аккаунта и личного статуса.
#[derive(Debug, Clone)]
pub struct Candidate {
    pub source: String,
    pub external_id: String,
    pub kind: String,
    pub title: String,
    pub subject: String,
    pub stage: String,
    pub grades: String,
    pub registration_until: Option<OffsetDateTime>,
    pub starts_at: OffsetDateTime,
    pub ends_at: OffsetDateTime,
    pub place: String,
    pub url: String,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct Opportunity {
    pub id: Uuid,
    pub account_id: Uuid,
    pub source: String,
    pub external_id: String,
    pub kind: String,
    pub title: String,
    pub subject: String,
    pub stage: String,
    pub grades: String,
    pub registration_until: Option<OffsetDateTime>,
    pub starts_at: OffsetDateTime,
    pub ends_at: OffsetDateTime,
    pub place: String,
    pub url: String,
    pub tags: Vec<String>,
    pub status: String,
    pub why: String,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Serialize)]
pub struct Refresh {
    /// Число новых строк; существующие не перезаписываются.
    pub inserted: u64,
    /// Имена источников, которые сейчас не ответили или изменили формат.
    pub failed_sources: Vec<String>,
}

fn upstream(message: &str) -> Error {
    Error::Upstream(message.into())
}

fn json(bytes: &[u8]) -> Result<Value> {
    serde_json::from_slice(bytes).map_err(|_| upstream("не JSON возможностей"))
}

fn https(text: &str) -> Option<String> {
    let url = reqwest::Url::parse(text.trim()).ok()?;
    (url.scheme() == "https"
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none()
        && text.len() <= 2000)
        .then(|| url.to_string())
}

fn title(value: &Value, field: &str) -> Option<String> {
    let text = value[field].as_str()?.trim();
    (!text.is_empty() && text.chars().count() <= 500).then(|| text.to_owned())
}

/// Codeforces: все BEFORE, без ограничения виджета новостей в пять строк.
pub fn parse_codeforces(bytes: &[u8]) -> Result<Vec<Candidate>> {
    let root = json(bytes)?;
    if root["status"] != "OK" {
        return Err(upstream("Codeforces: не удалось получить соревнования"));
    }
    let rows = root["result"]
        .as_array()
        .ok_or_else(|| upstream("Codeforces: нет списка"))?;
    Ok(rows.iter().filter_map(codeforces_row).collect())
}

fn codeforces_row(row: &Value) -> Option<Candidate> {
    if row["phase"] != "BEFORE" {
        return None;
    }
    let id = row["id"].as_u64().filter(|id| *id > 0)?;
    let starts_at = OffsetDateTime::from_unix_timestamp(row["startTimeSeconds"].as_i64()?).ok()?;
    let duration = row["durationSeconds"].as_i64().filter(|n| *n > 0)?;
    let ends_at = starts_at.checked_add(time::Duration::seconds(duration))?;
    Some(Candidate {
        source: "codeforces".into(),
        external_id: id.to_string(),
        kind: "contest".into(),
        title: title(row, "name")?,
        subject: "программирование".into(),
        stage: String::new(),
        grades: String::new(),
        registration_until: None,
        starts_at,
        ends_at,
        place: "Онлайн".into(),
        url: format!("https://codeforces.com/contests/{id}"),
        tags: vec!["программирование".into()],
    })
}

fn month(text: &str, english: bool) -> Option<Month> {
    let names = if english {
        [
            "jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
        ]
    } else {
        [
            "январ",
            "феврал",
            "март",
            "апрел",
            "ма",
            "июн",
            "июл",
            "август",
            "сентябр",
            "октябр",
            "ноябр",
            "декабр",
        ]
    };
    let lower = text.to_lowercase();
    let index = names.iter().position(|name| lower.starts_with(*name))?;
    Month::try_from(u8::try_from(index + 1).ok()?).ok()
}

#[derive(Clone, Copy)]
struct PartialDate {
    day: u8,
    month: Option<Month>,
    year: Option<i32>,
}

fn partial(text: &str, english: bool) -> Option<PartialDate> {
    let text = text.trim().trim_end_matches("включительно").trim();
    let words: Vec<_> = text.split_whitespace().collect();
    let (day, month, year) = match words.as_slice() {
        [day] => (day.parse().ok()?, None, None),
        [day, year] if english && day.starts_with(|c: char| c.is_ascii_digit()) => (
            day.trim_end_matches(',').parse().ok()?,
            None,
            Some(year.parse().ok()?),
        ),
        [a, b] if english => (
            b.trim_end_matches(',').parse().ok()?,
            Some(month(a, true)?),
            None,
        ),
        [a, b, year] if english => (
            b.trim_end_matches(',').parse().ok()?,
            Some(month(a, true)?),
            Some(year.parse().ok()?),
        ),
        [day, name] => (day.parse().ok()?, Some(month(name, false)?), None),
        [day, name, year] => (
            day.parse().ok()?,
            Some(month(name, false)?),
            Some(year.parse().ok()?),
        ),
        _ => return None,
    };
    Some(PartialDate { day, month, year })
}

/// Даты без часов: Кодолимп — московские календарные дни, Devpost — UTC.
/// Конец включительно до 23:59:59. Неоднозначные «до», «4 или 5» пропускаем.
fn dates(
    text: &str,
    context: Option<(Month, i32)>,
    english: bool,
) -> Option<(OffsetDateTime, OffsetDateTime)> {
    let normalized = text.replace(['–', '—'], "-");
    let pieces: Vec<_> = normalized.split('-').collect();
    let (left, right) = match pieces.as_slice() {
        [one] => (*one, *one),
        [left, right] => (*left, *right),
        _ => return None,
    };
    let first = partial(left, english)?;
    let last = partial(right, english)?;
    let first_month = first.month.or(last.month).or(context.map(|c| c.0))?;
    let last_month = last.month.or(first.month).or(context.map(|c| c.0))?;
    let last_year = last.year.or(first.year).or(context.map(|c| c.1))?;
    let first_year = match first.year {
        Some(year) => year,
        None if u8::from(first_month) > u8::from(last_month) => last_year.checked_sub(1)?,
        None => last_year,
    };
    let start = Date::from_calendar_date(first_year, first_month, first.day).ok()?;
    let end = Date::from_calendar_date(last_year, last_month, last.day).ok()?;
    if end < start {
        return None;
    }
    let offset = if english {
        UtcOffset::UTC
    } else {
        UtcOffset::from_hms(3, 0, 0).ok()?
    };
    Some((
        start.with_time(Time::MIDNIGHT).assume_offset(offset),
        end.with_hms(23, 59, 59).ok()?.assume_offset(offset),
    ))
}

/// Devpost: открытые онлайн-хакатоны, без закрытых приглашений и очных.
pub fn parse_devpost(bytes: &[u8]) -> Result<Vec<Candidate>> {
    devpost_items(&json(bytes)?)
}

fn devpost_items(root: &Value) -> Result<Vec<Candidate>> {
    let rows = root["hackathons"]
        .as_array()
        .ok_or_else(|| upstream("Devpost: нет списка"))?;
    Ok(rows.iter().filter_map(devpost_row).collect())
}

fn devpost_row(row: &Value) -> Option<Candidate> {
    if row["invite_only"].as_bool()? || !matches!(row["open_state"].as_str()?, "open" | "upcoming")
    {
        return None;
    }
    if !row["displayed_location"]["location"]
        .as_str()?
        .eq_ignore_ascii_case("online")
    {
        return None;
    }
    let id = row["id"].as_u64().filter(|id| *id > 0)?;
    let (starts_at, ends_at) = dates(row["submission_period_dates"].as_str()?, None, true)?;
    Some(Candidate {
        source: "devpost".into(),
        external_id: id.to_string(),
        kind: "hackathon".into(),
        title: title(row, "title")?,
        subject: String::new(),
        stage: String::new(),
        grades: String::new(),
        // submission_period_dates — срок сдачи проекта, не регистрации.
        registration_until: None,
        starts_at,
        ends_at,
        place: "Онлайн".into(),
        url: https(row["url"].as_str()?)?,
        tags: row["themes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|theme| title(theme, "name"))
            .collect(),
    })
}

struct Element<'a> {
    attrs: &'a str,
    body: &'a str,
}

/// Небольшой разбор сохранённого HTML без зависимостей: учитываем вложенные
/// одноимённые теги (details/span), пробелы, одинарные/двойные кавычки.
fn elements<'a>(html: &'a str, name: &str) -> Vec<Element<'a>> {
    let open = format!("<{name}");
    let close = format!("</{name}>");
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(at) = html[from..].find(&open).map(|at| at + from) {
        from = at + open.len();
        if !html[from..].starts_with(|c: char| c == '>' || c.is_ascii_whitespace()) {
            continue;
        }
        let Some(end) = html[from..].find('>').map(|end| end + from) else {
            break;
        };
        let mut depth = 1;
        let mut cursor = end + 1;
        while depth > 0 {
            let Some(next_close) = html[cursor..].find(&close).map(|n| n + cursor) else {
                break;
            };
            let next_open = html[cursor..].find(&open).map(|n| n + cursor);
            if let Some(next_open) = next_open.filter(|n| *n < next_close) {
                let after = next_open + open.len();
                if html[after..].starts_with(|c: char| c == '>' || c.is_ascii_whitespace()) {
                    depth += 1;
                }
                cursor = after;
            } else {
                depth -= 1;
                if depth == 0 {
                    out.push(Element {
                        attrs: &html[from..end],
                        body: &html[end + 1..next_close],
                    });
                }
                cursor = next_close + close.len();
            }
        }
    }
    out
}

fn attr<'a>(attrs: &'a str, wanted: &str) -> Option<&'a str> {
    let mut rest = attrs.trim();
    while !rest.is_empty() {
        let end = rest
            .find(|c: char| c == '=' || c.is_ascii_whitespace())
            .unwrap_or(rest.len());
        let key = &rest[..end];
        rest = rest[end..].trim_start();
        if !rest.starts_with('=') {
            if end == 0 {
                return None;
            }
            continue;
        }
        rest = rest[1..].trim_start();
        let (value, tail) = if rest.starts_with(['\'', '"']) {
            let quote = rest.chars().next()?;
            let end = rest[1..].find(quote)? + 1;
            (&rest[1..end], &rest[end + 1..])
        } else {
            let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
            (&rest[..end], &rest[end..])
        };
        if key == wanted {
            return Some(value);
        }
        rest = tail.trim_start();
    }
    None
}

fn class(element: &Element<'_>, wanted: &str) -> bool {
    attr(element.attrs, "class").is_some_and(|s| s.split_whitespace().any(|c| c == wanted))
}

pub fn parse_codolymp(bytes: &[u8]) -> Result<Vec<Candidate>> {
    let html = std::str::from_utf8(bytes).map_err(|_| upstream("Кодолимп: не UTF-8"))?;
    let mut out = Vec::new();
    let mut found = false;
    for schedule in elements(html, "details")
        .into_iter()
        .filter(|e| class(e, "sched"))
    {
        found = true;
        let summary = elements(schedule.body, "summary")
            .first()
            .map(|e| unescape(e.body));
        let context = summary.as_deref().and_then(|s| {
            let mut words = s.split_whitespace();
            Some((month(words.next()?, false)?, words.next()?.parse().ok()?))
        });
        for row in elements(schedule.body, "li")
            .into_iter()
            .filter(|e| class(e, "sched-row"))
        {
            if let Some(item) = codolymp_row(row.body, context) {
                out.push(item);
            }
        }
    }
    if !found {
        return Err(upstream("Кодолимп: нет календаря"));
    }
    Ok(out)
}

fn codolymp_row(html: &str, context: Option<(Month, i32)>) -> Option<Candidate> {
    let title = unescape(elements(html, "strong").first()?.body);
    if title.is_empty() || title.chars().count() > 500 {
        return None;
    }
    let spans = elements(html, "span");
    let description = unescape(spans.iter().find(|e| class(e, "small"))?.body);
    if description.contains('≈') {
        return None;
    }
    let (stage, when) = description.split_once(" — ")?;
    let (starts_at, ends_at) = dates(when, context, false)?;
    let subject = spans
        .iter()
        .find(|e| class(e, "muted"))
        .map(|e| unescape(e.body).trim_matches(['(', ')']).to_owned())
        .unwrap_or_default();
    let divs = elements(html, "div");
    let details = divs.iter().find(|e| class(e, "small"))?;
    let grades = unescape(details.body).split(',').next()?.trim().to_owned();
    let links = elements(details.body, "a");
    let organizer = links.iter().find(|e| {
        attr(e.attrs, "rel").is_some_and(|s| s.split_whitespace().any(|v| v == "nofollow"))
    })?;
    let url = https(&unescape(attr(organizer.attrs, "href")?))?;
    let slug = links
        .iter()
        .filter_map(|e| attr(e.attrs, "href"))
        .find(|href| href.starts_with("/olympiads/"))?;
    // Один этап может повторяться в нескольких месяцах. Позицию строки и
    // месяц страницы не используем: они меняются при обновлении календаря.
    let external_id = format!(
        "{slug}|{title}|{subject}|{stage}|{grades}|{}",
        crate::format_date(starts_at.date())
    );
    if external_id.len() > 2000 {
        return None;
    }
    Some(Candidate {
        source: "codolymp".into(),
        external_id,
        kind: "olympiad".into(),
        title,
        tags: if subject.is_empty() {
            Vec::new()
        } else {
            vec![subject.clone()]
        },
        subject,
        stage: stage.into(),
        grades,
        registration_until: stage
            .to_lowercase()
            .starts_with("регистрация")
            .then_some(ends_at),
        starts_at,
        ends_at,
        place: String::new(),
        url,
    })
}

impl Sources {
    async fn olympiad_opportunities(&self) -> Result<Vec<Candidate>> {
        let bytes = fetch_bytes(self.http.get(format!(
            "{}/olympiads/raspisanie-2026-2027",
            self.urls.codolymp
        )))
        .await?;
        parse_codolymp(&bytes)
    }

    async fn contest_opportunities(&self) -> Result<Vec<Candidate>> {
        let bytes = fetch_bytes(
            self.http
                .get(format!("{}/api/contest.list", self.urls.contests))
                .query(&[("gym", "false")]),
        )
        .await?;
        parse_codeforces(&bytes)
    }

    async fn hackathon_opportunities(&self) -> Result<Vec<Candidate>> {
        let mut items = Vec::new();
        // Devpost отдаёт страницы; не ограничиваем сбор первой девяткой.
        for page in 1..=100_u64 {
            let root: Value = fetch_json(
                self.http
                    .get(format!("{}/api/hackathons", self.urls.devpost))
                    .query(&[("status[]", "upcoming"), ("status[]", "open")])
                    .query(&[("page", page), ("per_page", 100)]),
            )
            .await?;
            items.extend(devpost_items(&root)?);
            let count = root["hackathons"].as_array().map_or(0, Vec::len);
            let total = root["meta"]["total_count"].as_u64();
            let per_page = root["meta"]["per_page"]
                .as_u64()
                .filter(|n| *n > 0)
                .unwrap_or(100);
            if count == 0 || total.is_none_or(|total| page.saturating_mul(per_page) >= total) {
                return Ok(items);
            }
        }
        Err(upstream("Devpost: превышен предел страниц"))
    }

    /// Сеть до открытия транзакции. Каждый успешный источник сохраняется,
    /// упавший не удаляет и не сбрасывает уже известные мероприятия.
    pub async fn refresh_opportunities(&self, pool: &PgPool, account: Uuid) -> Result<Refresh> {
        // Весь обход Devpost укладывается в HTTP-таймаут сервера (30 с).
        let hackathons = tokio::time::timeout(
            std::time::Duration::from_secs(20),
            self.hackathon_opportunities(),
        );
        let (olympiads, contests, hackathons) = tokio::join!(
            self.olympiad_opportunities(),
            self.contest_opportunities(),
            hackathons
        );
        let hackathons =
            hackathons.unwrap_or_else(|_| Err(upstream("Devpost: истекло время сбора")));
        let mut report = Refresh {
            inserted: 0,
            failed_sources: Vec::new(),
        };
        for (name, result) in [
            ("codolymp", olympiads),
            ("codeforces", contests),
            ("devpost", hackathons),
        ] {
            match result {
                Ok(items) => {
                    let mut tx = pool.begin().await?;
                    for item in items {
                        report.inserted += sqlx::query(
                            "INSERT INTO opportunities (id, account_id, source, external_id, kind, title, \
                             subject, stage, grades, registration_until, starts_at, ends_at, place, url, tags) \
                             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) \
                             ON CONFLICT (account_id, source, external_id) DO NOTHING",
                        )
                        .bind(Uuid::now_v7())
                        .bind(account)
                        .bind(item.source)
                        .bind(item.external_id)
                        .bind(item.kind)
                        .bind(item.title)
                        .bind(item.subject)
                        .bind(item.stage)
                        .bind(item.grades)
                        .bind(item.registration_until)
                        .bind(item.starts_at)
                        .bind(item.ends_at)
                        .bind(item.place)
                        .bind(item.url)
                        .bind(item.tags)
                        .execute(&mut *tx)
                        .await?
                        .rows_affected();
                    }
                    tx.commit().await?;
                }
                Err(error) => {
                    tracing::warn!(source = name, %error, "возможности: источник недоступен");
                    report.failed_sources.push(name.into());
                }
            }
        }
        if report.failed_sources.len() == 3 {
            return Err(upstream("все источники возможностей недоступны"));
        }
        Ok(report)
    }
}

pub async fn list(
    pool: &PgPool,
    account: Uuid,
    status: Option<&str>,
    kind: Option<&str>,
) -> Result<Vec<Opportunity>> {
    if status.is_some_and(|s| !STATUSES.contains(&s)) || kind.is_some_and(|s| !KINDS.contains(&s)) {
        return Err(Error::Invalid(
            "неизвестный статус или вид возможности".into(),
        ));
    }
    Ok(sqlx::query_as(
        "SELECT id, account_id, source, external_id, kind, title, subject, stage, grades, \
         registration_until, starts_at, ends_at, place, url, tags, status, why, created_at, updated_at \
         FROM opportunities WHERE account_id = $1 AND ($2::text IS NULL OR status = $2) \
         AND ($3::text IS NULL OR kind = $3) \
         ORDER BY COALESCE(registration_until, starts_at), starts_at, id",
    )
    .bind(account)
    .bind(status)
    .bind(kind)
    .fetch_all(pool)
    .await?)
}
