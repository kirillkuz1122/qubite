//! Кэш ответов источников в памяти сервера.
//!
//! Свежее (моложе `ttl`) отдаётся без запроса. Источник не ответил — отдаём
//! последнее известное, если ему меньше суток, с пометкой «устарело».
//! Один ключ не запрашивается параллельно дважды: второй ждёт первого.

use std::{
    collections::HashMap,
    future::Future,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use time::OffsetDateTime;
use tokio::sync::Mutex as AsyncMutex;

use crate::Result;

/// Сколько держать устаревшее на случай, если источник лёг.
pub const KEEP_STALE: Duration = Duration::from_secs(24 * 60 * 60);
/// Больше ключей не держим (города, поиск) — старые вытесняются.
const MAX_KEYS: usize = 500;

/// Что вернул кэш.
#[derive(Debug, Clone)]
pub struct Got<T> {
    pub value: T,
    /// Когда получено от источника.
    pub fetched_at: OffsetDateTime,
    /// Источник сейчас не ответил — это последнее известное.
    pub stale: bool,
}

struct Entry<T> {
    value: T,
    at: Instant,
    fetched_at: OffsetDateTime,
}

pub struct Cache<T> {
    ttl: Duration,
    entries: Mutex<HashMap<String, Entry<T>>>,
    /// Замок на ключ: один запрос к источнику за раз.
    locks: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl<T: Clone> Cache<T> {
    pub fn new(ttl: Duration) -> Self {
        Self {
            ttl,
            entries: Mutex::new(HashMap::new()),
            locks: Mutex::new(HashMap::new()),
        }
    }

    fn fresh(&self, key: &str, max_age: Duration) -> Option<Got<T>> {
        let entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let entry = entries.get(key)?;
        (entry.at.elapsed() < max_age).then(|| Got {
            value: entry.value.clone(),
            fetched_at: entry.fetched_at,
            stale: false,
        })
    }

    fn put(&self, key: &str, value: T) -> OffsetDateTime {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if entries.len() >= MAX_KEYS
            && !entries.contains_key(key)
            && let Some(oldest) = entries
                .iter()
                .min_by_key(|(_, entry)| entry.at)
                .map(|(key, _)| key.clone())
        {
            entries.remove(&oldest);
        }
        let fetched_at = OffsetDateTime::now_utc();
        entries.insert(
            key.to_owned(),
            Entry {
                value,
                at: Instant::now(),
                fetched_at,
            },
        );
        fetched_at
    }

    fn lock_for(&self, key: &str) -> Arc<AsyncMutex<()>> {
        let mut locks = self
            .locks
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if locks.len() >= MAX_KEYS {
            locks.retain(|_, lock| Arc::strong_count(lock) > 1);
        }
        locks.entry(key.to_owned()).or_default().clone()
    }

    /// Свежее из кэша или от источника; источник не ответил — устаревшее.
    pub async fn get<F, Fut>(&self, key: &str, fetch: F) -> Result<Got<T>>
    where
        F: FnOnce() -> Fut,
        Fut: Future<Output = Result<T>>,
    {
        if let Some(got) = self.fresh(key, self.ttl) {
            return Ok(got);
        }
        let lock = self.lock_for(key);
        let _guard = lock.lock().await;
        if let Some(got) = self.fresh(key, self.ttl) {
            return Ok(got);
        }
        match fetch().await {
            Ok(value) => {
                let fetched_at = self.put(key, value.clone());
                Ok(Got {
                    value,
                    fetched_at,
                    stale: false,
                })
            }
            Err(error) => match self.fresh(key, KEEP_STALE) {
                Some(got) => {
                    tracing::warn!(%error, key, "Главная: источник не ответил, отдаю устаревшее");
                    Ok(Got { stale: true, ..got })
                }
                None => Err(error),
            },
        }
    }

    /// Забыть всё (тесты, смена источника).
    pub fn clear(&self) {
        self.entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .clear();
    }

    /// Состарить записи, будто прошло `ttl` (тест «источник лёг»).
    #[doc(hidden)]
    pub fn expire(&self) {
        let mut entries = self
            .entries
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        for entry in entries.values_mut() {
            if let Some(at) = entry.at.checked_sub(self.ttl) {
                entry.at = at;
            }
        }
    }
}
