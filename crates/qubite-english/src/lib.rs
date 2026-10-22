//! Английский (ENG-001): разговор с AI-репетитором голосом и текстом.
//!
//! Как устроено (D-450…D-459):
//! - **Разговор** — `english_sessions`: начался кнопкой «Начать», закончился
//!   «Закончить» или 30 минутами тишины ([`IDLE`]). Первая реплика репетитора —
//!   готовая фраза ([`tutor::GREETINGS`]), без модели.
//! - **Ход** ([`turn`]): голос → распознавание через AI-шлюз (ElevenLabs,
//!   [`qubite_ai::voice`]) → текст ученика → модель через шлюз (задача
//!   [`TUTOR_TASK`]) → ответ с разбором ошибок и «повтори правильно».
//! - **Речь** ([`speech`]) — отдельным запросом: экран сначала показывает
//!   ответ, потом играет голос. Готовая речь хранится — «ещё раз» бесплатно.
//! - **Память**: в конце разговора итог пишется в «Английский.md» в папке
//!   агента ([`notes`]) — одной строкой ленты с откатом.
//!
//! Права — модуль `agent` (репетитор — это агент в режиме английского):
//! `write` — разговаривать, `ai` + бюджет — модель и голос. Без голосового
//! провайдера всё работает текстом.

pub mod live;
pub mod notes;
pub mod tutor;

use qubite_ai::{
    AiError, AiRequest, Gateway, ListenRequest, SpeakRequest, Untrusted,
    voice::{self, STT, TTS},
};
use qubite_policy::{Authorized, DenyReason, ModuleId, Read, Subject, UseAi, Write};
use serde::Serialize;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

pub use notes::Totals;
pub use tutor::{Mistake, Verdict};

/// Задача AI-шлюза: модель репетитора (owner выбирает, иначе — по умолчанию).
pub const TUTOR_TASK: &str = "english.tutor";
/// Модуль прав и бюджета.
pub const MODULE: &str = qubite_agent::MODULE;
/// Разговор без реплик дольше этого — закончен.
pub const IDLE: time::Duration = time::Duration::minutes(30);
/// Длина реплики текстом.
pub const MAX_TEXT: usize = 1000;
/// Сколько прошлых реплик видит репетитор.
const HISTORY: i64 = 16;
const MAX_OUTPUT_TOKENS: u32 = 700;

/// Настройки сервера.
#[derive(Debug, Clone)]
pub struct Settings {
    /// Голос репетитора у провайдера речи.
    pub voice: String,
    /// Язык распознавания: `None` — провайдер определит сам (D-454).
    pub listen_language: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            voice: qubite_ai::elevenlabs::DEFAULT_VOICE.into(),
            listen_language: None,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{}", .0.message())]
    Denied(DenyReason),
    #[error("не найдено")]
    NotFound,
    #[error("{0}")]
    Invalid(String),
    /// Отказ AI-шлюза. `heard` — что успели распознать (чтобы не пропало:
    /// экран кладёт это в поле, можно отправить текстом).
    #[error("{error}")]
    Ai {
        error: AiError,
        heard: Option<String>,
    },
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка прав: {0}")]
    Policy(qubite_policy::Error),
}

impl Error {
    /// Код для программ.
    pub fn code(&self) -> &'static str {
        match self {
            Self::Denied(reason) => reason.code(),
            Self::NotFound => "not_found",
            Self::Invalid(_) => "invalid",
            Self::Ai { error, .. } => error.code(),
            Self::Db(_) | Self::Policy(_) => "internal",
        }
    }
}

impl From<qubite_policy::Error> for Error {
    fn from(error: qubite_policy::Error) -> Self {
        match error {
            qubite_policy::Error::Denied(reason) => Self::Denied(reason),
            other => Self::Policy(other),
        }
    }
}

impl From<AiError> for Error {
    fn from(error: AiError) -> Self {
        match error {
            AiError::Denied(reason) => Self::Denied(reason),
            AiError::Db(error) => Self::Db(error),
            error => Self::Ai { error, heard: None },
        }
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

// ---------------------------------------------------------------- данные

/// Разговор.
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct Session {
    pub id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339")]
    pub last_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub finished_at: Option<OffsetDateTime>,
    pub turns: i32,
    pub correct: i32,
    pub mistakes: i32,
    /// Строка ленты агента, которой итог записан в «Английский.md».
    pub memory_action: Option<Uuid>,
}

const SESSION: &str = "SELECT id, started_at, last_at, finished_at, turns, correct, mistakes, \
     memory_action FROM english_sessions";

/// Реплика.
#[derive(Debug, Clone, Serialize)]
pub struct Message {
    pub id: Uuid,
    pub seq: i64,
    /// `learner` — ученик, `tutor` — репетитор.
    pub role: String,
    pub text: String,
    /// У ученика: `text` или `voice`.
    pub via: String,
    pub verdict: Option<Verdict>,
    pub mistakes: Vec<Mistake>,
    /// Что повторить правильно (пусто — ничего).
    pub repeat: String,
    /// Ученик правильно повторил то, что просили в прошлый раз.
    pub repeated: bool,
    /// Речь уже готова (повтор бесплатно).
    pub has_speech: bool,
    /// Замеры задержки ответа (разговор потоком).
    pub latency: Option<live::Latency>,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct MessageRow {
    id: Uuid,
    seq: i64,
    role: String,
    text: String,
    via: String,
    verdict: Option<String>,
    mistakes: serde_json::Value,
    repeat: String,
    repeated: bool,
    has_speech: bool,
    latency: Option<serde_json::Value>,
    created_at: OffsetDateTime,
}

impl From<MessageRow> for Message {
    fn from(row: MessageRow) -> Self {
        Self {
            id: row.id,
            seq: row.seq,
            role: row.role,
            text: row.text,
            via: row.via,
            verdict: row.verdict.and_then(|v| v.parse().ok()),
            mistakes: serde_json::from_value(row.mistakes).unwrap_or_default(),
            repeat: row.repeat,
            repeated: row.repeated,
            has_speech: row.has_speech,
            latency: row.latency.and_then(|v| serde_json::from_value(v).ok()),
            at: row.created_at,
        }
    }
}

const MESSAGE: &str = "SELECT id, seq, role, text, via, verdict, mistakes, repeat, repeated, \
     speech IS NOT NULL AS has_speech, latency, created_at FROM english_messages";

async fn message(conn: &mut PgConnection, id: Uuid) -> Result<Message> {
    let row: MessageRow = sqlx::query_as(sqlx::AssertSqlSafe(format!("{MESSAGE} WHERE id = $1")))
        .bind(id)
        .fetch_one(conn)
        .await?;
    Ok(row.into())
}

async fn messages(conn: &mut PgConnection, session: Uuid) -> Result<Vec<Message>> {
    let rows: Vec<MessageRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{MESSAGE} WHERE session_id = $1 ORDER BY seq"
    )))
    .bind(session)
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(Into::into).collect())
}

/// Готов ли голос: распознавание и речь по отдельности.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct Voice {
    pub listen: bool,
    pub speak: bool,
    /// Распознавание на ходу (ответ почти сразу после паузы).
    pub live: bool,
}

/// Экран «Английский».
#[derive(Debug, Clone, Serialize)]
pub struct Overview {
    /// Идущий разговор (`None` — не начат).
    pub session: Option<Session>,
    pub messages: Vec<Message>,
    /// Прошлый законченный разговор.
    pub last: Option<Session>,
    pub totals: Totals,
    pub voice: Voice,
}

// ---------------------------------------------------------------- права

fn module() -> ModuleId {
    ModuleId::new(MODULE).expect("модуль agent")
}

async fn may_read(pool: &PgPool, account: Uuid) -> Result<()> {
    qubite_policy::decide::<Read>(pool, &Subject::account(account, None), &module()).await?;
    Ok(())
}

async fn may_write(pool: &PgPool, account: Uuid) -> Result<()> {
    qubite_policy::decide::<Write>(pool, &Subject::account(account, None), &module()).await?;
    Ok(())
}

pub(crate) async fn may_use_ai(pool: &PgPool, account: Uuid) -> Result<Authorized<UseAi>> {
    Ok(qubite_policy::decide::<UseAi>(pool, &Subject::account(account, None), &module()).await?)
}

/// Готов ли голос на этом сервере.
pub async fn voice(gateway: &Gateway) -> Result<Voice> {
    Ok(Voice {
        listen: gateway.voice_ready(STT).await?,
        speak: gateway.voice_ready(TTS).await?,
        live: gateway.voice_ready(voice::STT_LIVE).await?,
    })
}

// ---------------------------------------------------------------- разговор

/// Открытый и не заснувший разговор.
async fn open_session(conn: &mut PgConnection, account: Uuid) -> Result<Option<Session>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SESSION} WHERE account_id = $1 AND finished_at IS NULL \
         AND last_at > now() - $2::float8 * interval '1 second'"
    )))
    .bind(account)
    .bind(IDLE.as_seconds_f64())
    .fetch_optional(conn)
    .await?)
}

/// Экран: идущий разговор, прошлый, итоги и готов ли голос.
pub async fn overview(pool: &PgPool, gateway: &Gateway, account: Uuid) -> Result<Overview> {
    may_read(pool, account).await?;
    let mut conn = pool.acquire().await?;
    let session = open_session(&mut conn, account).await?;
    let messages = match &session {
        Some(session) => messages(&mut conn, session.id).await?,
        None => Vec::new(),
    };
    let last = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SESSION} WHERE account_id = $1 AND turns > 0 \
         AND (finished_at IS NOT NULL OR last_at <= now() - $2::float8 * interval '1 second') \
         ORDER BY started_at DESC LIMIT 1"
    )))
    .bind(account)
    .bind(IDLE.as_seconds_f64())
    .fetch_optional(&mut *conn)
    .await?;
    let totals = notes::totals(&mut conn, account).await?;
    drop(conn);
    Ok(Overview {
        session,
        messages,
        last,
        totals,
        voice: voice(gateway).await?,
    })
}

/// Закончить разговоры, которые заснули ([`IDLE`]): итог — в память.
async fn close_idle(pool: &PgPool, account: Uuid) -> Result<()> {
    let ids: Vec<Uuid> = sqlx::query_scalar(
        "SELECT id FROM english_sessions WHERE account_id = $1 AND finished_at IS NULL \
         AND last_at <= now() - $2::float8 * interval '1 second'",
    )
    .bind(account)
    .bind(IDLE.as_seconds_f64())
    .fetch_all(pool)
    .await?;
    for id in ids {
        close(pool, account, id).await?;
    }
    Ok(())
}

async fn create_session(pool: &PgPool, account: Uuid, greet: bool) -> Result<Session> {
    let mut tx = pool.begin().await?;
    let id = Uuid::now_v7();
    let inserted = sqlx::query(
        "INSERT INTO english_sessions (id, account_id) VALUES ($1, $2) \
         ON CONFLICT (account_id) WHERE finished_at IS NULL DO NOTHING",
    )
    .bind(id)
    .bind(account)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        // Параллельно уже начали — берём тот.
        drop(tx);
        let mut conn = pool.acquire().await?;
        return open_session(&mut conn, account)
            .await?
            .ok_or_else(|| Error::Invalid("разговор только что начался, повторите".into()));
    }
    if greet {
        let n = usize::try_from(id.as_u128() % tutor::GREETINGS.len() as u128).unwrap_or(0);
        sqlx::query(
            "INSERT INTO english_messages (id, session_id, account_id, role, text, verdict) \
             VALUES ($1, $2, $3, 'tutor', $4, 'none')",
        )
        .bind(Uuid::now_v7())
        .bind(id)
        .bind(account)
        .bind(tutor::GREETINGS[n])
        .execute(&mut *tx)
        .await?;
    }
    let session = sqlx::query_as(sqlx::AssertSqlSafe(format!("{SESSION} WHERE id = $1")))
        .bind(id)
        .fetch_one(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(session)
}

/// Начать разговор (или вернуть идущий): репетитор здоровается.
pub async fn start(pool: &PgPool, account: Uuid) -> Result<(Session, Vec<Message>)> {
    may_write(pool, account).await?;
    close_idle(pool, account).await?;
    let mut conn = pool.acquire().await?;
    let session = match open_session(&mut conn, account).await? {
        Some(session) => session,
        None => {
            drop(conn);
            let session = create_session(pool, account, true).await?;
            conn = pool.acquire().await?;
            session
        }
    };
    let list = messages(&mut conn, session.id).await?;
    Ok((session, list))
}

/// Закончить разговор: итог — в «Английский.md». Нечего заканчивать — `None`.
pub async fn finish(pool: &PgPool, account: Uuid) -> Result<Option<Session>> {
    may_write(pool, account).await?;
    let id: Option<Uuid> = sqlx::query_scalar(
        "SELECT id FROM english_sessions WHERE account_id = $1 AND finished_at IS NULL",
    )
    .bind(account)
    .fetch_optional(pool)
    .await?;
    match id {
        Some(id) => Ok(Some(close(pool, account, id).await?)),
        None => Ok(None),
    }
}

/// Закрыть разговор (один раз) и записать итог в память агента. Память не
/// записалась (агента выключили) — разговор всё равно закрыт.
async fn close(pool: &PgPool, account: Uuid, id: Uuid) -> Result<Session> {
    let closed: Option<Session> = sqlx::query_as(
        "UPDATE english_sessions SET finished_at = greatest(last_at, started_at) \
         WHERE id = $1 AND account_id = $2 AND finished_at IS NULL \
         RETURNING id, started_at, last_at, finished_at, turns, correct, mistakes, memory_action",
    )
    .bind(id)
    .bind(account)
    .fetch_optional(pool)
    .await?;
    let Some(session) = closed else {
        return sqlx::query_as(sqlx::AssertSqlSafe(format!("{SESSION} WHERE id = $1")))
            .bind(id)
            .fetch_optional(pool)
            .await?
            .ok_or(Error::NotFound);
    };
    if session.turns == 0 {
        return Ok(session);
    }
    match remember(pool, account, &session).await {
        Ok(Some(action)) => {
            sqlx::query("UPDATE english_sessions SET memory_action = $2 WHERE id = $1")
                .bind(id)
                .bind(action)
                .execute(pool)
                .await?;
            Ok(Session {
                memory_action: Some(action),
                ..session
            })
        }
        Ok(None) => Ok(session),
        Err(error) => {
            tracing::warn!(%error, session = %id, "итог разговора не записан в «Английский.md»");
            Ok(session)
        }
    }
}

/// Записать итог в «Английский.md» от имени агента (строка ленты с откатом).
async fn remember(pool: &PgPool, account: Uuid, session: &Session) -> Result<Option<Uuid>, String> {
    let fail = |error: &dyn std::fmt::Display| error.to_string();
    let mut conn = pool.acquire().await.map_err(|e| fail(&e))?;
    let totals = notes::totals(&mut conn, account)
        .await
        .map_err(|e| fail(&e))?;
    let frequent = notes::frequent(&mut conn, account)
        .await
        .map_err(|e| fail(&e))?;
    let recent = notes::recent(&mut conn, account)
        .await
        .map_err(|e| fail(&e))?;
    let date = notes::local_date(&mut conn, session.started_at)
        .await
        .map_err(|e| fail(&e))?;
    let old = qubite_agent::files::by_path(&mut conn, account, notes::PATH)
        .await
        .map_err(|e| fail(&e))?;
    drop(conn);
    let end = session.finished_at.unwrap_or(session.last_at);
    let last = notes::Last {
        date,
        minutes: ((end - session.started_at).whole_seconds() + 59) / 60,
        turns: i64::from(session.turns),
        mistakes: i64::from(session.mistakes),
    };
    let body = notes::render(
        &totals,
        Some(&last),
        &frequent,
        &recent,
        old.as_ref()
            .and_then(|file| notes::keep_notes(&file.body))
            .as_deref(),
    );
    let run = qubite_agent::start_run(pool, account, qubite_agent::Trigger::Manual)
        .await
        .map_err(|e| fail(&e))?;
    let who = qubite_agent::Who::agent(&run);
    let summary = format!(
        "разговор {} мин, реплик {}, с ошибками {}",
        last.minutes.max(1),
        last.turns,
        last.mistakes
    );
    let result = qubite_agent::memory::put(
        pool,
        &who,
        notes::PATH,
        &body,
        &summary,
        Some("итог разговора с репетитором английского"),
    )
    .await;
    let _ = qubite_agent::finish_run(pool, &run, result.is_ok()).await;
    result
        .map(|action| action.map(|a| a.id))
        .map_err(|e| fail(&e))
}

// ---------------------------------------------------------------- ход

/// Что сказал ученик.
#[derive(Debug, Clone)]
pub enum Said {
    Text(String),
    Voice {
        audio: Vec<u8>,
        /// `audio/webm;codecs=opus` …
        mime: String,
        duration_ms: u64,
    },
}

/// Ход: реплика ученика и ответ репетитора.
#[derive(Debug, Clone, Serialize)]
pub struct Turn {
    pub session: Session,
    pub learner: Message,
    pub tutor: Message,
    /// Цена хода (распознавание + модель), миллионные доли доллара.
    pub cost_usd_micros: i64,
}

fn dialog(history: &[Message]) -> String {
    history
        .iter()
        .map(|m| {
            if m.role == "tutor" {
                if m.repeat.is_empty() {
                    format!("Нейт: {}", m.text)
                } else {
                    format!("Нейт: {} (повтори: {})", m.text, m.repeat)
                }
            } else {
                format!("Ученик: {}", m.text)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Пустую и слишком длинную реплику — отказ; иначе — без пробелов по краям.
pub(crate) fn check_text(text: &str) -> Result<String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(Error::Invalid("пустая реплика".into()));
    }
    if text.chars().count() > MAX_TEXT {
        return Err(Error::Invalid(format!("реплика длиннее {MAX_TEXT} знаков")));
    }
    Ok(text.to_owned())
}

/// Перед ходом: права (разговаривать и AI), заснувший разговор — закрыть,
/// идущий — взять или начать.
pub(crate) async fn begin(pool: &PgPool, account: Uuid) -> Result<(Authorized<UseAi>, Session)> {
    may_write(pool, account).await?;
    let auth = may_use_ai(pool, account).await?;
    close_idle(pool, account).await?;
    let session = {
        let mut conn = pool.acquire().await?;
        open_session(&mut conn, account).await?
    };
    let session = match session {
        Some(session) => session,
        None => create_session(pool, account, false).await?,
    };
    Ok((auth, session))
}

/// Запрос к модели репетитора: заметки, разговор, слова ученика — данные.
pub(crate) async fn tutor_request(
    pool: &PgPool,
    gateway: &Gateway,
    account: Uuid,
    session: Uuid,
    key: Uuid,
    text: &str,
) -> Result<AiRequest> {
    let mut conn = pool.acquire().await?;
    let mut history: Vec<Message> = messages(&mut conn, session).await?;
    let skip = history
        .len()
        .saturating_sub(usize::try_from(HISTORY).unwrap_or(16));
    history.drain(..skip);
    let notes_body = qubite_agent::files::by_path(&mut conn, account, notes::PATH)
        .await?
        .map(|file| file.body.chars().take(3000).collect::<String>());
    drop(conn);
    let mut data = Vec::new();
    if let Some(body) = notes_body.filter(|b| !b.trim().is_empty()) {
        data.push(Untrusted::new("notes", body));
    }
    if !history.is_empty() {
        data.push(Untrusted::new("dialog", dialog(&history)));
    }
    data.push(Untrusted::new("learner", text.to_owned()));
    Ok(AiRequest {
        request_id: format!("english:{key}:tutor"),
        model: gateway.model_for(TUTOR_TASK).await?,
        prompt: tutor::PROMPT.into(),
        untrusted: data,
        input_tokens: 0,
        max_output_tokens: MAX_OUTPUT_TOKENS,
        job_id: None,
    })
}

/// Что сказал ученик (для записи).
pub(crate) struct Learner {
    pub(crate) text: String,
    pub(crate) via: &'static str,
    pub(crate) stt_call: Option<Uuid>,
}

/// Обе реплики, речь (если уже есть) и счётчики разговора — одной транзакцией.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn save(
    pool: &PgPool,
    account: Uuid,
    session: Uuid,
    learner: &Learner,
    reply: &tutor::Reply,
    ai_call: Uuid,
    latency: Option<serde_json::Value>,
    speech: Option<(Vec<u8>, String, Uuid)>,
) -> Result<(Session, Message, Message)> {
    let mut tx = pool.begin().await?;
    let learner_id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO english_messages (id, session_id, account_id, role, text, via, stt_call) \
         VALUES ($1, $2, $3, 'learner', $4, $5, $6)",
    )
    .bind(learner_id)
    .bind(session)
    .bind(account)
    .bind(&learner.text)
    .bind(learner.via)
    .bind(learner.stt_call)
    .execute(&mut *tx)
    .await?;
    let tutor_id = Uuid::now_v7();
    let (speech, speech_mime, tts_call) = match speech {
        Some((audio, mime, call)) => (Some(audio), Some(mime), Some(call)),
        None => (None, None, None),
    };
    sqlx::query(
        "INSERT INTO english_messages (id, session_id, account_id, role, text, verdict, mistakes, \
         repeat, repeated, ai_call, latency, speech, speech_mime, tts_call) \
         VALUES ($1, $2, $3, 'tutor', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)",
    )
    .bind(tutor_id)
    .bind(session)
    .bind(account)
    .bind(&reply.say)
    .bind(reply.verdict.as_str())
    .bind(serde_json::to_value(&reply.mistakes).unwrap_or_default())
    .bind(&reply.repeat)
    .bind(reply.repeated)
    .bind(ai_call)
    .bind(latency)
    .bind(speech)
    .bind(speech_mime)
    .bind(tts_call)
    .execute(&mut *tx)
    .await?;
    let session: Session = sqlx::query_as(
        "UPDATE english_sessions SET last_at = now(), turns = turns + 1, \
         correct = correct + ($2 = 'ok')::int, mistakes = mistakes + ($2 = 'mistake')::int \
         WHERE id = $1 \
         RETURNING id, started_at, last_at, finished_at, turns, correct, mistakes, memory_action",
    )
    .bind(session)
    .bind(reply.verdict.as_str())
    .fetch_one(&mut *tx)
    .await?;
    let learner = message(&mut tx, learner_id).await?;
    let tutor = message(&mut tx, tutor_id).await?;
    tx.commit().await?;
    Ok((session, learner, tutor))
}

/// Ошибке AI — распознанный текст, чтобы он не пропал.
pub(crate) fn with_heard(error: AiError, heard: Option<&str>) -> Error {
    match Error::from(error) {
        Error::Ai { error, .. } => Error::Ai {
            error,
            heard: heard.map(str::to_owned),
        },
        other => other,
    }
}

/// Сказать репетитору (`key` — ID действия от экрана: повтор с тем же ключом
/// не платится дважды). Голос сначала распознаётся; ответ — с разбором ошибок.
/// Ход целиком (без потока); разговор потоком — [`live`].
pub async fn turn(
    pool: &PgPool,
    gateway: &Gateway,
    settings: &Settings,
    account: Uuid,
    key: Uuid,
    said: Said,
) -> Result<Turn> {
    if let Said::Text(text) = &said {
        check_text(text)?;
    }
    let (auth, session) = begin(pool, account).await?;
    // Распознавание и ответ — один ход для защиты от зацикливания.
    let ai = gateway.turn();

    // 1. Голос → текст (через шлюз: грант, бюджет, журнал).
    let mut cost = 0;
    let learner = match said {
        Said::Text(text) => Learner {
            text: text.trim().to_owned(),
            via: "text",
            stt_call: None,
        },
        Said::Voice {
            audio,
            mime,
            duration_ms,
        } => {
            let model = gateway.model_for(voice::STT_TASK).await?;
            let heard = ai
                .transcribe(
                    &auth,
                    ListenRequest {
                        request_id: format!("english:{key}:stt"),
                        model,
                        audio,
                        mime,
                        language: settings.listen_language.clone(),
                        duration_ms,
                    },
                )
                .await?;
            cost += heard.cost_usd;
            let text: String = heard.text.chars().take(MAX_TEXT).collect();
            if text.trim().is_empty() {
                return Err(Error::Invalid(
                    "не расслышал ни слова — скажи ещё раз, ближе к микрофону".into(),
                ));
            }
            Learner {
                text,
                via: "voice",
                stt_call: Some(heard.call_id),
            }
        }
    };

    // 2. Модель.
    let heard = (learner.via == "voice").then_some(learner.text.as_str());
    let request = tutor_request(pool, gateway, account, session.id, key, &learner.text)
        .await
        .map_err(|error| match error {
            Error::Ai { error, .. } => with_heard(error, heard),
            other => other,
        })?;
    let response = ai
        .complete(&auth, request)
        .await
        .map_err(|error| with_heard(error, heard))?;
    cost += response.cost_usd;
    let reply = tutor::parse(&response.text);

    // 3. Обе реплики и счётчики.
    let (session, learner, tutor) = save(
        pool,
        account,
        session.id,
        &learner,
        &reply,
        response.call_id,
        None,
        None,
    )
    .await?;
    Ok(Turn {
        session,
        learner,
        tutor,
        cost_usd_micros: cost,
    })
}

// ---------------------------------------------------------------- речь

/// Речь репетитора.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Speech {
    pub audio: Vec<u8>,
    pub mime: String,
    /// Цена (0 — уже было готово).
    pub cost_usd_micros: i64,
}

/// Голос реплики репетитора. Готовая — из базы бесплатно; та же фраза уже
/// звучала раньше — тоже бесплатно; иначе — речь через шлюз и в базу.
pub async fn speech(
    pool: &PgPool,
    gateway: &Gateway,
    settings: &Settings,
    account: Uuid,
    message_id: Uuid,
) -> Result<Speech> {
    may_read(pool, account).await?;
    let row: Option<(String, Option<Vec<u8>>, Option<String>)> = sqlx::query_as(
        "SELECT text, speech, speech_mime FROM english_messages \
         WHERE id = $1 AND account_id = $2 AND role = 'tutor'",
    )
    .bind(message_id)
    .bind(account)
    .fetch_optional(pool)
    .await?;
    let Some((text, speech, mime)) = row else {
        return Err(Error::NotFound);
    };
    if let (Some(audio), Some(mime)) = (speech, mime) {
        return Ok(Speech {
            audio,
            mime,
            cost_usd_micros: 0,
        });
    }
    let same: Option<(Vec<u8>, String)> = sqlx::query_as(
        "SELECT speech, speech_mime FROM english_messages \
         WHERE account_id = $1 AND role = 'tutor' AND text = $2 AND speech IS NOT NULL LIMIT 1",
    )
    .bind(account)
    .bind(&text)
    .fetch_optional(pool)
    .await?;
    let (audio, mime, cost, call) = match same {
        Some((audio, mime)) => (audio, mime, 0, None),
        None => {
            let auth = may_use_ai(pool, account).await?;
            let model = gateway.model_for(voice::TTS_TASK).await?;
            let spoken = gateway
                .speak(
                    &auth,
                    SpeakRequest {
                        request_id: format!("english:speech:{message_id}:{}", Uuid::now_v7()),
                        model,
                        voice: settings.voice.clone(),
                        text,
                    },
                )
                .await?;
            (
                spoken.audio,
                spoken.mime,
                spoken.cost_usd,
                Some(spoken.call_id),
            )
        }
    };
    sqlx::query(
        "UPDATE english_messages SET speech = $2, speech_mime = $3, tts_call = coalesce($4, tts_call) \
         WHERE id = $1 AND speech IS NULL",
    )
    .bind(message_id)
    .bind(&audio)
    .bind(&mime)
    .bind(call)
    .execute(pool)
    .await?;
    Ok(Speech {
        audio,
        mime,
        cost_usd_micros: cost,
    })
}
