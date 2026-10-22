//! Разговор потоком (ENG-001, дополнение владельца: «отвечать почти сразу, как
//! живой собеседник, ~1 с от конца фразы до начала ответа», D-457…D-459).
//!
//! Ничего не ждёт целиком:
//! 1. **Слух** — звук идёт кусками PCM 16 кГц прямо в живое распознавание
//!    (ElevenLabs `scribe_v2_realtime`, [`Gateway::listen_live`]); конец фразы —
//!    пауза (VAD провайдера) или «Готово» с экрана. Нет живого — запись
//!    распознаётся целиком после паузы ([`Gateway::transcribe`]).
//! 2. **Мозг** — модель репетитора через AI-шлюз **потоком**
//!    ([`Gateway::complete_stream`]): из кусков JSON на лету достаётся `say`
//!    ([`SayStream`]) и режется на предложения.
//! 3. **Голос** — каждое предложение сразу в потоковый синтез
//!    ([`Gateway::speak_stream`], Flash v2.5, PCM 24 кГц), куски звука — на экран,
//!    пока модель пишет остальное.
//! 4. **Перебили** ([`In::Interrupt`]) — голос замолкает сразу (новые куски и
//!    предложения не идут), а ответ модели дописывается и сохраняется: деньги
//!    за него уже зарезервированы, обрывать вызов шлюза нельзя.
//!
//! Каждый ход меряется ([`Latency`]): сколько от конца фразы до первого звука,
//! до первого текста, до распознанного, до конца ответа. Всё платное — через
//! шлюз с грантом и бюджетом, как и ход целиком ([`crate::turn`]).

use std::{
    collections::VecDeque,
    sync::atomic::{AtomicBool, Ordering},
    time::Instant,
};

use qubite_ai::{
    AiError, Gateway, InTurn, ListenRequest, SpeakRequest,
    voice::{self, LiveListen, LiveOut, LiveRequest},
};
use qubite_policy::{Authorized, UseAi};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

use crate::{Error, Learner, MAX_TEXT, Result, Session, Settings, Turn, tutor, voice as ready};

/// Частота звука с микрофона (PCM 16 бит, моно).
pub const SAMPLE_RATE: u32 = 16_000;
/// Пауза — конец фразы, с (VAD провайдера; экран ждёт столько же).
pub const SILENCE_SECS: f32 = 0.5;
/// Частота потоковой речи (PCM 16 бит, моно).
pub const SPEECH_RATE: u32 = 24_000;

/// Замеры одного хода, мс от конца фразы (паузы или «Готово»; у текста — от
/// отправки).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Latency {
    /// До первого куска голоса на экран — главное: «через сколько ответил».
    pub first_audio_ms: Option<u64>,
    /// До первого слова ответа.
    pub first_text_ms: Option<u64>,
    /// Распознавание после конца фразы (живое — почти 0).
    pub heard_ms: Option<u64>,
    /// Модель дописала ответ.
    pub reply_ms: u64,
}

/// Что приходит с экрана.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum In {
    /// Начал говорить (микрофон включён).
    Listen,
    /// Кусок PCM 16 кГц.
    Audio(Vec<u8>),
    /// Фраза кончилась (экран услышал паузу или нажали «Готово»).
    Done,
    /// Написал текстом.
    Text(String),
    /// Перебил: репетитор, замолчи.
    Interrupt,
}

/// Что уходит на экран.
#[derive(Debug, Clone)]
pub enum Out {
    /// Черновик распознавания (пока говоришь).
    Partial(String),
    /// Фраза распознана — репетитор думает.
    Heard(String),
    /// Кусок ответа репетитора (текст появляется, пока модель пишет).
    Say(String),
    /// Кусок голоса: PCM 16 бит, [`SPEECH_RATE`].
    Audio(Vec<u8>),
    /// Ход записан: реплики с разбором ошибок.
    Reply(Box<Turn>),
    Metrics(Latency),
    Error {
        code: &'static str,
        message: String,
        heard: Option<String>,
        /// Повтор не поможет: экран выключает микрофон и ждёт «Попробовать
        /// снова», а не слушает по кругу. Решает только сервер ([`stops`]).
        stop: bool,
    },
}

// ---------------------------------------------------------------- «say» на лету

/// Достаёт значение `say` из JSON, который модель ещё пишет, и режет его на
/// предложения: первое уходит в голос, пока модель пишет остальное. Ответ не
/// JSON — весь текст и есть слова репетитора.
#[derive(Debug, Default)]
pub struct SayStream {
    raw: String,
    mode: Mode,
    /// Где в `raw` остановились.
    pos: usize,
    /// Ещё не сказанный хвост (без конца предложения).
    pending: String,
}

#[derive(Debug, Default, PartialEq, Eq, Clone, Copy)]
enum Mode {
    #[default]
    Start,
    Seek,
    Inside,
    Plain,
    Done,
}

impl SayStream {
    /// Новый кусок от модели → (новый текст `say`, готовые предложения).
    pub fn push(&mut self, piece: &str) -> (String, Vec<String>) {
        self.raw.push_str(piece);
        let mut said = String::new();
        loop {
            match self.mode {
                Mode::Start => {
                    let Some(first) = self.raw.trim_start().chars().next() else {
                        break;
                    };
                    self.mode = if first == '{' || first == '`' {
                        Mode::Seek
                    } else {
                        Mode::Plain
                    };
                }
                Mode::Seek => {
                    let Some(at) = find_say(&self.raw[self.pos..]) else {
                        break;
                    };
                    self.pos += at;
                    self.mode = Mode::Inside;
                }
                Mode::Inside => {
                    let (text, used, closed) = unescape(&self.raw[self.pos..]);
                    self.pos += used;
                    said.push_str(&text);
                    if closed {
                        self.mode = Mode::Done;
                    }
                    break;
                }
                Mode::Plain => {
                    said.push_str(&self.raw[self.pos..]);
                    self.pos = self.raw.len();
                    break;
                }
                Mode::Done => break,
            }
        }
        self.pending.push_str(&said);
        let mut sentences = self.sentences();
        if self.mode == Mode::Done
            && let Some(rest) = self.finish()
        {
            sentences.push(rest);
        }
        (said, sentences)
    }

    /// Модель дописала: хвост — последним предложением.
    pub fn finish(&mut self) -> Option<String> {
        let rest = std::mem::take(&mut self.pending);
        let rest = rest.trim();
        (!rest.is_empty()).then(|| rest.to_owned())
    }

    /// Что-нибудь из `say` уже пришло.
    pub fn started(&self) -> bool {
        matches!(self.mode, Mode::Inside | Mode::Plain | Mode::Done)
    }

    /// Готовые предложения из `pending`: конец — `.`, `!`, `?`, `…` и пробел.
    fn sentences(&mut self) -> Vec<String> {
        let mut out = Vec::new();
        loop {
            let chars: Vec<(usize, char)> = self.pending.char_indices().collect();
            let cut = chars.windows(2).find_map(|pair| {
                let ((_, c), (next_at, next)) = (pair[0], pair[1]);
                (matches!(c, '.' | '!' | '?' | '…') && next.is_whitespace()).then_some(next_at)
            });
            let Some(cut) = cut else { break };
            let sentence = self.pending[..cut].trim().to_owned();
            self.pending = self.pending[cut..].to_owned();
            if !sentence.is_empty() {
                out.push(sentence);
            }
        }
        out
    }
}

/// Где начинается значение `"say": "` — позиция сразу после открывающей кавычки.
fn find_say(raw: &str) -> Option<usize> {
    let key = raw.find("\"say\"")?;
    let rest = &raw[key + 5..];
    let colon = rest.find(|c: char| !c.is_whitespace())?;
    if !rest[colon..].starts_with(':') {
        return None;
    }
    let after = &rest[colon + 1..];
    let quote = after.find(|c: char| !c.is_whitespace())?;
    after[quote..]
        .starts_with('"')
        .then(|| key + 5 + colon + 1 + quote + 1)
}

/// Разобрать строку JSON до закрывающей кавычки: (текст, сколько байт съели,
/// закрылась ли). Неполное экранирование в конце — ждём следующий кусок.
fn unescape(raw: &str) -> (String, usize, bool) {
    let mut out = String::new();
    let mut used = 0;
    let mut chars = raw.char_indices().peekable();
    while let Some((at, c)) = chars.next() {
        match c {
            '"' => return (out, at + 1, true),
            '\\' => {
                let Some(&(_, next)) = chars.peek() else {
                    return (out, used, false);
                };
                chars.next();
                match next {
                    'n' => out.push(' '),
                    't' => out.push(' '),
                    'u' => {
                        let hex = raw.get(at + 2..at + 6);
                        let Some(code) = hex.and_then(|h| u32::from_str_radix(h, 16).ok()) else {
                            return (out, used, false);
                        };
                        out.extend(char::from_u32(code));
                        for _ in 0..4 {
                            chars.next();
                        }
                        used = at + 6;
                        continue;
                    }
                    other => out.push(other), // \" \\ \/
                }
                used = at + 2;
            }
            other => {
                out.push(other);
                used = at + other.len_utf8();
            }
        }
    }
    (out, used, false)
}

/// PCM 16 бит моно → WAV (для «Ещё раз» и распознавания записи целиком).
pub fn wav(pcm: &[u8], rate: u32) -> Vec<u8> {
    let len = u32::try_from(pcm.len()).unwrap_or(u32::MAX);
    let mut out = Vec::with_capacity(pcm.len() + 44);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // моно
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&len.to_le_bytes());
    out.extend_from_slice(pcm);
    out
}

fn ms(since: Instant) -> u64 {
    u64::try_from(since.elapsed().as_millis()).unwrap_or(u64::MAX)
}

/// Отказ, который не пройдёт от повтора (лимит, зацикливание, нет прав, модель
/// закрыта, отказ провайдера): экран выключает микрофон и ждёт «Попробовать
/// снова», а не слушает по кругу.
fn stops(error: &Error) -> bool {
    match error {
        Error::Denied(_) => true,
        Error::Ai { error, .. } => matches!(
            error,
            AiError::Denied(_)
                | AiError::ModelNotAllowed
                | AiError::ModelBlocked(_)
                | AiError::NoModelForTask(_)
                | AiError::BudgetNotSet
                | AiError::BudgetExhausted { .. }
                | AiError::PlatformCapNotSet
                | AiError::RateLimited { .. }
                | AiError::RepeatedRequest
                | AiError::SubscriptionLimit { .. }
                // 302 из закрытой страны, неверный ключ: повтор не поможет (D-515).
                | AiError::ProviderRefused { .. }
        ),
        Error::NotFound | Error::Invalid(_) | Error::Db(_) | Error::Policy(_) => false,
    }
}

fn error_out(error: Error) -> Out {
    let (heard, message) = match &error {
        Error::Ai { heard, error } => (heard.clone(), error.to_string()),
        other => (None, other.to_string()),
    };
    Out::Error {
        code: error.code(),
        stop: stops(&error),
        message,
        heard,
    }
}

/// Окончательный отказ без [`Error`] (голос не настроен, провайдер закрыл
/// распознавание насовсем).
fn stop_out(code: &'static str, message: String) -> Out {
    Out::Error {
        code,
        message,
        heard: None,
        stop: true,
    }
}

// ---------------------------------------------------------------- ход потоком

/// Один ход потоком: модель пишет — предложения сразу в голос — куски звука на
/// экран. Возвращает записанный ход; замеры и звук уходят в `out` по ходу.
#[allow(clippy::too_many_arguments)]
async fn speak_turn(
    pool: &PgPool,
    gateway: &Gateway,
    ai: InTurn<'_>,
    settings: &Settings,
    account: Uuid,
    auth: &Authorized<UseAi>,
    session: &Session,
    learner: Learner,
    mut latency: Latency,
    started: Instant,
    speak: bool,
    muted: &AtomicBool,
    out: &mpsc::Sender<Out>,
) -> Result<Turn> {
    let key = Uuid::now_v7();
    let heard = (learner.via == "voice").then_some(learner.text.as_str());
    let request = crate::tutor_request(pool, gateway, account, session.id, key, &learner.text)
        .await
        .map_err(|error| match error {
            Error::Ai { error, .. } => crate::with_heard(error, heard),
            other => other,
        })?;
    let tts_model = if speak {
        gateway.model_for(voice::TTS_TASK).await.ok()
    } else {
        None
    };
    let (delta_tx, mut delta_rx) = mpsc::unbounded_channel::<String>();
    let model = ai.complete_stream(auth, request, delta_tx);

    let speaker = async {
        let mut say = SayStream::default();
        let mut queue: VecDeque<String> = VecDeque::new();
        let mut model_done = false;
        let mut audio: Vec<u8> = Vec::new();
        let mut cost = 0;
        let mut tts_call = None;
        let mut broken = false;
        let mut first_text = None;
        let mut first_audio = None;
        let mut sentence_no = 0u32;
        // Кусок от модели: текст — на экран, готовые предложения — в очередь голоса.
        let take = |piece: Option<String>,
                    say: &mut SayStream,
                    queue: &mut VecDeque<String>,
                    model_done: &mut bool,
                    first_text: &mut Option<u64>| {
            match piece {
                Some(piece) => {
                    let (text, sentences) = say.push(&piece);
                    queue.extend(sentences);
                    (!text.is_empty()).then(|| {
                        first_text.get_or_insert_with(|| ms(started));
                        text
                    })
                }
                None => {
                    *model_done = true;
                    queue.extend(say.finish());
                    None
                }
            }
        };
        loop {
            if let Some(sentence) = queue.pop_front() {
                let Some(model_id) = tts_model.as_ref().filter(|_| !broken) else {
                    continue;
                };
                if muted.load(Ordering::SeqCst) {
                    continue;
                }
                sentence_no += 1;
                let stream = ai
                    .speak_stream(
                        auth,
                        SpeakRequest {
                            request_id: format!("english:{key}:tts:{sentence_no}"),
                            model: model_id.clone(),
                            voice: settings.voice.clone(),
                            text: sentence,
                        },
                    )
                    .await;
                let mut stream = match stream {
                    Ok(stream) => stream,
                    Err(error) => {
                        // Голоса нет — ответ всё равно придёт текстом.
                        broken = true;
                        let _ = out.send(error_out(Error::from(error))).await;
                        continue;
                    }
                };
                cost += stream.cost_usd;
                tts_call.get_or_insert(stream.call_id);
                loop {
                    tokio::select! {
                        chunk = stream.chunks.recv() => match chunk {
                            Some(Ok(bytes)) => {
                                if muted.load(Ordering::SeqCst) {
                                    break;
                                }
                                first_audio.get_or_insert_with(|| ms(started));
                                audio.extend_from_slice(&bytes);
                                let _ = out.send(Out::Audio(bytes)).await;
                            }
                            Some(Err(_)) => {
                                broken = true;
                                break;
                            }
                            None => break,
                        },
                        piece = delta_rx.recv(), if !model_done => {
                            if let Some(text) = take(piece, &mut say, &mut queue, &mut model_done, &mut first_text) {
                                let _ = out.send(Out::Say(text)).await;
                            }
                        }
                    }
                }
            } else if model_done {
                break;
            } else {
                let piece = delta_rx.recv().await;
                if let Some(text) = take(
                    piece,
                    &mut say,
                    &mut queue,
                    &mut model_done,
                    &mut first_text,
                ) {
                    let _ = out.send(Out::Say(text)).await;
                }
            }
        }
        (
            say.started(),
            audio,
            cost,
            tts_call,
            broken,
            first_text,
            first_audio,
        )
    };

    let (
        response,
        (streamed, mut audio, mut cost, mut tts_call, broken, first_text, mut first_audio),
    ) = tokio::join!(model, speaker);
    let response = response.map_err(|error| crate::with_heard(error, heard))?;
    latency.reply_ms = ms(started);
    latency.first_text_ms = first_text;
    let reply = tutor::parse(&response.text);
    // Модель ответила не JSON-ом с «say» — скажем разобранный ответ целиком.
    if !streamed && !muted.load(Ordering::SeqCst) {
        let _ = out.send(Out::Say(reply.say.clone())).await;
        if let (Some(model_id), false) = (tts_model.as_ref(), broken)
            && let Ok(mut stream) = ai
                .speak_stream(
                    auth,
                    SpeakRequest {
                        request_id: format!("english:{key}:tts:all"),
                        model: model_id.clone(),
                        voice: settings.voice.clone(),
                        text: reply.say.clone(),
                    },
                )
                .await
        {
            cost += stream.cost_usd;
            tts_call.get_or_insert(stream.call_id);
            while let Some(Ok(bytes)) = stream.chunks.recv().await {
                if muted.load(Ordering::SeqCst) {
                    break;
                }
                first_audio.get_or_insert_with(|| ms(started));
                audio.extend_from_slice(&bytes);
                let _ = out.send(Out::Audio(bytes)).await;
            }
        }
    }
    latency.first_audio_ms = first_audio;
    // Речь целиком (не перебили, не оборвалась) — на «Ещё раз» бесплатно.
    let speech = (!audio.is_empty() && !broken && !muted.load(Ordering::SeqCst))
        .then(|| tts_call.map(|call| (wav(&audio, SPEECH_RATE), "audio/wav".to_owned(), call)))
        .flatten();
    let (session, learner, tutor) = crate::save(
        pool,
        account,
        session.id,
        &learner,
        &reply,
        response.call_id,
        serde_json::to_value(&latency).ok(),
        speech,
    )
    .await?;
    let _ = out.send(Out::Metrics(latency)).await;
    Ok(Turn {
        session,
        learner,
        tutor,
        cost_usd_micros: response.cost_usd + cost,
    })
}

// ---------------------------------------------------------------- разговор

/// Слушаем фразу: живое распознавание или запись целиком (запасной путь).
enum Ear<'g> {
    Live(Box<LiveListen<'g>>),
    Record(Vec<u8>),
}

/// Разговор потоком: читает [`In`] с экрана, пишет [`Out`]. Кончается, когда
/// экран закрыл соединение. Права — как у хода: `write` и `ai` в модуле агента.
pub async fn serve(
    pool: &PgPool,
    gateway: &Gateway,
    settings: &Settings,
    account: Uuid,
    mut inbox: mpsc::Receiver<In>,
    out: mpsc::Sender<Out>,
) -> Result<()> {
    let voice = match ready(gateway).await {
        Ok(voice) => voice,
        Err(error) => {
            // Экран узнаёт причину и не переподключается по кругу.
            let _ = out.send(error_out(error)).await;
            return Ok(());
        }
    };
    let mut backlog: VecDeque<In> = VecDeque::new();
    let mut ear: Option<Ear<'_>> = None;
    // Ход начинается с фразы: распознавание, ответ и голос — один запрос
    // для защиты от зацикливания.
    let mut turn: Option<InTurn<'_>> = None;
    let mut closed = false;
    loop {
        // Следующее событие: отложенное (пришло, пока говорил репетитор), с
        // экрана или от живого распознавания.
        enum Event {
            In(Option<In>),
            Live(Option<LiveOut>),
        }
        let event = if let Some(msg) = backlog.pop_front() {
            Event::In(Some(msg))
        } else if closed {
            Event::In(None)
        } else if let Some(Ear::Live(listen)) = ear.as_mut() {
            tokio::select! {
                msg = inbox.recv() => Event::In(msg),
                live = listen.next() => Event::Live(live),
            }
        } else {
            Event::In(inbox.recv().await)
        };

        // Что сказал ученик (фраза кончилась) — тогда ход.
        let mut said: Option<(Learner, Latency, Instant, InTurn<'_>)> = None;
        match event {
            Event::In(None) => {
                if let Some(Ear::Live(listen)) = ear.take() {
                    let _ = listen.finish().await;
                }
                return Ok(());
            }
            Event::In(Some(In::Listen)) => {
                if ear.is_some() {
                    continue;
                }
                if !voice.listen && !voice.live {
                    let _ = out
                        .send(stop_out(
                            "invalid",
                            "голос не настроен — пиши текстом".into(),
                        ))
                        .await;
                    continue;
                }
                let auth = match crate::may_use_ai(pool, account).await {
                    Ok(auth) => auth,
                    Err(error) => {
                        let _ = out.send(error_out(error)).await;
                        continue;
                    }
                };
                ear = Some(Ear::Record(Vec::new()));
                let ai = gateway.turn();
                turn = Some(ai);
                if voice.live
                    && let Ok(model) = gateway.model_for(voice::STT_LIVE_TASK).await
                {
                    match ai
                        .listen_live(
                            &auth,
                            LiveRequest {
                                request_id: format!("english:{}:live", Uuid::now_v7()),
                                model,
                                language: settings.listen_language.clone(),
                                sample_rate: SAMPLE_RATE,
                                silence_secs: SILENCE_SECS,
                            },
                        )
                        .await
                    {
                        Ok(listen) => ear = Some(Ear::Live(Box::new(listen))),
                        Err(error) => {
                            let error = Error::from(error);
                            if stops(&error) {
                                // Лимит, зацикливание, отказ: запись целиком упрётся в то же.
                                ear = None;
                                turn = None;
                                let _ = out.send(error_out(error)).await;
                            } else {
                                // Живое не открылось — распознаем запись целиком.
                                tracing::warn!(%error, "живое распознавание не открылось");
                            }
                        }
                    }
                }
            }
            Event::In(Some(In::Audio(pcm))) => match ear.as_mut() {
                Some(Ear::Live(listen)) => {
                    if let Err(error) = listen.send(pcm).await {
                        let _ = out.send(error_out(Error::from(error))).await;
                        if let Some(Ear::Live(listen)) = ear.take() {
                            let _ = listen.finish().await;
                        }
                    }
                }
                Some(Ear::Record(buffer)) => {
                    let limit = usize::try_from(voice::MAX_SECONDS).unwrap_or(120)
                        * SAMPLE_RATE as usize
                        * 2;
                    if buffer.len() + pcm.len() <= limit {
                        buffer.extend_from_slice(&pcm);
                    }
                }
                None => {}
            },
            Event::In(Some(In::Done)) => match ear.take() {
                Some(Ear::Live(listen)) => {
                    // Ждём фразу от распознавания (оно уже почти всё знает).
                    listen.commit().await;
                    ear = Some(Ear::Live(listen));
                }
                Some(Ear::Record(pcm)) if !pcm.is_empty() => {
                    let started = Instant::now();
                    let ai = turn.take().unwrap_or_else(|| gateway.turn());
                    match transcribe(pool, gateway, ai, settings, account, pcm).await {
                        Ok(learner) => {
                            let latency = Latency {
                                heard_ms: Some(ms(started)),
                                ..Latency::default()
                            };
                            let _ = out.send(Out::Heard(learner.text.clone())).await;
                            said = Some((learner, latency, started, ai));
                        }
                        Err(error) => {
                            let _ = out.send(error_out(error)).await;
                        }
                    }
                }
                _ => {}
            },
            Event::In(Some(In::Text(text))) => match crate::check_text(&text) {
                Ok(text) => {
                    said = Some((
                        Learner {
                            text,
                            via: "text",
                            stt_call: None,
                        },
                        Latency::default(),
                        Instant::now(),
                        gateway.turn(),
                    ));
                }
                Err(error) => {
                    let _ = out.send(error_out(error)).await;
                }
            },
            Event::In(Some(In::Interrupt)) => {}
            Event::Live(Some(LiveOut::Partial(text))) => {
                let _ = out.send(Out::Partial(text)).await;
            }
            Event::Live(Some(LiveOut::Committed(text))) => {
                let started = Instant::now();
                let Some(Ear::Live(listen)) = ear.take() else {
                    continue;
                };
                let ai = turn.take().unwrap_or_else(|| gateway.turn());
                let call = listen.finish().await.ok().map(|(call, _, _)| call);
                let text: String = text.trim().chars().take(MAX_TEXT).collect();
                if text.is_empty() {
                    let _ = out
                        .send(error_out(Error::Invalid(
                            "не расслышал ни слова — скажи ещё раз".into(),
                        )))
                        .await;
                    continue;
                }
                let _ = out.send(Out::Heard(text.clone())).await;
                said = Some((
                    Learner {
                        text,
                        via: "voice",
                        stt_call: call,
                    },
                    Latency {
                        heard_ms: Some(0),
                        ..Latency::default()
                    },
                    started,
                    ai,
                ));
            }
            Event::Live(Some(LiveOut::Refused(reason))) => {
                // Провайдер отказал насовсем (ключ, символы): не слушать по кругу.
                if let Some(Ear::Live(listen)) = ear.take() {
                    let _ = listen.finish().await;
                }
                turn = None;
                let _ = out
                    .send(stop_out(
                        "provider_refused",
                        format!("провайдер отказал ({reason})"),
                    ))
                    .await;
            }
            Event::Live(failed) => {
                // Распознавание оборвалось: закрыть вызов, сказать экрану.
                if let Some(Ear::Live(listen)) = ear.take() {
                    let _ = listen.finish().await;
                }
                let reason = match failed {
                    Some(LiveOut::Failed(reason)) => reason,
                    _ => "распознавание закрыло соединение".to_owned(),
                };
                let _ = out
                    .send(Out::Error {
                        code: "provider_unavailable",
                        message: format!("{reason} — скажи ещё раз или напиши"),
                        heard: None,
                        stop: false,
                    })
                    .await;
            }
        }

        let Some((learner, latency, started, ai)) = said else {
            continue;
        };
        // Ход: пока репетитор отвечает, экран может перебить; остальное — после.
        let (auth, session) = match crate::begin(pool, account).await {
            Ok(begun) => begun,
            Err(error) => {
                let _ = out.send(error_out(error)).await;
                continue;
            }
        };
        let muted = AtomicBool::new(false);
        let reply = speak_turn(
            pool,
            gateway,
            ai,
            settings,
            account,
            &auth,
            &session,
            learner,
            latency,
            started,
            voice.speak,
            &muted,
            &out,
        );
        tokio::pin!(reply);
        let result = loop {
            tokio::select! {
                result = &mut reply => break result,
                msg = inbox.recv(), if !closed => match msg {
                    Some(In::Interrupt) => muted.store(true, Ordering::SeqCst),
                    // Заговорил поверх — тоже перебил; звук его фразы не теряем.
                    Some(In::Listen) => {
                        muted.store(true, Ordering::SeqCst);
                        backlog.push_back(In::Listen);
                    }
                    Some(other) => backlog.push_back(other),
                    None => {
                        closed = true;
                        muted.store(true, Ordering::SeqCst);
                    }
                },
            }
        };
        match result {
            Ok(turn) => {
                let _ = out.send(Out::Reply(Box::new(turn))).await;
            }
            Err(error) => {
                let _ = out.send(error_out(error)).await;
            }
        }
    }
}

/// Запасной путь: запись целиком → распознавание через шлюз.
async fn transcribe(
    pool: &PgPool,
    gateway: &Gateway,
    ai: InTurn<'_>,
    settings: &Settings,
    account: Uuid,
    pcm: Vec<u8>,
) -> Result<Learner> {
    let auth = crate::may_use_ai(pool, account).await?;
    let model = gateway.model_for(voice::STT_TASK).await?;
    let duration_ms = pcm.len() as u64 * 1000 / (u64::from(SAMPLE_RATE) * 2);
    let heard = ai
        .transcribe(
            &auth,
            ListenRequest {
                request_id: format!("english:{}:stt", Uuid::now_v7()),
                model,
                audio: wav(&pcm, SAMPLE_RATE),
                mime: "audio/wav".into(),
                language: settings.listen_language.clone(),
                duration_ms,
            },
        )
        .await?;
    let text: String = heard.text.trim().chars().take(MAX_TEXT).collect();
    if text.is_empty() {
        return Err(Error::Invalid(
            "не расслышал ни слова — скажи ещё раз, ближе к микрофону".into(),
        ));
    }
    Ok(Learner {
        text,
        via: "voice",
        stt_call: Some(heard.call_id),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn feed(chunks: &[&str]) -> (String, Vec<String>) {
        let mut say = SayStream::default();
        let mut text = String::new();
        let mut sentences = Vec::new();
        for chunk in chunks {
            let (t, s) = say.push(chunk);
            text.push_str(&t);
            sentences.extend(s);
        }
        sentences.extend(say.finish());
        (text, sentences)
    }

    #[test]
    fn say_is_pulled_out_of_json_while_it_is_written() {
        let mut say = SayStream::default();
        assert_eq!(say.push("{\"sa").0, "");
        assert_eq!(say.push("y\": \"\\\"I go").0, "\"I go");
        let (text, sentences) = say.push("ed\\\"? Wrong. Say it ");
        assert_eq!(text, "ed\"? Wrong. Say it ");
        assert_eq!(
            sentences,
            ["\"I goed\"?", "Wrong."],
            "первое предложение — в голос сразу"
        );
        let (_, sentences) = say.push("again.\", \"verdict\": \"mistake\"}");
        assert_eq!(sentences, ["Say it again."]);
        assert_eq!(say.push(" more").0, "", "после say — ничего");
    }

    #[test]
    fn escapes_split_across_chunks_wait_for_the_rest() {
        let (text, _) = feed(&["{\"say\": \"caf", "\\", "u00e9 ok\\", "n!\"}"]);
        assert_eq!(text, "café ok !");
    }

    #[test]
    fn plain_text_reply_is_all_say() {
        let (text, sentences) = feed(&["Hello there. ", "How are you?"]);
        assert_eq!(text, "Hello there. How are you?");
        assert_eq!(sentences, ["Hello there.", "How are you?"]);
    }

    #[test]
    fn wav_header_is_valid() {
        let out = wav(&[0, 0, 1, 0], 16_000);
        assert_eq!(&out[..4], b"RIFF");
        assert_eq!(&out[8..16], b"WAVEfmt ");
        assert_eq!(u32::from_le_bytes(out[24..28].try_into().unwrap()), 16_000);
        assert_eq!(u32::from_le_bytes(out[40..44].try_into().unwrap()), 4);
        assert_eq!(out.len(), 48);
    }
}
