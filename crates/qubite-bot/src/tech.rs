//! Техработы из Telegram (ACC-005, D-217): только owner.
//!
//! - `/tech` — что сейчас;
//! - `/tech on`, `/tech on до 10:00 Переезжаем на новый сервер` — включить
//!   (время и текст необязательны);
//! - `/tech off` — выключить.
//!
//! Бот отвечает, что сделал, и присылает owner ссылку на вход и одноразовую
//! ссылку-пропуск на 10 минут.

use qubite_auth::maintenance::{self, Switch};
use sqlx::PgPool;

use crate::{Outcome, Result, TelegramApi, capture, telegram::Update};

/// Что owner написал после `/tech`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Command {
    Status,
    On {
        until: Option<String>,
        message: Option<String>,
    },
    Off,
}

/// Разобрать `/tech …`; `None` — это не команда техработ.
pub fn parse(text: &str) -> Option<Result<Command, String>> {
    let text = text.trim();
    let rest = text.strip_prefix("/tech")?;
    // `/technics` — не наша команда.
    if !(rest.is_empty() || rest.starts_with(char::is_whitespace) || rest.starts_with('@')) {
        return None;
    }
    let rest = rest
        .trim_start_matches(|c: char| c != ' ' && c != '\n' && c != '\t')
        .trim();
    let (action, tail) = rest
        .split_once(char::is_whitespace)
        .map_or((rest, ""), |(action, tail)| (action, tail.trim()));
    Some(match action.to_lowercase().as_str() {
        "" | "status" => Ok(Command::Status),
        "off" | "выкл" => Ok(Command::Off),
        "on" | "вкл" => {
            let mut words = tail.split_whitespace().peekable();
            if words.peek().is_some_and(|w| *w == "до") {
                words.next();
            }
            let until = words
                .peek()
                .filter(|w| w.contains(':') && w.chars().all(|c| c.is_ascii_digit() || c == ':'))
                .map(|w| (*w).to_owned());
            if until.is_some() {
                words.next();
            }
            let message = words.collect::<Vec<_>>().join(" ");
            Ok(Command::On {
                until,
                message: (!message.is_empty()).then_some(message),
            })
        }
        other => Err(format!(
            "Не знаю «{other}». Можно: /tech on, /tech on до 10:00 текст, /tech off."
        )),
    })
}

/// Обработать `/tech`, если это он. `None` — не команда техработ (дальше —
/// обычный захват во Входящие).
pub async fn handle(
    pool: &PgPool,
    api: &TelegramApi,
    auth_url: &str,
    maintenance_env: bool,
    update: &Update,
) -> Result<Option<Outcome>> {
    let Some(message) = &update.message else {
        return Ok(None);
    };
    let Some(from) = &message.from else {
        return Ok(None);
    };
    if message.chat.kind != "private" || from.is_bot {
        return Ok(None);
    }
    let Some(command) = message.text.as_deref().and_then(parse) else {
        return Ok(None);
    };
    let chat = message.chat.id;
    // Незнакомцу ответит обычный захват («не знаю вас»).
    let Some(account) = capture::account_of(pool, from.id).await? else {
        return Ok(None);
    };
    let is_owner = {
        let mut conn = pool.acquire().await?;
        qubite_auth::owner::is_owner(&mut conn, account).await?
    };
    if !is_owner {
        api.send(chat, "Техработами управляет только владелец Qubite.")
            .await?;
        return Ok(Some(Outcome::Rejected));
    }
    let command = match command {
        Ok(command) => command,
        Err(hint) => {
            api.send(chat, &hint).await?;
            return Ok(Some(Outcome::Rejected));
        }
    };
    let settings = match &command {
        Command::Status => qubite_auth::platform::current(pool).await?,
        Command::Off => maintenance::switch(pool, Some(account), Switch::default()).await?,
        Command::On { until, message } => {
            match maintenance::switch(
                pool,
                Some(account),
                Switch {
                    on: true,
                    until: until.as_deref(),
                    message: message.as_deref(),
                },
            )
            .await
            {
                Ok(settings) => settings,
                Err(qubite_auth::Error::Invalid(text)) => {
                    api.send(chat, &format!("Не включил: {text}.")).await?;
                    return Ok(Some(Outcome::Rejected));
                }
                Err(error) => return Err(error.into()),
            }
        }
    };

    let mut reply = if settings.maintenance {
        let until = match &settings.maintenance_until {
            Some(at) => format!(
                " до {}",
                maintenance::local_time(pool, at, &settings.timezone).await?
            ),
            None => String::new(),
        };
        format!(
            "Техработы включены{until}. Все, кроме тебя, видят экран:\n«{}»",
            settings.maintenance_message
        )
    } else {
        "Техработы выключены — Qubite открыт для всех.".to_owned()
    };
    if maintenance_env {
        reply.push_str(
            "\n\nНа сервере стоит QUBITE_MAINTENANCE=true — техработы идут, пока его не уберут.",
        );
    }
    if settings.maintenance || maintenance_env {
        let (token, _) = maintenance::issue_pass(pool, account).await?;
        reply.push_str(&format!(
            "\n\nТы проходишь как обычно. Вход: {}/auth\nПропуск на 10 минут (одноразовый): {}",
            auth_url.trim_end_matches('/'),
            maintenance::pass_link(auth_url, &token)
        ));
    }
    api.send(chat, &reply).await?;
    Ok(Some(Outcome::Command))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands() {
        assert_eq!(parse("/tech"), Some(Ok(Command::Status)));
        assert_eq!(parse("/tech@qubite_bot off"), Some(Ok(Command::Off)));
        assert_eq!(
            parse("/tech on"),
            Some(Ok(Command::On {
                until: None,
                message: None
            }))
        );
        assert_eq!(
            parse("/tech on до 10:00 Переезжаем на новый сервер"),
            Some(Ok(Command::On {
                until: Some("10:00".into()),
                message: Some("Переезжаем на новый сервер".into())
            }))
        );
        assert_eq!(
            parse("/tech on Скоро будем"),
            Some(Ok(Command::On {
                until: None,
                message: Some("Скоро будем".into())
            }))
        );
        assert!(matches!(parse("/tech fly"), Some(Err(_))));
        assert_eq!(parse("/technics"), None);
        assert_eq!(parse("просто мысль"), None);
    }
}
