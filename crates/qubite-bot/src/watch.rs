//! Что бот замечает сам: события аудита, расход AI, место на диске, жив ли
//! сервер. Всё превращается в уведомления владельцу ([`notify::enqueue`]).

use std::{path::Path, time::Duration};

use serde_json::{Value, json};
use sqlx::PgPool;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    Result,
    notify::{self, Kind},
};

pub async fn state(pool: &PgPool, key: &str) -> Result<Option<Value>> {
    Ok(
        sqlx::query_scalar("SELECT value FROM bot_state WHERE key = $1")
            .bind(key)
            .fetch_optional(pool)
            .await?,
    )
}

pub async fn set_state(pool: &PgPool, key: &str, value: Value) -> Result<()> {
    sqlx::query(
        "INSERT INTO bot_state (key, value) VALUES ($1, $2) \
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()",
    )
    .bind(key)
    .bind(value)
    .execute(pool)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------- аудит

#[derive(sqlx::FromRow)]
struct Entry {
    seq: i64,
    at: OffsetDateTime,
    actor_id: Option<Uuid>,
    action: String,
    target_id: Option<String>,
    before: Option<Value>,
    after: Option<Value>,
}

fn text(value: Option<&Value>, key: &str) -> String {
    value
        .and_then(|value| value.get(key))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned()
}

fn when(at: OffsetDateTime) -> String {
    format!(
        "{:02}.{:02} {:02}:{:02} UTC",
        at.day(),
        u8::from(at.month()),
        at.hour(),
        at.minute()
    )
}

/// Пройти новые записи аудита. При первом запуске — только запомнить, где
/// конец: старую историю владельцу не присылаем.
pub async fn scan_audit(pool: &PgPool) -> Result<usize> {
    let max: Option<i64> = sqlx::query_scalar("SELECT max(seq) FROM audit_log")
        .fetch_one(pool)
        .await?;
    let Some(cursor) = state(pool, "audit.seq").await?.and_then(|v| v.as_i64()) else {
        set_state(pool, "audit.seq", json!(max.unwrap_or(0))).await?;
        return Ok(0);
    };
    let owner: Option<Uuid> = sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_optional(pool)
        .await?;
    let entries: Vec<Entry> = sqlx::query_as(
        "SELECT seq, at, actor_id, action, target_id, before, after FROM audit_log \
         WHERE seq > $1 ORDER BY seq LIMIT 200",
    )
    .bind(cursor)
    .fetch_all(pool)
    .await?;
    let mut queued = 0;
    let mut last = cursor;
    for entry in entries {
        last = entry.seq;
        let about_owner = owner.is_some_and(|owner| {
            entry.actor_id == Some(owner) || entry.target_id.as_deref() == Some(&owner.to_string())
        });
        let after = entry.after.as_ref();
        let at = when(entry.at);
        let notice = match entry.action.as_str() {
            "auth.login" | "auth.device_login" if about_owner => {
                let device = [text(after, "user_agent"), text(after, "device_name")]
                    .into_iter()
                    .find(|value| !value.is_empty())
                    .unwrap_or_else(|| "неизвестное устройство".into());
                let seen: bool = sqlx::query_scalar(
                    "SELECT EXISTS (SELECT 1 FROM audit_log WHERE seq < $1 AND actor_id = $2 \
                     AND action IN ('auth.login', 'auth.device_login') \
                     AND coalesce(nullif(after->>'user_agent', ''), after->>'device_name') = $3)",
                )
                .bind(entry.seq)
                .bind(entry.actor_id)
                .bind(&device)
                .fetch_one(pool)
                .await?;
                let method = text(after, "method");
                (!seen).then(|| {
                    (
                        Kind::NewDeviceLogin,
                        format!(
                            "🔐 Вход в аккаунт owner с нового устройства\n{device}\nIP: {}{}\n{at}\nЕсли это не вы — «Выйти везде» и смените пароль.",
                            text(after, "ip"),
                            if method.is_empty() { String::new() } else { format!(", способ: {method}") }
                        ),
                    )
                })
            }
            "auth.password_changed" | "auth.password_reset" if about_owner => Some((
                Kind::PasswordChanged,
                format!("🔑 Пароль owner изменён ({at}). Все сессии закрыты."),
            )),
            "auth.logout_everywhere" if about_owner => Some((
                Kind::SessionsRevoked,
                format!("🚪 В аккаунте owner нажали «Выйти везде» ({at})."),
            )),
            "auth.refresh_reuse" if about_owner => Some((
                Kind::TokenReuse,
                format!(
                    "⚠️ Повторно предъявлен старый токен приложения owner ({at}) — похоже на кражу. Сессия этого устройства закрыта."
                ),
            )),
            "auth.oauth_linked" | "auth.oauth_unlinked" if about_owner => Some((
                Kind::LoginMethodChanged,
                format!(
                    "🔗 У owner {} вход через {} ({at}).",
                    if entry.action.ends_with("unlinked") {
                        "отвязан"
                    } else {
                        "привязан"
                    },
                    [
                        text(after, "provider"),
                        text(entry.before.as_ref(), "provider")
                    ]
                    .concat()
                ),
            )),
            "platform.setting_changed" | "ai.owner_unlimited_set" => Some((
                Kind::PlatformChanged,
                format!(
                    "⚙️ Изменена настройка платформы ({at}): {}",
                    entry
                        .after
                        .as_ref()
                        .map(Value::to_string)
                        .unwrap_or_default()
                        .chars()
                        .take(300)
                        .collect::<String>()
                ),
            )),
            "account.registered" => {
                let invited = after
                    .and_then(|after| after.get("invitation"))
                    .is_some_and(|v| !v.is_null());
                let email = text(after, "email");
                Some(if invited {
                    (
                        Kind::InvitationAccepted,
                        format!("🎟 Принято приглашение: {email} ({at})"),
                    )
                } else {
                    (
                        Kind::Registration,
                        format!("👤 Новая регистрация: {email} ({at})"),
                    )
                })
            }
            _ => None,
        };
        if let Some((kind, message)) = notice {
            let mut conn = pool.acquire().await?;
            if notify::enqueue(
                &mut conn,
                kind,
                &message,
                Some(&format!("audit:{}", entry.seq)),
            )
            .await?
            {
                queued += 1;
            }
        }
    }
    if last != cursor {
        set_state(pool, "audit.seq", json!(last)).await?;
    }
    Ok(queued)
}

// ---------------------------------------------------------------- AI

#[derive(sqlx::FromRow)]
struct Usage {
    id: Uuid,
    scope_kind: String,
    period: String,
    metric: String,
    limit_value: i64,
    period_key: String,
    used: i64,
    email: Option<String>,
    module_id: Option<String>,
}

fn amount(metric: &str, value: i64) -> String {
    match metric {
        // Деньги в шлюзе — микродоллары.
        "usd" => {
            #[allow(clippy::cast_precision_loss)]
            let dollars = value as f64 / 1_000_000.0;
            format!("${dollars:.2}")
        }
        "tokens" => format!("{value} токенов"),
        _ => format!("{value} запросов"),
    }
}

/// Лимиты AI, где расход (вместе с отложенным) перешёл 80 % или 100 %.
/// Каждое «перешёл порог в этом периоде» — одно уведомление.
pub async fn scan_ai(pool: &PgPool) -> Result<usize> {
    let rows: Vec<Usage> = sqlx::query_as(
        "SELECT l.id, l.scope_kind, l.period, l.metric, l.limit_value, c.period_key, \
                (c.spent + c.reserved) AS used, a.email, l.module_id \
         FROM ai_limits l JOIN ai_usage_counters c ON c.limit_id = l.id \
         LEFT JOIN accounts a ON a.id = l.account_id \
         WHERE l.revoked_at IS NULL AND l.limit_value > 0 \
           AND c.updated_at > now() - interval '2 days'",
    )
    .fetch_all(pool)
    .await?;
    let mut queued = 0;
    for row in rows {
        let percent = row.used.saturating_mul(100) / row.limit_value;
        let (kind, threshold) = match percent {
            100.. => (Kind::AiBudget100, 100),
            80.. => (Kind::AiBudget80, 80),
            _ => continue,
        };
        let whom = match (row.scope_kind.as_str(), &row.email, &row.module_id) {
            ("platform", _, _) => "вся платформа".to_owned(),
            (_, Some(email), Some(module)) => format!("{email}, модуль {module}"),
            (_, Some(email), None) => email.clone(),
            (_, None, Some(module)) => format!("модуль {module}"),
            (scope, None, None) => scope.to_owned(),
        };
        let message = format!(
            "{} AI: израсходовано {percent} % лимита ({whom}, период {} {})\n{} из {}",
            if threshold == 100 { "⛔" } else { "💸" },
            row.period,
            row.period_key,
            amount(&row.metric, row.used),
            amount(&row.metric, row.limit_value),
        );
        let key = format!("ai:{}:{}:{threshold}", row.id, row.period_key);
        let mut conn = pool.acquire().await?;
        if notify::enqueue(&mut conn, kind, &message, Some(&key)).await? {
            queued += 1;
        }
    }
    Ok(queued)
}

// ---------------------------------------------------------------- диск

/// `df -Pk <путь>` → (всего, свободно) в байтах.
pub fn parse_df(output: &str) -> Option<(u64, u64)> {
    let line = output.lines().nth(1)?;
    let columns: Vec<&str> = line.split_whitespace().collect();
    let total: u64 = columns.get(1)?.parse().ok()?;
    let available: u64 = columns.get(3)?.parse().ok()?;
    Some((total * 1024, available * 1024))
}

/// Мало места: меньше 10 % или меньше 2 ГБ.
pub fn disk_is_low(total: u64, available: u64) -> bool {
    available < 2 * 1024 * 1024 * 1024 || available.saturating_mul(10) < total
}

/// Проверить место там, где Qubite хранит файлы. Не чаще раза в сутки.
pub async fn check_disk(pool: &PgPool, path: &Path) -> Result<bool> {
    let output = tokio::process::Command::new("df")
        .arg("-Pk")
        .arg(path)
        .output()
        .await
        .map_err(|error| crate::Error::Invalid(format!("df: {error}")))?;
    let Some((total, available)) = parse_df(&String::from_utf8_lossy(&output.stdout)) else {
        return Ok(false);
    };
    if !disk_is_low(total, available) {
        return Ok(false);
    }
    let gib = |bytes: u64| {
        #[allow(clippy::cast_precision_loss)]
        let value = bytes as f64 / 1024.0 / 1024.0 / 1024.0;
        value
    };
    let today = OffsetDateTime::now_utc().date();
    let mut conn = pool.acquire().await?;
    notify::enqueue(
        &mut conn,
        Kind::DiskLow,
        &format!(
            "💾 Кончается место на диске сервера: свободно {:.1} ГБ из {:.1} ГБ ({}).",
            gib(available),
            gib(total),
            path.display()
        ),
        Some(&format!("disk:{today}")),
    )
    .await
}

// ---------------------------------------------------------------- жив ли сервер

/// Сколько неудачных проверок подряд — «сервер упал».
pub const DOWN_AFTER: i64 = 3;

/// Учесть результат проверки `/api/ready`. Сообщает при падении (после
/// трёх неудач подряд) и при восстановлении — по одному разу.
pub async fn record_health(pool: &PgPool, ok: bool) -> Result<()> {
    let current = state(pool, "health").await?.unwrap_or_else(|| json!({}));
    let failures = current["failures"].as_i64().unwrap_or(0);
    let down = current["down"].as_bool().unwrap_or(false);
    let (failures, down) = if ok {
        if down {
            let mut conn = pool.acquire().await?;
            notify::enqueue(
                &mut conn,
                Kind::ServerDown,
                "✅ Сервер Qubite снова отвечает.",
                None,
            )
            .await?;
        }
        (0, false)
    } else {
        let failures = failures + 1;
        if failures >= DOWN_AFTER && !down {
            let mut conn = pool.acquire().await?;
            notify::enqueue(
                &mut conn,
                Kind::ServerDown,
                "🔥 Сервер Qubite не отвечает (проверка /api/ready не прошла 3 раза подряд).",
                None,
            )
            .await?;
            (failures, true)
        } else {
            (failures, down)
        }
    };
    set_state(
        pool,
        "health",
        json!({ "failures": failures, "down": down }),
    )
    .await
}

/// Проверить сервер по HTTP.
pub async fn probe(http: &reqwest::Client, server_url: &str) -> bool {
    http.get(format!("{}/api/ready", server_url.trim_end_matches('/')))
        .timeout(Duration::from_secs(10))
        .send()
        .await
        .is_ok_and(|response| response.status().is_success())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn df_output_is_parsed() {
        let output = "Filesystem     1024-blocks      Used Available Capacity Mounted on\n\
                      /dev/nvme0n1p6   199229440 188743680  10485760      95% /\n";
        let (total, available) = parse_df(output).unwrap();
        assert_eq!(available, 10 * 1024 * 1024 * 1024);
        assert!(
            disk_is_low(total, available),
            "10 ГБ из 190 — больше 2 ГБ, но это 5 %"
        );
        assert!(!disk_is_low(total, total / 2), "половина свободна");
        assert!(disk_is_low(total, 1024 * 1024 * 1024), "1 ГБ — мало");
        assert!(
            disk_is_low(
                100 * 1024 * 1024 * 1024 * 1024,
                5 * 1024 * 1024 * 1024 * 1024
            ),
            "5 % — мало"
        );
        assert!(parse_df("мусор").is_none());
    }
}
