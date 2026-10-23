//! Провайдер «ChatGPT по подписке» (AI-005, D-219): Sign in with ChatGPT для
//! open-source клиентов — https://developers.openai.com/siwc/token-sharing-open-source
//!
//! - **Вход:** у каждого человека свой (D-493, AI-003). OIDC + PKCE (S256)
//!   через браузер; адрес возврата — `http://127.0.0.1:<порт>/auth/callback`
//!   (сервер слушает его сам, а если браузер на другом компьютере — человек
//!   вставляет адрес возврата в Qubite). Первый вход регистрирует клиента
//!   (`client_id = dynamic_agent_client`), OpenAI выдаёт свой `oaiapp_…` —
//!   он и `ext_agent_host_id` этой установки хранятся и переиспользуются.
//!   `ext_agent_host_id` — только в формате, который принимает OpenAI:
//!   `urn:uuid:<UUIDv4>` (D-280); иначе вход отвечает `invalid_authorize_request`.
//! - **Токены** — только зашифрованными ([`SecretBox`]); access живёт час,
//!   обновляется заранее (за 5 минут), refresh одноразовый (ротация),
//!   обновление — под блокировкой строки, чтобы два процесса не «сожгли» его.
//! - **Запросы** — Responses API (`POST /v1/responses`), всегда `stream: true`
//!   и `store: false`; инструкции — в `instructions` (системные сообщения
//!   маршрут отклоняет); `max_output_tokens` не поддерживается.
//! - **Деньги:** платит подписка, поэтому стоимость 0 $, а учёт — по запросам
//!   и токенам в тех же лимитах. Подписка — **только для собственных запросов**
//!   того, кто вошёл: запрос идёт с токенами его автора.
//! - **Лимит подписки** (`subscription_sharing_usage_limit_exceeded`): понятная
//!   ошибка и пауза новых запросов на 15 минут (время сброса OpenAI не сообщает).

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::{
    digest,
    rand::{SecureRandom, SystemRandom},
};
use serde::Deserialize;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    openrouter::{CatalogEntry, CatalogError},
    provider::{
        BoxFuture, ChatMessage, Delta, Provider, ProviderCall, ProviderError, ProviderReply, Role,
    },
    secret::SecretBox,
};

/// ID провайдера в `ai_providers` и приставка ID моделей (`chatgpt:<slug>`).
pub const PROVIDER_ID: &str = "chatgpt";
pub const AUTH_BASE: &str = "https://auth.openai.com";
pub const API_BASE: &str = "https://api.openai.com/v1";
/// Ресурс, для которого выдаются токены.
pub const RESOURCE: &str = "https://api.openai.com/v1";
pub const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
/// Без этого разрешения подписку использовать нельзя (одного входа мало).
pub const PLAN_SCOPE: &str = "chatgpt.tokens.use.direct";
const REGISTRATION_CLIENT: &str = "dynamic_agent_client";
const LIMIT_PAUSE: Duration = Duration::from_secs(15 * 60);

#[derive(Debug, Clone)]
pub struct ChatGptConfig {
    /// Адрес входа OpenAI (он же `iss` в ID-токене).
    pub auth_base: String,
    pub api_base: String,
    pub connect_timeout: Duration,
    /// Прокси (`QUBITE_PROXY`); без него — системный `HTTPS_PROXY`.
    pub proxy: Option<String>,
}

impl Default for ChatGptConfig {
    fn default() -> Self {
        Self {
            auth_base: AUTH_BASE.into(),
            api_base: API_BASE.into(),
            connect_timeout: Duration::from_secs(10),
            proxy: None,
        }
    }
}

impl ChatGptConfig {
    fn authorize_url(&self) -> String {
        format!(
            "{}/api/accounts/authorize",
            self.auth_base.trim_end_matches('/')
        )
    }

    fn token_url(&self) -> String {
        format!(
            "{}/api/accounts/oauth/token",
            self.auth_base.trim_end_matches('/')
        )
    }

    fn api(&self, path: &str) -> String {
        format!("{}/{path}", self.api_base.trim_end_matches('/'))
    }
}

fn http_client(config: &ChatGptConfig) -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    qubite_net::client(config.proxy.as_deref())?
        .connect_timeout(config.connect_timeout)
        .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|error| format!("HTTP-клиент не создан: {error}"))
}

fn random_token(bytes: usize) -> String {
    let mut buf = vec![0_u8; bytes];
    SystemRandom::new().fill(&mut buf).expect("случайные байты");
    URL_SAFE_NO_PAD.encode(buf)
}

/// `code_challenge` для PKCE S256: base64url(SHA-256(verifier)) без `=`.
pub fn pkce_challenge(verifier: &str) -> String {
    URL_SAFE_NO_PAD.encode(digest::digest(&digest::SHA256, verifier.as_bytes()))
}

// ---------------------------------------------------------------- вход

/// Новый `ext_agent_host_id`: UUIDv4 с приставкой `urn:uuid:` — один из
/// форматов, которые принимает OpenAI (D-280).
pub fn new_host_id() -> String {
    format!("urn:uuid:{}", Uuid::new_v4().hyphenated())
}

/// Примет ли OpenAI такой `ext_agent_host_id`: `urn:uuid:<UUID>`,
/// `urn:ietf:params:oauth:jwk-thumbprint:…` или `did:key:…`.
pub fn host_id_ok(host_id: &str) -> bool {
    if let Some(uuid) = host_id.strip_prefix("urn:uuid:") {
        return uuid.len() == 36 && Uuid::parse_str(uuid).is_ok();
    }
    ["urn:ietf:params:oauth:jwk-thumbprint:", "did:key:"]
        .iter()
        .any(|prefix| host_id.len() > prefix.len() && host_id.starts_with(prefix))
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: Option<String>,
    id_token: Option<String>,
    expires_in: Option<i64>,
    /// OAuth-стандарт — строка через пробел; в примерах OpenAI — `scopes`.
    scope: Option<String>,
    scopes: Option<serde_json::Value>,
}

impl TokenResponse {
    fn scopes(&self) -> String {
        if let Some(scope) = &self.scope {
            return scope.clone();
        }
        match &self.scopes {
            Some(serde_json::Value::String(s)) => s.clone(),
            Some(serde_json::Value::Array(list)) => list
                .iter()
                .filter_map(|v| v.as_str())
                .collect::<Vec<_>>()
                .join(" "),
            _ => String::new(),
        }
    }
}

#[derive(Debug, Deserialize)]
struct IdClaims {
    iss: String,
    aud: serde_json::Value,
    exp: i64,
    nonce: Option<String>,
    sub: String,
    email: Option<String>,
}

/// Проверка ID-токена. Он получен напрямую с адреса токенов OpenAI по TLS,
/// поэтому издателя подтверждает TLS (OpenID Connect Core 3.1.3.7, п. 6);
/// проверяем издателя, получателя (`aud` = наш `client_id`), срок и `nonce`.
fn check_id_token(
    id_token: &str,
    issuer: &str,
    client_id: &str,
    nonce: &str,
) -> Result<IdClaims, String> {
    let payload = id_token
        .split('.')
        .nth(1)
        .ok_or("ID-токен не похож на JWT")?;
    let json = URL_SAFE_NO_PAD
        .decode(payload.trim_end_matches('='))
        .map_err(|_| "ID-токен не прочитан")?;
    let claims: IdClaims =
        serde_json::from_slice(&json).map_err(|error| format!("ID-токен: {error}"))?;
    if claims.iss.trim_end_matches('/') != issuer.trim_end_matches('/') {
        return Err(format!("чужой издатель ID-токена: {}", claims.iss));
    }
    let aud_ok = match &claims.aud {
        serde_json::Value::String(aud) => aud == client_id,
        serde_json::Value::Array(list) => list.iter().any(|a| a.as_str() == Some(client_id)),
        _ => false,
    };
    if !aud_ok {
        return Err("ID-токен выдан другому приложению".into());
    }
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    if claims.exp + 60 < now {
        return Err("ID-токен просрочен".into());
    }
    if claims.nonce.as_deref() != Some(nonce) {
        return Err("nonce не совпал — вход отклонён".into());
    }
    Ok(claims)
}

/// Итог входа.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginResult {
    pub email: Option<String>,
    pub client_id: String,
    pub scopes: String,
}

/// Начатый вход: страница OpenAI, куда отправить человека.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LoginStart {
    pub url: String,
    pub state: String,
}

/// Сколько живёт начатый вход (возврат позже — «начните снова»).
const LOGIN_TTL_SECS: f64 = 600.0;

/// Установка (одна на сервер): `ext_agent_host_id` и выданный `client_id`.
async fn installation(pool: &PgPool) -> Result<(String, Option<String>), String> {
    let db = |error: sqlx::Error| format!("база: {error}");
    sqlx::query(
        "INSERT INTO ai_chatgpt_session (singleton, host_id) VALUES (true, $1) \
         ON CONFLICT (singleton) DO NOTHING",
    )
    .bind(new_host_id())
    .execute(pool)
    .await
    .map_err(db)?;
    // До D-280 ID установки был `qubite-<hex>` — OpenAI его не принимал, и
    // вход ни разу не прошёл. Такой ID заменяем; выданного client_id у него нет.
    let old: String = sqlx::query_scalar("SELECT host_id FROM ai_chatgpt_session WHERE singleton")
        .fetch_one(pool)
        .await
        .map_err(db)?;
    if !host_id_ok(&old) {
        sqlx::query("UPDATE ai_chatgpt_session SET host_id = $1 WHERE singleton")
            .bind(new_host_id())
            .execute(pool)
            .await
            .map_err(db)?;
    }
    sqlx::query_as("SELECT host_id, client_id FROM ai_chatgpt_session WHERE singleton")
        .fetch_one(pool)
        .await
        .map_err(db)
}

/// Начать вход человека `account_id` (D-493: у каждого — своя подписка).
/// `redirect_uri` — `http://127.0.0.1:<порт>/auth/callback`; проверка возврата
/// (state), PKCE и nonce остаются на сервере.
pub async fn begin_login(
    pool: &PgPool,
    config: &ChatGptConfig,
    secret: &SecretBox,
    account_id: Uuid,
    redirect_uri: &str,
) -> Result<LoginStart, String> {
    let db = |error: sqlx::Error| format!("база: {error}");
    let (host_id, saved_client) = installation(pool).await?;
    let saved_email: Option<String> =
        sqlx::query_scalar("SELECT email FROM ai_chatgpt_tokens WHERE account_id = $1")
            .bind(account_id)
            .fetch_optional(pool)
            .await
            .map_err(db)?
            .flatten();
    let verifier = random_token(32);
    let state = random_token(24);
    let nonce = random_token(24);
    sqlx::query(
        "DELETE FROM ai_chatgpt_logins WHERE created_at < now() - $1::float8 * interval '1 second'",
    )
    .bind(LOGIN_TTL_SECS)
    .execute(pool)
    .await
    .map_err(db)?;
    sqlx::query(
        "INSERT INTO ai_chatgpt_logins (state, account_id, verifier, nonce, redirect_uri) \
         VALUES ($1, $2, $3, $4, $5)",
    )
    .bind(&state)
    .bind(account_id)
    .bind(secret.seal("chatgpt.verifier", &verifier))
    .bind(&nonce)
    .bind(redirect_uri)
    .execute(pool)
    .await
    .map_err(db)?;
    let client_for_request = saved_client
        .clone()
        .unwrap_or_else(|| REGISTRATION_CLIENT.into());
    let challenge = pkce_challenge(&verifier);
    let mut params: Vec<(&str, &str)> = vec![
        ("client_id", &client_for_request),
        ("ext_agent_host_id", &host_id),
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("scope", SCOPES),
        ("resource", RESOURCE),
        ("state", &state),
        ("nonce", &nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", &challenge),
    ];
    if saved_client.is_none() {
        params.push(("agent_name_hint", "Qubite"));
    }
    if let Some(email) = &saved_email {
        params.push(("login_hint", email));
    }
    let url = reqwest::Url::parse_with_params(&config.authorize_url(), &params)
        .map_err(|error| format!("адрес входа: {error}"))?;
    Ok(LoginStart {
        url: url.into(),
        state,
    })
}

/// Закончить вход: `callback` — адрес возврата целиком (`http://127.0.0.1:…/auth/callback?code=…`)
/// или только его параметры. Вход принимается, только если его начал этот же человек.
pub async fn finish_login(
    pool: &PgPool,
    config: &ChatGptConfig,
    secret: &SecretBox,
    account_id: Uuid,
    callback: &str,
) -> Result<LoginResult, String> {
    let db = |error: sqlx::Error| format!("база: {error}");
    let callback = callback.trim();
    let query = callback
        .split_once('?')
        .map_or(callback, |(_, query)| query)
        .split('#')
        .next()
        .unwrap_or_default();
    let params: Vec<(String, String)> = url_params(query);
    let get = |name: &str| {
        params
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    };
    let state = get("state").ok_or("в адресе нет state — скопируйте адрес целиком")?;
    type Pending = (String, String, String, bool);
    // Один раз: строка удаляется сразу — тот же адрес второй раз не примется.
    let pending: Option<Pending> = sqlx::query_as(
        "DELETE FROM ai_chatgpt_logins WHERE state = $1 AND account_id = $2 \
         RETURNING verifier, nonce, redirect_uri, \
                   created_at > now() - $3::float8 * interval '1 second'",
    )
    .bind(&state)
    .bind(account_id)
    .bind(LOGIN_TTL_SECS)
    .fetch_optional(pool)
    .await
    .map_err(db)?;
    let Some((verifier, nonce, redirect_uri, fresh)) = pending else {
        return Err("этот вход не найден или уже закончен — начните снова".into());
    };
    if !fresh {
        return Err("вход начат слишком давно (больше 10 минут) — начните снова".into());
    }
    if let Some(error) = get("error") {
        return Err(if error == "access_denied" {
            "вы отказались на экране входа".to_owned()
        } else {
            format!("OpenAI вернул ошибку: {error}")
        });
    }
    let code = get("code").ok_or("в адресе нет кода входа — скопируйте адрес целиком")?;
    let verifier = secret
        .open("chatgpt.verifier", &verifier)
        .map_err(|e| format!("вход: {e}"))?;
    let (_, saved_client) = installation(pool).await?;
    let client_id = match (&saved_client, get("client_id")) {
        (Some(saved), Some(given)) if &given != saved => {
            return Err("OpenAI вернул другой client_id — вход отклонён".into());
        }
        (Some(saved), _) => saved.clone(),
        (None, Some(given)) => given,
        (None, None) => return Err("OpenAI не выдал client_id при первом входе".into()),
    };

    let client = http_client(config)?;
    let response = client
        .post(config.token_url())
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect_uri),
            ("resource", RESOURCE),
        ])
        .send()
        .await
        .map_err(|error| format!("обмен кода не удался: {}", short(&error)))?;
    let status = response.status();
    let body = response.text().await.map_err(|e| short(&e))?;
    if !status.is_success() {
        return Err(format!(
            "OpenAI не выдал токены ({status}): {}",
            oauth_error(&body).unwrap_or_default()
        ));
    }
    let tokens: TokenResponse =
        serde_json::from_str(&body).map_err(|error| format!("ответ с токенами: {error}"))?;
    let scopes = tokens.scopes();
    if !scopes.split_whitespace().any(|s| s == PLAN_SCOPE) {
        return Err(
            "вход есть, но использовать подписку не разрешено (нет chatgpt.tokens.use.direct) — \
             нужен ChatGPT Plus или Pro и согласие на экране входа"
                .into(),
        );
    }
    let id_token = tokens.id_token.as_deref().ok_or("нет ID-токена")?;
    let claims = check_id_token(id_token, &config.auth_base, &client_id, &nonce)?;
    let refresh = tokens
        .refresh_token
        .as_deref()
        .ok_or("нет refresh-токена (offline_access)")?;

    let mut tx = pool.begin().await.map_err(db)?;
    sqlx::query("UPDATE ai_chatgpt_session SET client_id = $1, updated_at = now() WHERE singleton")
        .bind(&client_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
    sqlx::query(
        "INSERT INTO ai_chatgpt_tokens (account_id, subject, email, scopes, access_token_enc, \
         refresh_token_enc, id_token_enc, expires_at, updated_at) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, now() + $8::float8 * interval '1 second', now()) \
         ON CONFLICT (account_id) DO UPDATE SET subject = EXCLUDED.subject, email = EXCLUDED.email, \
         scopes = EXCLUDED.scopes, access_token_enc = EXCLUDED.access_token_enc, \
         refresh_token_enc = EXCLUDED.refresh_token_enc, id_token_enc = EXCLUDED.id_token_enc, \
         expires_at = EXCLUDED.expires_at, updated_at = now()",
    )
    .bind(account_id)
    .bind(&claims.sub)
    .bind(&claims.email)
    .bind(&scopes)
    .bind(secret.seal("chatgpt.access", &tokens.access_token))
    .bind(secret.seal("chatgpt.refresh", refresh))
    .bind(secret.seal("chatgpt.id", id_token))
    .bind(tokens.expires_in.unwrap_or(3600) as f64)
    .execute(&mut *tx)
    .await
    .map_err(db)?;
    tx.commit().await.map_err(db)?;
    Ok(LoginResult {
        email: claims.email,
        client_id,
        scopes,
    })
}

/// Параметры адреса (`a=1&b=2`) с раскодированием.
fn url_params(query: &str) -> Vec<(String, String)> {
    reqwest::Url::parse(&format!("http://127.0.0.1/?{query}"))
        .map(|url| {
            url.query_pairs()
                .map(|(k, v)| (k.into_owned(), v.into_owned()))
                .collect()
        })
        .unwrap_or_default()
}

/// Свой порт на 127.0.0.1 для возврата из браузера: слушатель и адрес возврата.
/// `port` 0 — любой свободный.
pub async fn loopback(port: u16) -> Result<(tokio::net::TcpListener, String), String> {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|error| format!("порт {port} занят ({error}); укажите другой: --port"))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    // Только 127.0.0.1 (не localhost), путь и схема всегда одни и те же.
    Ok((listener, format!("http://127.0.0.1:{port}/auth/callback")))
}

/// Дождаться возврата из браузера (до 5 минут) — адрес возврата целиком.
pub async fn await_callback(
    listener: &tokio::net::TcpListener,
    state: &str,
) -> Result<String, String> {
    tokio::time::timeout(Duration::from_secs(300), wait_for_callback(listener, state))
        .await
        .map_err(|_| "вход не завершён за 5 минут".to_owned())?
}

/// Вход через браузер из команды (`qubite ai chatgpt login`). `open` получает
/// адрес страницы входа (CLI печатает его и открывает системный браузер; тест —
/// «нажимает» сам). Ждёт возврата на `127.0.0.1:<port>` до 5 минут.
pub async fn login(
    pool: &PgPool,
    config: &ChatGptConfig,
    secret: &SecretBox,
    account_id: Uuid,
    port: u16,
    open: impl FnOnce(&str),
) -> Result<LoginResult, String> {
    let (listener, redirect_uri) = loopback(port).await?;
    let start = begin_login(pool, config, secret, account_id, &redirect_uri).await?;
    open(&start.url);
    let callback = await_callback(&listener, &start.state).await?;
    finish_login(pool, config, secret, account_id, &callback).await
}

async fn wait_for_callback(
    listener: &tokio::net::TcpListener,
    state: &str,
) -> Result<String, String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    loop {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0_u8; 8192];
        let n = stream.read(&mut buf).await.unwrap_or(0);
        let head = String::from_utf8_lossy(&buf[..n]).into_owned();
        let target = head
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .unwrap_or("/")
            .to_owned();
        let Ok(url) = reqwest::Url::parse(&format!("http://127.0.0.1{target}")) else {
            continue;
        };
        if url.path() != "/auth/callback" {
            let _ = stream
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n",
                )
                .await;
            continue;
        }
        let get = |name: &str| {
            url.query_pairs()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.into_owned())
        };
        let (status, page, done) = if get("state").as_deref() != Some(state) {
            // Чужой или подделанный возврат — не обмениваем код и ждём дальше.
            ("400 Bad Request", "Неверный state — вход не принят.", false)
        } else if get("error").is_some() {
            ("200 OK", "Вход отменён. Окно можно закрыть.", true)
        } else if get("code").is_some() {
            (
                "200 OK",
                "Qubite подключён к ChatGPT. Окно можно закрыть.",
                true,
            )
        } else {
            ("400 Bad Request", "В ответе нет кода.", false)
        };
        let html = format!(
            "<!doctype html><meta charset=utf-8><title>Qubite</title><p style=\"font-family:sans-serif\">{page}</p>"
        );
        let _ = stream
            .write_all(
                format!(
                    "HTTP/1.1 {status}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{html}",
                    html.len()
                )
                .as_bytes(),
            )
            .await;
        if done {
            return Ok(url.into());
        }
    }
}

fn short(error: &reqwest::Error) -> String {
    let mut text = error.to_string();
    if let Some(at) = text.find(" for url (") {
        text.truncate(at);
    }
    text
}

/// `error` / `error.code` / `detail` из ответа — только как диагностика.
fn oauth_error(body: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(body).ok()?;
    let code = match &json["error"] {
        serde_json::Value::String(s) => Some(s.clone()),
        serde_json::Value::Object(o) => o.get("code").and_then(|c| c.as_str()).map(Into::into),
        _ => None,
    };
    code.or_else(|| {
        json["detail"]
            .as_str()
            .map(|d| d.chars().take(200).collect())
    })
}

/// Состояние связи с ChatGPT (для `qubite ai chatgpt status`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Status {
    pub connected: bool,
    pub email: Option<String>,
    pub account_id: Option<Uuid>,
    pub scopes: Option<String>,
}

/// Подключена ли подписка у человека `account_id`.
pub async fn status(pool: &PgPool, account_id: Uuid) -> Result<Status, sqlx::Error> {
    type Row = (bool, Option<String>, Option<String>);
    let row: Option<Row> = sqlx::query_as(
        "SELECT refresh_token_enc IS NOT NULL, email, scopes \
         FROM ai_chatgpt_tokens WHERE account_id = $1",
    )
    .bind(account_id)
    .fetch_optional(pool)
    .await?;
    Ok(match row {
        Some((connected, email, scopes)) => Status {
            connected,
            email,
            account_id: Some(account_id),
            scopes,
        },
        None => Status {
            connected: false,
            email: None,
            account_id: None,
            scopes: None,
        },
    })
}

/// Кто-нибудь подключил подписку (owner — первым): через его вход берётся
/// список моделей подписки для каталога.
pub async fn any_connected(pool: &PgPool) -> Result<Option<Uuid>, sqlx::Error> {
    sqlx::query_scalar(
        "SELECT t.account_id FROM ai_chatgpt_tokens t \
         LEFT JOIN platform_owner o ON o.account_id = t.account_id \
         WHERE t.refresh_token_enc IS NOT NULL \
         ORDER BY o.account_id IS NULL, t.updated_at DESC LIMIT 1",
    )
    .fetch_optional(pool)
    .await
}

/// Выйти: отозвать refresh-токен у OpenAI (адрес — из OpenID-конфигурации)
/// и стереть токены человека. `client_id` и `host_id` установки остаются для
/// следующего входа. Возвращает `true`, если отзыв у OpenAI подтверждён.
pub async fn logout(
    pool: &PgPool,
    config: &ChatGptConfig,
    secret: &SecretBox,
    account_id: Uuid,
) -> Result<bool, String> {
    let row: Option<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT s.client_id, t.refresh_token_enc FROM ai_chatgpt_tokens t \
         LEFT JOIN ai_chatgpt_session s ON s.singleton WHERE t.account_id = $1",
    )
    .bind(account_id)
    .fetch_optional(pool)
    .await
    .map_err(|e| e.to_string())?;
    let mut revoked = false;
    if let Some((Some(client_id), Some(sealed))) = row
        && let Ok(refresh) = secret.open("chatgpt.refresh", &sealed)
    {
        revoked = revoke(config, &client_id, &refresh).await.unwrap_or(false);
    }
    sqlx::query("DELETE FROM ai_chatgpt_tokens WHERE account_id = $1")
        .bind(account_id)
        .execute(pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(revoked)
}

async fn revoke(config: &ChatGptConfig, client_id: &str, refresh: &str) -> Result<bool, String> {
    let client = http_client(config)?;
    let discovery: serde_json::Value = client
        .get(format!(
            "{}/.well-known/openid-configuration",
            config.auth_base.trim_end_matches('/')
        ))
        .send()
        .await
        .map_err(|e| short(&e))?
        .json()
        .await
        .map_err(|e| short(&e))?;
    let Some(endpoint) = discovery["revocation_endpoint"].as_str() else {
        return Ok(false);
    };
    let response = client
        .post(endpoint)
        .form(&[
            ("token", refresh),
            ("token_type_hint", "refresh_token"),
            ("client_id", client_id),
        ])
        .send()
        .await
        .map_err(|e| short(&e))?;
    Ok(response.status().is_success())
}

// ---------------------------------------------------------------- провайдер

pub struct ChatGpt {
    client: reqwest::Client,
    config: ChatGptConfig,
    pool: PgPool,
    secret: Arc<SecretBox>,
    /// Пауза после лимита подписки — у каждого своя (подписки разные).
    paused_until: Mutex<HashMap<Uuid, Instant>>,
}

/// Ошибки обновления, после которых токены уже не годятся (нужен новый вход).
const TERMINAL_REFRESH: &[&str] = &[
    "invalid_grant",
    "invalid_refresh_token",
    "token_expired",
    "refresh_token_expired",
    "refresh_token_invalidated",
    "refresh_token_reused",
    "invalid_client",
];

impl ChatGpt {
    pub fn new(
        pool: PgPool,
        config: ChatGptConfig,
        secret: Arc<SecretBox>,
    ) -> Result<Self, String> {
        Ok(Self {
            client: http_client(&config)?,
            config,
            pool,
            secret,
            paused_until: Mutex::new(HashMap::new()),
        })
    }

    /// Действующий access-токен человека `account_id`. Обновление — под
    /// блокировкой строки: два процесса не обновят одноразовый refresh вместе.
    async fn access_token(
        &self,
        account_id: Uuid,
        force_refresh: bool,
    ) -> Result<String, ProviderError> {
        let not_sent = |what: String| ProviderError::NotSent(what);
        let db = |error: sqlx::Error| ProviderError::NotSent(format!("база: {error}"));
        let mut tx = self.pool.begin().await.map_err(db)?;
        type Row = (Option<String>, Option<String>, Option<String>, bool);
        let row: Option<Row> = sqlx::query_as(
            "SELECT s.client_id, t.access_token_enc, t.refresh_token_enc, \
                    coalesce(t.expires_at > now() + interval '5 minutes', false) \
             FROM ai_chatgpt_tokens t LEFT JOIN ai_chatgpt_session s ON s.singleton \
             WHERE t.account_id = $1 FOR UPDATE OF t",
        )
        .bind(account_id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(db)?;
        let Some((Some(client_id), Some(access), Some(refresh), fresh)) = row else {
            return Err(ProviderError::Refused(
                "ChatGPT не подключён — «Настройки → AI и бюджет → Войти через ChatGPT»".into(),
            ));
        };
        let open = |purpose: &str, sealed: &str| {
            self.secret
                .open(purpose, sealed)
                .map_err(|e| ProviderError::Refused(format!("токены ChatGPT: {e}")))
        };
        if fresh && !force_refresh {
            return open("chatgpt.access", &access);
        }
        let refresh = open("chatgpt.refresh", &refresh)?;
        let response = self
            .client
            .post(self.config.token_url())
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", client_id.as_str()),
                ("refresh_token", refresh.as_str()),
                ("resource", RESOURCE),
            ])
            .send()
            .await
            .map_err(|e| not_sent(format!("обновление токена ChatGPT: {}", short(&e))))?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|e| not_sent(format!("обновление токена ChatGPT: {}", short(&e))))?;
        if !status.is_success() {
            let code = oauth_error(&body).unwrap_or_default();
            if status.is_client_error() && TERMINAL_REFRESH.contains(&code.as_str()) {
                sqlx::query(
                    "UPDATE ai_chatgpt_tokens SET access_token_enc = NULL, refresh_token_enc = NULL, \
                     expires_at = NULL, updated_at = now() WHERE account_id = $1",
                )
                .bind(account_id)
                .execute(&mut *tx)
                .await
                .map_err(db)?;
                tx.commit().await.map_err(db)?;
                tracing::warn!(code, "сессия ChatGPT закончилась — нужен новый вход");
                return Err(ProviderError::Refused(
                    "сессия ChatGPT закончилась — войдите снова: «Настройки → AI и бюджет»".into(),
                ));
            }
            // Временная ошибка — токены не трогаем (не стирать из-за сбоя сети).
            return Err(not_sent(format!(
                "обновление токена ChatGPT: HTTP {status} {code}"
            )));
        }
        let tokens: TokenResponse = serde_json::from_str(&body)
            .map_err(|e| not_sent(format!("обновление токена ChatGPT: {e}")))?;
        let new_refresh = tokens.refresh_token.as_deref().unwrap_or(&refresh);
        let scopes = tokens.scopes();
        sqlx::query(
            "UPDATE ai_chatgpt_tokens SET access_token_enc = $1, refresh_token_enc = $2, \
             scopes = coalesce(nullif($3, ''), scopes), \
             expires_at = now() + $4::float8 * interval '1 second', updated_at = now() \
             WHERE account_id = $5",
        )
        .bind(self.secret.seal("chatgpt.access", &tokens.access_token))
        .bind(self.secret.seal("chatgpt.refresh", new_refresh))
        .bind(&scopes)
        .bind(tokens.expires_in.unwrap_or(3600) as f64)
        .bind(account_id)
        .execute(&mut *tx)
        .await
        .map_err(db)?;
        tx.commit().await.map_err(db)?;
        Ok(tokens.access_token)
    }

    fn paused(&self, account_id: Uuid) -> bool {
        let mut paused = self.paused_until.lock().expect("пауза");
        let now = Instant::now();
        paused.retain(|_, until| now < *until);
        paused.contains_key(&account_id)
    }

    fn pause(&self, account_id: Uuid) {
        self.paused_until
            .lock()
            .expect("пауза")
            .insert(account_id, Instant::now() + LIMIT_PAUSE);
    }

    async fn send(
        &self,
        call: &ProviderCall,
        delta: Option<Delta>,
    ) -> Result<ProviderReply, ProviderError> {
        if self.paused(call.account_id) {
            return Err(ProviderError::UsageLimit(usage_limit_message()));
        }
        // Подписка — только своя: токен того, чей это запрос (D-493).
        let mut token = self.access_token(call.account_id, false).await?;
        let instructions: Vec<&str> = call
            .messages
            .iter()
            .filter(|m| m.role == Role::System)
            .map(|m| m.content.as_str())
            .collect();
        let input: Vec<serde_json::Value> = call
            .messages
            .iter()
            .filter(|m| m.role != Role::System)
            .map(|ChatMessage { content, .. }| serde_json::json!({ "role": "user", "content": content }))
            .collect();
        let body = serde_json::json!({
            "model": call.external_id,
            "instructions": instructions.join("\n\n"),
            "input": input,
            "stream": true,
            "store": false,
        });
        for attempt in 0..2 {
            let response = self
                .client
                .post(self.config.api("responses"))
                .bearer_auth(&token)
                .json(&body)
                .send()
                .await
                .map_err(|error| {
                    if error.is_connect() {
                        ProviderError::NotSent(format!("нет соединения: {}", short(&error)))
                    } else {
                        ProviderError::Unknown(format!("обрыв: {}", short(&error)))
                    }
                })?;
            let status = response.status().as_u16();
            let text = if (200..300).contains(&status) {
                read_events(response, delta.as_ref()).await?
            } else {
                response.text().await.map_err(|e| {
                    ProviderError::Unknown(format!("ответ не дочитан: {}", short(&e)))
                })?
            };
            if (200..300).contains(&status) {
                let reply = parse_stream(&text);
                if matches!(reply, Err(ProviderError::UsageLimit(_))) {
                    self.pause(call.account_id);
                }
                return reply;
            }
            // 401 до начала потока — запрос не принят: обновить токен и один раз повторить.
            if status == 401 && attempt == 0 {
                token = self.access_token(call.account_id, true).await?;
                continue;
            }
            let error = admission_error(status, &text);
            if matches!(error, ProviderError::UsageLimit(_)) {
                self.pause(call.account_id);
            }
            return Err(error);
        }
        Err(ProviderError::Refused(
            "ChatGPT не принял вход — войдите снова: «Настройки → AI и бюджет»".into(),
        ))
    }

    /// Модели, доступные подписке человека (`GET /v1/models`), — в каталог по цене 0 $.
    pub async fn models(&self, account_id: Uuid) -> Result<Vec<CatalogEntry>, CatalogError> {
        let token = self
            .access_token(account_id, false)
            .await
            .map_err(|e| CatalogError::Unavailable(e.to_string()))?;
        let response = self
            .client
            .get(self.config.api("models"))
            .bearer_auth(token)
            .send()
            .await
            .map_err(|e| CatalogError::Unavailable(short(&e)))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .map_err(|e| CatalogError::Unavailable(short(&e)))?;
        if !status.is_success() {
            return Err(CatalogError::Unavailable(format!("HTTP {status}")));
        }
        parse_models(&text)
    }
}

impl Provider for ChatGpt {
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

/// Дочитать поток событий; куски текста (`response.output_text.delta`) —
/// в `delta` сразу, как пришли. Итог разбирает [`parse_stream`].
async fn read_events(
    mut response: reqwest::Response,
    delta: Option<&Delta>,
) -> Result<String, ProviderError> {
    let mut body: Vec<u8> = Vec::new();
    let mut seen = 0;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| ProviderError::Unknown(format!("ответ не дочитан: {}", short(&e))))?
    {
        body.extend_from_slice(&chunk);
        let Some(delta) = delta else { continue };
        // Готовые события — до последнего «\n\n», и только в новом хвосте:
        // весь ответ заново на каждом куске — квадратично от длины.
        let tail = &body[seen..];
        let Some(end) = tail.windows(2).rposition(|pair| pair == b"\n\n") else {
            continue;
        };
        for piece in text_deltas(&String::from_utf8_lossy(&tail[..end])) {
            let _ = delta.send(piece);
        }
        seen += end;
    }
    String::from_utf8(body).map_err(|_| ProviderError::Unknown("поток не в UTF-8".into()))
}

/// Куски текста из готовых событий потока.
fn text_deltas(events: &str) -> Vec<String> {
    events
        .split("\n\n")
        .filter_map(|event| {
            let data: String = event
                .lines()
                .filter_map(|line| line.strip_prefix("data:"))
                .map(str::trim_start)
                .collect::<Vec<_>>()
                .join("\n");
            let json: serde_json::Value = serde_json::from_str(&data).ok()?;
            (json["type"] == "response.output_text.delta")
                .then(|| json["delta"].as_str().unwrap_or_default().to_owned())
                .filter(|piece| !piece.is_empty())
        })
        .collect()
}

fn usage_limit_message() -> String {
    "лимит подписки ChatGPT исчерпан — подождите (ChatGPT → Настройки → Использование) \
     или выберите другую модель"
        .into()
}

pub(crate) fn parse_models(body: &str) -> Result<Vec<CatalogEntry>, CatalogError> {
    let json: serde_json::Value =
        serde_json::from_str(body).map_err(|e| CatalogError::Invalid(e.to_string()))?;
    let mut entries = Vec::new();
    if let Some(models) = json["models"].as_array() {
        for model in models {
            if model["visibility"].as_str().is_some_and(|v| v != "list") {
                continue;
            }
            if let Some(slug) = model["slug"].as_str() {
                entries.push(entry(slug, &model["context_window"]));
            }
        }
    } else if let Some(models) = json["data"].as_array() {
        for model in models {
            if let Some(id) = model["id"].as_str() {
                entries.push(entry(id, &serde_json::Value::Null));
            }
        }
    } else {
        return Err(CatalogError::Invalid("нет списка моделей".into()));
    }
    Ok(entries)
}

fn entry(slug: &str, context: &serde_json::Value) -> CatalogEntry {
    CatalogEntry {
        external_id: slug.into(),
        context_tokens: context
            .as_i64()
            .and_then(|c| i32::try_from(c).ok())
            .unwrap_or(0),
        price_in_per_mtok: 0,
        price_out_per_mtok: 0,
    }
}

/// Отказ до начала потока (по «Errors and recovery» OpenAI).
fn admission_error(status: u16, body: &str) -> ProviderError {
    let json: serde_json::Value = serde_json::from_str(body).unwrap_or_default();
    let code = json["error"]["code"]
        .as_str()
        .or_else(|| json["code"].as_str())
        .unwrap_or_default()
        .to_owned();
    let message = json["error"]["message"]
        .as_str()
        .or_else(|| json["detail"].as_str())
        .unwrap_or_default()
        .chars()
        .take(200)
        .collect::<String>();
    if !code.is_empty() {
        return failure(&code, &message);
    }
    match status {
        429 | 503 => ProviderError::NotSent(format!("HTTP {status}: {message}")),
        401 => ProviderError::Refused(
            "ChatGPT не принял вход — войдите снова: «Настройки → AI и бюджет»".into(),
        ),
        400 | 403 | 404 => ProviderError::Refused(format!("HTTP {status}: {message}")),
        _ => ProviderError::Unknown(format!("HTTP {status}: {message}")),
    }
}

/// Код ошибки Responses → что делает шлюз.
fn failure(code: &str, message: &str) -> ProviderError {
    match code {
        "subscription_sharing_usage_limit_exceeded" => {
            ProviderError::UsageLimit(usage_limit_message())
        }
        // «Временно недоступно» — не стоило подписке ничего, можно повторить.
        "subscription_sharing_usage_unavailable" | "subscription_sharing_user_unavailable" => {
            ProviderError::NotSent(format!("ChatGPT временно недоступен ({code})"))
        }
        "subscription_sharing_user_not_eligible" => ProviderError::Refused(
            "подписка не подходит для использования в приложениях (нужен Plus или Pro)".into(),
        ),
        "subscription_sharing_invalid_user" => ProviderError::Refused(
            "ChatGPT не принял вход — войдите снова: «Настройки → AI и бюджет»".into(),
        ),
        _ => ProviderError::Refused(if message.is_empty() {
            code.to_owned()
        } else {
            format!("{code}: {message}")
        }),
    }
}

/// Разбор потока событий (SSE). Успех — только `response.completed`.
pub(crate) fn parse_stream(body: &str) -> Result<ProviderReply, ProviderError> {
    let mut text = String::new();
    let mut usage = (None, None);
    let mut done = false;
    let mut final_text = None;
    for event in body.split("\n\n") {
        let data: String = event
            .lines()
            .filter_map(|line| line.strip_prefix("data:"))
            .map(str::trim_start)
            .collect::<Vec<_>>()
            .join("\n");
        if data.is_empty() || data == "[DONE]" {
            continue;
        }
        let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) else {
            continue;
        };
        match json["type"].as_str().unwrap_or_default() {
            "response.output_text.delta" => {
                text.push_str(json["delta"].as_str().unwrap_or_default());
            }
            kind @ ("response.completed" | "response.incomplete") => {
                let response = &json["response"];
                usage = (
                    response["usage"]["input_tokens"].as_u64(),
                    response["usage"]["output_tokens"].as_u64(),
                );
                final_text = output_text(response);
                done = kind == "response.completed" || usage.1.is_some();
            }
            "response.failed" => {
                let error = &json["response"]["error"];
                return Err(failure(
                    error["code"].as_str().unwrap_or("failed"),
                    error["message"].as_str().unwrap_or_default(),
                ));
            }
            "error" => {
                let error = if json["error"].is_object() {
                    &json["error"]
                } else {
                    &json
                };
                return Err(failure(
                    error["code"].as_str().unwrap_or("error"),
                    error["message"].as_str().unwrap_or_default(),
                ));
            }
            _ => {}
        }
    }
    if !done {
        return Err(ProviderError::Unknown(
            "поток оборвался без response.completed".into(),
        ));
    }
    if text.is_empty() {
        text = final_text.unwrap_or_default();
    }
    Ok(ProviderReply {
        text,
        tokens_in: usage.0.unwrap_or(0),
        tokens_out: usage.1.unwrap_or(0),
        cost_usd: Some(0),
    })
}

fn output_text(response: &serde_json::Value) -> Option<String> {
    let mut text = String::new();
    for item in response["output"].as_array()? {
        for part in item["content"].as_array().into_iter().flatten() {
            if part["type"] == "output_text" {
                text.push_str(part["text"].as_str().unwrap_or_default());
            }
        }
    }
    (!text.is_empty()).then_some(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc7636_example() {
        assert_eq!(
            pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    fn sse(events: &[serde_json::Value]) -> String {
        events
            .iter()
            .map(|e| format!("event: {}\ndata: {e}\n\n", e["type"].as_str().unwrap()))
            .collect()
    }

    #[test]
    fn text_pieces_come_from_delta_events_only() {
        let events = sse(&[
            serde_json::json!({"type": "response.created"}),
            serde_json::json!({"type": "response.output_text.delta", "delta": "Say "}),
            serde_json::json!({"type": "response.output_text.delta", "delta": "again."}),
        ]);
        assert_eq!(text_deltas(&events), ["Say ", "again."]);
    }

    #[test]
    fn stream_succeeds_only_on_completed() {
        let ok = sse(&[
            serde_json::json!({"type": "response.created"}),
            serde_json::json!({"type": "response.output_text.delta", "delta": "При"}),
            serde_json::json!({"type": "response.output_text.delta", "delta": "вет"}),
            serde_json::json!({"type": "response.completed", "response": {"usage": {"input_tokens": 12, "output_tokens": 3}}}),
        ]);
        let reply = parse_stream(&ok).unwrap();
        assert_eq!(
            (reply.text.as_str(), reply.tokens_in, reply.tokens_out),
            ("Привет", 12, 3)
        );
        assert_eq!(reply.cost_usd, Some(0));

        let cut = sse(&[serde_json::json!({"type": "response.output_text.delta", "delta": "При"})]);
        assert!(matches!(parse_stream(&cut), Err(ProviderError::Unknown(_))));
    }

    #[test]
    fn failures_map_to_clear_errors() {
        let limit = sse(&[
            serde_json::json!({"type": "response.failed", "response": {"error": {"code": "subscription_sharing_usage_limit_exceeded"}}}),
        ]);
        assert!(
            matches!(parse_stream(&limit), Err(ProviderError::UsageLimit(m)) if m.contains("лимит подписки"))
        );
        let busy = sse(&[
            serde_json::json!({"type": "response.failed", "response": {"error": {"code": "subscription_sharing_usage_unavailable"}}}),
        ]);
        assert!(matches!(
            parse_stream(&busy),
            Err(ProviderError::NotSent(_))
        ));
        assert!(matches!(
            admission_error(403, r#"{"error":{"code":"subscription_sharing_user_not_eligible"}}"#),
            ProviderError::Refused(m) if m.contains("Plus или Pro")
        ));
        assert!(matches!(
            admission_error(503, r#"{"detail":"down"}"#),
            ProviderError::NotSent(_)
        ));
        assert!(matches!(
            admission_error(500, "x"),
            ProviderError::Unknown(_)
        ));
    }

    #[test]
    fn id_token_is_checked() {
        let token = |claims: serde_json::Value| {
            format!("e30.{}.sig", URL_SAFE_NO_PAD.encode(claims.to_string()))
        };
        let exp = time::OffsetDateTime::now_utc().unix_timestamp() + 3600;
        let good = token(
            serde_json::json!({"iss": AUTH_BASE, "aud": ["oaiapp_1"], "exp": exp, "nonce": "n", "sub": "u1", "email": "k@x.ru"}),
        );
        assert_eq!(
            check_id_token(&good, AUTH_BASE, "oaiapp_1", "n")
                .unwrap()
                .sub,
            "u1"
        );
        assert!(
            check_id_token(&good, AUTH_BASE, "oaiapp_2", "n").is_err(),
            "чужой aud"
        );
        assert!(
            check_id_token(&good, AUTH_BASE, "oaiapp_1", "m").is_err(),
            "чужой nonce"
        );
        assert!(check_id_token(&good, "https://evil", "oaiapp_1", "n").is_err());
        let old = token(
            serde_json::json!({"iss": AUTH_BASE, "aud": "oaiapp_1", "exp": 1, "nonce": "n", "sub": "u1"}),
        );
        assert!(check_id_token(&old, AUTH_BASE, "oaiapp_1", "n").is_err());
    }
}
