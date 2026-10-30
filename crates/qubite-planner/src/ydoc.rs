//! Непрозрачное состояние Yjs, lib0 v1 (Yjs 13.6). Дерево Lexical сервер не читает.

use qubite_objects::objects;
use qubite_sync_server::{BoxFuture, FieldsError, TypeFields};
use serde_json::{Value, json};
use sqlx::{Connection, PgConnection};
use uuid::Uuid;
use yrs::updates::{
    decoder::{Decode, Decoder, DecoderV1},
    encoder::Encode,
};
use yrs::{Doc, ReadTxn, StateVector, Transact, Update};

use crate::folder::{DOC_TYPE, MAX_DOC_CHARS};

pub const MAX_UPDATE_BYTES: usize = 512 * 1024;
pub const MAX_STATE_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("invalid_update")]
    InvalidUpdate,
    #[error("update_too_large")]
    UpdateTooLarge,
    #[error("doc_too_large")]
    DocTooLarge,
    #[error("text_too_large")]
    TextTooLarge,
    #[error("seed_taken")]
    SeedTaken,
    #[error(transparent)]
    Object(#[from] qubite_objects::Error),
    #[error(transparent)]
    Db(#[from] sqlx::Error),
}

/// Отклоняем и неполный буфер, и мусор после корректного сообщения.
fn decode<T: Decode>(bytes: &[u8]) -> Result<T, Error> {
    let mut decoder = DecoderV1::from(bytes);
    let value = T::decode(&mut decoder).map_err(|_| Error::InvalidUpdate)?;
    if !decoder
        .read_to_end()
        .map_err(|_| Error::InvalidUpdate)?
        .is_empty()
    {
        return Err(Error::InvalidUpdate);
    }
    Ok(value)
}

fn load(state: Option<&[u8]>) -> Result<Doc, Error> {
    let doc = Doc::new();
    if let Some(state) = state {
        doc.transact_mut()
            .apply_update(decode::<Update>(state)?)
            .map_err(|_| Error::InvalidUpdate)?;
    }
    Ok(doc)
}

/// Вся работа с недоверенными байтами — на временной копии. Даже panic
/// декодера/интегратора не меняет сохранённое состояние и не роняет HTTP-задачу.
fn guarded<T>(f: impl FnOnce() -> Result<T, Error>) -> Result<T, Error> {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(f));
    result.map_err(|_| Error::InvalidUpdate)?
}

pub struct Merged {
    pub state: Vec<u8>,
    pub sv: Vec<u8>,
    pub changed: bool,
}

pub fn merge(state: Option<&[u8]>, update: &[u8]) -> Result<Merged, Error> {
    if update.len() > MAX_UPDATE_BYTES {
        return Err(Error::UpdateTooLarge);
    }
    guarded(|| {
        let update = decode::<Update>(update)?;
        let doc = load(state)?;
        let before = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        doc.transact_mut()
            .apply_update(update)
            .map_err(|_| Error::InvalidUpdate)?;
        let txn = doc.transact();
        // encode_state_as_update_v1 включает ещё не интегрированные обновления:
        // пакет, пришедший раньше своих зависимостей, нельзя потерять.
        let after = txn.encode_state_as_update_v1(&StateVector::default());
        if after.len() > MAX_STATE_BYTES {
            return Err(Error::DocTooLarge);
        }
        let changed = state.is_none() || before != after;
        Ok(Merged {
            state: after,
            sv: txn.state_vector().encode_v1(),
            changed,
        })
    })
}

pub struct Exchange {
    pub update: Vec<u8>,
    pub sv: Vec<u8>,
    pub seed_markdown: Option<String>,
}

pub fn diff(state: Option<&[u8]>, sv: &[u8]) -> Result<Exchange, Error> {
    guarded(|| {
        let sv = if sv.is_empty() {
            StateVector::default()
        } else {
            decode::<StateVector>(sv)?
        };
        let doc = load(state)?;
        let txn = doc.transact();
        Ok(Exchange {
            update: txn.encode_state_as_update_v1(&sv),
            sv: txn.state_vector().encode_v1(),
            seed_markdown: None,
        })
    })
}

pub async fn get(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    sv: &[u8],
) -> Result<Exchange, Error> {
    let (state, body): (Option<Vec<u8>>, String) = sqlx::query_as(
        "SELECT d.ystate, d.body FROM objects o JOIN docs_pages d ON d.object_id = o.id \
         WHERE o.id = $1 AND o.owner_id = $2 AND o.type = 'docs.page' AND o.deleted_at IS NULL",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(conn)
    .await?
    .ok_or(qubite_objects::Error::NotFound)?;
    let mut result = diff(state.as_deref(), sv)?;
    result.seed_markdown = state.is_none().then_some(body);
    Ok(result)
}

pub async fn apply(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    update: &[u8],
    text: &str,
    seed: bool,
) -> Result<Vec<u8>, Error> {
    let mut tx = conn.begin().await?;
    // Общий порядок блокировок с rename/старой правкой: objects, затем docs_pages.
    let revision: i64 = sqlx::query_scalar(
        "SELECT revision FROM objects WHERE id = $1 AND owner_id = $2 \
         AND type = 'docs.page' AND deleted_at IS NULL FOR UPDATE",
    )
    .bind(id)
    .bind(owner)
    .fetch_optional(&mut *tx)
    .await?
    .ok_or(qubite_objects::Error::NotFound)?;
    let state: Option<Vec<u8>> =
        sqlx::query_scalar("SELECT ystate FROM docs_pages WHERE object_id = $1 FOR UPDATE")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    if seed && state.is_some() {
        return Err(Error::SeedTaken);
    }
    if text.chars().count() > MAX_DOC_CHARS {
        return Err(Error::TextTooLarge);
    }
    let merged = merge(state.as_deref(), update)?;
    if merged.changed {
        sqlx::query("UPDATE docs_pages SET ystate = $2, body = $3 WHERE object_id = $1")
            .bind(id)
            .bind(&merged.state)
            .bind(text)
            .execute(&mut *tx)
            .await?;
        objects::bump(&mut tx, id, revision, owner, &["body", "ystate"]).await?;
    }
    tx.commit().await?;
    Ok(merged.sv)
}

/// Поля docs.page в обычном sync: текст передаётся только через /y.
pub struct DocFields;

impl TypeFields for DocFields {
    fn object_type(&self) -> &'static str {
        DOC_TYPE
    }

    fn create<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a qubite_objects::Object,
        fields: Option<&'a Value>,
    ) -> BoxFuture<'a, Result<(), FieldsError>> {
        Box::pin(async move {
            let empty = match fields {
                None => true,
                Some(Value::Object(fields)) => fields.is_empty(),
                Some(_) => false,
            };
            if !empty {
                return Err(FieldsError::Invalid(
                    "docs.page создаётся без полей; текст — через /y".into(),
                ));
            }
            sqlx::query("INSERT INTO docs_pages (object_id) VALUES ($1)")
                .bind(object.id)
                .execute(conn)
                .await?;
            Ok(())
        })
    }

    fn patch<'a>(
        &'a self,
        _conn: &'a mut PgConnection,
        _object: &'a qubite_objects::Object,
        _fields: &'a Value,
    ) -> BoxFuture<'a, Result<Vec<String>, FieldsError>> {
        Box::pin(async {
            Err(FieldsError::Invalid(
                "use_editor: текст документа меняется через /y".into(),
            ))
        })
    }

    fn read<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object_id: Uuid,
    ) -> BoxFuture<'a, Result<Option<Value>, FieldsError>> {
        Box::pin(async move {
            let row: Option<(String, bool)> = sqlx::query_as(
                "SELECT body, ystate IS NOT NULL FROM docs_pages WHERE object_id = $1",
            )
            .bind(object_id)
            .fetch_optional(conn)
            .await?;
            Ok(row.map(|(body, has_ystate)| {
                let preview = if has_ystate {
                    body.chars().take(200).collect::<String>()
                } else {
                    preview(&body)
                };
                json!({ "preview": preview, "has_ystate": has_ystate })
            }))
        })
    }
}

/// Старый Markdown превращаем в текст, не разбирая дерево редактора.
pub fn preview(body: &str) -> String {
    use pulldown_cmark::{Event, Options, Parser, TagEnd};

    let mut plain = String::new();
    let options = Options::ENABLE_TASKLISTS | Options::ENABLE_STRIKETHROUGH;
    for event in Parser::new_ext(body, options) {
        match event {
            Event::Text(text) | Event::Code(text) => plain.push_str(&text),
            Event::SoftBreak | Event::HardBreak | Event::Rule => plain.push(' '),
            Event::End(tag) => {
                let block = matches!(
                    tag,
                    TagEnd::Paragraph | TagEnd::Heading(_) | TagEnd::Item | TagEnd::CodeBlock
                );
                if block {
                    plain.push(' ');
                }
            }
            _ => {}
        }
    }
    plain
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(200)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use yrs::{GetString, OffsetKind, Options, Text};

    /// Позиции в UTF-16, как у yjs в браузере (по умолчанию yrs считает байты).
    fn utf16(client: u64) -> Doc {
        Doc::with_options(Options {
            client_id: yrs::block::ClientID::new(client),
            offset_kind: OffsetKind::Utf16,
            ..Options::default()
        })
    }

    fn full(doc: &Doc) -> Vec<u8> {
        doc.transact()
            .encode_state_as_update_v1(&StateVector::default())
    }

    fn copy(state: &[u8], client: u64) -> Doc {
        let doc = utf16(client);
        doc.transact_mut()
            .apply_update(Update::decode_v1(state).unwrap())
            .unwrap();
        doc
    }

    #[test]
    fn independent_copies_converge_and_diff_only_sends_missing_changes() {
        let base = utf16(1);
        let text = base.get_or_insert_text("text");
        text.insert(&mut base.transact_mut(), 0, "Начало");
        let initial = full(&base);
        let left = copy(&initial, 2);
        let right = copy(&initial, 3);
        left.get_or_insert_text("text")
            .insert(&mut left.transact_mut(), 6, " слева");
        right
            .get_or_insert_text("text")
            .insert(&mut right.transact_mut(), 0, "справа ");
        let left_update = full(&left);
        let right_update = full(&right);
        let first_left = merge(Some(&initial), &left_update).unwrap();
        let first_right = merge(Some(&initial), &right_update).unwrap();
        let lr = merge(Some(&first_left.state), &right_update).unwrap();
        let rl = merge(Some(&first_right.state), &left_update).unwrap();
        assert_eq!(lr.state, rl.state);
        assert!(!merge(Some(&lr.state), &left_update).unwrap().changed);
        let sv = left.transact().state_vector().encode_v1();
        let missing = diff(Some(&lr.state), &sv).unwrap();
        assert!(missing.update.len() < lr.state.len());
        left.transact_mut()
            .apply_update(Update::decode_v1(&missing.update).unwrap())
            .unwrap();
        assert_eq!(full(&left), lr.state);
        assert_eq!(
            left.get_or_insert_text("text").get_string(&left.transact()),
            "справа Начало слева"
        );
    }

    #[test]
    fn pending_updates_survive_storage_and_deletions_are_changes() {
        let doc = utf16(1);
        let text = doc.get_or_insert_text("text");
        text.insert(&mut doc.transact_mut(), 0, "А");
        let first = full(&doc);
        let sv = doc.transact().state_vector();
        text.insert(&mut doc.transact_mut(), 1, "Б");
        let second = doc.transact().encode_state_as_update_v1(&sv);
        let pending = merge(None, &second).unwrap();
        assert!(!merge(Some(&pending.state), &second).unwrap().changed);
        let joined = merge(Some(&pending.state), &first).unwrap();
        assert_eq!(joined.state, full(&doc));
        let sv = doc.transact().state_vector();
        text.remove_range(&mut doc.transact_mut(), 0, 1);
        let deletion = doc.transact().encode_state_as_update_v1(&sv);
        let deleted = merge(Some(&joined.state), &deletion).unwrap();
        assert!(deleted.changed);
        assert!(!merge(Some(&deleted.state), &deletion).unwrap().changed);
        assert_eq!(deleted.state, full(&doc));
    }

    #[test]
    fn malformed_messages_and_limits() {
        for bytes in [&[][..], &[255][..], &[0, 0, 1][..]] {
            assert!(matches!(merge(None, bytes), Err(Error::InvalidUpdate)));
        }
        assert!(matches!(diff(None, &[255]), Err(Error::InvalidUpdate)));
        assert!(matches!(
            merge(None, &vec![0; MAX_UPDATE_BYTES + 1]),
            Err(Error::UpdateTooLarge)
        ));
        let doc = utf16(1);
        let text = doc.get_or_insert_text("text");
        let mut state = None;
        for _ in 0..10 {
            let sv = doc.transact().state_vector();
            text.insert(&mut doc.transact_mut(), 0, &"a".repeat(400_000));
            let update = doc.transact().encode_state_as_update_v1(&sv);
            state = Some(merge(state.as_deref(), &update).unwrap().state);
        }
        let sv = doc.transact().state_vector();
        text.insert(&mut doc.transact_mut(), 0, &"b".repeat(400_000));
        let update = doc.transact().encode_state_as_update_v1(&sv);
        assert!(matches!(
            merge(state.as_deref(), &update),
            Err(Error::DocTooLarge)
        ));
    }

    #[test]
    fn markdown_preview_has_no_formatting_or_link_destinations() {
        assert_eq!(
            preview("# Заголовок\n\n- [ ] **Шаг** [ссылка](https://example.org)\n\n`код`"),
            "Заголовок Шаг ссылка код"
        );
        assert_eq!(preview(&"я".repeat(250)).chars().count(), 200);
    }
}
