//! Адаптер ElevenLabs (ENG-001, D-451): распознавание речи (Scribe,
//! `POST /v1/speech-to-text`) и речь (`POST /v1/text-to-speech/{голос}`).
//!
//! Как и у [`crate::openrouter`], главное — честно сказать шлюзу, **ушёл ли
//! запрос**: нет соединения или 429 (занято, лимит частоты) — точно не ушёл;
//! 401/402 с `quota_exceeded` — кончились символы (лимит подписки); 400, 401
//! (неверный ключ), 402, 403, 404, 413, 422 — работа не выполнена и повтор не
//! поможет; остальное (5xx, обрыв после отправки) — неизвестно, резерв
//! удерживается.
//!
//! По редиректам не ходим (D-515): из закрытой страны ElevenLabs отвечает 302,
//! и после перехода приходит HTML-страница — её байты играли бы как шипение.
//! 3xx — понятный отказ с адресом из `Location`; звук проверяется по
//! `content-type`. Прокси — `QUBITE_ELEVENLABS_PROXY` или общий `QUBITE_PROXY`
//! ([`qubite_net`]), и для REST, и для живого распознавания (WebSocket).
//!
//! Ключ — `QUBITE_ELEVENLABS_API_KEY`, только из окружения, в журнал не пишется.
//! Реальных вызовов в тестах нет: тесты поднимают поддельный сервер.

use std::time::Duration;

use qubite_kernel::Secret;
use serde::Deserialize;

use crate::{
    provider::{BoxFuture, ProviderError},
    voice::{
        AudioChunks, Heard, LiveCall, LiveIn, LiveLink, LiveOut, Spoken, SttCall, TtsCall,
        VoiceProvider,
    },
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
    /// Прокси (`http://`, `socks5://`); без него — системный `HTTPS_PROXY`.
    pub proxy: Option<String>,
}

impl ElevenLabsConfig {
    pub fn new(api_key: Secret) -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.into(),
            api_key,
            connect_timeout: Duration::from_secs(10),
            proxy: None,
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
        let client = qubite_net::client(config.proxy.as_deref())?
            .connect_timeout(config.connect_timeout)
            .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| format!("HTTP-клиент не создан: {error}"))?;
        Ok(Self { client, config })
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.config.base_url.trim_end_matches('/'))
    }

    /// Запрос → тип и тело ответа 2xx; остальное — [`refusal`].
    async fn post(
        &self,
        request: reqwest::RequestBuilder,
    ) -> Result<(Option<String>, Vec<u8>), ProviderError> {
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
        let content_type = header(response.headers(), "content-type");
        let location = header(response.headers(), "location");
        let body = response.bytes().await.map_err(|error| {
            ProviderError::Unknown(format!("ответ не дочитан: {}", without_url(&error)))
        })?;
        match status {
            200..=299 => Ok((content_type, body.to_vec())),
            _ => Err(refusal(status, location.as_deref(), &body)),
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
        let (content_type, body) = self.post(request).await?;
        if let Some(t) = content_type.filter(|t| !t.contains("json")) {
            // Страница перехвата сети вместо ответа — работа не сделана.
            return Err(ProviderError::Refused(blocked(&format!(
                "вместо ответа пришло «{}»",
                t.split(';').next().unwrap_or_default().trim()
            ))));
        }
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
        let (content_type, audio) = self.post(request).await?;
        audio_only(content_type.as_deref())?;
        if audio.is_empty() {
            return Err(ProviderError::Unknown("пустой звук в ответе".into()));
        }
        Ok(Spoken {
            audio,
            mime: "audio/mpeg".into(),
        })
    }
}

impl ElevenLabs {
    /// Речь потоком: `POST /v1/text-to-speech/{голос}/stream` в PCM 24 кГц —
    /// первые куски приходят через сотни миллисекунд, остальное догоняет.
    async fn tts_stream(&self, call: &TtsCall) -> Result<AudioChunks, ProviderError> {
        let voice: String = call
            .voice
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .collect();
        if voice.is_empty() {
            return Err(ProviderError::Refused("голос не задан".into()));
        }
        let mut response = self
            .client
            .post(self.url(&format!(
                "v1/text-to-speech/{voice}/stream?output_format={STREAM_FORMAT}"
            )))
            .header("xi-api-key", self.config.api_key.expose())
            .json(&serde_json::json!({
                "text": call.text,
                "model_id": call.external_id,
            }))
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
        if !(200..300).contains(&status) {
            let location = header(response.headers(), "location");
            let body = response.bytes().await.unwrap_or_default();
            return Err(refusal(status, location.as_deref(), &body));
        }
        audio_only(header(response.headers(), "content-type").as_deref())?;
        let (tx, rx) = tokio::sync::mpsc::channel(32);
        tokio::spawn(async move {
            // Куски — целыми отсчётами (2 байта): лишний байт ждёт следующего.
            let mut carry: Option<u8> = None;
            loop {
                match response.chunk().await {
                    Ok(Some(bytes)) => {
                        let mut out = Vec::with_capacity(bytes.len() + 1);
                        out.extend(carry.take());
                        out.extend_from_slice(&bytes);
                        if out.len() % 2 == 1 {
                            carry = out.pop();
                        }
                        if !out.is_empty() && tx.send(Ok(out)).await.is_err() {
                            return; // слушатель ушёл (перебили) — бросаем поток
                        }
                    }
                    Ok(None) => return,
                    Err(error) => {
                        let _ = tx
                            .send(Err(ProviderError::Unknown(format!(
                                "речь оборвалась: {}",
                                without_url(&error)
                            ))))
                            .await;
                        return;
                    }
                }
            }
        });
        Ok(rx)
    }

    /// Живое распознавание: WebSocket `/v1/speech-to-text/realtime`, звук —
    /// PCM 16 бит кусками в base64, конец фразы — по паузе (VAD провайдера)
    /// или по команде «Готово» (`commit`).
    async fn live(&self, call: &LiveCall) -> Result<LiveLink, ProviderError> {
        use futures_util::{SinkExt, StreamExt};
        use tokio_tungstenite::tungstenite::{
            Message, client::IntoClientRequest, http::HeaderValue,
        };

        let base = self.config.base_url.trim_end_matches('/');
        let base = base
            .strip_prefix("https://")
            .map(|rest| format!("wss://{rest}"))
            .or_else(|| {
                base.strip_prefix("http://")
                    .map(|rest| format!("ws://{rest}"))
            })
            .unwrap_or_else(|| base.to_owned());
        let mut url = format!(
            "{base}/v1/speech-to-text/realtime?model_id={}&audio_format=pcm_{}&commit_strategy=vad&vad_silence_threshold_secs={:.2}",
            call.external_id, call.sample_rate, call.silence_secs
        );
        if let Some(language) = call
            .language
            .as_deref()
            .filter(|l| l.chars().all(|c| c.is_ascii_alphabetic()))
        {
            url.push_str("&language_code=");
            url.push_str(language);
        }
        let mut request = url
            .into_client_request()
            .map_err(|error| ProviderError::Refused(format!("неверный адрес: {error}")))?;
        let key = HeaderValue::from_str(self.config.api_key.expose())
            .map_err(|_| ProviderError::Refused("ключ с недопустимыми символами".into()))?;
        request.headers_mut().insert("xi-api-key", key);
        let host = request.uri().host().unwrap_or_default().to_owned();
        let port = request
            .uri()
            .port_u16()
            .unwrap_or(match request.uri().scheme_str() {
                Some("wss") => 443,
                _ => 80,
            });
        let proxy = qubite_net::for_host(&host, self.config.proxy.as_deref())
            .map_err(ProviderError::Refused)?;
        let connect = async {
            match &proxy {
                Some(proxy) => {
                    let stream =
                        qubite_net::tunnel(proxy, &host, port, self.config.connect_timeout)
                            .await
                            .map_err(|error| {
                                ProviderError::NotSent(format!(
                                    "прокси {}: {error}",
                                    qubite_net::hide(proxy.as_str())
                                ))
                            })?;
                    Ok(tokio_tungstenite::client_async_tls(request, stream).await)
                }
                None => Ok(tokio_tungstenite::connect_async(request).await),
            }
        };
        let connect = tokio::time::timeout(self.config.connect_timeout, connect)
            .await
            .map_err(|_| ProviderError::NotSent("распознавание не ответило вовремя".into()))??;
        let (socket, _) = connect.map_err(|error| {
            use tokio_tungstenite::tungstenite::Error as WsError;
            match error {
                WsError::Http(response) => {
                    let status = response.status().as_u16();
                    let location = header(response.headers(), "location");
                    let body = response.body().clone().unwrap_or_default();
                    match refusal(status, location.as_deref(), &body) {
                        ProviderError::Unknown(reason) => ProviderError::Refused(reason),
                        other => other,
                    }
                }
                WsError::Io(error) => ProviderError::NotSent(format!("нет соединения: {error}")),
                other => ProviderError::NotSent(format!("соединение не открылось: {other}")),
            }
        })?;
        let (mut sink, mut stream) = socket.split();
        let (audio_tx, mut audio_rx) = tokio::sync::mpsc::channel::<LiveIn>(64);
        let (events_tx, events_rx) = tokio::sync::mpsc::channel(64);
        let rate = call.sample_rate;
        tokio::spawn(async move {
            use base64::Engine;
            loop {
                tokio::select! {
                    input = audio_rx.recv() => {
                        let message = match input {
                            Some(LiveIn::Audio(pcm)) => serde_json::json!({
                                "message_type": "input_audio_chunk",
                                "audio_base_64": base64::engine::general_purpose::STANDARD.encode(pcm),
                                "commit": false,
                                "sample_rate": rate,
                            }),
                            Some(LiveIn::Commit) => serde_json::json!({
                                "message_type": "input_audio_chunk",
                                "audio_base_64": "",
                                "commit": true,
                                "sample_rate": rate,
                            }),
                            None => {
                                let _ = sink.close().await;
                                return;
                            }
                        };
                        if sink.send(Message::text(message.to_string())).await.is_err() {
                            let _ = events_tx.send(LiveOut::Failed("соединение с распознаванием оборвалось".into())).await;
                            return;
                        }
                    }
                    frame = stream.next() => {
                        let Some(Ok(frame)) = frame else {
                            let _ = events_tx.send(LiveOut::Failed("распознавание закрыло соединение".into())).await;
                            return;
                        };
                        let Message::Text(text) = frame else { continue };
                        let Some(event) = live_event(text.as_str()) else { continue };
                        let failed = matches!(event, LiveOut::Failed(_) | LiveOut::Refused(_));
                        if events_tx.send(event).await.is_err() || failed {
                            return;
                        }
                    }
                }
            }
        });
        Ok(LiveLink {
            audio: audio_tx,
            events: events_rx,
        })
    }
}

/// Формат потоковой речи у ElevenLabs (см. [`crate::voice::STREAM_MIME`]).
pub const STREAM_FORMAT: &str = "pcm_24000";

/// Сообщение живого распознавания → событие. Служебные — `None`.
fn live_event(text: &str) -> Option<LiveOut> {
    let json: serde_json::Value = serde_json::from_str(text).ok()?;
    let kind = json["message_type"].as_str()?;
    let said = || json["text"].as_str().unwrap_or_default().to_owned();
    match kind {
        "partial_transcript" => Some(LiveOut::Partial(said())),
        "committed_transcript" => Some(LiveOut::Committed(said())),
        "session_started"
        | "committed_transcript_with_timestamps"
        | "committed_transcript_entities"
        | "edited_transcript"
        | "warning" => None,
        other => {
            let detail = json["error"]
                .as_str()
                .or_else(|| json["message"].as_str())
                .unwrap_or_default();
            let reason = format!("ElevenLabs: {other} {detail}")
                .trim()
                .chars()
                .take(200)
                .collect();
            // Ключ, символы, условия — повтор упрётся в то же.
            Some(
                if matches!(other, "quota_exceeded" | "auth_error" | "unaccepted_terms") {
                    LiveOut::Refused(reason)
                } else {
                    LiveOut::Failed(reason)
                },
            )
        }
    }
}

impl VoiceProvider for ElevenLabs {
    fn transcribe<'a>(&'a self, call: &'a SttCall) -> BoxFuture<'a, Result<Heard, ProviderError>> {
        Box::pin(self.stt(call))
    }

    fn speak<'a>(&'a self, call: &'a TtsCall) -> BoxFuture<'a, Result<Spoken, ProviderError>> {
        Box::pin(self.tts(call))
    }

    fn speak_stream<'a>(
        &'a self,
        call: &'a TtsCall,
    ) -> BoxFuture<'a, Result<AudioChunks, ProviderError>> {
        Box::pin(self.tts_stream(call))
    }

    fn listen_live<'a>(
        &'a self,
        call: &'a LiveCall,
    ) -> BoxFuture<'a, Result<LiveLink, ProviderError>> {
        Box::pin(self.live(call))
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

fn header(headers: &reqwest::header::HeaderMap, name: &str) -> Option<String> {
    headers
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned)
}

/// Ответ не 2xx → отказ шлюзу. 3xx и 403 «по стране» — подсказка про VPN и
/// прокси с адресом, куда перенаправили (без параметров).
fn refusal(status: u16, location: Option<&str>, body: &[u8]) -> ProviderError {
    match status {
        300..=399 => {
            let target = location.map(|l| l.split(['?', '#']).next().unwrap_or_default());
            // Справка «Do you restrict access… for any specific countries» — блок по стране.
            if target.is_some_and(|l| l.contains("help.elevenlabs.io") && l.contains("restrict")) {
                return ProviderError::Refused(format!(
                    "ElevenLabs закрыт для твоей страны (HTTP {status} → справка про ограничения по странам) — \
                     задай QUBITE_PROXY (например, порт Hiddify: http://127.0.0.1:12334) или включи VPN для сервера Qubite"
                ));
            }
            let target = target
                .map(|l| format!(" → {}", l.chars().take(120).collect::<String>()))
                .unwrap_or_default();
            ProviderError::Refused(blocked(&format!("HTTP {status}{target}")))
        }
        429 => ProviderError::NotSent(error_message(status, body)),
        403 if regional(body) => ProviderError::Refused(blocked(&error_message(status, body))),
        // Кончились символы — лимит подписки, а не «неверный ключ».
        401 | 402 if quota(body) => ProviderError::UsageLimit(error_message(status, body)),
        400 | 401 | 402 | 403 | 404 | 413 | 422 => {
            ProviderError::Refused(error_message(status, body))
        }
        _ => ProviderError::Unknown(error_message(status, body)),
    }
}

/// Кончились символы: `quota_exceeded` в ответе.
fn quota(body: &[u8]) -> bool {
    String::from_utf8_lossy(body).contains("quota_exceeded")
}

/// Отказ по стране: в ответе про регион или страну.
fn regional(body: &[u8]) -> bool {
    let text = String::from_utf8_lossy(body).to_ascii_lowercase();
    ["region", "country", "location", "geo"]
        .iter()
        .any(|word| text.contains(word))
}

fn blocked(what: &str) -> String {
    format!(
        "ElevenLabs недоступен из этой сети — {what}. Так он отвечает на страны с ограничениями: \
         включи VPN для сервера Qubite или задай прокси QUBITE_PROXY / QUBITE_ELEVENLABS_PROXY \
         (Hiddify: http://127.0.0.1:12334)"
    )
}

/// Речь — только звук: страница или JSON вместо звука (перехват сети) — отказ,
/// а не шипение. Точный тип звука не требуем — у потока PCM он бывает разный.
fn audio_only(content_type: Option<&str>) -> Result<(), ProviderError> {
    let Some(t) = content_type else {
        return Ok(());
    };
    let t = t
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if t.starts_with("text/") || ["html", "json", "xml"].iter().any(|k| t.contains(k)) {
        return Err(ProviderError::Refused(blocked(&format!(
            "вместо звука пришло «{t}»"
        ))));
    }
    Ok(())
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
    fn live_events_map_to_partial_committed_failed() {
        assert_eq!(
            live_event(r#"{"message_type":"partial_transcript","text":"I go"}"#),
            Some(LiveOut::Partial("I go".into()))
        );
        assert_eq!(
            live_event(r#"{"message_type":"committed_transcript","text":"I go home."}"#),
            Some(LiveOut::Committed("I go home.".into()))
        );
        assert_eq!(
            live_event(r#"{"message_type":"session_started","session_id":"x"}"#),
            None
        );
        assert!(matches!(
            live_event(r#"{"message_type":"quota_exceeded","error":"no credits"}"#),
            Some(LiveOut::Refused(m)) if m.contains("quota_exceeded")
        ));
        assert!(matches!(
            live_event(r#"{"message_type":"transcriber_error","error":"oops"}"#),
            Some(LiveOut::Failed(m)) if m.contains("transcriber_error")
        ));
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

    #[test]
    fn quota_is_a_usage_limit_not_a_bad_key() {
        let body = br#"{"detail":{"status":"quota_exceeded","message":"no credits"}}"#;
        assert!(matches!(
            refusal(401, None, body),
            ProviderError::UsageLimit(m) if m.contains("quota_exceeded")
        ));
        assert!(matches!(
            refusal(401, None, br#"{"detail":{"status":"invalid_api_key"}}"#),
            ProviderError::Refused(_)
        ));
    }
}
