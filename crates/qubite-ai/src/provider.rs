//! Провайдеры AI. Код модулей не видит провайдера: вызвать его может только
//! шлюз ([`crate::Gateway`]), и только после проверки прав и резерва бюджета.

use std::{
    collections::VecDeque,
    future::Future,
    pin::Pin,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use tokio::sync::Notify;

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Что отправить провайдеру.
#[derive(Debug, Clone)]
pub struct ProviderCall {
    /// Имя модели у провайдера.
    pub external_id: String,
    pub prompt: String,
    pub max_output_tokens: u32,
}

/// Ответ провайдера с фактическим расходом токенов.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderReply {
    pub text: String,
    pub tokens_in: u64,
    pub tokens_out: u64,
}

/// Ошибка провайдера. Главное — **ушёл ли запрос**: от этого зависит, можно
/// ли повторять и надо ли держать резерв.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    /// Точно не ушёл (не открылось соединение, провайдер отказал до обработки).
    /// Можно повторить.
    #[error("запрос не отправлен: {0}")]
    NotSent(String),
    /// Неизвестно, обработан ли запрос (обрыв после отправки). Повторять
    /// нельзя, резерв удерживается.
    #[error("результат неизвестен: {0}")]
    Unknown(String),
}

/// Адаптер провайдера (OpenRouter — AI-002, mock — здесь).
pub trait Provider: Send + Sync {
    fn complete<'a>(
        &'a self,
        call: &'a ProviderCall,
    ) -> BoxFuture<'a, Result<ProviderReply, ProviderError>>;
}

/// Как поведёт себя mock-провайдер на очередном вызове.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MockStep {
    /// Ответить, потратив столько токенов.
    Succeed { tokens_in: u64, tokens_out: u64 },
    /// Отказать до отправки.
    FailBeforeSend,
    /// Оборвать соединение после отправки.
    DropAfterSend,
    /// Не отвечать никогда (проверка таймаута).
    Hang,
}

/// Mock-провайдер для тестов: поведение задаёт тест, вызовы считаются.
/// Реальных платных вызовов в тестах нет (AI-08).
pub struct MockProvider {
    steps: Mutex<VecDeque<MockStep>>,
    fallback: MockStep,
    calls: AtomicUsize,
    /// Срабатывает после каждого вызова — тест может вмешаться между попытками.
    pub called: Notify,
}

impl MockProvider {
    /// Mock, который всегда отвечает `fallback`, пока не кончатся шаги из `script`.
    pub fn new(fallback: MockStep) -> Self {
        Self {
            steps: Mutex::new(VecDeque::new()),
            fallback,
            calls: AtomicUsize::new(0),
            called: Notify::new(),
        }
    }

    /// Добавить шаги, которые выполнятся по порядку.
    pub fn script(self, steps: impl IntoIterator<Item = MockStep>) -> Self {
        self.steps.lock().expect("mock").extend(steps);
        self
    }

    /// Сколько раз шлюз обратился к «внешнему» провайдеру.
    pub fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }
}

impl Provider for MockProvider {
    fn complete<'a>(
        &'a self,
        call: &'a ProviderCall,
    ) -> BoxFuture<'a, Result<ProviderReply, ProviderError>> {
        Box::pin(async move {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let step = self
                .steps
                .lock()
                .expect("mock")
                .pop_front()
                .unwrap_or_else(|| self.fallback.clone());
            self.called.notify_one();
            match step {
                MockStep::Succeed {
                    tokens_in,
                    tokens_out,
                } => Ok(ProviderReply {
                    text: format!("mock: {}", call.prompt.chars().take(40).collect::<String>()),
                    tokens_in,
                    tokens_out,
                }),
                MockStep::FailBeforeSend => {
                    Err(ProviderError::NotSent("mock: отказ до отправки".into()))
                }
                MockStep::DropAfterSend => {
                    Err(ProviderError::Unknown("mock: обрыв после отправки".into()))
                }
                MockStep::Hang => std::future::pending().await,
            }
        })
    }
}
