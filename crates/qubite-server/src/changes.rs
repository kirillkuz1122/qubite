//! «Есть новое»: один слушатель канала PostgreSQL на весь сервер раздаёт
//! подсказки подключённым WebSocket.
//!
//! Триггер на `events` (миграция 0009) пишет в канал ID владельца каждого
//! изменённого объекта — кто бы его ни менял: синхронизация, API, бот в
//! отдельном процессе. Данные в подсказке не передаются: устройство само
//! забирает их через `/api/v1/sync/pull` со своими правами.

use std::{sync::OnceLock, time::Duration};

use sqlx::{PgPool, postgres::PgListener};
use tokio::sync::broadcast;
use uuid::Uuid;

/// Кому что-то изменилось. [`Change::Everyone`] — связь с базой прерывалась,
/// подсказки могли потеряться: пусть все устройства проверят.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Change {
    Account(Uuid),
    Everyone,
}

impl Change {
    pub fn concerns(self, account: Uuid) -> bool {
        match self {
            Self::Account(id) => id == account,
            Self::Everyone => true,
        }
    }
}

pub struct ChangeHub {
    sender: broadcast::Sender<Change>,
    listener: OnceLock<()>,
}

impl Default for ChangeHub {
    fn default() -> Self {
        Self {
            sender: broadcast::channel(1024).0,
            listener: OnceLock::new(),
        }
    }
}

impl ChangeHub {
    /// Подписаться. Слушатель базы запускается при первой подписке.
    pub fn subscribe(&self, pool: &PgPool) -> broadcast::Receiver<Change> {
        let receiver = self.sender.subscribe();
        self.listener.get_or_init(|| {
            tokio::spawn(listen(pool.clone(), self.sender.clone()));
        });
        receiver
    }
}

async fn listen(pool: PgPool, sender: broadcast::Sender<Change>) {
    loop {
        let Err(error) = listen_once(&pool, &sender).await;
        tracing::warn!(%error, "слушатель изменений: связь с базой прервана");
        let _ = sender.send(Change::Everyone);
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}

async fn listen_once(
    pool: &PgPool,
    sender: &broadcast::Sender<Change>,
) -> sqlx::Result<std::convert::Infallible> {
    let mut listener = PgListener::connect_with(pool).await?;
    listener.listen(qubite_sync_server::CHANGES_CHANNEL).await?;
    // Пока слушатель подключался, что-то могло измениться.
    let _ = sender.send(Change::Everyone);
    loop {
        match listener.try_recv().await? {
            Some(notification) => {
                if let Ok(account) = notification.payload().parse() {
                    let _ = sender.send(Change::Account(account));
                }
            }
            None => {
                // Соединение потеряно; следующий try_recv переподключится.
                let _ = sender.send(Change::Everyone);
            }
        }
    }
}
