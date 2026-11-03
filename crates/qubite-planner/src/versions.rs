//! Полные снимки документов. Связи принадлежат текущему документу, не версии.

use sqlx::{Connection, PgConnection};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("not_found")]
    NotFound,
    #[error("invalid_name")]
    InvalidName,
    #[error("empty_state")]
    EmptyState,
    #[error("not_named")]
    NotNamed,
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

type Result<T> = std::result::Result<T, Error>;

#[derive(sqlx::FromRow)]
pub struct Summary {
    pub id: Uuid,
    pub kind: String,
    pub name: Option<String>,
    pub title: String,
    pub created_at: OffsetDateTime,
    pub preview: String,
    pub size: i32,
}

#[derive(sqlx::FromRow)]
pub struct Version {
    #[sqlx(flatten)]
    pub summary: Summary,
    pub ystate: Vec<u8>,
    pub text: String,
}

const SUMMARY: &str = "id, kind, name, title, created_at, left(text, 120) AS preview, \
                      octet_length(ystate) AS size";

/// Читать историю можно и в корзине. Запись сериализуется с /y и удалением.
async fn require_doc(conn: &mut PgConnection, owner: Uuid, doc: Uuid, write: bool) -> Result<()> {
    let query = if write {
        "SELECT o.id FROM objects o JOIN docs_pages d ON d.object_id = o.id \
         WHERE o.id = $1 AND o.owner_id = $2 AND o.type = 'docs.page' \
         AND o.deleted_at IS NULL FOR NO KEY UPDATE OF o"
    } else {
        "SELECT o.id FROM objects o JOIN docs_pages d ON d.object_id = o.id \
         WHERE o.id = $1 AND o.owner_id = $2 AND o.type = 'docs.page'"
    };
    sqlx::query_scalar::<_, Uuid>(sqlx::AssertSqlSafe(query))
        .bind(doc)
        .bind(owner)
        .fetch_optional(conn)
        .await?
        .ok_or(Error::NotFound)?;
    Ok(())
}

pub async fn list(
    conn: &mut PgConnection,
    owner: Uuid,
    doc: Uuid,
    before: Option<OffsetDateTime>,
    limit: i64,
) -> Result<Vec<Summary>> {
    require_doc(conn, owner, doc, false).await?;
    Ok(sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SUMMARY} FROM docs_versions WHERE doc_id = $1 AND owner_id = $2 \
         AND ($3::timestamptz IS NULL OR created_at < $3) \
         ORDER BY created_at DESC, id DESC LIMIT $4"
    )))
    .bind(doc)
    .bind(owner)
    .bind(before)
    .bind(limit.clamp(1, 50))
    .fetch_all(conn)
    .await?)
}

pub async fn get(conn: &mut PgConnection, owner: Uuid, doc: Uuid, id: Uuid) -> Result<Version> {
    require_doc(conn, owner, doc, false).await?;
    sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "SELECT {SUMMARY}, ystate, text FROM docs_versions \
         WHERE id = $1 AND doc_id = $2 AND owner_id = $3"
    )))
    .bind(id)
    .bind(doc)
    .bind(owner)
    .fetch_optional(conn)
    .await?
    .ok_or(Error::NotFound)
}

fn check_name(name: &str) -> Result<&str> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(Error::InvalidName);
    }
    Ok(name)
}

pub async fn create(
    conn: &mut PgConnection,
    owner: Uuid,
    doc: Uuid,
    name: &str,
) -> Result<Version> {
    let mut tx = conn.begin().await?;
    require_doc(&mut tx, owner, doc, true).await?;
    let name = check_name(name)?;
    let id = Uuid::now_v7();
    let inserted = sqlx::query(
        "INSERT INTO docs_versions (id, doc_id, owner_id, kind, name, title, ystate, text, created_by) \
         SELECT $1, o.id, $2, 'named', $3, o.title, d.ystate, d.body, $2 \
         FROM objects o JOIN docs_pages d ON d.object_id = o.id \
         WHERE o.id = $4 AND d.ystate IS NOT NULL AND octet_length(d.ystate) > 0",
    )
    .bind(id)
    .bind(owner)
    .bind(name)
    .bind(doc)
    .execute(&mut *tx)
    .await?;
    if inserted.rows_affected() == 0 {
        return Err(Error::EmptyState);
    }
    let version = get(&mut tx, owner, doc, id).await?;
    tx.commit().await?;
    Ok(version)
}

pub async fn rename(
    conn: &mut PgConnection,
    owner: Uuid,
    doc: Uuid,
    id: Uuid,
    name: &str,
) -> Result<Version> {
    let mut tx = conn.begin().await?;
    require_doc(&mut tx, owner, doc, true).await?;
    let version = get(&mut tx, owner, doc, id).await?;
    if version.summary.kind != "named" {
        return Err(Error::NotNamed);
    }
    let name = check_name(name)?;
    sqlx::query("UPDATE docs_versions SET name = $2 WHERE id = $1")
        .bind(id)
        .bind(name)
        .execute(&mut *tx)
        .await?;
    let mut version = version;
    version.summary.name = Some(name.to_owned());
    tx.commit().await?;
    Ok(version)
}

pub async fn delete(conn: &mut PgConnection, owner: Uuid, doc: Uuid, id: Uuid) -> Result<()> {
    let mut tx = conn.begin().await?;
    require_doc(&mut tx, owner, doc, true).await?;
    let version = get(&mut tx, owner, doc, id).await?;
    if version.summary.kind != "named" {
        return Err(Error::NotNamed);
    }
    sqlx::query("DELETE FROM docs_versions WHERE id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;
    Ok(())
}

/// Вызывать под блокировкой objects, до записи слитого состояния в docs_pages.
/// Слияние уже проверено на временной копии: битый пакет не создаёт снимков.
pub(crate) async fn before_update(
    conn: &mut PgConnection,
    owner: Uuid,
    doc: Uuid,
    changed: bool,
    restore: bool,
) -> std::result::Result<(), sqlx::Error> {
    let inserted = sqlx::query(
        "INSERT INTO docs_versions (id, doc_id, owner_id, kind, title, ystate, text, created_by) \
         SELECT $1, o.id, $2, $3, o.title, d.ystate, d.body, $2 \
         FROM objects o JOIN docs_pages d ON d.object_id = o.id \
         WHERE o.id = $4 AND o.owner_id = $2 AND d.ystate IS NOT NULL \
         AND octet_length(d.ystate) > 0 AND ($5 OR ($6 AND NOT EXISTS ( \
             SELECT 1 FROM docs_versions v WHERE v.doc_id = o.id \
             AND v.created_at > now() - interval '10 minutes')))",
    )
    .bind(Uuid::now_v7())
    .bind(owner)
    .bind(if restore { "before_restore" } else { "auto" })
    .bind(doc)
    .bind(restore)
    .bind(changed)
    .execute(&mut *conn)
    .await?;
    if inserted.rows_affected() > 0 {
        // Сутки в UTC: результат не зависит от часового пояса соединения.
        // Сначала разрежаем старые дни, затем ограничиваем общий размер истории.
        sqlx::query(
            "DELETE FROM docs_versions WHERE id IN ( \
             SELECT id FROM (SELECT id, row_number() OVER ( \
                 PARTITION BY (created_at AT TIME ZONE 'UTC')::date \
                 ORDER BY created_at DESC, id DESC) AS n \
                 FROM docs_versions WHERE doc_id = $1 AND kind = 'auto' \
                 AND created_at < now() - interval '30 days') old WHERE n > 1)",
        )
        .bind(doc)
        .execute(&mut *conn)
        .await?;
        sqlx::query(
            "DELETE FROM docs_versions WHERE id IN (SELECT id FROM docs_versions \
             WHERE doc_id = $1 AND kind = 'auto' ORDER BY created_at DESC, id DESC OFFSET 100)",
        )
        .bind(doc)
        .execute(conn)
        .await?;
    }
    Ok(())
}
