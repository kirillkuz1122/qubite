//! Конверт объекта: общие поля любого объекта Qubite.

use serde::{Deserialize, Serialize};
use sqlx::{Connection, PgConnection};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, NewEvent, Result, events, new_id};

/// Кому виден объект (сами правила доступа — в Policy Gate).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Visibility {
    Private,
    Workspace,
    SharedLink,
    Vault,
}

impl Visibility {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Private => "private",
            Self::Workspace => "workspace",
            Self::SharedLink => "shared_link",
            Self::Vault => "vault",
        }
    }
}

impl TryFrom<String> for Visibility {
    type Error = String;

    fn try_from(value: String) -> std::result::Result<Self, Self::Error> {
        match value.as_str() {
            "private" => Ok(Self::Private),
            "workspace" => Ok(Self::Workspace),
            "shared_link" => Ok(Self::SharedLink),
            "vault" => Ok(Self::Vault),
            other => Err(format!("неизвестная видимость {other}")),
        }
    }
}

/// Объект, как он лежит в базе.
#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct Object {
    pub id: Uuid,
    #[sqlx(rename = "type")]
    pub object_type: String,
    pub module_id: String,
    pub owner_id: Uuid,
    pub workspace_id: Option<Uuid>,
    #[sqlx(try_from = "String")]
    pub visibility: Visibility,
    pub title: String,
    pub revision: i64,
    pub source_refs: serde_json::Value,
    pub created_at: OffsetDateTime,
    pub created_by: Uuid,
    pub updated_at: OffsetDateTime,
    pub updated_by: Uuid,
    pub deleted_at: Option<OffsetDateTime>,
}

impl Object {
    pub fn is_deleted(&self) -> bool {
        self.deleted_at.is_some()
    }
}

/// Данные для создания объекта.
#[derive(Debug, Clone)]
pub struct NewObject {
    /// Можно задать заранее (объект создан офлайн на устройстве). Иначе — новый UUIDv7.
    pub id: Option<Uuid>,
    /// `модуль.тип`, например `inbox.item`. Модуль в типе должен совпадать с `module_id`.
    pub object_type: String,
    pub module_id: String,
    pub owner_id: Uuid,
    pub workspace_id: Option<Uuid>,
    pub visibility: Visibility,
    pub title: String,
    pub source_refs: serde_json::Value,
    /// Кто создаёт (аккаунт или служебный субъект).
    pub actor: Uuid,
}

impl NewObject {
    /// Минимальный набор: тип, владелец, заголовок. Модуль берётся из типа.
    pub fn new(object_type: &str, owner_id: Uuid, title: impl Into<String>) -> Self {
        let module_id = object_type.split('.').next().unwrap_or_default().to_owned();
        Self {
            id: None,
            object_type: object_type.to_owned(),
            module_id,
            owner_id,
            workspace_id: None,
            visibility: Visibility::Private,
            title: title.into(),
            source_refs: serde_json::json!([]),
            actor: owner_id,
        }
    }
}

const COLUMNS: &str = "id, type, module_id, owner_id, workspace_id, visibility, title, revision, \
     source_refs, created_at, created_by, updated_at, updated_by, deleted_at";

/// Создать объект и записать событие `object.created` (атомарно).
pub async fn create(conn: &mut PgConnection, new: NewObject) -> Result<Object> {
    let mut tx = conn.begin().await?;
    let id = new.id.unwrap_or_else(new_id);
    let object: Object = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO objects (id, type, module_id, owner_id, workspace_id, visibility, title, \
         source_refs, created_by, updated_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING {COLUMNS}"
    )))
    .bind(id)
    .bind(&new.object_type)
    .bind(&new.module_id)
    .bind(new.owner_id)
    .bind(new.workspace_id)
    .bind(new.visibility.as_str())
    .bind(&new.title)
    .bind(&new.source_refs)
    .bind(new.actor)
    .fetch_one(&mut *tx)
    .await
    .map_err(Error::from_db)?;

    events::append(
        &mut tx,
        NewEvent::for_object("object.created", object.id, new.actor)
            .with_payload(serde_json::json!({ "type": object.object_type, "revision": 1 })),
    )
    .await?;
    tx.commit().await?;
    Ok(object)
}

/// Живой (не удалённый) объект по ID.
pub async fn get(conn: &mut PgConnection, id: Uuid) -> Result<Option<Object>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM objects WHERE id = $1 AND deleted_at IS NULL"
    )))
    .bind(id)
    .fetch_optional(conn)
    .await?)
}

/// Объект по ID, включая удалённые (для истории и восстановления).
pub async fn get_any(conn: &mut PgConnection, id: Uuid) -> Result<Option<Object>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM objects WHERE id = $1"
    )))
    .bind(id)
    .fetch_optional(conn)
    .await?)
}

/// Живые объекты владельца, новые сверху. `object_type = None` — все типы.
pub async fn list_by_owner(
    conn: &mut PgConnection,
    owner_id: Uuid,
    object_type: Option<&str>,
    limit: i64,
) -> Result<Vec<Object>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM objects \
         WHERE owner_id = $1 AND deleted_at IS NULL AND ($2::text IS NULL OR type = $2) \
         ORDER BY updated_at DESC, id DESC LIMIT $3"
    )))
    .bind(owner_id)
    .bind(object_type)
    .bind(limit.clamp(1, 1000))
    .fetch_all(conn)
    .await?)
}

/// Поднять версию объекта после изменения его данных в таблице модуля.
///
/// Модуль меняет свои поля и вызывает `bump` в той же транзакции: если кто-то
/// успел изменить объект раньше (версия не совпала), вернётся `Conflict` и
/// модулю нужно откатить транзакцию.
pub async fn bump(
    conn: &mut PgConnection,
    id: Uuid,
    expected_revision: i64,
    actor: Uuid,
    changed: &[&str],
) -> Result<Object> {
    let mut tx = conn.begin().await?;
    let object = update_checked(&mut tx, id, expected_revision, actor, "", None).await?;
    events::append(
        &mut tx,
        NewEvent::for_object("object.updated", id, actor)
            .with_payload(serde_json::json!({ "fields": changed, "revision": object.revision })),
    )
    .await?;
    tx.commit().await?;
    Ok(object)
}

/// Изменить заголовок с проверкой версии. У docs.page промежуточные правки
/// только body/ystate не конфликтуют с офлайн-переименованием.
pub async fn rename(
    conn: &mut PgConnection,
    id: Uuid,
    expected_revision: i64,
    title: &str,
    actor: Uuid,
) -> Result<Object> {
    let mut tx = conn.begin().await?;
    // Держим блокировку до записи заголовка и события: между чтением истории
    // и UPDATE не должны вклиниться ни Yjs-обмен, ни другое переименование.
    let current: Object = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {COLUMNS} FROM objects WHERE id = $1 FOR UPDATE"
    )))
    .bind(id)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(Error::NotFound)?;
    let mut revision = expected_revision;
    if current.object_type == "docs.page"
        && !current.is_deleted()
        && expected_revision >= 1
        && expected_revision < current.revision
    {
        // Проверяем ВСЕ пропущенные ревизии, а не только последнее событие.
        // Пробел в истории, удаление/восстановление и неизвестные поля оставляют
        // обычный конфликт. bump по-прежнему пишет события и будит устройства.
        let content_revisions: i64 = sqlx::query_scalar(
            "SELECT count(DISTINCT payload->'revision') FROM events \
             WHERE object_id = $1 AND kind = 'object.updated' \
               AND payload->'revision' > to_jsonb($2::bigint) \
               AND payload->'revision' <= to_jsonb($3::bigint) \
               AND jsonb_typeof(payload->'fields') = 'array' \
               AND payload->'fields' <> '[]'::jsonb \
               AND payload->'fields' <@ '[\"body\",\"ystate\"]'::jsonb",
        )
        .bind(id)
        .bind(expected_revision)
        .bind(current.revision)
        .fetch_one(&mut *tx)
        .await?;
        if content_revisions == current.revision - expected_revision {
            revision = current.revision;
        }
    }
    let object = update_checked(
        &mut tx,
        id,
        revision,
        actor,
        ", title = $4",
        Some(title),
    )
    .await?;
    events::append(
        &mut tx,
        NewEvent::for_object("object.updated", id, actor)
            .with_payload(serde_json::json!({ "fields": ["title"], "revision": object.revision })),
    )
    .await?;
    tx.commit().await?;
    Ok(object)
}

/// Мягко удалить объект (можно восстановить).
pub async fn delete(
    conn: &mut PgConnection,
    id: Uuid,
    expected_revision: i64,
    actor: Uuid,
) -> Result<Object> {
    let mut tx = conn.begin().await?;
    let object = update_checked(
        &mut tx,
        id,
        expected_revision,
        actor,
        ", deleted_at = now()",
        None,
    )
    .await?;
    events::append(
        &mut tx,
        NewEvent::for_object("object.deleted", id, actor)
            .with_payload(serde_json::json!({ "revision": object.revision })),
    )
    .await?;
    tx.commit().await?;
    Ok(object)
}

/// Восстановить удалённый объект.
pub async fn restore(
    conn: &mut PgConnection,
    id: Uuid,
    expected_revision: i64,
    actor: Uuid,
) -> Result<Object> {
    let mut tx = conn.begin().await?;
    let restored: Option<Object> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "UPDATE objects SET deleted_at = NULL, revision = revision + 1, updated_at = now(), \
         updated_by = $3 WHERE id = $1 AND revision = $2 AND deleted_at IS NOT NULL \
         RETURNING {COLUMNS}"
    )))
    .bind(id)
    .bind(expected_revision)
    .bind(actor)
    .fetch_optional(&mut *tx)
    .await?;
    let object = match restored {
        Some(object) => object,
        None => {
            return Err(match get_any(&mut tx, id).await? {
                None => Error::NotFound,
                Some(current) if current.revision != expected_revision => Error::Conflict {
                    expected: expected_revision,
                    current: current.revision,
                },
                Some(_) => Error::Invalid("объект не удалён".into()),
            });
        }
    };
    events::append(
        &mut tx,
        NewEvent::for_object("object.restored", id, actor)
            .with_payload(serde_json::json!({ "revision": object.revision })),
    )
    .await?;
    tx.commit().await?;
    Ok(object)
}

/// `UPDATE ... WHERE revision = expected` с понятной ошибкой, если не вышло.
async fn update_checked(
    conn: &mut PgConnection,
    id: Uuid,
    expected_revision: i64,
    actor: Uuid,
    extra_set: &'static str,
    title: Option<&str>,
) -> Result<Object> {
    let query = format!(
        "UPDATE objects SET revision = revision + 1, updated_at = now(), updated_by = $3{extra_set} \
         WHERE id = $1 AND revision = $2 AND deleted_at IS NULL RETURNING {COLUMNS}"
    );
    let mut query = sqlx::query_as::<_, Object>(sqlx::AssertSqlSafe(query))
        .bind(id)
        .bind(expected_revision)
        .bind(actor);
    if let Some(title) = title {
        query = query.bind(title);
    }
    if let Some(object) = query
        .fetch_optional(&mut *conn)
        .await
        .map_err(Error::from_db)?
    {
        return Ok(object);
    }
    Err(match get_any(conn, id).await? {
        None => Error::NotFound,
        Some(current) if current.is_deleted() => Error::Deleted,
        Some(current) => Error::Conflict {
            expected: expected_revision,
            current: current.revision,
        },
    })
}
