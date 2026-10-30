//! Возможности: права, атомарные пакеты и откат. Только тестовая БД, без сети.

use qubite_agent::{
    Error, RevertOutcome, Run, Trigger, Who, call, opportunities, revert_action, revert_batch,
    start_run,
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn person(pool: &PgPool, email: &str, modules: &[&str]) -> Uuid {
    let id = qubite_auth::accounts::create(
        pool,
        &Passwords::default(),
        NewAccount {
            email,
            display_name: "",
            password: "пароль для теста",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap()
    .id;
    for module in modules {
        sqlx::query(
            "INSERT INTO module_grants (id, account_id, module_id, can_read, can_write) \
             VALUES ($1, $2, $3, true, true)",
        )
        .bind(Uuid::now_v7())
        .bind(id)
        .bind(module)
        .execute(pool)
        .await
        .unwrap();
    }
    id
}

async fn seed(pool: &PgPool, account: Uuid, days: i64, registration: bool) -> Uuid {
    let id = Uuid::now_v7();
    let starts = OffsetDateTime::now_utc() + Duration::days(days);
    sqlx::query(
        "INSERT INTO opportunities (id, account_id, source, external_id, kind, title, \
         registration_until, starts_at, ends_at, url) \
         VALUES ($1, $2, 'manual', $3, 'contest', 'Тестовое соревнование', $4, $5, $6, '')",
    )
    .bind(id)
    .bind(account)
    .bind(id.to_string())
    .bind(registration.then_some(starts - Duration::days(1)))
    .bind(starts)
    .bind(starts + Duration::hours(2))
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn state(pool: &PgPool, id: Uuid) -> (String, String) {
    sqlx::query_as("SELECT status, why FROM opportunities WHERE id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn suggest(pool: &PgPool, who: &Who, items: Value) -> qubite_agent::Result<qubite_agent::Action> {
    Ok(call(
        pool,
        who,
        opportunities::SUGGEST_TOOL,
        json!({"items": items}),
        None,
        None,
    )
    .await?
    .action()
    .unwrap())
}

async fn task_count(pool: &PgPool, account: Uuid) -> i64 {
    sqlx::query_scalar(
        "SELECT count(*) FROM objects \
         WHERE owner_id = $1 AND type = 'planner.task' AND deleted_at IS NULL",
    )
    .bind(account)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[tokio::test]
async fn suggest_is_atomic_owned_future_limited_and_revertible() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@example.org", &["agent", "planner"]).await;
    let other = person(pool, "other@example.org", &["agent"]).await;
    let who = Who::agent(&start_run(pool, me, Trigger::Morning).await.unwrap());
    let owner = Who::owner(me, None);
    let mine = seed(pool, me, 20, false).await;
    let second = seed(pool, me, 21, false).await;
    let third = seed(pool, me, 22, false).await;
    let theirs = seed(pool, other, 20, false).await;
    let past = seed(pool, me, -2, false).await;
    let dismissed = seed(pool, me, 20, false).await;
    opportunities::decide(pool, &owner, dismissed, false)
        .await
        .unwrap();

    for id in [theirs, Uuid::now_v7()] {
        let items = json!([
            {"id": mine, "why": "интерес"}, {"id": id, "why": "интерес"},
        ]);
        assert!(matches!(
            suggest(pool, &who, items).await,
            Err(Error::NotFound)
        ));
        assert_eq!(state(pool, mine).await.0, "new");
    }
    for items in [
        json!([]),
        json!([{"id": past, "why": "интерес"}]),
        json!([{"id": dismissed, "why": "интерес"}]),
        json!([{"id": mine, "why": "я".repeat(301)}]),
        json!([{"id": mine, "why": " "}]),
        json!([{"id": mine, "why": "интерес"}, {"id": mine, "why": "интерес"}]),
        json!([
            {"id": mine, "why": "интерес"}, {"id": second, "why": "интерес"},
            {"id": third, "why": "интерес"}, {"id": dismissed, "why": "интерес"},
        ]),
    ] {
        assert!(matches!(
            suggest(pool, &who, items).await,
            Err(Error::Invalid(_))
        ));
        assert_eq!(state(pool, mine).await.0, "new");
    }
    let action = suggest(
        pool,
        &who,
        json!([
            {"id": mine, "why": "Любишь программирование"},
            {"id": second, "why": "я".repeat(300)},
            {"id": third, "why": "По твоим интересам"},
        ]),
    )
    .await
    .unwrap();
    assert_eq!(action.changes.len(), 3);
    assert_eq!(
        state(pool, mine).await,
        ("suggested".into(), "Любишь программирование".into())
    );
    assert!(matches!(
        suggest(pool, &who, json!([{"id": mine, "why": "снова"}])).await,
        Err(Error::Invalid(_))
    ));
    revert_action(pool, &owner, action.id, false).await.unwrap();
    for id in [mine, second, third] {
        assert_eq!(state(pool, id).await, ("new".into(), String::new()));
    }
    test_db.drop_db().await;
}

#[tokio::test]
async fn interested_is_one_package_with_three_deadlines_and_no_duplicates() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@example.org", &["agent", "planner"]).await;
    let id = seed(pool, me, 20, true).await;
    let owner = Who::owner(me, None);
    let who = Who::agent(&start_run(pool, me, Trigger::Morning).await.unwrap());
    suggest(pool, &who, json!([{"id": id, "why": "Подходит тебе"}]))
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        opportunities::decide(pool, &owner, id, true),
        opportunities::decide(pool, &owner, id, true),
    );
    let actions: Vec<_> = [a.unwrap(), b.unwrap()].into_iter().flatten().collect();
    assert_eq!(actions.len(), 1);
    let action = &actions[0];
    assert_eq!(action.state.batch_size, 1);
    assert_eq!(action.changes.len(), 4, "три дела и один статус");
    assert_eq!(task_count(pool, me).await, 3);
    assert_eq!(state(pool, id).await.0, "interested");
    let expected: (time::PrimitiveDateTime, time::PrimitiveDateTime) = sqlx::query_as(
        "SELECT registration_until AT TIME ZONE $2, starts_at AT TIME ZONE $2 \
         FROM opportunities WHERE id = $1",
    )
    .bind(id)
    .bind(qubite_planner::DEFAULT_TIMEZONE)
    .fetch_one(pool)
    .await
    .unwrap();
    let mut conn = pool.acquire().await.unwrap();
    let tasks = qubite_planner::list_tasks(&mut conn, me, None, 100)
        .await
        .unwrap();
    for task in &tasks {
        let date = if task.title.starts_with("Зарегистрироваться") {
            expected.0
        } else if task.title.starts_with("Подготовиться") {
            expected.1 - Duration::days(7)
        } else {
            assert_eq!(task.title, "Тестовое соревнование — участие");
            expected.1
        };
        assert_eq!(task.due_date, Some(date.date()));
        let due_time = task.due_time.unwrap();
        assert_eq!(due_time.hour(), date.hour());
        assert_eq!(due_time.minute(), date.minute());
    }
    drop(conn);
    let reverted = revert_batch(pool, &owner, action.batch_id, false)
        .await
        .unwrap();
    let RevertOutcome::Reverted { actions } = reverted else {
        panic!("нужен откат");
    };
    assert_eq!(actions.len(), 1);
    assert_eq!(task_count(pool, me).await, 0);
    assert_eq!(
        state(pool, id).await,
        ("suggested".into(), "Подходит тебе".into())
    );
    // Откат отката возвращает тот же набор дел.
    revert_action(pool, &owner, actions[0].id, false)
        .await
        .unwrap();
    assert_eq!(task_count(pool, me).await, 3);
    assert!(
        opportunities::decide(pool, &owner, id, true)
            .await
            .unwrap()
            .is_none()
    );
    // Скрытие уже запланированного события тоже не должно породить дубли.
    opportunities::decide(pool, &owner, id, false)
        .await
        .unwrap();
    opportunities::decide(pool, &owner, id, true)
        .await
        .unwrap();
    assert_eq!(task_count(pool, me).await, 3);
    test_db.drop_db().await;
}

#[tokio::test]
async fn missing_or_expired_registration_is_skipped_and_preparation_is_not_before_tomorrow() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@example.org", &["agent", "planner"]).await;
    let owner = Who::owner(me, None);
    let no_date = seed(pool, me, 2, false).await;
    let expired = seed(pool, me, 2, true).await;
    sqlx::query(
        "UPDATE opportunities SET registration_until = now() - interval '1 day' WHERE id = $1",
    )
    .bind(expired)
    .execute(pool)
    .await
    .unwrap();
    for id in [no_date, expired] {
        opportunities::decide(pool, &owner, id, true)
            .await
            .unwrap();
    }
    let mut conn = pool.acquire().await.unwrap();
    let tomorrow = qubite_planner::today(&mut conn)
        .await
        .unwrap()
        .next_day()
        .unwrap();
    let tasks = qubite_planner::list_tasks(&mut conn, me, None, 100)
        .await
        .unwrap();
    assert_eq!(tasks.len(), 4);
    for task in tasks
        .iter()
        .filter(|task| task.title.starts_with("Подготовиться"))
    {
        assert_eq!(task.due_date, Some(tomorrow));
    }
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn manual_add_dismiss_and_revert_of_revert() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@example.org", &["agent", "planner"]).await;
    let who = Who::agent(&start_run(pool, me, Trigger::Manual).await.unwrap());
    let owner = Who::owner(me, None);
    let action = call(
        pool,
        &who,
        opportunities::ADD_TOOL,
        json!({
            "title": "Тестовый местный конкурс", "kind": "contest",
            "starts_at": "2099-11-20T10:00:00+05:00", "ends_at": "2099-11-20T12:00:00+05:00",
            "place": "Челябинск", "why": "Рассказал владелец",
        }),
        None,
        None,
    )
    .await
    .unwrap()
    .action()
    .unwrap();
    let id = action.changes[0].object_id;
    assert_eq!(state(pool, id).await.0, "suggested");
    let (source, url): (String, String) =
        sqlx::query_as("SELECT source, url FROM opportunities WHERE id = $1")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!((source.as_str(), url.as_str()), ("manual", ""));
    let dismissed = opportunities::decide(pool, &owner, id, false)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(state(pool, id).await.0, "dismissed");
    assert!(
        opportunities::decide(pool, &owner, id, false)
            .await
            .unwrap()
            .is_none()
    );
    revert_action(pool, &owner, dismissed.id, false)
        .await
        .unwrap();
    assert_eq!(state(pool, id).await.0, "suggested");
    let RevertOutcome::Reverted { actions } = revert_action(pool, &owner, action.id, false)
        .await
        .unwrap()
    else {
        panic!("нужен откат");
    };
    let exists: bool =
        sqlx::query_scalar("SELECT EXISTS (SELECT 1 FROM opportunities WHERE id = $1)")
            .bind(id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(!exists);
    revert_action(pool, &owner, actions[0].id, false)
        .await
        .unwrap();
    assert_eq!(state(pool, id).await.0, "suggested");
    test_db.drop_db().await;
}

#[tokio::test]
async fn denied_tools_and_planner_failure_leave_no_partial_changes() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@example.org", &[]).await;
    let id = seed(pool, me, 20, false).await;
    let who = Who::agent(&Run {
        id: Uuid::now_v7(),
        account_id: me,
        trigger: Trigger::Manual,
    });
    for (tool, args) in [
        (
            opportunities::SUGGEST_TOOL,
            json!({"items": [{"id": id, "why": "интерес"}]}),
        ),
        (opportunities::ADD_TOOL, json!({})),
    ] {
        assert!(matches!(
            call(pool, &who, tool, args, None, None).await,
            Err(Error::Denied(_))
        ));
    }
    assert!(matches!(
        opportunities::decide(pool, &Who::owner(me, None), id, false).await,
        Err(Error::Denied(_))
    ));
    let agent_only = person(pool, "agent@example.org", &["agent"]).await;
    let event = seed(pool, agent_only, 20, true).await;
    assert!(matches!(
        opportunities::decide(pool, &Who::owner(agent_only, None), event, true).await,
        Err(Error::Denied(_))
    ));
    assert_eq!(state(pool, event).await.0, "new");
    assert_eq!(task_count(pool, agent_only).await, 0);
    test_db.drop_db().await;
}

#[tokio::test]
async fn conflicting_revert_keeps_status_and_tasks_together() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@example.org", &["agent", "planner"]).await;
    let id = seed(pool, me, 20, true).await;
    let owner = Who::owner(me, None);
    let action = opportunities::decide(pool, &owner, id, true)
        .await
        .unwrap()
        .unwrap();
    let task = action
        .changes
        .iter()
        .find(|change| change.object_type == "planner.task")
        .unwrap()
        .object_id;
    call(
        pool,
        &owner,
        "task.update",
        json!({"task_id": task, "title": "Исправлено человеком"}),
        None,
        None,
    )
    .await
    .unwrap();
    assert!(matches!(
        revert_batch(pool, &owner, action.batch_id, false)
            .await
            .unwrap(),
        RevertOutcome::Conflict { .. }
    ));
    assert_eq!(state(pool, id).await.0, "interested");
    assert_eq!(task_count(pool, me).await, 3);
    test_db.drop_db().await;
}
