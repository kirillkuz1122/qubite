//! CAL-001a: календарь через HTTP, повторы, расписание и границы прав.

mod common;

use common::{Browser, logged_in};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_planner::millis;
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use time::macros::datetime;
use uuid::Uuid;

fn event(title: &str) -> Value {
    json!({
        "title": title,
        "starts_at": millis(datetime!(2026-10-19 08:00 UTC)),
        "ends_at": millis(datetime!(2026-10-19 09:00 UTC)),
        "place": "Школа",
    })
}

fn window() -> String {
    format!(
        "/api/calendar?from={}&to={}",
        millis(datetime!(2026-10-19 00:00 UTC)),
        millis(datetime!(2026-10-21 00:00 UTC)),
    )
}

#[tokio::test]
async fn create_patch_repeat_and_soft_delete() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let mut input = event("Тренировка");
    input["recurrence"] = json!({"freq": "daily"});
    let made = owner
        .post_json(address, "/api/calendar/events", input)
        .await;
    assert_eq!(made.status, 201, "{:?}", made.body);
    assert_eq!(made.body["revision"], 1);
    assert_eq!(made.body["recurrence"]["interval"], 1);
    assert!(made.body["created_at"].is_i64());
    let id = made.body["id"].as_str().unwrap();
    let path = format!("/api/calendar/events/{id}");

    let listed = owner.get(address, &window()).await;
    assert_eq!(listed.status, 200, "{:?}", listed.body);
    let items = listed.body.as_array().unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0]["source_id"], id);
    assert_eq!(items[0]["kind"], "event");
    assert_eq!(
        items[1]["starts_at"],
        millis(datetime!(2026-10-20 08:00 UTC))
    );

    let edited = owner
        .patch_json(
            address,
            &path,
            json!({"title": "Бег", "place": "Парк", "revision": 1}),
        )
        .await;
    assert_eq!(edited.status, 200, "{:?}", edited.body);
    assert_eq!(edited.body["revision"], 2);
    let stale = owner
        .patch_json(address, &path, json!({"title": "старое", "revision": 1}))
        .await;
    assert_eq!(stale.status, 409);
    let listed = owner.get(address, &window()).await;
    for item in listed.body.as_array().unwrap() {
        assert_eq!(item["title"], "Бег");
        assert_eq!(item["place"], "Парк");
    }

    // Явное null убирает повтор, пропущенные поля сохраняются.
    let cleared = owner
        .patch_json(address, &path, json!({"recurrence": null}))
        .await;
    assert_eq!(cleared.status, 200, "{:?}", cleared.body);
    assert!(cleared.body["recurrence"].is_null());
    assert_eq!(
        owner
            .get(address, &window())
            .await
            .body
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(owner.delete(address, &path).await.status, 204);
    assert_eq!(owner.delete(address, &path).await.status, 404);
    assert_eq!(
        owner
            .patch_json(address, &path, json!({"title": "x"}))
            .await
            .status,
        404
    );
    assert_eq!(owner.get(address, &window()).await.body, json!([]));
    let deleted: (bool, i64) =
        sqlx::query_as("SELECT deleted, revision FROM calendar_events WHERE id=$1")
            .bind(Uuid::parse_str(id).unwrap())
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(deleted, (true, 4));
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn calendar_combines_tasks_and_schedule_in_platform_timezone() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let timed = Uuid::now_v7();
    let all_day = Uuid::now_v7();
    let outside = Uuid::now_v7();
    let no_date = Uuid::now_v7();
    let ops: Vec<Value> = [
        (
            timed,
            "Со временем",
            json!({"due_date": "2026-10-19", "due_time": "16:00"}),
        ),
        (all_day, "Весь день", json!({"due_date": "2026-10-19"})),
        (outside, "За окном", json!({"due_date": "2026-10-22"})),
        (no_date, "Без срока", json!({})),
    ]
    .into_iter()
    .map(|(id, title, fields)| {
        json!({
            "op_id": Uuid::now_v7(), "object_id": id,
            "kind": "create", "object_type": "planner.task", "title": title, "fields": fields,
        })
    })
    .collect();
    let pushed = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            json!({"device_id": Uuid::now_v7(), "ops": ops}),
        )
        .await;
    assert_eq!(pushed.status, 200, "{:?}", pushed.body);
    for result in pushed.body["results"].as_array().unwrap() {
        assert_eq!(result["status"], "applied", "{result}");
    }
    let schedule = owner
        .post_json(
            address,
            "/api/v1/agent/files",
            json!({
                "path": "Расписание.md",
                "body": "| День | Начало | Конец | Что | Где |\n|---|---|---|---|---|\n| пн | 08:30 | 09:15 | Алгебра | 204 |",
            }),
        )
        .await;
    assert_eq!(schedule.status, 200, "{:?}", schedule.body);
    let made = owner
        .post_json(address, "/api/calendar/events", event("Событие"))
        .await;
    assert_eq!(made.status, 201, "{:?}", made.body);
    let listed = owner.get(address, &window()).await;
    assert_eq!(listed.status, 200, "{:?}", listed.body);
    let items = listed.body.as_array().unwrap();
    assert_eq!(items.len(), 4, "{:?}", listed.body);
    let task = items
        .iter()
        .find(|item| item["source_id"] == timed.to_string())
        .unwrap();
    assert_eq!(task["starts_at"], millis(datetime!(2026-10-19 11:00 UTC)));
    assert_eq!(task["ends_at"], task["starts_at"]);
    assert_eq!(task["all_day"], false);
    let day = items
        .iter()
        .find(|item| item["source_id"] == all_day.to_string())
        .unwrap();
    assert_eq!(day["starts_at"], millis(datetime!(2026-10-18 19:00 UTC)));
    assert_eq!(day["ends_at"], millis(datetime!(2026-10-19 19:00 UTC)));
    assert_eq!(day["all_day"], true);
    let lesson = items.iter().find(|item| item["kind"] == "lesson").unwrap();
    assert_eq!(lesson["title"], "Алгебра");
    assert_eq!(lesson["place"], "204");
    assert_eq!(lesson["starts_at"], millis(datetime!(2026-10-19 03:30 UTC)));
    assert_eq!(lesson["ends_at"], millis(datetime!(2026-10-19 04:15 UTC)));
    assert!(Uuid::parse_str(lesson["source_id"].as_str().unwrap()).is_ok());
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn events_are_private_and_invalid_windows_and_fields_are_rejected() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let made = owner
        .post_json(address, "/api/calendar/events", event("Личное"))
        .await;
    assert_eq!(made.status, 201, "{:?}", made.body);
    let path = format!("/api/calendar/events/{}", made.body["id"].as_str().unwrap());
    let user = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "calendar@qubite.ru",
            display_name: "",
            password: common::PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut other = Browser::default();
    assert_eq!(
        other
            .login(address, "calendar@qubite.ru", common::PASSWORD)
            .await
            .status,
        200
    );
    assert_eq!(other.get(address, &window()).await.status, 403);
    assert_eq!(
        other
            .post_json(address, "/api/calendar/events", event("x"))
            .await
            .status,
        403
    );
    let grant = owner
        .put_json(
            address,
            &format!("/api/owner/accounts/{}/grants/planner", user.id),
            json!({"read": true, "write": true, "manage": false, "ai": false}),
        )
        .await;
    assert_eq!(grant.status, 200, "{:?}", grant.body);
    assert_eq!(other.get(address, &window()).await.body, json!([]));
    assert_eq!(
        other
            .patch_json(address, &path, json!({"title": "Чужое"}))
            .await
            .status,
        404
    );
    assert_eq!(other.delete(address, &path).await.status, 404);
    let mine = other
        .post_json(address, "/api/calendar/events", event("Моё"))
        .await;
    assert_eq!(mine.status, 201, "{:?}", mine.body);
    let listed = other.get(address, &window()).await;
    assert_eq!(listed.body.as_array().unwrap().len(), 1);
    assert_eq!(listed.body[0]["title"], "Моё");

    for query in ["from=1&to=1", "from=2&to=1", "from=0&to=5356800001"] {
        assert_eq!(
            owner
                .get(address, &format!("/api/calendar?{query}"))
                .await
                .status,
            400
        );
    }
    for invalid in [
        json!({"title": " "}),
        json!({"ends_at": 0}),
        json!({"recurrence": {"freq": "daily", "interval": 0}}),
        json!({"recurrence": {"freq": "weekly", "weekdays": [8]}}),
        json!({"recurrence": {"freq": "monthly", "month_day": 32}}),
    ] {
        let response = owner.patch_json(address, &path, invalid).await;
        assert_eq!(response.status, 400, "{:?}", response.body);
    }
    let mut invalid = event("x");
    invalid["title"] = json!("");
    assert_eq!(
        owner
            .post_json(address, "/api/calendar/events", invalid)
            .await
            .status,
        400
    );
    let mut invalid = event("x");
    invalid["project_id"] = json!(Uuid::now_v7());
    assert_eq!(
        owner
            .post_json(address, "/api/calendar/events", invalid)
            .await
            .status,
        404
    );
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn repeats_keep_month_days_week_intervals_and_local_clock() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let cases = [
        (
            datetime!(2000-01-01 08:00 UTC),
            json!({"freq": "daily", "interval": 1}),
            datetime!(2026-10-19 00:00 UTC),
            datetime!(2026-10-21 00:00 UTC),
            vec![
                datetime!(2026-10-19 08:00 UTC),
                datetime!(2026-10-20 08:00 UTC),
            ],
        ),
        (
            datetime!(2026-01-31 08:00 UTC),
            json!({"freq": "monthly"}),
            datetime!(2026-02-01 00:00 UTC),
            datetime!(2026-04-01 00:00 UTC),
            vec![
                datetime!(2026-02-28 08:00 UTC),
                datetime!(2026-03-31 08:00 UTC),
            ],
        ),
        (
            datetime!(2026-10-19 08:00 UTC),
            json!({"freq": "weekly", "interval": 2, "weekdays": [1, 4]}),
            datetime!(2026-11-01 00:00 UTC),
            datetime!(2026-11-09 00:00 UTC),
            vec![
                datetime!(2026-11-02 08:00 UTC),
                datetime!(2026-11-05 08:00 UTC),
            ],
        ),
    ];
    for (first, recurrence, from, to, expected) in cases {
        let made = owner
            .post_json(
                address,
                "/api/calendar/events",
                json!({
                    "title": "Повтор",
                    "starts_at": millis(first),
                    "ends_at": millis(first) + 3_600_000,
                    "recurrence": recurrence,
                }),
            )
            .await;
        assert_eq!(made.status, 201, "{:?}", made.body);
        let listed = owner
            .get(
                address,
                &format!("/api/calendar?from={}&to={}", millis(from), millis(to)),
            )
            .await;
        assert_eq!(listed.status, 200, "{:?}", listed.body);
        let starts: Vec<i64> = listed
            .body
            .as_array()
            .unwrap()
            .iter()
            .map(|item| item["starts_at"].as_i64().unwrap())
            .collect();
        assert_eq!(starts, expected.into_iter().map(millis).collect::<Vec<_>>());
        let path = format!("/api/calendar/events/{}", made.body["id"].as_str().unwrap());
        assert_eq!(owner.delete(address, &path).await.status, 204);
    }

    // Переход с летнего времени: местные 09:00 остаются 09:00.
    sqlx::query(
        "INSERT INTO platform_settings (key, value) VALUES ('platform.timezone', '\"Europe/Berlin\"') \
         ON CONFLICT (key) DO UPDATE SET value=excluded.value",
    )
    .execute(db.pool())
    .await
    .unwrap();
    let made = owner
        .post_json(
            address,
            "/api/calendar/events",
            json!({
                "title": "Утро",
                "starts_at": millis(datetime!(2026-10-24 07:00 UTC)),
                "ends_at": millis(datetime!(2026-10-24 08:00 UTC)),
                "recurrence": {"freq": "daily"},
            }),
        )
        .await;
    assert_eq!(made.status, 201, "{:?}", made.body);
    let from = millis(datetime!(2026-10-25 00:00 UTC));
    let to = millis(datetime!(2026-10-26 00:00 UTC));
    let listed = owner
        .get(address, &format!("/api/calendar?from={from}&to={to}"))
        .await;
    assert_eq!(listed.status, 200, "{:?}", listed.body);
    assert_eq!(
        listed.body[0]["starts_at"],
        millis(datetime!(2026-10-25 08:00 UTC))
    );
    assert_eq!(
        listed.body[0]["ends_at"],
        millis(datetime!(2026-10-25 09:00 UTC))
    );
    db.close().await;
    test_db.drop_db().await;
}
