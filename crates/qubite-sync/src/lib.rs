//! Протокол синхронизации Qubite — общий для сервера и всех устройств.
//!
//! Устройство записывает изменение локально, кладёт **операцию** в очередь и,
//! когда есть сеть, отправляет пакет операций (`PushRequest`). Сервер отвечает
//! результатом по каждой операции. Затем устройство забирает изменения с
//! сервера после своего курсора (`PullResponse`).
//!
//! Правила:
//! - у каждой операции свой `op_id`; повторная отправка той же операции
//!   возвращает тот же результат и ничего не применяет второй раз;
//! - правка существующего объекта несёт `base_revision` — версию, от которой
//!   отталкивалось устройство; если на сервере версия другая, это `conflict`
//!   и в ответе приходит текущее состояние объекта;
//! - права, гранты и удаление навсегда через синхронизацию не меняются —
//!   только онлайн-операциями с проверкой на сервере;
//! - у объекта модуля могут быть свои поля (`fields`, JSON). Их проверяет
//!   модуль на сервере (например, Входящие — CMD-001); тип без модуля-
//!   обработчика полей через HTTP создать нельзя.
//!
//! - курсор `pull` — непрозрачная строка ([`Cursor`]): устройство хранит её и
//!   возвращает серверу как есть. Внутри — своя позиция на каждый модуль, а
//!   позиции выдаются в порядке commit (SYNC-007, D-891…D-893).
//!
//! Формат JSON закреплён образцами в `fixtures/`: их же проверяет TS-клиент.

use std::{collections::BTreeMap, fmt};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use uuid::Uuid;

/// Сколько операций можно отправить одним пакетом.
pub const MAX_OPS_PER_PUSH: usize = 500;
/// Сколько изменений сервер отдаёт за один раз.
pub const MAX_PULL_LIMIT: i64 = 500;
/// Максимальная длина заголовка (совпадает с ограничением в базе).
pub const MAX_TITLE_CHARS: usize = 1000;
/// Максимальный размер полей модуля в одной операции (байты JSON).
pub const MAX_FIELDS_BYTES: usize = 64 * 1024;

/// Что делает операция.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OpKind {
    /// Создать объект. `object_id` операции становится ID объекта.
    Create {
        object_type: String,
        title: String,
        /// Поля модуля (у элемента Входящих — текст, ссылка, источник…).
        #[serde(default, skip_serializing_if = "Option::is_none")]
        fields: Option<serde_json::Value>,
    },
    /// Изменить заголовок.
    SetTitle { title: String },
    /// Удалить в корзину.
    Delete,
    /// Вернуть из корзины.
    Restore,
    /// Изменить поля модуля (например, `{"status": "archived"}`).
    /// Передаются только меняющиеся поля.
    Patch { fields: serde_json::Value },
}

/// Одна операция из очереди устройства.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Operation {
    pub op_id: Uuid,
    pub object_id: Uuid,
    /// Версия объекта, от которой сделана правка. Для `create` — отсутствует.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub base_revision: Option<i64>,
    #[serde(flatten)]
    pub kind: OpKind,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushRequest {
    pub device_id: Uuid,
    pub ops: Vec<Operation>,
}

/// Текущее состояние объекта, как его видит сервер.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ObjectSnapshot {
    pub id: Uuid,
    pub object_type: String,
    pub title: String,
    pub revision: i64,
    pub deleted: bool,
    /// Время последнего изменения, миллисекунды Unix.
    pub updated_at_ms: i64,
    /// Поля модуля, если у типа они есть.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fields: Option<serde_json::Value>,
}

/// Почему операция отклонена (повторять бессмысленно).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    /// Объекта нет или он чужой (не раскрываем, что именно).
    NotFound,
    /// Неверные данные операции.
    Invalid,
    /// Нет права менять объекты этого модуля (Policy Gate).
    Forbidden,
}

/// Результат одной операции.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OpResult {
    Applied {
        op_id: Uuid,
        revision: i64,
    },
    Conflict {
        op_id: Uuid,
        current: ObjectSnapshot,
    },
    Rejected {
        op_id: Uuid,
        reason: RejectReason,
        message: String,
    },
}

impl OpResult {
    pub fn op_id(&self) -> Uuid {
        match self {
            Self::Applied { op_id, .. }
            | Self::Conflict { op_id, .. }
            | Self::Rejected { op_id, .. } => *op_id,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PushResponse {
    pub results: Vec<OpResult>,
}

/// Сколько модулей помнит один курсор (защита от мусора в запросе).
const MAX_CURSOR_MODULES: usize = 64;

/// Курсор синхронизации: до какой позиции ленты устройство уже получило
/// изменения **каждого модуля**.
///
/// Для устройства это непрозрачная строка: сохранить и вернуть как есть.
/// Формат — `2.<модуль>-<позиция>.<модуль>-<позиция>…`, например
/// `2.docs-17.inbox-40`; «с начала» — `0`. Только буквы, цифры, `_`, `-` и
/// `.`, поэтому строку можно подставлять в адрес без кодирования.
///
/// Модуля нет в курсоре — он забирается с начала. Так после выдачи доступа
/// к модулю (или появления нового модуля) приходят и его старые объекты, а
/// остальные модули продолжают с того же места.
///
/// Всё, что не разобралось, и старые числовые курсоры (`cursor=57`, номер
/// события до SYNC-007) означают «с начала»: устройство один раз забирает
/// всё заново, зато ничего не пропускает.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Cursor {
    modules: BTreeMap<String, i64>,
}

impl Cursor {
    /// С начала.
    pub fn start() -> Self {
        Self::default()
    }

    /// Разобрать строку из запроса. Ошибок нет: непонятное — «с начала».
    pub fn parse(text: &str) -> Self {
        Self::try_parse(text).unwrap_or_default()
    }

    fn try_parse(text: &str) -> Option<Self> {
        let mut parts = text.split('.');
        if parts.next()? != "2" {
            return None;
        }
        let mut modules = BTreeMap::new();
        for part in parts {
            let (module, pos) = part.rsplit_once('-')?;
            let valid_module = !module.is_empty()
                && module.len() <= 64
                && module
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_');
            if !valid_module || pos.is_empty() || !pos.chars().all(|c| c.is_ascii_digit()) {
                return None;
            }
            modules.insert(module.to_owned(), pos.parse().ok()?);
        }
        (modules.len() <= MAX_CURSOR_MODULES).then_some(Self { modules })
    }

    pub fn is_start(&self) -> bool {
        self.modules.is_empty()
    }

    /// После какой позиции забирать модуль (0 — с начала).
    pub fn after(&self, module: &str) -> i64 {
        self.modules.get(module).copied().unwrap_or(0)
    }

    /// Модуль получен до позиции `pos` включительно. Назад курсор не идёт.
    pub fn advance(&mut self, module: &str, pos: i64) {
        if pos > self.after(module) {
            self.modules.insert(module.to_owned(), pos);
        }
    }

    /// Модули курсора с их позициями.
    pub fn modules(&self) -> impl Iterator<Item = (&str, i64)> {
        self.modules
            .iter()
            .map(|(module, pos)| (module.as_str(), *pos))
    }

    /// Самая дальняя позиция (0 — курсор «с начала»).
    pub fn max_pos(&self) -> i64 {
        self.modules.values().copied().max().unwrap_or(0)
    }
}

impl fmt::Display for Cursor {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        if self.modules.is_empty() {
            return f.write_str("0");
        }
        f.write_str("2")?;
        for (module, pos) in &self.modules {
            write!(f, ".{module}-{pos}")?;
        }
        Ok(())
    }
}

/// Старый числовой курсор (номер события): всегда «с начала».
impl From<i64> for Cursor {
    fn from(_legacy: i64) -> Self {
        Self::start()
    }
}

impl From<&Cursor> for Cursor {
    fn from(cursor: &Cursor) -> Self {
        cursor.clone()
    }
}

impl From<&str> for Cursor {
    fn from(text: &str) -> Self {
        Self::parse(text)
    }
}

impl Serialize for Cursor {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Cursor {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        /// Строка нового формата или число старого.
        #[derive(Deserialize)]
        #[serde(untagged)]
        enum Raw {
            Text(String),
            Legacy(i64),
        }
        Ok(match Raw::deserialize(deserializer)? {
            Raw::Text(text) => Self::parse(&text),
            Raw::Legacy(number) => number.into(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PullResponse {
    /// Изменённые объекты (по одному снимку на объект, в порядке изменений).
    pub changes: Vec<ObjectSnapshot>,
    /// Курсор для следующего запроса: вернуть серверу как есть.
    pub cursor: Cursor,
    /// Есть ли ещё изменения — тогда сразу запросить следующую страницу.
    pub has_more: bool,
}

/// Ошибка пакета целиком (отклоняется до применения).
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum InvalidPush {
    #[error("пустой пакет")]
    Empty,
    #[error("слишком много операций: {0}, максимум {MAX_OPS_PER_PUSH}")]
    TooManyOps(usize),
    #[error("операция {0} повторяется в пакете")]
    DuplicateOp(Uuid),
}

impl PushRequest {
    pub fn validate(&self) -> Result<(), InvalidPush> {
        if self.ops.is_empty() {
            return Err(InvalidPush::Empty);
        }
        if self.ops.len() > MAX_OPS_PER_PUSH {
            return Err(InvalidPush::TooManyOps(self.ops.len()));
        }
        let mut seen = std::collections::HashSet::new();
        for op in &self.ops {
            if !seen.insert(op.op_id) {
                return Err(InvalidPush::DuplicateOp(op.op_id));
            }
        }
        Ok(())
    }
}

impl Operation {
    /// Проверка одной операции. Ошибка — текст для `Rejected { reason: Invalid }`.
    pub fn check(&self) -> Result<(), String> {
        match (&self.kind, self.base_revision) {
            (OpKind::Create { .. }, Some(_)) => {
                return Err("у создания не бывает base_revision".into());
            }
            (OpKind::Create { .. }, None) => {}
            (_, None) => return Err("для правки нужен base_revision".into()),
            (_, Some(revision)) if revision < 1 => return Err("base_revision от 1".into()),
            _ => {}
        }
        if let OpKind::Create { title, .. } | OpKind::SetTitle { title } = &self.kind
            && title.chars().count() > MAX_TITLE_CHARS
        {
            return Err(format!("заголовок длиннее {MAX_TITLE_CHARS} символов"));
        }
        let fields = match &self.kind {
            OpKind::Create { fields, .. } => fields.as_ref(),
            OpKind::Patch { fields } => Some(fields),
            _ => None,
        };
        if let Some(fields) = fields {
            if !fields.is_object() {
                return Err("поля модуля — объект JSON".into());
            }
            if fields.to_string().len() > MAX_FIELDS_BYTES {
                return Err(format!("поля модуля больше {MAX_FIELDS_BYTES} байт"));
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture(name: &str) -> serde_json::Value {
        let path = format!("{}/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    fn id(n: u8) -> Uuid {
        Uuid::from_bytes([n; 16])
    }

    fn sample_push() -> PushRequest {
        PushRequest {
            device_id: id(1),
            ops: vec![
                Operation {
                    op_id: id(2),
                    object_id: id(3),
                    base_revision: None,
                    kind: OpKind::Create {
                        object_type: "inbox.item".into(),
                        title: "Завтра повторить графы".into(),
                        fields: Some(serde_json::json!({
                            "kind": "text",
                            "body": "Завтра повторить графы",
                            "source": "web",
                            "captured_at_ms": 1_792_224_000_000_i64
                        })),
                    },
                },
                Operation {
                    op_id: id(6),
                    object_id: id(3),
                    base_revision: Some(1),
                    kind: OpKind::Patch {
                        fields: serde_json::json!({ "status": "archived" }),
                    },
                },
                Operation {
                    op_id: id(4),
                    object_id: id(3),
                    base_revision: Some(1),
                    kind: OpKind::SetTitle {
                        title: "Повторить графы".into(),
                    },
                },
                Operation {
                    op_id: id(5),
                    object_id: id(3),
                    base_revision: Some(2),
                    kind: OpKind::Delete,
                },
            ],
        }
    }

    fn sample_snapshot() -> ObjectSnapshot {
        ObjectSnapshot {
            id: id(3),
            object_type: "inbox.item".into(),
            title: "Повторить графы".into(),
            revision: 3,
            deleted: true,
            updated_at_ms: 1_792_224_000_000,
            fields: Some(serde_json::json!({ "status": "archived" })),
        }
    }

    fn sample_push_response() -> PushResponse {
        PushResponse {
            results: vec![
                OpResult::Applied {
                    op_id: id(2),
                    revision: 1,
                },
                OpResult::Conflict {
                    op_id: id(4),
                    current: sample_snapshot(),
                },
                OpResult::Rejected {
                    op_id: id(5),
                    reason: RejectReason::NotFound,
                    message: "объект не найден".into(),
                },
            ],
        }
    }

    fn sample_pull() -> PullResponse {
        let mut cursor = Cursor::start();
        cursor.advance("inbox", 42);
        cursor.advance("docs", 17);
        PullResponse {
            changes: vec![sample_snapshot()],
            cursor,
            has_more: false,
        }
    }

    #[test]
    fn cursor_round_trips_and_treats_unknown_as_start() {
        let mut cursor = Cursor::start();
        assert_eq!(cursor.to_string(), "0");
        assert!(Cursor::parse("0").is_start());
        cursor.advance("planner", 40);
        cursor.advance("docs", 7);
        cursor.advance("planner", 12); // назад не идёт
        assert_eq!(cursor.to_string(), "2.docs-7.planner-40");
        assert_eq!(Cursor::parse("2.docs-7.planner-40"), cursor);
        assert_eq!(cursor.after("planner"), 40);
        assert_eq!(cursor.after("inbox"), 0, "модуля нет в курсоре — с начала");
        assert_eq!(cursor.max_pos(), 40);

        // Старый числовой курсор и мусор — «с начала», а не ошибка.
        for text in [
            "57",
            "",
            "2.inbox",
            "2.inbox-",
            "2.-5",
            "2.inbox--5",
            "2.Inbox-5",
            "2.inbox-5x",
            "3.inbox-5",
            "2.inbox-99999999999999999999",
        ] {
            assert!(Cursor::parse(text).is_start(), "{text}");
        }
        assert!(Cursor::from(57).is_start());

        // В JSON — строка; старое число тоже читается.
        assert_eq!(
            serde_json::to_value(&cursor).unwrap(),
            serde_json::json!("2.docs-7.planner-40")
        );
        let parsed: Cursor = serde_json::from_value(serde_json::json!("2.docs-7")).unwrap();
        assert_eq!(parsed.after("docs"), 7);
        let legacy: Cursor = serde_json::from_value(serde_json::json!(42)).unwrap();
        assert!(legacy.is_start());
    }

    /// Формат JSON совпадает с образцами, которые проверяет и TS-клиент.
    #[test]
    fn json_matches_fixtures() {
        for (name, value) in [
            ("push_request", serde_json::to_value(sample_push()).unwrap()),
            (
                "push_response",
                serde_json::to_value(sample_push_response()).unwrap(),
            ),
            (
                "pull_response",
                serde_json::to_value(sample_pull()).unwrap(),
            ),
        ] {
            if std::env::var_os("UPDATE_FIXTURES").is_some() {
                let path = format!("{}/fixtures/{name}.json", env!("CARGO_MANIFEST_DIR"));
                std::fs::write(path, serde_json::to_string_pretty(&value).unwrap() + "\n").unwrap();
            }
            assert_eq!(
                value,
                fixture(name),
                "образец {name} устарел: UPDATE_FIXTURES=1 cargo test"
            );
        }
        let parsed: PushRequest = serde_json::from_value(fixture("push_request")).unwrap();
        assert_eq!(parsed, sample_push());
    }

    #[test]
    fn validation_catches_bad_packets_and_ops() {
        let mut push = sample_push();
        assert!(push.validate().is_ok());
        push.ops.push(push.ops[0].clone());
        assert!(matches!(push.validate(), Err(InvalidPush::DuplicateOp(_))));
        assert_eq!(
            PushRequest {
                device_id: id(1),
                ops: vec![]
            }
            .validate(),
            Err(InvalidPush::Empty)
        );

        let mut op = sample_push().ops[1].clone();
        assert!(op.check().is_ok());
        op.base_revision = None;
        assert!(op.check().is_err(), "правка без base_revision");
        let mut create = sample_push().ops[0].clone();
        create.base_revision = Some(1);
        assert!(create.check().is_err());
        create.base_revision = None;
        create.kind = OpKind::Create {
            object_type: "inbox.item".into(),
            title: "я".repeat(MAX_TITLE_CHARS + 1),
            fields: None,
        };
        assert!(create.check().is_err());
        create.kind = OpKind::Create {
            object_type: "inbox.item".into(),
            title: "мысль".into(),
            fields: Some(serde_json::json!(["не объект"])),
        };
        assert!(create.check().is_err(), "поля — только объект");
        let mut patch = sample_push().ops[1].clone();
        assert!(patch.check().is_ok());
        patch.kind = OpKind::Patch {
            fields: serde_json::json!({ "body": "я".repeat(MAX_FIELDS_BYTES) }),
        };
        assert!(patch.check().is_err(), "слишком большие поля");
    }
}
