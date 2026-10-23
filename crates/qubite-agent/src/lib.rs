//! Агент Qubite (AGT-002): инструменты и таймлайн действий с откатом.
//!
//! Агент меняет данные человека **без «да»** (D-293). Взамен каждое его
//! действие видно и откатывается, как коммит в git:
//!
//! - агент действует **только инструментами** ([`tools`]). Инструмент сам
//!   проверяет права (Policy Gate), делает изменение через движок
//!   синхронизации (та же проверка полей и история, что у экранов, D-260) и
//!   пишет строку в ленту — всё одной транзакцией;
//! - строка ленты — «кто · что · почему · цена» и точное «было → стало» по
//!   каждому объекту ([`timeline`]). Таблицы только дописываются;
//! - **откат** — новое обратное действие, его тоже можно откатить
//!   ([`revert`]). Если объект после агента меняли, откат не затирает молча,
//!   а возвращает три значения (было, сделал агент, сейчас);
//! - **пакет** — шаги одного решения агента, откатываются одной кнопкой;
//! - **исправить** — твоя правка результата, помеченная как поправка.
//!
//! Агенту нужен грант на модуль `agent`; без него инструменты отказывают,
//! а Qubite работает как обычный планер. Решения — D-300…D-309.

pub mod brain;
pub mod chat;
pub mod digest;
pub mod english;
pub mod files;
pub mod free;
pub mod memory;
pub mod proactive;
pub mod questions;
pub mod revert;
pub mod skills;
pub mod timeline;
pub mod tools;
pub mod triage;
pub mod why;

use qubite_policy::{DenyReason, Flags, ModuleId, Subject};
use serde::{Deserialize, Serialize};
use sqlx::PgPool;
use uuid::Uuid;

pub use revert::{Conflict, RevertOutcome, revert_action, revert_batch};
pub use timeline::{Action, ActionState, Change, Feed, FieldChange, Page};
pub use tools::{Outcome, call, fix};

/// Модуль в каталоге: грант на него включает агента.
pub const MODULE: &str = "agent";
/// Как агент подписан в Policy Gate (`Subject::Delegated.via`).
pub const VIA: &str = "agent";

/// Кто сделал действие.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Actor {
    /// Агент в своём пробуждении.
    Agent,
    /// Ты сам: откат, исправление.
    Owner,
    /// Qubite (повторение, бот).
    System,
}

impl Actor {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Agent => "agent",
            Self::Owner => "owner",
            Self::System => "system",
        }
    }
}

impl std::str::FromStr for Actor {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, String> {
        match value {
            "agent" => Ok(Self::Agent),
            "owner" => Ok(Self::Owner),
            "system" => Ok(Self::System),
            other => Err(format!("неизвестный автор {other}")),
        }
    }
}

/// От чьего имени выполняется инструмент.
#[derive(Debug, Clone)]
pub struct Who {
    account: Uuid,
    actor: Actor,
    run: Option<Uuid>,
    session: Option<Uuid>,
    /// Вызов AI-шлюза, по которому агент действует (цена в ленте).
    ai_call: Option<Uuid>,
    /// Навык, по которому агент действует (в ленте; куратор видит, что им пользуются).
    skill: Option<Uuid>,
}

impl Who {
    /// Агент в пробуждении `run`.
    pub fn agent(run: &Run) -> Self {
        Self {
            account: run.account_id,
            actor: Actor::Agent,
            run: Some(run.id),
            session: None,
            ai_call: None,
            skill: None,
        }
    }

    /// Сам человек со своей сессией (откат, исправление).
    pub fn owner(account: Uuid, session: Option<Uuid>) -> Self {
        Self {
            account,
            actor: Actor::Owner,
            run: None,
            session,
            ai_call: None,
            skill: None,
        }
    }

    /// Qubite сам (куратор навыков): права — самого человека, в ленте — «Qubite».
    pub fn system(account: Uuid) -> Self {
        Self {
            account,
            actor: Actor::System,
            run: None,
            session: None,
            ai_call: None,
            skill: None,
        }
    }

    /// Действия по ответу модели: в ленте видна цена вызова.
    pub fn with_ai_call(mut self, call: Uuid) -> Self {
        self.ai_call = Some(call);
        self
    }

    /// Действие по навыку (`skill` — ID файла навыка).
    pub fn with_skill(mut self, skill: Uuid) -> Self {
        self.skill = Some(skill);
        self
    }

    pub fn account(&self) -> Uuid {
        self.account
    }

    pub fn actor(&self) -> Actor {
        self.actor
    }

    /// Субъект Policy Gate. Агент — делегат человека: права не больше его
    /// прав и не шире потолка — свои данные в Planner и Входящих (D-301).
    /// Owner Console, права, AI сверх этого — не его.
    pub fn subject(&self) -> Subject {
        match self.actor {
            Actor::Agent => Subject::Delegated {
                account_id: self.account,
                session_id: None,
                via: VIA.to_owned(),
                ceiling: agent_ceiling(),
            },
            Actor::Owner | Actor::System => Subject::account(self.account, self.session),
        }
    }

    /// «Устройство» для журнала операций синхронизации.
    fn device(&self) -> Uuid {
        self.run.or(self.session).unwrap_or(self.account)
    }
}

/// Потолок прав агента: читать и менять свои дела, проекты и Входящие.
pub fn agent_ceiling() -> Vec<(ModuleId, Flags)> {
    let read_write = Flags {
        read: true,
        write: true,
        manage: false,
        ai: false,
    };
    [MODULE, qubite_planner::MODULE, qubite_inbox::MODULE]
        .into_iter()
        .filter_map(|module| ModuleId::new(module).ok())
        .map(|module| (module, read_write))
        .collect()
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    /// Нет права (нет гранта `agent`, модуля, отозван доступ).
    #[error("{}", .0.message())]
    Denied(DenyReason),
    /// Объекта нет или он чужой.
    #[error("не найдено")]
    NotFound,
    #[error("{0}")]
    Invalid(String),
    /// Это агенту нельзя без «да» (Q-66): делает только человек.
    #[error("{0}")]
    NeedsOwner(String),
    /// Объект изменили в ту же секунду — повторить.
    #[error("объект только что изменили, повторите")]
    Busy,
    /// Действие уже откачено (или откатывать нечего).
    #[error("{0}")]
    NotRevertible(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка прав: {0}")]
    Policy(qubite_policy::Error),
    #[error("ошибка объектов: {0}")]
    Objects(#[from] qubite_objects::Error),
    #[error("ошибка синхронизации: {0}")]
    Sync(#[from] qubite_sync_server::Error),
    #[error("повреждена запись ленты: {0}")]
    Corrupt(#[from] serde_json::Error),
}

impl From<qubite_policy::Error> for Error {
    fn from(error: qubite_policy::Error) -> Self {
        match error {
            qubite_policy::Error::Denied(reason) => Self::Denied(reason),
            other => Self::Policy(other),
        }
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

// ---------------------------------------------------------------- пробуждения

/// Повод проснуться (AGENT §7.3). `manual` — запуск вручную (тест, команда).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    Inbox,
    Morning,
    Window,
    Due,
    Reply,
    Review,
    Manual,
}

impl Trigger {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Morning => "morning",
            Self::Window => "window",
            Self::Due => "due",
            Self::Reply => "reply",
            Self::Review => "review",
            Self::Manual => "manual",
        }
    }
}

/// Одно пробуждение агента.
#[derive(Debug, Clone)]
pub struct Run {
    pub id: Uuid,
    pub account_id: Uuid,
    pub trigger: Trigger,
}

/// Начать пробуждение. Без гранта `agent` (право `write`) агента нет.
pub async fn start_run(pool: &PgPool, account: Uuid, trigger: Trigger) -> Result<Run> {
    let probe = Who {
        account,
        actor: Actor::Agent,
        run: None,
        session: None,
        ai_call: None,
        skill: None,
    };
    let module = ModuleId::new(MODULE)?;
    qubite_policy::decide::<qubite_policy::Write>(pool, &probe.subject(), &module).await?;
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO agent_runs (id, account_id, trigger) VALUES ($1, $2, $3)")
        .bind(id)
        .bind(account)
        .bind(trigger.as_str())
        .execute(pool)
        .await?;
    Ok(Run {
        id,
        account_id: account,
        trigger,
    })
}

/// Закрыть пробуждение (один раз).
pub async fn finish_run(pool: &PgPool, run: &Run, ok: bool) -> Result<()> {
    sqlx::query(
        "UPDATE agent_runs SET finished_at = now(), status = $2 \
         WHERE id = $1 AND finished_at IS NULL",
    )
    .bind(run.id)
    .bind(if ok { "done" } else { "failed" })
    .execute(pool)
    .await?;
    Ok(())
}
