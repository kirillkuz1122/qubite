//! OpenAI-совместимое STT для личного ключа (D-854). Платит человек,
//! бюджет платформы не используется. Ошибки сервиса не содержат его тела,
//! адреса или ключа: сервис может отразить секрет в любом из этих мест.

use std::time::Duration;

use qubite_kernel::Secret;
use serde::Deserialize;

use crate::{
    provider::{BoxFuture, ProviderError},
    voice::{Heard, Spoken, SttCall, TtsCall, VoiceProvider},
};

pub const DEFAULT_BASE_URL: &str = "https://api.openai.com/v1";
pub const DEFAULT_MODEL: &str = "whisper-1";
pub const KEY_PURPOSE: &str = "voice.own_key";
pub const TIMEOUT: Duration = Duration::from_secs(15);
const MAX_RESPONSE_BYTES: usize = 256 * 1024;

pub struct OpenAiVoice {
    client: reqwest::Client,
    endpoint: String,
    api_key: Secret,
}

impl OpenAiVoice {
    /// DNS проверяется и закрепляется заново для каждого распознавания.
    pub async fn new(base_url: &str, api_key: Secret) -> Result<Self, String> {
        let base = qubite_net::public_https::parse(base_url)?;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = qubite_net::public_https::client(&base)
            .await?
            .timeout(TIMEOUT)
            .connect_timeout(Duration::from_secs(5))
            .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|_| "Не удалось создать соединение с сервисом распознавания")?;
        Ok(Self {
            client,
            endpoint: format!("{}/audio/transcriptions", base.as_str().trim_end_matches('/')),
            api_key,
        })
    }

    async fn stt(&self, call: &SttCall) -> Result<Heard, ProviderError> {
        let mut fields = vec![
            ("model", call.external_id.as_str()),
            ("response_format", "json"),
        ];
        if let Some(language) = call.language.as_deref() {
            fields.push(("language", language));
        }
        let (boundary, body) = crate::elevenlabs::multipart(&fields, &call.audio, &call.mime);
        let mut authorization =
            reqwest::header::HeaderValue::from_str(&format!("Bearer {}", self.api_key.expose()))
                .map_err(|_| ProviderError::Refused("Неверный ключ распознавания".into()))?;
        authorization.set_sensitive(true);
        let mut response = self
            .client
            .post(&self.endpoint)
            .header(reqwest::header::AUTHORIZATION, authorization)
            .header(
                "content-type",
                format!("multipart/form-data; boundary={boundary}"),
            )
            .body(body)
            .send()
            .await
            .map_err(|_| ProviderError::Unknown("Сервис распознавания не ответил".into()))?;
        if !response.status().is_success() {
            // Не читаем и не отражаем тело ошибки или Location.
            let message = match response.status().as_u16() {
                401 | 403 => "Сервис распознавания не принял ключ. Проверьте ключ и доступ",
                402 | 429 => "Сервис распознавания исчерпал лимит или занят. Проверьте баланс",
                300..=399 => "Сервис распознавания перенаправил запрос. Проверьте адрес API",
                _ => "Сервис распознавания отказал. Проверьте адрес API и модель",
            };
            return Err(ProviderError::Refused(message.into()));
        }
        if response.content_length().is_some_and(|n| n > MAX_RESPONSE_BYTES as u64) {
            return Err(ProviderError::Unknown("Ответ распознавания слишком большой".into()));
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| ProviderError::Unknown("Ответ распознавания оборвался".into()))?
        {
            if chunk.len() > MAX_RESPONSE_BYTES.saturating_sub(bytes.len()) {
                return Err(ProviderError::Unknown("Ответ распознавания слишком большой".into()));
            }
            bytes.extend_from_slice(&chunk);
        }
        #[derive(Deserialize)]
        struct Reply {
            text: String,
        }
        let reply: Reply = serde_json::from_slice(&bytes)
            .map_err(|_| ProviderError::Unknown("Сервис вернул непонятный ответ".into()))?;
        // Даже успешный ответ не должен случайно перенести ключ во Входящие.
        if reply.text.contains(self.api_key.expose()) {
            return Err(ProviderError::Unknown("Сервис вернул непонятный ответ".into()));
        }
        Ok(Heard {
            text: reply.text,
            language: None,
            seconds: None,
        })
    }
}

impl VoiceProvider for OpenAiVoice {
    fn transcribe<'a>(&'a self, call: &'a SttCall) -> BoxFuture<'a, Result<Heard, ProviderError>> {
        Box::pin(async move {
            tokio::time::timeout(TIMEOUT, self.stt(call)).await.map_err(|_| {
                ProviderError::Unknown("Сервис распознавания не ответил за 15 секунд".into())
            })?
        })
    }

    fn speak<'a>(&'a self, _call: &'a TtsCall) -> BoxFuture<'a, Result<Spoken, ProviderError>> {
        Box::pin(async { Err(ProviderError::Refused("Этот сервис только распознаёт речь".into())) })
    }
}

#[cfg(test)]
mod tests;
