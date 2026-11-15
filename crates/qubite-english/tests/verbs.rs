//! Неправильные глаголы на настоящей PostgreSQL (ENG-008): ответ двигает срок
//! повторения, ошибка в любой игре — «не знал», сервер сам сверяет вписанное и
//! сказанное, чужого прогресса не видно, трудные глаголы приходят в ежедневное
//! повторение и Нейту в разговор. Модель — поддельная (`MockProvider`).

use std::sync::Arc;

use qubite_ai::{
    AiConfig, Gateway, MockProvider, MockStep,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_english::{
    Error, Said, Settings,
    course::course,
    lessons::{self, FeedbackKind, Given},
    verbs::{self, Answer, Forms, Grade},
};
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use sqlx::PgPool;
use time::{Date, Duration};
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

/// Человек с доступом к агенту (значит, и к «Английскому»).
async fn pupil(pool: &PgPool) -> Uuid {
    let id = qubite_auth::accounts::create(
        pool,
        &Passwords::default(),
        NewAccount {
            email: "pupil@qubite.ru",
            display_name: "",
            password: "пароль для теста",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap()
    .id;
    sqlx::query(
        "INSERT INTO module_grants (id, account_id, module_id, can_read, can_write) \
         VALUES ($1, $2, 'agent', true, true)",
    )
    .bind(Uuid::now_v7())
    .bind(id)
    .execute(pool)
    .await
    .unwrap();
    id
}

fn typed(verb: &str, v2: &str, v3: &str) -> Answer {
    Answer {
        verb_id: verb.into(),
        mode: "type".into(),
        given: Some(Forms {
            v1: None,
            v2: v2.into(),
            v3: v3.into(),
        }),
        ..Answer::default()
    }
}

fn played(verb: &str, mode: &str, correct: bool) -> Answer {
    Answer {
        verb_id: verb.into(),
        mode: mode.into(),
        correct: Some(correct),
        ..Answer::default()
    }
}

async fn due_on(pool: &PgPool, account: Uuid, verb: &str) -> Date {
    sqlx::query_scalar(
        "SELECT due_on FROM english_verb_progress WHERE account_id = $1 AND verb_id = $2",
    )
    .bind(account)
    .bind(verb)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// Сдвинуть прошлое глагола на `days` дней назад — как будто дни прошли.
async fn age(pool: &PgPool, account: Uuid, verb: &str, days: i32) {
    sqlx::query(
        "UPDATE english_verb_progress SET due_on = due_on - $3, last_wrong_on = last_wrong_on - $3 \
         WHERE account_id = $1 AND verb_id = $2",
    )
    .bind(account)
    .bind(verb)
    .bind(days)
    .execute(pool)
    .await
    .unwrap();
}

#[tokio::test]
async fn answers_move_the_schedule_and_any_mistake_is_again() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;

    let start = verbs::overview(pool, me).await.unwrap();
    assert_eq!(start.counts.total, start.verbs.len());
    assert!(start.counts.total >= 140);
    assert_eq!(
        (
            start.counts.started,
            start.counts.due,
            start.counts.hard,
            start.counts.learned
        ),
        (0, 0, 0, 0)
    );
    assert!(start.verbs.iter().all(|v| v.progress.new && v.progress.due));
    let today = start.today;

    // Вписал верно (регистр и запасная форма не мешают) — завтра, опыт как за письмо.
    let first = verbs::answer(pool, me, typed("get", " Got ", "GOTTEN"))
        .await
        .unwrap();
    assert!(first.correct && first.moved);
    assert_eq!(
        (
            first.expected.v1.as_str(),
            first.expected.v2.as_str(),
            first.expected.v3.as_str()
        ),
        ("get", "got", "got")
    );
    assert_eq!(first.progress.interval_days, 1);
    assert_eq!(due_on(pool, me, "get").await, today + Duration::days(1));
    assert_eq!(first.game.xp, 2);
    assert!(!first.progress.due && !first.progress.hard);

    // Тот же глагол ещё раз в игре сегодня — рано: срок не двигается, опыта нет.
    let early = verbs::answer(pool, me, played("get", "match", true))
        .await
        .unwrap();
    assert!(early.correct && !early.moved);
    assert_eq!(early.game.xp, 0);
    assert_eq!(due_on(pool, me, "get").await, today + Duration::days(1));

    // Ошибка в любой игре — «не знал»: сегодня же, трудный, даже если было рано.
    for mode in ["match", "quiz", "anagram", "search", "sprint"] {
        let wrong = verbs::answer(pool, me, played("get", mode, false))
            .await
            .unwrap();
        assert!(!wrong.correct && wrong.moved, "{mode}");
        assert!(wrong.progress.due && wrong.progress.hard, "{mode}");
        assert_eq!(wrong.progress.interval_days, 0, "{mode}");
    }
    assert_eq!(due_on(pool, me, "get").await, today);
    let lapses: i32 = sqlx::query_scalar(
        "SELECT lapses FROM english_verb_progress WHERE account_id = $1 AND verb_id = 'get'",
    )
    .bind(me)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(lapses, 5);

    // Вписал неверно — тоже ошибка, сервер показывает правильные формы.
    let typo = verbs::answer(pool, me, typed("sing", "singed", "sung"))
        .await
        .unwrap();
    assert!(!typo.correct);
    assert_eq!(typo.expected.v2, "sang");
    // Спросили по переводу — первая форма тоже сверяется.
    let by_ru = verbs::answer(
        pool,
        me,
        Answer {
            verb_id: "swim".into(),
            mode: "type".into(),
            given: Some(Forms {
                v1: Some("swimm".into()),
                v2: "swam".into(),
                v3: "swum".into(),
            }),
            ..Answer::default()
        },
    )
    .await
    .unwrap();
    assert!(!by_ru.correct);

    // Сказал вслух: формы по порядку, одинаково звучащие слова годятся.
    let said = verbs::answer(
        pool,
        me,
        Answer {
            verb_id: "eat".into(),
            mode: "speak".into(),
            said: Some("eat, eight, eaten".into()),
            ..Answer::default()
        },
    )
    .await
    .unwrap();
    assert!(said.correct && said.moved);

    // Карточки: «легко» — сразу на четыре дня.
    let easy = verbs::answer(
        pool,
        me,
        Answer {
            verb_id: "go".into(),
            mode: "cards".into(),
            grade: Some(Grade::Easy),
            ..Answer::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(easy.progress.interval_days, 4);

    let now = verbs::overview(pool, me).await.unwrap();
    assert_eq!(now.counts.started, 5);
    assert_eq!(now.counts.hard, 3, "get, sing, swim");
    assert_eq!(now.counts.due, 3);
    let get = now.verbs.iter().find(|v| v.verb.id == "get").unwrap();
    assert!(get.progress.hard && get.progress.due && !get.progress.new);

    // Через четыре дня без ошибок sing уже не трудный, get — ещё да (ошибок много).
    for verb in ["get", "sing"] {
        age(pool, me, verb, 4).await;
    }
    let later = verbs::overview(pool, me).await.unwrap();
    let state = |id: &str| {
        later
            .verbs
            .iter()
            .find(|v| v.verb.id == id)
            .unwrap()
            .progress
            .hard
    };
    assert!(state("get") && !state("sing"));

    // Неверные запросы.
    for bad in [
        played("goed", "quiz", true),
        played("go", "tetris", true),
        Answer {
            verb_id: "go".into(),
            mode: "type".into(),
            ..Answer::default()
        },
        Answer {
            correct: Some(true),
            ..typed("go", "went", "gone")
        },
        typed("go", &"w".repeat(61), "gone"),
        Answer {
            verb_id: "go".into(),
            mode: "speak".into(),
            said: Some("   ".into()),
            ..Answer::default()
        },
    ] {
        let error = verbs::answer(pool, me, bad.clone()).await.unwrap_err();
        assert!(matches!(error, Error::Invalid(_)), "{bad:?}: {error}");
    }

    test_db.drop_db().await;
}

#[tokio::test]
async fn progress_is_private_and_needs_the_module() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let other = pupil(pool).await;

    verbs::answer(pool, me, played("go", "quiz", false))
        .await
        .unwrap();

    // У другого человека свой прогресс: мою ошибку он не видит и не меняет.
    let theirs = verbs::overview(pool, other).await.unwrap();
    assert_eq!((theirs.counts.started, theirs.counts.hard), (0, 0));
    verbs::answer(pool, other, typed("go", "went", "gone"))
        .await
        .unwrap();
    let mine = verbs::overview(pool, me).await.unwrap();
    let go = mine.verbs.iter().find(|v| v.verb.id == "go").unwrap();
    assert!(go.progress.hard && go.progress.due);
    assert_eq!(mine.counts.started, 1);

    // Без права на модуль — ни читать, ни отвечать.
    let stranger = Uuid::now_v7();
    assert!(matches!(
        verbs::overview(pool, stranger).await.unwrap_err(),
        Error::Denied(_)
    ));
    assert!(matches!(
        verbs::answer(pool, stranger, played("go", "quiz", true))
            .await
            .unwrap_err(),
        Error::Denied(_)
    ));

    test_db.drop_db().await;
}

/// Десять заданий из программы — как будто в них ошибались.
async fn old_mistakes(pool: &PgPool, account: Uuid, today: Date) {
    let course = course();
    let mut added = 0;
    'lessons: for entry in &course.entries {
        let Some(lesson) = course.base_lesson(&entry.id) else {
            continue;
        };
        for task in lesson["tasks"].as_array().into_iter().flatten() {
            sqlx::query(
                "INSERT INTO english_review (account_id, lesson_id, task_id, box, due_on) \
                 VALUES ($1, $2, $3, 0, $4)",
            )
            .bind(account)
            .bind(&entry.id)
            .bind(task["id"].as_str().unwrap())
            .bind(today)
            .execute(pool)
            .await
            .unwrap();
            added += 1;
            if added == 10 {
                break 'lessons;
            }
        }
    }
    assert_eq!(added, 10);
}

#[tokio::test]
async fn hard_verbs_come_to_daily_review() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let gateway = Gateway::new(pool.clone(), AiConfig::default());

    // Ошибок нет — повторять нечего.
    assert_eq!(lessons::home(pool, me).await.unwrap().review_due, 0);

    // Ошибся в четырёх глаголах — в повторение идут три, последние ошибки первыми.
    for verb in ["go", "sing", "buy", "be"] {
        verbs::answer(pool, me, played(verb, "quiz", false))
            .await
            .unwrap();
    }
    assert_eq!(lessons::home(pool, me).await.unwrap().review_due, 3);
    let run = lessons::start(pool, me, "review", "review").await.unwrap();
    assert_eq!(run.tasks.len(), 3);
    let ids: Vec<&str> = run
        .tasks
        .iter()
        .map(|t| {
            assert_eq!(t["lesson_id"], verbs::REVIEW_LESSON);
            assert_eq!(t["task"]["type"], "fill");
            t["task"]["id"].as_str().unwrap()
        })
        .collect();
    let task = run
        .tasks
        .iter()
        .find(|t| t["task"]["id"] == "be")
        .expect("be в повторении");
    assert_eq!(task["task"]["text"], "be – ___ – ___");
    assert!(task["task"]["ask_ru"].as_str().unwrap().contains("быть"));

    // Вписал неверно — глагол остаётся трудным, в старые ошибки уроков не пишется.
    let today = verbs::overview(pool, me).await.unwrap().today;
    let wrong = lessons::answer(
        pool,
        &gateway,
        me,
        run.id,
        Some(verbs::REVIEW_LESSON),
        "be",
        Uuid::now_v7(),
        Given::Value(json!(["was", "be"])),
    )
    .await
    .unwrap();
    assert!(!wrong.correct);
    assert_eq!(wrong.right.as_deref(), Some("be – was/were – been"));
    assert_eq!(due_on(pool, me, "be").await, today);

    // Вписал верно (подходит и одна из двух форм) — глагол уходит на завтра.
    let right = lessons::answer(
        pool,
        &gateway,
        me,
        run.id,
        Some(verbs::REVIEW_LESSON),
        "be",
        Uuid::now_v7(),
        Given::Value(json!(["Were", "been"])),
    )
    .await
    .unwrap();
    assert!(right.correct);
    assert_eq!(due_on(pool, me, "be").await, today + Duration::days(1));
    let in_review: i64 =
        sqlx::query_scalar("SELECT count(*) FROM english_review WHERE account_id = $1")
            .bind(me)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(in_review, 0, "глаголы ведутся в своей таблице");
    let fixed: i64 = sqlx::query_scalar(
        "SELECT (counters->>'fixed')::bigint FROM english_learners WHERE account_id = $1",
    )
    .bind(me)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(
        fixed, 1,
        "исправленный глагол — в задание дня «исправь ошибки»"
    );

    // Отметки «легко / трудно» у глаголов нет; чужого глагола в повторении нет.
    let mark = lessons::feedback(
        pool,
        me,
        run.id,
        Some(verbs::REVIEW_LESSON),
        "be",
        FeedbackKind::Hard,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(mark, Error::Invalid(_)), "{mark}");
    let missing = lessons::answer(
        pool,
        &gateway,
        me,
        run.id,
        Some(verbs::REVIEW_LESSON),
        "goed",
        Uuid::now_v7(),
        Given::Value(json!(["a", "b"])),
    )
    .await
    .unwrap_err();
    assert!(matches!(missing, Error::NotFound), "{missing}");

    // Повторение закончено — остались два трудных глагола из первых трёх и четвёртый.
    lessons::finish(pool, &gateway, me, run.id).await.unwrap();
    let again = lessons::start(pool, me, "review", "review").await.unwrap();
    assert_eq!(again.tasks.len(), 3);
    assert!(again.tasks.iter().all(|t| t["task"]["id"] != "be"));
    assert!(
        ids.iter()
            .filter(|id| **id != "be")
            .all(|id| { again.tasks.iter().any(|t| t["task"]["id"] == *id) })
    );

    // Вместе со старыми ошибками уроков потолок прежний: десять заданий, глаголы первые.
    old_mistakes(pool, me, today).await;
    let full = lessons::start(pool, me, "review", "review").await.unwrap();
    assert_eq!(full.tasks.len(), 10);
    let verb_tasks = full
        .tasks
        .iter()
        .take_while(|t| t["lesson_id"] == verbs::REVIEW_LESSON)
        .count();
    assert_eq!(verb_tasks, 3);
    assert_eq!(lessons::home(pool, me).await.unwrap().review_due, 13);

    test_db.drop_db().await;
}

struct Ai {
    gateway: Gateway,
    model: Arc<MockProvider>,
}

async fn ai(pool: &PgPool, owner: Uuid) -> Ai {
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
            id: "mock-tutor",
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
    admin::set_task_model(pool, &console, "default", Some("mock-tutor"))
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
    let reply: Value = json!({"say": "Go on.", "verdict": "none"});
    let model = Arc::new(MockProvider::new(MockStep::Reply {
        text: reply.to_string(),
        tokens_in: 300,
        tokens_out: 80,
    }));
    Ai {
        gateway: Gateway::new(pool.clone(), AiConfig::default())
            .with_provider("mock", model.clone()),
        model,
    }
}

async fn tutor_data(pool: &PgPool, ai: &Ai, account: Uuid) -> String {
    qubite_english::turn(
        pool,
        &ai.gateway,
        &Settings::default(),
        account,
        Uuid::now_v7(),
        Said::Text("Yesterday I go to school".into()),
    )
    .await
    .unwrap();
    ai.model.last_call().unwrap().messages[1..]
        .iter()
        .map(|m| m.content.clone())
        .collect()
}

#[tokio::test]
async fn nate_knows_weak_verbs_only_when_there_are_some() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(pool, me).await;
    qubite_english::start(pool, me).await.unwrap();

    // Слабых глаголов нет — блока в данных нет.
    let clean = tutor_data(pool, &ai, me).await;
    assert!(!clean.contains("source=\"verbs\""), "{clean}");
    assert!(!clean.contains("слабые неправильные глаголы"));

    // Верный ответ слабым глагол не делает.
    verbs::answer(pool, me, typed("buy", "bought", "bought"))
        .await
        .unwrap();
    assert!(!tutor_data(pool, &ai, me).await.contains("source=\"verbs\""));

    // Ошибся в семи — Нейту идут пять, данными, а не инструкцией.
    for verb in ["go", "sing", "be", "get", "cut", "break", "know"] {
        verbs::answer(pool, me, played(verb, "sprint", false))
            .await
            .unwrap();
    }
    let data = tutor_data(pool, &ai, me).await;
    assert!(data.contains("source=\"verbs\""), "{data}");
    assert!(data.contains("слабые неправильные глаголы: "));
    let listed = ["go", "sing", "be", "get", "cut", "break", "know"]
        .iter()
        .filter(|id| data.contains(&verbs::set().verb(id).unwrap().line()))
        .count();
    assert_eq!(listed, 5);
    let system = &ai.model.last_call().unwrap().messages[0].content;
    assert!(system.contains("Блок verbs"));
    assert!(!system.contains("went"), "глаголы — только в данных");

    test_db.drop_db().await;
}
