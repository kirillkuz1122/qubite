//! Каналы и тишина человека (профиль → «Напоминания»).

use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use time::{OffsetDateTime, Time};
use uuid::Uuid;

use crate::{Error, Result};

/// Сколько секунд после последней отметки вкладка считается открытой.
pub const PRESENCE_SECS: i64 = 90;

/// Канал наружу.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Channel {
    Push,
    Telegram,
}

impl Channel {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Push => "push",
            Self::Telegram => "telegram",
        }
    }

    pub fn other(self) -> Self {
        match self {
            Self::Push => Self::Telegram,
            Self::Telegram => Self::Push,
        }
    }

    pub fn parse(text: &str) -> Result<Self> {
        match text {
            "push" => Ok(Self::Push),
            "telegram" => Ok(Self::Telegram),
            other => Err(Error::Invalid(format!("неизвестный канал {other}"))),
        }
    }
}

/// Настройки человека. Нет строки в базе — значения по умолчанию (D-311).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Settings {
    pub push_enabled: bool,
    pub telegram_enabled: bool,
    /// Куда сначала, когда человека нет в Qubite.
    pub first_channel: Channel,
    pub quiet_from: Time,
    pub quiet_to: Time,
    pub before_minutes: u16,
    pub travel_minutes: u16,
    /// Вкладка Qubite была видна в этот момент.
    pub seen_at: Option<OffsetDateTime>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            push_enabled: true,
            telegram_enabled: true,
            first_channel: Channel::Push,
            quiet_from: Time::from_hms(23, 0, 0).expect("23:00"),
            quiet_to: Time::from_hms(8, 0, 0).expect("08:00"),
            before_minutes: 15,
            travel_minutes: 60,
            seen_at: None,
        }
    }
}

type Row = (
    bool,
    bool,
    String,
    Time,
    Time,
    i32,
    i32,
    Option<OffsetDateTime>,
);

impl Settings {
    /// Тишина в это время (по часам владельца)? Ночь переходит через полночь.
    pub fn quiet_at(&self, local: Time) -> bool {
        if self.quiet_from == self.quiet_to {
            return false;
        }
        if self.quiet_from < self.quiet_to {
            local >= self.quiet_from && local < self.quiet_to
        } else {
            local >= self.quiet_from || local < self.quiet_to
        }
    }

    /// Человек сейчас в Qubite (вкладка видна).
    pub fn present(&self, now: OffsetDateTime) -> bool {
        self.seen_at
            .is_some_and(|seen| (now - seen).whole_seconds() < PRESENCE_SECS)
    }
}

pub async fn load(conn: &mut PgConnection, account: Uuid) -> Result<Settings> {
    let row: Option<Row> = sqlx::query_as(
        "SELECT push_enabled, telegram_enabled, first_channel, quiet_from, quiet_to, \
         before_minutes, travel_minutes, seen_at FROM notify_settings WHERE account_id = $1",
    )
    .bind(account)
    .fetch_optional(conn)
    .await?;
    let Some((push, telegram, first, from, to, before, travel, seen)) = row else {
        return Ok(Settings::default());
    };
    Ok(Settings {
        push_enabled: push,
        telegram_enabled: telegram,
        first_channel: Channel::parse(&first)?,
        quiet_from: from,
        quiet_to: to,
        before_minutes: u16::try_from(before).unwrap_or(15),
        travel_minutes: u16::try_from(travel).unwrap_or(60),
        seen_at: seen,
    })
}

/// Изменение настроек: только то, что пришло.
#[derive(Debug, Default, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Change {
    pub push_enabled: Option<bool>,
    pub telegram_enabled: Option<bool>,
    pub first_channel: Option<Channel>,
    /// `ЧЧ:ММ`.
    pub quiet_from: Option<String>,
    pub quiet_to: Option<String>,
    pub before_minutes: Option<u16>,
    pub travel_minutes: Option<u16>,
}

pub async fn save(conn: &mut PgConnection, account: Uuid, change: &Change) -> Result<Settings> {
    let mut settings = load(conn, account).await?;
    let time = |text: &str| qubite_planner::parse_time(text).map_err(Error::Invalid);
    if let Some(on) = change.push_enabled {
        settings.push_enabled = on;
    }
    if let Some(on) = change.telegram_enabled {
        settings.telegram_enabled = on;
    }
    if let Some(first) = change.first_channel {
        settings.first_channel = first;
    }
    if let Some(from) = &change.quiet_from {
        settings.quiet_from = time(from)?;
    }
    if let Some(to) = &change.quiet_to {
        settings.quiet_to = time(to)?;
    }
    for minutes in [change.before_minutes, change.travel_minutes]
        .into_iter()
        .flatten()
    {
        if minutes > 1440 {
            return Err(Error::Invalid(
                "напомнить можно не раньше чем за сутки".into(),
            ));
        }
    }
    if let Some(minutes) = change.before_minutes {
        settings.before_minutes = minutes;
    }
    if let Some(minutes) = change.travel_minutes {
        settings.travel_minutes = minutes;
    }
    sqlx::query(
        "INSERT INTO notify_settings (account_id, push_enabled, telegram_enabled, first_channel, \
             quiet_from, quiet_to, before_minutes, travel_minutes) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
         ON CONFLICT (account_id) DO UPDATE SET push_enabled = $2, telegram_enabled = $3, \
             first_channel = $4, quiet_from = $5, quiet_to = $6, before_minutes = $7, \
             travel_minutes = $8, updated_at = now()",
    )
    .bind(account)
    .bind(settings.push_enabled)
    .bind(settings.telegram_enabled)
    .bind(settings.first_channel.as_str())
    .bind(settings.quiet_from)
    .bind(settings.quiet_to)
    .bind(i32::from(settings.before_minutes))
    .bind(i32::from(settings.travel_minutes))
    .execute(conn)
    .await?;
    Ok(settings)
}

/// Вкладка Qubite видна (`true`) или спрятана/закрыта (`false`).
pub async fn presence(conn: &mut PgConnection, account: Uuid, visible: bool) -> Result<()> {
    sqlx::query(
        "INSERT INTO notify_settings (account_id, seen_at) VALUES ($1, CASE WHEN $2 THEN now() END) \
         ON CONFLICT (account_id) DO UPDATE SET seen_at = CASE WHEN $2 THEN now() END",
    )
    .bind(account)
    .bind(visible)
    .execute(conn)
    .await?;
    Ok(())
}

/// Сейчас по часам владельца (пояс платформы).
pub async fn local_now(conn: &mut PgConnection) -> Result<Time> {
    Ok(sqlx::query_scalar(
        "SELECT (now() AT TIME ZONE coalesce( \
             (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), $1) \
         )::time",
    )
    .bind(qubite_planner::DEFAULT_TIMEZONE)
    .fetch_one(conn)
    .await?)
}

/// Занятой слот расписания («урок», «тренировка») сейчас — из «Расписание.md»
/// агента (AGT-001, D-322): строки с «Не беспокоить» = да. Нет — `None`.
pub async fn busy_slot(conn: &mut PgConnection, account: Uuid) -> Result<Option<String>> {
    Ok(sqlx::query_scalar(
        "WITH now_local AS ( \
             SELECT (now() AT TIME ZONE coalesce( \
                 (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), $2) \
             ) AS at) \
         SELECT s.title FROM agent_schedule_slots s \
         JOIN objects o ON o.id = s.file_id, now_local n \
         WHERE s.account_id = $1 AND s.quiet AND o.deleted_at IS NULL \
           AND s.weekday = extract(isodow FROM n.at) \
           AND n.at::time >= s.starts_at AND n.at::time < s.ends_at \
         ORDER BY s.starts_at LIMIT 1",
    )
    .bind(account)
    .bind(qubite_planner::DEFAULT_TIMEZONE)
    .fetch_optional(conn)
    .await?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::time;

    #[test]
    fn night_crosses_midnight() {
        let settings = Settings::default();
        assert!(settings.quiet_at(time!(23:00)));
        assert!(settings.quiet_at(time!(02:30)));
        assert!(settings.quiet_at(time!(07:59)));
        assert!(!settings.quiet_at(time!(08:00)));
        assert!(!settings.quiet_at(time!(15:00)));
        let day = Settings {
            quiet_from: time!(13:00),
            quiet_to: time!(14:00),
            ..Settings::default()
        };
        assert!(day.quiet_at(time!(13:30)));
        assert!(!day.quiet_at(time!(14:30)));
        let off = Settings {
            quiet_from: time!(00:00),
            quiet_to: time!(00:00),
            ..Settings::default()
        };
        assert!(!off.quiet_at(time!(03:00)));
    }
}
