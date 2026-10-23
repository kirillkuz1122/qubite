//! Голос фраз программы и напоминания (ENG-002, D-488, D-489).
//!
//! - **Голос фраз** ([`phrase`]): «послушай», примеры теории, образцы голосов.
//!   Озвучивается только текст из программы (и образец голоса) — чужой текст
//!   за деньги owner не озвучить. Одна фраза одним голосом — один раз на
//!   установку (`english_audio`), дальше бесплатно.
//! - **Напоминание** ([`remind_all`]): раз в день в выбранное время — в
//!   колокольчик и Telegram от агента, не в тишину (ночь, урок по
//!   расписанию), не в день отдыха и паузу, не если кольцо уже закрыто. Тон —
//!   Нейт, без вины (GAME.md §7).

use std::{collections::HashSet, sync::OnceLock};

use qubite_ai::{Gateway, SpeakRequest, voice};
use serde_json::Value;
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, Result, course, game, lessons, may_read, may_use_ai};

fn collect(value: &Value, out: &mut HashSet<String>) {
    match value {
        Value::String(s) if s.chars().count() <= 1000 => {
            out.insert(s.trim().to_owned());
        }
        Value::Array(list) => list.iter().for_each(|v| collect(v, out)),
        Value::Object(map) => map.values().for_each(|v| collect(v, out)),
        _ => {}
    }
}

/// Все строки программы (то, что можно озвучить).
fn phrases() -> &'static HashSet<String> {
    static ALL: OnceLock<HashSet<String>> = OnceLock::new();
    ALL.get_or_init(|| {
        let c = course::course();
        let mut out = HashSet::new();
        for entry in &c.entries {
            if let Some(lesson) = c.base_lesson(&entry.id) {
                collect(lesson, &mut out);
            }
        }
        collect(&c.placement, &mut out);
        out.insert(lessons::SAMPLE.to_owned());
        out
    })
}

/// Озвучить фразу программы голосом человека (или `voice` — образец).
pub async fn phrase(
    pool: &PgPool,
    gateway: &Gateway,
    settings: &crate::Settings,
    account: Uuid,
    text: &str,
    voice: Option<&str>,
) -> Result<crate::Speech> {
    may_read(pool, account).await?;
    let text = text.trim();
    if !phrases().contains(text) {
        return Err(Error::Invalid("озвучивается только текст уроков".into()));
    }
    let voice = match voice {
        Some(v) if lessons::VOICES.iter().any(|x| x.0 == v) => v.to_owned(),
        Some(_) => return Err(Error::Invalid("такого голоса нет в списке".into())),
        None => lessons::voice_of(pool, account, &settings.voice).await?,
    };
    let key = format!("{voice}:{text}");
    let cached: Option<(Vec<u8>, String)> =
        sqlx::query_as("SELECT audio, mime FROM english_audio WHERE key = $1")
            .bind(&key)
            .fetch_optional(pool)
            .await?;
    if let Some((audio, mime)) = cached {
        return Ok(crate::Speech {
            audio,
            mime,
            cost_usd_micros: 0,
        });
    }
    let auth = may_use_ai(pool, account).await?;
    let model = gateway.model_for(voice::TTS_TASK).await?;
    let spoken = gateway
        .speak(
            &auth,
            SpeakRequest {
                request_id: format!("english:phrase:{}", Uuid::now_v7()),
                model,
                voice: voice.clone(),
                text: text.to_owned(),
            },
        )
        .await?;
    sqlx::query(
        "INSERT INTO english_audio (key, voice, text, audio, mime, tts_call) \
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (key) DO NOTHING",
    )
    .bind(&key)
    .bind(&voice)
    .bind(text)
    .bind(&spoken.audio)
    .bind(&spoken.mime)
    .bind(spoken.call_id)
    .execute(pool)
    .await?;
    Ok(crate::Speech {
        audio: spoken.audio,
        mime: spoken.mime,
        cost_usd_micros: spoken.cost_usd,
    })
}

// ---------------------------------------------------------------- напоминания

/// Текст напоминания: обычный или тёплый после 3 дней без занятий.
pub fn reminder_text(days_away: i64, goal: i32, streak: i32) -> (String, String) {
    if days_away >= 3 {
        return (
            "Нейт: я тут".into(),
            "Начнём с 5 минут? Один урок, без спешки — я даже почти не буду язвить.".into(),
        );
    }
    let title = if streak > 0 {
        format!("Нейт: {goal} минут английского? Огонёк — {streak}")
    } else {
        format!("Нейт: {goal} минут английского?")
    };
    (
        title,
        "У меня новое задание: опиши картинку и скажи пару фраз вслух. Открой «Английский».".into(),
    )
}

/// Кому пора: человек, цель, огонёк, день отдыха, пауза, последняя практика.
type Due = (
    Uuid,
    i32,
    i32,
    Option<i16>,
    Option<time::Date>,
    Option<OffsetDateTime>,
);

/// Разослать напоминания тем, кому пора (раз в день). Возвращает, сколько.
pub async fn remind_all(pool: &PgPool) -> Result<usize> {
    let mut conn = pool.acquire().await?;
    let today = game::today(&mut conn).await?;
    let now = qubite_notify::settings::local_now(&mut conn)
        .await
        .map_err(|e| Error::Invalid(e.to_string()))?;
    let rows: Vec<Due> = sqlx::query_as(
        "SELECT l.account_id, l.goal_minutes, l.streak, l.rest_weekday, l.paused_until, l.active_at \
         FROM english_learners l \
         WHERE l.remind AND l.remind_at <= $1 AND (l.reminded_on IS NULL OR l.reminded_on < $2) \
         AND NOT EXISTS (SELECT 1 FROM english_days d WHERE d.account_id = l.account_id \
                         AND d.day = $2 AND d.ring)",
    )
    .bind(now)
    .bind(today)
    .fetch_all(&mut *conn)
    .await?;
    let mut sent = 0;
    for (account, goal, streak, rest, paused, active) in rows {
        let resting =
            rest.is_some_and(|w| i32::from(w) == i32::from(today.weekday().number_from_monday()));
        if resting || paused.is_some_and(|p| today <= p) {
            continue;
        }
        let days_away = active.map_or(0, |a| (OffsetDateTime::now_utc() - a).whole_days());
        // После тёплого письма — раз в неделю, пока не вернётся.
        if days_away > 3 && days_away % 7 != 3 {
            continue;
        }
        if qubite_notify::notice::quiet_now(&mut conn, account)
            .await
            .map_err(|e| Error::Invalid(e.to_string()))?
            .is_some()
        {
            continue;
        }
        let (title, body) = reminder_text(days_away, goal, streak);
        let notice = qubite_notify::notice::send(
            &mut conn,
            qubite_notify::NewNotice {
                account_id: account,
                kind: qubite_notify::Kind::Agent,
                origin: qubite_notify::Origin::Agent,
                title,
                body,
                why: "напоминание английского: раз в день в твоё время (настройки «Английский»)"
                    .into(),
                object_id: None,
                dedup_key: Some(format!("english:remind:{today}")),
                options: Vec::new(),
            },
        )
        .await
        .map_err(|e| Error::Invalid(e.to_string()))?;
        sqlx::query("UPDATE english_learners SET reminded_on = $2 WHERE account_id = $1")
            .bind(account)
            .bind(today)
            .execute(&mut *conn)
            .await?;
        if notice.is_some() {
            sent += 1;
        }
    }
    Ok(sent)
}

/// Раз в 5 минут — напоминания английского.
pub fn spawn(pool: PgPool) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut every = tokio::time::interval(std::time::Duration::from_secs(5 * 60));
        loop {
            every.tick().await;
            match remind_all(&pool).await {
                Ok(0) => {}
                Ok(n) => tracing::info!(n, "напоминания английского отправлены"),
                Err(error) => tracing::warn!(%error, "напоминания английского не отправлены"),
            }
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn phrases_are_from_program() {
        assert!(phrases().contains("Hello! My name is Nate."));
        assert!(!phrases().contains("Say something rude"));
    }

    #[test]
    fn reminder_has_no_guilt() {
        let (title, body) = reminder_text(0, 10, 4);
        assert!(title.contains("10 минут") && title.contains('4'));
        let (warm, _) = reminder_text(5, 10, 0);
        assert_eq!(warm, "Нейт: я тут");
        for text in [title, body] {
            assert!(!text.contains("подвёл") && !text.contains("умрёт"));
        }
    }
}
