//! «Работа агентов» в Owner Console (HAR-002, D-643, D-650…D-659).
//!
//! Источник — GitHub Issues репозитория Qubite: сервер читает их своим токеном
//! (`QUBITE_GITHUB_TOKEN`, только на сервере — в браузер и в git не попадает)
//! и держит в памяти 3 минуты. Метки: `in_progress` — идёт, `review` — готово,
//! проверь; `вопрос` — ждёт владельца; `ready` — очередь по номеру; `лимит` —
//! расход лимита (пишет управляющая сессия). Ответ на вопрос — комментарий
//! «Ответ владельца: …» в issue и снятая метка `вопрос`: агент читает его сам.
//! Всё — только для owner (остальным 404).

use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
};
use qubite_kernel::Secret;
use qubite_objects::{NewAuditEntry, audit};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody},
    modules::Owner,
};

/// Сколько живёт снимок issues.
pub const CACHE_TTL: Duration = Duration::from_secs(3 * 60);
/// «Обновить» раньше срока — не чаще, чем раз в столько.
const FRESH_MIN: Duration = Duration::from_secs(20);
/// Метки статусов.
pub const LABEL_RUNNING: &str = "in_progress";
pub const LABEL_REVIEW: &str = "review";
pub const LABEL_QUESTION: &str = "вопрос";
pub const LABEL_QUEUE: &str = "ready";
pub const LABEL_USAGE: &str = "лимит";
/// Самый длинный ответ владельца.
const ANSWER_MAX: usize = 2000;

/// Настройки `qubite serve`: токен, репозиторий, адрес API.
#[derive(Clone, Default)]
pub struct WorkSettings {
    /// Fine-grained токен: только этот репозиторий, Issues — read/write. Пусто — раздел «не настроен».
    pub token: Option<Secret>,
    /// `владелец/репозиторий`.
    pub repo: String,
    /// `https://api.github.com` (в тестах — подставной сервер).
    pub api: String,
    pub proxy: Option<String>,
}

/// Клиент GitHub с кэшем.
pub struct Work {
    settings: WorkSettings,
    http: reqwest::Client,
    cache: Mutex<Option<(Instant, Arc<Snapshot>)>>,
}

impl Default for Work {
    fn default() -> Self {
        Self::new(WorkSettings::default())
    }
}

/// Что прочитано из GitHub за один раз.
struct Snapshot {
    at: OffsetDateTime,
    issues: Vec<GhIssue>,
    usage: Option<WorkUsage>,
}

#[derive(Debug, Clone, Deserialize)]
struct GhIssue {
    number: u64,
    title: String,
    html_url: String,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    labels: Vec<GhLabel>,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
    #[serde(default)]
    comments: u64,
    #[serde(default)]
    state: String,
    /// Есть у PR (GitHub отдаёт PR и в списке issues).
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize)]
struct GhLabel {
    name: String,
}

#[derive(Debug, Deserialize)]
struct GhComment {
    #[serde(default)]
    body: String,
    html_url: String,
    #[serde(with = "time::serde::rfc3339")]
    updated_at: OffsetDateTime,
}

impl GhIssue {
    fn has(&self, label: &str) -> bool {
        self.labels.iter().any(|l| l.name == label)
    }
    fn is_pr(&self) -> bool {
        self.pull_request.is_some()
    }
}

/// Ошибка обращения к GitHub — для владельца понятным текстом.
fn github_down(what: impl std::fmt::Display) -> ApiError {
    tracing::warn!(error = %what, "GitHub не ответил");
    ApiError::new(
        StatusCode::BAD_GATEWAY,
        "github_unavailable",
        format!("GitHub не ответил: {what}"),
    )
}

fn not_configured() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "github_not_configured",
        "GitHub не настроен: на сервере нет QUBITE_GITHUB_TOKEN",
    )
}

impl Work {
    pub fn new(settings: WorkSettings) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = qubite_net::client(settings.proxy.as_deref())
            .unwrap_or_else(|error| {
                tracing::warn!(%error, "прокси GitHub не разобран — напрямую");
                reqwest::Client::builder()
            })
            .timeout(Duration::from_secs(10))
            .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP-клиент собирается с настройками по умолчанию");
        Self {
            settings,
            http,
            cache: Mutex::new(None),
        }
    }

    fn token(&self) -> Option<&str> {
        self.settings
            .token
            .as_ref()
            .map(Secret::expose)
            .map(str::trim)
            .filter(|t| !t.is_empty())
    }

    pub fn configured(&self) -> bool {
        self.token().is_some() && valid_repo(&self.settings.repo)
    }

    fn url(&self, tail: &str) -> String {
        format!(
            "{}/repos/{}{tail}",
            self.settings.api.trim_end_matches('/'),
            self.settings.repo
        )
    }

    fn request(&self, method: reqwest::Method, url: String) -> reqwest::RequestBuilder {
        self.http
            .request(method, url)
            .bearer_auth(self.token().unwrap_or_default())
            .header("accept", "application/vnd.github+json")
            .header("x-github-api-version", "2022-11-28")
    }

    async fn send<T: serde::de::DeserializeOwned>(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<T, ApiError> {
        let response = request
            .send()
            .await
            .map_err(|e| github_down(e.without_url()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(github_down(match status.as_u16() {
                401 => "токен не подошёл (401) — выпустите новый".to_owned(),
                403 | 404 => {
                    format!("нет доступа к репозиторию ({status}) — проверьте права токена")
                }
                _ => format!("ответ {status}"),
            }));
        }
        response
            .json()
            .await
            .map_err(|e| github_down(e.without_url()))
    }

    async fn ok(&self, request: reqwest::RequestBuilder) -> Result<(), ApiError> {
        self.send::<serde_json::Value>(request).await.map(drop)
    }

    /// Снимок: из кэша, если он моложе 3 минут (или 20 секунд при «обновить»).
    async fn snapshot(&self, fresh: bool) -> Result<Arc<Snapshot>, ApiError> {
        let keep = if fresh { FRESH_MIN } else { CACHE_TTL };
        if let Some((at, snap)) = self.cache.lock().expect("кэш").as_ref()
            && at.elapsed() < keep
        {
            return Ok(snap.clone());
        }
        let snap = Arc::new(self.fetch().await?);
        *self.cache.lock().expect("кэш") = Some((Instant::now(), snap.clone()));
        Ok(snap)
    }

    fn forget(&self) {
        *self.cache.lock().expect("кэш") = None;
    }

    async fn fetch(&self) -> Result<Snapshot, ApiError> {
        let mut issues: Vec<GhIssue> = Vec::new();
        // До 300 открытых issues и PR — больше в этом репозитории не бывает.
        for page in 1..=3 {
            let url = self.url(&format!("/issues?state=open&per_page=100&page={page}"));
            let batch: Vec<GhIssue> = self.send(self.request(reqwest::Method::GET, url)).await?;
            let last = batch.len() < 100;
            issues.extend(batch);
            if last {
                break;
            }
        }
        let usage = match issues
            .iter()
            .filter(|i| !i.is_pr() && i.has(LABEL_USAGE))
            .max_by_key(|i| i.updated_at)
        {
            Some(issue) => Some(self.usage(issue).await?),
            None => None,
        };
        Ok(Snapshot {
            at: OffsetDateTime::now_utc(),
            issues,
            usage,
        })
    }

    /// Расход лимита: последний комментарий issue с меткой `лимит` (или его текст).
    async fn usage(&self, issue: &GhIssue) -> Result<WorkUsage, ApiError> {
        let mut text = issue.body.clone().unwrap_or_default();
        let mut url = issue.html_url.clone();
        let mut at = issue.updated_at;
        if issue.comments > 0 {
            let page = issue.comments.div_ceil(100);
            let comments: Vec<GhComment> = self
                .send(self.request(
                    reqwest::Method::GET,
                    self.url(&format!(
                        "/issues/{}/comments?per_page=100&page={page}",
                        issue.number
                    )),
                ))
                .await?;
            if let Some(last) = comments.into_iter().last() {
                text = last.body;
                url = last.html_url;
                at = last.updated_at;
            }
        }
        Ok(WorkUsage {
            window_percent: percent_after(&text, "окн"),
            week_percent: percent_after(&text, "недел"),
            text: clip(text.trim(), 300),
            url,
            at,
        })
    }
}

/// `владелец/репозиторий` из букв, цифр, `-`, `_`, `.`.
fn valid_repo(repo: &str) -> bool {
    let ok = |part: &str| {
        !part.is_empty()
            && part != "."
            && part != ".."
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
    };
    matches!(repo.split_once('/'), Some((owner, name)) if ok(owner) && ok(name))
}

fn clip(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        return text.to_owned();
    }
    let mut cut: String = text.chars().take(max).collect();
    cut.push('…');
    cut
}

/// Число процентов после слова: «окно 35%», «неделя: 62 %» → 35, 62.
fn percent_after(text: &str, stem: &str) -> Option<u8> {
    let lower = text.to_lowercase();
    let start = lower.rfind(stem)? + stem.len();
    let tail: String = lower[start..].chars().take(24).collect();
    let digits_at = tail.find(|c: char| c.is_ascii_digit())?;
    let rest = &tail[digits_at..];
    let digits: String = rest.chars().take_while(char::is_ascii_digit).collect();
    let after = rest[digits.len()..].trim_start();
    if !after.starts_with('%') {
        return None;
    }
    digits.parse::<u8>().ok().filter(|p| *p <= 100)
}

/// Вопрос из тела issue: текст до списка и пункты списка (первый — рекомендация).
fn parse_question(body: &str) -> (String, Vec<String>) {
    let mut text = Vec::new();
    let mut options = Vec::new();
    for line in body.lines() {
        let trimmed = line.trim();
        if let Some(option) = list_item(trimmed) {
            if !option.is_empty() && options.len() < 8 {
                options.push(clip(option, 200));
            }
        } else if options.is_empty() && !trimmed.is_empty() {
            text.push(trimmed);
        }
    }
    (clip(&text.join("\n"), 1500), options)
}

/// Пункт списка Markdown: `- …`, `* …`, `1. …`, `1) …`, с `[ ]` или без.
fn list_item(line: &str) -> Option<&str> {
    let rest = line
        .strip_prefix("- ")
        .or_else(|| line.strip_prefix("* "))
        .or_else(|| {
            let digits = line.chars().take_while(char::is_ascii_digit).count();
            (digits > 0 && digits < 3)
                .then(|| &line[digits..])
                .and_then(|r| r.strip_prefix(". ").or_else(|| r.strip_prefix(") ")))
        })?;
    let rest = rest.trim();
    Some(
        rest.strip_prefix("[ ] ")
            .or_else(|| rest.strip_prefix("[x] "))
            .unwrap_or(rest)
            .trim(),
    )
}

/// Ссылки для карточки: открытые PR, где упомянут `#N`, и картинки/PR из текста issue.
fn links(issue: &GhIssue, prs: &[&GhIssue]) -> Vec<WorkLink> {
    let mut out: Vec<WorkLink> = prs
        .iter()
        .filter(|pr| mentions(pr, issue.number))
        .map(|pr| WorkLink {
            label: format!("PR #{}", pr.number),
            url: pr.html_url.clone(),
        })
        .collect();
    for url in urls(issue.body.as_deref().unwrap_or_default()) {
        let lower = url.to_ascii_lowercase();
        let label = if lower.contains("/pull/") {
            url.rsplit('/')
                .next()
                .map_or("PR".to_owned(), |n| format!("PR #{n}"))
        } else if [".png", ".jpg", ".jpeg", ".webp", ".gif"]
            .iter()
            .any(|ext| lower.ends_with(ext))
            || lower.contains("/user-attachments/")
        {
            "скриншот".to_owned()
        } else {
            continue;
        };
        if !out.iter().any(|l| l.url == url) {
            out.push(WorkLink { label, url });
        }
    }
    out.truncate(6);
    out
}

fn mentions(pr: &GhIssue, number: u64) -> bool {
    let needle = format!("#{number}");
    [pr.title.as_str(), pr.body.as_deref().unwrap_or_default()]
        .iter()
        .any(|text| {
            text.match_indices(&needle).any(|(at, _)| {
                !text[at + needle.len()..]
                    .chars()
                    .next()
                    .is_some_and(|c| c.is_ascii_digit())
            })
        })
}

/// Адреса `https://…` из текста (до пробела, скобки или кавычки).
fn urls(text: &str) -> impl Iterator<Item = String> + '_ {
    text.match_indices("https://").map(move |(at, _)| {
        text[at..]
            .chars()
            .take_while(|c| !c.is_whitespace() && !matches!(c, ')' | '(' | '"' | '<' | '>' | ']'))
            .collect::<String>()
            .trim_end_matches(['.', ','])
            .to_owned()
    })
}

/// Метка в пути запроса: `вопрос` → `%D0%B2…`.
fn path_part(text: &str) -> String {
    text.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.') {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

// ---------------------------------------------------------------- схемы

/// Ссылка в карточке: PR или скриншот.
#[derive(Debug, Serialize, ToSchema)]
pub struct WorkLink {
    label: String,
    url: String,
}

/// Задача (issue) в разделе.
#[derive(Debug, Serialize, ToSchema)]
pub struct WorkItem {
    number: u64,
    title: String,
    url: String,
    labels: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    updated_at: OffsetDateTime,
    links: Vec<WorkLink>,
}

/// Вопрос владельцу: текст и варианты (первый — рекомендация).
#[derive(Debug, Serialize, ToSchema)]
pub struct WorkQuestion {
    number: u64,
    title: String,
    url: String,
    text: String,
    options: Vec<String>,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    updated_at: OffsetDateTime,
}

/// Расход лимита агентов (заполняет управляющая сессия).
#[derive(Debug, Clone, Serialize, ToSchema)]
pub struct WorkUsage {
    /// Сколько процентов окна (5 часов) ушло, если указано.
    window_percent: Option<u8>,
    /// Сколько процентов недели ушло, если указано.
    week_percent: Option<u8>,
    /// Последняя запись как есть (до 300 знаков).
    text: String,
    url: String,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    at: OffsetDateTime,
}

/// Раздел «Агенты» целиком.
#[derive(Debug, Serialize, ToSchema)]
pub struct WorkBoard {
    /// Есть ли на сервере токен GitHub. Нет — остальное пусто.
    configured: bool,
    repo: String,
    /// Когда прочитано из GitHub (кэш — 3 минуты).
    #[serde(with = "time::serde::rfc3339::option")]
    #[schema(value_type = Option<String>, format = DateTime)]
    fetched_at: Option<OffsetDateTime>,
    running: Vec<WorkItem>,
    review: Vec<WorkItem>,
    questions: Vec<WorkQuestion>,
    /// Очередь (`ready`) по номеру — по порядку постановки.
    queue: Vec<WorkItem>,
    usage: Option<WorkUsage>,
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct WorkQuery {
    /// Прочитать GitHub заново, если снимку больше 20 секунд.
    #[serde(default)]
    fresh: bool,
}

#[derive(Debug, Deserialize, ToSchema)]
pub struct AnswerRequest {
    /// Вариант кнопкой или свой текст.
    answer: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct AnswerPosted {
    /// Ссылка на комментарий в issue.
    url: String,
}

fn board(work: &Work, snap: Option<&Snapshot>) -> WorkBoard {
    let mut board = WorkBoard {
        configured: work.configured(),
        repo: work.settings.repo.clone(),
        fetched_at: snap.map(|s| s.at),
        running: Vec::new(),
        review: Vec::new(),
        questions: Vec::new(),
        queue: Vec::new(),
        usage: snap.and_then(|s| s.usage.clone()),
    };
    let Some(snap) = snap else {
        return board;
    };
    let prs: Vec<&GhIssue> = snap.issues.iter().filter(|i| i.is_pr()).collect();
    let item = |issue: &GhIssue| WorkItem {
        number: issue.number,
        title: issue.title.clone(),
        url: issue.html_url.clone(),
        labels: issue.labels.iter().map(|l| l.name.clone()).collect(),
        updated_at: issue.updated_at,
        links: links(issue, &prs),
    };
    for issue in snap.issues.iter().filter(|i| !i.is_pr()) {
        if issue.has(LABEL_QUESTION) {
            let (text, options) = parse_question(issue.body.as_deref().unwrap_or_default());
            board.questions.push(WorkQuestion {
                number: issue.number,
                title: issue.title.clone(),
                url: issue.html_url.clone(),
                text,
                options,
                updated_at: issue.updated_at,
            });
        }
        if issue.has(LABEL_REVIEW) {
            board.review.push(item(issue));
        } else if issue.has(LABEL_RUNNING) {
            board.running.push(item(issue));
        } else if issue.has(LABEL_QUEUE) {
            board.queue.push(item(issue));
        }
    }
    board.queue.sort_by_key(|i| i.number);
    board
        .running
        .sort_by_key(|i| std::cmp::Reverse(i.updated_at));
    board
        .review
        .sort_by_key(|i| std::cmp::Reverse(i.updated_at));
    board.questions.sort_by_key(|q| q.number);
    board
}

// ---------------------------------------------------------------- адреса

/// Что делают агенты: идёт, готово — проверь, ждёт владельца, очередь, лимит.
#[utoipa::path(get, path = "/api/owner/work", tag = "owner", params(WorkQuery),
    responses(
        (status = 200, description = "Раздел «Агенты»", body = WorkBoard),
        (status = 404, description = "Не owner", body = ApiErrorBody),
        (status = 502, description = "GitHub не ответил", body = ApiErrorBody)
    ))]
pub async fn work_board(
    State(state): State<AppState>,
    _owner: Owner,
    Query(query): Query<WorkQuery>,
) -> Result<Json<WorkBoard>, ApiError> {
    let work = &state.work;
    if !work.configured() {
        return Ok(Json(board(work, None)));
    }
    let snap = work.snapshot(query.fresh).await?;
    Ok(Json(board(work, Some(&snap))))
}

/// Ответить на вопрос: комментарий «Ответ владельца: …» в issue и снять метку `вопрос`.
#[utoipa::path(post, path = "/api/owner/work/questions/{number}/answer", tag = "owner",
    params(("number" = u64, Path, description = "Номер issue")),
    request_body = AnswerRequest,
    responses(
        (status = 200, description = "Ответ записан в issue", body = AnswerPosted),
        (status = 400, description = "Пустой или слишком длинный ответ", body = ApiErrorBody),
        (status = 404, description = "Не owner", body = ApiErrorBody),
        (status = 409, description = "Это уже не вопрос или GitHub не настроен", body = ApiErrorBody),
        (status = 502, description = "GitHub не ответил", body = ApiErrorBody)
    ))]
pub async fn work_answer(
    State(state): State<AppState>,
    owner: Owner,
    Path(number): Path<u64>,
    Json(body): Json<AnswerRequest>,
) -> Result<Json<AnswerPosted>, ApiError> {
    let work = &state.work;
    if !work.configured() {
        return Err(not_configured());
    }
    let answer = body.answer.trim();
    if answer.is_empty() || answer.chars().count() > ANSWER_MAX {
        return Err(ApiError::new(
            StatusCode::BAD_REQUEST,
            "invalid_answer",
            format!("Ответ — от 1 до {ANSWER_MAX} знаков"),
        ));
    }
    // Сервер пишет только в открытый issue с меткой `вопрос` — не в любой.
    let issue: GhIssue = work
        .send(work.request(reqwest::Method::GET, work.url(&format!("/issues/{number}"))))
        .await?;
    if issue.is_pr() || issue.state != "open" || !issue.has(LABEL_QUESTION) {
        work.forget();
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "not_a_question",
            "На этот вопрос уже ответили или он закрыт",
        ));
    }
    #[derive(Deserialize)]
    struct Created {
        html_url: String,
    }
    let created: Created = work
        .send(
            work.request(
                reqwest::Method::POST,
                work.url(&format!("/issues/{number}/comments")),
            )
            .json(&serde_json::json!({
                "body": format!("Ответ владельца: {answer}\n\n_из Owner Console Qubite_"),
            })),
        )
        .await?;
    work.ok(work.request(
        reqwest::Method::DELETE,
        work.url(&format!(
            "/issues/{number}/labels/{}",
            path_part(LABEL_QUESTION)
        )),
    ))
    .await?;
    work.forget();
    let mut conn = state
        .db
        .pool()
        .acquire()
        .await
        .map_err(|e| ApiError::from(qubite_auth::Error::Db(e)))?;
    audit::record(
        &mut conn,
        NewAuditEntry {
            actor_id: Some(owner.0.account_id()),
            action: "work.question_answered".into(),
            target_kind: "github_issue".into(),
            target_id: Some(number.to_string()),
            after: Some(serde_json::json!({ "answer": clip(answer, 500) })),
            ..NewAuditEntry::default()
        },
    )
    .await
    .map_err(|e| ApiError::from(qubite_auth::Error::Audit(e)))?;
    Ok(Json(AnswerPosted {
        url: created.html_url,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn question_text_and_options() {
        let (text, options) = parse_question(
            "Куда ставить бэкап?\nНа Pi места мало.\n\n- На внешний диск (рекомендую)\n- [ ] В облако\n2. Не ставить\n\nхвост",
        );
        assert_eq!(text, "Куда ставить бэкап?\nНа Pi места мало.");
        assert_eq!(
            options,
            ["На внешний диск (рекомендую)", "В облако", "Не ставить"]
        );
        assert_eq!(parse_question("Только текст").1.len(), 0);
    }

    #[test]
    fn usage_percents() {
        assert_eq!(
            percent_after("Лимит: окно 35%, неделя 62 %", "окн"),
            Some(35)
        );
        assert_eq!(
            percent_after("Лимит: окно 35%, неделя 62 %", "недел"),
            Some(62)
        );
        assert_eq!(percent_after("неделя — примерно 7%", "недел"), Some(7));
        assert_eq!(percent_after("окно 35 задач", "окн"), None);
        assert_eq!(percent_after("ничего", "окн"), None);
    }

    #[test]
    fn repo_and_label_in_path() {
        assert!(valid_repo("kirillkuz1122/qubite"));
        assert!(!valid_repo("kirillkuz1122/../x"));
        assert!(!valid_repo("qubite"));
        assert!(!valid_repo("a/b?c"));
        assert_eq!(path_part("вопрос"), "%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81");
    }

    #[test]
    fn pr_mentions_exact_number() {
        let pr = |body: &str| GhIssue {
            number: 90,
            title: "PR".into(),
            html_url: "https://github.com/o/r/pull/90".into(),
            body: Some(body.into()),
            labels: vec![],
            updated_at: OffsetDateTime::UNIX_EPOCH,
            comments: 0,
            state: "open".into(),
            pull_request: Some(serde_json::json!({})),
        };
        assert!(mentions(&pr("Closes #78"), 78));
        assert!(!mentions(&pr("Closes #780"), 78));
        assert!(mentions(&pr("Часть #78."), 78));
    }

    #[test]
    fn links_from_body() {
        let text = "Скрин: ![a](https://github.com/user-attachments/assets/x.png) и https://github.com/o/r/pull/5.";
        let found: Vec<String> = urls(text).collect();
        assert_eq!(
            found,
            [
                "https://github.com/user-attachments/assets/x.png",
                "https://github.com/o/r/pull/5"
            ]
        );
    }
}
