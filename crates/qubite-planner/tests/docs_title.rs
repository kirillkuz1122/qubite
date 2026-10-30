//! Офлайн-название не конфликтует с независимой правкой Yjs.
use qubite_objects::{NewObject, objects};
use qubite_planner::ydoc;
use qubite_sync::{OpKind, OpResult, Operation, PushRequest};
use qubite_sync_server::push;
use qubite_testkit::TestDb;
use serde_json::json;
use uuid::Uuid;
use yrs::{Doc, ReadTxn, StateVector, Text, Transact};

fn rename(id: Uuid, revision: i64, title: &str) -> PushRequest {
    PushRequest {
        device_id: Uuid::now_v7(),
        ops: vec![Operation {
            op_id: Uuid::now_v7(),
            object_id: id,
            base_revision: Some(revision),
            kind: OpKind::SetTitle {
                title: title.into(),
            },
        }],
    }
}

#[tokio::test]
async fn offline_title_survives_yjs_posts_but_real_title_conflicts_remain() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let mut conn = db.pool().acquire().await.unwrap();
    let object = objects::create(&mut conn, NewObject::new("docs.page", owner, "Старое"))
        .await
        .unwrap();
    sqlx::query("INSERT INTO docs_pages (object_id) VALUES ($1)")
        .bind(object.id)
        .execute(&mut *conn)
        .await
        .unwrap();
    let offline = rename(object.id, object.revision, "Офлайн-название");
    let doc = Doc::with_client_id(1);
    let text = doc.get_or_insert_text("text");
    let mut body = String::new();
    for value in ["Первая правка", " + другая правка"] {
        body.push_str(value);
        let offset = text.len(&doc.transact());
        text.insert(&mut doc.transact_mut(), offset, value);
        let update = doc
            .transact()
            .encode_state_as_update_v1(&StateVector::default());
        ydoc::apply(&mut conn, owner, object.id, &update, &body, false)
            .await
            .unwrap();
    }
    let result = push(db.pool(), owner, &offline).await.unwrap();
    assert!(matches!(
        result.results[0],
        OpResult::Applied { revision: 4, .. }
    ));
    let current = objects::get(&mut conn, object.id).await.unwrap().unwrap();
    assert_eq!(current.title, "Офлайн-название");
    // bump по-прежнему обновляет превью и публикует события для остальных устройств.
    let snapshot = qubite_sync_server::pull(db.pool(), owner, 0, 100)
        .await
        .unwrap();
    assert_eq!(snapshot.changes[0].revision, 4);
    let events = qubite_objects::events::for_object(&mut conn, object.id)
        .await
        .unwrap();
    assert_eq!(events.len(), 4);
    assert_eq!(events[1].payload["fields"], json!(["body", "ystate"]));
    let stored: String = sqlx::query_scalar("SELECT body FROM docs_pages WHERE object_id = $1")
        .bind(object.id)
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(stored, body);
    let conflict = push(db.pool(), owner, &rename(object.id, 1, "Затереть название"))
        .await
        .unwrap();
    assert!(matches!(conflict.results[0], OpResult::Conflict { .. }));
    // Удаление/восстановление между базой и текущей версией тоже остаётся конфликтом.
    let deleted = objects::delete(&mut conn, object.id, 4, owner)
        .await
        .unwrap();
    objects::restore(&mut conn, object.id, deleted.revision, owner)
        .await
        .unwrap();
    let conflict = push(db.pool(), owner, &rename(object.id, 4, "После удаления"))
        .await
        .unwrap();
    assert!(matches!(conflict.results[0], OpResult::Conflict { .. }));
    let future = push(db.pool(), owner, &rename(object.id, 100, "Из будущего"))
        .await
        .unwrap();
    assert!(matches!(future.results[0], OpResult::Conflict { .. }));
    drop(conn);
    db.close().await;
    test_db.drop_db().await;
}
