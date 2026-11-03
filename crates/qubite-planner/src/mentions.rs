//! Производные упоминания: названия всегда читаются из объектов, а не из Yjs.
//! HTTP-слой проверяет Docs и передаёт модули, которые читателю разрешены.

use std::collections::HashSet;

use qubite_objects::{NewRelation, Result, objects, relations};
use serde::Serialize;
use sqlx::PgConnection;
use uuid::Uuid;

use crate::folder::DOC_TYPE;

pub const MENTIONS: &str = "mentions";
pub const MAX_LINKS: usize = 200;

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Target {
    pub id: Uuid,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub object_type: String,
    pub title: String,
}

#[derive(Debug, Serialize, sqlx::FromRow)]
pub struct Link {
    pub id: Uuid,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub object_type: String,
    pub title: String,
    pub deleted: bool,
}

pub fn valid_links(links: &[Uuid]) -> bool {
    links.len() <= MAX_LINKS && links.iter().collect::<HashSet<_>>().len() == links.len()
}

/// Вызывается под блокировкой документа внутри транзакции слияния Yjs.
pub async fn replace(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    links: &[Uuid],
    readable_modules: &[String],
) -> Result<()> {
    // Корзина не убирает упоминание из текста: такие цели нужны для сохранения
    // прежних связей, но создавать новые связи с ними нельзя.
    let targets: Vec<(Uuid, bool)> = sqlx::query_as(
        "SELECT id, deleted_at IS NOT NULL FROM objects \
         WHERE id = ANY($1) AND owner_id = $2 AND id <> $3 AND module_id = ANY($4)",
    )
    .bind(links)
    .bind(owner)
    .bind(id)
    .bind(readable_modules)
    .fetch_all(&mut *conn)
    .await?;
    // outgoing скрывает корзину; здесь нужны все живые связи, чтобы убрать
    // и те, чья цель уже удалена, если их больше нет в принятом списке.
    let current: Vec<Uuid> = sqlx::query_scalar(
        "SELECT to_id FROM relations WHERE from_id = $1 AND type = $2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(MENTIONS)
    .fetch_all(&mut *conn)
    .await?;
    for target in &current {
        if !targets.iter().any(|(id, _)| id == target) {
            relations::unlink(conn, id, *target, MENTIONS, owner).await?;
        }
    }
    for (target, deleted) in targets {
        if !deleted && !current.contains(&target) {
            match relations::link(conn, NewRelation::manual(id, target, MENTIONS, owner)).await {
                // Цель могли отправить в корзину между чтением и link.
                Err(qubite_objects::Error::NotFound | qubite_objects::Error::Deleted) => {}
                result => {
                    result?;
                }
            }
        }
    }
    Ok(())
}

pub async fn targets(
    conn: &mut PgConnection,
    owner: Uuid,
    query: &str,
    readable_modules: &[String],
) -> Result<Vec<Target>> {
    Ok(sqlx::query_as(
        "SELECT id, type, title FROM objects \
         WHERE owner_id = $1 AND deleted_at IS NULL AND module_id = ANY($3) \
         AND type IN ('docs.page', 'planner.task', 'planner.project') \
         AND strpos(lower(title), lower($2)) > 0 \
         ORDER BY (type = 'docs.page') DESC, updated_at DESC, id DESC LIMIT 8",
    )
    .bind(owner)
    .bind(query)
    .bind(readable_modules)
    .fetch_all(conn)
    .await?)
}

/// Чужой объект не существует для читателя, даже если в ядре есть связь с ним.
pub async fn require_target(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    doc_only: bool,
    readable_modules: &[String],
) -> Result<()> {
    objects::get(conn, id)
        .await?
        .filter(|object| {
            object.owner_id == owner
                && (!doc_only || object.object_type == DOC_TYPE)
                && readable_modules.contains(&object.module_id)
        })
        .ok_or(qubite_objects::Error::NotFound)?;
    Ok(())
}

pub async fn backlinks(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    readable_modules: &[String],
) -> Result<Vec<Target>> {
    let mut targets = Vec::new();
    for relation in relations::incoming(conn, id).await? {
        if relation.relation_type == MENTIONS
            && let Some(object) = objects::get(conn, relation.from_id).await?
            && object.owner_id == owner
            && readable_modules.contains(&object.module_id)
        {
            targets.push(Target {
                id: object.id,
                object_type: object.object_type,
                title: object.title,
            });
        }
    }
    Ok(targets)
}

pub async fn links(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    readable_modules: &[String],
) -> Result<Vec<Link>> {
    // В отличие от relations::outgoing, корзина остаётся видна чипам.
    Ok(sqlx::query_as(
        "SELECT o.id, o.type, o.title, o.deleted_at IS NOT NULL AS deleted \
         FROM relations r JOIN objects o ON o.id = r.to_id \
         WHERE r.from_id = $1 AND r.type = $2 AND r.deleted_at IS NULL \
         AND o.owner_id = $3 AND o.module_id = ANY($4) ORDER BY r.created_at, r.id",
    )
    .bind(id)
    .bind(MENTIONS)
    .bind(owner)
    .bind(readable_modules)
    .fetch_all(conn)
    .await?)
}
