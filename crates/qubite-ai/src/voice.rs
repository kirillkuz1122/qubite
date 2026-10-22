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
    AiError, Done, Gateway, Plan, Result, Work,
    provider::{BoxFuture, ProviderError},
};

/// Способность модели «распознаёт речь».
pub const STT: &str = "stt";
/// Способность модели «говорит».
pub const TTS: &str = "tts";
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
        let task = if capability == STT {
            STT_TASK
        } else {
            TTS_TASK
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

// ---------------------------------------------------------------- подделка

/// Как поведёт себя [`MockVoice`] на очередном распознавании.
#[derive(Debug, Clone, PartialEq)]
pub enum MockHeard {
    /// Распознать этот текст (длина звука — `seconds`).
    Text { text: String, seconds: f64 },
    /// Отказ до отправки (можно повторить).
    FailBeforeSend,
    /// Отказ без повтора (неверный ключ, нет денег).
    Refuse,
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
        }
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
