//! Адаптер ElevenLabs (ENG-001, D-451): распознавание речи (Scribe,
//! `POST /v1/speech-to-text`) и речь (`POST /v1/text-to-speech/{голос}`).
//!
//! Как и у [`crate::openrouter`], главное — честно сказать шлюзу, **ушёл ли
//! запрос**: нет соединения или 429 (занято, лимит частоты) — точно не ушёл;
//! 400, 401 (неверный ключ, кончились символы — `quota_exceeded`), 402, 403,
//! 404, 413, 422 — работа не выполнена и повтор не поможет; остальное (5xx,
//! обрыв после отправки) — неизвестно, резерв удерживается.
//!
//! Ключ — `QUBITE_ELEVENLABS_API_KEY`, только из окружения, в журнал не пишется.
//! Реальных вызовов в тестах нет: тесты поднимают поддельный сервер.

use std::time::Duration;

use qubite_kernel::Secret;
use serde::Deserialize;

use crate::{
    provider::{BoxFuture, ProviderError},
    voice::{Heard, Spoken, SttCall, TtsCall, VoiceProvider},
};

/// ID провайдера в базе (`ai_providers.id`).
pub const PROVIDER_ID: &str = "elevenlabs";
/// Адрес API по умолчанию.
pub const DEFAULT_BASE_URL: &str = "https://api.elevenlabs.io";
/// Голос по умолчанию — «George» из готовых голосов ElevenLabs: британский,
/// взрослый, строгий учитель (D-453). Меняется `QUBITE_ELEVENLABS_VOICE_ID`.
pub const DEFAULT_VOICE: &str = "JBFqnCBsd6RMkjVDRZzb";
/// Формат речи: MP3 44,1 кГц, 64 кбит/с — играет любой браузер, мало весит.
pub const OUTPUT_FORMAT: &str = "mp3_44100_64";

#[derive(Debug, Clone)]
pub struct ElevenLabsConfig {
    pub base_url: String,
    pub api_key: Secret,
    pub connect_timeout: Duration,
}

impl ElevenLabsConfig {
    pub fn new(api_key: Secret) -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.into(),
            api_key,
            connect_timeout: Duration::from_secs(10),
        }
    }
}

pub struct ElevenLabs {
    client: reqwest::Client,
    config: ElevenLabsConfig,
}

#[derive(Deserialize)]
struct SttResponse {
    #[serde(default)]
    text: String,
    #[serde(default)]
    language_code: Option<String>,
    #[serde(default)]
    words: Vec<Word>,
}

#[derive(Deserialize)]
struct Word {
    #[serde(default)]
    end: Option<f64>,
}

impl ElevenLabs {
    pub fn new(config: ElevenLabsConfig) -> Result<Self, String> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = reqwest::Client::builder()
            .connect_timeout(config.connect_timeout)
            .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| format!("HTTP-клиент не создан: {error}"))?;
        Ok(Self { client, config })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.config.base_url.trim_end_matches('/'))
    }

    async fn post(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<(u16, Vec<u8>), ProviderError> {
        let response = request
            .header("xi-api-key", self.config.api_key.expose())
            .send()
            .await
            .map_err(|error| {
                if error.is_connect() {
                    ProviderError::NotSent(format!("нет соединения: {}", without_url(&error)))
                } else {
                    ProviderError::Unknown(format!("обрыв: {}", without_url(&error)))
                }
            })?;
        let status = response.status().as_u16();
        let body = response.bytes().await.map_err(|error| {
            ProviderError::Unknown(format!("ответ не дочитан: {}", without_url(&error)))
        })?;
        match status {
            200..=299 => Ok((status, body.to_vec())),
            429 => Err(ProviderError::NotSent(error_message(status, &body))),
            400 | 401 | 402 | 403 | 404 | 413 | 422 => {
                Err(ProviderError::Refused(error_message(status, &body)))
            }
            _ => Err(ProviderError::Unknown(error_message(status, &body))),
        }
    }

    async fn stt(&self, call: &SttCall) -> Result<Heard, ProviderError> {
        let mut fields = vec![
            ("model_id", call.external_id.as_str()),
            ("tag_audio_events", "false"),
            ("timestamps_granularity", "word"),
        ];
        if let Some(language) = call.language.as_deref() {
            fields.push(("language_code", language));
        }
        let (boundary, body) = multipart(&fields, &call.audio, &call.mime);
        let request = self
            .client
            .post(self.url("v1/speech-to-text"))
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body);
        let (_, body) = self.post(request).await?;
        let parsed: SttResponse = serde_json::from_slice(&body).map_err(|error| {
            // Ответ 200 пришёл, работа сделана — деньги могли уйти.
            ProviderError::Unknown(format!("ответ распознавания не прочитан: {error}"))
        })?;
        let seconds = parsed
            .words
            .iter()
            .filter_map(|w| w.end)
            .fold(None, |max: Option<f64>, end| {
                Some(max.map_or(end, |m| m.max(end)))
            });
        Ok(Heard {
            text: parsed.text,
            language: parsed.language_code,
            seconds,
        })
    }

    async fn tts(&self, call: &TtsCall) -> Result<Spoken, ProviderError> {
        let voice: String = call
            .voice
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .collect();
        if voice.is_empty() {
            return Err(ProviderError::Refused("голос не задан".into()));
        }
        let request = self
            .client
            .post(self.url(&format!(
                "v1/text-to-speech/{voice}?output_format={OUTPUT_FORMAT}"
            )))
            .header("accept", "audio/mpeg")
            .json(&serde_json::json!({
                "text": call.text,
                "model_id": call.external_id,
            }));
        let (_, audio) = self.post(request).await?;
        if audio.is_empty() {
            return Err(ProviderError::Unknown("пустой звук в ответе".into()));
        }
        Ok(Spoken {
            audio,
            mime: "audio/mpeg".into(),
        })
    }
}

impl VoiceProvider for ElevenLabs {
    fn transcribe<'a>(&'a self, call: &'a SttCall) -> BoxFuture<'a, Result<Heard, ProviderError>> {
        Box::pin(self.stt(call))
    }

    fn speak<'a>(&'a self, call: &'a TtsCall) -> BoxFuture<'a, Result<Spoken, ProviderError>> {
        Box::pin(self.tts(call))
    }
}

/// Тело `multipart/form-data`: текстовые поля и файл `file`. Своё, чтобы не
/// тянуть лишнюю зависимость ради одного запроса.
fn multipart(fields: &[(&str, &str)], file: &[u8], mime: &str) -> (String, Vec<u8>) {
    let boundary = format!("qubite-{}", uuid::Uuid::new_v4().simple());
    let mut body = Vec::with_capacity(file.len() + 512);
    for (name, value) in fields {
        body.extend_from_slice(
            format!(
                "--{boundary}\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
            )
            .as_bytes(),
        );
    }
    let extension = match mime.split(';').next().unwrap_or("").trim() {
        "audio/ogg" => "ogg",
        "audio/mp4" | "audio/aac" => "m4a",
        "audio/mpeg" => "mp3",
        "audio/wav" | "audio/x-wav" => "wav",
        _ => "webm",
    };
    let mime: String = mime
        .chars()
        .filter(|c| !c.is_control() && *c != '"')
        .collect();
    body.extend_from_slice(
        format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"speech.{extension}\"\r\nContent-Type: {mime}\r\n\r\n"
        )
        .as_bytes(),
    );
    body.extend_from_slice(file);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    (boundary, body)
}

/// Текст ошибки reqwest без адреса.
fn without_url(error: &reqwest::Error) -> String {
    let mut error = error.to_string();
    if let Some(at) = error.find(" for url (") {
        error.truncate(at);
    }
    error
}

/// «HTTP 401: quota_exceeded — …» — коротко, без тела целиком.
fn error_message(status: u16, body: &[u8]) -> String {
    #[derive(Deserialize)]
    struct Detail {
        #[serde(default)]
        status: Option<String>,
        #[serde(default)]
        message: Option<String>,
    }
    #[derive(Deserialize)]
    struct ErrorBody {
        detail: serde_json::Value,
    }
    let detail = serde_json::from_slice::<ErrorBody>(body)
        .ok()
        .map(
            |e| match serde_json::from_value::<Detail>(e.detail.clone()) {
                Ok(d) => [d.status, d.message]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" — "),
                Err(_) => e.detail.as_str().unwrap_or_default().to_owned(),
            },
        )
        .filter(|d| !d.is_empty());
    match detail {
        Some(detail) => format!(
            "ElevenLabs HTTP {status}: {}",
            detail.chars().take(200).collect::<String>()
        ),
        None => format!("ElevenLabs HTTP {status}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn multipart_has_fields_and_file() {
        let (boundary, body) = multipart(&[("model_id", "scribe_v1")], b"OPUS", "audio/webm");
        let text = String::from_utf8(body).unwrap();
        assert!(text.contains("name=\"model_id\"\r\n\r\nscribe_v1\r\n"));
        assert!(text.contains("filename=\"speech.webm\"\r\nContent-Type: audio/webm\r\n\r\nOPUS"));
        assert!(text.ends_with(&format!("--{boundary}--\r\n")));
    }

    #[test]
    fn errors_are_short_and_without_body() {
        let body = br#"{"detail":{"status":"quota_exceeded","message":"This request exceeds your quota."}}"#;
        assert_eq!(
            error_message(401, body),
            "ElevenLabs HTTP 401: quota_exceeded — This request exceeds your quota."
        );
        assert_eq!(error_message(500, b"<html>"), "ElevenLabs HTTP 500");
    }
}
