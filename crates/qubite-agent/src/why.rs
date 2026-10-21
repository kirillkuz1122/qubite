//! «Почему откатил?» (AGT-007, D-397): откат — обратная связь агенту.
//!
//! Ты откатил действие агента — он спрашивает (по желанию) почему: «ошибся»,
//! «не сейчас», «не надо такого» или свой текст. «Ошибся», «не надо такого»
//! и свой текст — урок: задача `agent.learn` (как у «Исправить», D-363),
//! агент уточняет навык или записывает в «О тебе». «Не сейчас» — не урок.
//! Не ответил — тоже не урок. Ответить можно кнопкой в ленте или словами в
//! разговоре (и в Telegram): неотвеченные агент видит и записывает ответ
//! инструментом [`TOOL`].

use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{Actor, Error, Result, Who, files, memory::quote, timeline};

/// Инструмент агента: записать ответ, который владелец дал словами.
pub const TOOL: &str = "revert.why";
/// Сколько дней агент помнит неотвеченный вопрос в разговоре.
pub const OPEN_DAYS: i32 = 3;
/// Свой ответ — до стольких знаков.
pub const MAX_ANSWER: usize = 500;

/// Что ответил владелец.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// «Ошибся» — агент сделал не так.
    Mistake,
    /// «Не сейчас» — дело правильное, но не время. Не урок.
    NotNow,
    /// «Не надо такого» — такого не делать вовсе.
    Never,
    /// Свой текст.
    Own,
}

impl Kind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mistake => "mistake",
            Self::NotNow => "not_now",
            Self::Never => "never",
            Self::Own => "own",
        }
    }

    /// Как кнопка подписана.
    pub fn label(self) -> &'static str {
        match self {
            Self::Mistake => "ошибся",
            Self::NotNow => "не сейчас",
            Self::Never => "не надо такого",
            Self::Own => "свой ответ",
        }
    }

    /// Учится ли агент на этом ответе.
    pub fn lesson(self) -> bool {
        self != Self::NotNow
    }

    fn parse(value: &str) -> Option<Self> {
        match value {
            "mistake" => Some(Self::Mistake),
            "not_now" => Some(Self::NotNow),
            "never" => Some(Self::Never),
            "own" => Some(Self::Own),
            _ => None,
        }
    }
}

/// Вопрос «почему откатил» у пакета отката.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Why {
    /// `None` — ещё не ответил.
    pub kind: Option<Kind>,
    /// Свой текст (у кнопок — пусто).
    pub answer: String,
}

/// Разобрать ответ: кнопка (или те же слова) — её вид, иначе — свой текст.
pub fn parse(answer: &str) -> Result<(Kind, String)> {
    let text = files::redact(answer.trim()).0;
    let plain: String = text
        .to_lowercase()
        .replace('ё', "е")
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace() || *c == '_')
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let kind = match plain.as_str() {
        "" => return Err(Error::Invalid("пустой ответ".into())),
        "mistake" | "ошибся" | "ошибка" | "ты ошибся" => Kind::Mistake,
        "not_now" | "не сейчас" | "не сегодня" => Kind::NotNow,
        "never" | "не надо такого" | "не надо" | "такого не надо" => {
            Kind::Never
        }
        _ => {
            if text.chars().count() > MAX_ANSWER {
                return Err(Error::Invalid(format!("ответ — до {MAX_ANSWER} знаков")));
            }
            return Ok((Kind::Own, text));
        }
    };
    Ok((kind, String::new()))
}

/// Спросить «почему» после отката (в транзакции отката): только когда ты
/// откатил хотя бы одно действие агента.
pub(crate) async fn ask(
    conn: &mut PgConnection,
    who: &Who,
    batch: Uuid,
    reverted: &[timeline::Action],
) -> Result<()> {
    if who.actor() != Actor::Owner || !reverted.iter().any(|a| a.actor == Actor::Agent) {
        return Ok(());
    }
    sqlx::query(
        "INSERT INTO agent_revert_why (batch_id, account_id) VALUES ($1, $2) \
         ON CONFLICT (batch_id) DO NOTHING",
    )
    .bind(batch)
    .bind(who.account())
    .execute(conn)
    .await?;
    Ok(())
}

/// Вопросы у пакетов (для ленты).
pub(crate) async fn load(conn: &mut PgConnection, batches: &[Uuid]) -> Result<HashMap<Uuid, Why>> {
    let rows: Vec<(Uuid, Option<String>, String)> = sqlx::query_as(
        "SELECT batch_id, kind, answer FROM agent_revert_why WHERE batch_id = ANY($1)",
    )
    .bind(batches)
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(batch, kind, answer)| {
            (
                batch,
                Why {
                    kind: kind.as_deref().and_then(Kind::parse),
                    answer,
                },
            )
        })
        .collect())
}

/// Ответ на пакет отката `batch`: кнопкой (владелец) или словами из
/// разговора (агент, [`TOOL`]). Урок — задача `agent.learn` той же
/// транзакцией. Отвечают один раз.
pub async fn answer(pool: &PgPool, who: &Who, batch: Uuid, answer: &str) -> Result<Why> {
    if who.actor() == Actor::System {
        return Err(Error::NeedsOwner("отвечает человек".into()));
    }
    let (kind, text) = parse(answer)?;
    let account = who.account();
    let mut tx = pool.begin().await?;
    timeline::lock(&mut tx, account).await?;
    timeline::check_agent(&mut tx, who).await?;
    let open: Option<Option<String>> = sqlx::query_scalar(
        "SELECT kind FROM agent_revert_why WHERE batch_id = $1 AND account_id = $2 FOR UPDATE",
    )
    .bind(batch)
    .bind(account)
    .fetch_optional(&mut *tx)
    .await?;
    match open {
        None => return Err(Error::NotFound),
        Some(Some(_)) => return Err(Error::Invalid("на это уже ответили".into())),
        Some(None) => {}
    }
    sqlx::query(
        "UPDATE agent_revert_why SET kind = $2, answer = $3, answered_at = now() \
         WHERE batch_id = $1",
    )
    .bind(batch)
    .bind(kind.as_str())
    .bind(&text)
    .execute(&mut *tx)
    .await?;
    if kind.lesson() {
        let first: Option<Uuid> = sqlx::query_scalar(
            "SELECT id FROM agent_actions WHERE account_id = $1 AND batch_id = $2 \
             AND reverts IS NOT NULL ORDER BY seq LIMIT 1",
        )
        .bind(account)
        .bind(batch)
        .fetch_optional(&mut *tx)
        .await?;
        if let Some(first) = first {
            crate::skills::schedule_learn(&mut tx, account, first).await?;
        }
    }
    tx.commit().await?;
    Ok(Why {
        kind: Some(kind),
        answer: text,
    })
}

/// Ответ пакета (для урока).
pub(crate) async fn of_batch(conn: &mut PgConnection, batch: Uuid) -> Result<Option<Why>> {
    Ok(load(conn, &[batch]).await?.remove(&batch))
}

/// Неотвеченные откаты за [`OPEN_DAYS`] дня — блок для разговора: владелец
/// может объяснить словами (и в Telegram), агент запишет [`TOOL`].
pub async fn open_block(conn: &mut PgConnection, account: Uuid) -> Result<Option<String>> {
    let rows: Vec<(Uuid, String)> = sqlx::query_as(
        "SELECT w.batch_id, a.summary FROM agent_revert_why w \
         JOIN agent_actions a ON a.batch_id = w.batch_id AND a.account_id = w.account_id \
         WHERE w.account_id = $1 AND w.kind IS NULL \
           AND w.asked_at > now() - make_interval(days => $2) \
         ORDER BY a.seq",
    )
    .bind(account)
    .bind(OPEN_DAYS)
    .fetch_all(conn)
    .await?;
    if rows.is_empty() {
        return Ok(None);
    }
    let mut batches: Vec<(Uuid, Vec<String>)> = Vec::new();
    for (batch, summary) in rows {
        let summary = quote(&summary, 160);
        match batches.iter_mut().find(|(b, _)| *b == batch) {
            Some((_, lines)) => lines.push(summary),
            None => batches.push((batch, vec![summary])),
        }
    }
    Ok(Some(
        batches
            .into_iter()
            .map(|(batch, lines)| format!("- batch_id {batch}: {}", lines.join("; ")))
            .collect::<Vec<_>>()
            .join("\n"),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buttons_and_own_words() {
        assert_eq!(parse("ошибся").unwrap(), (Kind::Mistake, String::new()));
        assert_eq!(
            parse(" Не сейчас! ").unwrap(),
            (Kind::NotNow, String::new())
        );
        assert_eq!(
            parse("не надо такого").unwrap(),
            (Kind::Never, String::new())
        );
        assert_eq!(parse("never").unwrap().0, Kind::Never);
        let (kind, text) = parse("ДЗ по физре я не делаю").unwrap();
        assert_eq!((kind, text.as_str()), (Kind::Own, "ДЗ по физре я не делаю"));
        assert!(parse("  ").is_err());
        assert!(parse(&"а".repeat(MAX_ANSWER + 1)).is_err());
        assert!(Kind::Mistake.lesson() && Kind::Never.lesson() && Kind::Own.lesson());
        assert!(!Kind::NotNow.lesson());
    }
}
