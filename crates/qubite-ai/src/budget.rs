//! Резерв бюджета: до вызова провайдера резервируется худшая стоимость по
//! **всем** подходящим лимитам в одной транзакции (D-073).
//!
//! Строки счётчиков блокируются `SELECT … FOR UPDATE` всегда в одном порядке
//! (по ID лимита), поэтому параллельные запросы встают в очередь и не могут
//! вместе превысить лимит, а взаимной блокировки не бывает.

use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{AiError, Result};

/// Сколько и в каком периоде зарезервировано по одному лимиту.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Reservation {
    pub limit_id: Uuid,
    pub period_key: String,
    pub metric: String,
    pub amount: i64,
}

/// Кто и что спрашивает.
#[derive(Debug, Clone)]
pub struct Scope<'a> {
    pub account_id: Uuid,
    pub module_id: &'a str,
    pub model_id: &'a str,
    pub provider_id: &'a str,
}

#[derive(sqlx::FromRow)]
struct LimitRow {
    id: Uuid,
    scope_kind: String,
    period: String,
    metric: String,
    limit_value: i64,
}

/// Ключи периодов («2026-10-18T23», «2026-10-18», «2026-10», «all») для
/// момента `now` в часовом поясе `timezone`. Пояса знает PostgreSQL.
pub async fn period_keys(
    conn: &mut PgConnection,
    now: OffsetDateTime,
    timezone: &str,
) -> Result<PeriodKeys> {
    let (hour, day, month): (String, String, String) = sqlx::query_as(
        "SELECT to_char($1::timestamptz AT TIME ZONE $2, 'YYYY-MM-DD\"T\"HH24'), \
                to_char($1::timestamptz AT TIME ZONE $2, 'YYYY-MM-DD'), \
                to_char($1::timestamptz AT TIME ZONE $2, 'YYYY-MM')",
    )
    .bind(now)
    .bind(timezone)
    .fetch_one(conn)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("22023") => {
            AiError::Invalid(format!("неизвестный часовой пояс «{timezone}»"))
        }
        _ => AiError::Db(error),
    })?;
    Ok(PeriodKeys { hour, day, month })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PeriodKeys {
    pub hour: String,
    pub day: String,
    pub month: String,
}

impl PeriodKeys {
    fn key(&self, period: &str) -> String {
        match period {
            "hour" => self.hour.clone(),
            "day" => self.day.clone(),
            "month" => self.month.clone(),
            _ => "all".into(),
        }
    }
}

/// Зарезервировать худшую стоимость. Нет личного денежного лимита — отказ:
/// бюджет по умолчанию ноль (D-173). Исключение — owner платформы, если он
/// сам включил режим «без личного лимита» (D-200); остальные лимиты на него
/// действуют как обычно.
pub async fn reserve(
    conn: &mut PgConnection,
    scope: &Scope<'_>,
    keys: &PeriodKeys,
    estimate_usd: i64,
    estimate_tokens: i64,
) -> Result<Vec<Reservation>> {
    let limits: Vec<LimitRow> = sqlx::query_as(
        "SELECT id, scope_kind, period, metric, limit_value FROM ai_limits
         WHERE revoked_at IS NULL AND (
               scope_kind = 'platform'
            OR (scope_kind = 'user' AND account_id = $1)
            OR (scope_kind = 'module' AND module_id = $2)
            OR (scope_kind = 'model' AND model_id = $3)
            OR (scope_kind = 'provider' AND provider_id = $4)
            OR (scope_kind = 'user_module' AND account_id = $1 AND module_id = $2))
         ORDER BY id",
    )
    .bind(scope.account_id)
    .bind(scope.module_id)
    .bind(scope.model_id)
    .bind(scope.provider_id)
    .fetch_all(&mut *conn)
    .await?;

    let personal_money = limits
        .iter()
        .any(|l| l.metric == "usd" && matches!(l.scope_kind.as_str(), "user" | "user_module"));
    if !personal_money && !owner_unlimited(conn, scope.account_id).await? {
        return Err(AiError::BudgetNotSet);
    }

    let mut reservations = Vec::with_capacity(limits.len());
    for limit in &limits {
        let period_key = keys.key(&limit.period);
        let amount = match limit.metric.as_str() {
            "usd" => estimate_usd,
            "tokens" => estimate_tokens,
            _ => 1,
        };
        sqlx::query(
            "INSERT INTO ai_usage_counters (limit_id, period_key) VALUES ($1, $2) \
             ON CONFLICT DO NOTHING",
        )
        .bind(limit.id)
        .bind(&period_key)
        .execute(&mut *conn)
        .await?;
        let (reserved, spent): (i64, i64) = sqlx::query_as(
            "SELECT reserved, spent FROM ai_usage_counters \
             WHERE limit_id = $1 AND period_key = $2 FOR UPDATE",
        )
        .bind(limit.id)
        .bind(&period_key)
        .fetch_one(&mut *conn)
        .await?;
        if reserved.saturating_add(spent).saturating_add(amount) > limit.limit_value {
            return Err(AiError::BudgetExhausted {
                scope: limit.scope_kind.clone(),
                period: limit.period.clone(),
                metric: limit.metric.clone(),
            });
        }
        sqlx::query(
            "UPDATE ai_usage_counters SET reserved = reserved + $3, updated_at = now() \
             WHERE limit_id = $1 AND period_key = $2",
        )
        .bind(limit.id)
        .bind(&period_key)
        .bind(amount)
        .execute(&mut *conn)
        .await?;
        reservations.push(Reservation {
            limit_id: limit.id,
            period_key,
            metric: limit.metric.clone(),
            amount,
        });
    }
    Ok(reservations)
}

async fn owner_unlimited(conn: &mut PgConnection, account_id: Uuid) -> Result<bool> {
    Ok(sqlx::query_scalar(
        "SELECT EXISTS (SELECT 1 FROM ai_owner_unlimited u \
         JOIN platform_owner o ON o.account_id = $1 WHERE u.enabled)",
    )
    .bind(account_id)
    .fetch_one(conn)
    .await?)
}

/// Вернуть резерв целиком (запрос точно не ушёл).
pub async fn release(conn: &mut PgConnection, reservations: &[Reservation]) -> Result<()> {
    apply(conn, reservations, None).await
}

/// Списать факт и вернуть остаток резерва. Факт дороже оценки списывается
/// полностью — счётчик может уйти за лимит, и новые запросы получат отказ.
pub async fn settle(
    conn: &mut PgConnection,
    reservations: &[Reservation],
    actual_usd: i64,
    actual_tokens: i64,
) -> Result<()> {
    apply(conn, reservations, Some((actual_usd, actual_tokens))).await
}

async fn apply(
    conn: &mut PgConnection,
    reservations: &[Reservation],
    actual: Option<(i64, i64)>,
) -> Result<()> {
    let mut sorted: Vec<&Reservation> = reservations.iter().collect();
    sorted.sort_by_key(|r| (r.limit_id, r.period_key.clone()));
    for reservation in sorted {
        let spent = actual.map_or(0, |(usd, tokens)| match reservation.metric.as_str() {
            "usd" => usd,
            "tokens" => tokens,
            _ => 1,
        });
        sqlx::query(
            "UPDATE ai_usage_counters SET reserved = greatest(reserved - $3, 0), \
                    spent = spent + $4, updated_at = now() \
             WHERE limit_id = $1 AND period_key = $2",
        )
        .bind(reservation.limit_id)
        .bind(&reservation.period_key)
        .bind(reservation.amount)
        .bind(spent)
        .execute(&mut *conn)
        .await?;
    }
    Ok(())
}
