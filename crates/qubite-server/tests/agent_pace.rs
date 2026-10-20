//! «Когда писать» и ответ кнопкой через настоящий HTTP-сервер (AGT-004).

mod common;

use common::logged_in;
use qubite_agent::{Trigger, Who, call, start_run};
use qubite_server::auth::AuthSettings;
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
async fn pace_setting_and_answer_buttons_over_http() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let pool = db.pool();
    let mut owner = logged_in(address).await;
    let me: Uuid = sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_one(pool)
        .await
        .unwrap();
    // Ночная тишина выключена: тест не зависит от часа запуска.
    let quiet = owner
        .patch_json(
            address,
            "/api/v1/notifications/settings",
            json!({"quiet_from": "00:00", "quiet_to": "00:00"}),
        )
        .await;
    assert_eq!(quiet.status, 200, "{:?}", quiet.body);

    // По умолчанию — «сколько Qubite захочет», начинает с 3 в день.
    let pace = owner.get(address, "/api/v1/agent/pace").await;
    assert_eq!(pace.status, 200, "{:?}", pace.body);
    assert_eq!(pace.body["mode"], "auto");
    assert_eq!(pace.body["limit"], 3);
    assert_eq!(pace.body["sent"], 0);
    assert_eq!(pace.body["not_today"], false);
    assert!(pace.body["quiet"].is_null());
    assert_eq!(
        pace.body["windows"].as_array().unwrap().len(),
        1,
        "весь остаток дня свободен"
    );

    let changed = owner
        .patch_json(
            address,
            "/api/v1/agent/pace",
            json!({"mode": "count", "per_day": 2}),
        )
        .await;
    assert_eq!(changed.status, 200, "{:?}", changed.body);
    assert_eq!(changed.body["limit"], 2);
    let bad = owner
        .patch_json(address, "/api/v1/agent/pace", json!({"mode": "often"}))
        .await;
    assert_eq!(bad.status, 400);

    // Агент спросил «есть 30 минут?» — в колокольчике кнопки.
    let who = Who::agent(&start_run(pool, me, Trigger::Window).await.unwrap());
    call(
        pool,
        &who,
        "notify.send",
        json!({"title": "Есть 30 минут?", "ask_minutes": 30}),
        Some("свободное окно"),
        None,
    )
    .await
    .unwrap();
    let list = owner.get(address, "/api/v1/notifications").await;
    let item = &list.body["items"][0];
    assert_eq!(item["kind"], "agent");
    assert_eq!(item["options"][2]["text"], "Позже");
    assert!(item["answer"].is_null());
    let id = item["id"].as_str().unwrap().to_owned();

    let wrong = owner
        .post_json(
            address,
            &format!("/api/v1/notifications/{id}/answer"),
            json!({"answer": "maybe"}),
        )
        .await;
    assert_eq!(wrong.status, 400);
    let answered = owner
        .post_json(
            address,
            &format!("/api/v1/notifications/{id}/answer"),
            json!({"answer": "later"}),
        )
        .await;
    assert_eq!(answered.status, 200, "{:?}", answered.body);
    assert_eq!(answered.body["accepted"], true);
    assert_eq!(answered.body["hint"], "Понял, спрошу позже");
    let again = owner
        .post_json(
            address,
            &format!("/api/v1/notifications/{id}/answer"),
            json!({"answer": "yes"}),
        )
        .await;
    assert_eq!(again.body["accepted"], false);
    let later: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM jobs WHERE kind = 'agent.wake' AND idempotency_key LIKE '%:later:%' \
         AND run_at > now() + interval '50 minutes'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(later, 1, "«позже» — спросить через час");
    let list = owner.get(address, "/api/v1/notifications").await;
    assert_eq!(list.body["items"][0]["answer"], "later");
    assert_eq!(list.body["unread"], 0, "ответ гасит сообщение");

    let pace = owner.get(address, "/api/v1/agent/pace").await;
    assert_eq!(pace.body["sent"], 1);

    db.close().await;
    test_db.drop_db().await;
}
