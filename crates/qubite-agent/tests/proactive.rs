//! Агент пишет первым (AGT-004) на настоящей PostgreSQL: лимит, тишина,
//! «не сегодня», кнопки ответа, пробуждения в очереди и ход агента — на
//! поддельной модели (настоящих вызовов AI в тестах нет).
//!
//! Время по часам владельца передаётся в `wake` явно, а ночную тишину тесты,
//! которым она мешает, выключают — поэтому они не зависят от того, в какой
//! час их запустили.

use std::sync::Arc;

use qubite_agent::{
    Outcome, Trigger, Who, call,
    free::Reply,
    proactive::{self, PaceChange, Wake, WakeOutcome},
    revert_action, start_run,
};
use qubite_ai::{
    AiConfig, Gateway, MockProvider, MockStep,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Duration, PrimitiveDateTime};
use uuid::Uuid;

async fn owner(pool: &PgPool) -> Uuid {
    qubite_auth::owner::create(
        pool,
        &Passwords::default(),
        "owner@qubite.ru",
        "",
        "пароль владельца",
    )
    .await
    .unwrap()
    .id
}

async fn plain(pool: &PgPool, email: &str) -> Uuid {
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
    for module in ["planner", "inbox", "agent"] {
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

/// Ночная тишина выключена — тест не зависит от часа запуска.
async fn no_night(pool: &PgPool, account: Uuid) {
    let mut conn = pool.acquire().await.unwrap();
    qubite_notify::settings::save(
        &mut conn,
        account,
        &qubite_notify::settings::Change {
            quiet_from: Some("00:00".into()),
            quiet_to: Some("00:00".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

async fn local_now(pool: &PgPool) -> PrimitiveDateTime {
    sqlx::query_scalar(
        "SELECT (now() AT TIME ZONE coalesce( \
             (SELECT value #>> '{}' FROM platform_settings WHERE key = 'platform.timezone'), $1) \
         )::timestamp",
    )
    .bind(qubite_planner::DEFAULT_TIMEZONE)
    .fetch_one(pool)
    .await
    .unwrap()
}

async fn agent(pool: &PgPool, account: Uuid, trigger: Trigger) -> Who {
    Who::agent(&start_run(pool, account, trigger).await.unwrap())
}

async fn send(pool: &PgPool, who: &Who, args: Value) -> qubite_agent::Result<qubite_agent::Action> {
    call(pool, who, "notify.send", args, Some("свободное окно"), None)
        .await
        .map(|outcome| outcome.action().expect("действие"))
}

async fn create_task(pool: &PgPool, who: &Who, title: &str, fields: Value) -> Uuid {
    let Outcome::Done(action) = call(
        pool,
        who,
        "task.create",
        json!({"title": title, "fields": fields}),
        Some("тест"),
        None,
    )
    .await
    .unwrap() else {
        panic!("ожидали действие");
    };
    action.changes[0].object_id
}

/// Сообщение отодвинуть в прошлое — как будто писал давно.
async fn age_nudges(pool: &PgPool, account: Uuid) {
    sqlx::query(
        "UPDATE agent_nudges SET created_at = created_at - interval '2 hours' WHERE account_id = $1",
    )
    .bind(account)
    .execute(pool)
    .await
    .unwrap();
}

struct Ai {
    gateway: Gateway,
    mock: Arc<MockProvider>,
}

async fn ai(pool: &PgPool, owner: Uuid, steps: Vec<MockStep>) -> Ai {
    let console = qubite_policy::decide_owner(pool, &qubite_policy::Subject::account(owner, None))
        .await
        .unwrap();
    admin::upsert_provider(
        pool,
        &console,
        ProviderSpec {
            id: "mock",
            kind: "mock",
            base_url: "",
            enabled: true,
        },
    )
    .await
    .unwrap();
    admin::upsert_model(
        pool,
        &console,
        ModelSpec {
            id: "mock-agent",
            provider_id: "mock",
            external_id: "mock-model",
            price_in_per_mtok: 0,
            price_out_per_mtok: 1_000_000,
            context_tokens: 100_000,
            enabled: true,
        },
    )
    .await
    .unwrap();
    admin::set_task_model(pool, &console, "default", Some("mock-agent"))
        .await
        .unwrap();
    admin::set_limit(
        pool,
        &console,
        &LimitScope::User(owner),
        Period::Day,
        Metric::Usd,
        10_000_000,
    )
    .await
    .unwrap();
    let mock = Arc::new(
        MockProvider::new(MockStep::Reply {
            text: "{\"tools\": []}".into(),
            tokens_in: 10,
            tokens_out: 10,
        })
        .script(steps),
    );
    Ai {
        gateway: Gateway::new(pool.clone(), AiConfig::default())
            .with_provider("mock", mock.clone()),
        mock,
    }
}

fn reply(value: Value) -> MockStep {
    MockStep::Reply {
        text: value.to_string(),
        tokens_in: 100,
        tokens_out: 50,
    }
}

async fn notice(pool: &PgPool, id: Uuid) -> qubite_notify::Notice {
    let mut conn = pool.acquire().await.unwrap();
    qubite_notify::notice::get(&mut conn, id)
        .await
        .unwrap()
        .unwrap()
}

#[tokio::test]
async fn server_checks_limit_gap_off_and_not_today() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = plain(pool, "me@qubite.ru").await;
    no_night(pool, me).await;
    let who = agent(pool, me, Trigger::Window).await;
    let idea = create_task(pool, &who, "Разобраться с нейросетями", json!({})).await;

    // «Есть 30 минут?» — сообщение с кнопками в колокольчике, строка в ленте.
    let action = send(
        pool,
        &who,
        json!({"title": "Есть 30 минут?", "body": "Помнишь идею про нейросети?", "ask_minutes": 30, "task_id": idea}),
    )
    .await
    .unwrap();
    assert_eq!(
        action.summary,
        "Написал первым: «Есть 30 минут?» (спросил про 30 мин)"
    );
    let nudges = proactive::recent_nudges(pool, me).await.unwrap();
    assert_eq!(nudges.len(), 1);
    let first = notice(pool, nudges[0].0).await;
    assert_eq!(first.kind, qubite_notify::Kind::Agent);
    assert_eq!(first.object_id, Some(idea));
    let buttons: Vec<&str> = first.options.iter().map(|c| c.text.as_str()).collect();
    assert_eq!(buttons, ["Да", "15 минут", "Позже", "Не сегодня"]);
    assert_eq!(
        qubite_notify::deliver::telegram_buttons(&first)[3].data,
        format!("n:o:{}:not_today", first.id)
    );

    // Не чаще раза в час — это проверяет сервер, а не модель.
    let error = send(pool, &who, json!({"title": "Ещё?"}))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("раза в час"), "{error}");

    // Число в день: 1 — и уже исчерпано.
    let owner_who = Who::owner(me, None);
    proactive::save_pace(
        pool,
        &owner_who,
        &PaceChange {
            mode: Some("count".into()),
            per_day: Some(1),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    age_nudges(pool, me).await;
    let error = send(pool, &who, json!({"title": "Ещё?"}))
        .await
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("лимит на сегодня исчерпан: 1 из 1"),
        "{error}"
    );
    // Настройку меняет только человек.
    assert!(matches!(
        proactive::save_pace(pool, &who, &PaceChange::default()).await,
        Err(qubite_agent::Error::NeedsOwner(_))
    ));

    // «Не писать» — отказ.
    proactive::save_pace(
        pool,
        &owner_who,
        &PaceChange {
            mode: Some("off".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let error = send(pool, &who, json!({"title": "Ещё?"}))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("не писать первым"), "{error}");

    // «Сколько захочет» и «Не сегодня» кнопкой: до завтра молчит.
    proactive::save_pace(
        pool,
        &owner_who,
        &PaceChange {
            mode: Some("auto".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let outcome = proactive::answer(pool, me, first.id, "not_today")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(outcome.hint, "Хорошо, сегодня больше не пишу первым");
    assert!(
        proactive::answer(pool, me, first.id, "yes")
            .await
            .unwrap()
            .is_none(),
        "ответ — один раз"
    );
    let answered = notice(pool, first.id).await;
    assert_eq!(answered.answer.as_deref(), Some("not_today"));
    assert!(answered.read_at.is_some(), "ответ гасит сообщение");
    let error = send(pool, &who, json!({"title": "Ещё?"}))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("не сегодня"), "{error}");
    let status = proactive::status(pool, &owner_who).await.unwrap();
    assert!(status.not_today);
    assert_eq!(
        status.presence.quiet.as_deref(),
        Some("ты сказал «не сегодня»")
    );
    // «Не сегодня» снимается в настройке.
    proactive::save_pace(
        pool,
        &owner_who,
        &PaceChange {
            not_today: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // Чужую кнопку не нажать; кнопки, которой нет, — тоже.
    let stranger = plain(pool, "other@qubite.ru").await;
    assert!(matches!(
        proactive::answer(pool, stranger, first.id, "yes").await,
        Err(qubite_agent::Error::NotFound)
    ));

    // Откат сообщения в ленте гасит его в колокольчике.
    let second = send(pool, &who, json!({"title": "Глянешь идею про нейросети?"}))
        .await
        .unwrap();
    let nudges = proactive::recent_nudges(pool, me).await.unwrap();
    assert!(notice(pool, nudges[0].0).await.read_at.is_none());
    revert_action(pool, &owner_who, second.id, false)
        .await
        .unwrap();
    assert!(notice(pool, nudges[0].0).await.read_at.is_some());

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn quiet_at_night_and_on_lessons_without_calling_the_model() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(pool, me, Vec::new()).await;
    let wake = |trigger| Wake {
        account_id: me,
        trigger,
        nudge_id: None,
    };
    let today = local_now(pool).await.date();
    let at = |hour, minute| {
        PrimitiveDateTime::new(today, time::Time::from_hms(hour, minute, 0).unwrap())
    };

    // Ночь (по умолчанию 23:00–08:00).
    let outcome = proactive::wake(
        pool,
        &ai.gateway,
        &wake(Trigger::Window),
        None,
        Some(at(2, 0)),
    )
    .await
    .unwrap();
    assert_eq!(outcome, WakeOutcome::Skipped("тишина: ночь".into()));

    // Урок по расписанию: «Не беспокоить» = да по умолчанию.
    let who = agent(pool, me, Trigger::Manual).await;
    let day = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
        [usize::from(today.weekday().number_days_from_monday())];
    call(
        pool,
        &who,
        "files.create",
        json!({"path": "Расписание.md", "body": format!("| День | Начало | Конец | Что |\n|---|---|---|---|\n| {day} | 10:00 | 11:00 | Алгебра |\n")}),
        None,
        None,
    )
    .await
    .unwrap();
    let outcome = proactive::wake(
        pool,
        &ai.gateway,
        &wake(Trigger::Window),
        None,
        Some(at(10, 30)),
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        WakeOutcome::Skipped("тишина: «Алгебра» по расписанию".into())
    );

    // «Не писать» — окна пропускаются.
    proactive::save_pace(
        pool,
        &Who::owner(me, None),
        &PaceChange {
            mode: Some("off".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let outcome = proactive::wake(
        pool,
        &ai.gateway,
        &wake(Trigger::Due),
        None,
        Some(at(17, 0)),
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        WakeOutcome::Skipped("настройка «не писать первым»".into())
    );
    assert_eq!(ai.mock.calls(), 0, "модель не звали");

    // Человек без AI: агент тихо пропускает пробуждение.
    let other = plain(pool, "me@qubite.ru").await;
    no_night(pool, other).await;
    let outcome = proactive::wake(
        pool,
        &ai.gateway,
        &Wake {
            account_id: other,
            trigger: Trigger::Window,
            nudge_id: None,
        },
        None,
        Some(local_now(pool).await),
    )
    .await
    .unwrap();
    assert_eq!(outcome, WakeOutcome::Skipped("нет AI для агента".into()));
    assert_eq!(ai.mock.calls(), 0);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn window_question_then_yes_brings_a_concrete_suggestion() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    no_night(pool, me).await;
    let who = agent(pool, me, Trigger::Manual).await;
    let Outcome::Done(project) = call(
        pool,
        &who,
        "project.create",
        json!({"title": "Алгебра"}),
        None,
        None,
    )
    .await
    .unwrap() else {
        panic!()
    };
    let algebra = project.changes[0].object_id;
    let now = local_now(pool).await;
    let tomorrow = now.date() + Duration::days(1);
    let day = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
        [usize::from(tomorrow.weekday().number_days_from_monday())];
    call(
        pool,
        &who,
        "files.create",
        json!({"path": "Расписание.md", "body": format!("| День | Начало | Конец | Что |\n|---|---|---|---|\n| {day} | 08:30 | 09:15 | Алгебра |\n")}),
        None,
        None,
    )
    .await
    .unwrap();
    let homework = create_task(
        pool,
        &who,
        "ДЗ: № 214–216",
        json!({"project_id": algebra, "subtasks": [{"id": "a", "title": "№ 214"}, {"id": "b", "title": "№ 215"}]}),
    )
    .await;
    create_task(pool, &who, "Сделать свой сайт", json!({})).await;

    let ai = ai(
        pool,
        me,
        vec![
            // Окно: спросить «есть 30 минут?» про ДЗ.
            reply(json!({"tools": [{"tool": "notify.send", "args": {"title": "Есть 30 минут?", "body": "Завтра алгебра — начнём ДЗ?", "ask_minutes": 30, "task_id": homework}, "why": "завтра урок"}]})),
            // Ответ «да»: конкретное дело, первым шагом.
            reply(json!({"tools": [{"tool": "notify.send", "args": {"title": "ДЗ по алгебре: № 214", "body": "Начни с № 214 — минут на 15", "task_id": homework}, "why": "ты сказал «да»"}]})),
        ],
    )
    .await;

    // Утро ставит окна и завтрашнее утро в очередь (без модели — сводка не нужна).
    let planned = proactive::plan_ahead(pool, me).await.unwrap();
    assert!(planned >= 1);
    let morning: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM jobs WHERE kind = 'agent.wake' AND idempotency_key LIKE '%:morning'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(morning >= 1, "утро завтра — в очереди");
    assert_eq!(
        proactive::plan_ahead(pool, me).await.unwrap(),
        planned,
        "повтор ничего не дублирует"
    );

    // Окно: агент спрашивает.
    let outcome = proactive::wake(
        pool,
        &ai.gateway,
        &Wake {
            account_id: me,
            trigger: Trigger::Window,
            nudge_id: None,
        },
        None,
        Some(now),
    )
    .await
    .unwrap();
    assert_eq!(outcome, WakeOutcome::Done { actions: 1 });
    let call_data = ai.mock.last_call().unwrap().messages[1].content.clone();
    assert!(
        call_data.contains("source=\"situation\"") && call_data.contains("Повод: свободное окно")
    );
    let candidates = call_data.split("source=\"candidates\"").nth(1).unwrap();
    let first_line = candidates.lines().find(|l| l.starts_with("1.")).unwrap();
    assert!(
        first_line.contains("ДЗ: № 214–216")
            && first_line.contains("урок «Алгебра» завтра в 08:30"),
        "{first_line}"
    );
    assert!(first_line.contains("первый шаг: «№ 214»"));
    let asked = proactive::recent_nudges(pool, me).await.unwrap();
    assert_eq!(asked.len(), 1);

    // «Да» — в очереди пробуждение «ответ»; агент предлагает дело, это не в лимите.
    proactive::answer(pool, me, asked[0].0, Reply::Yes.as_str())
        .await
        .unwrap()
        .unwrap();
    let payload: Value = sqlx::query_scalar(
        "SELECT payload FROM jobs WHERE kind = 'agent.wake' AND idempotency_key LIKE '%:reply:%'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    let wake: Wake = serde_json::from_value(payload).unwrap();
    assert_eq!(wake.trigger, Trigger::Reply);
    let outcome = proactive::wake(pool, &ai.gateway, &wake, None, None)
        .await
        .unwrap();
    assert_eq!(outcome, WakeOutcome::Done { actions: 1 });
    let data = ai.mock.last_call().unwrap().messages[1].content.clone();
    assert!(data.contains("Ответ: «Да» — есть 30 мин."), "{data}");
    let nudges = proactive::recent_nudges(pool, me).await.unwrap();
    assert_eq!(nudges.len(), 2);
    assert!(!nudges[0].2, "ответ на «да» — не в лимите");
    let suggestion = notice(pool, nudges[0].0).await;
    assert_eq!(suggestion.title, "ДЗ по алгебре: № 214");
    assert!(suggestion.options.is_empty());

    // В лимите — только вопрос в окне.
    let status = proactive::status(pool, &Who::owner(me, None))
        .await
        .unwrap();
    assert_eq!(status.sent, 1);
    assert_eq!(
        status.limit, 3,
        "сколько захочет: старт — 3, одно «да» ещё мало"
    );

    // Окно сразу после — пропуск без модели: писал меньше часа назад.
    let calls = ai.mock.calls();
    let outcome = proactive::wake(
        pool,
        &ai.gateway,
        &Wake {
            account_id: me,
            trigger: Trigger::Window,
            nudge_id: None,
        },
        None,
        Some(now),
    )
    .await
    .unwrap();
    assert_eq!(
        outcome,
        WakeOutcome::Skipped("писал меньше часа назад".into())
    );
    assert_eq!(ai.mock.calls(), calls);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn tools_show_free_windows_and_presence() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    no_night(pool, me).await;
    let who = agent(pool, me, Trigger::Manual).await;
    let Outcome::Read(windows) = call(
        pool,
        &who,
        "time.free_windows",
        json!({"days": 2}),
        None,
        None,
    )
    .await
    .unwrap() else {
        panic!()
    };
    assert_eq!(windows.as_array().unwrap().len(), 2);
    assert_eq!(
        windows[1]["free"][0]["from"], "00:00",
        "завтра без ночи и дел — весь день"
    );
    let Outcome::Read(presence) = call(pool, &who, "presence.now", json!({}), None, None)
        .await
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(presence["in_qubite"], false);
    {
        let mut conn = pool.acquire().await.unwrap();
        qubite_notify::settings::presence(&mut conn, me, true)
            .await
            .unwrap();
    }
    let Outcome::Read(presence) = call(pool, &who, "presence.now", json!({}), None, None)
        .await
        .unwrap()
    else {
        panic!()
    };
    assert_eq!(presence["in_qubite"], true);
    assert!(presence["quiet"].is_null());

    // Пробуждения заводятся при старте сервера всем, у кого есть агент.
    assert_eq!(proactive::bootstrap(pool).await.unwrap(), 1);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn morning_suggests_from_context_with_mock_and_skips_without_ai_or_budget() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let no_ai = plain(pool, "no-ai@example.org").await;
    let event = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO opportunities (id, account_id, source, external_id, kind, title, subject, \
         grades, starts_at, ends_at, url) VALUES ($1, $2, 'manual', $3, 'contest', \
         'Тестовое соревнование', 'программирование', '10–11', now() + interval '20 days', \
         now() + interval '21 days', '')",
    )
    .bind(event)
    .bind(me)
    .bind(event.to_string())
    .execute(pool)
    .await
    .unwrap();
    // Дальние, прошедшие, скрытые и чужие не должны вытеснить ближайшее.
    for index in 0..21_i32 {
        let id = Uuid::now_v7();
        let (account, days, status) = match index {
            18 => (me, -3, "new"),
            19 => (me, 1, "dismissed"),
            20 => (no_ai, 1, "new"),
            _ => (me, 30 + index, "new"),
        };
        sqlx::query(
            "INSERT INTO opportunities (id, account_id, source, external_id, kind, title, \
             starts_at, ends_at, status, url) VALUES ($1, $2, 'manual', $3, 'contest', \
             'Другой тестовый конкурс', now() + make_interval(days => $4), \
             now() + make_interval(days => $4) + interval '1 hour', $5, '')",
        )
        .bind(id)
        .bind(account)
        .bind(id.to_string())
        .bind(days)
        .bind(status)
        .execute(pool)
        .await
        .unwrap();
    }
    let ai = ai(
        pool,
        me,
        vec![reply(json!({"tools": [{
            "tool": "opportunity.suggest", "args": {"items": [{"id": event, "why": "Любишь программирование"}]},
            "why": "По интересам из «О тебе»",
        }]}))],
    )
    .await;
    let now = local_now(pool).await;
    let wake = |account_id| Wake {
        account_id,
        trigger: Trigger::Morning,
        nudge_id: None,
    };
    assert!(matches!(
        proactive::wake(pool, &ai.gateway, &wake(no_ai), None, Some(now))
            .await
            .unwrap(),
        WakeOutcome::Skipped(_)
    ));
    assert_eq!(ai.mock.calls(), 0, "без AI модель не вызывается");
    let console = qubite_policy::decide_owner(pool, &qubite_policy::Subject::account(me, None))
        .await
        .unwrap();
    admin::set_limit(
        pool,
        &console,
        &LimitScope::User(me),
        Period::Day,
        Metric::Usd,
        0,
    )
    .await
    .unwrap();
    assert!(matches!(
        proactive::wake(pool, &ai.gateway, &wake(me), None, Some(now))
            .await
            .unwrap(),
        WakeOutcome::Skipped(_)
    ));
    assert_eq!(ai.mock.calls(), 0, "без бюджета модель не вызывается");
    let status: String = sqlx::query_scalar("SELECT status FROM opportunities WHERE id = $1")
        .bind(event)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(status, "new");
    admin::set_limit(
        pool,
        &console,
        &LimitScope::User(me),
        Period::Day,
        Metric::Usd,
        10_000_000,
    )
    .await
    .unwrap();
    assert_eq!(
        proactive::wake(pool, &ai.gateway, &wake(me), None, Some(now))
            .await
            .unwrap(),
        WakeOutcome::Done { actions: 1 }
    );
    let data = ai.mock.last_call().unwrap().messages[1].content.clone();
    let block = data.split("source=\"opportunities\"").nth(1).unwrap();
    let rows: Vec<Value> =
        serde_json::from_str(block.lines().find(|line| line.starts_with('[')).unwrap()).unwrap();
    assert_eq!(rows.len(), 15);
    assert_eq!(rows[0]["id"], event.to_string());
    assert_eq!(rows[0]["title"], "Тестовое соревнование");
    assert_eq!(rows[0]["subject"], "программирование");
    assert_eq!(rows[0]["grades"], "10–11");
    assert!(
        rows.iter()
            .skip(1)
            .all(|row| row["title"] == "Другой тестовый конкурс")
    );
    let state: (String, String) =
        sqlx::query_as("SELECT status, why FROM opportunities WHERE id = $1")
            .bind(event)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        state,
        ("suggested".into(), "Любишь программирование".into())
    );
    db.close().await;
    test_db.drop_db().await;
}
