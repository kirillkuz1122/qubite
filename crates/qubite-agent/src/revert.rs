//! Откат — как `git revert`: новое действие, обратное старому.
//!
//! По каждому объекту три значения каждого поля: **было** (до действия),
//! **сделал** (после действия) и **сейчас**. Поле, которое действие не
//! меняло, не трогаем. Сейчас «сделал» — возвращаем «было». Сейчас уже
//! «было» — ничего не надо. Сейчас что-то третье — кто-то поменял после
//! агента: это **конфликт**, и без `force` откат ничего не меняет, а
//! возвращает три значения, чтобы человек решил сам (как черновик Owner
//! Console, D-233). Созданный действием объект откат кладёт в корзину.
//!
//! Пакет откатывается одной транзакцией, новые шаги первыми: каждый следующий
//! шаг сверяется уже с результатом предыдущего.

use qubite_sync::{ObjectSnapshot, OpKind};
use serde::Serialize;
use serde_json::{Map, Value};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{
    Error, Result, Who,
    timeline::{
        self, Action, ActionRowRef, Links, Plan, Step, aspect, aspects, check_agent, execute_in,
        lock, rows_where, snapshot, stored,
    },
};

/// Поле, которое поменяли после действия.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Conflict {
    /// Какое действие откатывали.
    pub action_id: Uuid,
    pub object_id: Uuid,
    pub object_type: String,
    /// Название сейчас.
    pub title: String,
    /// `title`, `deleted` или поле модуля.
    pub field: String,
    /// До действия (`null` — объекта не было).
    pub before: Value,
    /// Что сделало действие.
    pub action: Value,
    /// Что сейчас.
    pub now: Value,
}

/// Чем кончился откат.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum RevertOutcome {
    /// Откачено: новые действия-откаты (по одному на откаченное действие).
    Reverted { actions: Vec<Action> },
    /// Ничего не изменено: после действия объект меняли. Решить и повторить
    /// с `force` («вернуть как было») — или оставить как есть.
    Conflict { conflicts: Vec<Conflict> },
}

#[derive(sqlx::FromRow)]
struct ChangeRow {
    object_id: Uuid,
    object_type: String,
    before: Option<Value>,
    after: Value,
}

/// Что вернуть у одного объекта.
#[derive(Default)]
struct Want {
    restore: bool,
    delete: bool,
    title: Option<String>,
    fields: Map<String, Value>,
}

impl Want {
    fn set(&mut self, field: &str, value: Value) {
        match field {
            "deleted" => {
                if value == Value::Bool(true) {
                    self.delete = true;
                } else {
                    self.restore = true;
                }
            }
            "title" => self.title = value.as_str().map(str::to_owned),
            other => {
                self.fields.insert(other.to_owned(), value);
            }
        }
    }

    /// Порядок: достать из корзины → название → поля → в корзину.
    fn steps(self, object_id: Uuid) -> Vec<Step> {
        let mut steps = Vec::new();
        if self.restore {
            steps.push(Step {
                object_id,
                kind: OpKind::Restore,
            });
        }
        if let Some(title) = self.title {
            steps.push(Step {
                object_id,
                kind: OpKind::SetTitle { title },
            });
        }
        if !self.fields.is_empty() {
            steps.push(Step {
                object_id,
                kind: OpKind::Patch {
                    fields: Value::Object(self.fields),
                },
            });
        }
        if self.delete {
            steps.push(Step {
                object_id,
                kind: OpKind::Delete,
            });
        }
        steps
    }
}

/// Шаги отката одного объекта и конфликты (при `force` шаги их перекрывают).
fn plan_object(
    action_id: Uuid,
    before: Option<&ObjectSnapshot>,
    after: &ObjectSnapshot,
    now: &ObjectSnapshot,
    force: bool,
) -> (Vec<Step>, Vec<Conflict>) {
    let object_type = after.object_type.as_str();
    let mut want = Want::default();
    let mut conflicts = Vec::new();
    let conflict = |field: &str, before: Value, action: Value, now_value: Value| Conflict {
        action_id,
        object_id: now.id,
        object_type: object_type.to_owned(),
        title: now.title.clone(),
        field: field.to_owned(),
        before,
        action,
        now: now_value,
    };

    let Some(before) = before else {
        // Действие создало объект: откат кладёт его в корзину. Уже в корзине —
        // делать нечего. Если его успели поменять — спросить.
        if now.deleted {
            return (Vec::new(), Vec::new());
        }
        for field in aspects(object_type).filter(|field| *field != "deleted") {
            let (made, current) = (aspect(after, field), aspect(now, field));
            if made != current {
                conflicts.push(conflict(field, Value::Null, made, current));
            }
        }
        if conflicts.is_empty() || force {
            want.delete = true;
        }
        return (want.steps(now.id), conflicts);
    };

    let mut touched = false;
    for field in aspects(object_type) {
        let (was, made, current) = (
            aspect(before, field),
            aspect(after, field),
            aspect(now, field),
        );
        if made == was || current == was {
            continue;
        }
        if current == made {
            want.set(field, was);
            touched = true;
        } else {
            conflicts.push(conflict(field, was.clone(), made, current));
            if force {
                want.set(field, was);
                touched = true;
            }
        }
    }
    // Объект после действия убрали в корзину, а вернуть нужно поля: поля в
    // корзине не меняются, значит, это тоже решение человека.
    if touched && now.deleted && !before.deleted && !want.restore && !want.delete {
        conflicts.push(conflict(
            "deleted",
            Value::Bool(false),
            Value::Bool(after.deleted),
            Value::Bool(true),
        ));
        if force {
            want.restore = true;
        } else {
            want = Want::default();
        }
    }
    if !conflicts.is_empty() && !force {
        return (Vec::new(), conflicts);
    }
    (want.steps(now.id), conflicts)
}

/// План отката одного действия по текущему состоянию.
async fn plan_revert(
    conn: &mut PgConnection,
    who: &Who,
    action: &Action,
    batch: Uuid,
    force: bool,
) -> Result<(Plan, Vec<Conflict>)> {
    let rows: Vec<ChangeRow> = sqlx::query_as(
        "SELECT object_id, object_type, before, after FROM agent_action_changes \
         WHERE action_id = $1 ORDER BY id DESC",
    )
    .bind(action.id)
    .fetch_all(&mut *conn)
    .await?;
    let mut steps = Vec::new();
    let mut conflicts = Vec::new();
    for row in rows {
        let after = stored(row.after)?;
        let before = row.before.map(stored).transpose()?;
        let Some(now) = snapshot(conn, who.account(), row.object_id).await? else {
            return Err(Error::NotRevertible(format!(
                "«{}» больше нет — откатывать нечего",
                after.title
            )));
        };
        let _ = row.object_type;
        let (object_steps, object_conflicts) =
            plan_object(action.id, before.as_ref(), &after, &now, force);
        steps.extend(object_steps);
        conflicts.extend(object_conflicts);
    }
    Ok((
        Plan {
            tool: "timeline.revert".into(),
            summary: format!("Откатил: {}", action.summary),
            reason: None,
            batch,
            reverts: Some(action.id),
            corrects: None,
            steps,
        },
        conflicts,
    ))
}

/// Откатить действия (новые первыми) одной транзакцией.
async fn revert_all(
    pool: &PgPool,
    who: &Who,
    pick: impl AsyncFnOnce(&mut PgConnection) -> Result<Vec<ActionRowRef>>,
    force: bool,
) -> Result<RevertOutcome> {
    let account = who.account();
    let mut tx = pool.begin().await?;
    lock(&mut tx, account).await?;
    check_agent(&mut tx, who).await?;
    let rows = pick(&mut tx).await?;
    if rows.is_empty() {
        return Err(Error::NotFound);
    }
    let links = Links::load(&mut tx, account).await?;
    let actions = timeline::load_actions(&mut tx, account, rows).await?;
    let live: Vec<Action> = actions
        .into_iter()
        .filter(|action| links.reverted_by(action.id).is_none())
        .collect();
    if live.is_empty() {
        return Err(Error::NotRevertible("это уже откачено".into()));
    }

    let batch = Uuid::now_v7();
    let mut done = Vec::new();
    let mut conflicts = Vec::new();
    for action in &live {
        // Без `force` при конфликте всё равно проверяем остальные шаги
        // (на уже применённом откате предыдущих), но в конце ничего не
        // закрепляем: человек увидит все конфликты пакета сразу.
        let (mut plan, found) = plan_revert(&mut tx, who, action, batch, force).await?;
        if !found.is_empty() && !force {
            conflicts.extend(found);
            plan = plan_revert(&mut tx, who, action, batch, true).await?.0;
        }
        done.push(execute_in(&mut tx, who, plan).await?);
    }
    if !conflicts.is_empty() {
        tx.rollback().await?;
        return Ok(RevertOutcome::Conflict { conflicts });
    }
    tx.commit().await?;
    Ok(RevertOutcome::Reverted { actions: done })
}

/// Откатить одно действие. Откат — новое действие в ленте; его тоже можно
/// откатить. `force` — вернуть как было, даже если после меняли.
pub async fn revert_action(
    pool: &PgPool,
    who: &Who,
    id: Uuid,
    force: bool,
) -> Result<RevertOutcome> {
    let account = who.account();
    revert_all(
        pool,
        who,
        async |conn| rows_where(conn, account, "a.id = $2", id).await,
        force,
    )
    .await
}

/// Откатить весь пакет (все ещё не откаченные шаги одного решения).
pub async fn revert_batch(
    pool: &PgPool,
    who: &Who,
    batch: Uuid,
    force: bool,
) -> Result<RevertOutcome> {
    let account = who.account();
    revert_all(
        pool,
        who,
        async |conn| rows_where(conn, account, "a.batch_id = $2", batch).await,
        force,
    )
    .await
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn snap(id: Uuid, title: &str, deleted: bool, fields: Value) -> ObjectSnapshot {
        ObjectSnapshot {
            id,
            object_type: "planner.task".into(),
            title: title.into(),
            revision: 1,
            deleted,
            updated_at_ms: 0,
            fields: Some(fields),
        }
    }

    #[test]
    fn untouched_and_changed_fields() {
        let id = Uuid::now_v7();
        let before = snap(
            id,
            "ДЗ",
            false,
            json!({"due_date": "2026-10-22", "notes": ""}),
        );
        let after = snap(
            id,
            "ДЗ",
            false,
            json!({"due_date": "2026-10-23", "notes": ""}),
        );
        // Сейчас — как сделал агент, плюс владелец поменял заметку: не конфликт.
        let now = snap(
            id,
            "ДЗ",
            false,
            json!({"due_date": "2026-10-23", "notes": "тетрадь"}),
        );
        let (steps, conflicts) = plan_object(id, Some(&before), &after, &now, false);
        assert!(conflicts.is_empty());
        assert_eq!(steps.len(), 1);
        let OpKind::Patch { fields } = &steps[0].kind else {
            panic!("ожидали правку полей");
        };
        assert_eq!(fields, &json!({"due_date": "2026-10-22"}));
    }

    #[test]
    fn later_edit_is_a_conflict() {
        let id = Uuid::now_v7();
        let before = snap(id, "ДЗ", false, json!({"due_date": "2026-10-22"}));
        let after = snap(id, "ДЗ", false, json!({"due_date": "2026-10-23"}));
        let now = snap(id, "ДЗ", false, json!({"due_date": "2026-10-25"}));
        let (steps, conflicts) = plan_object(id, Some(&before), &after, &now, false);
        assert!(steps.is_empty());
        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].before, json!("2026-10-22"));
        assert_eq!(conflicts[0].action, json!("2026-10-23"));
        assert_eq!(conflicts[0].now, json!("2026-10-25"));
        let (steps, _) = plan_object(id, Some(&before), &after, &now, true);
        assert_eq!(steps.len(), 1);
    }

    #[test]
    fn already_back_needs_nothing() {
        let id = Uuid::now_v7();
        let before = snap(id, "ДЗ", false, json!({"due_date": "2026-10-22"}));
        let after = snap(id, "ДЗ", false, json!({"due_date": "2026-10-23"}));
        let (steps, conflicts) = plan_object(id, Some(&before), &after, &before, false);
        assert!(steps.is_empty() && conflicts.is_empty());
    }

    #[test]
    fn created_goes_to_trash_and_trash_comes_back() {
        let id = Uuid::now_v7();
        let made = snap(id, "ДЗ", false, json!({"due_date": "2026-10-22"}));
        let (steps, conflicts) = plan_object(id, None, &made, &made, false);
        assert!(conflicts.is_empty());
        assert!(matches!(
            steps[..],
            [Step {
                kind: OpKind::Delete,
                ..
            }]
        ));

        let trashed = snap(id, "ДЗ", true, json!({"due_date": "2026-10-22"}));
        let (steps, _) = plan_object(id, Some(&made), &trashed, &trashed, false);
        assert!(matches!(
            steps[..],
            [Step {
                kind: OpKind::Restore,
                ..
            }]
        ));
    }
}
