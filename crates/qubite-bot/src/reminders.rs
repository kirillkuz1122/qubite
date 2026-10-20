//! Кнопки под напоминаниями (PLAN-004): «✓ Понял» гасит сообщение и в
//! колокольчике, «⏰ Через 15 мин» — то же, и такое же придёт позже.
//! Нажать может только тот, кому сообщение адресовано.

use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    Outcome, Result,
    telegram::{CallbackQuery, TelegramApi},
};

/// Нажатие кнопки. Не наша кнопка — `Ignored`.
pub async fn handle(pool: &PgPool, api: &TelegramApi, query: &CallbackQuery) -> Result<Outcome> {
    // `n:r:<id>` — понял, `n:s:<id>` — через 15 минут, `n:o:<id>:<ответ>` —
    // кнопка ответа («Да», «Позже», «Не сегодня», AGT-004).
    let Some((action, id, choice)) = query
        .data
        .as_deref()
        .and_then(|data| data.strip_prefix("n:"))
        .and_then(|rest| rest.split_once(':'))
        .and_then(|(action, rest)| {
            let (id, choice) = match rest.split_once(':') {
                Some((id, choice)) => (id, Some(choice)),
                None => (rest, None),
            };
            Some((action, id.parse::<Uuid>().ok()?, choice))
        })
    else {
        return Ok(Outcome::Ignored);
    };
    let mut conn = pool.acquire().await?;
    let account = qubite_notify::deliver::account_by_telegram(&mut conn, query.from.id)
        .await
        .map_err(notify_error)?;
    if let (Some(account), "o", Some(choice)) = (account, action, choice) {
        drop(conn);
        let hint = match qubite_agent::proactive::answer(pool, account, id, choice).await {
            Ok(Some(outcome)) => outcome.hint,
            Ok(None) => "На это уже ответили".to_owned(),
            Err(qubite_agent::Error::NotFound) => "Сообщение не найдено".to_owned(),
            Err(error) => return Err(crate::Error::Invalid(error.to_string())),
        };
        if let Err(error) = api.answer_callback(&query.id, &hint).await {
            tracing::warn!(%error, "бот: ответ на кнопку не отправлен");
        }
        return Ok(Outcome::Command);
    }
    let answer = match account {
        None => "Этот Telegram не привязан к Qubite",
        Some(account) => {
            let done = match action {
                "r" => qubite_notify::notice::mark_read(&mut conn, account, id)
                    .await
                    .map(|_| "Отмечено прочитанным"),
                "s" => qubite_notify::notice::snooze(&mut conn, account, id)
                    .await
                    .map(|_| "Напомню через 15 минут"),
                _ => return Ok(Outcome::Ignored),
            };
            match done {
                Ok(text) => text,
                Err(qubite_notify::Error::NotFound) => "Сообщение не найдено",
                Err(error) => return Err(notify_error(error)),
            }
        }
    };
    drop(conn);
    // Сообщение погасит задача `notify.close` (её ставит mark_read); подсказка — сразу.
    if let Err(error) = api.answer_callback(&query.id, answer).await {
        tracing::warn!(%error, "бот: ответ на кнопку не отправлен");
    }
    Ok(if account.is_some() {
        Outcome::Command
    } else {
        Outcome::Rejected
    })
}

fn notify_error(error: qubite_notify::Error) -> crate::Error {
    match error {
        qubite_notify::Error::Db(error) => crate::Error::Db(error),
        other => crate::Error::Invalid(other.to_string()),
    }
}
