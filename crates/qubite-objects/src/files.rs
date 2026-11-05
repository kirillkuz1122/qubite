//! Файлы по хешу содержимого: одинаковый файл хранится на диске один раз.
//!
//! Путь файла: `<root>/ab/cd/abcd…` (sha256 в hex). Запись атомарна: сначала
//! во временный файл в `<root>/tmp`, затем переименование — недописанный файл
//! никогда не окажется на месте настоящего.

use std::path::{Path, PathBuf};

use serde::Serialize;
use sha2::{Digest, Sha256 as Hasher};
use sqlx::{Connection, PgConnection};
use time::OffsetDateTime;
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use uuid::Uuid;

use crate::{Error, NewEvent, Result, events, new_id};

/// SHA-256 содержимого файла.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Sha256(pub [u8; 32]);

impl Sha256 {
    pub fn to_hex(self) -> String {
        hex::encode(self.0)
    }

    pub fn from_hex(value: &str) -> Result<Self> {
        let bytes = hex::decode(value).map_err(|_| Error::Invalid("неверный hex".into()))?;
        let array: [u8; 32] = bytes
            .try_into()
            .map_err(|_| Error::Invalid("sha256 должен быть 32 байта".into()))?;
        Ok(Self(array))
    }
}

impl Serialize for Sha256 {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_hex())
    }
}

/// Сохранённое содержимое.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Blob {
    pub sha256: Sha256,
    pub size: i64,
    pub mime: String,
}

/// Файл, прикреплённый к объекту под именем.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Attachment {
    pub object_id: Uuid,
    pub name: String,
    pub sha256: Sha256,
    pub size: i64,
    pub mime: String,
    pub created_at: OffsetDateTime,
}

/// Хранилище файлов в каталоге на диске.
#[derive(Debug, Clone)]
pub struct BlobStore {
    root: PathBuf,
}

impl BlobStore {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// Где лежит (или будет лежать) файл с этим хешем.
    pub fn path(&self, sha: Sha256) -> PathBuf {
        let hex = sha.to_hex();
        self.root.join(&hex[0..2]).join(&hex[2..4]).join(hex)
    }

    /// Сохранить содержимое потока. Если такой файл уже есть — не дублирует.
    pub async fn put(
        &self,
        conn: &mut PgConnection,
        mut content: impl AsyncRead + Unpin,
        mime: &str,
    ) -> Result<Blob> {
        let tmp_dir = self.root.join("tmp");
        tokio::fs::create_dir_all(&tmp_dir).await?;
        let tmp_path = tmp_dir.join(new_id().to_string());
        // Если запрос отменили (таймаут, обрыв), future просто бросают: без охранника
        // временный файл остался бы на диске. Охранник убирает его при любом выходе.
        let mut tmp = TempFile(Some(tmp_path.clone()));

        let (sha, size) = write_hashing(&mut content, &tmp_path).await?;

        let final_path = self.path(sha);
        if tokio::fs::try_exists(&final_path).await? {
            tokio::fs::remove_file(&tmp_path).await?;
            tmp.0 = None;
        } else {
            if let Some(parent) = final_path.parent() {
                tokio::fs::create_dir_all(parent).await?;
            }
            tokio::fs::rename(&tmp_path, &final_path).await?;
            tmp.0 = None;
        }

        sqlx::query(
            "INSERT INTO file_blobs (sha256, size, mime) VALUES ($1, $2, $3) \
             ON CONFLICT (sha256) DO NOTHING",
        )
        .bind(sha.0.as_slice())
        .bind(size)
        .bind(mime)
        .execute(conn)
        .await
        .map_err(Error::from_db)?;

        Ok(Blob {
            sha256: sha,
            size,
            mime: mime.to_owned(),
        })
    }

    /// Открыть сохранённый файл для чтения.
    pub async fn open(&self, sha: Sha256) -> Result<tokio::fs::File> {
        Ok(tokio::fs::File::open(self.path(sha)).await?)
    }
}

/// Временный файл, который удаляется, пока его не «забыли» (`None`) после переноса.
struct TempFile(Option<PathBuf>);

impl Drop for TempFile {
    fn drop(&mut self) {
        if let Some(path) = self.0.take() {
            let _ = std::fs::remove_file(path);
        }
    }
}

async fn write_hashing(
    content: &mut (impl AsyncRead + Unpin),
    path: &Path,
) -> Result<(Sha256, i64)> {
    let mut file = tokio::fs::File::create(path).await?;
    let mut hasher = Hasher::new();
    let mut size: i64 = 0;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let read = content.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        let chunk = &buffer[..read];
        hasher.update(chunk);
        file.write_all(chunk).await?;
        size += i64::try_from(read).unwrap_or(i64::MAX);
    }
    file.sync_all().await?;
    Ok((Sha256(hasher.finalize().into()), size))
}

/// Прикрепить уже сохранённый файл к объекту под именем.
pub async fn attach(
    conn: &mut PgConnection,
    object_id: Uuid,
    blob: &Blob,
    name: &str,
    actor: Uuid,
) -> Result<()> {
    let mut tx = conn.begin().await?;
    sqlx::query(
        "INSERT INTO attachments (object_id, sha256, name, created_by) VALUES ($1, $2, $3, $4)",
    )
    .bind(object_id)
    .bind(blob.sha256.0.as_slice())
    .bind(name)
    .bind(actor)
    .execute(&mut *tx)
    .await
    .map_err(|error| match &error {
        sqlx::Error::Database(db) if db.code().as_deref() == Some("23505") => {
            Error::Invalid(format!("у объекта уже есть вложение «{name}»"))
        }
        _ => Error::from_db(error),
    })?;
    events::append(
        &mut tx,
        NewEvent::for_object("attachment.added", object_id, actor).with_payload(
            serde_json::json!({ "name": name, "sha256": blob.sha256, "size": blob.size }),
        ),
    )
    .await?;
    tx.commit().await?;
    Ok(())
}

/// Вложения объекта.
pub async fn attachments(conn: &mut PgConnection, object_id: Uuid) -> Result<Vec<Attachment>> {
    let rows: Vec<(Uuid, String, Vec<u8>, i64, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT a.object_id, a.name, a.sha256, b.size, b.mime, a.created_at \
         FROM attachments a JOIN file_blobs b ON b.sha256 = a.sha256 \
         WHERE a.object_id = $1 ORDER BY a.created_at, a.name",
    )
    .bind(object_id)
    .fetch_all(conn)
    .await?;
    rows.into_iter()
        .map(|(object_id, name, sha, size, mime, created_at)| {
            let sha: [u8; 32] = sha
                .try_into()
                .map_err(|_| Error::Invalid("повреждён хеш файла".into()))?;
            Ok(Attachment {
                object_id,
                name,
                sha256: Sha256(sha),
                size,
                mime,
                created_at,
            })
        })
        .collect()
}

/// Открепить файл от объекта. Содержимое остаётся на диске (его могут
/// использовать другие объекты). `false` — такого вложения не было.
pub async fn detach(
    conn: &mut PgConnection,
    object_id: Uuid,
    name: &str,
    actor: Uuid,
) -> Result<bool> {
    let mut tx = conn.begin().await?;
    let removed: Option<Vec<u8>> = sqlx::query_scalar(
        "DELETE FROM attachments WHERE object_id = $1 AND name = $2 RETURNING sha256",
    )
    .bind(object_id)
    .bind(name)
    .fetch_optional(&mut *tx)
    .await?;
    if removed.is_some() {
        events::append(
            &mut tx,
            NewEvent::for_object("attachment.removed", object_id, actor)
                .with_payload(serde_json::json!({ "name": name })),
        )
        .await?;
    }
    tx.commit().await?;
    Ok(removed.is_some())
}
