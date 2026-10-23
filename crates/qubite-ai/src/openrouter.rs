//! Адаптер OpenRouter (AI-002): вызов модели и каталог моделей с ценами.
//!
//! Главное — честно сказать шлюзу, **ушёл ли запрос** (D-074):
//! - не удалось соединиться — точно не ушёл, можно повторить;
//! - OpenRouter ответил 429 (лимит частоты) или 503 (нет доступного
//!   провайдера) — модель запрос не получала, можно повторить;
//! - 400, 401, 402, 403, 404, 413, 422 (неверный запрос или ключ, нет денег на
//!   счёте, модерация, нет модели) — модель не работала, но повтор не поможет:
//!   резерв возвращается, повтора нет;
//! - любой другой ответ (500, 502, 504, 408…), обрыв после отправки, ответ,
//!   который не удалось прочитать, — **неизвестно**: модель могла отработать
//!   и стоить денег, резерв удерживается.
//!
//! Реальных вызовов в тестах нет: тесты поднимают локальный сервер
//! с записанными ответами OpenRouter.

use std::time::Duration;

use qubite_kernel::Secret;
use serde::Deserialize;

use crate::provider::{BoxFuture, Delta, Provider, ProviderCall, ProviderError, ProviderReply};

/// Адрес API OpenRouter по умолчанию.
pub const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";

/// Настройки адаптера.
#[derive(Debug, Clone)]
pub struct OpenRouterConfig {
    pub base_url: String,
    pub api_key: Secret,
    /// Сколько ждать соединения. Общий таймаут вызова — у шлюза (60 с).
    pub connect_timeout: Duration,
    /// `data_collection` по умолчанию для моделей, где owner его не задал:
    /// `Some("deny")` — только провайдеры, которые не собирают данные;
    /// `None` — не указывать (у OpenRouter это `allow`). D-211.
    pub data_collection: Option<String>,
    /// Прокси (`QUBITE_PROXY`); без него — системный `HTTPS_PROXY`.
    pub proxy: Option<String>,
}

impl OpenRouterConfig {
    pub fn new(api_key: Secret) -> Self {
        Self {
            base_url: DEFAULT_BASE_URL.into(),
            api_key,
            connect_timeout: Duration::from_secs(10),
            data_collection: None,
            proxy: None,
        }
    }
}

pub struct OpenRouter {
    client: reqwest::Client,
    config: OpenRouterConfig,
    /// Ключ платформы: из настроек сервера или из Console (D-442) — меняется
    /// без перезапуска. Пустой — ключа нет: запрос без своего ключа человека
    /// получает отказ до отправки.
    key: std::sync::RwLock<Secret>,
}

/// Модель из каталога OpenRouter. Цены — микродоллары за миллион токенов,
/// округлены вверх.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CatalogEntry {
    pub external_id: String,
    pub context_tokens: i32,
    pub price_in_per_mtok: i64,
    pub price_out_per_mtok: i64,
}

#[derive(Debug, thiserror::Error)]
pub enum CatalogError {
    #[error("каталог OpenRouter недоступен: {0}")]
    Unavailable(String),
    #[error("каталог OpenRouter не прочитан: {0}")]
    Invalid(String),
}

impl OpenRouter {
    pub fn new(config: OpenRouterConfig) -> Result<Self, String> {
        // Криптография TLS — ring (чистая сборка под aarch64, без C-зависимостей aws-lc).
        let _ = rustls::crypto::ring::default_provider().install_default();
        let client = qubite_net::client(config.proxy.as_deref())?
            .connect_timeout(config.connect_timeout)
            .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
            .build()
            .map_err(|error| format!("HTTP-клиент не создан: {error}"))?;
        let key = std::sync::RwLock::new(config.api_key.clone());
        Ok(Self {
            client,
            config,
            key,
        })
    }

    /// Заменить ключ платформы (Console → AI → Ключи). Пустой — без ключа.
    pub fn set_key(&self, key: Secret) {
        *self.key.write().expect("ключ") = key;
    }

    /// Есть ли ключ платформы.
    pub fn has_key(&self) -> bool {
        !self.key.read().expect("ключ").expose().trim().is_empty()
    }

    fn platform_key(&self) -> Secret {
        self.key.read().expect("ключ").clone()
    }

    fn url(&self, path: &str) -> String {
        format!("{}/{path}", self.config.base_url.trim_end_matches('/'))
    }

    async fn send(
        &self,
        call: &ProviderCall,
        delta: Option<Delta>,
    ) -> Result<ProviderReply, ProviderError> {
        let mut body = serde_json::json!({
            "model": call.external_id,
            "messages": call.messages,
            "max_tokens": call.max_output_tokens,
            "stream": delta.is_some(),
            "usage": { "include": true },
        });
        if let Some(provider) = provider_preferences(call, self.config.data_collection.as_deref()) {
            body["provider"] = provider;
        }
        // Свой ключ человека (D-493) — иначе ключ платформы.
        let key = call.api_key.clone().unwrap_or_else(|| self.platform_key());
        if key.expose().trim().is_empty() {
            return Err(ProviderError::Refused(
                "нет ключа OpenRouter — owner добавляет его в Console → AI → Ключи".into(),
            ));
        }
        let response = self
            .client
            .post(self.url("chat/completions"))
            .bearer_auth(key.expose())
            .header("X-Title", "Qubite")
            .json(&body)
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
        if let (200..=299, Some(delta)) = (status, &delta) {
            return read_stream(response, delta, call).await;
        }
        let text = response.text().await.map_err(|error| {
            ProviderError::Unknown(format!("ответ не дочитан: {}", without_url(&error)))
        })?;
        match status {
            200..=299 => parse_reply(&text, call),
            429 | 503 => Err(ProviderError::NotSent(error_message(status, &text))),
            400 | 401 | 402 | 403 | 404 | 413 | 422 => {
                Err(ProviderError::Refused(error_message(status, &text)))
            }
            _ => Err(ProviderError::Unknown(error_message(status, &text))),
        }
    }

    /// Каталог моделей с ценами (`GET /models`). Модели с плавающей ценой
    /// (например, `openrouter/auto`) и с платой за сам запрос пропускаются:
    /// худшую стоимость для них заранее не посчитать.
    pub async fn catalog(&self) -> Result<Vec<CatalogEntry>, CatalogError> {
        let key = self.platform_key();
        let mut request = self.client.get(self.url("models"));
        // Каталог открытый: без ключа тоже отдаётся.
        if !key.expose().trim().is_empty() {
            request = request.bearer_auth(key.expose());
        }
        let response = request
            .send()
            .await
            .map_err(|error| CatalogError::Unavailable(without_url(&error)))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|error| CatalogError::Unavailable(without_url(&error)))?;
        if !status.is_success() {
            return Err(CatalogError::Unavailable(error_message(
                status.as_u16(),
                &text,
            )));
        }
        parse_catalog(&text)
    }
}

impl Provider for OpenRouter {
    fn complete<'a>(
        &'a self,
        call: &'a ProviderCall,
    ) -> BoxFuture<'a, Result<ProviderReply, ProviderError>> {
        Box::pin(self.send(call, None))
    }

    fn stream<'a>(
        &'a self,
        call: &'a ProviderCall,
        delta: Delta,
    ) -> BoxFuture<'a, Result<ProviderReply, ProviderError>> {
        Box::pin(self.send(call, Some(delta)))
    }
}

/// Поток OpenRouter (SSE): куски `choices[0].delta.content` — в `delta`
/// сразу; расход — из последнего куска (`usage`), конец — `[DONE]`. Итог
/// собирается в обычный ответ и разбирается [`parse_reply`]: те же правила
/// «расход не сообщён — худший».
async fn read_stream(
    mut response: reqwest::Response,
    delta: &Delta,
    call: &ProviderCall,
) -> Result<ProviderReply, ProviderError> {
    let mut lines = Lines::default();
    let mut text = String::new();
    let mut usage = serde_json::Value::Null;
    let mut done = false;
    while let Some(chunk) = response.chunk().await.map_err(|error| {
        ProviderError::Unknown(format!("поток оборвался: {}", without_url(&error)))
    })? {
        for line in lines.push(&chunk) {
            let Some(data) = line.trim().strip_prefix("data:").map(str::trim) else {
                continue; // пустые строки и «: OPENROUTER PROCESSING»
            };
            if data == "[DONE]" {
                done = true;
                continue;
            }
            let Ok(json) = serde_json::from_str::<serde_json::Value>(data) else {
                continue;
            };
            if let Some(error) = json.get("error") {
                return Err(ProviderError::Unknown(format!(
                    "ошибка во время ответа: {}",
                    error["message"].as_str().unwrap_or_default()
                )));
            }
            if let Some(piece) = json["choices"][0]["delta"]["content"].as_str()
                && !piece.is_empty()
            {
                text.push_str(piece);
                let _ = delta.send(piece.to_owned());
            }
            if json["usage"].is_object() {
                usage = json["usage"].clone();
            }
        }
    }
    if !done {
        return Err(ProviderError::Unknown("поток оборвался без [DONE]".into()));
    }
    let whole = serde_json::json!({
        "choices": [{ "message": { "content": text } }],
        "usage": usage,
    });
    parse_reply(&whole.to_string(), call)
}

/// Строки потока из кусков сети. Копит байты, а не текст: кусок может
/// кончиться посреди русской буквы. Строка до «\n» — целая: байт «\n» не
/// бывает внутри символа UTF-8.
#[derive(Debug, Default)]
struct Lines(Vec<u8>);

impl Lines {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.0.extend_from_slice(chunk);
        let Some(last) = self.0.iter().rposition(|b| *b == b'\n') else {
            return Vec::new();
        };
        let ready: Vec<u8> = self.0.drain(..=last).collect();
        String::from_utf8_lossy(&ready)
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

/// Настройки маршрута для OpenRouter (`provider`): закреплённые провайдеры —
/// `order` + `only` + `allow_fallbacks: false` (без автосмены); потолок цены
/// из каталога — `max_price` ($ за миллион токенов): если провайдер дороже,
/// OpenRouter запрос не выполнит.
fn provider_preferences(
    call: &ProviderCall,
    default_collection: Option<&str>,
) -> Option<serde_json::Value> {
    let routing = &call.routing;
    let mut provider = serde_json::Map::new();
    if !routing.providers.is_empty() {
        provider.insert("order".into(), serde_json::json!(routing.providers));
        provider.insert("only".into(), serde_json::json!(routing.providers));
        provider.insert("allow_fallbacks".into(), serde_json::json!(false));
    }
    if let Some(collection) = routing.data_collection.as_deref().or(default_collection) {
        provider.insert("data_collection".into(), serde_json::json!(collection));
    }
    if routing.max_price_in_per_mtok > 0 || routing.max_price_out_per_mtok > 0 {
        provider.insert(
            "max_price".into(),
            serde_json::json!({
                "prompt": routing.max_price_in_per_mtok as f64 / 1_000_000.0,
                "completion": routing.max_price_out_per_mtok as f64 / 1_000_000.0,
            }),
        );
    }
    (!provider.is_empty()).then_some(serde_json::Value::Object(provider))
}

/// Текст ошибки reqwest без адреса (в адресе нет ключа, но и лишнего не пишем).
fn without_url(error: &reqwest::Error) -> String {
    let mut error = error.to_string();
    if let Some(at) = error.find(" for url (") {
        error.truncate(at);
    }
    error
}

#[derive(Deserialize)]
struct ErrorBody {
    error: Option<ErrorDetail>,
}

#[derive(Deserialize)]
struct ErrorDetail {
    message: Option<String>,
}

fn error_message(status: u16, body: &str) -> String {
    let message = serde_json::from_str::<ErrorBody>(body)
        .ok()
        .and_then(|b| b.error)
        .and_then(|e| e.message)
        .unwrap_or_default();
    let message: String = message.chars().take(300).collect();
    if message.is_empty() {
        format!("HTTP {status}")
    } else {
        format!("HTTP {status}: {message}")
    }
}

#[derive(Deserialize)]
struct ChatBody {
    choices: Option<Vec<Choice>>,
    usage: Option<Usage>,
    error: Option<ErrorDetail>,
}

#[derive(Deserialize)]
struct Choice {
    message: Option<Message>,
}

#[derive(Deserialize)]
struct Message {
    content: Option<String>,
}

#[derive(Deserialize)]
struct Usage {
    prompt_tokens: Option<u64>,
    completion_tokens: Option<u64>,
    /// В кредитах OpenRouter (1 кредит = 1 $).
    cost: Option<f64>,
}

/// Ответ 2xx. Модель отработала, поэтому всё непонятное — «неизвестно»,
/// а не «не отправлено»: повторять нельзя.
fn parse_reply(body: &str, call: &ProviderCall) -> Result<ProviderReply, ProviderError> {
    let body: ChatBody = serde_json::from_str(body)
        .map_err(|error| ProviderError::Unknown(format!("ответ не прочитан: {error}")))?;
    if let Some(error) = body.error {
        return Err(ProviderError::Unknown(format!(
            "ошибка во время ответа: {}",
            error.message.unwrap_or_default()
        )));
    }
    let text = body
        .choices
        .and_then(|choices| choices.into_iter().next())
        .and_then(|choice| choice.message)
        .and_then(|message| message.content)
        .ok_or_else(|| ProviderError::Unknown("в ответе нет текста".into()))?;
    // Расход не сообщён — считаем худший: вся оценка входа и весь потолок ответа.
    let usage = body.usage;
    let tokens_in = usage
        .as_ref()
        .and_then(|u| u.prompt_tokens)
        .unwrap_or(call.input_tokens_estimate);
    let tokens_out = usage
        .as_ref()
        .and_then(|u| u.completion_tokens)
        .unwrap_or(u64::from(call.max_output_tokens));
    let cost_usd = usage
        .and_then(|u| u.cost)
        .filter(|c| c.is_finite() && *c >= 0.0)
        .map(|c| (c * 1_000_000.0).ceil() as i64);
    Ok(ProviderReply {
        text,
        tokens_in,
        tokens_out,
        cost_usd,
    })
}

#[derive(Deserialize)]
struct CatalogBody {
    data: Vec<CatalogModel>,
}

#[derive(Deserialize)]
struct CatalogModel {
    id: String,
    context_length: Option<u64>,
    pricing: Option<Pricing>,
}

#[derive(Deserialize)]
struct Pricing {
    prompt: Option<String>,
    completion: Option<String>,
    request: Option<String>,
}

pub(crate) fn parse_catalog(body: &str) -> Result<Vec<CatalogEntry>, CatalogError> {
    let body: CatalogBody =
        serde_json::from_str(body).map_err(|error| CatalogError::Invalid(error.to_string()))?;
    let mut entries = Vec::with_capacity(body.data.len());
    for model in body.data {
        let Some(pricing) = model.pricing else {
            continue;
        };
        let per_request = pricing
            .request
            .as_deref()
            .map(usd_per_token_to_micros_per_mtok);
        if !matches!(per_request, None | Some(Some(0))) {
            continue;
        }
        let (Some(Some(price_in)), Some(Some(price_out))) = (
            pricing
                .prompt
                .as_deref()
                .map(usd_per_token_to_micros_per_mtok),
            pricing
                .completion
                .as_deref()
                .map(usd_per_token_to_micros_per_mtok),
        ) else {
            continue;
        };
        entries.push(CatalogEntry {
            external_id: model.id,
            context_tokens: i32::try_from(model.context_length.unwrap_or(0)).unwrap_or(i32::MAX),
            price_in_per_mtok: price_in,
            price_out_per_mtok: price_out,
        });
    }
    Ok(entries)
}

/// «$ за токен» строкой (`"0.0000004"`) → микродоллары за миллион токенов
/// (× 10¹²), с округлением вверх и без плавающей точки. Отрицательная цена
/// (у OpenRouter — «плавающая») и мусор → `None`.
pub fn usd_per_token_to_micros_per_mtok(price: &str) -> Option<i64> {
    const SCALE: u32 = 12;
    let price = price.trim();
    let (int, frac) = price.split_once('.').unwrap_or((price, ""));
    if int.is_empty() && frac.is_empty()
        || !int.bytes().all(|b| b.is_ascii_digit())
        || !frac.bytes().all(|b| b.is_ascii_digit())
    {
        return None;
    }
    let mut value: i128 = if int.is_empty() { 0 } else { int.parse().ok()? };
    value = value.checked_mul(10_i128.pow(SCALE))?;
    let kept = &frac[..frac.len().min(SCALE as usize)];
    if !kept.is_empty() {
        let digits: i128 = kept.parse().ok()?;
        value += digits * 10_i128.pow(SCALE - kept.len() as u32);
    }
    if frac.len() > SCALE as usize && frac.as_bytes()[SCALE as usize..].iter().any(|b| *b != b'0') {
        value += 1;
    }
    i64::try_from(value).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn letter_split_between_chunks_stays_whole() {
        let line = "data: {\"why\":\"ошибка\"}\n".as_bytes();
        // Режем посреди «ш» (два байта).
        let cut = "data: {\"why\":\"о".len() + 1;
        let mut lines = Lines::default();
        assert!(lines.push(&line[..cut]).is_empty());
        assert_eq!(lines.push(&line[cut..]), ["data: {\"why\":\"ошибка\"}"]);
    }

    #[test]
    fn prices_convert_exactly_and_round_up() {
        assert_eq!(usd_per_token_to_micros_per_mtok("0.0000004"), Some(400_000)); // $0,40 / Mtok
        assert_eq!(usd_per_token_to_micros_per_mtok("0.0000001"), Some(100_000));
        assert_eq!(usd_per_token_to_micros_per_mtok("0"), Some(0));
        assert_eq!(
            usd_per_token_to_micros_per_mtok("0.000015"),
            Some(15_000_000)
        );
        assert_eq!(
            usd_per_token_to_micros_per_mtok("2"),
            Some(2_000_000_000_000)
        );
        // Доли микродоллара за миллион — вверх.
        assert_eq!(usd_per_token_to_micros_per_mtok("0.0000000000001"), Some(1));
        assert_eq!(usd_per_token_to_micros_per_mtok("-1"), None);
        assert_eq!(usd_per_token_to_micros_per_mtok("abc"), None);
        assert_eq!(usd_per_token_to_micros_per_mtok(""), None);
        assert_eq!(usd_per_token_to_micros_per_mtok("1e-7"), None);
    }
}
