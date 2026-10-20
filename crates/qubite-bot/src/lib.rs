//! Telegram-бот Qubite (CMD-006) — `qubite bot`.
//!
//! - **Новый бот** (старый работает в старом Qubite на Pi); токен — из
//!   `QUBITE_TELEGRAM_BOT_TOKEN`, вставляет владелец.
//! - Сообщения, ссылки, файлы и голосовые от **привязанного** человека с
//!   правом записи во Входящие → элемент Входящих (через движок синхронизации:
//!   он сразу виден на всех устройствах). Неизвестные отправители получают
//!   отказ, ничего не сохраняется.
//! - Уведомления владельцу ([`notify`]): вход с нового устройства, пароль,
//!   «выйти везде», кража токена, привязки входа, настройки платформы,
//!   регистрации и приглашения, расход AI 80 %/100 %, сервер не отвечает и
//!   ошибки, бэкап, место на диске. Каждый вид можно выключить.
//! - Кнопки под напоминаниями ([`reminders`], PLAN-004): «понял» и «позже».
//!
//! Решения — D-196…D-198.

pub mod capture;
pub mod notify;
pub mod reminders;
pub mod tech;
pub mod telegram;
pub mod watch;

use std::{path::PathBuf, time::Duration};

use qubite_objects::BlobStore;
use serde_json::json;
use sqlx::PgPool;

pub use capture::Outcome;
pub use notify::Kind;
pub use telegram::TelegramApi;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("Telegram: {0}")]
    Telegram(String),
    #[error("неверные данные: {0}")]
    Invalid(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка объектов: {0}")]
    Objects(#[from] qubite_objects::Error),
    #[error("ошибка синхронизации: {0}")]
    Sync(#[from] qubite_sync_server::Error),
    #[error(transparent)]
    OAuth(#[from] qubite_oauth::Error),
    #[error("вход: {0}")]
    Auth(#[from] qubite_auth::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Настройки `qubite bot`.
#[derive(Debug, Clone)]
pub struct BotConfig {
    /// Адрес Bot API (в тестах — поддельный сервер).
    pub api_base: String,
    pub token: String,
    /// Где лежат файлы Qubite (вложения и проверка места на диске).
    pub data_dir: PathBuf,
    /// Адрес сервера для проверки «жив ли» (`/api/ready`).
    pub server_url: String,
    /// Долгий опрос Telegram.
    pub poll_wait: Duration,
    /// Как часто проверять аудит, AI, диск и сервер.
    pub watch_every: Duration,
    /// Адрес Qubite Auth — для ссылок на вход и пропуска owner (`/tech`).
    pub auth_url: String,
    /// На сервере стоит `QUBITE_MAINTENANCE=true` (бот предупреждает owner).
    pub maintenance_env: bool,
}

pub struct Bot {
    pool: PgPool,
    api: TelegramApi,
    blobs: BlobStore,
    http: reqwest::Client,
    config: BotConfig,
}

impl Bot {
    pub fn new(pool: PgPool, config: BotConfig) -> Self {
        let api = TelegramApi::new(&config.api_base, &config.token);
        let blobs = BlobStore::new(config.data_dir.join("blobs"));
        Self {
            pool,
            api,
            blobs,
            http: reqwest::Client::new(),
            config,
        }
    }

    pub fn api(&self) -> &TelegramApi {
        &self.api
    }

    /// Забрать и обработать новые сообщения. Смещение сохраняется после
    /// каждого — после перезапуска бот продолжит с того же места.
    pub async fn poll_once(&self, wait: Duration) -> Result<Vec<Outcome>> {
        let offset = watch::state(&self.pool, "telegram.offset")
            .await?
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let updates = self.api.updates(offset, wait).await?;
        let mut outcomes = Vec::with_capacity(updates.len());
        for update in updates {
            if let Some(query) = &update.callback_query {
                if let Err(error) = reminders::handle(&self.pool, &self.api, query).await {
                    tracing::warn!(%error, update = update.update_id, "бот: кнопка не обработана");
                }
                watch::set_state(&self.pool, "telegram.offset", json!(update.update_id + 1))
                    .await?;
                outcomes.push(Outcome::Command);
                continue;
            }
            let tech = tech::handle(
                &self.pool,
                &self.api,
                &self.config.auth_url,
                self.config.maintenance_env,
                &update,
            )
            .await;
            let handled = match tech {
                Ok(Some(outcome)) => Ok(outcome),
                Ok(None) => capture::handle(&self.pool, &self.api, &self.blobs, &update).await,
                Err(error) => Err(error),
            };
            let outcome = match handled {
                Ok(outcome) => outcome,
                Err(error) => {
                    // Одно плохое сообщение не должно останавливать бота.
                    tracing::warn!(%error, update = update.update_id, "бот: сообщение не обработано");
                    Outcome::Ignored
                }
            };
            watch::set_state(&self.pool, "telegram.offset", json!(update.update_id + 1)).await?;
            outcomes.push(outcome);
        }
        Ok(outcomes)
    }

    /// Проверки и отправка уведомлений.
    pub async fn housekeeping(&self) -> Result<usize> {
        watch::scan_audit(&self.pool).await?;
        watch::scan_ai(&self.pool).await?;
        if let Err(error) = watch::check_disk(&self.pool, &self.config.data_dir).await {
            tracing::warn!(%error, "бот: место на диске не проверено");
        }
        let alive = watch::probe(&self.http, &self.config.server_url).await;
        watch::record_health(&self.pool, alive).await?;
        notify::deliver(&self.pool, &self.api).await
    }

    /// Работать, пока не придёт сигнал остановки.
    pub async fn run(self, shutdown: impl std::future::Future<Output = ()>) {
        tokio::pin!(shutdown);
        let mut watch = tokio::time::interval(self.config.watch_every);
        loop {
            tokio::select! {
                () = &mut shutdown => return,
                _ = watch.tick() => {
                    if let Err(error) = self.housekeeping().await {
                        tracing::warn!(%error, "бот: проверки не прошли");
                    }
                }
                result = self.poll_once(self.config.poll_wait) => {
                    if let Err(error) = result {
                        tracing::warn!(%error, "бот: Telegram недоступен, повтор через 5 с");
                        tokio::time::sleep(Duration::from_secs(5)).await;
                    }
                }
            }
        }
    }
}
