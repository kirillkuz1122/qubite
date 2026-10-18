//! Входящие на настоящей PostgreSQL: поля через синхронизацию, архив,
//! права по модулям, место под разбор и уведомление «есть новое».

use std::collections::HashSet;

use qubite_inbox::{
    InboxFields, Intent, Kind, Source, Status, SuggestedLink, Suggestion, TriageBy, TriageStatus,
    View,
};
use qubite_objects::{NewObject, NewRelation, objects, relations};
use qubite_sync::{OpKind, OpResult, Operation, PushRequest, RejectReason};
use qubite_sync_server::{Registry, Rules};
use qubite_testkit::TestDb;
use serde_json::json;
use uuid::Uuid;

fn rules() -> Rules {
    Rules {
        registry: Registry::default().with(InboxFields),
        strict: true,
        writable: Some(HashSet::from(["inbox".to_owned()])),
        readable: Some(vec!["inbox".to_owned()]),
    }
}

fn create(object_id: Uuid, title: &str, fields: Option<serde_json::Value>) -> Operation {
    Operation {
        op_id: Uuid::now_v7(),
        object_id,
        base_revision: None,
        kind: OpKind::Create {
            object_type: "inbox.item".into(),
            title: title.into(),
            fields,
        },
    }
}

fn patch(object_id: Uuid, base: i64, fields: serde_json::Value) -> Operation {
    Operation {
        op_id: Uuid::now_v7(),
        object_id,
        base_revision: Some(base),
        kind: OpKind::Patch { fields },
    }
}

async fn push(
    db: &qubite_db::Database,
    owner: Uuid,
    ops: Vec<Operation>,
    rules: &Rules,
) -> Vec<OpResult> {
    qubite_sync_server::push_with(
        db.pool(),
        owner,
        &PushRequest {
            device_id: Uuid::now_v7(),
            ops,
        },
        rules,
    )
    .await
    .unwrap()
    .results
}

#[tokio::test]
async fn offline_capture_keeps_fields_and_device_time() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let id = Uuid::now_v7();
    // Записано на устройстве час назад, без сети.
    let hour_ago = qubite_inbox::millis(time::OffsetDateTime::now_utc()) - 3_600_000;
    let results = push(
        &db,
        owner,
        vec![create(
            id,
            "Статья про графы",
            Some(json!({
                "body": "Статья про графы\nпрочитать до пятницы",
                "url": "https://example.ru/graphs",
                "source": "android",
                "captured_at_ms": hour_ago,
            })),
        )],
        &rules(),
    )
    .await;
    assert!(
        matches!(results[0], OpResult::Applied { revision: 1, .. }),
        "{results:?}"
    );

    let mut conn = db.pool().acquire().await.unwrap();
    let item = qubite_inbox::get(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(item.kind, Kind::Link, "есть ссылка — значит ссылка");
    assert_eq!(item.source, Source::Android);
    assert_eq!(item.body, "Статья про графы\nпрочитать до пятницы");
    assert_eq!(qubite_inbox::millis(item.captured_at), hour_ago);
    assert_eq!(item.status, Status::New);
    assert_eq!(item.triage.status, TriageStatus::Pending);

    // Устройство забирает элемент вместе с полями.
    let pulled = qubite_sync_server::pull_with(db.pool(), owner, 0, 100, &rules())
        .await
        .unwrap();
    let fields = pulled.changes[0].fields.as_ref().unwrap();
    assert_eq!(fields["status"], "new");
    assert_eq!(fields["url"], "https://example.ru/graphs");
    assert_eq!(fields["triage"]["status"], "pending");

    // Часы устройства в будущем — время записи становится «сейчас».
    let future = Uuid::now_v7();
    push(
        &db,
        owner,
        vec![create(
            future,
            "из будущего",
            Some(json!({ "captured_at_ms": i64::MAX / 2_000_000 })),
        )],
        &rules(),
    )
    .await;
    let item = qubite_inbox::get(&mut conn, owner, future)
        .await
        .unwrap()
        .unwrap();
    assert!(item.captured_at <= time::OffsetDateTime::now_utc());
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn bad_fields_reject_without_leaving_half_an_object() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let cases = [
        json!({ "tags": ["учёба"] }), // ручных тегов нет (D-191)
        json!({ "kind": "link" }),    // ссылка без url
        json!({ "url": "javascript:alert(1)" }),
        json!({ "body": "я".repeat(20_001) }),
        json!({ "status": "archived" }), // статус при создании не задаётся
    ];
    for fields in cases {
        let id = Uuid::now_v7();
        let results = push(
            &db,
            owner,
            vec![create(id, "мысль", Some(fields.clone()))],
            &rules(),
        )
        .await;
        assert!(
            matches!(
                &results[0],
                OpResult::Rejected {
                    reason: RejectReason::Invalid,
                    ..
                }
            ),
            "{fields}: {results:?}"
        );
        let mut conn = db.pool().acquire().await.unwrap();
        assert!(
            objects::get_any(&mut conn, id).await.unwrap().is_none(),
            "{fields}: объект остался"
        );
    }
    let empty = push(
        &db,
        owner,
        vec![create(Uuid::now_v7(), "   ", None)],
        &rules(),
    )
    .await;
    assert!(
        matches!(&empty[0], OpResult::Rejected { .. }),
        "пустая мысль"
    );
    test_db.drop_db().await;
}

#[tokio::test]
async fn archive_is_a_versioned_change_and_conflicts_return_fields() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let id = Uuid::now_v7();
    push(
        &db,
        owner,
        vec![create(id, "позвонить бабушке", None)],
        &rules(),
    )
    .await;

    let archived = push(
        &db,
        owner,
        vec![patch(id, 1, json!({ "status": "archived" }))],
        &rules(),
    )
    .await;
    assert!(
        matches!(archived[0], OpResult::Applied { revision: 2, .. }),
        "{archived:?}"
    );
    let mut conn = db.pool().acquire().await.unwrap();
    let item = qubite_inbox::get(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(item.status, Status::Archived);
    assert!(item.archived_at.is_some());
    assert_eq!(
        qubite_inbox::list(&mut conn, owner, View::New, 50)
            .await
            .unwrap()
            .len(),
        0
    );
    assert_eq!(
        qubite_inbox::list(&mut conn, owner, View::Archived, 50)
            .await
            .unwrap()
            .len(),
        1
    );

    // Второе устройство правит со старой версии — конфликт с текущими полями.
    let stale = push(
        &db,
        owner,
        vec![patch(id, 1, json!({ "body": "позвонить маме" }))],
        &rules(),
    )
    .await;
    match &stale[0] {
        OpResult::Conflict { current, .. } => {
            assert_eq!(current.revision, 2);
            assert_eq!(current.fields.as_ref().unwrap()["status"], "archived");
        }
        other => panic!("ждали конфликт: {other:?}"),
    }
    let item = qubite_inbox::get(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        item.body, "позвонить бабушке",
        "конфликтная правка не применилась"
    );

    // Разбор с устройства не меняется — только сервером.
    let triage = push(
        &db,
        owner,
        vec![patch(id, 2, json!({ "intent": "task" }))],
        &rules(),
    )
    .await;
    assert!(matches!(
        &triage[0],
        OpResult::Rejected {
            reason: RejectReason::Invalid,
            ..
        }
    ));

    // Вернуть из архива, удалить в корзину и восстановить (отмена).
    let back = push(
        &db,
        owner,
        vec![patch(id, 2, json!({ "status": "new" }))],
        &rules(),
    )
    .await;
    assert!(
        matches!(back[0], OpResult::Applied { revision: 3, .. }),
        "{back:?}"
    );
    let item = qubite_inbox::get(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((item.status, item.archived_at), (Status::New, None));
    let delete = Operation {
        op_id: Uuid::now_v7(),
        object_id: id,
        base_revision: Some(3),
        kind: OpKind::Delete,
    };
    push(&db, owner, vec![delete], &rules()).await;
    assert_eq!(
        qubite_inbox::list(&mut conn, owner, View::Trash, 50)
            .await
            .unwrap()
            .len(),
        1
    );
    let restore = Operation {
        op_id: Uuid::now_v7(),
        object_id: id,
        base_revision: Some(4),
        kind: OpKind::Restore,
    };
    push(&db, owner, vec![restore], &rules()).await;
    assert_eq!(
        qubite_inbox::list(&mut conn, owner, View::New, 50)
            .await
            .unwrap()
            .len(),
        1
    );
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn module_rights_and_registry_decide_what_syncs() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();

    // Без права записи во Входящие — отказ, ничего не создано.
    let no_write = Rules {
        writable: Some(HashSet::new()),
        ..rules()
    };
    let id = Uuid::now_v7();
    let results = push(&db, owner, vec![create(id, "мысль", None)], &no_write).await;
    assert!(matches!(
        &results[0],
        OpResult::Rejected {
            reason: RejectReason::Forbidden,
            ..
        }
    ));

    // Тип без обработчика через HTTP (strict) не создать.
    let unknown = Operation {
        op_id: Uuid::now_v7(),
        object_id: Uuid::now_v7(),
        base_revision: None,
        kind: OpKind::Create {
            object_type: "docs.page".into(),
            title: "страница".into(),
            fields: None,
        },
    };
    let all_write = Rules {
        writable: None,
        ..rules()
    };
    let results = push(&db, owner, vec![unknown], &all_write).await;
    assert!(matches!(
        &results[0],
        OpResult::Rejected {
            reason: RejectReason::Invalid,
            ..
        }
    ));

    // Без права чтения модуля pull его не отдаёт.
    push(&db, owner, vec![create(id, "мысль", None)], &rules()).await;
    let blind = Rules {
        readable: Some(vec![]),
        ..rules()
    };
    let pulled = qubite_sync_server::pull_with(db.pool(), owner, 0, 100, &blind)
        .await
        .unwrap();
    assert!(pulled.changes.is_empty());
    let pulled = qubite_sync_server::pull_with(db.pool(), owner, 0, 100, &rules())
        .await
        .unwrap();
    assert_eq!(pulled.changes.len(), 1);
    test_db.drop_db().await;
}

#[tokio::test]
async fn triage_links_own_objects_and_confirm_archives() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let stranger = Uuid::now_v7();
    let mut conn = db.pool().acquire().await.unwrap();
    let project = objects::create(
        &mut conn,
        NewObject::new("planner.project", owner, "Олимпиада"),
    )
    .await
    .unwrap();
    let course = objects::create(&mut conn, NewObject::new("planner.project", owner, "Графы"))
        .await
        .unwrap();
    let foreign = objects::create(
        &mut conn,
        NewObject::new("planner.project", stranger, "Чужой"),
    )
    .await
    .unwrap();
    drop(conn);
    let id = Uuid::now_v7();
    push(
        &db,
        owner,
        vec![create(id, "решить 5 задач на графы к олимпиаде", None)],
        &rules(),
    )
    .await;
    let mut conn = db.pool().acquire().await.unwrap();

    // Нельзя привязать к чужому объекту — и ничего не меняется.
    let bad = qubite_inbox::suggest(
        &mut conn,
        owner,
        id,
        1,
        owner,
        Suggestion {
            intent: Intent::Task,
            by: TriageBy::Ai,
            confidence: Some(0.9),
            summary: None,
            links: vec![SuggestedLink {
                to: foreign.id,
                confidence: None,
            }],
        },
    )
    .await;
    assert!(
        matches!(bad, Err(qubite_objects::Error::NotFound)),
        "{bad:?}"
    );
    let item = qubite_inbox::get(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (item.revision, item.triage.status),
        (1, TriageStatus::Pending)
    );

    // Человек сам привязал к проекту «Графы».
    relations::link(
        &mut conn,
        NewRelation::manual(id, course.id, qubite_inbox::ABOUT, owner),
    )
    .await
    .unwrap();

    let suggestion = |links: Vec<Uuid>| Suggestion {
        intent: Intent::Task,
        by: TriageBy::Ai,
        confidence: Some(0.8),
        summary: Some("Задача к олимпиаде".into()),
        links: links
            .into_iter()
            .map(|to| SuggestedLink {
                to,
                confidence: Some(0.7),
            })
            .collect(),
    };
    let item = qubite_inbox::suggest(&mut conn, owner, id, 1, owner, suggestion(vec![project.id]))
        .await
        .unwrap();
    assert_eq!(item.triage.status, TriageStatus::Suggested);
    assert_eq!(item.triage.intent, Some(Intent::Task));
    assert_eq!(item.triage.details["by"], "ai");
    let links = qubite_inbox::links(&mut conn, id).await.unwrap();
    assert_eq!(links.len(), 2);
    assert!(
        links
            .iter()
            .any(|link| link.to_id == project.id && link.source == "ai")
    );

    // Повторный разбор заменяет связи AI, а связь человека остаётся.
    let item = qubite_inbox::suggest(
        &mut conn,
        owner,
        id,
        item.revision,
        owner,
        suggestion(vec![]),
    )
    .await
    .unwrap();
    let links = qubite_inbox::links(&mut conn, id).await.unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(
        (links[0].to_id, links[0].source.as_str()),
        (course.id, "manual")
    );

    // Старая версия — конфликт; подтверждение — разобрано и в архиве.
    assert!(matches!(
        qubite_inbox::confirm(&mut conn, owner, id, 1, owner).await,
        Err(qubite_objects::Error::Conflict { .. })
    ));
    let item = qubite_inbox::confirm(&mut conn, owner, id, item.revision, owner)
        .await
        .unwrap();
    assert_eq!(item.triage.status, TriageStatus::Confirmed);
    assert_eq!(item.status, Status::Archived);
    // Чужой не видит элемент.
    assert!(
        qubite_inbox::get(&mut conn, stranger, id)
            .await
            .unwrap()
            .is_none()
    );
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn every_change_notifies_the_owner_channel() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let mut listener = sqlx::postgres::PgListener::connect_with(db.pool())
        .await
        .unwrap();
    listener
        .listen(qubite_sync_server::CHANGES_CHANNEL)
        .await
        .unwrap();

    let id = Uuid::now_v7();
    push(&db, owner, vec![create(id, "мысль", None)], &rules()).await;
    let note = tokio::time::timeout(std::time::Duration::from_secs(5), listener.recv())
        .await
        .expect("уведомление пришло")
        .unwrap();
    assert_eq!(
        note.payload(),
        owner.to_string(),
        "только ID владельца, без данных"
    );
    test_db.drop_db().await;
}
