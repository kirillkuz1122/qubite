//! «Пульт» владельца (HAR-002, этап AOS-5): Светофор, агенты, карточка с историей.
//! Решения: D-930, D-940, D-941, D-949, D-953, D-962…D-964, D-980…D-985.
//!
//! Откуда данные — только настоящие, без выдуманных чисел (D-981):
//! - **GitHub** (токен сервера, тот же снимок, что у «Работы агентов»): задачи с метками
//!   `in_progress` / `вопрос` / `review`, открытые PR и их CI;
//! - **сборщик на ПК владельца** (`scripts/pult-collect.py`) по своему токену шлёт
//!   сводку: сессии Claude Code из `~/.claude/projects/*.jsonl` (модель, контекст,
//!   токены по моделям, тёплый ли кэш) и лимиты 5ч/7д из строки состояния Claude Code.
//!
//! Нет источника — поле пустое и `sources` объясняет почему. Цена — «≈ $ по ценам API»:
//! на подписке это оценка (D-963). История агента — события, которые пишет код при
//! перемене статуса, PR и CI (0 токенов, D-941). Всё, кроме приёма сводки, — только
//! owner (остальным 404, D-949).

use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, Mutex},
    time::{Duration as StdDuration, Instant},
};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::{HeaderMap, StatusCode},
};
use qubite_objects::{NewAuditEntry, audit};
use serde::{Deserialize, Serialize};
use time::{Duration, OffsetDateTime};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody},
    harness::{self, GhIssue, LABEL_QUESTION, LABEL_REVIEW, LABEL_RUNNING},
    modules::Owner,
};

/// Сколько живёт снимок открытых PR и их CI.
const PR_TTL: StdDuration = StdDuration::from_secs(3 * 60);
/// Сколько PR проверять на CI за раз (запросов к GitHub — по одному на PR).
const PR_CHECKS_MAX: usize = 15;
/// Сессия на ПК «работает», если писала в журнал не позже стольких минут назад.
const RUNNING_MINUTES: i64 = 5;
/// Закончившая ход сессия считается «готово» сутки, потом — «тихо».
const DONE_HOURS: i64 = 24;
/// Сколько агентов отдаём в списке.
const AGENTS_MAX: usize = 40;
/// Лимит — LOW, если осталось меньше (D-953).
const LOW_PERCENT: f64 = 15.0;
/// Историю и состояния старше — забываем.
const KEEP_DAYS: i64 = 30;
/// Сборщиков у владельца — не больше.
const COLLECTORS_MAX: i64 = 10;

/// Кэш открытых PR с CI (GitHub-запросы — не чаще раза в 3 минуты).
#[derive(Default)]
pub struct Pult {
    prs: Mutex<Option<(Instant, Arc<Vec<PrInfo>>)>>,
}

#[derive(Debug, Clone)]
struct PrInfo {
    number: u64,
    url: String,
    text: String,
    ci: Option<Ci>,
    failed: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum Ci {
    Running,
    Green,
    Red,
}

// ---------------------------------------------------------------- сводка сборщика

/// Сводка сборщика с ПК (`scripts/pult-collect.py`). Версия формата — 1.
#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct Report {
    /// Версия формата, сейчас 1.
    version: u32,
    /// Имя машины, как его показывать («arch»). До 64 знаков.
    host: String,
    /// Когда собрано (часы сборщика).
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    at: OffsetDateTime,
    /// Лимиты подписки из строки состояния Claude Code; нет — `null`.
    #[serde(default)]
    limits: Option<ReportLimits>,
    /// Сессии за последние 7 дней (до 100).
    #[serde(default)]
    sessions: Vec<ReportSession>,
    /// Расход по дням (до 8), дата — по часам машины.
    #[serde(default)]
    days: Vec<ReportDay>,
    /// Имена навыков (до 100) — для карты.
    #[serde(default)]
    skills: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ReportLimits {
    /// Когда Claude Code сообщил эти числа.
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    at: OffsetDateTime,
    #[serde(default)]
    five_hour: Option<ReportWindow>,
    #[serde(default)]
    seven_day: Option<ReportWindow>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ReportWindow {
    /// Сколько процентов окна израсходовано, 0…100.
    used: f64,
    /// Когда окно сбросится.
    #[serde(default, with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    resets_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ReportSession {
    /// Номер сессии Claude Code.
    id: String,
    /// Название: своё имя сессии или начало первого запроса (до 120 знаков).
    #[serde(default)]
    title: String,
    /// Папка проекта (последняя часть пути).
    #[serde(default)]
    project: String,
    #[serde(default)]
    branch: String,
    /// Модель последнего ответа (`claude-opus-5-5`).
    #[serde(default)]
    model: String,
    #[serde(default)]
    effort: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    started_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    last_at: OffsetDateTime,
    /// Последний ход закончен — сессия ждёт человека.
    #[serde(default)]
    waiting: bool,
    /// Сколько токенов в контексте сейчас (вход последнего запроса с кэшем).
    #[serde(default)]
    context_tokens: u64,
    /// Время жизни кэша последнего запроса: 300 или 3600 секунд.
    #[serde(default)]
    cache_ttl_s: u32,
    /// Токены по моделям за всю сессию.
    #[serde(default)]
    usage: Vec<Usage>,
}

#[derive(Debug, Clone, Serialize, Deserialize, ToSchema)]
pub struct ReportDay {
    /// `ГГГГ-ММ-ДД`.
    date: String,
    #[serde(default)]
    usage: Vec<Usage>,
}

/// Токены одной модели.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ToSchema)]
pub struct Usage {
    model: String,
    #[serde(default)]
    input: u64,
    #[serde(default)]
    output: u64,
    #[serde(default)]
    cache_read: u64,
    #[serde(default)]
    cache_write_5m: u64,
    #[serde(default)]
    cache_write_1h: u64,
}

impl Usage {
    fn tokens(&self) -> u64 {
        self.input
            .saturating_add(self.output)
            .saturating_add(self.cache_read)
            .saturating_add(self.cache_write_5m)
            .saturating_add(self.cache_write_1h)
    }

    /// ≈ $ по ценам API; модель неизвестна — `None` (не выдумываем).
    fn usd(&self) -> Option<f64> {
        let p = price(&self.model)?;
        let m = 1_000_000.0;
        Some(
            (self.input as f64 * p.input
                + self.output as f64 * p.output
                + self.cache_read as f64 * p.read
                + self.cache_write_5m as f64 * p.input * 1.25
                + self.cache_write_1h as f64 * p.input * 2.0)
                / m,
        )
    }

    /// Сколько сэкономил кэш: чтение из кэша вместо полного входа.
    fn saved(&self) -> Option<f64> {
        let p = price(&self.model)?;
        Some(self.cache_read as f64 * (p.input - p.read) / 1_000_000.0)
    }
}

/// Сумма токенов и ≈ $ (если хоть одна модель известна).
fn total(usage: &[Usage]) -> (u64, Option<f64>) {
    let tokens = usage.iter().map(Usage::tokens).sum();
    let usd = usage.iter().filter_map(Usage::usd).reduce(|a, b| a + b);
    (tokens, usd)
}

struct Price {
    input: f64,
    output: f64,
    read: f64,
}

/// Цены API за 1 млн токенов (справка Anthropic, ноябрь 2026). Запись кэша — 1,25× входа
/// на 5 минут и 2× на час. Неизвестная модель — `None`.
fn price(model: &str) -> Option<Price> {
    let m = model.trim().split('[').next().unwrap_or_default();
    let p = |input: f64, output: f64, read: f64| {
        Some(Price {
            input,
            output,
            read,
        })
    };
    // длинные префиксы раньше коротких: `opus-5-5` раньше `opus-5`
    if m.starts_with("claude-fable-5-2") || m.starts_with("claude-mythos-5-2") {
        p(8.0, 40.0, 0.2)
    } else if m.starts_with("claude-fable-5") || m.starts_with("claude-mythos-5") {
        p(10.0, 50.0, 1.0)
    } else if m.starts_with("claude-opus-5-5") {
        p(4.0, 20.0, 0.2)
    } else if m.starts_with("claude-opus-5") || m.starts_with("claude-opus-4") {
        p(5.0, 25.0, 0.5)
    } else if m.starts_with("claude-sonnet-5-5") {
        p(2.0, 10.0, 0.1)
    } else if m.starts_with("claude-sonnet-5") {
        p(2.0, 10.0, 0.2)
    } else if m.starts_with("claude-sonnet-4") {
        p(3.0, 15.0, 0.3)
    } else if m.starts_with("claude-haiku-5-5") {
        p(0.1, 0.5, 0.01)
    } else if m.starts_with("claude-haiku-4") {
        p(1.0, 5.0, 0.1)
    } else {
        None
    }
}

/// `claude-opus-5-5` → «Opus 5.5»; незнакомое — как есть.
fn model_name(model: &str) -> String {
    let m = model.trim().split('[').next().unwrap_or_default();
    let Some(rest) = m.strip_prefix("claude-") else {
        return m.to_owned();
    };
    let mut parts = rest.split('-');
    let Some(family) = parts.next() else {
        return m.to_owned();
    };
    let version: Vec<&str> = parts
        .take_while(|p| p.len() <= 2 && p.chars().all(|c| c.is_ascii_digit()))
        .collect();
    let mut name: String = family
        .chars()
        .enumerate()
        .map(|(i, c)| if i == 0 { c.to_ascii_uppercase() } else { c })
        .collect();
    if !version.is_empty() {
        name.push(' ');
        name.push_str(&version.join("."));
    }
    name
}

/// Окно контекста модели: у Haiku 4.5 — 200 тыс., у остальных нынешних — 1 млн.
fn context_window(model: &str) -> u64 {
    if model.starts_with("claude-haiku-4") {
        200_000
    } else {
        1_000_000
    }
}

impl Report {
    /// Обрезать всё, что длиннее разумного: сводка приходит снаружи.
    fn tidy(mut self) -> Result<Self, ApiError> {
        let bad = |what: &str| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "invalid_report",
                format!("Сводка не подходит: {what}"),
            )
        };
        if self.version != 1 {
            return Err(bad("версия формата не 1"));
        }
        if self.sessions.len() > 100 || self.days.len() > 8 || self.skills.len() > 100 {
            return Err(bad("слишком длинные списки"));
        }
        self.host = harness::clip(self.host.trim(), 64);
        for s in &mut self.sessions {
            s.id = harness::clip(&s.id, 64);
            s.title = harness::clip(s.title.trim(), 120);
            s.project = harness::clip(&s.project, 60);
            s.branch = harness::clip(&s.branch, 80);
            s.model = harness::clip(&s.model, 60);
            s.effort = harness::clip(&s.effort, 12);
            s.usage.truncate(8);
        }
        for d in &mut self.days {
            d.date = harness::clip(&d.date, 10);
            d.usage.truncate(8);
        }
        for s in &mut self.skills {
            *s = harness::clip(s, 40);
        }
        if let Some(l) = &mut self.limits {
            for w in [&mut l.five_hour, &mut l.seven_day].into_iter().flatten() {
                if !w.used.is_finite() {
                    return Err(bad("процент лимита не число"));
                }
                w.used = w.used.clamp(0.0, 100.0);
            }
        }
        Ok(self)
    }
}

// ---------------------------------------------------------------- ответ

/// Окно лимита на Светофоре.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultWindow {
    /// Сколько процентов осталось.
    left: f64,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    resets_at: Option<OffsetDateTime>,
    /// Осталось меньше 15% (D-953).
    low: bool,
    /// При нынешнем темпе кончится раньше сброса — примерно тогда.
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    runs_out_at: Option<OffsetDateTime>,
}

/// Лимиты подписки. Нет данных — оба окна `null`.
#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct PultLimits {
    five_hour: Option<PultWindow>,
    seven_day: Option<PultWindow>,
    /// Когда Claude Code сообщил эти числа.
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    at: Option<OffsetDateTime>,
    /// С какой машины.
    host: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, ToSchema)]
pub struct PultCounts {
    running: u32,
    waiting: u32,
    done: u32,
}

/// Решение, которого ждёт агент (вопрос в issue).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultWaiting {
    /// Ключ агента — открыть карточку.
    key: String,
    /// Номер issue — ответить кнопкой (`/api/owner/work/questions/{n}/answer`).
    number: u64,
    title: String,
    text: String,
    /// Варианты ответа, первый — рекомендация.
    options: Vec<String>,
    url: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    updated_at: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultDay {
    /// `ГГГГ-ММ-ДД`.
    date: String,
    tokens: u64,
    usd: Option<f64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultTop {
    title: String,
    tokens: u64,
}

/// Расход за 7 дней с ПК. Главное — % недельного лимита, ≈ $ мелко (D-963).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultSpend {
    days: Vec<PultDay>,
    tokens: u64,
    usd: Option<f64>,
    /// Израсходовано недельного лимита, % (из лимитов; нет — `null`).
    week_used: Option<f64>,
    top: Option<PultTop>,
    /// Сколько сэкономил кэш, ≈ $.
    cache_saved: Option<f64>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultCache {
    warm: bool,
    /// Тёплый — через сколько минут остынет.
    minutes_left: i64,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultPr {
    number: u64,
    url: String,
    ci: Option<Ci>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentStatus {
    Running,
    Waiting,
    Done,
    Idle,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum AgentPlace {
    /// Задача в GitHub (облачная сессия или менеджер).
    Cloud,
    /// Сессия Claude Code на машине владельца.
    Pc,
}

/// Агент в списке: задача из GitHub и/или сессия с ПК.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultAgent {
    /// `gh-245` или `pc-<сессия>`.
    key: String,
    title: String,
    status: AgentStatus,
    place: AgentPlace,
    /// «Opus 5.5».
    model: Option<String>,
    effort: Option<String>,
    /// Сколько минут идёт.
    minutes: Option<i64>,
    /// Заполненность контекста, %.
    context: Option<f64>,
    tokens: Option<u64>,
    usd: Option<f64>,
    cache: Option<PultCache>,
    pr: Option<PultPr>,
    /// Issue в GitHub.
    url: Option<String>,
    /// Что делает: начало описания задачи или «проект · ветка».
    task: Option<String>,
    /// Где: «облако», «ПК arch».
    source: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    updated_at: OffsetDateTime,
}

/// Источник данных и его состояние — чтобы «нет данных» было честным и понятным.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultSource {
    /// `github` или `pc`.
    id: String,
    name: String,
    ok: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    at: Option<OffsetDateTime>,
    note: String,
}

/// Светофор целиком.
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultBoard {
    limits: PultLimits,
    counts: PultCounts,
    waiting: Vec<PultWaiting>,
    spend: Option<PultSpend>,
    agents: Vec<PultAgent>,
    skills: Vec<String>,
    sources: Vec<PultSource>,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    now: OffsetDateTime,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultEvent {
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    at: OffsetDateTime,
    /// `start`, `pr`, `ci_red`, `ci_green`, `wait`, `done`, `info`.
    kind: String,
    text: String,
}

/// Карточка агента: он сам и история событий (новые сверху — нет, по времени).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct PultAgentCard {
    agent: PultAgent,
    events: Vec<PultEvent>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct PultQuery {
    /// Перечитать GitHub, если снимку больше 20 секунд.
    #[serde(default)]
    fresh: bool,
}

// ---------------------------------------------------------------- сбор

/// Всё прочитанное для одного ответа.
struct Gathered {
    issues: Option<Arc<harness::Snapshot>>,
    github_error: Option<String>,
    prs: Arc<Vec<PrInfo>>,
    reports: Vec<(String, OffsetDateTime, Report)>,
    collectors: i64,
}

async fn gather(state: &AppState, fresh: bool) -> Result<Gathered, ApiError> {
    let work = &state.work;
    let (issues, prs, github_error) = if work.configured() {
        match work.snapshot(fresh).await {
            Ok(snap) => {
                let prs = state.pult.prs(work, fresh).await.unwrap_or_else(|e| {
                    tracing::warn!(error = %e.message, "PR для Пульта не прочитаны");
                    Arc::new(Vec::new())
                });
                (Some(snap), prs, None)
            }
            Err(e) => (None, Arc::new(Vec::new()), Some(e.message.clone())),
        }
    } else {
        (None, Arc::new(Vec::new()), None)
    };
    let pool = state.db.pool();
    let rows: Vec<(String, OffsetDateTime, serde_json::Value)> = sqlx::query_as(
        "SELECT c.name, r.received_at, r.body FROM pult_reports r \
         JOIN pult_collectors c ON c.id = r.collector_id ORDER BY r.received_at DESC",
    )
    .fetch_all(pool)
    .await
    .map_err(db)?;
    let reports = rows
        .into_iter()
        .filter_map(|(name, at, body)| {
            serde_json::from_value::<Report>(body)
                .ok()
                .map(|r| (name, at, r))
        })
        .collect();
    let collectors: i64 = sqlx::query_scalar("SELECT count(*) FROM pult_collectors")
        .fetch_one(pool)
        .await
        .map_err(db)?;
    Ok(Gathered {
        issues,
        github_error,
        prs,
        reports,
        collectors,
    })
}

fn db(e: sqlx::Error) -> ApiError {
    ApiError::from(qubite_auth::Error::Db(e))
}

impl Pult {
    async fn prs(&self, work: &harness::Work, fresh: bool) -> Result<Arc<Vec<PrInfo>>, ApiError> {
        let keep = if fresh {
            StdDuration::from_secs(20)
        } else {
            PR_TTL
        };
        if let Some((at, prs)) = self.prs.lock().expect("кэш PR").as_ref()
            && at.elapsed() < keep
        {
            return Ok(prs.clone());
        }
        #[derive(Deserialize)]
        struct Head {
            sha: String,
        }
        #[derive(Deserialize)]
        struct Pull {
            number: u64,
            html_url: String,
            title: String,
            #[serde(default)]
            body: Option<String>,
            head: Head,
        }
        #[derive(Deserialize)]
        struct Run {
            name: String,
            status: String,
            #[serde(default)]
            conclusion: Option<String>,
        }
        #[derive(Deserialize)]
        struct Runs {
            check_runs: Vec<Run>,
        }
        let pulls: Vec<Pull> = work
            .send(work.request(
                reqwest::Method::GET,
                work.url("/pulls?state=open&per_page=50"),
            ))
            .await?;
        let mut out = Vec::with_capacity(pulls.len());
        for (i, pull) in pulls.into_iter().enumerate() {
            let (ci, failed) = if i < PR_CHECKS_MAX {
                let runs: Runs = work
                    .send(work.request(
                        reqwest::Method::GET,
                        work.url(&format!(
                            "/commits/{}/check-runs?per_page=100",
                            harness::clip(&pull.head.sha, 64)
                        )),
                    ))
                    .await?;
                let failed: Vec<String> = runs
                    .check_runs
                    .iter()
                    .filter(|r| {
                        r.status == "completed"
                            && !matches!(
                                r.conclusion.as_deref(),
                                Some("success" | "skipped" | "neutral")
                            )
                    })
                    .map(|r| harness::clip(&r.name, 40))
                    .collect();
                let ci = if runs.check_runs.is_empty() {
                    None
                } else if runs.check_runs.iter().any(|r| r.status != "completed") {
                    Some(Ci::Running)
                } else if failed.is_empty() {
                    Some(Ci::Green)
                } else {
                    Some(Ci::Red)
                };
                (ci, failed)
            } else {
                (None, Vec::new())
            };
            out.push(PrInfo {
                number: pull.number,
                url: pull.html_url,
                text: format!("{}\n{}", pull.title, pull.body.unwrap_or_default()),
                ci,
                failed,
            });
        }
        let prs = Arc::new(out);
        *self.prs.lock().expect("кэш PR") = Some((Instant::now(), prs.clone()));
        Ok(prs)
    }
}

// ---------------------------------------------------------------- расчёт

fn window(
    w: &ReportWindow,
    length: Duration,
    at: OffsetDateTime,
    now: OffsetDateTime,
) -> Option<PultWindow> {
    // окно уже сбросилось — старое число неправда, а нового нет
    if w.resets_at.is_some_and(|r| r <= now) {
        return None;
    }
    let left = (100.0 - w.used).clamp(0.0, 100.0);
    let runs_out_at = w.resets_at.and_then(|resets| {
        let start = resets - length;
        let elapsed = (at - start).as_seconds_f64();
        if w.used <= 0.0 || elapsed < 600.0 {
            return None;
        }
        let full = start + Duration::seconds_f64(elapsed * 100.0 / w.used);
        (full < resets).then_some(full)
    });
    Some(PultWindow {
        left: (left * 10.0).round() / 10.0,
        resets_at: w.resets_at,
        low: left < LOW_PERCENT,
        runs_out_at,
    })
}

fn limits(reports: &[(String, OffsetDateTime, Report)], now: OffsetDateTime) -> PultLimits {
    // самые свежие лимиты среди сборщиков
    let Some((report, l)) = reports
        .iter()
        .filter_map(|(_, _, r)| r.limits.as_ref().map(|l| (r, l)))
        .max_by_key(|(_, l)| l.at)
    else {
        return PultLimits::default();
    };
    PultLimits {
        five_hour: l
            .five_hour
            .as_ref()
            .and_then(|w| window(w, Duration::hours(5), l.at, now)),
        seven_day: l
            .seven_day
            .as_ref()
            .and_then(|w| window(w, Duration::days(7), l.at, now)),
        at: Some(l.at),
        host: Some(report.host.clone()),
    }
}

/// ID задачи из ветки `task/HAR-002` или `task/AOS-5`.
fn task_id(branch: &str) -> Option<&str> {
    let id = branch.strip_prefix("task/")?;
    (!id.is_empty()).then_some(id)
}

/// Заголовок issue начинается с ID задачи («HAR-002 — …»).
fn title_has_id(title: &str, id: &str) -> bool {
    title
        .split([' ', ':', '(', '—'])
        .next()
        .is_some_and(|first| first.eq_ignore_ascii_case(id))
}

fn pc_status(s: &ReportSession, now: OffsetDateTime) -> AgentStatus {
    let age = now - s.last_at;
    if !s.waiting && age < Duration::minutes(RUNNING_MINUTES) {
        AgentStatus::Running
    } else if s.waiting && age < Duration::hours(DONE_HOURS) {
        AgentStatus::Done
    } else {
        AgentStatus::Idle
    }
}

/// Поля агента, которые знает только ПК.
fn fill_from_pc(agent: &mut PultAgent, s: &ReportSession, host: &str, now: OffsetDateTime) {
    let (tokens, usd) = total(&s.usage);
    agent.model = (!s.model.is_empty()).then(|| model_name(&s.model));
    agent.effort = (!s.effort.is_empty()).then(|| s.effort.clone());
    agent.minutes = Some((s.last_at - s.started_at).whole_minutes().max(0));
    agent.context = (s.context_tokens > 0).then(|| {
        let pct = s.context_tokens as f64 * 100.0 / context_window(&s.model) as f64;
        (pct.min(100.0) * 10.0).round() / 10.0
    });
    agent.tokens = Some(tokens);
    agent.usd = usd;
    let ttl = i64::from(if s.cache_ttl_s == 0 {
        300
    } else {
        s.cache_ttl_s
    });
    let age = (now - s.last_at).whole_seconds();
    agent.cache = Some(PultCache {
        warm: age < ttl,
        minutes_left: ((ttl - age).max(0) + 59) / 60,
    });
    agent.source = if agent.place == AgentPlace::Pc {
        format!("ПК {host}")
    } else {
        format!("облако · ПК {host}")
    };
    agent.updated_at = agent.updated_at.max(s.last_at);
}

fn pr_for(number: u64, prs: &[PrInfo]) -> Option<PultPr> {
    prs.iter()
        .find(|pr| harness::mentions_in(&pr.text, number))
        .map(|pr| PultPr {
            number: pr.number,
            url: pr.url.clone(),
            ci: pr.ci,
        })
}

/// Первый абзац описания задачи без Markdown-заголовков.
fn first_paragraph(body: &str) -> Option<String> {
    let text: Vec<&str> = body
        .lines()
        .map(str::trim)
        .skip_while(|l| l.is_empty() || l.starts_with('#'))
        .take_while(|l| !l.is_empty())
        .collect();
    (!text.is_empty()).then(|| harness::clip(&text.join(" "), 300))
}

fn agents(g: &Gathered, now: OffsetDateTime) -> (Vec<PultAgent>, Vec<PultWaiting>) {
    let mut out = Vec::new();
    let mut waiting = Vec::new();
    let mut used_sessions = std::collections::HashSet::new();
    let sessions: Vec<(&str, &ReportSession)> = g
        .reports
        .iter()
        .flat_map(|(_, _, r)| r.sessions.iter().map(move |s| (r.host.as_str(), s)))
        .collect();
    if let Some(snap) = &g.issues {
        for issue in snap.issues.iter().filter(|i| !i.is_pr()) {
            let status = if issue.has(LABEL_QUESTION) {
                AgentStatus::Waiting
            } else if issue.has(LABEL_REVIEW) {
                AgentStatus::Done
            } else if issue.has(LABEL_RUNNING) {
                AgentStatus::Running
            } else {
                continue;
            };
            let mut agent = gh_agent(issue, status, &g.prs);
            // сессия с ПК в ветке этой задачи — её модель, контекст и цена
            if let Some((host, s)) = sessions
                .iter()
                .filter(|(_, s)| {
                    task_id(&s.branch).is_some_and(|id| title_has_id(&issue.title, id))
                })
                .max_by_key(|(_, s)| s.last_at)
            {
                fill_from_pc(&mut agent, s, host, now);
                used_sessions.insert(s.id.as_str());
            }
            if status == AgentStatus::Waiting {
                let (text, options) =
                    harness::parse_question(issue.body.as_deref().unwrap_or_default());
                waiting.push(PultWaiting {
                    key: agent.key.clone(),
                    number: issue.number,
                    title: issue.title.clone(),
                    text,
                    options,
                    url: issue.html_url.clone(),
                    updated_at: issue.updated_at,
                });
            }
            out.push(agent);
        }
    }
    for (host, s) in sessions {
        if used_sessions.contains(s.id.as_str()) {
            continue;
        }
        let status = pc_status(s, now);
        if status == AgentStatus::Idle && now - s.last_at > Duration::hours(DONE_HOURS) {
            continue;
        }
        let title = if s.title.is_empty() {
            format!("{} · {}", s.project, s.branch)
        } else {
            s.title.clone()
        };
        let mut agent = PultAgent {
            key: format!("pc-{}", s.id),
            title,
            status,
            place: AgentPlace::Pc,
            model: None,
            effort: None,
            minutes: None,
            context: None,
            tokens: None,
            usd: None,
            cache: None,
            pr: None,
            url: None,
            task: Some(
                [s.project.as_str(), s.branch.as_str()]
                    .iter()
                    .filter(|p| !p.is_empty())
                    .copied()
                    .collect::<Vec<_>>()
                    .join(" · "),
            )
            .filter(|t| !t.is_empty()),
            source: String::new(),
            updated_at: s.last_at,
        };
        fill_from_pc(&mut agent, s, host, now);
        out.push(agent);
    }
    let rank = |s: AgentStatus| match s {
        AgentStatus::Waiting => 0,
        AgentStatus::Running => 1,
        AgentStatus::Done => 2,
        AgentStatus::Idle => 3,
    };
    out.sort_by(|a, b| {
        rank(a.status)
            .cmp(&rank(b.status))
            .then(b.updated_at.cmp(&a.updated_at))
    });
    out.truncate(AGENTS_MAX);
    waiting.sort_by_key(|w| std::cmp::Reverse(w.updated_at));
    (out, waiting)
}

fn gh_agent(issue: &GhIssue, status: AgentStatus, prs: &[PrInfo]) -> PultAgent {
    PultAgent {
        key: format!("gh-{}", issue.number),
        title: issue.title.clone(),
        status,
        place: AgentPlace::Cloud,
        model: None,
        effort: None,
        minutes: None,
        context: None,
        tokens: None,
        usd: None,
        cache: None,
        pr: pr_for(issue.number, prs),
        url: Some(issue.html_url.clone()),
        task: first_paragraph(issue.body.as_deref().unwrap_or_default()),
        source: "облако".into(),
        updated_at: issue.updated_at,
    }
}

fn spend(g: &Gathered, limits: &PultLimits) -> Option<PultSpend> {
    if g.reports.is_empty() {
        return None;
    }
    let mut by_day: BTreeMap<String, Vec<Usage>> = BTreeMap::new();
    for (_, _, r) in &g.reports {
        for d in &r.days {
            by_day
                .entry(d.date.clone())
                .or_default()
                .extend(d.usage.iter().cloned());
        }
    }
    let days: Vec<PultDay> = by_day
        .iter()
        .rev()
        .take(7)
        .rev()
        .map(|(date, usage)| {
            let (tokens, usd) = total(usage);
            PultDay {
                date: date.clone(),
                tokens,
                usd,
            }
        })
        .collect();
    let all: Vec<Usage> = by_day
        .iter()
        .rev()
        .take(7)
        .flat_map(|(_, u)| u.iter().cloned())
        .collect();
    let (tokens, usd) = total(&all);
    let cache_saved = all.iter().filter_map(Usage::saved).reduce(|a, b| a + b);
    // больше всего — по задаче (ветке) или сессии
    let mut per: HashMap<String, u64> = HashMap::new();
    for (_, _, r) in &g.reports {
        for s in &r.sessions {
            let name = task_id(&s.branch).map(str::to_owned).unwrap_or_else(|| {
                if s.title.is_empty() {
                    s.project.clone()
                } else {
                    s.title.clone()
                }
            });
            *per.entry(name).or_default() += total(&s.usage).0;
        }
    }
    let top = per
        .into_iter()
        .filter(|(_, t)| *t > 0)
        .max_by_key(|(_, t)| *t)
        .map(|(title, tokens)| PultTop {
            title: harness::clip(&title, 60),
            tokens,
        });
    Some(PultSpend {
        days,
        tokens,
        usd,
        week_used: limits
            .seven_day
            .as_ref()
            .map(|w| ((100.0 - w.left) * 10.0).round() / 10.0),
        top,
        cache_saved,
    })
}

fn sources(g: &Gathered, configured: bool, now: OffsetDateTime) -> Vec<PultSource> {
    let mut out = vec![PultSource {
        id: "github".into(),
        name: "GitHub".into(),
        ok: g.issues.is_some(),
        at: g.issues.as_ref().map(|s| s.at),
        note: if !configured {
            "на сервере нет токена GitHub — задачи и PR не видны".into()
        } else if let Some(e) = &g.github_error {
            e.clone()
        } else {
            "задачи, вопросы, PR и CI".into()
        },
    }];
    if g.reports.is_empty() {
        out.push(PultSource {
            id: "pc".into(),
            name: "ПК".into(),
            ok: false,
            at: None,
            note: if g.collectors == 0 {
                "сборщик не подключён — лимиты, модели и расход не видны".into()
            } else {
                "сборщик подключён, но ещё ничего не прислал".into()
            },
        });
    }
    for (name, at, r) in &g.reports {
        let stale = now - *at > Duration::minutes(30);
        out.push(PultSource {
            id: "pc".into(),
            name: format!("ПК {}", if r.host.is_empty() { name } else { &r.host }),
            ok: !stale,
            at: Some(*at),
            note: if stale {
                "давно не присылал сводку — ПК выключен или сборщик остановлен".into()
            } else if r.limits.is_none() {
                "сессии есть, лимитов нет — подключите строку состояния (см. сборщик)".into()
            } else {
                "сессии, расход и лимиты".into()
            },
        });
    }
    out
}

fn board(state: &AppState, g: &Gathered, now: OffsetDateTime) -> PultBoard {
    let limits = limits(&g.reports, now);
    let (agents, waiting) = agents(g, now);
    let count = |s: AgentStatus| agents.iter().filter(|a| a.status == s).count() as u32;
    let mut skills: Vec<String> = g
        .reports
        .iter()
        .flat_map(|(_, _, r)| r.skills.iter().cloned())
        .collect();
    skills.sort();
    skills.dedup();
    PultBoard {
        counts: PultCounts {
            running: count(AgentStatus::Running),
            waiting: waiting.len() as u32,
            done: count(AgentStatus::Done),
        },
        spend: spend(g, &limits),
        limits,
        waiting,
        agents,
        skills,
        sources: sources(g, state.work.configured(), now),
        now,
    }
}

// ---------------------------------------------------------------- история

/// Что сервер помнит об агенте, чтобы заметить перемену.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
struct Facts {
    status: Option<AgentStatus>,
    pr: Option<u64>,
    ci: Option<Ci>,
    model: Option<String>,
}

fn facts(a: &PultAgent) -> Facts {
    Facts {
        status: Some(a.status),
        pr: a.pr.as_ref().map(|p| p.number),
        ci: a.pr.as_ref().and_then(|p| p.ci),
        model: a.model.clone(),
    }
}

/// События по разнице «было → стало». Пишет код, не агент (D-941).
fn diff(
    a: &PultAgent,
    before: Option<&Facts>,
    now: &Facts,
    failed: &[String],
) -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    let pc = a.place == AgentPlace::Pc;
    if before.and_then(|b| b.status) != now.status {
        let first = before.is_none();
        out.push(match a.status {
            AgentStatus::Running if pc && first => ("start", format!("Сессия на {}", a.source)),
            AgentStatus::Running if first => ("start", "Взял задачу".into()),
            AgentStatus::Running => ("start", "Снова в работе".into()),
            AgentStatus::Waiting => (
                "wait",
                harness::clip(&format!("Спросил тебя: {}", a.title), 200),
            ),
            AgentStatus::Done if pc => ("done", "Закончил ход — ждёт ответа".into()),
            AgentStatus::Done => ("done", "Готово — ждёт приёмки".into()),
            AgentStatus::Idle if first => ("info", format!("Сессия на {}", a.source)),
            AgentStatus::Idle => ("info", "Затих, кэш остыл".into()),
        });
    }
    if let Some(pr) = now.pr
        && before.and_then(|b| b.pr) != Some(pr)
    {
        out.push(("pr", format!("Открыл PR #{pr}")));
    }
    if now.pr.is_some() && before.and_then(|b| b.ci) != now.ci {
        match now.ci {
            Some(Ci::Red) => out.push((
                "ci_red",
                harness::clip(
                    &if failed.is_empty() {
                        "CI красный".to_owned()
                    } else {
                        format!("CI красный: {}", failed.join(", "))
                    },
                    200,
                ),
            )),
            Some(Ci::Green) => out.push(("ci_green", "CI зелёный".into())),
            _ => {}
        }
    }
    if let (Some(before), Some(model)) = (before.and_then(|b| b.model.as_ref()), now.model.as_ref())
        && before != model
    {
        out.push(("info", format!("Модель: {model}")));
    }
    out
}

/// Записать события по всем агентам. Две записи разом не пересекаются (замок в базе).
async fn record(state: &AppState, agents: &[PultAgent], prs: &[PrInfo]) -> Result<(), sqlx::Error> {
    let now = OffsetDateTime::now_utc();
    let mut tx = state.db.pool().begin().await?;
    sqlx::query("SELECT pg_advisory_xact_lock(930005)")
        .execute(&mut *tx)
        .await?;
    let keys: Vec<String> = agents.iter().map(|a| a.key.clone()).collect();
    let rows: Vec<(String, serde_json::Value)> =
        sqlx::query_as("SELECT agent, facts FROM pult_agent_state WHERE agent = ANY($1)")
            .bind(&keys)
            .fetch_all(&mut *tx)
            .await?;
    let known: HashMap<String, Facts> = rows
        .into_iter()
        .filter_map(|(k, v)| serde_json::from_value(v).ok().map(|f| (k, f)))
        .collect();
    for agent in agents {
        let current = facts(agent);
        let before = known.get(&agent.key);
        if before == Some(&current) {
            continue;
        }
        let failed = agent
            .pr
            .as_ref()
            .and_then(|p| prs.iter().find(|x| x.number == p.number))
            .map(|p| p.failed.clone())
            .unwrap_or_default();
        for (kind, text) in diff(agent, before, &current, &failed) {
            sqlx::query("INSERT INTO pult_events (agent, at, kind, text) VALUES ($1, $2, $3, $4)")
                .bind(&agent.key)
                .bind(now)
                .bind(kind)
                .bind(text)
                .execute(&mut *tx)
                .await?;
        }
        sqlx::query(
            "INSERT INTO pult_agent_state (agent, facts, seen_at) VALUES ($1, $2, $3) \
             ON CONFLICT (agent) DO UPDATE SET facts = EXCLUDED.facts, seen_at = EXCLUDED.seen_at",
        )
        .bind(&agent.key)
        .bind(serde_json::to_value(&current).unwrap_or_default())
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }
    let old = now - Duration::days(KEEP_DAYS);
    sqlx::query("DELETE FROM pult_events WHERE at < $1")
        .bind(old)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM pult_agent_state WHERE seen_at < $1")
        .bind(old)
        .execute(&mut *tx)
        .await?;
    tx.commit().await
}

/// Собрать Светофор и записать события; ошибка записи истории Светофор не ломает.
async fn refresh(state: &AppState, fresh: bool) -> Result<(PultBoard, Arc<Vec<PrInfo>>), ApiError> {
    let g = gather(state, fresh).await?;
    let now = OffsetDateTime::now_utc();
    let board = board(state, &g, now);
    if let Err(error) = record(state, &board.agents, &g.prs).await {
        tracing::warn!(%error, "история Пульта не записана");
    }
    Ok((board, g.prs))
}

// ---------------------------------------------------------------- адреса: owner

/// Светофор: лимиты, «работает · ждёт тебя · готово», что ждёт, расход, агенты.
#[utoipa::path(get, path = "/api/owner/pult", tag = "owner", params(PultQuery),
    responses(
        (status = 200, description = "Светофор Пульта", body = PultBoard),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn pult_board(
    State(state): State<AppState>,
    _owner: Owner,
    Query(query): Query<PultQuery>,
) -> Result<Json<PultBoard>, ApiError> {
    Ok(Json(refresh(&state, query.fresh).await?.0))
}

/// Карточка агента и его история (последние 50 событий).
#[utoipa::path(get, path = "/api/owner/pult/agents/{key}", tag = "owner",
    params(("key" = String, Path, description = "Ключ агента: gh-N или pc-<сессия>")),
    responses(
        (status = 200, description = "Карточка агента", body = PultAgentCard),
        (status = 404, description = "Не owner или агента нет", body = ApiErrorBody)
    ))]
pub async fn pult_agent(
    State(state): State<AppState>,
    _owner: Owner,
    Path(key): Path<String>,
) -> Result<Json<PultAgentCard>, ApiError> {
    let (board, _) = refresh(&state, false).await?;
    let Some(agent) = board.agents.into_iter().find(|a| a.key == key) else {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "agent_not_found",
            "Такого агента сейчас нет",
        ));
    };
    let rows: Vec<(OffsetDateTime, String, String)> = sqlx::query_as(
        "SELECT at, kind, text FROM (SELECT id, at, kind, text FROM pult_events \
         WHERE agent = $1 ORDER BY at DESC, id DESC LIMIT 50) e ORDER BY at, id",
    )
    .bind(&key)
    .fetch_all(state.db.pool())
    .await
    .map_err(db)?;
    Ok(Json(PultAgentCard {
        agent,
        events: rows
            .into_iter()
            .map(|(at, kind, text)| PultEvent { at, kind, text })
            .collect(),
    }))
}

/// Сборщик в списке.
#[derive(Debug, Serialize, ToSchema)]
pub struct PultCollector {
    id: Uuid,
    name: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    last_seen_at: Option<OffsetDateTime>,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct NewCollector {
    /// Как назвать машину: «ПК», «ноутбук». 1–40 знаков.
    name: String,
}

/// Новый сборщик: токен показывается один раз.
#[derive(Debug, Serialize, ToSchema)]
pub struct CollectorToken {
    id: Uuid,
    name: String,
    /// Положить в `~/.config/qubite/pult.env` как `QUBITE_PULT_TOKEN=…`. Больше не покажем.
    token: String,
}

/// Сборщики владельца.
#[utoipa::path(get, path = "/api/owner/pult/collectors", tag = "owner",
    responses(
        (status = 200, description = "Сборщики", body = Vec<PultCollector>),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn list_collectors(
    State(state): State<AppState>,
    _owner: Owner,
) -> Result<Json<Vec<PultCollector>>, ApiError> {
    let rows: Vec<(Uuid, String, OffsetDateTime, Option<OffsetDateTime>)> = sqlx::query_as(
        "SELECT id, name, created_at, last_seen_at FROM pult_collectors ORDER BY created_at",
    )
    .fetch_all(state.db.pool())
    .await
    .map_err(db)?;
    Ok(Json(
        rows.into_iter()
            .map(|(id, name, created_at, last_seen_at)| PultCollector {
                id,
                name,
                created_at,
                last_seen_at,
            })
            .collect(),
    ))
}

/// Подключить сборщик: выпустить токен (хранится только хеш).
#[utoipa::path(post, path = "/api/owner/pult/collectors", tag = "owner",
    request_body = NewCollector,
    responses(
        (status = 201, description = "Токен выпущен", body = CollectorToken),
        (status = 400, description = "Пустое имя или сборщиков уже 10", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody)
    ))]
pub async fn create_collector(
    State(state): State<AppState>,
    owner: Owner,
    Json(body): Json<NewCollector>,
) -> Result<(StatusCode, Json<CollectorToken>), ApiError> {
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > 40 {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_name",
            "Имя — от 1 до 40 знаков",
        ));
    }
    let pool = state.db.pool();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM pult_collectors")
        .fetch_one(pool)
        .await
        .map_err(db)?;
    if count >= COLLECTORS_MAX {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "too_many_collectors",
            "Сборщиков уже 10 — отключите лишний",
        ));
    }
    let id = Uuid::now_v7();
    let token = format!("qpult_{}", qubite_auth::random_token());
    sqlx::query("INSERT INTO pult_collectors (id, name, token_hash) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(name)
        .bind(qubite_auth::token_hash(&token))
        .execute(pool)
        .await
        .map_err(db)?;
    audit_owner(&state, &owner, "pult.collector_created", id, name).await?;
    Ok((
        StatusCode::CREATED,
        Json(CollectorToken {
            id,
            name: name.to_owned(),
            token,
        }),
    ))
}

/// Отключить сборщик: токен перестаёт работать, его сводка удаляется.
#[utoipa::path(delete, path = "/api/owner/pult/collectors/{id}", tag = "owner",
    params(("id" = Uuid, Path, description = "Сборщик")),
    responses(
        (status = 204, description = "Отключён"),
        (status = 404, description = "Не owner или сборщика нет", body = ApiErrorBody)
    ))]
pub async fn delete_collector(
    State(state): State<AppState>,
    owner: Owner,
    Path(id): Path<Uuid>,
) -> Result<StatusCode, ApiError> {
    let name: Option<String> =
        sqlx::query_scalar("DELETE FROM pult_collectors WHERE id = $1 RETURNING name")
            .bind(id)
            .fetch_optional(state.db.pool())
            .await
            .map_err(db)?;
    let Some(name) = name else {
        return Err(ApiError::new(
            StatusCode::NOT_FOUND,
            "collector_not_found",
            "Такого сборщика нет",
        ));
    };
    audit_owner(&state, &owner, "pult.collector_deleted", id, &name).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn audit_owner(
    state: &AppState,
    owner: &Owner,
    action: &str,
    id: Uuid,
    name: &str,
) -> Result<(), ApiError> {
    let mut conn = state.db.pool().acquire().await.map_err(db)?;
    audit::record(
        &mut conn,
        NewAuditEntry {
            actor_id: Some(owner.0.account_id()),
            action: action.into(),
            target_kind: "pult_collector".into(),
            target_id: Some(id.to_string()),
            after: Some(serde_json::json!({ "name": name })),
            ..NewAuditEntry::default()
        },
    )
    .await
    .map(drop)
    .map_err(|e| ApiError::from(qubite_auth::Error::Audit(e)))
}

// ---------------------------------------------------------------- адрес: сборщик

fn unauthorized() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "invalid_collector_token",
        "Токен сборщика не подошёл — выпустите новый в Пульте",
    )
}

/// Принять сводку сборщика (токен `Authorization: Bearer qpult_…`, не сессия).
#[utoipa::path(post, path = "/api/pult/report", tag = "pult",
    request_body = Report,
    responses(
        (status = 204, description = "Сводка принята"),
        (status = 400, description = "Сводка не подходит", body = ApiErrorBody),
        (status = 401, description = "Нет токена или он отключён", body = ApiErrorBody)
    ))]
pub async fn receive_report(
    State(state): State<AppState>,
    headers: HeaderMap,
    body: axum::body::Bytes,
) -> Result<StatusCode, ApiError> {
    let token = headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .map(str::trim)
        .filter(|t| t.starts_with("qpult_"))
        .ok_or_else(unauthorized)?;
    let pool = state.db.pool();
    let id: Option<Uuid> = sqlx::query_scalar(
        "UPDATE pult_collectors SET last_seen_at = now() WHERE token_hash = $1 RETURNING id",
    )
    .bind(qubite_auth::token_hash(token))
    .fetch_optional(pool)
    .await
    .map_err(db)?;
    let id = id.ok_or_else(unauthorized)?;
    // тело разбираем только после токена: чужой запрос не тратит сервер и получает 401
    let report: Report = serde_json::from_slice(&body).map_err(|e| {
        ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_report",
            format!("Сводка не подходит: {e}"),
        )
    })?;
    let report = report.tidy()?;
    sqlx::query(
        "INSERT INTO pult_reports (collector_id, received_at, body) VALUES ($1, now(), $2) \
         ON CONFLICT (collector_id) DO UPDATE SET received_at = now(), body = EXCLUDED.body",
    )
    .bind(id)
    .bind(serde_json::to_value(&report).unwrap_or_default())
    .execute(pool)
    .await
    .map_err(db)?;
    // история пишется и без открытого Пульта: сборщик приходит раз в минуту-две
    if let Err(e) = refresh(&state, false).await {
        tracing::warn!(error = %e.message, "Пульт не пересчитан после сводки");
    }
    Ok(StatusCode::NO_CONTENT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> OffsetDateTime {
        OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339).unwrap()
    }

    #[test]
    fn model_names_and_prices() {
        assert_eq!(model_name("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(model_name("claude-haiku-4-5-20251001"), "Haiku 4.5");
        assert_eq!(model_name("claude-fable-5-2[1m]"), "Fable 5.2");
        assert_eq!(model_name("gpt-6.1"), "gpt-6.1");
        let u = Usage {
            model: "claude-opus-5-5".into(),
            input: 1_000_000,
            output: 1_000_000,
            cache_read: 1_000_000,
            cache_write_5m: 0,
            cache_write_1h: 1_000_000,
        };
        // 4 + 20 + 0,2 + 8
        assert!((u.usd().unwrap() - 32.2).abs() < 1e-9);
        assert!((u.saved().unwrap() - 3.8).abs() < 1e-9);
        assert_eq!(u.tokens(), 4_000_000);
        let unknown = Usage {
            model: "local-llm".into(),
            output: 10,
            ..Usage::default()
        };
        assert_eq!(unknown.usd(), None);
        assert_eq!(total(&[unknown]), (10, None));
    }

    #[test]
    fn window_left_low_and_forecast() {
        let now = at("2026-11-17T12:00:00Z");
        // неделя началась 3 дня назад, израсходовано 88% — кончится раньше сброса
        let w = ReportWindow {
            used: 88.0,
            resets_at: Some(at("2026-11-21T12:00:00Z")),
        };
        let out = window(&w, Duration::days(7), now, now).unwrap();
        assert!((out.left - 12.0).abs() < 1e-9);
        assert!(out.low);
        let runs_out = out.runs_out_at.unwrap();
        assert!(runs_out > now && runs_out < at("2026-11-21T12:00:00Z"));
        // темп спокойный — прогноза нет
        let calm = ReportWindow {
            used: 20.0,
            resets_at: Some(at("2026-11-21T12:00:00Z")),
        };
        let out = window(&calm, Duration::days(7), now, now).unwrap();
        assert!(!out.low);
        assert_eq!(out.runs_out_at, None);
        // окно уже сбросилось — старому числу не верим
        let old = ReportWindow {
            used: 50.0,
            resets_at: Some(at("2026-11-17T11:00:00Z")),
        };
        assert!(window(&old, Duration::hours(5), now, now).is_none());
    }

    #[test]
    fn task_branch_matches_issue_title() {
        assert_eq!(task_id("task/HAR-002"), Some("HAR-002"));
        assert_eq!(task_id("main"), None);
        assert!(title_has_id("HAR-002 — Агентная ОС", "HAR-002"));
        assert!(title_has_id("AOS-5: Пульт", "aos-5"));
        assert!(!title_has_id("HAR-0021 — другое", "HAR-002"));
    }

    #[test]
    fn events_from_changes() {
        let agent = PultAgent {
            key: "gh-1".into(),
            title: "DS-013 — панель".into(),
            status: AgentStatus::Running,
            place: AgentPlace::Cloud,
            model: None,
            effort: None,
            minutes: None,
            context: None,
            tokens: None,
            usd: None,
            cache: None,
            pr: Some(PultPr {
                number: 247,
                url: String::new(),
                ci: Some(Ci::Red),
            }),
            url: None,
            task: None,
            source: "облако".into(),
            updated_at: OffsetDateTime::UNIX_EPOCH,
        };
        let now = facts(&agent);
        let first = diff(&agent, None, &now, &["frames.spec".into()]);
        let kinds: Vec<&str> = first.iter().map(|(k, _)| *k).collect();
        assert_eq!(kinds, ["start", "pr", "ci_red"]);
        assert_eq!(first[2].1, "CI красный: frames.spec");
        assert!(diff(&agent, Some(&now), &now, &[]).is_empty());
        let mut green = now.clone();
        green.ci = Some(Ci::Green);
        let mut fixed = agent.clone();
        fixed.pr.as_mut().unwrap().ci = Some(Ci::Green);
        let next = diff(&fixed, Some(&now), &green, &[]);
        assert_eq!(next, [("ci_green", "CI зелёный".to_owned())]);
    }

    #[test]
    fn report_is_tidied() {
        let report: Report = serde_json::from_value(serde_json::json!({
            "version": 1, "host": "x".repeat(100), "at": "2026-11-17T12:00:00Z",
            "limits": { "at": "2026-11-17T12:00:00Z", "five_hour": { "used": 140.0 } }
        }))
        .unwrap();
        let report = report.tidy().unwrap();
        assert_eq!(report.host.chars().count(), 65);
        assert_eq!(report.limits.unwrap().five_hour.unwrap().used, 100.0);
        let bad: Report = serde_json::from_value(serde_json::json!({
            "version": 2, "host": "x", "at": "2026-11-17T12:00:00Z"
        }))
        .unwrap();
        assert!(bad.tidy().is_err());
    }
}
