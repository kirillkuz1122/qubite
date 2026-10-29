//! ENG-007c: замена микрофона без попытки ответа; реальная БД, без платного AI.
use qubite_ai::{AiConfig, Gateway, MockProvider, MockStep};
use qubite_auth::Passwords;
use qubite_english::{
    Error, course,
    lessons::{self, Given},
};
use qubite_testkit::TestDb;
use serde_json::json;
use std::sync::Arc;
use uuid::Uuid;

#[test]
fn voice_only_becomes_another_task_with_the_same_material() {
    let original = json!({
        "id": "repeat", "type": "speak", "mode": "repeat", "say": "Nice to meet you."
    });
    let replacement = course::without_microphone(&original).unwrap();
    assert_eq!(replacement["id"], original["id"]);
    assert_eq!(replacement["type"], "build");
    assert_eq!(course::answer_by(&replacement), "text");
    assert_eq!(
        course::check(&replacement, &json!("Nice to meet you."), 2),
        course::Check::Right
    );
    assert!(matches!(
        course::check(&replacement, &json!("Nice you meet to."), 2),
        course::Check::Wrong { .. }
    ));
    assert!(
        course::without_microphone(&json!({
            "id": "open", "type": "speak", "answer_by": "voice_or_text"
        }))
        .is_none()
    );
    assert!(
        course::without_microphone(&json!({
            "id": "empty", "type": "speak", "mode": "repeat", "say": " "
        }))
        .is_none()
    );
}

#[tokio::test]
async fn replacement_is_saved_idempotent_and_has_no_attempt_or_penalty() {
    let (_test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = qubite_auth::owner::create(
        pool,
        &Passwords::default(),
        "owner@qubite.ru",
        "",
        "пароль владельца",
    )
    .await
    .unwrap()
    .id;
    let run = lessons::start(pool, me, "a0-m1-l1", "lesson")
        .await
        .unwrap();
    let replacement = lessons::replace_voice(pool, me, run.id, None, "t7")
        .await
        .unwrap();
    assert!(replacement.answers.is_empty());
    assert_eq!(replacement.replacements.len(), 1);
    assert_eq!(replacement.replacements[0]["task"]["type"], "build");
    let again = lessons::replace_voice(pool, me, run.id, None, "t7")
        .await
        .unwrap();
    assert_eq!(again.replacements, replacement.replacements);
    let resumed = lessons::start(pool, me, "a0-m1-l1", "lesson")
        .await
        .unwrap();
    assert_eq!(resumed.replacements, replacement.replacements);
    let attempts: i64 =
        sqlx::query_scalar("SELECT count(*) FROM english_answers WHERE run_id = $1")
            .bind(run.id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(attempts, 0);
    let review: i64 =
        sqlx::query_scalar("SELECT count(*) FROM english_review WHERE account_id = $1")
            .bind(me)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(review, 0);

    let gateway = Gateway::new(pool.clone(), AiConfig::default()).with_provider(
        "mock",
        Arc::new(MockProvider::new(MockStep::Reply {
            text: "{}".into(),
            tokens_in: 0,
            tokens_out: 0,
        })),
    );
    let phrase = replacement.replacements[0]["task"]["answer"].clone();
    let answer = lessons::answer(
        pool,
        &gateway,
        me,
        run.id,
        None,
        "t7",
        Uuid::now_v7(),
        Given::Value(phrase),
    )
    .await
    .unwrap();
    assert!(answer.correct);
    assert_eq!(answer.attempts, 1);
    assert!(matches!(
        lessons::replace_voice(pool, me, run.id, None, "t1").await,
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        lessons::replace_voice(pool, me, run.id, None, "missing").await,
        Err(Error::NotFound)
    ));
    assert!(
        lessons::replace_voice(pool, Uuid::now_v7(), run.id, None, "t7")
            .await
            .is_err()
    );
    let home = lessons::lesson(pool, me, "a0-m1-l1").await.unwrap();
    assert_eq!(
        home.lesson["tasks"][6]["type"], "speak",
        "базовый урок не изменился"
    );
    let finished = lessons::finish(pool, &gateway, me, run.id).await.unwrap();
    assert_eq!(finished.need_speak, 2, "порог урока не снижен");
    assert!(finished.missing.iter().any(|id| id == "t8"));
    assert!(!finished.passed, "замена не пропускает остальные задания");
    assert!(matches!(
        lessons::replace_voice(pool, me, run.id, None, "t7").await,
        Err(Error::Invalid(_))
    ));
}
