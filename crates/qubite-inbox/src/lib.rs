//! Модуль «Входящие» (CMD-001): сюда падает всё, что человек бросил в Qubite
//! Command, переслал боту или сохранил с телефона без сети.
//!
//! Элемент — объект ядра типа `inbox.item` (заголовок, версия, корзина,
//! история) плюс строка `inbox_items` с полями модуля: полный текст, ссылка,
//! источник, статус и **место под результат разбора** — что это (дело,
//! заметка, мысль к проекту, просьба к агенту) и с какими объектами связано.
//! Сам разбор делают CMD-003 (правила) и CMD-004 (AI) через [`suggest`] и
//! [`confirm`]; связи с проектами — обычные связи ядра (`relations`).
//!
//! Создавать и менять элементы можно двумя путями, и оба идут через движок
//! синхронизации (одна проверка, одна история, «есть новое» на все устройства):
//! операции `/api/v1/sync/push` с устройства и обычные адреса `/api/v1/inbox`.
//!
//! Решения — D-190…D-193: разобранное уходит в архив, а не удаляется;
//! удалить — в корзину с отменой; ручных тегов и папок нет.

use qubite_objects::{Error, NewRelation, RelationSource, Result, objects, relations};
use qubite_sync_server::{BoxFuture, FieldsError, TypeFields};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{Connection, PgConnection};
use time::OffsetDateTime;
use uuid::Uuid;

/// Тип объекта элемента.
pub const ITEM_TYPE: &str = "inbox.item";
/// Модуль в каталоге (права выдаются на него).
pub const MODULE: &str = "inbox";
/// Самый длинный текст мысли.
pub const MAX_BODY_CHARS: usize = 20_000;
/// Длина заголовка, который получается из первой строки текста.
pub const TITLE_CHARS: usize = 200;
/// Тип связи «элемент про этот объект» (проект, задачу, документ).
pub const ABOUT: &str = "about";

// ---------------------------------------------------------------- значения

macro_rules! text_enum {
    ($(#[$meta:meta])* $name:ident { $($variant:ident = $text:literal),+ $(,)? }) => {
        $(#[$meta])*
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }

        impl $name {
            pub fn as_str(self) -> &'static str {
                match self { $(Self::$variant => $text),+ }
            }
        }

        impl std::str::FromStr for $name {
            type Err = String;
            fn from_str(value: &str) -> std::result::Result<Self, String> {
                match value {
                    $($text => Ok(Self::$variant),)+
                    other => Err(format!("неизвестное значение {other}")),
                }
            }
        }
    };
}

text_enum!(
    /// Что прислали.
    Kind { Text = "text", Link = "link", File = "file", Voice = "voice" }
);
text_enum!(
    /// Откуда пришло.
    Source { Web = "web", Desktop = "desktop", Android = "android", Telegram = "telegram", Api = "api" }
);
text_enum!(
    /// `new` — ждёт разбора; `archived` — разобрано или убрано в архив.
    Status { New = "new", Archived = "archived" }
);
text_enum!(
    /// Как далеко зашёл разбор.
    TriageStatus { Pending = "pending", Suggested = "suggested", Confirmed = "confirmed", Skipped = "skipped" }
);
text_enum!(
    /// Что это по смыслу. Список расширяется вместе с модулями.
    Intent {
        Task = "task",
        Note = "note",
        ProjectThought = "project_thought",
        AgentRequest = "agent_request",
        Other = "other",
    }
);
text_enum!(
    /// Кто разобрал: правила без AI (CMD-003), AI (CMD-004) или человек.
    TriageBy { Rules = "rules", Ai = "ai", Person = "person" }
);

impl TriageBy {
    fn relation_source(self) -> RelationSource {
        match self {
            Self::Rules => RelationSource::System,
            Self::Ai => RelationSource::Ai,
            Self::Person => RelationSource::Manual,
        }
    }
}

// ---------------------------------------------------------------- элемент

/// Элемент Входящих целиком.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Item {
    pub id: Uuid,
    pub owner_id: Uuid,
    pub title: String,
    pub revision: i64,
    pub deleted: bool,
    pub kind: Kind,
    pub body: String,
    pub url: Option<String>,
    pub source: Source,
    pub captured_at: OffsetDateTime,
    pub status: Status,
    pub archived_at: Option<OffsetDateTime>,
    pub triage: Triage,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

/// Результат разбора, сохранённый в элементе.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Triage {
    pub status: TriageStatus,
    pub intent: Option<Intent>,
    /// Подробности: `by`, `confidence`, `summary`.
    pub details: Value,
    pub triaged_at: Option<OffsetDateTime>,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    owner_id: Uuid,
    title: String,
    revision: i64,
    deleted_at: Option<OffsetDateTime>,
    created_at: OffsetDateTime,
    updated_at: OffsetDateTime,
    kind: String,
    body: String,
    url: Option<String>,
    source: String,
    captured_at: OffsetDateTime,
    status: String,
    archived_at: Option<OffsetDateTime>,
    triage_status: String,
    intent: Option<String>,
    triage: Value,
    triaged_at: Option<OffsetDateTime>,
}

const SELECT: &str = "SELECT o.id, o.owner_id, o.title, o.revision, o.deleted_at, o.created_at, \
     o.updated_at, i.kind, i.body, i.url, i.source, i.captured_at, i.status, i.archived_at, \
     i.triage_status, i.intent, i.triage, i.triaged_at \
     FROM objects o JOIN inbox_items i ON i.object_id = o.id";

fn parse<T: std::str::FromStr<Err = String>>(value: &str) -> Result<T> {
    value.parse().map_err(Error::Invalid)
}

impl TryFrom<Row> for Item {
    type Error = Error;
    fn try_from(row: Row) -> Result<Self> {
        Ok(Self {
            id: row.id,
            owner_id: row.owner_id,
            title: row.title,
            revision: row.revision,
            deleted: row.deleted_at.is_some(),
            kind: parse(&row.kind)?,
            body: row.body,
            url: row.url,
            source: parse(&row.source)?,
            captured_at: row.captured_at,
            status: parse(&row.status)?,
            archived_at: row.archived_at,
            triage: Triage {
                status: parse(&row.triage_status)?,
                // Незнакомое значение (из более новой версии) не ломает чтение.
                intent: row.intent.as_deref().and_then(|intent| intent.parse().ok()),
                details: row.triage,
                triaged_at: row.triaged_at,
            },
            created_at: row.created_at,
            updated_at: row.updated_at,
        })
    }
}

impl Item {
    /// Поля модуля для снимка синхронизации.
    pub fn fields(&self) -> Value {
        json!({
            "kind": self.kind,
            "body": self.body,
            "url": self.url,
            "source": self.source,
            "captured_at_ms": millis(self.captured_at),
            "status": self.status,
            "archived_at_ms": self.archived_at.map(millis),
            "triage": {
                "status": self.triage.status,
                "intent": self.triage.intent,
                "details": self.triage.details,
                "triaged_at_ms": self.triage.triaged_at.map(millis),
            },
        })
    }
}

pub fn millis(at: OffsetDateTime) -> i64 {
    i64::try_from(at.unix_timestamp_nanos() / 1_000_000).unwrap_or(i64::MAX)
}

/// Заголовок из текста: первая непустая строка, не длиннее [`TITLE_CHARS`].
pub fn title_from(text: &str) -> String {
    let line = text
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .unwrap_or_default();
    if line.chars().count() <= TITLE_CHARS {
        return line.to_owned();
    }
    let mut title: String = line.chars().take(TITLE_CHARS - 1).collect();
    title.push('…');
    title
}

// ---------------------------------------------------------------- чтение

/// Элемент владельца (в том числе из корзины). Чужой — `None`.
pub async fn get(conn: &mut PgConnection, owner: Uuid, id: Uuid) -> Result<Option<Item>> {
    let row: Option<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE o.id = $1 AND o.owner_id = $2"
    )))
    .bind(id)
    .bind(owner)
    .fetch_optional(conn)
    .await?;
    row.map(Item::try_from).transpose()
}

/// Что показать в списке.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum View {
    /// Ждут разбора.
    New,
    /// Архив.
    Archived,
    /// Корзина.
    Trash,
}

/// Элементы владельца, свежие сверху.
pub async fn list(
    conn: &mut PgConnection,
    owner: Uuid,
    view: View,
    limit: i64,
) -> Result<Vec<Item>> {
    let filter = match view {
        View::New => "o.deleted_at IS NULL AND i.status = 'new'",
        View::Archived => "o.deleted_at IS NULL AND i.status = 'archived'",
        View::Trash => "o.deleted_at IS NOT NULL",
    };
    let rows: Vec<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE o.owner_id = $1 AND {filter} \
         ORDER BY i.captured_at DESC, o.id DESC LIMIT $2"
    )))
    .bind(owner)
    .bind(limit.clamp(1, 500))
    .fetch_all(conn)
    .await?;
    rows.into_iter().map(Item::try_from).collect()
}

/// Объект, с которым связан элемент (проект, задача, документ…).
#[derive(Debug, Clone, PartialEq, Serialize, sqlx::FromRow)]
pub struct Link {
    pub to_id: Uuid,
    #[sqlx(rename = "type")]
    pub to_type: String,
    pub title: String,
    pub relation: String,
    /// `manual`, `ai`, `system`.
    pub source: String,
    pub confidence: Option<f32>,
}

/// Живые связи элемента с живыми объектами.
pub async fn links(conn: &mut PgConnection, item: Uuid) -> Result<Vec<Link>> {
    Ok(sqlx::query_as(
        "SELECT r.to_id, o.type, o.title, r.type AS relation, r.source, r.confidence \
         FROM relations r JOIN objects o ON o.id = r.to_id \
         WHERE r.from_id = $1 AND r.deleted_at IS NULL AND o.deleted_at IS NULL \
         ORDER BY r.created_at",
    )
    .bind(item)
    .fetch_all(conn)
    .await?)
}

// ---------------------------------------------------------------- поля для синхронизации

/// Поля при создании (`create.fields`). Всё необязательное: без полей
/// элемент — просто текст из заголовка.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CaptureFields {
    pub kind: Option<Kind>,
    pub body: Option<String>,
    pub url: Option<String>,
    pub source: Option<Source>,
    /// Когда записано на устройстве, миллисекунды Unix.
    pub captured_at_ms: Option<i64>,
}

/// Что можно менять с устройства (`patch.fields`). Разбор меняет только сервер.
#[derive(Debug, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PatchFields {
    pub status: Option<Status>,
    pub body: Option<String>,
}

fn check_body(body: &str) -> Result<(), FieldsError> {
    if body.chars().count() > MAX_BODY_CHARS {
        return Err(FieldsError::Invalid(format!(
            "текст длиннее {MAX_BODY_CHARS} символов"
        )));
    }
    Ok(())
}

fn check_url(url: &str) -> Result<(), FieldsError> {
    let ok = (url.starts_with("https://") || url.starts_with("http://"))
        && url.len() <= 2000
        && !url.chars().any(char::is_whitespace);
    if ok {
        Ok(())
    } else {
        Err(FieldsError::Invalid(
            "ссылка должна начинаться с http:// или https://".into(),
        ))
    }
}

/// Время записи с устройства. Часы устройства могут врать: будущее
/// превращается в «сейчас».
fn captured_at(ms: Option<i64>, now: OffsetDateTime) -> Result<OffsetDateTime, FieldsError> {
    let Some(ms) = ms else { return Ok(now) };
    let at = OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000)
        .map_err(|_| FieldsError::Invalid("неверное время записи".into()))?;
    Ok(at.min(now))
}

fn invalid(error: serde_json::Error) -> FieldsError {
    FieldsError::Invalid(format!("поля элемента Входящих: {error}"))
}

/// Обработчик полей `inbox.item` для движка синхронизации.
pub struct InboxFields;

impl TypeFields for InboxFields {
    fn object_type(&self) -> &'static str {
        ITEM_TYPE
    }

    fn create<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a qubite_objects::Object,
        fields: Option<&'a Value>,
    ) -> BoxFuture<'a, Result<(), FieldsError>> {
        Box::pin(async move {
            let fields: CaptureFields = match fields {
                Some(value) => serde_json::from_value(value.clone()).map_err(invalid)?,
                None => CaptureFields::default(),
            };
            let body = fields.body.unwrap_or_else(|| object.title.clone());
            check_body(&body)?;
            if let Some(url) = &fields.url {
                check_url(url)?;
            }
            let kind = fields.kind.unwrap_or(if fields.url.is_some() {
                Kind::Link
            } else {
                Kind::Text
            });
            if kind == Kind::Link && fields.url.is_none() {
                return Err(FieldsError::Invalid("для ссылки нужен url".into()));
            }
            if body.trim().is_empty() && fields.url.is_none() && kind == Kind::Text {
                return Err(FieldsError::Invalid("пустая мысль".into()));
            }
            let captured = captured_at(fields.captured_at_ms, object.created_at)?;
            sqlx::query(
                "INSERT INTO inbox_items (object_id, kind, body, url, source, captured_at) \
                 VALUES ($1, $2, $3, $4, $5, $6)",
            )
            .bind(object.id)
            .bind(kind.as_str())
            .bind(&body)
            .bind(&fields.url)
            .bind(fields.source.unwrap_or(Source::Web).as_str())
            .bind(captured)
            .execute(conn)
            .await?;
            Ok(())
        })
    }

    fn patch<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a qubite_objects::Object,
        fields: &'a Value,
    ) -> BoxFuture<'a, Result<Vec<String>, FieldsError>> {
        Box::pin(async move {
            let fields: PatchFields = serde_json::from_value(fields.clone()).map_err(invalid)?;
            let mut changed = Vec::new();
            if let Some(body) = &fields.body {
                check_body(body)?;
                sqlx::query("UPDATE inbox_items SET body = $2 WHERE object_id = $1")
                    .bind(object.id)
                    .bind(body)
                    .execute(&mut *conn)
                    .await?;
                changed.push("body".to_owned());
            }
            if let Some(status) = fields.status {
                set_status(conn, object.id, status).await?;
                changed.push("status".to_owned());
            }
            if changed.is_empty() {
                return Err(FieldsError::Invalid("нечего менять".into()));
            }
            Ok(changed)
        })
    }

    fn read<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object_id: Uuid,
    ) -> BoxFuture<'a, Result<Option<Value>, FieldsError>> {
        Box::pin(async move {
            let row: Option<Row> =
                sqlx::query_as(sqlx::AssertSqlSafe(format!("{SELECT} WHERE o.id = $1")))
                    .bind(object_id)
                    .fetch_optional(conn)
                    .await?;
            match row {
                Some(row) => Ok(Some(
                    Item::try_from(row)
                        .map_err(|error| FieldsError::Invalid(error.to_string()))?
                        .fields(),
                )),
                None => Ok(None),
            }
        })
    }
}

async fn set_status(conn: &mut PgConnection, id: Uuid, status: Status) -> sqlx::Result<()> {
    sqlx::query(
        "UPDATE inbox_items SET status = $2, \
         archived_at = CASE WHEN $2 = 'archived' THEN coalesce(archived_at, now()) END \
         WHERE object_id = $1",
    )
    .bind(id)
    .bind(status.as_str())
    .execute(conn)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------- разбор (CMD-003/004)

/// Предложение разбора: что это и с чем связать.
#[derive(Debug, Clone, PartialEq)]
pub struct Suggestion {
    pub intent: Intent,
    pub by: TriageBy,
    /// Уверенность 0…1 (у правил и человека может не быть).
    pub confidence: Option<f32>,
    /// Краткая суть для показа («Задача: повторить графы к пятнице»).
    pub summary: Option<String>,
    pub links: Vec<SuggestedLink>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct SuggestedLink {
    /// Объект того же владельца: проект, задача, документ.
    pub to: Uuid,
    pub confidence: Option<f32>,
}

/// Сохранить предложение разбора. Прежние автоматические связи (AI, правила)
/// заменяются новыми; связи, поставленные человеком, остаются. Связать можно
/// только со своими объектами — чужой для владельца элемента «не найден».
pub async fn suggest(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    expected_revision: i64,
    actor: Uuid,
    suggestion: Suggestion,
) -> Result<Item> {
    if let Some(confidence) = suggestion.confidence
        && !(0.0..=1.0).contains(&confidence)
    {
        return Err(Error::Invalid("уверенность — от 0 до 1".into()));
    }
    let mut tx = conn.begin().await?;
    let item = live_item(&mut tx, owner, id).await?;
    let previous: Vec<Uuid> = sqlx::query_scalar(
        "SELECT to_id FROM relations WHERE from_id = $1 AND type = $2 \
         AND source IN ('ai', 'system') AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(ABOUT)
    .fetch_all(&mut *tx)
    .await?;
    for to in previous {
        relations::unlink(&mut tx, id, to, ABOUT, actor).await?;
    }
    for link in &suggestion.links {
        let target = objects::get(&mut tx, link.to).await?;
        if target.is_none_or(|target| target.owner_id != owner) {
            return Err(Error::NotFound);
        }
        let mut relation = NewRelation::manual(id, link.to, ABOUT, actor);
        relation.source = suggestion.by.relation_source();
        relation.confidence = link.confidence;
        relations::link(&mut tx, relation).await?;
    }
    let details = json!({
        "by": suggestion.by,
        "confidence": suggestion.confidence,
        "summary": suggestion.summary,
    });
    sqlx::query(
        "UPDATE inbox_items SET triage_status = 'suggested', intent = $2, triage = $3, \
         triaged_at = now() WHERE object_id = $1",
    )
    .bind(id)
    .bind(suggestion.intent.as_str())
    .bind(details)
    .execute(&mut *tx)
    .await?;
    objects::bump(&mut tx, item.id, expected_revision, actor, &["triage"]).await?;
    let item = get(&mut tx, owner, id).await?.ok_or(Error::NotFound)?;
    tx.commit().await?;
    Ok(item)
}

/// Человек принял разбор: элемент считается разобранным и уходит в архив (D-190).
pub async fn confirm(
    conn: &mut PgConnection,
    owner: Uuid,
    id: Uuid,
    expected_revision: i64,
    actor: Uuid,
) -> Result<Item> {
    let mut tx = conn.begin().await?;
    let item = live_item(&mut tx, owner, id).await?;
    if item.triage.status != TriageStatus::Suggested {
        return Err(Error::Invalid(
            "нечего подтверждать: разбора ещё нет".into(),
        ));
    }
    sqlx::query("UPDATE inbox_items SET triage_status = 'confirmed' WHERE object_id = $1")
        .bind(id)
        .execute(&mut *tx)
        .await?;
    set_status(&mut tx, id, Status::Archived).await?;
    objects::bump(&mut tx, id, expected_revision, actor, &["triage", "status"]).await?;
    let item = get(&mut tx, owner, id).await?.ok_or(Error::NotFound)?;
    tx.commit().await?;
    Ok(item)
}

async fn live_item(conn: &mut PgConnection, owner: Uuid, id: Uuid) -> Result<Item> {
    let item = get(conn, owner, id).await?.ok_or(Error::NotFound)?;
    if item.deleted {
        return Err(Error::Deleted);
    }
    Ok(item)
}
