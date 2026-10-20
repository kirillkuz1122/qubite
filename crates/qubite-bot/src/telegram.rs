//! Маленький клиент Telegram Bot API: только то, что нужно боту Qubite.
//! Адрес API настраивается — в тестах это поддельный сервер.

use std::time::Duration;

use serde::{Deserialize, de::DeserializeOwned};
use serde_json::{Value, json};

use crate::{Error, Result};

#[derive(Clone)]
pub struct TelegramApi {
    base: String,
    token: String,
    http: reqwest::Client,
}

impl std::fmt::Debug for TelegramApi {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("TelegramApi")
            .field("base", &self.base)
            .field("token", &"***")
            .finish()
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Update {
    pub update_id: i64,
    pub message: Option<Message>,
    /// Нажата кнопка под сообщением бота (напоминания, PLAN-004).
    pub callback_query: Option<CallbackQuery>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct CallbackQuery {
    pub id: String,
    pub from: User,
    pub data: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Message {
    pub message_id: i64,
    /// Время отправки, секунды Unix.
    pub date: i64,
    pub chat: Chat,
    pub from: Option<User>,
    pub text: Option<String>,
    pub caption: Option<String>,
    pub document: Option<FileRef>,
    pub voice: Option<FileRef>,
    pub audio: Option<FileRef>,
    pub video: Option<FileRef>,
    /// Фото приходит в нескольких размерах — берём самый большой.
    #[serde(default)]
    pub photo: Vec<FileRef>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Chat {
    pub id: i64,
    /// `private`, `group`, `supergroup`, `channel`.
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct User {
    pub id: i64,
    #[serde(default)]
    pub is_bot: bool,
    #[serde(default)]
    pub first_name: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FileRef {
    pub file_id: String,
    pub file_name: Option<String>,
    pub mime_type: Option<String>,
    pub file_size: Option<i64>,
}

#[derive(Deserialize)]
struct Reply<T> {
    ok: bool,
    result: Option<T>,
    description: Option<String>,
}

#[derive(Deserialize)]
struct SentMessage {
    message_id: i64,
}

impl qubite_notify::Telegram for TelegramApi {
    fn send<'a>(
        &'a self,
        chat: i64,
        text: &'a str,
        buttons: &'a [qubite_notify::Button],
    ) -> qubite_notify::BoxFuture<'a, std::result::Result<i64, String>> {
        Box::pin(async move {
            self.send_with_buttons(chat, text, buttons)
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn edit<'a>(
        &'a self,
        chat: i64,
        message: i64,
        text: &'a str,
    ) -> qubite_notify::BoxFuture<'a, std::result::Result<(), String>> {
        Box::pin(async move {
            TelegramApi::edit(self, chat, message, text)
                .await
                .map_err(|error| error.to_string())
        })
    }
}

#[derive(Deserialize)]
struct FileInfo {
    file_path: Option<String>,
}

impl TelegramApi {
    pub fn new(base: impl Into<String>, token: impl Into<String>) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .user_agent(concat!("qubite/", env!("CARGO_PKG_VERSION")))
            .build()
            .expect("HTTP-клиент собирается с настройками по умолчанию");
        Self {
            base: base.into().trim_end_matches('/').to_owned(),
            token: token.into(),
            http,
        }
    }

    async fn call<T: DeserializeOwned>(&self, method: &str, body: Value) -> Result<T> {
        let reply: Reply<T> = self
            .http
            .post(format!("{}/bot{}/{method}", self.base, self.token))
            .json(&body)
            .send()
            .await
            .map_err(|error| Error::Telegram(error.without_url().to_string()))?
            .json()
            .await
            .map_err(|error| Error::Telegram(error.without_url().to_string()))?;
        match reply {
            Reply {
                ok: true,
                result: Some(result),
                ..
            } => Ok(result),
            Reply { description, .. } => Err(Error::Telegram(
                description.unwrap_or_else(|| format!("{method}: ошибка")),
            )),
        }
    }

    /// Новые сообщения (долгий опрос до `wait`).
    pub async fn updates(&self, offset: i64, wait: Duration) -> Result<Vec<Update>> {
        self.call(
            "getUpdates",
            json!({ "offset": offset, "timeout": wait.as_secs(),
                    "allowed_updates": ["message", "callback_query"] }),
        )
        .await
    }

    pub async fn send(&self, chat_id: i64, text: &str) -> Result<()> {
        let _: Value = self
            .call(
                "sendMessage",
                json!({ "chat_id": chat_id, "text": text, "disable_web_page_preview": true }),
            )
            .await?;
        Ok(())
    }

    /// Отправить с кнопками под сообщением; вернуть ID сообщения.
    pub async fn send_with_buttons(
        &self,
        chat_id: i64,
        text: &str,
        buttons: &[qubite_notify::Button],
    ) -> Result<i64> {
        let row: Vec<Value> = buttons
            .iter()
            .map(|button| json!({ "text": button.text, "callback_data": button.data }))
            .collect();
        let sent: SentMessage = self
            .call(
                "sendMessage",
                json!({ "chat_id": chat_id, "text": text, "disable_web_page_preview": true,
                        "reply_markup": { "inline_keyboard": [row] } }),
            )
            .await?;
        Ok(sent.message_id)
    }

    /// Заменить текст сообщения; кнопки пропадают.
    pub async fn edit(&self, chat_id: i64, message_id: i64, text: &str) -> Result<()> {
        let _: Value = self
            .call(
                "editMessageText",
                json!({ "chat_id": chat_id, "message_id": message_id, "text": text,
                        "disable_web_page_preview": true }),
            )
            .await?;
        Ok(())
    }

    /// Ответить на нажатие кнопки (короткая подсказка вверху чата).
    pub async fn answer_callback(&self, id: &str, text: &str) -> Result<()> {
        let _: Value = self
            .call(
                "answerCallbackQuery",
                json!({ "callback_query_id": id, "text": text }),
            )
            .await?;
        Ok(())
    }

    /// Скачать файл (Bot API отдаёт файлы до 20 МБ).
    pub async fn download(&self, file_id: &str) -> Result<Vec<u8>> {
        let info: FileInfo = self.call("getFile", json!({ "file_id": file_id })).await?;
        let path = info
            .file_path
            .ok_or_else(|| Error::Telegram("файл недоступен".into()))?;
        let response = self
            .http
            .get(format!("{}/file/bot{}/{path}", self.base, self.token))
            .send()
            .await
            .and_then(reqwest::Response::error_for_status)
            .map_err(|error| Error::Telegram(error.without_url().to_string()))?;
        Ok(response
            .bytes()
            .await
            .map_err(|error| Error::Telegram(error.without_url().to_string()))?
            .to_vec())
    }
}
