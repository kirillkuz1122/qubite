//! Личный слой программы английского (ENG-002, D-485): правки программы под
//! одного человека — поверх базы `content/english`, база не меняется.
//!
//! Одна операция слоя (`skip`, `repeat`, `note`…) — объект ядра
//! `agent.english_op` (суть — заголовок, сама операция — поле `op`), поэтому
//! «агент поправил программу» — строка ленты с причиной, а откат кладёт
//! объект в корзину, и программа собирается уже без него. Что значит каждая
//! операция, знает `qubite-english`; здесь — хранение и проверка формы.

use qubite_objects::Object;
use qubite_sync::OpKind;
use qubite_sync_server::{BoxFuture, FieldsError, TypeFields};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{
    Error, Result, Who,
    timeline::{self, Action, Plan, Step},
};

/// Тип объекта «правка программы английского».
pub const OP_TYPE: &str = "agent.english_op";
/// Инструмент в ленте.
pub const TOOL: &str = "english.program";
/// Длина операции в JSON (свой урок целиком помещается).
const MAX_OP_BYTES: usize = 32_000;

/// Операции слоя (overlay.schema.json).
pub const OPS: &[&str] = &[
    "skip",
    "repeat",
    "insert",
    "move",
    "swap_theme",
    "add_words",
    "add_tasks",
    "remove_tasks",
    "set_pass",
    "note",
];

fn bad(message: impl Into<String>) -> FieldsError {
    FieldsError::Invalid(message.into())
}

/// Форма операции: объект с известным `op` и уроком, не слишком большой.
pub fn check_op(op: &Value) -> Result<(), String> {
    let Some(map) = op.as_object() else {
        return Err("операция — объект".into());
    };
    let kind = map.get("op").and_then(Value::as_str).unwrap_or_default();
    if !OPS.contains(&kind) {
        return Err(format!("неизвестная операция «{kind}»"));
    }
    if !map.contains_key("lesson") {
        return Err("у операции нужен урок (lesson)".into());
    }
    if op.to_string().len() > MAX_OP_BYTES {
        return Err("операция слишком большая".into());
    }
    Ok(())
}

/// Записать операцию слоя действием в ленте (с откатом).
pub async fn add_op(
    pool: &PgPool,
    who: &Who,
    summary: &str,
    op: Value,
    reason: Option<&str>,
    batch: Option<Uuid>,
) -> Result<Action> {
    check_op(&op).map_err(Error::Invalid)?;
    let title: String = summary.trim().chars().take(200).collect();
    if title.is_empty() {
        return Err(Error::Invalid("у правки нужна суть".into()));
    }
    let plan = Plan {
        tool: TOOL.into(),
        summary: format!("Программа английского: {title}"),
        reason: reason.map(str::to_owned),
        batch: batch.unwrap_or_else(Uuid::now_v7),
        reverts: None,
        corrects: None,
        steps: vec![Step {
            object_id: Uuid::now_v7(),
            kind: OpKind::Create {
                object_type: OP_TYPE.into(),
                title,
                fields: Some(json!({ "op": op })),
            },
        }],
    };
    timeline::execute(pool, who, plan).await
}

/// Действующая операция слоя.
#[derive(Debug, Clone)]
pub struct Op {
    /// Объект — он же ссылка на строку ленты.
    pub id: Uuid,
    pub summary: String,
    pub op: Value,
}

/// Действующие (не откаченные) операции человека — по порядку записи.
pub async fn ops(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Vec<Op>> {
    let rows: Vec<(Uuid, String, Value)> = sqlx::query_as(
        "SELECT o.id, o.title, e.op FROM agent_english_ops e JOIN objects o ON o.id = e.object_id \
         WHERE e.account_id = $1 AND o.deleted_at IS NULL ORDER BY o.created_at, o.id",
    )
    .bind(account)
    .fetch_all(conn)
    .await?;
    Ok(rows
        .into_iter()
        .map(|(id, summary, op)| Op { id, summary, op })
        .collect())
}

/// Обработчик полей `agent.english_op`: операцию после записи не правят —
/// только откатывают (в корзину) и пишут новую.
pub struct EnglishOpFieldsHandler;

impl TypeFields for EnglishOpFieldsHandler {
    fn object_type(&self) -> &'static str {
        OP_TYPE
    }

    fn create<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: Option<&'a Value>,
    ) -> BoxFuture<'a, Result<(), FieldsError>> {
        Box::pin(async move {
            let op = fields
                .and_then(|f| f.get("op"))
                .ok_or_else(|| bad("у правки программы нужно поле op"))?;
            check_op(op).map_err(bad)?;
            sqlx::query(
                "INSERT INTO agent_english_ops (object_id, account_id, op) VALUES ($1, $2, $3)",
            )
            .bind(object.id)
            .bind(object.owner_id)
            .bind(op)
            .execute(conn)
            .await?;
            Ok(())
        })
    }

    fn patch<'a>(
        &'a self,
        _conn: &'a mut PgConnection,
        _object: &'a Object,
        _fields: &'a Value,
    ) -> BoxFuture<'a, Result<Vec<String>, FieldsError>> {
        Box::pin(async move {
            Err(bad("правку программы не меняют — только откатывают"))
        })
    }

    fn read<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object_id: Uuid,
    ) -> BoxFuture<'a, Result<Option<Value>, FieldsError>> {
        Box::pin(async move {
            let op: Option<Value> =
                sqlx::query_scalar("SELECT op FROM agent_english_ops WHERE object_id = $1")
                    .bind(object_id)
                    .fetch_optional(conn)
                    .await?;
            Ok(op.map(|op| json!({ "op": op })))
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn op_shape_is_checked() {
        assert!(check_op(&json!({"op": "skip", "lesson": "a0-m1-l1"})).is_ok());
        assert!(check_op(&json!({"op": "drop_table", "lesson": "a0-m1-l1"})).is_err());
        assert!(check_op(&json!({"op": "note"})).is_err());
        assert!(check_op(&json!("skip")).is_err());
        let huge = "x".repeat(MAX_OP_BYTES);
        assert!(check_op(&json!({"op": "note", "lesson": "a", "note_ru": huge})).is_err());
    }
}
