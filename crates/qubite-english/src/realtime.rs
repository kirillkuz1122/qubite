//! Живой голос Нейта через подписку ChatGPT (ENG-005, D-573, D-590…D-599).
//!
//! - **Выбор голоса** — в настройках «Английского»: `chatgpt` (живой разговор
//!   OpenAI Realtime) или `elevenlabs` (распознал → ответил → озвучил, ENG-001).
//!   Не выбран — сам: ChatGPT, если подписка подключена и сервер умеет
//!   realtime, иначе ElevenLabs ([`engine`]).
//! - **Сеанс** ([`open`]): сервер собирает Нейта — тот же характер и правила,
//!   что в ENG-001/002 ([`tutor::VOICE_PROMPT`]), урок, уровень и строгость,
//!   заметки «Английский.md», прошлые реплики этого разговора — и через
//!   AI-шлюз получает временный ключ по подписке человека. Браузер с ним
//!   говорит с моделью напрямую (WebRTC).
//! - **Расшифровка** ([`lines`]): что сказал человек и что ответил Нейт — экран
//!   присылает готовые реплики, они ложатся в тот же разговор, что и у
//!   ElevenLabs (история, итог в «Английский.md», опыт за реплики). Повтор той
//!   же реплики не пишется второй раз.
//! - **Конец** ([`finish`]): длительность — в учёт шлюза; «Закончить» ещё и
//!   закрывает разговор (итог — в память агента).

use qubite_ai::{
    AiError, Gateway, RealtimeRequest, RealtimeSession, Untrusted, chatgpt,
    realtime::{self as rt, RealtimeUsage},
};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    Error, Message, Result, Session, begin, dialog, lessons, may_read, may_write, message,
    messages, notes, tutor,
};

pub const ENGINE_CHATGPT: &str = "chatgpt";
pub const ENGINE_ELEVENLABS: &str = "elevenlabs";
/// Реплик за один раз.
pub const MAX_LINES: usize = 50;
/// Сколько прошлых реплик разговора видит Нейт в новом сеансе.
const HISTORY: usize = 16;

/// Какой голос у разговора сейчас.
#[derive(Debug, Clone, Serialize)]
pub struct EngineState {
    /// Что выбрал человек: `None` — сам.
    pub chosen: Option<String>,
    /// Что работает: `chatgpt` или `elevenlabs`.
    pub engine: &'static str,
    /// Подписка ChatGPT подключена у этого человека.
    pub chatgpt_connected: bool,
    /// Сервер умеет живой разговор (провайдер включён, модель есть).
    pub realtime_ready: bool,
    /// Модель и голос живого разговора.
    pub model: String,
    pub voice: String,
    /// Сколько использовано сегодня и лимиты.
    pub usage: RealtimeUsage,
}

/// Модель и голос realtime из настроек человека (или по умолчанию).
fn chosen(learner: &lessons::Learner) -> (String, String) {
    (
        learner
            .realtime_model
            .clone()
            .unwrap_or_else(|| rt::DEFAULT_MODEL.into()),
        learner
            .realtime_voice
            .clone()
            .unwrap_or_else(|| rt::DEFAULT_VOICE.into()),
    )
}

/// Какой голос работает у человека.
pub async fn engine(pool: &PgPool, gateway: &Gateway, account: Uuid) -> Result<EngineState> {
    may_read(pool, account).await?;
    let learner = {
        let mut conn = pool.acquire().await?;
        lessons::learner(&mut conn, account).await?
    };
    let (model, voice) = chosen(&learner);
    let chatgpt_connected = chatgpt::status(pool, account).await?.connected;
    let realtime_ready = gateway.realtime_ready(&model).await?;
    let engine = match learner.voice_engine.as_deref() {
        Some(ENGINE_ELEVENLABS) => ENGINE_ELEVENLABS,
        Some(ENGINE_CHATGPT) => ENGINE_CHATGPT,
        _ if chatgpt_connected && realtime_ready => ENGINE_CHATGPT,
        _ => ENGINE_ELEVENLABS,
    };
    Ok(EngineState {
        chosen: learner.voice_engine,
        engine,
        chatgpt_connected,
        realtime_ready,
        model,
        voice,
        usage: gateway.realtime_usage(account).await?,
    })
}

/// Выданный сеанс и разговор, в который он пишет.
#[derive(Debug, Clone, Serialize)]
pub struct Started {
    pub session: Session,
    pub messages: Vec<Message>,
    pub realtime: RealtimeSession,
    /// Выбранная модель не пустила — работает другая (что сказать человеку).
    pub fallback: Option<String>,
}

/// Инструкции и данные для Нейта: характер, урок, уровень, заметки, прошлое.
async fn nate(pool: &PgPool, account: Uuid, session: Uuid) -> Result<(String, Vec<Untrusted>)> {
    let mut conn = pool.acquire().await?;
    let mut history = messages(&mut conn, session).await?;
    let skip = history.len().saturating_sub(HISTORY);
    history.drain(..skip);
    let notes_body = qubite_agent::files::by_path(&mut conn, account, notes::PATH)
        .await?
        .map(|file| file.body.chars().take(3000).collect::<String>());
    let lesson = lessons::current(&mut conn, account).await?;
    drop(conn);
    let mut data = Vec::new();
    let prompt = match &lesson {
        Some((lesson, level, strictness)) => {
            data.push(Untrusted::new("lesson", tutor::lesson_block(lesson)));
            format!(
                "{}\n\n{}\n{}",
                tutor::VOICE_PROMPT,
                tutor::LESSON_RULES,
                lessons::rules(level, *strictness)
            )
        }
        None => tutor::VOICE_PROMPT.to_owned(),
    };
    if let Some(body) = notes_body.filter(|b| !b.trim().is_empty()) {
        data.push(Untrusted::new("notes", body));
    }
    if !history.is_empty() {
        data.push(Untrusted::new("dialog", dialog(&history)));
    }
    Ok((prompt, data))
}

/// Начать живой разговор (или продолжить идущий): временный ключ по своей
/// подписке ChatGPT. `key` — ID действия с экрана (повтор не выдаёт второй).
pub async fn open(pool: &PgPool, gateway: &Gateway, account: Uuid, key: Uuid) -> Result<Started> {
    may_write(pool, account).await?;
    if !chatgpt::status(pool, account).await?.connected {
        return Err(Error::NoSubscription);
    }
    let (auth, session) = begin(pool, account).await?;
    let learner = {
        let mut conn = pool.acquire().await?;
        lessons::learner(&mut conn, account).await?
    };
    let (model, voice) = chosen(&learner);
    let (prompt, untrusted) = nate(pool, account, session.id).await?;
    let request = |model: &str, suffix: &str| RealtimeRequest {
        request_id: format!("english:{key}:realtime{suffix}"),
        model: model.to_owned(),
        prompt: prompt.clone(),
        untrusted: untrusted.clone(),
        voice: voice.clone(),
        language: None,
        transcription_only: false,
    };
    let (realtime, fallback) = match gateway.realtime_open(&auth, request(&model, "")).await {
        Ok(realtime) => (realtime, None),
        // Модель попроще подписка может не пускать — тогда основная (Q-146).
        Err(AiError::ProviderRefused { reason, .. }) if model != rt::DEFAULT_MODEL => {
            tracing::info!(model, reason, "модель realtime не пустили — беру основную");
            let realtime = gateway
                .realtime_open(&auth, request(rt::DEFAULT_MODEL, ":default"))
                .await?;
            (
                realtime,
                Some(format!(
                    "Подписка не пустила модель «{model}» — говорит GPT Realtime 1.5."
                )),
            )
        }
        Err(error) => return Err(error.into()),
    };
    sqlx::query(
        "INSERT INTO english_realtime (call_id, account_id, session_id) VALUES ($1, $2, $3)",
    )
    .bind(realtime.call_id)
    .bind(account)
    .bind(session.id)
    .execute(pool)
    .await?;
    let list = {
        let mut conn = pool.acquire().await?;
        messages(&mut conn, session.id).await?
    };
    Ok(Started {
        session,
        messages: list,
        realtime,
        fallback,
    })
}

/// Реплика расшифровки.
#[derive(Debug, Clone, Deserialize)]
pub struct Line {
    /// ID элемента разговора у провайдера (повтор не пишется второй раз).
    pub item: String,
    /// `learner` или `tutor`.
    pub role: String,
    pub text: String,
}

/// Разговор сеанса `call` этого человека.
async fn session_of(pool: &PgPool, account: Uuid, call: Uuid) -> Result<Uuid> {
    sqlx::query_scalar(
        "SELECT session_id FROM english_realtime WHERE call_id = $1 AND account_id = $2",
    )
    .bind(call)
    .bind(account)
    .fetch_optional(pool)
    .await?
    .ok_or(Error::NotFound)
}

/// Записать готовые реплики расшифровки в разговор. Возвращает разговор и
/// новые реплики (уже записанные раньше — пропускаются).
pub async fn lines(
    pool: &PgPool,
    account: Uuid,
    call: Uuid,
    lines: Vec<Line>,
) -> Result<(Session, Vec<Message>)> {
    may_write(pool, account).await?;
    if lines.len() > MAX_LINES {
        return Err(Error::Invalid(format!("за раз — до {MAX_LINES} реплик")));
    }
    for line in &lines {
        if line.item.is_empty() || line.item.chars().count() > 100 {
            return Err(Error::Invalid("ID реплики — от 1 до 100 знаков".into()));
        }
        if line.role != "learner" && line.role != "tutor" {
            return Err(Error::Invalid("роль — learner или tutor".into()));
        }
    }
    let session = session_of(pool, account, call).await?;
    let mut tx = pool.begin().await?;
    let mut added = Vec::new();
    let mut learner_lines = 0_i64;
    for line in lines {
        let text: String = line.text.trim().chars().take(4000).collect();
        if text.is_empty() {
            continue;
        }
        let id = Uuid::now_v7();
        let (via, verdict) = if line.role == "learner" {
            ("voice", None)
        } else {
            ("text", Some("none"))
        };
        let inserted = sqlx::query(
            "INSERT INTO english_messages (id, session_id, account_id, role, text, via, verdict, \
             ai_call, realtime_item) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) \
             ON CONFLICT (session_id, realtime_item) WHERE realtime_item IS NOT NULL DO NOTHING",
        )
        .bind(id)
        .bind(session)
        .bind(account)
        .bind(&line.role)
        .bind(&text)
        .bind(via)
        .bind(verdict)
        .bind(call)
        .bind(&line.item)
        .execute(&mut *tx)
        .await?;
        if inserted.rows_affected() == 1 {
            if line.role == "learner" {
                learner_lines += 1;
            }
            added.push(id);
        }
    }
    let session: Session = sqlx::query_as(
        "UPDATE english_sessions SET last_at = now(), turns = turns + $2 WHERE id = $1 \
         RETURNING id, started_at, last_at, finished_at, turns, correct, mistakes, memory_action",
    )
    .bind(session)
    .bind(i32::try_from(learner_lines).unwrap_or(0))
    .fetch_one(&mut *tx)
    .await?;
    crate::practice_talk(&mut tx, account, learner_lines).await?;
    let mut out = Vec::with_capacity(added.len());
    for id in added {
        out.push(message(&mut tx, id).await?);
    }
    tx.commit().await?;
    Ok((session, out))
}

/// Конец сеанса: длительность (без пауз, по словам экрана) — в учёт шлюза;
/// `end` — ещё и закончить разговор (итог — в «Английский.md»).
/// Возвращает засчитанные секунды и закрытый разговор.
pub async fn finish(
    pool: &PgPool,
    gateway: &Gateway,
    account: Uuid,
    call: Uuid,
    seconds: u64,
    end: bool,
) -> Result<(u64, Option<Session>)> {
    may_write(pool, account).await?;
    // Сеанс — свой (это проверяет шлюз); у диктовки разговора нет.
    let counted = gateway.realtime_finish(account, call, seconds).await?;
    let closed = if end {
        crate::finish(pool, account).await?
    } else {
        None
    };
    Ok((counted, closed))
}

// ---------------------------------------------------------------- диктовка

/// Диктовка через ChatGPT: временный ключ сеанса только распознавания
/// (`gpt-4o-mini-transcribe`, до 2 минут). Браузер подключается так же, как к
/// живому разговору, и получает текст событиями. Нет подписки —
/// [`Error::NoSubscription`]: экран берёт запасной путь ([`transcribe`]).
pub async fn dictation(
    pool: &PgPool,
    gateway: &Gateway,
    account: Uuid,
    key: Uuid,
    language: Option<String>,
) -> Result<RealtimeSession> {
    may_write(pool, account).await?;
    if language
        .as_deref()
        .is_some_and(|l| l.len() != 2 || !l.bytes().all(|b| b.is_ascii_lowercase()))
    {
        return Err(Error::Invalid("язык — две буквы, например en".into()));
    }
    if !chatgpt::status(pool, account).await?.connected {
        return Err(Error::NoSubscription);
    }
    let auth = crate::may_use_ai(pool, account).await?;
    Ok(gateway
        .realtime_open(
            &auth,
            RealtimeRequest::dictation(format!("english:{key}:dictation"), language),
        )
        .await?)
}

/// Запасной путь диктовки — запись целиком через ElevenLabs (AI-шлюз,
/// бюджет owner). Возвращает распознанный текст.
#[allow(clippy::too_many_arguments)]
pub async fn transcribe(
    pool: &PgPool,
    gateway: &Gateway,
    settings: &crate::Settings,
    account: Uuid,
    key: Uuid,
    audio: Vec<u8>,
    mime: String,
    duration_ms: u64,
) -> Result<String> {
    may_write(pool, account).await?;
    let auth = crate::may_use_ai(pool, account).await?;
    let model = gateway.model_for(qubite_ai::voice::STT_TASK).await?;
    let heard = gateway
        .transcribe(
            &auth,
            qubite_ai::ListenRequest {
                request_id: format!("english:{key}:transcribe"),
                model,
                audio,
                mime,
                language: settings.listen_language.clone(),
                duration_ms,
            },
        )
        .await?;
    Ok(heard.text)
}
