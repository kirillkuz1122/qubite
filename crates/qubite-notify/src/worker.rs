//! Обработчик очереди `jobs` для напоминаний и каналов. Работает внутри
//! `qubite serve`: задачи сами «просыпаются» в своё время (`run_at`), отдельного
//! процесса и расписания нет.

use std::time::Duration;

use qubite_jobs::Job;
use qubite_planner::{format_time, reminder};
use qubite_policy::{ModuleId, Read, Subject};
use serde::Deserialize;
use sqlx::PgPool;
use tokio::{sync::watch, task::JoinHandle};
use uuid::Uuid;

use crate::{
    Kind, NewNotice, Origin, Result,
    deliver::{self, Channels},
    notice,
};

/// Какие задачи берёт этот обработчик.
pub const KINDS: &[&str] = &[
    reminder::JOB,
    notice::DELIVER_JOB,
    notice::CLOSE_JOB,
    notice::REPEAT_JOB,
];

#[derive(Deserialize)]
struct RemindPayload {
    task_id: Uuid,
    at_ms: i64,
}

#[derive(Deserialize)]
struct IdPayload {
    id: Uuid,
}

fn payload<T: for<'de> Deserialize<'de>>(job: &Job) -> std::result::Result<T, String> {
    serde_json::from_value(job.payload.clone())
        .map_err(|error| format!("задача {}: {error}", job.kind))
}

/// Пришло время напоминания: положить в колокольчик (доставка — следом).
/// Возвращает сообщение или `None`, если напоминание устарело.
pub async fn remind(pool: &PgPool, task_id: Uuid, at_ms: i64) -> Result<Option<crate::Notice>> {
    let mut conn = pool.acquire().await?;
    let Some((task, plan)) = reminder::due(&mut conn, task_id, at_ms).await? else {
        return Ok(None);
    };
    // Права проверяются заново: забрали Planner или заблокировали — молчим.
    let module = ModuleId::new(qubite_planner::MODULE)
        .map_err(|error| crate::Error::Invalid(error.to_string()))?;
    if qubite_policy::decide_in::<Read>(&mut conn, &Subject::account(task.owner_id, None), &module)
        .await
        .is_err()
    {
        return Ok(None);
    }
    let body = match task.due_time {
        Some(time) => format!("в {}", format_time(time)),
        None => String::new(),
    };
    notice::send(
        &mut conn,
        NewNotice {
            account_id: task.owner_id,
            kind: Kind::Reminder,
            // Напоминание о своём деле — твоё, приходит и в тишину (D-294).
            origin: Origin::Owner,
            title: task.title.clone(),
            body,
            why: plan.why,
            object_id: Some(task.id),
            dedup_key: Some(format!("remind:{}:{at_ms}", task.id)),
        },
    )
    .await
}

/// Выполнить одну задачу.
pub async fn handle(
    pool: &PgPool,
    channels: &Channels,
    job: &Job,
) -> std::result::Result<(), String> {
    let result = match job.kind.as_str() {
        reminder::JOB => {
            let RemindPayload { task_id, at_ms } = payload(job)?;
            remind(pool, task_id, at_ms).await.map(drop)
        }
        notice::DELIVER_JOB => {
            let IdPayload { id } = payload(job)?;
            deliver::deliver(pool, channels, id).await.map(drop)
        }
        notice::CLOSE_JOB => {
            let IdPayload { id } = payload(job)?;
            deliver::close(pool, channels, id).await.map(drop)
        }
        notice::REPEAT_JOB => {
            let IdPayload { id } = payload(job)?;
            let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
            notice::repeat(&mut conn, id).await.map(drop)
        }
        other => return Err(format!("неизвестная задача {other}")),
    };
    result.map_err(|error| error.to_string())
}

/// Выполнить всё, что готово сейчас (тесты и ручной запуск). Возвращает,
/// сколько задач взято.
pub async fn run_ready(pool: &PgPool, channels: &Channels) -> Result<usize> {
    let mut done = 0;
    while let Some(job) =
        qubite_jobs::claim(pool, "notify-now", KINDS, Duration::from_secs(60)).await?
    {
        match handle(pool, channels, &job).await {
            Ok(()) => qubite_jobs::complete(pool, job.id, "notify-now").await?,
            Err(error) => {
                qubite_jobs::fail(pool, job.id, "notify-now", &error).await?;
            }
        }
        done += 1;
    }
    Ok(done)
}

/// Запустить обработчик в фоне (`qubite serve`). Остановить — `true` в `shutdown`.
pub fn spawn(pool: PgPool, channels: Channels, shutdown: watch::Receiver<bool>) -> JoinHandle<()> {
    tokio::spawn(async move {
        let config = qubite_jobs::WorkerConfig {
            worker_id: format!("serve-{}", Uuid::now_v7()),
            kinds: KINDS.iter().map(|kind| (*kind).to_owned()).collect(),
            lease: Duration::from_secs(60),
            idle_poll: Duration::from_secs(5),
        };
        loop {
            let result = qubite_jobs::run_worker(&pool, &config, shutdown.clone(), |job| {
                let pool = pool.clone();
                let channels = channels.clone();
                async move { handle(&pool, &channels, &job).await }
            })
            .await;
            match result {
                Ok(_) => return,
                Err(error) => {
                    // База недоступна — подождать и продолжить, сервер не падает.
                    tracing::warn!(%error, "напоминания: очередь недоступна, повтор через 10 с");
                    tokio::time::sleep(Duration::from_secs(10)).await;
                    if *shutdown.borrow() {
                        return;
                    }
                }
            }
        }
    })
}
