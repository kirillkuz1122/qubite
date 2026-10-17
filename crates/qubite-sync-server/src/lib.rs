//! Серверная сторона синхронизации: принять пакет операций устройства и
//! отдать изменения после курсора.
//!
//! **Субъект (`owner`) должен быть уже проверен.** HTTP-адреса синхронизации
//! подключаются вместе с аккаунтами и Policy Gate (задача CMD-001); здесь
//! только правила: чужие объекты для субъекта «не существуют», каждая
//! операция применяется ровно один раз.

use qubite_objects::{Error as ObjError, NewObject, Object, objects};
use qubite_sync::{
    InvalidPush, MAX_PULL_LIMIT, ObjectSnapshot, OpKind, OpResult, Operation, PullResponse,
    PushRequest, PushResponse, RejectReason,
};
use sqlx::{Connection, PgConnection, PgPool};
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("неверный пакет: {0}")]
    InvalidPush(#[from] InvalidPush),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
    #[error("ошибка объектов: {0}")]
    Objects(#[from] ObjError),
    #[error("повреждён сохранённый результат операции: {0}")]
    Corrupt(#[from] serde_json::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Принять пакет операций. Каждая операция — в своей транзакции: ошибка одной
/// не откатывает остальные. Результаты — в том же порядке, что и операции.
pub async fn push(pool: &PgPool, owner: Uuid, request: &PushRequest) -> Result<PushResponse> {
    request.validate()?;
    let mut results = Vec::with_capacity(request.ops.len());
    for op in &request.ops {
        let mut conn = pool.acquire().await?;
        results.push(apply_once(&mut conn, owner, request.device_id, op).await?);
    }
    Ok(PushResponse { results })
}

async fn apply_once(
    conn: &mut PgConnection,
    owner: Uuid,
    device: Uuid,
    op: &Operation,
) -> Result<OpResult> {
    let mut tx = conn.begin().await?;
    // Сначала «занимаем» op_id. Если такую операцию уже приняли (или прямо сейчас
    // принимает параллельный запрос), вставка подождёт и вернёт пусто.
    let claimed: Option<Uuid> = sqlx::query_scalar(
        "INSERT INTO sync_ops (op_id, owner_id, device_id, object_id) VALUES ($1, $2, $3, $4) \
         ON CONFLICT (op_id) DO NOTHING RETURNING op_id",
    )
    .bind(op.op_id)
    .bind(owner)
    .bind(device)
    .bind(op.object_id)
    .fetch_optional(&mut *tx)
    .await?;

    if claimed.is_none() {
        let (stored_owner, stored): (Uuid, Option<serde_json::Value>) =
            sqlx::query_as("SELECT owner_id, result FROM sync_ops WHERE op_id = $1")
                .bind(op.op_id)
                .fetch_one(&mut *tx)
                .await?;
        tx.rollback().await?;
        if stored_owner != owner {
            return Ok(rejected(op, RejectReason::Invalid, "op_id уже использован"));
        }
        return match stored {
            Some(result) => Ok(serde_json::from_value(result)?),
            None => Ok(rejected(
                op,
                RejectReason::Invalid,
                "операция ещё применяется",
            )),
        };
    }

    let result = apply(&mut tx, owner, op).await?;
    sqlx::query("UPDATE sync_ops SET result = $2 WHERE op_id = $1")
        .bind(op.op_id)
        .bind(serde_json::to_value(&result)?)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(result)
}

async fn apply(conn: &mut PgConnection, owner: Uuid, op: &Operation) -> Result<OpResult> {
    if let Err(message) = op.check() {
        return Ok(rejected(op, RejectReason::Invalid, &message));
    }
    let existing = objects::get_any(conn, op.object_id).await?;
    // Чужой объект для субъекта не существует — не раскрываем, что ID занят.
    let existing = existing.filter(|object| object.owner_id == owner);

    let outcome = match (&op.kind, &existing) {
        (OpKind::Create { object_type, title }, None) => {
            if objects::get_any(conn, op.object_id).await?.is_some() {
                return Ok(rejected(op, RejectReason::Invalid, "ID объекта уже занят"));
            }
            let mut new = NewObject::new(object_type, owner, title.clone());
            new.id = Some(op.object_id);
            objects::create(conn, new).await
        }
        (OpKind::Create { .. }, Some(_)) => {
            return Ok(rejected(
                op,
                RejectReason::Invalid,
                "объект с таким ID уже есть",
            ));
        }
        (_, None) => return Ok(rejected(op, RejectReason::NotFound, "объект не найден")),
        (OpKind::SetTitle { title }, Some(object)) => {
            objects::rename(conn, object.id, base(op), title, owner).await
        }
        (OpKind::Delete, Some(object)) => objects::delete(conn, object.id, base(op), owner).await,
        (OpKind::Restore, Some(object)) => objects::restore(conn, object.id, base(op), owner).await,
    };

    match outcome {
        Ok(object) => Ok(OpResult::Applied {
            op_id: op.op_id,
            revision: object.revision,
        }),
        Err(ObjError::Conflict { .. } | ObjError::Deleted) => {
            let current = objects::get_any(conn, op.object_id)
                .await?
                .ok_or(ObjError::NotFound)?;
            Ok(OpResult::Conflict {
                op_id: op.op_id,
                current: snapshot(&current),
            })
        }
        Err(ObjError::Invalid(message)) => Ok(rejected(op, RejectReason::Invalid, &message)),
        Err(ObjError::NotFound) => Ok(rejected(op, RejectReason::NotFound, "объект не найден")),
        Err(other) => Err(other.into()),
    }
}

/// Изменения объектов владельца после курсора `cursor` (номер события).
pub async fn pull(pool: &PgPool, owner: Uuid, cursor: i64, limit: i64) -> Result<PullResponse> {
    let limit = limit.clamp(1, MAX_PULL_LIMIT);
    let rows: Vec<(i64, Uuid)> = sqlx::query_as(
        "SELECT e.seq, e.object_id FROM events e JOIN objects o ON o.id = e.object_id \
         WHERE e.seq > $1 AND o.owner_id = $2 ORDER BY e.seq LIMIT $3",
    )
    .bind(cursor.max(0))
    .bind(owner)
    .bind(limit)
    .fetch_all(pool)
    .await?;

    let has_more = i64::try_from(rows.len()).unwrap_or(i64::MAX) == limit;
    let next_cursor = rows.last().map_or(cursor.max(0), |(seq, _)| *seq);
    // Один снимок на объект, в порядке последнего изменения.
    let mut order: Vec<Uuid> = Vec::new();
    for (_, object_id) in rows.into_iter().rev() {
        if !order.contains(&object_id) {
            order.push(object_id);
        }
    }
    order.reverse();

    let mut conn = pool.acquire().await?;
    let mut changes = Vec::with_capacity(order.len());
    for object_id in order {
        if let Some(object) = objects::get_any(&mut conn, object_id).await? {
            changes.push(snapshot(&object));
        }
    }
    Ok(PullResponse {
        changes,
        cursor: next_cursor,
        has_more,
    })
}

pub fn snapshot(object: &Object) -> ObjectSnapshot {
    ObjectSnapshot {
        id: object.id,
        object_type: object.object_type.clone(),
        title: object.title.clone(),
        revision: object.revision,
        deleted: object.is_deleted(),
        updated_at_ms: i64::try_from(object.updated_at.unix_timestamp_nanos() / 1_000_000)
            .unwrap_or(i64::MAX),
    }
}

fn base(op: &Operation) -> i64 {
    op.base_revision.unwrap_or_default()
}

fn rejected(op: &Operation, reason: RejectReason, message: &str) -> OpResult {
    OpResult::Rejected {
        op_id: op.op_id,
        reason,
        message: message.to_owned(),
    }
}
