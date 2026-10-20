//! Напоминания и каналы (PLAN-004): колокольчик в Qubite, push в браузере,
//! Telegram-бот. Почты нет (D-296).
//!
//! - **Колокольчик** ([`notice`]) — всё, что Qubite написал человеку; push и
//!   Telegram только доставляют то же сообщение. Прочитал в одном месте —
//!   гаснет в другом (в Telegram сообщение помечается «прочитано», кнопки
//!   пропадают).
//! - **Один канал наружу** ([`deliver`]): человек сидит в Qubite — только
//!   колокольчик; нет — сначала выбранный канал (push или Telegram), не
//!   дошло — второй. Одно сообщение не приходит дважды.
//! - **Тишина** ([`settings::Settings::quiet_at`]): ночью (23:00–08:00 по
//!   умолчанию) и на уроках агент не пишет первым — его сообщения ложатся
//!   только в колокольчик. Напоминания, которые человек поставил сам (и
//!   напоминания о его делах), приходят всегда (D-294).
//! - **Без постоянного процесса**: всё — задачи в очереди `jobs` ([`worker`]),
//!   их выполняет обработчик внутри `qubite serve`.
//!
//! Решения — D-310…D-319.

pub mod deliver;
pub mod notice;
pub mod settings;
pub mod webpush;
pub mod worker;

use std::{future::Future, pin::Pin};

pub use notice::{Kind, NewNotice, Notice, Origin};
pub use settings::Settings;
pub use webpush::WebPush;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("неверные данные: {0}")]
    Invalid(String),
    #[error("не найдено")]
    NotFound,
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("очередь: {0}")]
    Jobs(#[from] qubite_jobs::Error),
    #[error("Planner: {0}")]
    Planner(#[from] qubite_planner::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Кнопка под сообщением в Telegram: текст и данные (до 64 байт).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Button {
    pub text: String,
    pub data: String,
}

/// Отправка в Telegram (реализует `qubite-bot` поверх Bot API).
pub trait Telegram: Send + Sync {
    /// Отправить с кнопками; вернуть ID сообщения.
    fn send<'a>(
        &'a self,
        chat: i64,
        text: &'a str,
        buttons: &'a [Button],
    ) -> BoxFuture<'a, Result<i64, String>>;
    /// Заменить текст сообщения и убрать кнопки.
    fn edit<'a>(
        &'a self,
        chat: i64,
        message: i64,
        text: &'a str,
    ) -> BoxFuture<'a, Result<(), String>>;
}
