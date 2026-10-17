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
//!   только онлайн-операциями с проверкой на сервере.
//!
//! Формат JSON закреплён образцами в `fixtures/`: их же проверяет TS-клиент.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Сколько операций можно отправить одним пакетом.
pub const MAX_OPS_PER_PUSH: usize = 500;
/// Сколько изменений сервер отдаёт за один раз.
pub const MAX_PULL_LIMIT: i64 = 500;
/// Максимальная длина заголовка (совпадает с ограничением в базе).
pub const MAX_TITLE_CHARS: usize = 1000;

/// Что делает операция.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum OpKind {
    /// Создать объект. `object_id` операции становится ID объекта.
    Create { object_type: String, title: String },
    /// Изменить заголовок.
    SetTitle { title: String },
    /// Удалить в корзину.
    Delete,
    /// Вернуть из корзины.
    Restore,
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
}

/// Почему операция отклонена (повторять бессмысленно).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RejectReason {
    /// Объекта нет или он чужой (не раскрываем, что именно).
    NotFound,
    /// Неверные данные операции.
    Invalid,
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

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PullResponse {
    /// Изменённые объекты (по одному снимку на объект, в порядке изменений).
    pub changes: Vec<ObjectSnapshot>,
    /// Курсор для следующего запроса.
    pub cursor: i64,
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
        PullResponse {
            changes: vec![sample_snapshot()],
            cursor: 42,
            has_more: false,
        }
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
        };
        assert!(create.check().is_err());
    }
}
