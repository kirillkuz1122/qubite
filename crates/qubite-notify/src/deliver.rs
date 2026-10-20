//! Доставка наружу: push в браузере или Telegram — один канал на сообщение.

use std::sync::Arc;

use serde_json::json;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    Button, Error, Notice, Result, Telegram, notice,
    settings::{self, Channel},
    webpush::{self, PushError, WebPush},
};

/// Чем доставлять. Нет ключей VAPID или токена бота — канала нет.
#[derive(Clone, Default)]
pub struct Channels {
    pub push: Option<Arc<WebPush>>,
    pub telegram: Option<Arc<dyn Telegram>>,
    /// Адрес Qubite для ссылки «открыть» (`https://qubiteapp.ru`).
    pub public_url: String,
}

impl std::fmt::Debug for Channels {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Channels")
            .field("push", &self.push.is_some())
            .field("telegram", &self.telegram.is_some())
            .finish()
    }
}

/// Что вышло с доставкой.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Ушло в этот канал.
    Sent(Channel),
    /// Только колокольчик: человек в Qubite, тишина, прочитано или каналов нет.
    BellOnly,
}

// ---------------------------------------------------------------- подписки push

/// Подписка браузера на push.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Subscription {
    pub id: Uuid,
    pub endpoint: String,
    pub label: String,
    pub created_at: OffsetDateTime,
}

/// Сохранить подписку этого браузера (тот же адрес — обновить ключи и хозяина).
pub async fn subscribe(
    conn: &mut PgConnection,
    push: &WebPush,
    account: Uuid,
    endpoint: &str,
    p256dh: &str,
    auth: &str,
    label: &str,
) -> Result<Uuid> {
    if !push.endpoint_allowed(endpoint) {
        return Err(Error::Invalid(
            "адрес подписки — не служба push браузера".into(),
        ));
    }
    // Ключи проверяем шифрованием пробного сообщения: неверные не сохраняем.
    webpush::encrypt(
        &ring::rand::SystemRandom::new(),
        &webpush::Target {
            endpoint,
            p256dh,
            auth,
        },
        b"{}",
    )
    .map_err(|error| Error::Invalid(error.to_string()))?;
    let label: String = label.trim().chars().take(200).collect();
    Ok(sqlx::query_scalar(
        "INSERT INTO push_subscriptions (id, account_id, endpoint, p256dh, auth, label) \
         VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (endpoint) DO UPDATE SET account_id = $2, p256dh = $4, auth = $5, \
             label = $6, failures = 0 \
         RETURNING id",
    )
    .bind(Uuid::now_v7())
    .bind(account)
    .bind(endpoint)
    .bind(p256dh)
    .bind(auth)
    .bind(label)
    .fetch_one(conn)
    .await?)
}

/// Отписать браузер. Возвращает, была ли такая подписка у человека.
pub async fn unsubscribe(conn: &mut PgConnection, account: Uuid, endpoint: &str) -> Result<bool> {
    Ok(
        sqlx::query("DELETE FROM push_subscriptions WHERE account_id = $1 AND endpoint = $2")
            .bind(account)
            .bind(endpoint)
            .execute(conn)
            .await?
            .rows_affected()
            > 0,
    )
}

pub async fn subscriptions(conn: &mut PgConnection, account: Uuid) -> Result<Vec<Subscription>> {
    let rows: Vec<(Uuid, String, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT id, endpoint, label, created_at FROM push_subscriptions \
         WHERE account_id = $1 ORDER BY created_at",
    )
    .bind(account)
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, endpoint, label, created_at)| Subscription {
            id,
            endpoint,
            label,
            created_at,
        })
        .collect())
}

/// Личный чат Telegram человека (привязан в профиле, D-198).
pub async fn telegram_chat(conn: &mut PgConnection, account: Uuid) -> Result<Option<i64>> {
    let subject: Option<String> = sqlx::query_scalar(
        "SELECT subject FROM oauth_identities WHERE account_id = $1 AND provider = 'telegram'",
    )
    .bind(account)
    .fetch_optional(conn)
    .await?;
    Ok(subject.and_then(|id| id.parse().ok()))
}

/// Человек по своему Telegram (для кнопок в чате).
pub async fn account_by_telegram(
    conn: &mut PgConnection,
    telegram_user: i64,
) -> Result<Option<Uuid>> {
    Ok(sqlx::query_scalar(
        "SELECT account_id FROM oauth_identities WHERE provider = 'telegram' AND subject = $1",
    )
    .bind(telegram_user.to_string())
    .fetch_optional(conn)
    .await?)
}

// ---------------------------------------------------------------- тексты

/// Текст в Telegram: заголовок, подробности, почему сейчас.
pub fn telegram_text(notice: &Notice) -> String {
    let mut text = format!("🔔 {}", notice.title);
    if !notice.body.is_empty() {
        text.push('\n');
        text.push_str(&notice.body);
    }
    if !notice.why.is_empty() {
        text.push_str("\n— ");
        text.push_str(&notice.why);
    }
    text
}

/// Кнопки под сообщением в Telegram: свои ответы сообщения («Да», «Позже»…)
/// или обычные «Понял» и «Через 15 мин».
pub fn telegram_buttons(notice: &Notice) -> Vec<Button> {
    if !notice.options.is_empty() {
        return notice
            .options
            .iter()
            .map(|choice| Button {
                text: choice.text.clone(),
                data: format!("n:o:{}:{}", notice.id, choice.id),
            })
            .collect();
    }
    vec![
        Button {
            text: "✓ Понял".into(),
            data: format!("n:r:{}", notice.id),
        },
        Button {
            text: format!("⏰ Через {} мин", notice::SNOOZE_MINUTES),
            data: format!("n:s:{}", notice.id),
        },
    ]
}

/// Сообщение для service worker: он покажет системное уведомление.
pub fn push_payload(notice: &Notice) -> Vec<u8> {
    let short = |text: &str, max: usize| -> String { text.chars().take(max).collect() };
    let body = match (notice.body.is_empty(), notice.why.is_empty()) {
        (false, false) => format!("{} · {}", notice.body, notice.why),
        (false, true) => notice.body.clone(),
        (true, false) => notice.why.clone(),
        (true, true) => String::new(),
    };
    json!({
        "id": notice.id,
        "title": short(&notice.title, 200),
        "body": short(&body, 400),
        "url": format!("/today?notice={}", notice.id),
    })
    .to_string()
    .into_bytes()
}

// ---------------------------------------------------------------- доставка

async fn record(
    pool: &PgPool,
    id: Uuid,
    channel: Channel,
    target: &str,
    external: Option<String>,
    error: Option<String>,
) -> Result<()> {
    sqlx::query(
        "INSERT INTO notification_deliveries (notification_id, channel, target, external_id, \
             status, error) VALUES ($1, $2, $3, $4, $5, $6) \
         ON CONFLICT (notification_id, channel, target) DO UPDATE SET external_id = $4, \
             status = $5, error = $6, created_at = now()",
    )
    .bind(id)
    .bind(channel.as_str())
    .bind(target)
    .bind(external)
    .bind(if error.is_none() { "sent" } else { "failed" })
    .bind(error.map(|text| text.chars().take(500).collect::<String>()))
    .execute(pool)
    .await?;
    Ok(())
}

/// Push во все браузеры человека. `Ok(true)` — хотя бы один принял.
async fn by_push(pool: &PgPool, push: &WebPush, notice: &Notice) -> Result<bool> {
    let subs: Vec<(Uuid, String, String, String)> = sqlx::query_as(
        "SELECT id, endpoint, p256dh, auth FROM push_subscriptions WHERE account_id = $1",
    )
    .bind(notice.account_id)
    .fetch_all(pool)
    .await?;
    let payload = push_payload(notice);
    let mut any = false;
    for (sub, endpoint, p256dh, auth) in subs {
        let target = webpush::Target {
            endpoint: &endpoint,
            p256dh: &p256dh,
            auth: &auth,
        };
        match push.send(&target, &payload).await {
            Ok(()) => {
                any = true;
                sqlx::query(
                    "UPDATE push_subscriptions SET last_ok_at = now(), failures = 0 WHERE id = $1",
                )
                .bind(sub)
                .execute(pool)
                .await?;
                record(pool, notice.id, Channel::Push, &sub.to_string(), None, None).await?;
            }
            Err(PushError::Gone) => {
                // Браузер отписался или подписка устарела — больше не слать.
                sqlx::query("DELETE FROM push_subscriptions WHERE id = $1")
                    .bind(sub)
                    .execute(pool)
                    .await?;
            }
            Err(error) => {
                tracing::warn!(%error, "push не доставлен");
                sqlx::query("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = $1")
                    .bind(sub)
                    .execute(pool)
                    .await?;
                record(
                    pool,
                    notice.id,
                    Channel::Push,
                    &sub.to_string(),
                    None,
                    Some(error.to_string()),
                )
                .await?;
            }
        }
    }
    Ok(any)
}

async fn by_telegram(
    pool: &PgPool,
    telegram: &dyn Telegram,
    chat: i64,
    notice: &Notice,
) -> Result<bool> {
    let text = telegram_text(notice);
    match telegram.send(chat, &text, &telegram_buttons(notice)).await {
        Ok(message) => {
            record(
                pool,
                notice.id,
                Channel::Telegram,
                &chat.to_string(),
                Some(message.to_string()),
                None,
            )
            .await?;
            Ok(true)
        }
        Err(error) => {
            tracing::warn!(%error, "Telegram: напоминание не доставлено");
            record(
                pool,
                notice.id,
                Channel::Telegram,
                &chat.to_string(),
                None,
                Some(error),
            )
            .await?;
            Ok(false)
        }
    }
}

/// Доставить сообщение наружу (задача `notify.deliver`). Ошибка — задача
/// повторится позже (если ни один канал не принял, а каналы есть).
pub async fn deliver(pool: &PgPool, channels: &Channels, id: Uuid) -> Result<Outcome> {
    let mut conn = pool.acquire().await?;
    let Some(notice) = notice::get(&mut conn, id).await? else {
        return Ok(Outcome::BellOnly);
    };
    if notice.read_at.is_some() || notice.held {
        return Ok(Outcome::BellOnly);
    }
    if let Some(channel) = notice.channel.as_deref() {
        return Ok(Outcome::Sent(Channel::parse(channel)?));
    }
    let prefs = settings::load(&mut conn, notice.account_id).await?;
    // Сидит в Qubite: колокольчик покажет сам, наружу не дублируем. Пробное
    // сообщение из профиля — всегда наружу: его шлют, чтобы проверить канал.
    if prefs.present(OffsetDateTime::now_utc()) && notice.kind != crate::Kind::System {
        return Ok(Outcome::BellOnly);
    }
    let chat = telegram_chat(&mut conn, notice.account_id).await?;
    drop(conn);
    let mut tried = false;
    for channel in [prefs.first_channel, prefs.first_channel.other()] {
        let sent = match channel {
            Channel::Push => match &channels.push {
                Some(push) if prefs.push_enabled => {
                    tried = true;
                    by_push(pool, push, &notice).await?
                }
                _ => false,
            },
            Channel::Telegram => match (&channels.telegram, chat) {
                (Some(telegram), Some(chat)) if prefs.telegram_enabled => {
                    tried = true;
                    by_telegram(pool, telegram.as_ref(), chat, &notice).await?
                }
                _ => false,
            },
        };
        if sent {
            sqlx::query("UPDATE notifications SET channel = $2 WHERE id = $1")
                .bind(id)
                .bind(channel.as_str())
                .execute(pool)
                .await?;
            return Ok(Outcome::Sent(channel));
        }
    }
    if tried {
        Err(Error::Invalid("ни один канал не принял сообщение".into()))
    } else {
        Ok(Outcome::BellOnly)
    }
}

/// Погасить прочитанное в Telegram (задача `notify.close`).
pub async fn close(pool: &PgPool, channels: &Channels, id: Uuid) -> Result<usize> {
    let Some(telegram) = &channels.telegram else {
        return Ok(0);
    };
    let mut conn = pool.acquire().await?;
    let Some(notice) = notice::get(&mut conn, id).await? else {
        return Ok(0);
    };
    drop(conn);
    let sent: Vec<(String, Option<String>)> = sqlx::query_as(
        "SELECT target, external_id FROM notification_deliveries \
         WHERE notification_id = $1 AND channel = 'telegram' AND status = 'sent'",
    )
    .bind(id)
    .fetch_all(pool)
    .await?;
    let done = notice
        .answer
        .as_deref()
        .and_then(|answer| notice.options.iter().find(|choice| choice.id == answer))
        .map_or_else(
            || "✓ Прочитано".to_owned(),
            |choice| format!("✓ {}", choice.text),
        );
    let text = format!("{}\n\n{done}", telegram_text(&notice));
    let mut closed = 0;
    for (chat, message) in sent {
        let (Ok(chat), Some(Ok(message))) =
            (chat.parse::<i64>(), message.map(|id| id.parse::<i64>()))
        else {
            continue;
        };
        telegram
            .edit(chat, message, &text)
            .await
            .map_err(Error::Invalid)?;
        sqlx::query(
            "UPDATE notification_deliveries SET status = 'closed' \
             WHERE notification_id = $1 AND channel = 'telegram' AND target = $2",
        )
        .bind(id)
        .bind(chat.to_string())
        .execute(pool)
        .await?;
        closed += 1;
    }
    Ok(closed)
}
