//! Проект как папка (PROJ-001, D-470…D-479): файлы, документы и лента
//! изменений проекта.
//!
//! - **Файлы** — вложения ядра у объекта проекта (содержимое по хешу,
//!   [`qubite_objects::BlobStore`]): одинаковый файл лежит на диске один раз.
//! - **Документы** — объекты `docs.page` с текстом Markdown (таблица
//!   `docs_pages`); в проект входят связью `part_of`, как дела. Один документ
//!   может быть в нескольких проектах. Настоящий редактор — DOC-002.
//! - **Лента** — журнал событий ядра по проекту, его делам и документам:
//!   кто что создал, поменял, отметил, удалил (лента агента — отдельно,
//!   с откатом, в `qubite-agent::timeline`).
//!
//! Видно только владельцу проекта: чужой проект «не существует» (`NotFound`).
//! Участников у проектов пока нет (команды — позже), поэтому «владелец или
//! участник» сейчас — только владелец. Права модуля (`planner`, `docs`)
//! проверяет HTTP-слой до вызова этих функций.

use qubite_objects::{Attachment, BlobStore, NewObject, NewRelation, files, objects, relations};
use serde::Serialize;
use sqlx::{Connection, PgConnection};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{Error, PART_OF, PROJECT_TYPE, Project, Result, TASK_TYPE, get_project};

/// Тип объекта «документ».
pub const DOC_TYPE: &str = "docs.page";
/// Модуль документов (права).
pub const DOCS_MODULE: &str = "docs";
/// Самый большой файл проекта (D-473).
pub const MAX_FILE_BYTES: usize = 25 * 1024 * 1024;
/// Сколько файлов может быть у проекта.
pub const MAX_FILES: usize = 200;
pub const MAX_FILE_NAME_CHARS: usize = 255;
pub const MAX_DOC_TITLE_CHARS: usize = 200;
pub const MAX_DOC_CHARS: usize = 200_000;

/// Живой проект владельца. Чужой, удалённый или нет такого — `NotFound`.
pub async fn own_project(conn: &mut PgConnection, owner: Uuid, id: Uuid) -> Result<Project> {
    get_project(conn, owner, id)
        .await?
        .filter(|project| !project.deleted)
        .ok_or(Error::NotFound)
}

// ---------------------------------------------------------------- файлы

/// Имя файла как его покажем: без папок, лишних пробелов и служебных символов.
pub fn clean_file_name(raw: &str) -> Result<String> {
    let base = raw.rsplit(['/', '\\']).next().unwrap_or_default();
    let name: String = base
        .chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let name = name.trim_matches('.').trim();
    if name.is_empty() {
        return Err(Error::Invalid("у файла нет имени".into()));
    }
    if name.chars().count() > MAX_FILE_NAME_CHARS {
        return Err(Error::Invalid(format!(
            "имя файла длиннее {MAX_FILE_NAME_CHARS} знаков"
        )));
    }
    Ok(name.to_owned())
}

/// «отчёт.pdf» уже есть — «отчёт (2).pdf», потом «(3)»…
fn free_name(name: &str, taken: &[Attachment]) -> String {
    let busy = |candidate: &str| taken.iter().any(|file| file.name == candidate);
    if !busy(name) {
        return name.to_owned();
    }
    let (stem, ext) = match name.rsplit_once('.') {
        Some((stem, ext)) if !stem.is_empty() => (stem, format!(".{ext}")),
        _ => (name, String::new()),
    };
    (2..)
        .map(|n| format!("{stem} ({n}){ext}"))
        .find(|candidate| !busy(candidate))
        .unwrap_or_else(|| name.to_owned())
}

/// Файлы проекта: от старых к новым.
pub async fn project_files(
    conn: &mut PgConnection,
    owner: Uuid,
    project: Uuid,
) -> Result<Vec<Attachment>> {
    own_project(conn, owner, project).await?;
    files::attachments(conn, project).await
}

/// Положить файл в проект. Имя занято — допишется «(2)». Возвращает файл.
pub async fn add_file(
    conn: &mut PgConnection,
    store: &BlobStore,
    owner: Uuid,
    project: Uuid,
    name: &str,
    mime: &str,
    content: &[u8],
) -> Result<Attachment> {
    own_project(conn, owner, project).await?;
    let name = clean_file_name(name)?;
    if content.len() > MAX_FILE_BYTES {
        return Err(Error::Invalid(format!(
            "файл больше {} МБ",
            MAX_FILE_BYTES / 1024 / 1024
        )));
    }
    let taken = files::attachments(conn, project).await?;
    if taken.len() >= MAX_FILES {
        return Err(Error::Invalid(format!(
            "в проекте уже {MAX_FILES} файлов — убери ненужные"
        )));
    }
    let name = free_name(&name, &taken);
    let mime = if mime.trim().is_empty() || mime.len() > 255 {
        "application/octet-stream"
    } else {
        mime.trim()
    };
    let blob = store.put(conn, content, mime).await?;
    files::attach(conn, project, &blob, &name, owner).await?;
    files::attachments(conn, project)
        .await?
        .into_iter()
        .find(|file| file.name == name)
        .ok_or(Error::NotFound)
}

/// Файл проекта по имени (для скачивания).
pub async fn project_file(
    conn: &mut PgConnection,
    owner: Uuid,
    project: Uuid,
    name: &str,
) -> Result<Attachment> {
    project_files(conn, owner, project)
        .await?
        .into_iter()
        .find(|file| file.name == name)
        .ok_or(Error::NotFound)
}

/// Убрать файл из проекта.
pub async fn remove_file(
    conn: &mut PgConnection,
    owner: Uuid,
    project: Uuid,
    name: &str,
) -> Result<()> {
    own_project(conn, owner, project).await?;
    if files::detach(conn, project, name, owner).await? {
        Ok(())
    } else {
        Err(Error::NotFound)
    }
}

// ---------------------------------------------------------------- документы

/// Документ.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Doc {
    pub id: Uuid,
    pub title: String,
    pub body: String,
    pub revision: i64,
    /// Проекты, в которые входит документ.
    pub project_ids: Vec<Uuid>,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

impl Doc {
    /// Начало текста для списка (одна строка).
    pub fn preview(&self) -> String {
        let line = self
            .body
            .lines()
            .map(|line| line.trim_start_matches(['#', '>', '-', '*', ' ']).trim())
            .find(|line| !line.is_empty())
            .unwrap_or_default();
        let mut preview: String = line.chars().take(140).collect();
        if line.chars().count() > 140 {
            preview.push('…');
        }
        preview
    }
}

#[derive(sqlx::FromRow)]
struct DocRow {
    id: Uuid,
    title: String,
    body: String,
    revision: i64,
    project_ids: Vec<Uuid>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
}

impl From<DocRow> for Doc {
    fn from(row: DocRow) -> Self {
        Self {
            id: row.id,
            title: row.title,
            body: row.body,
            revision: row.revision,
            project_ids: row.project_ids,
            created_at: row.created_at,
            updated_at: row.updated_at,
        }
    }
}

const DOC_SELECT: &str = "SELECT o.id, o.title, d.body, o.revision, o.created_at, o.updated_at, \
     coalesce((SELECT array_agg(r.to_id ORDER BY r.created_at) FROM relations r \
       JOIN objects p ON p.id = r.to_id \
       WHERE r.from_id = o.id AND r.type = 'part_of' AND r.deleted_at IS NULL \
         AND p.type = 'planner.project' AND p.deleted_at IS NULL), '{}') AS project_ids \
     FROM objects o JOIN docs_pages d ON d.object_id = o.id";

fn check_title(title: &str) -> Result<String> {
    let title = title.split_whitespace().collect::<Vec<_>>().join(" ");
    if title.is_empty() {
        return Err(Error::Invalid("у документа нет названия".into()));
    }
    if title.chars().count() > MAX_DOC_TITLE_CHARS {
        return Err(Error::Invalid(format!(
            "название длиннее {MAX_DOC_TITLE_CHARS} знаков"
        )));
    }
    Ok(title)
}

fn check_body(body: &str) -> Result<()> {
    if body.chars().count() > MAX_DOC_CHARS {
        return Err(Error::Invalid(format!(
            "документ длиннее {MAX_DOC_CHARS} знаков"
        )));
    }
    Ok(())
}

/// Свой живой документ.
pub async fn get_doc(conn: &mut PgConnection, owner: Uuid, id: Uuid) -> Result<Doc> {
    let row: Option<DocRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{DOC_SELECT} WHERE o.id = $1 AND o.owner_id = $2 AND o.deleted_at IS NULL"
    )))
    .bind(id)
    .bind(owner)
    .fetch_optional(conn)
    .await?;
    row.map(Doc::from).ok_or(Error::NotFound)
}

/// Все живые документы владельца (свежие сверху) — чтобы привязать к проекту.
pub async fn list_docs(conn: &mut PgConnection, owner: Uuid) -> Result<Vec<Doc>> {
    let rows: Vec<DocRow> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{DOC_SELECT} WHERE o.owner_id = $1 AND o.deleted_at IS NULL \
         ORDER BY o.updated_at DESC, o.id LIMIT 500"
    )))
    .bind(owner)
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(Doc::from).collect())
}

/// Документы проекта (свежие сверху).
pub async fn project_docs(conn: &mut PgConnection, owner: Uuid, project: Uuid) -> Result<Vec<Doc>> {
    own_project(conn, owner, project).await?;
    Ok(list_docs(conn, owner)
        .await?
        .into_iter()
        .filter(|doc| doc.project_ids.contains(&project))
        .collect())
}

/// Новый документ сразу в проекте.
pub async fn create_doc(
    conn: &mut PgConnection,
    owner: Uuid,
    project: Uuid,
    title: &str,
    body: &str,
) -> Result<Doc> {
    own_project(conn, owner, project).await?;
    let title = check_title(title)?;
    check_body(body)?;
    let mut tx = conn.begin().await?;
    let object = objects::create(&mut tx, NewObject::new(DOC_TYPE, owner, title)).await?;
    sqlx::query("INSERT INTO docs_pages (object_id, body) VALUES ($1, $2)")
        .bind(object.id)
        .bind(body)
        .execute(&mut *tx)
        .await?;
    relations::link(
        &mut tx,
        NewRelation::manual(object.id, project, PART_OF, owner),
    )
    .await?;
    tx.commit().await?;
    get_doc(conn, owner, object.id).await
}

/// Привязать свой документ к проекту (уже привязан — ничего не меняется).
pub async fn link_doc(
    conn: &mut PgConnection,
    owner: Uuid,
    project: Uuid,
    doc: Uuid,
) -> Result<Doc> {
    own_project(conn, owner, project).await?;
    get_doc(conn, owner, doc).await?;
    relations::link(conn, NewRelation::manual(doc, project, PART_OF, owner)).await?;
    get_doc(conn, owner, doc).await
}

/// Убрать документ из проекта. Сам документ остаётся.
pub async fn unlink_doc(
    conn: &mut PgConnection,
    owner: Uuid,
    project: Uuid,
    doc: Uuid,
) -> Result<()> {
    own_project(conn, owner, project).await?;
    get_doc(conn, owner, doc).await?;
    if relations::unlink(conn, doc, project, PART_OF, owner).await? {
        Ok(())
    } else {
        Err(Error::NotFound)
    }
}

/// Поправить документ (название и текст) с проверкой версии.
pub async fn edit_doc(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    title: &str,
    body: &str,
    revision: i64,
) -> Result<Doc> {
    let current = get_doc(conn, owner, id).await?;
    let title = check_title(title)?;
    check_body(body)?;
    if current.revision != revision {
        return Err(Error::Conflict {
            expected: revision,
            current: current.revision,
        });
    }
    if current.title == title && current.body == body {
        return Ok(current);
    }
    let mut tx = conn.begin().await?;
    let mut expected = revision;
    if current.title != title {
        expected = objects::rename(&mut tx, id, expected, &title, owner)
            .await?
            .revision;
    }
    if current.body != body {
        sqlx::query("UPDATE docs_pages SET body = $2 WHERE object_id = $1")
            .bind(id)
            .bind(body)
            .execute(&mut *tx)
            .await?;
        objects::bump(&mut tx, id, expected, owner, &["body"]).await?;
    }
    tx.commit().await?;
    get_doc(conn, owner, id).await
}

// ---------------------------------------------------------------- лента

/// Строка ленты проекта.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FeedItem {
    pub seq: i64,
    pub at: OffsetDateTime,
    /// `created`, `changed`, `done`, `deleted`, `restored`, `file_added`,
    /// `file_removed`, `doc_linked`, `doc_unlinked`.
    pub kind: String,
    /// `project`, `task`, `doc`.
    pub object: String,
    pub object_id: Uuid,
    /// Название объекта сейчас.
    pub title: String,
    /// Что поменялось (`due_date`, `status`, …) или имя файла.
    pub details: Vec<String>,
    /// Кто: `owner` — ты, `system` — сервер (повторения, напоминания).
    pub by: String,
}

#[derive(sqlx::FromRow)]
struct EventRow {
    seq: i64,
    at: OffsetDateTime,
    actor_id: Option<Uuid>,
    object_id: Uuid,
    kind: String,
    payload: serde_json::Value,
    object_type: String,
    title: String,
    status: Option<String>,
}

/// Что происходило в проекте: сам проект, его дела и документы (ушедшие из
/// проекта — до ухода). Свежее сверху; `before` — курсор `seq`.
pub async fn project_feed(
    conn: &mut PgConnection,
    owner: Uuid,
    project: Uuid,
    before: Option<i64>,
    limit: i64,
) -> Result<Vec<FeedItem>> {
    own_project(conn, owner, project).await?;
    let rows: Vec<EventRow> = sqlx::query_as(
        "WITH members AS ( \
             SELECT r.from_id AS id, r.deleted_at AS until FROM relations r \
               WHERE r.to_id = $1 AND r.type = 'part_of' \
             UNION ALL SELECT $1::uuid, NULL::timestamptz \
         ) \
         SELECT e.seq, e.at, e.actor_id, e.object_id, e.kind, e.payload, \
                o.type AS object_type, o.title, t.status \
         FROM events e \
         JOIN objects o ON o.id = e.object_id AND o.owner_id = $2 \
         LEFT JOIN planner_tasks t ON t.object_id = o.id \
         WHERE e.object_id IN (SELECT id FROM members) \
           AND EXISTS (SELECT 1 FROM members m WHERE m.id = e.object_id \
                       AND (m.until IS NULL OR e.at <= m.until)) \
           AND e.kind IN ('object.created', 'object.updated', 'object.deleted', \
                          'object.restored', 'attachment.added', 'attachment.removed', \
                          'relation.created', 'relation.deleted') \
           AND ($3::bigint IS NULL OR e.seq < $3) \
         ORDER BY e.seq DESC LIMIT $4",
    )
    .bind(project)
    .bind(owner)
    .bind(before)
    .bind(limit.clamp(1, 200))
    .fetch_all(conn)
    .await?;
    let items: Vec<FeedItem> = rows
        .into_iter()
        .filter_map(|row| feed_item(row, project))
        .collect();
    // Документ, созданный прямо в проекте, входит в него той же операцией —
    // строка «в проекте» рядом с «новый» лишняя.
    let born: Vec<(Uuid, OffsetDateTime)> = items
        .iter()
        .filter(|item| item.kind == "created")
        .map(|item| (item.object_id, item.at))
        .collect();
    Ok(items
        .into_iter()
        .filter(|item| item.kind != "doc_linked" || !born.contains(&(item.object_id, item.at)))
        .collect())
}

fn feed_item(row: EventRow, project: Uuid) -> Option<FeedItem> {
    let object = match row.object_type.as_str() {
        PROJECT_TYPE => "project",
        TASK_TYPE => "task",
        DOC_TYPE => "doc",
        _ => return None,
    };
    let text = |key: &str| row.payload.get(key).and_then(|v| v.as_str());
    let fields: Vec<String> = row
        .payload
        .get("fields")
        .and_then(|v| v.as_array())
        .map(|list| {
            list.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default();
    let (kind, details) = match row.kind.as_str() {
        "object.created" => ("created", Vec::new()),
        // Отметка «сделано»: поменялся статус, и дело сейчас сделано.
        "object.updated"
            if fields.iter().any(|f| f == "status") && row.status.as_deref() == Some("done") =>
        {
            ("done", Vec::new())
        }
        "object.updated" => ("changed", fields),
        "object.deleted" => ("deleted", Vec::new()),
        "object.restored" => ("restored", Vec::new()),
        "attachment.added" => ("file_added", vec![text("name")?.to_owned()]),
        "attachment.removed" => ("file_removed", vec![text("name")?.to_owned()]),
        // Связь «в проекте» у документа; связи дел видны их созданием.
        "relation.created" | "relation.deleted"
            if object == "doc"
                && text("type") == Some(PART_OF)
                && text("to_id") == Some(project.to_string().as_str()) =>
        {
            if row.kind == "relation.created" {
                ("doc_linked", Vec::new())
            } else {
                ("doc_unlinked", Vec::new())
            }
        }
        _ => return None,
    };
    Some(FeedItem {
        seq: row.seq,
        at: row.at,
        kind: kind.to_owned(),
        object: object.to_owned(),
        object_id: row.object_id,
        title: row.title,
        details,
        by: if row.actor_id.is_some() {
            "owner"
        } else {
            "system"
        }
        .to_owned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_names_are_cleaned() {
        assert_eq!(
            clean_file_name("C:\\Users\\k\\отчёт.pdf").unwrap(),
            "отчёт.pdf"
        );
        assert_eq!(clean_file_name("../../etc/passwd").unwrap(), "passwd");
        assert_eq!(
            clean_file_name("  план   урока .docx ").unwrap(),
            "план урока .docx"
        );
        assert!(clean_file_name("..").is_err());
        assert!(clean_file_name("папка/").is_err());
        assert!(clean_file_name(&"я".repeat(300)).is_err());
    }

    #[test]
    fn taken_names_get_a_number() {
        let file = |name: &str| Attachment {
            object_id: Uuid::nil(),
            name: name.into(),
            sha256: qubite_objects::Sha256([0; 32]),
            size: 1,
            mime: "text/plain".into(),
            created_at: OffsetDateTime::UNIX_EPOCH,
        };
        let taken = [file("отчёт.pdf"), file("отчёт (2).pdf"), file("README")];
        assert_eq!(free_name("план.pdf", &taken), "план.pdf");
        assert_eq!(free_name("отчёт.pdf", &taken), "отчёт (3).pdf");
        assert_eq!(free_name("README", &taken), "README (2)");
    }

    #[test]
    fn preview_skips_markup() {
        let doc = |body: &str| Doc {
            id: Uuid::nil(),
            title: "t".into(),
            body: body.into(),
            revision: 1,
            project_ids: vec![],
            created_at: OffsetDateTime::UNIX_EPOCH,
            updated_at: OffsetDateTime::UNIX_EPOCH,
        };
        assert_eq!(doc("# План\n\nтекст").preview(), "План");
        assert_eq!(doc("\n\n- [ ] шаг").preview(), "[ ] шаг");
        assert_eq!(doc("").preview(), "");
    }
}
