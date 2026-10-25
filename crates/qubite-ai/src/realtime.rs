//! Живой голосовой разговор с моделью (ENG-005, D-573, D-590…D-594): OpenAI
//! Realtime по подписке ChatGPT человека.
//!
//! - **Ключ.** Сервер просит у провайдера **временный** ключ сеанса
//!   (`POST /v1/realtime/client_secrets`) с настройками: инструкции, голос,
//!   расшифровка речи человека. Браузер подключается с ним к модели напрямую
//!   (WebRTC): звук через сервер не идёт. Основной токен подписки остаётся на
//!   сервере.
//! - **Учёт** — как у любого вызова: права, модель, защита от зацикливания,
//!   резерв, журнал (`ai_calls`). Денег подписка не тратит (0 $), поэтому
//!   свои лимиты — сеансов в день, минут в день и длина сеанса
//!   ([`RealtimeLimits`], таблица `ai_realtime_sessions`).
//! - **Длительность** сообщает браузер ([`Gateway::realtime_finish`]); ей не
//!   верим больше, чем прошло на часах сервера и чем потолок сеанса. Сеанс без
//!   конца (закрыли вкладку) считается по худшему случаю — до потолка.
//! - Подписка — только для своих запросов человека: ключ выдаётся по его
//!   собственному входу в ChatGPT (как AI-005).

use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};

use qubite_policy::{Authorized, UseAi};
use serde::Serialize;
use uuid::Uuid;

use crate::{
    AiError, Done, Gateway, Plan, Result, Work, guard,
    provider::{BoxFuture, ProviderError},
};

/// Способность модели «живой голосовой разговор».
pub const REALTIME: &str = "realtime";
/// Модель по умолчанию (проверена по подписке владельца, D-573).
pub const DEFAULT_MODEL: &str = "chatgpt:gpt-realtime-1.5";
/// Модель попроще и побыстрее — если подписка её пускает (Q-146).
pub const MINI_MODEL: &str = "chatgpt:gpt-realtime-mini";
/// Модели на выбор: ID, имя, о модели.
pub const MODELS: &[(&str, &str, &str)] = &[
    (
        DEFAULT_MODEL,
        "GPT Realtime 1.5",
        "лучше понимает и объясняет — по умолчанию",
    ),
    (
        MINI_MODEL,
        "GPT Realtime mini",
        "быстрее и проще; если подписка её не пустит — включится 1.5",
    ),
];
/// Распознавание речи человека внутри сеанса (расшифровка на экране).
pub const TRANSCRIBE_MODEL: &str = "gpt-4o-mini-transcribe";
/// Голоса OpenAI Realtime: ID, о голосе.
pub const VOICES: &[(&str, &str)] = &[
    ("marin", "женский, живой — по умолчанию"),
    ("cedar", "мужской, живой"),
    ("ash", "мужской, твёрдый"),
    ("ballad", "мужской, британский"),
    ("coral", "женский, тёплый"),
    ("echo", "мужской, спокойный"),
    ("sage", "женский, спокойный"),
    ("shimmer", "женский, светлый"),
    ("verse", "мужской, выразительный"),
    ("alloy", "нейтральный"),
];
pub const DEFAULT_VOICE: &str = "marin";
/// Сколько живёт временный ключ: только чтобы успеть подключиться, с.
pub const KEY_TTL_SECS: u64 = 120;

/// Свои лимиты realtime (подписка денег не тратит, а время — тратит).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RealtimeLimits {
    /// Самый длинный сеанс, с: столько засчитывается, если конец не пришёл.
    pub max_session_secs: u64,
    /// Сеансов в день на человека (0 — без проверки).
    pub day_sessions: u32,
    /// Секунд разговора в день на человека (0 — без проверки).
    pub day_secs: u64,
}

impl Default for RealtimeLimits {
    fn default() -> Self {
        Self {
            max_session_secs: 15 * 60,
            day_sessions: 20,
            day_secs: 60 * 60,
        }
    }
}

/// Что попросить у провайдера.
#[derive(Debug, Clone)]
pub struct RealtimeCall {
    pub external_id: String,
    /// Инструкции модели (уже собранные защитой [`guard`]).
    pub instructions: String,
    pub voice: String,
    /// Модель расшифровки речи человека.
    pub transcribe: String,
    /// Язык расшифровки; `None` — определит сама (человек говорит и по-русски).
    pub language: Option<String>,
    /// Чья подписка: только своя (AI-005).
    pub account_id: Uuid,
}

/// Временный ключ сеанса.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RealtimeKey {
    pub value: String,
    /// Когда перестанет годиться для подключения (Unix-время, с).
    pub expires_at: i64,
}

/// Адаптер провайдера realtime. Модули его не видят: вызывает только шлюз
/// после прав и резерва.
pub trait RealtimeProvider: Send + Sync {
    fn client_secret<'a>(
        &'a self,
        call: &'a RealtimeCall,
    ) -> BoxFuture<'a, Result<RealtimeKey, ProviderError>>;

    /// Куда браузер отправляет своё SDP-предложение с временным ключом.
    fn calls_url(&self) -> String;
}

/// Запрос модуля на сеанс.
#[derive(Debug, Clone)]
pub struct RealtimeRequest {
    pub request_id: String,
    pub model: String,
    /// Инструкции — только из кода модуля.
    pub prompt: String,
    /// Данные (урок, заметки, прошлые реплики) — шлюз их обернёт.
    pub untrusted: Vec<guard::Untrusted>,
    pub voice: String,
    pub language: Option<String>,
}

/// Выданный сеанс: ключ для браузера и сколько можно говорить.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct RealtimeSession {
    pub call_id: Uuid,
    pub key: String,
    pub expires_at: i64,
    /// ID модели в Qubite и имя у провайдера.
    pub model: String,
    pub external_id: String,
    pub voice: String,
    pub calls_url: String,
    /// Потолок этого сеанса, с (меньше, если на сегодня осталось меньше).
    pub max_seconds: u64,
}

/// Сколько realtime использовано сегодня.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct RealtimeUsage {
    pub sessions: i64,
    pub seconds: i64,
    pub day_sessions: u32,
    pub day_secs: u64,
    pub max_session_secs: u64,
}

pub(crate) struct Open {
    pub(crate) instructions: String,
    pub(crate) voice: String,
    pub(crate) language: Option<String>,
}

impl Gateway {
    /// Подключить адаптер realtime с этим ID провайдера.
    pub fn with_realtime(mut self, provider_id: &str, provider: Arc<dyn RealtimeProvider>) -> Self {
        self.realtimes.insert(provider_id.into(), provider);
        self
    }

    pub fn realtime_limits(&self) -> &RealtimeLimits {
        &self.config.realtime
    }

    /// Готов ли realtime на сервере: адаптер есть, провайдер включён,
    /// модель есть и не заблокирована. Подписку человека не проверяет.
    pub async fn realtime_ready(&self, model: &str) -> Result<bool> {
        let row: Option<(String, Vec<String>)> = sqlx::query_as(
            "SELECT m.provider_id, m.capabilities FROM ai_models m \
             JOIN ai_providers p ON p.id = m.provider_id \
             WHERE m.id = $1 AND p.enabled AND m.blocked_reason IS NULL",
        )
        .bind(model)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.is_some_and(|(provider, capabilities)| {
            self.realtimes.contains_key(&provider) && capabilities.iter().any(|c| c == REALTIME)
        }))
    }

    /// Сколько использовано сегодня (по поясу шлюза). Не закрытый сеанс —
    /// по часам, но не больше его потолка.
    pub async fn realtime_usage(&self, account_id: Uuid) -> Result<RealtimeUsage> {
        let (sessions, seconds): (i64, i64) = sqlx::query_as(
            "SELECT count(*), coalesce(sum(coalesce(seconds, \
                 least(ceil(extract(epoch FROM now() - started_at))::int, max_seconds))), 0)::bigint \
             FROM ai_realtime_sessions WHERE account_id = $1 \
               AND started_at >= (date_trunc('day', now() AT TIME ZONE $2) AT TIME ZONE $2)",
        )
        .bind(account_id)
        .bind(self.timezone())
        .fetch_one(&self.pool)
        .await?;
        let limits = &self.config.realtime;
        Ok(RealtimeUsage {
            sessions,
            seconds,
            day_sessions: limits.day_sessions,
            day_secs: limits.day_secs,
            max_session_secs: limits.max_session_secs,
        })
    }

    /// Открыть сеанс: свои лимиты → права, модель, защита от зацикливания,
    /// резерв и журнал (общий путь шлюза) → временный ключ у провайдера.
    /// Прежние не закрытые сеансы человека закрываются по часам.
    pub async fn realtime_open(
        &self,
        auth: &Authorized<UseAi>,
        request: RealtimeRequest,
    ) -> Result<RealtimeSession> {
        if request.voice.trim().is_empty() {
            return Err(AiError::Invalid("голос не выбран".into()));
        }
        let account = auth.account_id();
        self.close_stale_realtime(account).await?;
        let usage = self.realtime_usage(account).await?;
        let limits = &self.config.realtime;
        if limits.day_sessions > 0 && usage.sessions >= i64::from(limits.day_sessions) {
            return Err(AiError::SessionLimit(format!(
                "на сегодня живых разговоров уже {} из {} — завтра снова можно, а пока — ElevenLabs или текст",
                usage.sessions, limits.day_sessions
            )));
        }
        let left = if limits.day_secs > 0 {
            u64::try_from(i64::try_from(limits.day_secs).unwrap_or(i64::MAX) - usage.seconds)
                .unwrap_or(0)
        } else {
            limits.max_session_secs
        };
        if left < 30 {
            return Err(AiError::SessionLimit(format!(
                "на сегодня {} минут живого разговора уже потрачены — завтра снова можно, а пока — ElevenLabs или текст",
                limits.day_secs / 60
            )));
        }
        let max_seconds = limits.max_session_secs.min(left);

        let guarded =
            guard::build(&request.prompt, &request.untrusted).map_err(AiError::Invalid)?;
        let instructions = guarded
            .messages
            .iter()
            .map(|m| m.content.as_str())
            .collect::<Vec<_>>()
            .join("\n\n");
        let open = Open {
            instructions,
            voice: request.voice.clone(),
            language: request.language.clone(),
        };
        // В отпечатке — ID запроса: одинаковые инструкции у разных сеансов — не повтор.
        let fingerprint = self.fingerprint([
            request.model.as_bytes(),
            b"realtime".as_slice(),
            request.request_id.as_bytes(),
        ]);
        let (call_id, done, _) = self
            .run(
                auth,
                Plan {
                    request_id: &request.request_id,
                    model: &request.model,
                    fingerprint,
                    input_units: 0,
                    max_output_units: 0,
                    job_id: None,
                    turn: None,
                    signals: guarded.signals.clone(),
                    work: Work::Realtime(&open),
                },
            )
            .await?;
        let Done::Realtime {
            key,
            model,
            calls_url,
        } = done
        else {
            unreachable!("на сеанс — ключ")
        };
        sqlx::query(
            "INSERT INTO ai_realtime_sessions (call_id, account_id, model_id, max_seconds) \
             VALUES ($1, $2, $3, $4)",
        )
        .bind(call_id)
        .bind(account)
        .bind(&request.model)
        .bind(i32::try_from(max_seconds).unwrap_or(i32::MAX))
        .execute(&self.pool)
        .await?;
        Ok(RealtimeSession {
            call_id,
            key: key.value,
            expires_at: key.expires_at,
            model: request.model,
            external_id: model,
            voice: request.voice,
            calls_url,
            max_seconds,
        })
    }

    /// Сеанс закончился: сколько длился по словам браузера (не больше, чем
    /// прошло, и не больше потолка). Повторный вызов ничего не меняет.
    /// Возвращает засчитанные секунды.
    pub async fn realtime_finish(
        &self,
        account_id: Uuid,
        call_id: Uuid,
        seconds: u64,
    ) -> Result<u64> {
        let mut tx = self.pool.begin().await?;
        let row: Option<(Option<i32>, i32, i64)> = sqlx::query_as(
            "SELECT seconds, max_seconds, ceil(extract(epoch FROM now() - started_at))::bigint \
             FROM ai_realtime_sessions WHERE call_id = $1 AND account_id = $2 FOR UPDATE",
        )
        .bind(call_id)
        .bind(account_id)
        .fetch_optional(&mut *tx)
        .await?;
        let Some((done, max, elapsed)) = row else {
            return Err(AiError::Invalid("нет такого сеанса".into()));
        };
        if let Some(done) = done {
            return Ok(u64::try_from(done).unwrap_or(0));
        }
        let counted = seconds
            .min(u64::try_from(elapsed.max(0)).unwrap_or(0) + 5)
            .min(u64::try_from(max).unwrap_or(0));
        let counted_i = i64::try_from(counted).unwrap_or(i64::MAX);
        sqlx::query(
            "UPDATE ai_realtime_sessions SET seconds = $2, ended_at = now() WHERE call_id = $1",
        )
        .bind(call_id)
        .bind(counted_i as i32)
        .execute(&mut *tx)
        .await?;
        sqlx::query("UPDATE ai_calls SET tokens_in = $2, updated_at = now() WHERE id = $1")
            .bind(call_id)
            .bind(counted_i)
            .execute(&mut *tx)
            .await?;
        crate::event(
            &mut tx,
            call_id,
            "realtime.finished",
            serde_json::json!({ "seconds": counted, "reported": seconds }),
        )
        .await?;
        tx.commit().await?;
        Ok(counted)
    }

    /// Не закрытые сеансы человека — закрыть по часам (до потолка).
    async fn close_stale_realtime(&self, account_id: Uuid) -> Result<()> {
        let ids: Vec<(Uuid, i32)> = sqlx::query_as(
            "UPDATE ai_realtime_sessions SET ended_at = now(), \
                 seconds = least(ceil(extract(epoch FROM now() - started_at))::int, max_seconds) \
             WHERE account_id = $1 AND ended_at IS NULL RETURNING call_id, seconds",
        )
        .bind(account_id)
        .fetch_all(&self.pool)
        .await?;
        for (id, seconds) in ids {
            sqlx::query("UPDATE ai_calls SET tokens_in = $2, updated_at = now() WHERE id = $1")
                .bind(id)
                .bind(i64::from(seconds))
                .execute(&self.pool)
                .await?;
            let mut conn = self.pool.acquire().await?;
            crate::event(
                &mut conn,
                id,
                "realtime.closed",
                serde_json::json!({ "seconds": seconds }),
            )
            .await?;
        }
        Ok(())
    }

    /// Вызвать провайдера realtime (уже после резерва).
    pub(crate) async fn send_realtime(
        &self,
        provider_id: &str,
        external_id: &str,
        account_id: Uuid,
        open: &Open,
    ) -> std::result::Result<Result<Done, ProviderError>, tokio::time::error::Elapsed> {
        let provider = self.realtimes[provider_id].clone();
        let call = RealtimeCall {
            external_id: external_id.to_owned(),
            instructions: open.instructions.clone(),
            voice: open.voice.clone(),
            transcribe: TRANSCRIBE_MODEL.into(),
            language: open.language.clone(),
            account_id,
        };
        tokio::time::timeout(self.config.timeout, provider.client_secret(&call))
            .await
            .map(|key| {
                key.map(|key| Done::Realtime {
                    key,
                    model: call.external_id.clone(),
                    calls_url: provider.calls_url(),
                })
            })
    }
}

// ---------------------------------------------------------------- подделка

/// Что ответит [`MockRealtime`] на очередной запрос ключа.
#[derive(Debug, Clone)]
pub enum MockRealtimeStep {
    Key,
    UsageLimit,
    Refused(String),
    NotSent,
}

/// Подделка провайдера realtime для тестов: ключи `ek_test_<n>`, вызовы
/// записываются. Платных запросов нет.
pub struct MockRealtime {
    script: std::sync::Mutex<std::collections::VecDeque<MockRealtimeStep>>,
    calls: std::sync::Mutex<Vec<RealtimeCall>>,
    issued: AtomicUsize,
}

impl Default for MockRealtime {
    fn default() -> Self {
        Self::new()
    }
}

impl MockRealtime {
    pub fn new() -> Self {
        Self {
            script: Default::default(),
            calls: Default::default(),
            issued: AtomicUsize::new(0),
        }
    }

    pub fn script(self, steps: impl IntoIterator<Item = MockRealtimeStep>) -> Self {
        self.script.lock().expect("сценарий").extend(steps);
        self
    }

    pub fn calls(&self) -> Vec<RealtimeCall> {
        self.calls.lock().expect("вызовы").clone()
    }
}

impl RealtimeProvider for MockRealtime {
    fn client_secret<'a>(
        &'a self,
        call: &'a RealtimeCall,
    ) -> BoxFuture<'a, Result<RealtimeKey, ProviderError>> {
        Box::pin(async move {
            self.calls.lock().expect("вызовы").push(call.clone());
            let step = self
                .script
                .lock()
                .expect("сценарий")
                .pop_front()
                .unwrap_or(MockRealtimeStep::Key);
            match step {
                MockRealtimeStep::Key => {
                    let n = self.issued.fetch_add(1, Ordering::SeqCst) + 1;
                    Ok(RealtimeKey {
                        value: format!("ek_test_{n}"),
                        expires_at: time::OffsetDateTime::now_utc().unix_timestamp() + 120,
                    })
                }
                MockRealtimeStep::UsageLimit => Err(ProviderError::UsageLimit(
                    "лимит подписки ChatGPT исчерпан".into(),
                )),
                MockRealtimeStep::Refused(reason) => Err(ProviderError::Refused(reason)),
                MockRealtimeStep::NotSent => Err(ProviderError::NotSent("нет соединения".into())),
            }
        })
    }

    fn calls_url(&self) -> String {
        "https://realtime.test/v1/realtime/calls".into()
    }
}
