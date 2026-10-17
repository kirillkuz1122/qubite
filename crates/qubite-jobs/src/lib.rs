//! Очередь фоновых задач в PostgreSQL (без Redis и Kafka).
//!
//! Как это работает:
//! - задача ставится в очередь (`enqueue`); ключ идемпотентности защищает от
//!   повторной постановки той же задачи;
//! - обработчик забирает задачу (`claim`) с «арендой» на время работы:
//!   `FOR UPDATE SKIP LOCKED` гарантирует, что одну задачу не возьмут двое;
//! - если обработчик упал и аренда истекла, задачу заберёт другой — она не
//!   теряется;
//! - завершить задачу может только тот, кто держит аренду: опоздавший
//!   обработчик получит `LeaseLost` и не отметит задачу выполненной второй раз;
//! - при ошибке задача повторяется с растущей паузой, после `max_attempts`
//!   попыток помечается `dead` и ждёт человека.
//!
//! Обработчики должны быть идемпотентными: если процесс упал после работы, но
//! до `complete`, задача выполнится ещё раз (это честная гарантия «хотя бы
//! один раз»).

use std::{future::Future, time::Duration};

use serde::Serialize;
use sqlx::PgPool;
use time::OffsetDateTime;
use tokio::sync::watch;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("аренда задачи потеряна: её уже забрал другой обработчик или она завершена")]
    LeaseLost,
    #[error("неверные данные задачи: {0}")]
    Invalid(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Queued,
    Running,
    Succeeded,
    Dead,
}

impl TryFrom<String> for Status {
    type Error = String;

    fn try_from(value: String) -> std::result::Result<Self, Self::Error> {
        match value.as_str() {
            "queued" => Ok(Self::Queued),
            "running" => Ok(Self::Running),
            "succeeded" => Ok(Self::Succeeded),
            "dead" => Ok(Self::Dead),
            other => Err(format!("неизвестный статус задачи {other}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct Job {
    pub id: Uuid,
    pub kind: String,
    pub payload: serde_json::Value,
    #[sqlx(try_from = "String")]
    pub status: Status,
    pub attempts: i32,
    pub max_attempts: i32,
    pub run_at: OffsetDateTime,
    pub locked_by: Option<String>,
    pub locked_until: Option<OffsetDateTime>,
    pub last_error: Option<String>,
    pub idempotency_key: Option<String>,
    pub created_at: OffsetDateTime,
    pub finished_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct NewJob {
    pub kind: String,
    pub payload: serde_json::Value,
    /// Не раньше этого момента. `None` — сразу.
    pub run_at: Option<OffsetDateTime>,
    pub max_attempts: i32,
    /// Одинаковый ключ — одна задача, сколько бы раз её ни ставили.
    pub idempotency_key: Option<String>,
}

impl NewJob {
    pub fn new(kind: &str, payload: serde_json::Value) -> Self {
        Self {
            kind: kind.to_owned(),
            payload,
            run_at: None,
            max_attempts: 5,
            idempotency_key: None,
        }
    }

    pub fn idempotency_key(mut self, key: impl Into<String>) -> Self {
        self.idempotency_key = Some(key.into());
        self
    }

    pub fn run_at(mut self, at: OffsetDateTime) -> Self {
        self.run_at = Some(at);
        self
    }

    pub fn max_attempts(mut self, attempts: i32) -> Self {
        self.max_attempts = attempts;
        self
    }
}

const COLUMNS: &str = "id, kind, payload, status, attempts, max_attempts, run_at, locked_by, \
     locked_until, last_error, idempotency_key, created_at, finished_at";

/// Поставить задачу в очередь. С ключом идемпотентности повтор вернёт уже существующую.
pub async fn enqueue(pool: &PgPool, new: NewJob) -> Result<Job> {
    if new.max_attempts < 1 {
        return Err(Error::Invalid(
            "max_attempts должно быть не меньше 1".into(),
        ));
    }
    let inserted: Option<Job> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO jobs (id, kind, payload, run_at, max_attempts, idempotency_key) \
         VALUES ($1, $2, $3, COALESCE($4, now()), $5, $6) \
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING {COLUMNS}"
    )))
    .bind(Uuid::now_v7())
    .bind(&new.kind)
    .bind(&new.payload)
    .bind(new.run_at)
    .bind(new.max_attempts)
    .bind(&new.idempotency_key)
    .fetch_optional(pool)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23514") => {
            Error::Invalid(db.message().to_owned())
        }
        _ => Error::Db(error),
    })?;
    match inserted {
        Some(job) => Ok(job),
        None => Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
            "SELECT {COLUMNS} FROM jobs WHERE idempotency_key = $1"
        )))
        .bind(&new.idempotency_key)
        .fetch_one(pool)
        .await?),
    }
}

/// Забрать следующую готовую задачу (или задачу с истёкшей арендой).
/// `kinds` — какие виды задач умеет этот обработчик.
pub async fn claim(
    pool: &PgPool,
    worker: &str,
    kinds: &[&str],
    lease: Duration,
) -> Result<Option<Job>> {
    let kinds: Vec<String> = kinds.iter().map(|kind| (*kind).to_owned()).collect();
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "UPDATE jobs SET status = 'running', locked_by = $1, \
             locked_until = now() + make_interval(secs => $2), attempts = attempts + 1 \
         WHERE id = ( \
             SELECT id FROM jobs \
             WHERE kind = ANY($3) AND ( \
                 (status = 'queued' AND run_at <= now()) \
                 OR (status = 'running' AND locked_until < now())) \
             ORDER BY run_at, id \
             FOR UPDATE SKIP LOCKED LIMIT 1) \
         RETURNING {COLUMNS}"
    )))
    .bind(worker)
    .bind(lease.as_secs_f64())
    .bind(&kinds)
    .fetch_optional(pool)
    .await?)
}

/// Отметить задачу выполненной. Только тот, кто держит задачу сейчас: если аренда
/// истекла и задачу перехватил другой обработчик, вернётся `LeaseLost`.
pub async fn complete(pool: &PgPool, id: Uuid, worker: &str) -> Result<()> {
    let done = sqlx::query(
        "UPDATE jobs SET status = 'succeeded', locked_by = NULL, locked_until = NULL, \
         finished_at = now(), last_error = NULL \
         WHERE id = $1 AND status = 'running' AND locked_by = $2",
    )
    .bind(id)
    .bind(worker)
    .execute(pool)
    .await?;
    if done.rows_affected() == 1 {
        Ok(())
    } else {
        Err(Error::LeaseLost)
    }
}

/// Отметить неудачную попытку. Вернёт новый статус: `Queued` (повтор позже) или `Dead`.
pub async fn fail(pool: &PgPool, id: Uuid, worker: &str, error: &str) -> Result<Status> {
    // Ошибку обрезаем: в ней не должно быть больших данных, а секретов — тем более.
    let error: String = error.chars().take(2000).collect();
    let status: Option<String> = sqlx::query_scalar(
        "UPDATE jobs SET \
             status = CASE WHEN attempts >= max_attempts THEN 'dead' ELSE 'queued' END, \
             run_at = CASE WHEN attempts >= max_attempts THEN run_at \
                      ELSE now() + make_interval(secs => LEAST(power(2, attempts), 3600)) END, \
             finished_at = CASE WHEN attempts >= max_attempts THEN now() END, \
             locked_by = NULL, locked_until = NULL, last_error = $3 \
         WHERE id = $1 AND status = 'running' AND locked_by = $2 \
         RETURNING status",
    )
    .bind(id)
    .bind(worker)
    .bind(error)
    .fetch_optional(pool)
    .await?;
    match status {
        Some(status) => Status::try_from(status).map_err(Error::Invalid),
        None => Err(Error::LeaseLost),
    }
}

/// Задача по ID (для проверок и экрана «Сервер» в Owner Console).
pub async fn get(pool: &PgPool, id: Uuid) -> Result<Option<Job>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM jobs WHERE id = $1"
    )))
    .bind(id)
    .fetch_optional(pool)
    .await?)
}

/// Настройки цикла обработчика.
#[derive(Debug, Clone)]
pub struct WorkerConfig {
    pub worker_id: String,
    pub kinds: Vec<String>,
    pub lease: Duration,
    /// Пауза, когда очередь пуста.
    pub idle_poll: Duration,
}

/// Цикл обработчика: забирать задачи и выполнять `handler`, пока не придёт
/// сигнал остановки. Возвращает число обработанных задач.
pub async fn run_worker<F, Fut>(
    pool: &PgPool,
    config: &WorkerConfig,
    mut shutdown: watch::Receiver<bool>,
    handler: F,
) -> Result<u64>
where
    F: Fn(Job) -> Fut,
    Fut: Future<Output = std::result::Result<(), String>>,
{
    let kinds: Vec<&str> = config.kinds.iter().map(String::as_str).collect();
    let mut processed = 0;
    while !*shutdown.borrow() {
        let Some(job) = claim(pool, &config.worker_id, &kinds, config.lease).await? else {
            tokio::select! {
                _ = tokio::time::sleep(config.idle_poll) => {}
                _ = shutdown.changed() => {}
            }
            continue;
        };
        let id = job.id;
        let kind = job.kind.clone();
        match handler(job).await {
            Ok(()) => match complete(pool, id, &config.worker_id).await {
                Ok(()) => {}
                Err(Error::LeaseLost) => {
                    tracing::warn!(%id, %kind, "задача выполнена, но аренда истекла — её заберёт другой обработчик");
                }
                Err(error) => return Err(error),
            },
            Err(message) => {
                let status = fail(pool, id, &config.worker_id, &message).await;
                tracing::warn!(%id, %kind, ?status, "задача завершилась ошибкой");
            }
        }
        processed += 1;
    }
    Ok(processed)
}
