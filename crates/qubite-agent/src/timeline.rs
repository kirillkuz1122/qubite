//! Лента «Что сделал агент»: запись действия вместе с изменением и чтение.
//!
//! Действие пишется в той же транзакции, что и изменение данных: не бывает
//! изменения без строки в ленте и строки без изменения. «Было → стало» —
//! снимки объекта до и после (как в синхронизации: заголовок, корзина, поля
//! модуля, версия). Откачено ли действие, не хранится, а считается по
//! ссылкам `reverts` (D-303): таблицы только дописываются.

use std::collections::{HashMap, HashSet};

use qubite_objects::objects;
use qubite_policy::{ModuleId, Read, Write};
use qubite_sync::{ObjectSnapshot, OpKind, OpResult, Operation, RejectReason};
use qubite_sync_server::{Registry, Rules, module_of};
use serde::Serialize;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Actor, Error, MODULE, Result, Who};

/// Сколько действий за раз отдаёт лента.
pub const MAX_PAGE: i64 = 100;
const MAX_SUMMARY_CHARS: usize = 500;
const MAX_REASON_CHARS: usize = 1000;

/// Типы, которые агент меняет (поля — как у экранов).
pub fn registry() -> Registry {
    Registry::default()
        .with(qubite_inbox::InboxFields)
        .with(qubite_planner::ProjectFieldsHandler)
        .with(qubite_planner::TaskFieldsHandler)
        .with(crate::files::FileFieldsHandler)
        .with(crate::questions::QuestionFieldsHandler)
        .with(crate::english::EnglishOpFieldsHandler)
}

/// Поля, которые откат возвращает (остальные — производные: время
/// выполнения, серия повторений, разбор Входящих).
pub fn revertable_fields(object_type: &str) -> &'static [&'static str] {
    match object_type {
        qubite_planner::TASK_TYPE => &[
            "notes",
            "status",
            "priority",
            "due_date",
            "due_time",
            "duration_minutes",
            "duration_by",
            "subtasks",
            "recurrence",
            "project_id",
        ],
        qubite_planner::PROJECT_TYPE => &["color", "tag", "status", "notes"],
        crate::opportunities::TYPE => crate::opportunities::FIELDS,
        qubite_inbox::ITEM_TYPE => &["status", "body"],
        crate::files::FILE_TYPE => &["body", "pinned", "archived"],
        crate::questions::QUESTION_TYPE => &["status", "answer"],
        _ => &[],
    }
}

// ---------------------------------------------------------------- что видно

/// Одно действие в ленте.
#[derive(Debug, Clone, Serialize)]
pub struct Action {
    pub id: Uuid,
    /// Порядок ленты (и курсор «ещё»).
    pub seq: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub actor: Actor,
    pub run_id: Option<Uuid>,
    /// Шаги одного решения — откатываются вместе.
    pub batch_id: Uuid,
    pub skill_id: Option<Uuid>,
    /// Инструмент: `task.create`, `inbox.file`, `timeline.revert`, …
    pub tool: String,
    /// Что сделано — фраза.
    pub summary: String,
    /// Почему.
    pub reason: Option<String>,
    /// Это откат действия …
    pub reverts: Option<Uuid>,
    /// … или поправка к действию.
    pub corrects: Option<Uuid>,
    /// Цена вызова AI, миллионные доли доллара (как в AI-шлюзе).
    pub cost_usd_micros: Option<i64>,
    pub changes: Vec<Change>,
    pub state: ActionState,
}

/// Что с действием сейчас.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ActionState {
    /// Действие откатили (и этот откат не откатили обратно).
    pub reverted_by: Option<Uuid>,
    /// Поправки владельца к этому действию.
    pub corrected_by: Vec<Uuid>,
    /// Шагов в пакете (1 — одиночное действие).
    pub batch_size: i64,
    /// У отката действия агента — вопрос «почему откатил» и ответ (D-397).
    pub why: Option<crate::why::Why>,
}

/// «Было → стало» по одному объекту.
#[derive(Debug, Clone, Serialize)]
pub struct Change {
    pub object_id: Uuid,
    /// `planner.task`, `planner.project`, `inbox.item`.
    pub object_type: String,
    /// Название после действия.
    pub title: String,
    /// Объект создан этим действием.
    pub created: bool,
    /// Только то, что поменялось (для показа и отката).
    pub diff: Vec<FieldChange>,
}

/// Одно поле: было и стало (`null` — пусто или не было).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FieldChange {
    /// `title`, `deleted` или поле модуля (`due_date`, `project_id`, …).
    pub field: String,
    pub before: Value,
    pub after: Value,
}

/// Значение «аспекта» снимка: заголовок, корзина или поле модуля.
pub(crate) fn aspect(snapshot: &ObjectSnapshot, field: &str) -> Value {
    match field {
        "title" => Value::String(snapshot.title.clone()),
        "deleted" => Value::Bool(snapshot.deleted),
        other => snapshot
            .fields
            .as_ref()
            .and_then(|fields| fields.get(other))
            .cloned()
            .unwrap_or(Value::Null),
    }
}

/// Аспекты, которые видны в ленте и возвращаются откатом.
pub(crate) fn aspects(object_type: &str) -> impl Iterator<Item = &'static str> {
    ["title", "deleted"]
        .into_iter()
        .chain(revertable_fields(object_type).iter().copied())
}

fn is_empty(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(false) => true,
        Value::String(text) => text.is_empty(),
        Value::Array(items) => items.is_empty(),
        _ => false,
    }
}

fn diff(
    object_type: &str,
    before: Option<&ObjectSnapshot>,
    after: &ObjectSnapshot,
) -> Vec<FieldChange> {
    aspects(object_type)
        .filter_map(|field| {
            let new = aspect(after, field);
            let old = before.map_or(Value::Null, |before| aspect(before, field));
            let changed = match before {
                Some(_) => old != new,
                // Новый объект: показываем только заполненное.
                None => field != "deleted" && !is_empty(&new),
            };
            changed.then(|| FieldChange {
                field: field.to_owned(),
                before: old,
                after: new,
            })
        })
        .collect()
}

// ---------------------------------------------------------------- запись

/// Один шаг действия — одна операция синхронизации.
#[derive(Debug, Clone)]
pub(crate) struct Step {
    pub object_id: Uuid,
    pub kind: OpKind,
}

/// Что записать: шаги и строка ленты.
#[derive(Debug, Clone)]
pub(crate) struct Plan {
    pub tool: String,
    pub summary: String,
    pub reason: Option<String>,
    pub batch: Uuid,
    pub reverts: Option<Uuid>,
    pub corrects: Option<Uuid>,
    pub steps: Vec<Step>,
}

/// Снимок своего объекта (чужой и несуществующий — `None`).
pub(crate) async fn snapshot(
    conn: &mut PgConnection,
    account: Uuid,
    id: Uuid,
) -> Result<Option<ObjectSnapshot>> {
    let Some(object) = objects::get_any(conn, id).await? else {
        return Ok(None);
    };
    if object.owner_id != account {
        return Ok(None);
    }
    Ok(Some(
        qubite_sync_server::snapshot_with(conn, &registry(), &object).await?,
    ))
}

/// Только один писатель ленты на человека за раз: откат не пересечётся с
/// другим откатом того же действия.
pub(crate) async fn lock(conn: &mut PgConnection, account: Uuid) -> Result<()> {
    sqlx::query("SELECT pg_advisory_xact_lock(hashtextextended('qubite.agent:' || $1::text, 0))")
        .bind(account)
        .execute(conn)
        .await?;
    Ok(())
}

/// Можно ли этому «кто» пользоваться лентой: агенту — право `write` в
/// модуле `agent`, человеку — хотя бы `read`.
pub(crate) async fn check_agent(conn: &mut PgConnection, who: &Who) -> Result<()> {
    let module = ModuleId::new(MODULE)?;
    let subject = who.subject();
    match who.actor() {
        Actor::Agent => {
            qubite_policy::decide_in::<Write>(conn, &subject, &module).await?;
        }
        Actor::Owner | Actor::System => {
            qubite_policy::decide_in::<Read>(conn, &subject, &module).await?;
        }
    }
    Ok(())
}

/// Модуль шага: у нового объекта — по типу, у существующего — его модуль.
async fn module_of_step(conn: &mut PgConnection, account: Uuid, step: &Step) -> Result<String> {
    if let OpKind::Create { object_type, .. } = &step.kind {
        return Ok(if object_type == crate::opportunities::TYPE {
            MODULE.to_owned()
        } else {
            module_of(object_type).to_owned()
        });
    }
    match objects::get_any(conn, step.object_id).await? {
        Some(object) if object.owner_id == account => Ok(object.module_id),
        _ => Err(Error::NotFound),
    }
}

fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

fn project_ids(snapshot: Option<&ObjectSnapshot>) -> Option<Uuid> {
    let snapshot = snapshot?;
    if snapshot.object_type == qubite_planner::PROJECT_TYPE {
        return Some(snapshot.id);
    }
    snapshot
        .fields
        .as_ref()?
        .get("project_id")?
        .as_str()?
        .parse()
        .ok()
}

/// Выполнить шаги и записать действие — в транзакции вызывающего (он и
/// закрепляет её). Права проверяются здесь: модуль `agent` и `write` в
/// модуле каждого шага. Ошибка любого шага — ошибка всего действия.
pub(crate) async fn execute_in(conn: &mut PgConnection, who: &Who, plan: Plan) -> Result<Action> {
    let account = who.account();
    check_agent(conn, who).await?;
    let subject = who.subject();
    let mut writable = HashSet::new();
    for step in &plan.steps {
        let module = module_of_step(conn, account, step).await?;
        if writable.insert(module.clone()) {
            qubite_policy::decide_in::<Write>(conn, &subject, &ModuleId::new(module)?).await?;
        }
    }
    let rules = Rules {
        registry: registry(),
        strict: true,
        writable: Some(writable),
        readable: None,
    };

    // Порядок объектов — как в шагах; «было» — до первого шага, «стало» — после последнего.
    let mut order: Vec<Uuid> = Vec::new();
    let mut before: HashMap<Uuid, Option<ObjectSnapshot>> = HashMap::new();
    let mut after: HashMap<Uuid, ObjectSnapshot> = HashMap::new();
    for step in plan.steps {
        if let OpKind::Create {
            object_type,
            fields,
            ..
        } = &step.kind
            && object_type == crate::opportunities::TYPE
        {
            let target: ObjectSnapshot = serde_json::from_value(
                fields
                    .clone()
                    .ok_or_else(|| Error::Invalid("нет снимка мероприятия".into()))?,
            )?;
            let mut current = crate::opportunities::snapshot(conn, account, step.object_id).await?;
            if current.is_none() {
                // Удалённая ручная запись имеет снимок с deleted=true в
                // ленте. Он нужен для отката отката, когда строки уже нет.
                let previous: Option<Value> = sqlx::query_scalar(
                    "SELECT ch.after FROM agent_action_changes ch \
                     JOIN agent_actions a ON a.id = ch.action_id \
                     WHERE a.account_id = $1 AND ch.object_id = $2 AND ch.object_type = $3 \
                     ORDER BY ch.id DESC LIMIT 1",
                )
                .bind(account)
                .bind(step.object_id)
                .bind(crate::opportunities::TYPE)
                .fetch_optional(&mut *conn)
                .await?;
                current = previous
                    .map(stored)
                    .transpose()?
                    .filter(|snapshot| snapshot.deleted);
            }
            if let std::collections::hash_map::Entry::Vacant(first) = before.entry(step.object_id) {
                order.push(step.object_id);
                first.insert(current.clone());
            }
            crate::opportunities::apply(
                conn,
                account,
                &target,
                current.as_ref().is_some_and(|value| !value.deleted),
            )
            .await?;
            let now = crate::opportunities::snapshot(conn, account, step.object_id)
                .await?
                .unwrap_or(target);
            after.insert(step.object_id, now);
            continue;
        }
        let current = snapshot(conn, account, step.object_id).await?;
        // Длительность человека агент не меняет. Проверка здесь, в транзакции
        // под замком аккаунта, поэтому не гоняется с правкой человека.
        if who.actor() == Actor::Agent
            && let (Some(snap), OpKind::Patch { fields }) = (&current, &step.kind)
            && snap.object_type == qubite_planner::TASK_TYPE
            && (fields.get("duration_minutes").is_some() || fields.get("duration_by").is_some())
            && aspect(snap, "duration_by") == "owner"
        {
            return Err(Error::NeedsOwner(
                "длительность человека агент не меняет".into(),
            ));
        }
        if let std::collections::hash_map::Entry::Vacant(first) = before.entry(step.object_id) {
            order.push(step.object_id);
            first.insert(current.clone());
        }
        let op = Operation {
            op_id: Uuid::now_v7(),
            object_id: step.object_id,
            base_revision: current.as_ref().map(|snapshot| snapshot.revision),
            kind: step.kind,
        };
        match qubite_sync_server::apply_in(conn, account, who.device(), &op, &rules).await? {
            OpResult::Applied { .. } => {}
            OpResult::Conflict { .. } => return Err(Error::Busy),
            OpResult::Rejected {
                reason, message, ..
            } => {
                return Err(match reason {
                    RejectReason::NotFound => Error::NotFound,
                    RejectReason::Forbidden => {
                        Error::Denied(qubite_policy::DenyReason::ActionNotGranted)
                    }
                    RejectReason::Invalid => Error::Invalid(message),
                });
            }
        }
        let now = snapshot(conn, account, step.object_id)
            .await?
            .ok_or(Error::NotFound)?;
        after.insert(step.object_id, now);
    }

    let id = Uuid::now_v7();
    let summary = truncate(plan.summary.trim(), MAX_SUMMARY_CHARS);
    let reason = plan
        .reason
        .as_deref()
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .map(|reason| truncate(reason, MAX_REASON_CHARS));
    let (seq, at): (i64, OffsetDateTime) = sqlx::query_as(
        "INSERT INTO agent_actions (id, account_id, run_id, batch_id, actor, tool, summary, \
         reason, reverts, corrects, ai_call_id, skill_id) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) \
         RETURNING seq, at",
    )
    .bind(id)
    .bind(account)
    .bind(who.run)
    .bind(plan.batch)
    .bind(who.actor().as_str())
    .bind(&plan.tool)
    .bind(if summary.is_empty() {
        plan.tool.clone()
    } else {
        summary.clone()
    })
    .bind(&reason)
    .bind(plan.reverts)
    .bind(plan.corrects)
    .bind(who.ai_call)
    .bind(who.skill)
    .fetch_one(&mut *conn)
    .await?;
    if let Some(skill) = who.skill {
        crate::skills::mark_used(conn, account, skill).await?;
    }

    let mut changes = Vec::with_capacity(order.len());
    for object_id in order {
        let old = before.remove(&object_id).flatten();
        let Some(new) = after.remove(&object_id) else {
            continue;
        };
        let projects: Vec<Uuid> = {
            let mut ids: Vec<Uuid> = [project_ids(old.as_ref()), project_ids(Some(&new))]
                .into_iter()
                .flatten()
                .collect();
            ids.dedup();
            ids
        };
        sqlx::query(
            "INSERT INTO agent_action_changes (action_id, object_id, object_type, before, after, \
             project_ids) VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(id)
        .bind(object_id)
        .bind(&new.object_type)
        .bind(old.as_ref().map(serde_json::to_value).transpose()?)
        .bind(serde_json::to_value(&new)?)
        .bind(&projects)
        .execute(&mut *conn)
        .await?;
        changes.push(Change {
            object_id,
            object_type: new.object_type.clone(),
            title: new.title.clone(),
            created: old.is_none(),
            diff: diff(&new.object_type, old.as_ref(), &new),
        });
    }

    let batch_size: i64 =
        sqlx::query_scalar("SELECT count(*) FROM agent_actions WHERE batch_id = $1")
            .bind(plan.batch)
            .fetch_one(&mut *conn)
            .await?;
    Ok(Action {
        id,
        seq,
        at,
        actor: who.actor(),
        run_id: who.run,
        batch_id: plan.batch,
        skill_id: who.skill,
        tool: plan.tool,
        summary,
        reason,
        reverts: plan.reverts,
        corrects: plan.corrects,
        cost_usd_micros: match who.ai_call {
            Some(call) => sqlx::query_scalar("SELECT actual_usd FROM ai_calls WHERE id = $1")
                .bind(call)
                .fetch_optional(&mut *conn)
                .await?
                .flatten(),
            None => None,
        },
        changes,
        state: ActionState {
            batch_size,
            ..ActionState::default()
        },
    })
}

/// Выполнить план своей транзакцией.
pub(crate) async fn execute(pool: &PgPool, who: &Who, plan: Plan) -> Result<Action> {
    let mut tx = pool.begin().await?;
    lock(&mut tx, who.account()).await?;
    let action = execute_in(&mut tx, who, plan).await?;
    tx.commit().await?;
    Ok(action)
}

// ---------------------------------------------------------------- чтение

/// Какая часть ленты.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Feed {
    /// Вся лента человека.
    All,
    /// У одного объекта (дело, мысль).
    Object(Uuid),
    /// У проекта: сам проект и дела, которые были или стали в нём.
    Project(Uuid),
    /// Шаги одного пакета.
    Batch(Uuid),
}

/// Страница ленты: новые сверху.
#[derive(Debug, Clone, Serialize)]
pub struct Page {
    pub items: Vec<Action>,
    /// Курсор «ещё» (`before`); нет — дальше пусто.
    pub next: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct ActionRow {
    seq: i64,
    id: Uuid,
    run_id: Option<Uuid>,
    batch_id: Uuid,
    actor: String,
    skill_id: Option<Uuid>,
    tool: String,
    summary: String,
    reason: Option<String>,
    reverts: Option<Uuid>,
    corrects: Option<Uuid>,
    at: OffsetDateTime,
    cost: Option<i64>,
}

#[derive(sqlx::FromRow)]
struct ChangeRow {
    action_id: Uuid,
    object_id: Uuid,
    object_type: String,
    before: Option<Value>,
    after: Value,
}

/// Снимок из строки ленты (`before` / `after`).
pub(crate) fn stored(value: Value) -> Result<ObjectSnapshot> {
    Ok(serde_json::from_value(value)?)
}

/// Связи откатов и поправок одного человека (их немного: только откаты).
pub(crate) struct Links {
    /// Действие → откаты его, новые первыми.
    reverted: HashMap<Uuid, Vec<Uuid>>,
    corrected: HashMap<Uuid, Vec<Uuid>>,
}

impl Links {
    pub(crate) async fn load(conn: &mut PgConnection, account: Uuid) -> Result<Self> {
        let rows: Vec<(Uuid, Option<Uuid>, Option<Uuid>)> = sqlx::query_as(
            "SELECT id, reverts, corrects FROM agent_actions \
             WHERE account_id = $1 AND (reverts IS NOT NULL OR corrects IS NOT NULL) \
             ORDER BY seq DESC",
        )
        .bind(account)
        .fetch_all(conn)
        .await?;
        let mut links = Self {
            reverted: HashMap::new(),
            corrected: HashMap::new(),
        };
        for (id, reverts, corrects) in rows {
            if let Some(target) = reverts {
                links.reverted.entry(target).or_default().push(id);
            }
            if let Some(target) = corrects {
                links.corrected.entry(target).or_default().push(id);
            }
        }
        Ok(links)
    }

    /// Действующий откат действия: самый новый откат, который сам не откачен.
    pub(crate) fn reverted_by(&self, id: Uuid) -> Option<Uuid> {
        self.reverted_by_depth(id, 0)
    }

    fn reverted_by_depth(&self, id: Uuid, depth: usize) -> Option<Uuid> {
        // Цепочка «откат отката» конечна (ссылки только на старые строки);
        // предел — защита от повреждённых данных.
        if depth > 1000 {
            return None;
        }
        self.reverted
            .get(&id)?
            .iter()
            .copied()
            .find(|revert| self.reverted_by_depth(*revert, depth + 1).is_none())
    }

    fn corrected_by(&self, id: Uuid) -> Vec<Uuid> {
        let mut ids = self.corrected.get(&id).cloned().unwrap_or_default();
        ids.reverse();
        ids
    }
}

/// Действия по ID (свои), в порядке ленты — новые сверху.
pub(crate) async fn load_actions(
    conn: &mut PgConnection,
    account: Uuid,
    rows: Vec<ActionRowRef>,
) -> Result<Vec<Action>> {
    let rows: Vec<ActionRow> = rows.into_iter().map(|row| row.0).collect();
    let ids: Vec<Uuid> = rows.iter().map(|row| row.id).collect();
    let change_rows: Vec<ChangeRow> = sqlx::query_as(
        "SELECT action_id, object_id, object_type, before, after FROM agent_action_changes \
         WHERE action_id = ANY($1) ORDER BY id",
    )
    .bind(&ids)
    .fetch_all(&mut *conn)
    .await?;
    let batches: Vec<Uuid> = rows.iter().map(|row| row.batch_id).collect();
    let sizes: Vec<(Uuid, i64)> = sqlx::query_as(
        "SELECT batch_id, count(*) FROM agent_actions WHERE batch_id = ANY($1) GROUP BY batch_id",
    )
    .bind(&batches)
    .fetch_all(&mut *conn)
    .await?;
    let sizes: HashMap<Uuid, i64> = sizes.into_iter().collect();
    let links = Links::load(conn, account).await?;
    let whys = crate::why::load(conn, &batches).await?;

    let mut changes: HashMap<Uuid, Vec<Change>> = HashMap::new();
    for row in change_rows {
        let after = stored(row.after)?;
        let before = row.before.map(stored).transpose()?;
        changes.entry(row.action_id).or_default().push(Change {
            object_id: row.object_id,
            title: after.title.clone(),
            created: before.is_none(),
            diff: diff(&row.object_type, before.as_ref(), &after),
            object_type: row.object_type,
        });
    }
    rows.into_iter()
        .map(|row| {
            Ok(Action {
                id: row.id,
                seq: row.seq,
                at: row.at,
                actor: row.actor.parse().map_err(Error::Invalid)?,
                run_id: row.run_id,
                batch_id: row.batch_id,
                skill_id: row.skill_id,
                tool: row.tool,
                summary: row.summary,
                reason: row.reason,
                reverts: row.reverts,
                corrects: row.corrects,
                cost_usd_micros: row.cost,
                changes: changes.remove(&row.id).unwrap_or_default(),
                state: ActionState {
                    reverted_by: links.reverted_by(row.id),
                    corrected_by: links.corrected_by(row.id),
                    batch_size: sizes.get(&row.batch_id).copied().unwrap_or(1),
                    why: row.reverts.and_then(|_| whys.get(&row.batch_id).cloned()),
                },
            })
        })
        .collect()
}

/// Строка действия из базы (не видна снаружи).
pub(crate) struct ActionRowRef(ActionRow);

const ACTION_SELECT: &str = "SELECT a.seq, a.id, a.run_id, a.batch_id, a.actor, a.skill_id, \
     a.tool, a.summary, a.reason, a.reverts, a.corrects, a.at, c.actual_usd AS cost \
     FROM agent_actions a LEFT JOIN ai_calls c ON c.id = a.ai_call_id";

/// Строки действий человека по условию (`$1` — человек, `$2` — значение).
pub(crate) async fn rows_where(
    conn: &mut PgConnection,
    account: Uuid,
    condition: &str,
    value: Uuid,
) -> Result<Vec<ActionRowRef>> {
    // `condition` — только строки из этого файла, без внешнего ввода.
    let rows: Vec<ActionRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{ACTION_SELECT} WHERE a.account_id = $1 AND {condition} ORDER BY a.seq DESC"
    )))
    .bind(account)
    .bind(value)
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(ActionRowRef).collect())
}

/// Одно своё действие.
pub async fn get(pool: &PgPool, account: Uuid, id: Uuid) -> Result<Option<Action>> {
    let mut conn = pool.acquire().await?;
    let rows = rows_where(&mut conn, account, "a.id = $2", id).await?;
    Ok(load_actions(&mut conn, account, rows)
        .await?
        .into_iter()
        .next())
}

/// Страница ленты (новые сверху). `before` — курсор из прошлой страницы.
pub async fn list(
    pool: &PgPool,
    account: Uuid,
    feed: Feed,
    before: Option<i64>,
    limit: i64,
) -> Result<Page> {
    let limit = limit.clamp(1, MAX_PAGE);
    let (condition, target) = match feed {
        Feed::All => ("true", None),
        Feed::Object(id) => (
            "EXISTS (SELECT 1 FROM agent_action_changes ch \
               WHERE ch.action_id = a.id AND ch.object_id = $4)",
            Some(id),
        ),
        Feed::Project(id) => (
            "EXISTS (SELECT 1 FROM agent_action_changes ch \
               WHERE ch.action_id = a.id AND (ch.object_id = $4 OR ch.project_ids @> ARRAY[$4]))",
            Some(id),
        ),
        Feed::Batch(id) => ("a.batch_id = $4", Some(id)),
    };
    let mut conn = pool.acquire().await?;
    // `condition` — только строки выше, без внешнего ввода.
    let rows: Vec<ActionRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{ACTION_SELECT} WHERE a.account_id = $1 AND ($2::bigint IS NULL OR a.seq < $2) \
           AND ($4::uuid IS NULL OR {condition}) \
         ORDER BY a.seq DESC LIMIT $3"
    )))
    .bind(account)
    .bind(before)
    .bind(limit + 1)
    .bind(target)
    .fetch_all(&mut *conn)
    .await?;
    let more = i64::try_from(rows.len()).unwrap_or(i64::MAX) > limit;
    let rows: Vec<ActionRowRef> = rows
        .into_iter()
        .take(usize::try_from(limit).unwrap_or(usize::MAX))
        .map(ActionRowRef)
        .collect();
    let items = load_actions(&mut conn, account, rows).await?;
    let next = if more {
        items.last().map(|action| action.seq)
    } else {
        None
    };
    Ok(Page { items, next })
}

/// Можно ли человеку смотреть ленту (грант `agent`, право `read`).
pub async fn authorize_read(pool: &PgPool, who: &Who) -> Result<()> {
    let mut conn = pool.acquire().await?;
    check_agent(&mut conn, who).await
}
