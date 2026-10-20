//! Серверная сторона синхронизации: принять пакет операций устройства и
//! отдать изменения после курсора.
//!
//! **Субъект (`owner`) должен быть уже проверен.** Права по модулям приходят
//! в [`Rules`]: HTTP-слой (CMD-001) заранее спрашивает Policy Gate, какие
//! модули субъекту можно менять и читать. Здесь только правила: чужие объекты
//! для субъекта «не существуют», каждая операция применяется ровно один раз,
//! поля модуля проверяет сам модуль ([`TypeFields`]).

use std::{collections::HashSet, future::Future, pin::Pin, sync::Arc};

use qubite_objects::{Error as ObjError, NewObject, Object, objects};
use qubite_sync::{
    InvalidPush, MAX_PULL_LIMIT, ObjectSnapshot, OpKind, OpResult, Operation, PullResponse,
    PushRequest, PushResponse, RejectReason,
};
use serde_json::Value;
use sqlx::{Connection, PgConnection, PgPool};
use uuid::Uuid;

/// Канал PostgreSQL, в который триггер на `events` пишет ID владельца
/// изменённого объекта (миграция 0009).
pub const CHANGES_CHANNEL: &str = "qubite_changes";

pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// Ошибка модуля при работе с полями.
#[derive(Debug, thiserror::Error)]
pub enum FieldsError {
    /// Поля не прошли проверку — операция отклоняется (`invalid`).
    #[error("{0}")]
    Invalid(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
}

/// Поля объектов одного типа. Модуль хранит их в своей таблице и сам
/// проверяет; движок вызывает методы в транзакции операции.
pub trait TypeFields: Send + Sync {
    /// Тип объекта, например `inbox.item`.
    fn object_type(&self) -> &'static str;
    /// Создать запись модуля для только что созданного объекта.
    fn create<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: Option<&'a Value>,
    ) -> BoxFuture<'a, Result<(), FieldsError>>;
    /// Изменить поля. Возвращает имена изменённых полей (для события).
    /// Версию объекта поднимает движок.
    fn patch<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: &'a Value,
    ) -> BoxFuture<'a, Result<Vec<String>, FieldsError>>;
    /// Текущие поля для снимка (`pull`, конфликт).
    fn read<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object_id: Uuid,
    ) -> BoxFuture<'a, Result<Option<Value>, FieldsError>>;
}

/// Какие типы объектов синхронизируются и у каких есть поля модуля.
#[derive(Clone, Default)]
pub struct Registry {
    types: Vec<Arc<dyn TypeFields>>,
}

impl Registry {
    pub fn with(mut self, fields: impl TypeFields + 'static) -> Self {
        self.types.push(Arc::new(fields));
        self
    }

    pub fn get(&self, object_type: &str) -> Option<&Arc<dyn TypeFields>> {
        self.types
            .iter()
            .find(|fields| fields.object_type() == object_type)
    }

    /// Модули, у которых есть синхронизируемые типы.
    pub fn modules(&self) -> Vec<String> {
        let mut modules: Vec<String> = self
            .types
            .iter()
            .map(|fields| module_of(fields.object_type()).to_owned())
            .collect();
        modules.sort();
        modules.dedup();
        modules
    }
}

/// Модуль типа объекта: `inbox.item` → `inbox`.
pub fn module_of(object_type: &str) -> &str {
    object_type.split('.').next().unwrap_or_default()
}

/// Правила одного запроса.
#[derive(Clone, Default)]
pub struct Rules {
    pub registry: Registry,
    /// Создавать можно только типы из реестра (так работает HTTP). Без этого —
    /// любые типы без полей, как в FND-005.
    pub strict: bool,
    /// Модули, в которых субъекту можно менять объекты; `None` — все.
    pub writable: Option<HashSet<String>>,
    /// Модули, которые субъекту можно читать; `None` — все.
    pub readable: Option<Vec<String>>,
}

impl Rules {
    fn can_write(&self, module: &str) -> bool {
        self.writable
            .as_ref()
            .is_none_or(|modules| modules.contains(module))
    }
}

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

impl From<FieldsError> for Error {
    fn from(error: FieldsError) -> Self {
        match error {
            FieldsError::Db(error) => Self::Db(error),
            FieldsError::Invalid(message) => Self::Objects(ObjError::Invalid(message)),
        }
    }
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Принять пакет операций. Каждая операция — в своей транзакции: ошибка одной
/// не откатывает остальные. Результаты — в том же порядке, что и операции.
pub async fn push(pool: &PgPool, owner: Uuid, request: &PushRequest) -> Result<PushResponse> {
    push_with(pool, owner, request, &Rules::default()).await
}

/// То же с правилами запроса (реестр типов, права по модулям).
pub async fn push_with(
    pool: &PgPool,
    owner: Uuid,
    request: &PushRequest,
    rules: &Rules,
) -> Result<PushResponse> {
    request.validate()?;
    let mut results = Vec::with_capacity(request.ops.len());
    for op in &request.ops {
        results.push(apply_one(pool, owner, request.device_id, op, rules).await?);
    }
    Ok(PushResponse { results })
}

/// Применить одну операцию ровно один раз (повтор `op_id` вернёт тот же
/// результат). Этим же пользуются обычные HTTP-адреса модулей.
pub async fn apply_one(
    pool: &PgPool,
    owner: Uuid,
    device: Uuid,
    op: &Operation,
    rules: &Rules,
) -> Result<OpResult> {
    let mut conn = pool.acquire().await?;
    apply_once(&mut conn, owner, device, op, rules).await
}

/// То же на своём соединении. Если оно уже в транзакции, операция идёт во
/// вложенной (точка сохранения) и закрепляется вместе с внешней: так агент
/// пишет изменение и строку своей ленты одной транзакцией (AGT-002).
pub async fn apply_in(
    conn: &mut PgConnection,
    owner: Uuid,
    device: Uuid,
    op: &Operation,
    rules: &Rules,
) -> Result<OpResult> {
    apply_once(conn, owner, device, op, rules).await
}

/// Модули, которых касается пакет (создание — по типу, правка — по объекту).
/// Чужие и несуществующие объекты не учитываются: они и так «не найдены».
pub async fn modules_of(pool: &PgPool, owner: Uuid, ops: &[Operation]) -> Result<Vec<String>> {
    let mut modules: Vec<String> = ops
        .iter()
        .filter_map(|op| match &op.kind {
            OpKind::Create { object_type, .. } => Some(module_of(object_type).to_owned()),
            _ => None,
        })
        .collect();
    let ids: Vec<Uuid> = ops.iter().map(|op| op.object_id).collect();
    let existing: Vec<String> = sqlx::query_scalar(
        "SELECT DISTINCT module_id FROM objects WHERE id = ANY($1) AND owner_id = $2",
    )
    .bind(&ids)
    .bind(owner)
    .fetch_all(pool)
    .await?;
    modules.extend(existing);
    modules.sort();
    modules.dedup();
    Ok(modules)
}

async fn apply_once(
    conn: &mut PgConnection,
    owner: Uuid,
    device: Uuid,
    op: &Operation,
    rules: &Rules,
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

    let result = apply(&mut tx, owner, op, rules).await?;
    sqlx::query("UPDATE sync_ops SET result = $2 WHERE op_id = $1")
        .bind(op.op_id)
        .bind(serde_json::to_value(&result)?)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(result)
}

async fn apply(
    conn: &mut PgConnection,
    owner: Uuid,
    op: &Operation,
    rules: &Rules,
) -> Result<OpResult> {
    if let Err(message) = op.check() {
        return Ok(rejected(op, RejectReason::Invalid, &message));
    }
    let existing = objects::get_any(conn, op.object_id).await?;
    // Чужой объект для субъекта не существует — не раскрываем, что ID занят.
    let existing = existing.filter(|object| object.owner_id == owner);

    let module = match (&op.kind, &existing) {
        (OpKind::Create { object_type, .. }, _) => module_of(object_type).to_owned(),
        (_, Some(object)) => object.module_id.clone(),
        (_, None) => return Ok(rejected(op, RejectReason::NotFound, "объект не найден")),
    };
    if !rules.can_write(&module) {
        return Ok(rejected(
            op,
            RejectReason::Forbidden,
            "нет права изменять объекты этого модуля",
        ));
    }

    // Всё изменение — во вложенной транзакции: если модуль отклонил поля
    // после того, как объект уже изменён, откатывается всё вместе.
    let mut change = conn.begin().await?;
    let outcome = match (&op.kind, &existing) {
        (
            OpKind::Create {
                object_type,
                title,
                fields,
            },
            None,
        ) => {
            let handler = rules.registry.get(object_type);
            if handler.is_none() && (rules.strict || fields.is_some()) {
                return Ok(rejected(
                    op,
                    RejectReason::Invalid,
                    "этот тип объектов не синхронизируется",
                ));
            }
            if objects::get_any(&mut change, op.object_id).await?.is_some() {
                return Ok(rejected(op, RejectReason::Invalid, "ID объекта уже занят"));
            }
            let mut new = NewObject::new(object_type, owner, title.clone());
            new.id = Some(op.object_id);
            match objects::create(&mut change, new).await {
                Ok(object) => match handler {
                    Some(handler) => handler
                        .create(&mut change, &object, fields.as_ref())
                        .await
                        .map(|()| object)
                        .map_err(fields_error),
                    None => Ok(object),
                },
                Err(error) => Err(error),
            }
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
            objects::rename(&mut change, object.id, base(op), title, owner).await
        }
        (OpKind::Delete, Some(object)) => {
            objects::delete(&mut change, object.id, base(op), owner).await
        }
        (OpKind::Restore, Some(object)) => {
            objects::restore(&mut change, object.id, base(op), owner).await
        }
        (OpKind::Patch { fields }, Some(object)) => {
            let Some(handler) = rules.registry.get(&object.object_type) else {
                return Ok(rejected(
                    op,
                    RejectReason::Invalid,
                    "у этого типа нет полей модуля",
                ));
            };
            if object.is_deleted() {
                Err(ObjError::Deleted)
            } else {
                match handler.patch(&mut change, object, fields).await {
                    Ok(changed) => {
                        let changed: Vec<&str> = changed.iter().map(String::as_str).collect();
                        objects::bump(&mut change, object.id, base(op), owner, &changed).await
                    }
                    Err(error) => Err(fields_error(error)),
                }
            }
        }
    };

    match outcome {
        Ok(object) => {
            change.commit().await?;
            Ok(OpResult::Applied {
                op_id: op.op_id,
                revision: object.revision,
            })
        }
        Err(ObjError::Conflict { .. } | ObjError::Deleted) => {
            change.rollback().await?;
            let current = objects::get_any(conn, op.object_id)
                .await?
                .ok_or(ObjError::NotFound)?;
            Ok(OpResult::Conflict {
                op_id: op.op_id,
                current: snapshot_with(conn, &rules.registry, &current).await?,
            })
        }
        Err(ObjError::Invalid(message)) => {
            change.rollback().await?;
            Ok(rejected(op, RejectReason::Invalid, &message))
        }
        Err(ObjError::NotFound) => {
            change.rollback().await?;
            Ok(rejected(op, RejectReason::NotFound, "объект не найден"))
        }
        Err(other) => Err(other.into()),
    }
}

fn fields_error(error: FieldsError) -> ObjError {
    match error {
        FieldsError::Invalid(message) => ObjError::Invalid(message),
        FieldsError::Db(error) => ObjError::Db(error),
    }
}

/// Изменения объектов владельца после курсора `cursor` (номер события).
pub async fn pull(pool: &PgPool, owner: Uuid, cursor: i64, limit: i64) -> Result<PullResponse> {
    pull_with(pool, owner, cursor, limit, &Rules::default()).await
}

/// То же с правилами: только модули из `rules.readable`, поля модулей.
pub async fn pull_with(
    pool: &PgPool,
    owner: Uuid,
    cursor: i64,
    limit: i64,
    rules: &Rules,
) -> Result<PullResponse> {
    let limit = limit.clamp(1, MAX_PULL_LIMIT);
    let rows: Vec<(i64, Uuid)> = sqlx::query_as(
        "SELECT e.seq, e.object_id FROM events e JOIN objects o ON o.id = e.object_id \
         WHERE e.seq > $1 AND o.owner_id = $2 \
           AND ($4::text[] IS NULL OR o.module_id = ANY($4)) \
         ORDER BY e.seq LIMIT $3",
    )
    .bind(cursor.max(0))
    .bind(owner)
    .bind(limit)
    .bind(rules.readable.as_ref())
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
            changes.push(snapshot_with(&mut conn, &rules.registry, &object).await?);
        }
    }
    Ok(PullResponse {
        changes,
        cursor: next_cursor,
        has_more,
    })
}

/// Снимок вместе с полями модуля.
pub async fn snapshot_with(
    conn: &mut PgConnection,
    registry: &Registry,
    object: &Object,
) -> Result<ObjectSnapshot> {
    let mut snapshot = snapshot(object);
    if let Some(handler) = registry.get(&object.object_type) {
        snapshot.fields = handler.read(conn, object.id).await?;
    }
    Ok(snapshot)
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
        fields: None,
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
