//! Уроки английского на настоящей PostgreSQL (ENG-002): входной тест → урок
//! (теория, задания, голосовой ответ на подделке) → огонёк и опыт, ошибки в
//! повторение, домашка — дело в Planner от агента, разбор ошибок и правка
//! программы в личный слой с откатом через ленту. Модель и ElevenLabs —
//! поддельные (`MockProvider`, `MockVoice`), платных запросов нет.

use std::sync::Arc;

use qubite_ai::{
    AiConfig, Gateway, MockHeard, MockProvider, MockStep, MockVoice,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
    catalog, elevenlabs,
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_english::{
    Error, Settings,
    lessons::{self, Given, LearnerChange},
};
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use sqlx::PgPool;
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

struct Ai {
    gateway: Gateway,
    model: Arc<MockProvider>,
}

async fn ai(pool: &PgPool, owner: Uuid, steps: Vec<MockStep>, heard: Vec<MockHeard>) -> Ai {
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
    catalog::ensure_provider(
        pool,
        elevenlabs::PROVIDER_ID,
        "elevenlabs",
        elevenlabs::DEFAULT_BASE_URL,
        true,
    )
    .await
    .unwrap();
    let model =
        Arc::new(MockProvider::new(reply(json!({"ok": true, "say": "Fine."}))).script(steps));
    let voice = Arc::new(MockVoice::new().script(heard));
    Ai {
        gateway: Gateway::new(pool.clone(), AiConfig::default())
            .with_provider("mock", model.clone())
            .with_voice(elevenlabs::PROVIDER_ID, voice),
        model,
    }
}

fn reply(value: Value) -> MockStep {
    MockStep::Reply {
        text: value.to_string(),
        tokens_in: 300,
        tokens_out: 80,
    }
}

fn spoken(text: &str) -> MockHeard {
    MockHeard::Text {
        text: text.into(),
        seconds: 2.0,
    }
}

fn voice() -> Given {
    Given::Voice {
        audio: b"OPUS-FAKE".to_vec(),
        mime: "audio/webm;codecs=opus".into(),
        duration_ms: 2_000,
    }
}

fn text(s: &str) -> Given {
    Given::Value(json!(s))
}

#[tokio::test]
async fn first_lesson_from_placement_to_streak_homework_and_program() {
    let (_test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(
        pool,
        me,
        vec![
            // t8 — свой ответ голосом: сверка моделью.
            reply(json!({"ok": true, "say": "Full sentence. Finally.", "mistakes": [], "right": ""})),
            // t9 — картинка: тоже модель.
            reply(json!({"ok": true, "say": "Acceptable.", "mistakes": []})),
            // t10 — роль.
            reply(json!({"ok": true, "say": "Bye, then."})),
            // Разбор ошибок после урока и правка программы.
            reply(json!({
                "summary_ru": "Путаешь am и is. Повтори: I am, he is.",
                "ops": [
                    {"op": "note", "lesson": "a0-m1-l2", "note_ru": "давить на am / is", "reason_ru": "ошибся в t5"},
                    {"op": "skip", "lesson": "b2-m1-l1", "reason_ru": "чужой урок — не пройдёт"}
                ]
            })),
        ],
        vec![spoken("nice to meet you"), spoken("Hello I'm Kirill nice to meet you")],
    )
    .await;

    // Входной тест: ничего не знает — с первого урока A0.
    let placed = lessons::place(pool, me, &json!({}), 0).await.unwrap();
    assert_eq!(placed.level, "a0");
    assert_eq!(placed.start_lesson, "a0-m1-l1");
    let home = lessons::home(pool, me).await.unwrap();
    assert_eq!(home.next.as_deref(), Some("a0-m1-l1"));
    assert_eq!(home.game.streak, 0);
    assert_eq!(home.game.rank, "Кварк");
    assert!(
        home.game
            .particles
            .iter()
            .any(|p| p["id"] == "spark" && p["open"] == true),
        "Искра — сразу"
    );

    // Урок: теория — из программы, на языке уровня.
    let view = lessons::lesson(pool, me, "a0-m1-l1").await.unwrap();
    assert!(
        view.lesson["grammar"]["explain_ru"]
            .as_str()
            .unwrap()
            .contains("I'm")
    );
    assert_eq!(view.level.tutor_mode, "ru_heavy");
    let run = lessons::start(pool, me, "a0-m1-l1", "lesson")
        .await
        .unwrap();
    let again = lessons::start(pool, me, "a0-m1-l1", "lesson")
        .await
        .unwrap();
    assert_eq!(run.id, again.id, "второй «Начать» — то же прохождение");

    let gateway = &ai.gateway;
    let go = |task: &'static str, given: Given| async move {
        lessons::answer(pool, gateway, me, run.id, None, task, Uuid::now_v7(), given)
            .await
            .unwrap()
    };
    let pairs = json!([
        ["hello", "привет"],
        ["bye", "пока"],
        ["name", "имя"],
        ["my", "мой"],
        ["your", "твой"]
    ]);
    let t1 = go("t1", Given::Value(pairs)).await;
    assert!(t1.correct);
    assert_eq!(t1.game.xp, 1);
    assert!(go("t2", text("Nate")).await.correct);
    assert!(go("t3", text("I'm Kirill.")).await.correct);
    assert!(go("t4", text("What's your name?")).await.correct);
    // Ошибка → правильный ответ и объяснение; вторая — по-русски подробно.
    let wrong = go("t5", Given::Value(json!(["am"]))).await;
    assert!(!wrong.correct);
    assert_eq!(wrong.right.as_deref(), Some("is"));
    let wrong2 = go("t5", Given::Value(json!(["I"]))).await;
    assert!(
        wrong2.explain_ru.unwrap().contains("По-русски"),
        "со второго раза — по-русски"
    );
    let late = go("t5", Given::Value(json!(["is"]))).await;
    assert!(late.correct);
    assert_eq!(late.game.xp, 0, "с третьей попытки опыта нет");
    assert!(go("t6", text("Hi! Nice to meet you.")).await.correct);
    // Голос: распознали и сверили с образцом без модели.
    let t7 = go("t7", voice()).await;
    assert!(t7.correct);
    assert_eq!(t7.heard.as_deref(), Some("nice to meet you"));
    let t8 = go("t8", voice()).await;
    assert!(t8.correct);
    assert_eq!(t8.say.as_deref(), Some("Full sentence. Finally."));
    assert!(
        go("t9", text("Hello! My name is Tom. Hi Tom, I'm Lisa."))
            .await
            .correct
    );
    assert!(
        go("t10", text("Hi! I'm Kirill. What's your name? Bye!"))
            .await
            .correct
    );
    // Модель получила задание и ответ отдельными блоками данных.
    let call = ai.model.last_call().unwrap();
    let data: String = call.messages[1..]
        .iter()
        .map(|m| m.content.clone())
        .collect();
    assert!(data.contains("source=\"learner\""), "{data}");

    let done = lessons::finish(pool, &ai.gateway, me, run.id)
        .await
        .unwrap();
    assert!(done.passed, "{done:?}");
    assert!(done.accuracy >= 0.99);
    assert_eq!(done.game.streak, 1, "урок пройден — огонёк");
    assert!(done.game.streak_up);
    assert!(done.game.xp >= 20);
    assert_eq!(
        done.review_ru.as_deref(),
        Some("Путаешь am и is. Повтори: I am, he is.")
    );
    assert_eq!(done.program_actions.len(), 1, "чужой урок отброшен");
    let homework = done.homework_task.expect("домашка — дело в Planner");

    // Дело домашки поставил агент, со сроком.
    let (title, due): (String, Option<time::Date>) = sqlx::query_as(
        "SELECT o.title, t.due_date FROM objects o JOIN planner_tasks t ON t.object_id = o.id WHERE o.id = $1",
    )
    .bind(homework)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(title.starts_with("Английский: домашка"), "{title}");
    assert!(due.is_some());

    // Ошибка — в повторении; итог — на главном экране.
    let home = lessons::home(pool, me).await.unwrap();
    assert_eq!(home.next.as_deref(), Some("a0-m1-l2"));
    assert!(
        home.steps
            .iter()
            .any(|s| s.step.entry.id == "a0-m1-l1" && s.passed)
    );
    assert!(
        home.game
            .badges
            .iter()
            .any(|b| b["id"] == "first_lesson" && b["open"] == true)
    );
    let note = home
        .steps
        .iter()
        .find(|s| s.step.entry.id == "a0-m1-l2")
        .unwrap();
    assert_eq!(note.step.notes, vec!["давить на am / is".to_owned()]);
    let review: i64 =
        sqlx::query_scalar("SELECT count(*) FROM english_review WHERE account_id = $1")
            .bind(me)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(review, 1);

    // Правку программы откатили в ленте — заметки больше нет.
    let action = done.program_actions[0];
    qubite_agent::revert_action(pool, &qubite_agent::Who::owner(me, None), action, false)
        .await
        .unwrap();
    let home = lessons::home(pool, me).await.unwrap();
    let step = home
        .steps
        .iter()
        .find(|s| s.step.entry.id == "a0-m1-l2")
        .unwrap();
    assert!(step.step.notes.is_empty(), "откат убрал правку");
    assert!(home.ops.is_empty());

    // Домашка сдана → дело сделано.
    let hw = lessons::start(pool, me, "a0-m1-l1", "homework")
        .await
        .unwrap();
    lessons::answer(
        pool,
        &ai.gateway,
        me,
        hw.id,
        None,
        "h2",
        Uuid::now_v7(),
        text("What's your name? My name is Max."),
    )
    .await
    .unwrap();
    let hw_done = lessons::finish(pool, &ai.gateway, me, hw.id).await.unwrap();
    assert!(hw_done.passed);
    let status: String =
        sqlx::query_scalar("SELECT status FROM planner_tasks WHERE object_id = $1")
            .bind(homework)
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(status, "done");
}

#[tokio::test]
async fn settings_voice_sample_and_no_ai_fallback() {
    let (_test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(pool, me, vec![], vec![]).await;
    let s = lessons::change_settings(
        pool,
        me,
        LearnerChange {
            goal_minutes: Some(15),
            strictness: Some(3),
            voice: Some("onwK4e9ZLuTAKqWW03F9".into()),
            remind_at: Some("19:30".into()),
            rest_weekday: Some(7),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(s.goal_minutes, 15);
    assert_eq!(s.strictness, 3);
    assert_eq!(s.remind_at, "19:30");
    assert_eq!(s.rest_weekday, Some(7));
    let bad = lessons::change_settings(
        pool,
        me,
        LearnerChange {
            goal_minutes: Some(7),
            ..Default::default()
        },
    )
    .await;
    assert!(matches!(bad, Err(Error::Invalid(_))));
    let locked = lessons::change_settings(
        pool,
        me,
        LearnerChange {
            companion: Some("echo".into()),
            ..Default::default()
        },
    )
    .await;
    assert!(
        matches!(locked, Err(Error::Invalid(_))),
        "Эхо ещё не открыта"
    );

    // Образец голоса: один раз через шлюз, потом из базы.
    let settings = Settings::default();
    let first = qubite_english::remind::phrase(
        pool,
        &ai.gateway,
        &settings,
        me,
        lessons::SAMPLE,
        Some("onwK4e9ZLuTAKqWW03F9"),
    )
    .await
    .unwrap();
    assert!(first.cost_usd_micros > 0);
    let again = qubite_english::remind::phrase(
        pool,
        &ai.gateway,
        &settings,
        me,
        lessons::SAMPLE,
        Some("onwK4e9ZLuTAKqWW03F9"),
    )
    .await
    .unwrap();
    assert_eq!(again.cost_usd_micros, 0);
    let foreign =
        qubite_english::remind::phrase(pool, &ai.gateway, &settings, me, "Buy crypto now", None)
            .await;
    assert!(
        matches!(foreign, Err(Error::Invalid(_))),
        "чужой текст не озвучивается"
    );

    // Без AI свой ответ сверяется по обязательным словам.
    let run = lessons::start(pool, me, "a0-m1-l1", "lesson")
        .await
        .unwrap();
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
    let a = lessons::answer(
        pool,
        &ai.gateway,
        me,
        run.id,
        None,
        "t8",
        Uuid::now_v7(),
        text("Hello! I'm Kirill. Nice to meet you!"),
    )
    .await
    .unwrap();
    assert!(a.correct && a.offline);

    // Чужой человек чужое прохождение не видит.
    let other = qubite_auth::accounts::create(
        pool,
        &Passwords::default(),
        NewAccount {
            email: "friend@qubite.ru",
            display_name: "",
            password: "пароль друга 123",
            email_verified: true,
        },
        Some(me),
    )
    .await
    .unwrap();
    let foreign = lessons::finish(pool, &ai.gateway, other.id, run.id).await;
    assert!(foreign.is_err(), "чужое прохождение не открыть");
}

#[tokio::test]
async fn reminder_once_a_day_not_after_ring() {
    let (_test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    lessons::change_settings(
        pool,
        me,
        LearnerChange {
            remind_at: Some("00:00".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    // Тишину «ночь» снимаем, чтобы тест не зависел от часов.
    sqlx::query(
        "INSERT INTO notify_settings (account_id, quiet_from, quiet_to) VALUES ($1, '00:00', '00:00')",
    )
    .bind(me)
    .execute(pool)
    .await
    .unwrap();
    let first = qubite_english::remind::remind_all(pool).await.unwrap();
    let second = qubite_english::remind::remind_all(pool).await.unwrap();
    assert_eq!(first, 1, "напомнил");
    assert_eq!(second, 0, "не чаще раза в день");
    let title: String = sqlx::query_scalar(
        "SELECT title FROM notifications WHERE account_id = $1 ORDER BY created_at DESC LIMIT 1",
    )
    .bind(me)
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(title.starts_with("Нейт"), "{title}");
}
