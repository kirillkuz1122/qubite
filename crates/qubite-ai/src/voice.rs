//! Голосовой слой (ENG-001, D-451): распознавание речи (STT) и речь (TTS)
//! через тот же шлюз, что и модели, — с грантом, резервом бюджета, защитой от
//! зацикливания и журналом расходов. Его берут «Английский» (ENG-001, ENG-002)
//! и голосовой ввод (CMD-005).
//!
//! Голосовая модель — обычная строка `ai_models` со способностью `stt` или
//! `tts`; цена в каталоге — микродоллары **за миллион единиц**: у `stt`
//! единица — секунда звука, у `tts` — знак текста. Текстовой моделью нельзя
//! «распознать», а голосовой — «ответить текстом» ([`crate::Work::fits`]).
//!
//! Провайдеры: ElevenLabs ([`crate::elevenlabs`]); дальше — Whisper,
//! OpenRouter, ChatGPT (D-299) тем же трейтом [`VoiceProvider`]. В тестах —
//! [`MockVoice`], платных запросов нет.

use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use qubite_policy::{Authorized, UseAi};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    AiError, Done, Gateway, InTurn, Opened, Plan, Result, Usage, Work,
    provider::{BoxFuture, ProviderError},
};

/// Способность модели «распознаёт речь».
pub const STT: &str = "stt";
/// Способность модели «говорит».
pub const TTS: &str = "tts";
/// Способность модели «распознаёт речь на ходу» (единица — секунда звука).
pub const STT_LIVE: &str = "stt_live";
/// Задача шлюза: модель живого распознавания.
pub const STT_LIVE_TASK: &str = "voice.stt.live";
/// Задачи шлюза: модель распознавания и речи по умолчанию (`ai_model_defaults`).
pub const STT_TASK: &str = "voice.stt";
pub const TTS_TASK: &str = "voice.tts";

/// Самая длинная запись за раз, секунд: столько резервируется заранее.
pub const MAX_SECONDS: u64 = 120;
/// Самая большая запись, байт (минута речи в Opus — около 250 КБ; в JSON
/// base64 — 1,6 МБ, под лимит тела запроса).
pub const MAX_AUDIO_BYTES: usize = 1_200_000;
/// Самый длинный текст для речи, знаков.
pub const MAX_SPEECH_CHARS: usize = 1_000;

/// Что отдать провайдеру распознавания.
#[derive(Debug, Clone)]
pub struct SttCall {
    pub external_id: String,
    pub audio: Vec<u8>,
    /// `audio/webm`, `audio/ogg`, `audio/mp4`, `audio/wav` …
    pub mime: String,
    /// `en`, `ru`; `None` — провайдер определит сам.
    pub language: Option<String>,
    pub account_id: Uuid,
}

/// Что распознано.
#[derive(Debug, Clone, PartialEq)]
pub struct Heard {
    pub text: String,
    /// Язык, который определил провайдер.
    pub language: Option<String>,
    /// Длина звука, если провайдер её сообщил (конец последнего слова).
    pub seconds: Option<f64>,
}

/// Что сказать голосом.
#[derive(Debug, Clone)]
pub struct TtsCall {
    pub external_id: String,
    /// Голос у провайдера.
    pub voice: String,
    pub text: String,
    pub account_id: Uuid,
}

/// Формат потоковой речи: PCM 16 бит, 24 кГц, моно — браузер играет кусками
/// сразу (Web Audio), без ожидания целого файла.
pub const STREAM_MIME: &str = "audio/pcm;rate=24000";

/// Куски речи по мере синтеза. Ошибка посреди потока — последним элементом.
pub type AudioChunks = tokio::sync::mpsc::Receiver<Result<Vec<u8>, ProviderError>>;

/// Живое распознавание: что идёт провайдеру.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiveIn {
    /// PCM 16 бит моно с частотой [`LiveCall::sample_rate`].
    Audio(Vec<u8>),
    /// Фраза кончилась (кнопка «Готово»): распознай, что есть.
    Commit,
}

/// Живое распознавание: что пришло от провайдера.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LiveOut {
    /// Черновик (ещё изменится).
    Partial(String),
    /// Фраза кончилась (провайдер услышал паузу или была команда «Готово»).
    Committed(String),
    /// Провайдер оборвал распознавание (можно сказать ещё раз).
    Failed(String),
    /// Провайдер отказал насовсем (неверный ключ, кончились символы):
    /// повтор упрётся в то же.
    Refused(String),
}

/// Что открыть у провайдера живого распознавания.
#[derive(Debug, Clone)]
pub struct LiveCall {
    pub external_id: String,
    pub language: Option<String>,
    /// Частота PCM, Гц (16 000).
    pub sample_rate: u32,
    /// Сколько тишины — конец фразы, с.
    pub silence_secs: f32,
    pub account_id: Uuid,
}

/// Открытое живое распознавание: звук — в `audio`, текст — из `events`.
pub struct LiveLink {
    pub audio: tokio::sync::mpsc::Sender<LiveIn>,
    pub events: tokio::sync::mpsc::Receiver<LiveOut>,
}

/// Готовая речь.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Spoken {
    pub audio: Vec<u8>,
    /// `audio/mpeg`.
    pub mime: String,
}

/// Адаптер голосового провайдера. Код модулей его не видит: вызвать может
/// только шлюз после проверки прав и резерва.
pub trait VoiceProvider: Send + Sync {
    fn transcribe<'a>(&'a self, call: &'a SttCall) -> BoxFuture<'a, Result<Heard, ProviderError>>;
    fn speak<'a>(&'a self, call: &'a TtsCall) -> BoxFuture<'a, Result<Spoken, ProviderError>>;

    /// Речь потоком ([`STREAM_MIME`]): куски по мере синтеза. Провайдер без
    /// потока отдаёт целый звук одним куском.
    fn speak_stream<'a>(
        &'a self,
        call: &'a TtsCall,
    ) -> BoxFuture<'a, Result<AudioChunks, ProviderError>> {
        Box::pin(async move {
            let spoken = self.speak(call).await?;
            let (tx, rx) = tokio::sync::mpsc::channel(1);
            let _ = tx.send(Ok(spoken.audio)).await;
            Ok(rx)
        })
    }

    /// Живое распознавание: звук идёт кусками, текст приходит, пока человек
    /// говорит, конец фразы — по паузе. Нет у провайдера — отказ (экран
    /// распознаёт запись целиком, [`VoiceProvider::transcribe`]).
    fn listen_live<'a>(
        &'a self,
        _call: &'a LiveCall,
    ) -> BoxFuture<'a, Result<LiveLink, ProviderError>> {
        Box::pin(async {
            Err(ProviderError::Refused("живого распознавания нет".into()))
        })
    }
}

/// Запрос на распознавание.
#[derive(Debug, Clone)]
pub struct ListenRequest {
    /// Как у [`crate::AiRequest`]: повтор с тем же ID не выполняется.
    pub request_id: String,
    pub model: String,
    pub audio: Vec<u8>,
    pub mime: String,
    pub language: Option<String>,
    /// Длина записи по словам клиента, мс (ей не верим больше, чем
    /// [`MAX_SECONDS`]; списание — не меньше длины по словам провайдера).
    pub duration_ms: u64,
}

/// Запрос на речь.
#[derive(Debug, Clone)]
pub struct SpeakRequest {
    pub request_id: String,
    pub model: String,
    pub voice: String,
    pub text: String,
}

/// Распознанный текст и цена.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Transcript {
    pub call_id: Uuid,
    pub text: String,
    pub language: Option<String>,
    /// Сколько секунд списано.
    pub seconds: u64,
    pub cost_usd: i64,
}

/// Речь и цена.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Speech {
    pub call_id: Uuid,
    pub audio: Vec<u8>,
    pub mime: String,
    pub cost_usd: i64,
}

/// Запись для [`crate::Work::Listen`].
pub(crate) struct Listen {
    pub(crate) audio: Vec<u8>,
    pub(crate) mime: String,
    pub(crate) language: Option<String>,
    /// Секунды по словам клиента (не больше [`MAX_SECONDS`]).
    pub(crate) claimed: u64,
}

/// Текст для [`crate::Work::Speak`].
pub(crate) struct Say {
    pub(crate) voice: String,
    pub(crate) text: String,
    /// Потоком ([`STREAM_MIME`]) или целым файлом (MP3).
    pub(crate) stream: bool,
}

/// Сколько секунд списать: большее из длины по словам клиента и по словам
/// провайдера, не меньше секунды и не больше резерва ([`MAX_SECONDS`]).
pub(crate) fn billed_seconds(heard: &Heard, listen: &Listen) -> u64 {
    let reported = heard.seconds.map_or(0, |s| s.max(0.0).ceil() as u64);
    reported.max(listen.claimed).clamp(1, MAX_SECONDS)
}

fn mime_ok(mime: &str) -> bool {
    let base = mime.split(';').next().unwrap_or("").trim();
    matches!(
        base,
        "audio/webm"
            | "audio/ogg"
            | "audio/mp4"
            | "audio/mpeg"
            | "audio/wav"
            | "audio/x-wav"
            | "audio/aac"
    )
}

impl Gateway {
    /// Подключить голосовой адаптер с этим ID провайдера (`ai_providers.id`).
    pub fn with_voice(mut self, provider_id: &str, provider: Arc<dyn VoiceProvider>) -> Self {
        self.voices.insert(provider_id.into(), provider);
        self
    }

    /// Готов ли голос этого вида (`STT` / `TTS`): адаптер подключён, модель
    /// задачи выбрана, включена и не заблокирована. Без этого экраны честно
    /// пишут «голос не настроен» и работают текстом.
    pub async fn voice_ready(&self, capability: &str) -> Result<bool> {
        let task = match capability {
            STT => STT_TASK,
            STT_LIVE => STT_LIVE_TASK,
            _ => TTS_TASK,
        };
        let Ok(model) = self.model_for(task).await else {
            return Ok(false);
        };
        let row: Option<(String, Vec<String>)> = sqlx::query_as(
            "SELECT m.provider_id, m.capabilities FROM ai_models m \
             JOIN ai_providers p ON p.id = m.provider_id \
             WHERE m.id = $1 AND m.enabled AND p.enabled AND m.blocked_reason IS NULL",
        )
        .bind(&model)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some_and(|(provider, capabilities)| {
            self.voices.contains_key(&provider) && capabilities.iter().any(|c| c == capability)
        }))
    }

    /// Распознать речь (STT).
    pub async fn transcribe(
        &self,
        auth: &Authorized<UseAi>,
        request: ListenRequest,
    ) -> Result<Transcript> {
        self.transcribe_in(auth, request, None).await
    }

    pub(crate) async fn transcribe_in(
        &self,
        auth: &Authorized<UseAi>,
        request: ListenRequest,
        turn: Option<Uuid>,
    ) -> Result<Transcript> {
        if request.audio.is_empty() {
            return Err(AiError::Invalid("пустая запись".into()));
        }
        if request.audio.len() > MAX_AUDIO_BYTES {
            return Err(AiError::Invalid(format!(
                "запись больше {} КБ — скажи короче",
                MAX_AUDIO_BYTES / 1000
            )));
        }
        if !mime_ok(&request.mime) {
            return Err(AiError::Invalid(format!(
                "неизвестный формат звука «{}»",
                request.mime
            )));
        }
        let claimed = request.duration_ms.div_ceil(1000);
        if claimed > MAX_SECONDS {
            return Err(AiError::Invalid(format!(
                "запись длиннее {MAX_SECONDS} с — скажи короче"
            )));
        }
        let listen = Listen {
            audio: request.audio,
            mime: request.mime,
            language: request.language,
            claimed,
        };
        let fingerprint = self.fingerprint([
            request.model.as_bytes(),
            b"stt".as_slice(),
            listen.audio.as_slice(),
        ]);
        let (call_id, done, cost_usd) = self
            .run(
                auth,
                Plan {
                    request_id: &request.request_id,
                    model: &request.model,
                    fingerprint,
                    input_units: MAX_SECONDS,
                    max_output_units: 0,
                    job_id: None,
                    turn,
                    signals: Vec::new(),
                    work: Work::Listen(&listen),
                },
            )
            .await?;
        let Done::Listen(heard) = done else {
            unreachable!("на распознавание — текст")
        };
        let seconds = billed_seconds(&heard, &listen);
        Ok(Transcript {
            call_id,
            text: heard.text.trim().to_owned(),
            language: heard.language,
            seconds,
            cost_usd,
        })
    }

    /// Сказать текст голосом (TTS). Списание — по числу знаков.
    pub async fn speak(&self, auth: &Authorized<UseAi>, request: SpeakRequest) -> Result<Speech> {
        self.speak_in(auth, request, None).await
    }

    pub(crate) async fn speak_in(
        &self,
        auth: &Authorized<UseAi>,
        request: SpeakRequest,
        turn: Option<Uuid>,
    ) -> Result<Speech> {
        let text = request.text.trim();
        if text.is_empty() {
            return Err(AiError::Invalid("нечего сказать".into()));
        }
        let chars = text.chars().count();
        if chars > MAX_SPEECH_CHARS {
            return Err(AiError::Invalid(format!(
                "текст для речи длиннее {MAX_SPEECH_CHARS} знаков"
            )));
        }
        if request.voice.trim().is_empty() {
            return Err(AiError::Invalid("голос не выбран".into()));
        }
        let say = Say {
            voice: request.voice.clone(),
            text: text.to_owned(),
            stream: false,
        };
        let fingerprint = self.fingerprint([
            request.model.as_bytes(),
            b"tts".as_slice(),
            request.voice.as_bytes(),
            text.as_bytes(),
        ]);
        let (call_id, done, cost_usd) = self
            .run(
                auth,
                Plan {
                    request_id: &request.request_id,
                    model: &request.model,
                    fingerprint,
                    input_units: chars as u64,
                    max_output_units: 0,
                    job_id: None,
                    turn,
                    signals: Vec::new(),
                    work: Work::Speak(&say),
                },
            )
            .await?;
        let Done::Speak(spoken) = done else {
            unreachable!("на речь — звук")
        };
        Ok(Speech {
            call_id,
            audio: spoken.audio,
            mime: spoken.mime,
            cost_usd,
        })
    }
}

/// Речь потоком и её цена (списана при старте: синтез платится за знаки).
pub struct SpeechStream {
    pub call_id: Uuid,
    pub chunks: AudioChunks,
    pub mime: &'static str,
    pub cost_usd: i64,
}

/// Запрос на живое распознавание.
#[derive(Debug, Clone)]
pub struct LiveRequest {
    pub request_id: String,
    pub model: String,
    pub language: Option<String>,
    pub sample_rate: u32,
    pub silence_secs: f32,
}

/// Открытое живое распознавание: резерв на [`MAX_SECONDS`] сделан до
/// соединения, списание — по секундам звука, который ушёл провайдеру
/// ([`LiveListen::finish`] — обязательно; без него вызов останется «неизвестен»,
/// и резерв удержится).
pub struct LiveListen<'g> {
    gateway: &'g Gateway,
    opened: Option<Opened>,
    link: LiveLink,
    bytes: u64,
    sample_rate: u32,
}

impl LiveListen<'_> {
    pub fn call_id(&self) -> Option<Uuid> {
        self.opened.as_ref().map(|o| o.id)
    }

    /// Секунд звука ушло (вверх).
    pub fn seconds(&self) -> u64 {
        self.bytes.div_ceil(u64::from(self.sample_rate) * 2)
    }

    /// Кусок PCM провайдеру. Больше [`MAX_SECONDS`] за фразу — отказ (резерв кончился).
    pub async fn send(&mut self, pcm: Vec<u8>) -> Result<()> {
        let next = self.bytes + pcm.len() as u64;
        if next.div_ceil(u64::from(self.sample_rate) * 2) > MAX_SECONDS {
            return Err(AiError::Invalid(format!(
                "фраза длиннее {MAX_SECONDS} с — скажи короче"
            )));
        }
        self.bytes = next;
        let _ = self.link.audio.send(LiveIn::Audio(pcm)).await;
        Ok(())
    }

    /// «Готово»: распознать, что сказано.
    pub async fn commit(&self) {
        let _ = self.link.audio.send(LiveIn::Commit).await;
    }

    /// Следующее событие (черновик, фраза, обрыв); `None` — провайдер закрыл.
    pub async fn next(&mut self) -> Option<LiveOut> {
        self.link.events.recv().await
    }

    /// Закрыть и списать по секундам звука (не меньше секунды, если звук был).
    /// Возвращает ID вызова, секунды и цену.
    pub async fn finish(mut self) -> Result<(Uuid, u64, i64)> {
        let opened = self.opened.take().expect("finish один раз");
        let seconds = self.seconds().min(MAX_SECONDS);
        let usage = Usage {
            units_in: seconds,
            units_out: 0,
            reported_usd: None,
        };
        let cost = self
            .gateway
            .settle_success(
                opened.id,
                &opened.model,
                &opened.reservations,
                opened.estimate_usd,
                usage,
                false,
            )
            .await?;
        Ok((opened.id, seconds, cost))
    }
}

impl Drop for LiveListen<'_> {
    fn drop(&mut self) {
        if let Some(opened) = &self.opened {
            tracing::warn!(call_id = %opened.id, "живое распознавание не закрыто — резерв удержится до выяснения");
        }
    }
}

impl Gateway {
    /// Речь потоком ([`STREAM_MIME`]): репетитор начинает говорить, пока
    /// синтез ещё идёт. Списание — сразу по числу знаков.
    pub async fn speak_stream(
        &self,
        auth: &Authorized<UseAi>,
        request: SpeakRequest,
    ) -> Result<SpeechStream> {
        self.speak_stream_in(auth, request, None).await
    }

    pub(crate) async fn speak_stream_in(
        &self,
        auth: &Authorized<UseAi>,
        request: SpeakRequest,
        turn: Option<Uuid>,
    ) -> Result<SpeechStream> {
        let text = request.text.trim();
        if text.is_empty() {
            return Err(AiError::Invalid("нечего сказать".into()));
        }
        let chars = text.chars().count();
        if chars > MAX_SPEECH_CHARS {
            return Err(AiError::Invalid(format!(
                "текст для речи длиннее {MAX_SPEECH_CHARS} знаков"
            )));
        }
        let say = Say {
            voice: request.voice.clone(),
            text: text.to_owned(),
            stream: true,
        };
        let fingerprint = self.fingerprint([
            request.model.as_bytes(),
            b"tts-stream".as_slice(),
            request.voice.as_bytes(),
            text.as_bytes(),
        ]);
        let (call_id, done, cost_usd) = self
            .run(
                auth,
                Plan {
                    request_id: &request.request_id,
                    model: &request.model,
                    fingerprint,
                    input_units: chars as u64,
                    max_output_units: 0,
                    job_id: None,
                    turn,
                    signals: Vec::new(),
                    work: Work::Speak(&say),
                },
            )
            .await?;
        let Done::SpeakStream(chunks) = done else {
            unreachable!("на поток речи — поток")
        };
        Ok(SpeechStream {
            call_id,
            chunks,
            mime: STREAM_MIME,
            cost_usd,
        })
    }

    /// Открыть живое распознавание: права, модель, защита от зацикливания и
    /// резерв на [`MAX_SECONDS`] — до соединения с провайдером.
    pub async fn listen_live(
        &self,
        auth: &Authorized<UseAi>,
        request: LiveRequest,
    ) -> Result<LiveListen<'_>> {
        self.listen_live_in(auth, request, None).await
    }

    pub(crate) async fn listen_live_in(
        &self,
        auth: &Authorized<UseAi>,
        request: LiveRequest,
        turn: Option<Uuid>,
    ) -> Result<LiveListen<'_>> {
        if !(8_000..=48_000).contains(&request.sample_rate) {
            return Err(AiError::Invalid("частота звука — от 8 до 48 кГц".into()));
        }
        self.check_request(auth, &request.request_id).await?;
        let fingerprint = self.fingerprint([
            request.model.as_bytes(),
            b"stt-live".as_slice(),
            request.request_id.as_bytes(),
        ]);
        let plan = Plan {
            request_id: &request.request_id,
            model: &request.model,
            fingerprint,
            input_units: MAX_SECONDS,
            max_output_units: 0,
            job_id: None,
            turn,
            signals: Vec::new(),
            work: Work::Live,
        };
        // Как в общем пути шлюза: «не ушло» (429, нет соединения) — повтор,
        // лимит подписки — свой отказ, остальное — отказ провайдера. Другую
        // модель не предлагаем: живое распознавание на экране не выбирается.
        let attempts = self.config.retry_delays.len() + 1;
        let mut call_id: Option<Uuid> = None;
        for attempt in 1..=attempts {
            let opened = self.open_attempt(auth, &plan, attempt, call_id).await?;
            call_id = Some(opened.id);
            let provider = self.voices[&opened.model.provider_id].clone();
            let call = LiveCall {
                external_id: opened.model.external_id.clone(),
                language: request.language.clone(),
                sample_rate: request.sample_rate,
                silence_secs: request.silence_secs,
                account_id: opened.account_id,
            };
            match tokio::time::timeout(self.config.timeout, provider.listen_live(&call)).await {
                Ok(Ok(link)) => {
                    return Ok(LiveListen {
                        gateway: self,
                        opened: Some(opened),
                        link,
                        bytes: 0,
                        sample_rate: request.sample_rate,
                    });
                }
                Ok(Err(ProviderError::UsageLimit(reason))) => {
                    self.release_not_sent(
                        opened.id,
                        &opened.reservations,
                        attempt,
                        "usage_limit",
                        &reason,
                    )
                    .await?;
                    return Err(AiError::SubscriptionLimit {
                        reason,
                        alternatives: Vec::new(),
                    });
                }
                Ok(Err(ProviderError::Refused(reason))) => {
                    self.release_not_sent(
                        opened.id,
                        &opened.reservations,
                        attempt,
                        "refused",
                        &reason,
                    )
                    .await?;
                    return Err(AiError::ProviderRefused {
                        reason,
                        alternatives: Vec::new(),
                    });
                }
                Ok(Err(ProviderError::NotSent(reason))) => {
                    self.release_not_sent(
                        opened.id,
                        &opened.reservations,
                        attempt,
                        "not_sent",
                        &reason,
                    )
                    .await?;
                    if let Some(delay) = self.config.retry_delays.get(attempt - 1) {
                        tokio::time::sleep(*delay).await;
                        continue;
                    }
                    return Err(AiError::ProviderUnavailable {
                        alternatives: Vec::new(),
                    });
                }
                Ok(Err(ProviderError::Unknown(reason))) => {
                    self.mark_unknown(opened.id, &reason).await?;
                    return Err(AiError::ResultUnknown { call_id: opened.id });
                }
                Err(_) => {
                    self.mark_unknown(opened.id, "таймаут соединения").await?;
                    return Err(AiError::ResultUnknown { call_id: opened.id });
                }
            }
        }
        unreachable!("цикл попыток всегда возвращает результат")
    }
}

impl<'g> InTurn<'g> {
    /// [`Gateway::transcribe`] в этом ходе.
    pub async fn transcribe(
        &self,
        auth: &Authorized<UseAi>,
        request: ListenRequest,
    ) -> Result<Transcript> {
        self.gateway
            .transcribe_in(auth, request, Some(self.id))
            .await
    }

    /// [`Gateway::speak`] в этом ходе.
    pub async fn speak(&self, auth: &Authorized<UseAi>, request: SpeakRequest) -> Result<Speech> {
        self.gateway.speak_in(auth, request, Some(self.id)).await
    }

    /// [`Gateway::speak_stream`] в этом ходе.
    pub async fn speak_stream(
        &self,
        auth: &Authorized<UseAi>,
        request: SpeakRequest,
    ) -> Result<SpeechStream> {
        self.gateway
            .speak_stream_in(auth, request, Some(self.id))
            .await
    }

    /// [`Gateway::listen_live`] в этом ходе.
    pub async fn listen_live(
        &self,
        auth: &Authorized<UseAi>,
        request: LiveRequest,
    ) -> Result<LiveListen<'g>> {
        self.gateway
            .listen_live_in(auth, request, Some(self.id))
            .await
    }
}

// ---------------------------------------------------------------- подделка

/// Как поведёт себя [`MockVoice`] на очередном распознавании.
#[derive(Debug, Clone, PartialEq)]
pub enum MockHeard {
    /// Распознать этот текст (длина звука — `seconds`).
    Text { text: String, seconds: f64 },
    /// Отказ до отправки (можно повторить).
    FailBeforeSend,
    /// Отказ без повтора (неверный ключ).
    Refuse,
    /// Кончился лимит подписки (у ElevenLabs — `quota_exceeded`).
    Limit,
    /// Обрыв после отправки.
    DropAfterSend,
}

/// Поддельный голосовой провайдер для тестов: распознаёт то, что задал тест,
/// и «говорит» байтами `MOCK-MP3:<текст>`. Вызовы считаются.
pub struct MockVoice {
    heard: Mutex<VecDeque<MockHeard>>,
    stt_calls: AtomicUsize,
    tts_calls: AtomicUsize,
    last_speech: Mutex<Option<TtsCall>>,
    refuse_speech: bool,
    /// Пауза перед каждым куском потоковой речи, мс.
    tts_chunk_ms: u64,
    live_calls: AtomicUsize,
}

impl Default for MockVoice {
    fn default() -> Self {
        Self::new()
    }
}

impl MockVoice {
    pub fn new() -> Self {
        Self {
            heard: Mutex::new(VecDeque::new()),
            stt_calls: AtomicUsize::new(0),
            tts_calls: AtomicUsize::new(0),
            last_speech: Mutex::new(None),
            refuse_speech: false,
            tts_chunk_ms: 0,
            live_calls: AtomicUsize::new(0),
        }
    }

    /// Потоковая речь — тремя кусками с этой паузой перед каждым.
    pub fn with_tts_delay(mut self, ms: u64) -> Self {
        self.tts_chunk_ms = ms;
        self
    }

    /// Сколько раз открывали живое распознавание.
    pub fn live_calls(&self) -> usize {
        self.live_calls.load(Ordering::SeqCst)
    }

    /// Что распознать на следующих вызовах (по порядку).
    pub fn script(self, steps: impl IntoIterator<Item = MockHeard>) -> Self {
        self.heard.lock().expect("mock").extend(steps);
        self
    }

    /// Речь всегда с отказом провайдера.
    pub fn refusing_speech(mut self) -> Self {
        self.refuse_speech = true;
        self
    }

    /// Добавить распознавание в очередь (тест может дописывать по ходу).
    pub fn push(&self, step: MockHeard) {
        self.heard.lock().expect("mock").push_back(step);
    }

    pub fn stt_calls(&self) -> usize {
        self.stt_calls.load(Ordering::SeqCst)
    }

    pub fn tts_calls(&self) -> usize {
        self.tts_calls.load(Ordering::SeqCst)
    }

    pub fn last_speech(&self) -> Option<TtsCall> {
        self.last_speech.lock().expect("mock").clone()
    }
}

impl VoiceProvider for MockVoice {
    fn transcribe<'a>(&'a self, _call: &'a SttCall) -> BoxFuture<'a, Result<Heard, ProviderError>> {
        Box::pin(async move {
            self.stt_calls.fetch_add(1, Ordering::SeqCst);
            let step = self
                .heard
                .lock()
                .expect("mock")
                .pop_front()
                .unwrap_or(MockHeard::Text {
                    text: "Hello".into(),
                    seconds: 1.0,
                });
            match step {
                MockHeard::Text { text, seconds } => Ok(Heard {
                    text,
                    language: Some("en".into()),
                    seconds: Some(seconds),
                }),
                MockHeard::FailBeforeSend => {
                    Err(ProviderError::NotSent("mock: отказ до отправки".into()))
                }
                MockHeard::Refuse => Err(ProviderError::Refused("mock: неверный ключ".into())),
                MockHeard::Limit => {
                    Err(ProviderError::UsageLimit("mock: кончились символы".into()))
                }
                MockHeard::DropAfterSend => {
                    Err(ProviderError::Unknown("mock: обрыв после отправки".into()))
                }
            }
        })
    }

    fn speak<'a>(&'a self, call: &'a TtsCall) -> BoxFuture<'a, Result<Spoken, ProviderError>> {
        Box::pin(async move {
            self.tts_calls.fetch_add(1, Ordering::SeqCst);
            *self.last_speech.lock().expect("mock") = Some(call.clone());
            if self.refuse_speech {
                return Err(ProviderError::Refused("mock: нет символов на счёте".into()));
            }
            Ok(Spoken {
                audio: format!("MOCK-MP3:{}", call.text).into_bytes(),
                mime: "audio/mpeg".into(),
            })
        })
    }

    /// Три куска `PCM:<текст>` с паузой [`MockVoice::with_tts_delay`].
    fn speak_stream<'a>(
        &'a self,
        call: &'a TtsCall,
    ) -> BoxFuture<'a, Result<AudioChunks, ProviderError>> {
        Box::pin(async move {
            self.tts_calls.fetch_add(1, Ordering::SeqCst);
            *self.last_speech.lock().expect("mock") = Some(call.clone());
            if self.refuse_speech {
                return Err(ProviderError::Refused("mock: нет символов на счёте".into()));
            }
            let (tx, rx) = tokio::sync::mpsc::channel(8);
            let text = call.text.clone();
            let delay = self.tts_chunk_ms;
            tokio::spawn(async move {
                for part in 0..3 {
                    tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                    if tx
                        .send(Ok(format!("PCM{part}:{text}|").into_bytes()))
                        .await
                        .is_err()
                    {
                        return;
                    }
                }
            });
            Ok(rx)
        })
    }

    /// Живое распознавание: на каждый кусок речи — черновик; тишина (кусок из
    /// нулей) после речи или «Готово» — фраза из сценария ([`MockVoice::script`]).
    fn listen_live<'a>(
        &'a self,
        _call: &'a LiveCall,
    ) -> BoxFuture<'a, Result<LiveLink, ProviderError>> {
        Box::pin(async move {
            self.live_calls.fetch_add(1, Ordering::SeqCst);
            let next = self.heard.lock().expect("mock").pop_front();
            let (text, fail) = match next {
                Some(MockHeard::Text { text, .. }) => (text, None),
                Some(MockHeard::Refuse) => {
                    return Err(ProviderError::Refused("mock: неверный ключ".into()));
                }
                Some(MockHeard::Limit) => {
                    return Err(ProviderError::UsageLimit("mock: кончились символы".into()));
                }
                Some(MockHeard::FailBeforeSend) => {
                    return Err(ProviderError::NotSent("mock: нет соединения".into()));
                }
                Some(MockHeard::DropAfterSend) => (String::new(), Some("mock: обрыв")),
                None => ("Hello".to_owned(), None),
            };
            let (audio_tx, mut audio_rx) = tokio::sync::mpsc::channel::<LiveIn>(64);
            let (events_tx, events_rx) = tokio::sync::mpsc::channel(64);
            tokio::spawn(async move {
                let mut spoke = false;
                while let Some(input) = audio_rx.recv().await {
                    if let Some(reason) = fail {
                        let _ = events_tx.send(LiveOut::Failed(reason.into())).await;
                        return;
                    }
                    let commit = match input {
                        LiveIn::Audio(pcm) if pcm.iter().any(|b| *b != 0) => {
                            spoke = true;
                            let words = text.split_whitespace().count().max(1);
                            let partial: String = text
                                .split_whitespace()
                                .take(words.div_ceil(2))
                                .collect::<Vec<_>>()
                                .join(" ");
                            let _ = events_tx.send(LiveOut::Partial(partial)).await;
                            false
                        }
                        LiveIn::Audio(_) => spoke,
                        LiveIn::Commit => true,
                    };
                    if commit {
                        let _ = events_tx.send(LiveOut::Committed(text.clone())).await;
                        return;
                    }
                }
            });
            Ok(LiveLink {
                audio: audio_tx,
                events: events_rx,
            })
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn listen(claimed: u64) -> Listen {
        Listen {
            audio: vec![1],
            mime: "audio/webm".into(),
            language: None,
            claimed,
        }
    }

    #[test]
    fn billing_takes_larger_length_within_reserve() {
        let heard = |seconds| Heard {
            text: String::new(),
            language: None,
            seconds,
        };
        assert_eq!(billed_seconds(&heard(Some(4.2)), &listen(3)), 5);
        assert_eq!(billed_seconds(&heard(Some(1.0)), &listen(7)), 7);
        assert_eq!(
            billed_seconds(&heard(None), &listen(0)),
            1,
            "не меньше секунды"
        );
        assert_eq!(
            billed_seconds(&heard(Some(900.0)), &listen(1)),
            MAX_SECONDS,
            "не больше резерва — иначе модель заблокировалась бы"
        );
    }

    #[test]
    fn audio_formats() {
        assert!(mime_ok("audio/webm;codecs=opus"));
        assert!(mime_ok("audio/mp4"));
        assert!(!mime_ok("text/plain"));
        assert!(!mime_ok("video/webm"));
    }
}
