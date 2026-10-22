//! Провайдеры AI. Код модулей не видит провайдера: вызвать его может только
//! шлюз ([`crate::Gateway`]), и только после проверки прав и резерва бюджета.
//! Настоящий провайдер — [`crate::openrouter`], для тестов — [`MockProvider`].

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

/// Куда провайдер отдаёт текст ответа по кусочкам, пока модель пишет
/// (ENG-001: репетитор начинает говорить с первого предложения).
pub type Delta = tokio::sync::mpsc::UnboundedSender<String>;

/// Роль сообщения в разговоре с моделью.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// Инструкции платформы и модуля (доверенные).
    System,
    /// Данные: только обёрнутые недоверенные части ([`crate::guard`]).
    User,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct ChatMessage {
    pub role: Role,
    pub content: String,
}

/// Куда провайдеру можно отправить запрос (настройка модели owner, D-211).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Routing {
    /// Провайдеры модели по порядку (у OpenRouter — slug: `google-vertex`,
    /// `deepinfra/turbo`). Пусто — провайдер выбирает сам; иначе — только эти,
    /// без автосмены.
    pub providers: Vec<String>,
    /// `allow` / `deny`; `None` — не указывать.
    pub data_collection: Option<String>,
    /// Цены из каталога (микродоллары за миллион): дороже — провайдер
    /// не должен выполнять запрос.
    pub max_price_in_per_mtok: i64,
    pub max_price_out_per_mtok: i64,
}

/// Что отправить провайдеру. Сообщения собирает шлюз ([`crate::guard`]).
#[derive(Debug, Clone)]
pub struct ProviderCall {
    /// Имя модели у провайдера.
    pub external_id: String,
    pub messages: Vec<ChatMessage>,
    /// Потолок ответа: провайдер не даст модели написать больше.
    pub max_output_tokens: u32,
    /// Оценка входа сверху — на случай, если провайдер не сообщит расход.
    pub input_tokens_estimate: u64,
    pub routing: Routing,
    /// Чей это запрос (подписка ChatGPT — только для того, кто её подключил).
    pub account_id: uuid::Uuid,
}

/// Ответ провайдера с фактическим расходом токенов.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProviderReply {
    pub text: String,
    pub tokens_in: u64,
    pub tokens_out: u64,
    /// Стоимость, которую сообщил сам провайдер (микродоллары), если сообщил.
    /// Шлюз списывает большее из неё и расчёта по каталогу.
    pub cost_usd: Option<i64>,
}

/// Ошибка провайдера. Главное — **ушёл ли запрос**: от этого зависит, можно
/// ли повторять и надо ли держать резерв.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProviderError {
    /// Точно не ушёл (не открылось соединение, провайдер отказал до обработки).
    /// Можно повторить.
    #[error("запрос не отправлен: {0}")]
    NotSent(String),
    /// Провайдер отказал до обработки моделью, и повтор не поможет (неверный
    /// ключ, нет денег на счёте, модель не найдена, слишком длинный запрос).
    /// Денег не стоило; резерв возвращается, повтора нет.
    #[error("провайдер отказал: {0}")]
    Refused(String),
    /// Исчерпан лимит подписки (ChatGPT): денег не стоило, повтор не поможет.
    #[error("{0}")]
    UsageLimit(String),
    /// Неизвестно, обработан ли запрос (обрыв после отправки). Повторять
    /// нельзя, резерв удерживается.
    #[error("результат неизвестен: {0}")]
    Unknown(String),
}

/// Адаптер провайдера (OpenRouter — [`crate::openrouter`], mock — здесь).
pub trait Provider: Send + Sync {
    fn complete<'a>(
        &'a self,
        call: &'a ProviderCall,
    ) -> BoxFuture<'a, Result<ProviderReply, ProviderError>>;

    /// То же, но текст уходит в `delta` по мере того, как модель пишет.
    /// Итог — как у [`Provider::complete`]. Провайдер без потока отдаёт
    /// ответ одним куском в конце.
    fn stream<'a>(
        &'a self,
        call: &'a ProviderCall,
        delta: Delta,
    ) -> BoxFuture<'a, Result<ProviderReply, ProviderError>> {
        Box::pin(async move {
            let reply = self.complete(call).await?;
            let _ = delta.send(reply.text.clone());
            Ok(reply)
        })
    }
}

/// Как поведёт себя mock-провайдер на очередном вызове.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MockStep {
    /// Ответить, потратив столько токенов.
    Succeed { tokens_in: u64, tokens_out: u64 },
    /// Ответить и сообщить свою стоимость (микродоллары).
    SucceedWithCost {
        tokens_in: u64,
        tokens_out: u64,
        cost_usd: i64,
    },
    /// Ответить этим текстом (агент в тестах: JSON с инструментами).
    Reply {
        text: String,
        tokens_in: u64,
        tokens_out: u64,
    },
    /// Ответить кусками с паузой `delay_ms` перед каждым (поток модели).
    Stream {
        chunks: Vec<String>,
        delay_ms: u64,
        tokens_in: u64,
        tokens_out: u64,
    },
    /// Отказать до отправки.
    FailBeforeSend,
    /// Отказ провайдера без повтора (например, нет денег на счёте).
    Refuse,
    /// Исчерпан лимит подписки.
    UsageLimit,
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
    last: Mutex<Option<ProviderCall>>,
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
            last: Mutex::new(None),
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

    /// Что шлюз отправил в последний раз (проверка защиты от prompt injection).
    pub fn last_call(&self) -> Option<ProviderCall> {
        self.last.lock().expect("mock").clone()
    }
}

impl Provider for MockProvider {
    fn complete<'a>(
        &'a self,
        call: &'a ProviderCall,
    ) -> BoxFuture<'a, Result<ProviderReply, ProviderError>> {
        Box::pin(self.answer(call, None))
    }

    fn stream<'a>(
        &'a self,
        call: &'a ProviderCall,
        delta: Delta,
    ) -> BoxFuture<'a, Result<ProviderReply, ProviderError>> {
        Box::pin(self.answer(call, Some(delta)))
    }
}

impl MockProvider {
    async fn answer(
        &self,
        call: &ProviderCall,
        delta: Option<Delta>,
    ) -> Result<ProviderReply, ProviderError> {
        let (reply, chunks) = self.step(call).await;
        if let (Some(delta), Ok(reply)) = (&delta, &reply) {
            match chunks {
                // Потоковый шаг: куски с паузами, как пишет модель.
                Some((delay, chunks)) => {
                    for chunk in chunks {
                        tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                        let _ = delta.send(chunk);
                    }
                }
                // Обычный шаг в потоковом вызове — одним куском.
                None => {
                    let _ = delta.send(reply.text.clone());
                }
            }
        } else if let (None, Some((delay, chunks))) = (&delta, chunks) {
            // Без потока ответ приходит целиком, когда модель дописала.
            tokio::time::sleep(std::time::Duration::from_millis(
                delay * chunks.len() as u64,
            ))
            .await;
        }
        reply
    }

    /// Ответ на шаг; у потокового — ещё пауза и куски.
    #[allow(clippy::type_complexity)]
    async fn step(
        &self,
        call: &ProviderCall,
    ) -> (
        Result<ProviderReply, ProviderError>,
        Option<(u64, Vec<String>)>,
    ) {
        self.calls.fetch_add(1, Ordering::SeqCst);
        *self.last.lock().expect("mock") = Some(call.clone());
        let step = self
            .steps
            .lock()
            .expect("mock")
            .pop_front()
            .unwrap_or_else(|| self.fallback.clone());
        self.called.notify_one();
        let reply = match step {
            MockStep::Succeed {
                tokens_in,
                tokens_out,
            } => {
                let last = call.messages.last().map_or("", |m| m.content.as_str());
                Ok(ProviderReply {
                    text: format!("mock: {}", last.chars().take(40).collect::<String>()),
                    tokens_in,
                    tokens_out,
                    cost_usd: None,
                })
            }
            MockStep::SucceedWithCost {
                tokens_in,
                tokens_out,
                cost_usd,
            } => Ok(ProviderReply {
                text: "mock".into(),
                tokens_in,
                tokens_out,
                cost_usd: Some(cost_usd),
            }),
            MockStep::Reply {
                text,
                tokens_in,
                tokens_out,
            } => Ok(ProviderReply {
                text,
                tokens_in,
                tokens_out,
                cost_usd: None,
            }),
            MockStep::Stream {
                chunks,
                delay_ms,
                tokens_in,
                tokens_out,
            } => {
                return (
                    Ok(ProviderReply {
                        text: chunks.concat(),
                        tokens_in,
                        tokens_out,
                        cost_usd: None,
                    }),
                    Some((delay_ms, chunks)),
                );
            }
            MockStep::FailBeforeSend => {
                Err(ProviderError::NotSent("mock: отказ до отправки".into()))
            }
            MockStep::Refuse => Err(ProviderError::Refused("mock: нет денег на счёте".into())),
            MockStep::UsageLimit => Err(ProviderError::UsageLimit(
                "mock: лимит подписки исчерпан".into(),
            )),
            MockStep::DropAfterSend => {
                Err(ProviderError::Unknown("mock: обрыв после отправки".into()))
            }
            MockStep::Hang => std::future::pending().await,
        };
        (reply, None)
    }
}
