//! Типизированные связи между объектами: «задача создана из мысли»,
//! «заметка относится к проекту» и т.д.
//!
//! Функции возвращают только ID концов связи. Показывать заголовки объектов на
//! другом конце можно лишь после проверки прав на оба конца (Policy Gate).

use serde::Serialize;
use sqlx::{Connection, PgConnection};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, NewEvent, Result, events, new_id, objects};

/// Откуда взялась связь.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum RelationSource {
    Manual,
    Ai,
    Import,
    System,
}

impl RelationSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Manual => "manual",
            Self::Ai => "ai",
            Self::Import => "import",
            Self::System => "system",
        }
    }
}

impl TryFrom<String> for RelationSource {
    type Error = String;

    fn try_from(value: String) -> std::result::Result<Self, Self::Error> {
        match value.as_str() {
            "manual" => Ok(Self::Manual),
            "ai" => Ok(Self::Ai),
            "import" => Ok(Self::Import),
            "system" => Ok(Self::System),
            other => Err(format!("неизвестный источник связи {other}")),
        }
    }
}

#[derive(Debug, Clone, PartialEq, sqlx::FromRow, Serialize)]
pub struct Relation {
    pub id: Uuid,
    pub from_id: Uuid,
    pub to_id: Uuid,
    #[sqlx(rename = "type")]
    pub relation_type: String,
    #[sqlx(try_from = "String")]
    pub source: RelationSource,
    pub confidence: Option<f32>,
    pub created_at: OffsetDateTime,
    pub created_by: Uuid,
    pub deleted_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone)]
pub struct NewRelation {
    pub from_id: Uuid,
    pub to_id: Uuid,
    pub relation_type: String,
    pub source: RelationSource,
    /// Уверенность для связей, предложенных AI (0..1).
    pub confidence: Option<f32>,
    pub actor: Uuid,
}

impl NewRelation {
    pub fn manual(from_id: Uuid, to_id: Uuid, relation_type: &str, actor: Uuid) -> Self {
        Self {
            from_id,
            to_id,
            relation_type: relation_type.to_owned(),
            source: RelationSource::Manual,
            confidence: None,
            actor,
        }
    }
}

const COLUMNS: &str =
    "id, from_id, to_id, type, source, confidence, created_at, created_by, deleted_at";

/// Связать два живых объекта. Повторный вызов возвращает уже существующую связь.
pub async fn link(conn: &mut PgConnection, new: NewRelation) -> Result<Relation> {
    if new.from_id == new.to_id {
        return Err(Error::Invalid("объект нельзя связать сам с собой".into()));
    }
    let mut tx = conn.begin().await?;
    for id in [new.from_id, new.to_id] {
        match objects::get_any(&mut tx, id).await? {
            None => return Err(Error::NotFound),
            Some(object) if object.is_deleted() => return Err(Error::Deleted),
            Some(_) => {}
        }
    }

    let inserted: Option<Relation> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "INSERT INTO relations (id, from_id, to_id, type, source, confidence, created_by) \
         VALUES ($1, $2, $3, $4, $5, $6, $7) \
         ON CONFLICT (from_id, to_id, type) WHERE deleted_at IS NULL DO NOTHING \
         RETURNING {COLUMNS}"
    )))
    .bind(new_id())
    .bind(new.from_id)
    .bind(new.to_id)
    .bind(&new.relation_type)
    .bind(new.source.as_str())
    .bind(new.confidence)
    .bind(new.actor)
    .fetch_optional(&mut *tx)
    .await
    .map_err(Error::from_db)?;

    let relation = match inserted {
        Some(relation) => {
            events::append(
                &mut tx,
                NewEvent::for_object("relation.created", new.from_id, new.actor).with_payload(
                    serde_json::json!({
                        "relation_id": relation.id,
                        "to_id": relation.to_id,
                        "type": relation.relation_type,
                    }),
                ),
            )
            .await?;
            relation
        }
        None => {
            sqlx::query_as(sqlx::AssertSqlSafe(format!(
                "SELECT {COLUMNS} FROM relations \
             WHERE from_id = $1 AND to_id = $2 AND type = $3 AND deleted_at IS NULL"
            )))
            .bind(new.from_id)
            .bind(new.to_id)
            .bind(&new.relation_type)
            .fetch_one(&mut *tx)
            .await?
        }
    };
    tx.commit().await?;
    Ok(relation)
}

/// Убрать связь. Возвращает `false`, если такой живой связи не было.
pub async fn unlink(
    conn: &mut PgConnection,
    from_id: Uuid,
    to_id: Uuid,
    relation_type: &str,
    actor: Uuid,
) -> Result<bool> {
    let mut tx = conn.begin().await?;
    let removed: Option<Uuid> = sqlx::query_scalar(
        "UPDATE relations SET deleted_at = now() \
         WHERE from_id = $1 AND to_id = $2 AND type = $3 AND deleted_at IS NULL RETURNING id",
    )
    .bind(from_id)
    .bind(to_id)
    .bind(relation_type)
    .fetch_optional(&mut *tx)
    .await?;
    if let Some(relation_id) = removed {
        events::append(
            &mut tx,
            NewEvent::for_object("relation.deleted", from_id, actor).with_payload(
                serde_json::json!({ "relation_id": relation_id, "to_id": to_id, "type": relation_type }),
            ),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(removed.is_some())
}

/// Живые связи «от объекта», у которых другой конец тоже жив.
pub async fn outgoing(conn: &mut PgConnection, object_id: Uuid) -> Result<Vec<Relation>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {} FROM relations r JOIN objects o ON o.id = r.to_id \
         WHERE r.from_id = $1 AND r.deleted_at IS NULL AND o.deleted_at IS NULL \
         ORDER BY r.created_at",
        prefixed()
    )))
    .bind(object_id)
    .fetch_all(conn)
    .await?)
}

/// Живые связи «к объекту», у которых другой конец тоже жив (обратные ссылки).
pub async fn incoming(conn: &mut PgConnection, object_id: Uuid) -> Result<Vec<Relation>> {
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {} FROM relations r JOIN objects o ON o.id = r.from_id \
         WHERE r.to_id = $1 AND r.deleted_at IS NULL AND o.deleted_at IS NULL \
         ORDER BY r.created_at",
        prefixed()
    )))
    .bind(object_id)
    .fetch_all(conn)
    .await?)
}

fn prefixed() -> String {
    COLUMNS
        .split(", ")
        .map(|column| format!("r.{column}"))
        .collect::<Vec<_>>()
        .join(", ")
}
