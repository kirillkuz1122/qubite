//! Policy Gate Qubite (ACC-001): единое решение «можно ли этому субъекту
//! сделать это действие в этом модуле».
//!
//! Главное правило — **по умолчанию запрещено**. Доступ даёт только живой
//! грант владельца (или статус owner), а модуль должен быть установлен,
//! включён и готов.
//!
//! Разрешение — это значение типа [`Authorized<A>`]. Создать его можно только
//! функцией [`decide`] (или [`decide_owner`]), поэтому код, который требует
//! `&Authorized<UseAi>` в аргументах, физически нельзя вызвать без проверки:
//! это ловит компилятор, а не ревью.
//!
//! Решение не кэшируется: каждый вызов читает базу, поэтому отзыв гранта или
//! сессии действует сразу. Долгоживущие вещи (WebSocket, фоновые задачи,
//! агенты) перед каждым шагом вызывают [`Authorized::recheck`] или
//! [`Authority::recheck`].

pub mod catalog;
pub mod grants;

use std::{fmt, marker::PhantomData};

use serde::{Deserialize, Serialize};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

pub use catalog::{CatalogEntry, Module, ModulePatch, ModuleStatus};
pub use grants::Grant;

// ---------------------------------------------------------------- модуль

/// Идентификатор модуля: `docs`, `planner`, `tournaments`…
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct ModuleId(String);

impl ModuleId {
    pub fn new(id: impl Into<String>) -> Result<Self, Error> {
        let id = id.into();
        let valid = !id.is_empty()
            && id.len() <= 64
            && id.starts_with(|c: char| c.is_ascii_lowercase())
            && id
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
        if valid {
            Ok(Self(id))
        } else {
            Err(Error::Invalid(format!("неверный ID модуля «{id}»")))
        }
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for ModuleId {
    type Error = Error;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<ModuleId> for String {
    fn from(value: ModuleId) -> Self {
        value.0
    }
}

impl fmt::Display for ModuleId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

// ---------------------------------------------------------------- действия

/// Что именно хотят сделать в модуле.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActionKind {
    Read,
    Write,
    Manage,
    Ai,
}

/// Действие-метка для [`Authorized`].
pub trait Action: Send + Sync + 'static {
    const KIND: ActionKind;
}

/// Видеть модуль и читать свои данные в нём.
#[derive(Debug, Clone, Copy)]
pub struct Read;
/// Создавать и менять.
#[derive(Debug, Clone, Copy)]
pub struct Write;
/// Раздел «Управление» модуля (например, турниры). Не даёт Owner Console.
#[derive(Debug, Clone, Copy)]
pub struct Manage;
/// Платный AI в модуле. Деньги дополнительно проверяет AI-шлюз (бюджет).
#[derive(Debug, Clone, Copy)]
pub struct UseAi;

impl Action for Read {
    const KIND: ActionKind = ActionKind::Read;
}
impl Action for Write {
    const KIND: ActionKind = ActionKind::Write;
}
impl Action for Manage {
    const KIND: ActionKind = ActionKind::Manage;
}
impl Action for UseAi {
    const KIND: ActionKind = ActionKind::Ai;
}

/// Набор прав в модуле.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
pub struct Flags {
    pub read: bool,
    pub write: bool,
    pub manage: bool,
    pub ai: bool,
}

impl Flags {
    pub const NONE: Self = Self {
        read: false,
        write: false,
        manage: false,
        ai: false,
    };
    pub const ALL: Self = Self {
        read: true,
        write: true,
        manage: true,
        ai: true,
    };

    /// Изменять, управлять или пользоваться AI без чтения нельзя — чтение добавляется.
    pub fn normalized(self) -> Self {
        Self {
            read: self.read || self.write || self.manage || self.ai,
            ..self
        }
    }

    pub fn allows(self, kind: ActionKind) -> bool {
        match kind {
            ActionKind::Read => self.read,
            ActionKind::Write => self.write,
            ActionKind::Manage => self.manage,
            ActionKind::Ai => self.ai,
        }
    }

    /// Пересечение: делегат не может больше, чем инициатор.
    pub fn intersect(self, other: Self) -> Self {
        Self {
            read: self.read && other.read,
            write: self.write && other.write,
            manage: self.manage && other.manage,
            ai: self.ai && other.ai,
        }
    }

    pub fn is_empty(self) -> bool {
        self == Self::NONE
    }
}

// ---------------------------------------------------------------- субъект

/// Кто действует.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Subject {
    /// Человек со своей сессией (или система от его имени без сессии,
    /// например фоновая задача — тогда `session_id` пустой).
    Account {
        account_id: Uuid,
        session_id: Option<Uuid>,
    },
    /// Агент, плагин, MCP, API-ключ от имени человека. Права — пересечение
    /// прав человека и потолка делегата (D-055, ACC-05).
    Delegated {
        account_id: Uuid,
        session_id: Option<Uuid>,
        /// `agent`, `plugin`, `mcp`, `api_key`.
        via: String,
        /// Потолок прав делегата по модулям; модуля нет в списке — нет прав.
        ceiling: Vec<(ModuleId, Flags)>,
    },
    /// Гость: публичная ссылка или аноним. Ничего платного и ничего в модулях.
    Guest,
}

impl Subject {
    pub fn account(account_id: Uuid, session_id: Option<Uuid>) -> Self {
        Self::Account {
            account_id,
            session_id,
        }
    }

    fn account_and_session(&self) -> Option<(Uuid, Option<Uuid>)> {
        match self {
            Self::Account {
                account_id,
                session_id,
            }
            | Self::Delegated {
                account_id,
                session_id,
                ..
            } => Some((*account_id, *session_id)),
            Self::Guest => None,
        }
    }

    fn ceiling(&self, module: &ModuleId) -> Option<Flags> {
        match self {
            Self::Delegated { ceiling, .. } => Some(
                ceiling
                    .iter()
                    .find(|(id, _)| id == module)
                    .map_or(Flags::NONE, |(_, flags)| *flags),
            ),
            _ => None,
        }
    }
}

// ---------------------------------------------------------------- отказ

/// Почему отказано. У каждой причины — код для программ и текст для человека.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DenyReason {
    /// Нет входа, сессия отозвана или истекла.
    Unauthenticated,
    /// Аккаунт заблокирован или не подтверждён.
    AccountInactive,
    /// Гостю модули недоступны.
    GuestNotAllowed,
    /// Нет такого модуля или он скрыт от этого пользователя (отвечаем 404).
    NotFound,
    /// Модуль виден с замком: доступ не выдан.
    ModuleNotGranted,
    /// Доступ выдан, но модуль ещё не готов («Готовится»).
    ModulePreparing,
    /// Модуль выключен владельцем («Временно недоступен»).
    ModuleDisabled,
    /// Модуль на техработах.
    ModuleMaintenance,
    /// В модуле можно меньше: например, только чтение.
    ActionNotGranted,
    /// AI в этом модуле не разрешён.
    AiNotGranted,
    /// Агенту, плагину или ключу это не разрешено, даже если человеку можно.
    DelegationLimited,
    /// На всей платформе техработы (owner проходит). Обрывает и открытые
    /// соединения, и фоновые задачи — как отзыв прав (D-216).
    PlatformMaintenance,
}

impl DenyReason {
    pub fn code(self) -> &'static str {
        match self {
            Self::Unauthenticated => "unauthenticated",
            Self::AccountInactive => "account_inactive",
            Self::GuestNotAllowed => "guest_not_allowed",
            Self::NotFound => "not_found",
            Self::ModuleNotGranted => "module_not_granted",
            Self::ModulePreparing => "module_preparing",
            Self::ModuleDisabled => "module_disabled",
            Self::ModuleMaintenance => "module_maintenance",
            Self::ActionNotGranted => "action_not_granted",
            Self::AiNotGranted => "ai_not_granted",
            Self::DelegationLimited => "delegation_limited",
            Self::PlatformMaintenance => "maintenance",
        }
    }

    pub fn message(self) -> &'static str {
        match self {
            Self::Unauthenticated => "Нужно войти в аккаунт",
            Self::AccountInactive => "Аккаунт заблокирован или не подтверждён",
            Self::GuestNotAllowed => "Гостям это недоступно",
            Self::NotFound => "Не найдено",
            Self::ModuleNotGranted => "Нет доступа к модулю. Доступ выдаёт владелец Qubite",
            Self::ModulePreparing => "Модуль готовится",
            Self::ModuleDisabled => "Модуль временно недоступен",
            Self::ModuleMaintenance => "В модуле идут технические работы",
            Self::ActionNotGranted => "В этом модуле у вас нет права на это действие",
            Self::AiNotGranted => "AI в этом модуле не разрешён. Доступ выдаёт владелец Qubite",
            Self::DelegationLimited => "Агенту или ключу это не разрешено",
            Self::PlatformMaintenance => "Qubite обновляется — скоро вернёмся",
        }
    }

    /// HTTP-статус: 401 без входа, 404 для скрытого, иначе 403.
    pub fn http_status(self) -> u16 {
        match self {
            Self::Unauthenticated => 401,
            Self::NotFound => 404,
            Self::PlatformMaintenance => 503,
            _ => 403,
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{}", .0.message())]
    Denied(DenyReason),
    #[error("неверные данные: {0}")]
    Invalid(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка аудита: {0}")]
    Audit(#[from] qubite_objects::Error),
}

impl From<DenyReason> for Error {
    fn from(reason: DenyReason) -> Self {
        Self::Denied(reason)
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

// ---------------------------------------------------------------- состояние модуля

/// Всё, что нужно для решения, одной строкой из базы.
#[derive(Debug, Clone, Default)]
pub struct Facts {
    pub account_status: Option<String>,
    pub is_owner: bool,
    pub session_ok: bool,
    /// `None` — модуля нет в каталоге.
    pub module: Option<ModuleState>,
    /// Живой грант; `None` — не выдан.
    pub grant: Option<Flags>,
    /// На платформе техработы (тумблер owner или `QUBITE_MAINTENANCE`).
    pub platform_maintenance: bool,
}

#[derive(Debug, Clone)]
pub struct ModuleState {
    pub installed: bool,
    pub state: String,
    pub readiness: String,
    pub visibility: String,
}

/// Чистая функция решения: те же правила для API, каталога, задач и тестов.
///
/// Порядок (AUTH_AND_PERMISSIONS §2): субъект → модуль виден → доступ выдан →
/// модуль работает → нужное действие → потолок делегата.
pub fn evaluate(
    facts: &Facts,
    delegated_ceiling: Option<Flags>,
    kind: ActionKind,
) -> Result<Flags, DenyReason> {
    match facts.account_status.as_deref() {
        None => return Err(DenyReason::Unauthenticated),
        Some("active") => {}
        Some(_) => return Err(DenyReason::AccountInactive),
    }
    if !facts.session_ok {
        return Err(DenyReason::Unauthenticated);
    }
    if facts.platform_maintenance && !facts.is_owner {
        return Err(DenyReason::PlatformMaintenance);
    }
    let Some(module) = &facts.module else {
        return Err(DenyReason::NotFound);
    };
    let owner = facts.is_owner;
    let granted = if owner {
        Flags::ALL
    } else {
        facts.grant.unwrap_or(Flags::NONE).normalized()
    };
    if !granted.read {
        return Err(if module.visibility == "hidden" {
            DenyReason::NotFound
        } else {
            DenyReason::ModuleNotGranted
        });
    }
    // Выключенный модуль выключен для всех; техработы и «готовится» owner проходит,
    // чтобы проверить модуль до открытия (D-175).
    if !module.installed {
        return Err(DenyReason::ModulePreparing);
    }
    match module.state.as_str() {
        "enabled" => {}
        "maintenance" if owner => {}
        "maintenance" => return Err(DenyReason::ModuleMaintenance),
        _ => return Err(DenyReason::ModuleDisabled),
    }
    if module.readiness == "planned" && !owner {
        return Err(DenyReason::ModulePreparing);
    }
    if !granted.allows(kind) {
        return Err(if kind == ActionKind::Ai {
            DenyReason::AiNotGranted
        } else {
            DenyReason::ActionNotGranted
        });
    }
    match delegated_ceiling {
        Some(ceiling) => {
            let effective = granted.intersect(ceiling.normalized());
            if effective.allows(kind) {
                Ok(effective)
            } else {
                Err(DenyReason::DelegationLimited)
            }
        }
        None => Ok(granted),
    }
}

#[derive(sqlx::FromRow)]
struct FactsRow {
    account_status: String,
    is_owner: bool,
    session_ok: bool,
    installed: Option<bool>,
    state: Option<String>,
    readiness: Option<String>,
    visibility: Option<String>,
    can_read: Option<bool>,
    can_write: Option<bool>,
    can_manage: Option<bool>,
    can_ai: Option<bool>,
    platform_maintenance: bool,
}

static MAINTENANCE_ENV: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Аварийный `QUBITE_MAINTENANCE=true`: сервер сообщает его при запуске, и
/// дальше решение о правах видит техработы и без строки в базе.
pub fn set_maintenance_from_env(on: bool) {
    MAINTENANCE_ENV.store(on, std::sync::atomic::Ordering::Relaxed);
}

fn maintenance_from_env() -> bool {
    MAINTENANCE_ENV.load(std::sync::atomic::Ordering::Relaxed)
}

const FACTS_SQL: &str = "\
SELECT a.status AS account_status,
       EXISTS (SELECT 1 FROM platform_owner o WHERE o.account_id = a.id) AS is_owner,
       ($3::uuid IS NULL OR EXISTS (
            SELECT 1 FROM sessions s WHERE s.id = $3 AND s.account_id = a.id
               AND s.revoked_at IS NULL AND ($4 OR s.expires_at > now()))) AS session_ok,
       m.installed, m.state, m.readiness, m.visibility,
       g.can_read, g.can_write, g.can_manage, g.can_ai,
       ($5 OR coalesce((SELECT s.value = 'true'::jsonb FROM platform_settings s
                        WHERE s.key = 'maintenance.enabled'), false)) AS platform_maintenance
FROM accounts a
LEFT JOIN modules m ON m.id = $2
LEFT JOIN module_grants g ON g.account_id = a.id AND g.module_id = m.id AND g.revoked_at IS NULL
WHERE a.id = $1";

async fn load_facts(
    conn: &mut PgConnection,
    account_id: Uuid,
    session_id: Option<Uuid>,
    module: &ModuleId,
    session_rule: SessionRule,
) -> Result<Facts> {
    let row: Option<FactsRow> = sqlx::query_as(FACTS_SQL)
        .bind(account_id)
        .bind(module.as_str())
        .bind(session_id)
        .bind(session_rule == SessionRule::NotRevoked)
        .bind(maintenance_from_env())
        .fetch_optional(conn)
        .await?;
    Ok(row.map_or_else(Facts::default, |row| Facts {
        account_status: Some(row.account_status),
        is_owner: row.is_owner,
        session_ok: row.session_ok,
        module: row.installed.map(|installed| ModuleState {
            installed,
            state: row.state.unwrap_or_default(),
            readiness: row.readiness.unwrap_or_default(),
            visibility: row.visibility.unwrap_or_default(),
        }),
        grant: row.can_read.map(|read| Flags {
            read,
            write: row.can_write.unwrap_or(false),
            manage: row.can_manage.unwrap_or(false),
            ai: row.can_ai.unwrap_or(false),
        }),
        platform_maintenance: row.platform_maintenance,
    }))
}

// ---------------------------------------------------------------- разрешение

/// Доказательство, что проверка пройдена: субъекту можно действие `A` в модуле.
/// Создаётся только в этом crate'е.
#[derive(Debug, Clone)]
pub struct Authorized<A: Action> {
    subject: Subject,
    account_id: Uuid,
    module: ModuleId,
    flags: Flags,
    is_owner: bool,
    _action: PhantomData<A>,
}

impl<A: Action> Authorized<A> {
    pub fn subject(&self) -> &Subject {
        &self.subject
    }
    pub fn account_id(&self) -> Uuid {
        self.account_id
    }
    pub fn module(&self) -> &ModuleId {
        &self.module
    }
    /// Все права субъекта в модуле (с учётом потолка делегата).
    pub fn flags(&self) -> Flags {
        self.flags
    }
    pub fn is_owner(&self) -> bool {
        self.is_owner
    }

    /// Проверить заново (перед каждым сообщением WebSocket, шагом агента,
    /// повтором запроса): отзыв гранта или сессии действует сразу.
    pub async fn recheck(&self, pool: &PgPool) -> Result<Self> {
        decide::<A>(pool, &self.subject, &self.module).await
    }

    /// Что сохранить в фоновой задаче, чтобы обработчик проверил права заново.
    pub fn authority(&self) -> Authority {
        Authority {
            subject: self.subject.clone(),
            module: self.module.clone(),
            action: A::KIND,
        }
    }
}

/// Как проверять сессию субъекта.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionRule {
    /// Сессия жива: не отозвана и не истекла (запросы, соединения).
    Alive,
    /// Сессия не отозвана; истечь ей можно (фоновые задачи).
    NotRevoked,
}

/// Права, сохранённые в задаче (JSON). Это не разрешение — только «от чьего
/// имени и что»; обработчик обязан вызвать [`Authority::recheck`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Authority {
    pub subject: Subject,
    pub module: ModuleId,
    pub action: ActionKind,
}

impl Authority {
    /// Проверить права заново. Задача может жить дольше сессии: истёкшая
    /// сессия задачу не останавливает. А **отозванная** (выход, «выйти везде»,
    /// закрытие из списка, смена пароля) — останавливает, как и отзыв гранта
    /// и блокировка аккаунта (AUTH_AND_PERMISSIONS §6 №6, D-179). Задачи без
    /// сессии (`session_id: None`) — от имени аккаунта, их сессия не касается.
    pub async fn recheck<A: Action>(&self, pool: &PgPool) -> Result<Authorized<A>> {
        if self.action != A::KIND {
            return Err(Error::Invalid(format!(
                "в задаче сохранено действие {:?}, а проверяется {:?}",
                self.action,
                A::KIND
            )));
        }
        let mut conn = pool.acquire().await?;
        decide_with::<A>(
            &mut conn,
            &self.subject,
            &self.module,
            SessionRule::NotRevoked,
        )
        .await
    }
}

/// Главная функция: можно ли `subject` сделать `A` в `module`.
pub async fn decide<A: Action>(
    pool: &PgPool,
    subject: &Subject,
    module: &ModuleId,
) -> Result<Authorized<A>> {
    let mut conn = pool.acquire().await?;
    decide_in::<A>(&mut conn, subject, module).await
}

/// То же внутри своей транзакции.
pub async fn decide_in<A: Action>(
    conn: &mut PgConnection,
    subject: &Subject,
    module: &ModuleId,
) -> Result<Authorized<A>> {
    decide_with::<A>(conn, subject, module, SessionRule::Alive).await
}

async fn decide_with<A: Action>(
    conn: &mut PgConnection,
    subject: &Subject,
    module: &ModuleId,
    session_rule: SessionRule,
) -> Result<Authorized<A>> {
    let Some((account_id, session_id)) = subject.account_and_session() else {
        return Err(DenyReason::GuestNotAllowed.into());
    };
    let facts = load_facts(conn, account_id, session_id, module, session_rule).await?;
    let flags = evaluate(&facts, subject.ceiling(module), A::KIND)?;
    Ok(Authorized {
        subject: subject.clone(),
        account_id,
        module: module.clone(),
        flags,
        is_owner: facts.is_owner,
        _action: PhantomData,
    })
}

// ---------------------------------------------------------------- owner

/// Доказательство, что действует owner платформы лично (Owner Console).
#[derive(Debug, Clone)]
pub struct OwnerConsole {
    account_id: Uuid,
}

impl OwnerConsole {
    pub fn account_id(&self) -> Uuid {
        self.account_id
    }
}

/// Owner Console — только owner лично, через живую сессию. Агенты, плагины,
/// ключи и гости её не получают никогда. Для всех остальных — `NotFound`
/// (раздел не должен даже обнаруживаться).
pub async fn decide_owner(pool: &PgPool, subject: &Subject) -> Result<OwnerConsole> {
    let Subject::Account {
        account_id,
        session_id,
    } = subject
    else {
        return Err(DenyReason::NotFound.into());
    };
    let allowed: bool = sqlx::query_scalar(
        "SELECT EXISTS (
             SELECT 1 FROM accounts a JOIN platform_owner o ON o.account_id = a.id
             WHERE a.id = $1 AND a.status = 'active'
               AND ($2::uuid IS NULL OR EXISTS (
                    SELECT 1 FROM sessions s WHERE s.id = $2 AND s.account_id = a.id
                      AND s.revoked_at IS NULL AND s.expires_at > now())))",
    )
    .bind(account_id)
    .bind(session_id)
    .fetch_one(pool)
    .await?;
    if allowed {
        Ok(OwnerConsole {
            account_id: *account_id,
        })
    } else {
        Err(DenyReason::NotFound.into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(grant: Option<Flags>) -> Facts {
        Facts {
            account_status: Some("active".into()),
            is_owner: false,
            session_ok: true,
            module: Some(ModuleState {
                installed: true,
                state: "enabled".into(),
                readiness: "stable".into(),
                visibility: "locked".into(),
            }),
            grant,
            platform_maintenance: false,
        }
    }

    #[test]
    fn default_is_deny() {
        assert_eq!(
            evaluate(&facts(None), None, ActionKind::Read),
            Err(DenyReason::ModuleNotGranted)
        );
        let mut hidden = facts(None);
        hidden.module.as_mut().unwrap().visibility = "hidden".into();
        assert_eq!(
            evaluate(&hidden, None, ActionKind::Read),
            Err(DenyReason::NotFound)
        );
    }

    #[test]
    fn grants_are_separate() {
        let read_only = Flags {
            read: true,
            ..Flags::NONE
        };
        let f = facts(Some(read_only));
        assert!(evaluate(&f, None, ActionKind::Read).is_ok());
        assert_eq!(
            evaluate(&f, None, ActionKind::Write),
            Err(DenyReason::ActionNotGranted)
        );
        assert_eq!(
            evaluate(&f, None, ActionKind::Ai),
            Err(DenyReason::AiNotGranted)
        );
    }

    #[test]
    fn delegation_is_intersection() {
        let f = facts(Some(Flags {
            read: true,
            write: true,
            ..Flags::NONE
        }));
        // Потолок агента шире прав человека — всё равно не больше человека.
        assert_eq!(
            evaluate(&f, Some(Flags::ALL), ActionKind::Ai),
            Err(DenyReason::AiNotGranted)
        );
        // Потолок уже прав человека — сужает.
        let read_ceiling = Flags {
            read: true,
            ..Flags::NONE
        };
        assert_eq!(
            evaluate(&f, Some(read_ceiling), ActionKind::Write),
            Err(DenyReason::DelegationLimited)
        );
        assert!(evaluate(&f, Some(read_ceiling), ActionKind::Read).is_ok());
    }

    #[test]
    fn module_state_matters_even_with_grant() {
        let mut f = facts(Some(Flags::ALL));
        f.module.as_mut().unwrap().readiness = "planned".into();
        assert_eq!(
            evaluate(&f, None, ActionKind::Read),
            Err(DenyReason::ModulePreparing)
        );
        f.is_owner = true;
        assert!(
            evaluate(&f, None, ActionKind::Read).is_ok(),
            "owner видит готовящийся"
        );
        f.module.as_mut().unwrap().state = "disabled".into();
        assert_eq!(
            evaluate(&f, None, ActionKind::Read),
            Err(DenyReason::ModuleDisabled)
        );
    }

    #[test]
    fn module_ids_are_checked() {
        assert!(ModuleId::new("docs").is_ok());
        assert!(ModuleId::new("Docs").is_err());
        assert!(ModuleId::new("../x").is_err());
        assert!(ModuleId::new("").is_err());
    }
}
