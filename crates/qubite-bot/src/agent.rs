//! Разговор с агентом в Telegram (AGT-001, D-326). Агенту идут:
//! - `/agent текст` (или `/a текст`);
//! - ответ (reply) на сообщение агента.
//!
//! Остальное, как и раньше, — мысли во Входящие. Ответ готовит `qubite serve`
//! (там AI-шлюз) и присылает в этот же чат.

use qubite_agent::chat::{self, Channel, NewMessage};
use sqlx::PgPool;

use crate::{
    Outcome, Result,
    capture::account_of,
    telegram::{TelegramApi, Update},
};

pub const HELP: &str = "Напиши «/agent» и вопрос (например: «/agent русский у меня по вт и чт») \
или ответь на моё сообщение — я отвечу здесь же. Остальное, как и раньше, попадает во Входящие.";

/// Текст для агента: после `/agent` или `/a`; `None` — это не команда агента.
fn command_text(text: &str) -> Option<&str> {
    let text = text.trim_start();
    for command in ["/agent", "/a"] {
        if let Some(rest) = text.strip_prefix(command) {
            // «/agent@QubiteBot текст» — команда с именем бота.
            if let Some(named) = rest.strip_prefix('@') {
                return Some(
                    named
                        .split_once(char::is_whitespace)
                        .map_or("", |(_, r)| r.trim()),
                );
            }
            if rest.is_empty() || rest.starts_with(char::is_whitespace) {
                return Some(rest.trim());
            }
        }
    }
    None
}

/// Обработать, если это сообщение агенту; `None` — не ему.
pub async fn handle(pool: &PgPool, api: &TelegramApi, update: &Update) -> Result<Option<Outcome>> {
    let Some(message) = &update.message else {
        return Ok(None);
    };
    let Some(from) = &message.from else {
        return Ok(None);
    };
    if message.chat.kind != "private" || from.is_bot {
        return Ok(None);
    }
    let chat_id = message.chat.id;
    let text = message.text.clone().unwrap_or_default();
    let to_agent = match command_text(&text) {
        Some(rest) => Some(rest.to_owned()),
        None => match &message.reply_to_message {
            Some(original)
                if chat::is_agent_telegram(pool, chat_id, original.message_id)
                    .await
                    .unwrap_or(false) =>
            {
                Some(text.trim().to_owned())
            }
            _ => None,
        },
    };
    let Some(text) = to_agent else {
        return Ok(None);
    };
    let Some(account) = account_of(pool, from.id).await? else {
        api.send(chat_id, crate::capture::UNKNOWN_SENDER).await?;
        return Ok(Some(Outcome::Rejected));
    };
    if text.is_empty() {
        api.send(chat_id, HELP).await?;
        return Ok(Some(Outcome::Ignored));
    }
    // Telegram мог прислать то же сообщение повторно — второй раз не пишем.
    let seen: bool = sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM agent_messages WHERE telegram_chat = $1 \
         AND telegram_message = $2 AND role = 'owner')",
    )
    .bind(chat_id)
    .bind(message.message_id)
    .fetch_one(pool)
    .await?;
    if seen {
        return Ok(Some(Outcome::Ignored));
    }
    match chat::post(
        pool,
        NewMessage {
            account,
            channel: Channel::Telegram,
            text,
            file_id: None,
            telegram: Some((chat_id, message.message_id)),
        },
    )
    .await
    {
        Ok(posted) => Ok(Some(Outcome::Agent(posted.id))),
        Err(qubite_agent::Error::Denied(_)) => {
            api.send(
                chat_id,
                "Агент выключен: нет доступа к «Агент Qubite». Его включает владелец Qubite.",
            )
            .await?;
            Ok(Some(Outcome::Rejected))
        }
        Err(qubite_agent::Error::Invalid(reason)) => {
            api.send(chat_id, &format!("Не получилось: {reason}."))
                .await?;
            Ok(Some(Outcome::Rejected))
        }
        Err(error) => Err(crate::Error::Invalid(error.to_string())),
    }
}

#[cfg(test)]
mod tests {
    use super::command_text;

    #[test]
    fn agent_commands() {
        assert_eq!(command_text("/agent привет"), Some("привет"));
        assert_eq!(command_text("/a  привет "), Some("привет"));
        assert_eq!(command_text("/agent@QubiteBot привет"), Some("привет"));
        assert_eq!(command_text("/agent"), Some(""));
        assert_eq!(command_text("/apple"), None);
        assert_eq!(command_text("купить молоко"), None);
    }
}
