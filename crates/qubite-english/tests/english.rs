//! «Английский» на настоящей PostgreSQL (ENG-001): разговор голосом и
//! текстом, разбор ошибок и «повтори», речь с хранением, итог в
//! «Английский.md» через ленту агента. Модель и ElevenLabs — поддельные
//! (`MockProvider`, `MockVoice`), платных запросов нет.

use std::sync::Arc;

use qubite_agent::{Feed, files, timeline};
use qubite_ai::{
    AiConfig, AiError, Gateway, MockHeard, MockProvider, MockStep, MockVoice,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
    catalog, elevenlabs,
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_english::{Error, Said, Settings, Verdict};
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
    voice: Arc<MockVoice>,
}

/// Поддельная модель репетитора, поддельный ElevenLabs и личный лимит.
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
    let model = Arc::new(
        MockProvider::new(reply(json!({"say": "Go on.", "verdict": "none"}))).script(steps),
    );
    let voice = Arc::new(MockVoice::new().script(heard));
    Ai {
        gateway: Gateway::new(pool.clone(), AiConfig::default())
            .with_provider("mock", model.clone())
            .with_voice(elevenlabs::PROVIDER_ID, voice.clone()),
        model,
        voice,
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
        seconds: 2.5,
    }
}

fn voice_clip() -> Said {
    Said::Voice {
        audio: b"OPUS-FAKE".to_vec(),
        mime: "audio/webm;codecs=opus".into(),
        duration_ms: 2_400,
    }
}

async fn english_file(pool: &PgPool, account: Uuid) -> Option<String> {
    let mut conn = pool.acquire().await.unwrap();
    files::by_path(&mut conn, account, "Английский.md")
        .await
        .unwrap()
        .map(|f| f.body)
}

#[tokio::test]
async fn voice_conversation_corrects_mistakes_and_remembers() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(
        pool,
        me,
        vec![
            reply(json!({
                "say": "\"I goed\"? Seriously? Go is irregular: went. Say it again: I went to school yesterday.",
                "verdict": "mistake",
                "mistakes": [{"wrong": "I goed", "right": "I went", "why": "go — неправильный глагол: go → went"}],
                "repeat": "I went to school yesterday.",
                "repeated": false
            })),
            reply(json!({
                "say": "Fine. Finally. What did you do there?",
                "verdict": "ok",
                "mistakes": [],
                "repeat": "",
                "repeated": true
            })),
            reply(json!({
                "say": "\"He don't\"? No. He doesn't. Say it again: He doesn't like math.",
                "verdict": "mistake",
                "mistakes": [{"wrong": "He don't", "right": "He doesn't", "why": "he/she/it → does"}],
                "repeat": "He doesn't like math.",
                "repeated": false
            })),
        ],
        vec![
            spoken("I goed to school yesterday"),
            spoken("I went to school yesterday"),
        ],
    )
    .await;
    let settings = Settings::default();

    let overview = qubite_english::overview(pool, &ai.gateway, me)
        .await
        .unwrap();
    assert!(overview.session.is_none());
    assert!(overview.voice.listen && overview.voice.speak);

    let (session, messages) = qubite_english::start(pool, me).await.unwrap();
    assert_eq!(messages.len(), 1, "репетитор здоровается сам, без модели");
    assert_eq!(messages[0].role, "tutor");
    assert_eq!(ai.model.calls(), 0);
    let (again, _) = qubite_english::start(pool, me).await.unwrap();
    assert_eq!(again.id, session.id, "второй «Начать» — тот же разговор");

    // 1. Голос с ошибкой: распознали → репетитор нашёл ошибку и требует повторить.
    let first = qubite_english::turn(
        pool,
        &ai.gateway,
        &settings,
        me,
        Uuid::now_v7(),
        voice_clip(),
    )
    .await
    .unwrap();
    assert_eq!(first.learner.text, "I goed to school yesterday");
    assert_eq!(first.learner.via, "voice");
    assert_eq!(first.tutor.verdict, Some(Verdict::Mistake));
    assert_eq!(first.tutor.mistakes[0].wrong, "I goed");
    assert_eq!(first.tutor.mistakes[0].right, "I went");
    assert_eq!(first.tutor.repeat, "I went to school yesterday.");
    assert!(first.cost_usd_micros > 0);

    // Модель получила слова ученика отдельным блоком данных, а характер — в инструкциях.
    let call = ai.model.last_call().unwrap();
    let system = &call.messages[0].content;
    assert!(system.contains("Никакого мата"), "характер без мата");
    let data: String = call.messages[1..]
        .iter()
        .map(|m| m.content.clone())
        .collect();
    assert!(data.contains("source=\"learner\""), "{data}");
    assert!(data.contains("I goed to school yesterday"));

    // 2. Повторил правильно: репетитор видит, что просил повторить.
    let second = qubite_english::turn(
        pool,
        &ai.gateway,
        &settings,
        me,
        Uuid::now_v7(),
        voice_clip(),
    )
    .await
    .unwrap();
    assert_eq!(second.tutor.verdict, Some(Verdict::Ok));
    assert!(second.tutor.repeated);
    let data: String = ai.model.last_call().unwrap().messages[1..]
        .iter()
        .map(|m| m.content.clone())
        .collect();
    assert!(
        data.contains("(повтори: I went to school yesterday.)"),
        "в разговоре видно, что просили повторить: {data}"
    );

    // 3. Текстом.
    let third = qubite_english::turn(
        pool,
        &ai.gateway,
        &settings,
        me,
        Uuid::now_v7(),
        Said::Text("He don't like math".into()),
    )
    .await
    .unwrap();
    assert_eq!(third.learner.via, "text");
    assert_eq!(third.session.turns, 3);
    assert_eq!(third.session.correct, 1);
    assert_eq!(third.session.mistakes, 2);
    assert_eq!(ai.voice.stt_calls(), 2);

    // Речь: первый раз — через шлюз, дальше — из базы бесплатно.
    let speech = qubite_english::speech(pool, &ai.gateway, &settings, me, first.tutor.id)
        .await
        .unwrap();
    assert!(speech.audio.starts_with(b"MOCK-MP3:"));
    assert!(speech.cost_usd_micros > 0);
    let again = qubite_english::speech(pool, &ai.gateway, &settings, me, first.tutor.id)
        .await
        .unwrap();
    assert_eq!(again.audio, speech.audio);
    assert_eq!(again.cost_usd_micros, 0);
    assert_eq!(ai.voice.tts_calls(), 1);
    assert_eq!(
        ai.voice.last_speech().unwrap().voice,
        elevenlabs::DEFAULT_VOICE
    );

    // Чужую реплику не озвучить.
    let stranger =
        qubite_english::speech(pool, &ai.gateway, &settings, Uuid::now_v7(), first.tutor.id)
            .await
            .unwrap_err();
    assert!(
        matches!(stranger, Error::Denied(_) | Error::NotFound),
        "{stranger}"
    );

    // Закончить: итог — в «Английский.md», строкой ленты агента.
    assert!(english_file(pool, me).await.is_none());
    let done = qubite_english::finish(pool, me).await.unwrap().unwrap();
    assert!(done.finished_at.is_some());
    let action = done.memory_action.expect("итог записан");
    let body = english_file(pool, me).await.unwrap();
    assert!(
        body.contains("Разговоров: 1 · реплик: 3 · верно: 1 (33 %) · с ошибками: 2"),
        "{body}"
    );
    assert!(
        body.contains("«I goed» → «I went» — go — неправильный глагол: go → went"),
        "{body}"
    );
    assert!(body.contains("«He don't» → «He doesn't»"), "{body}");
    assert!(body.contains("## Заметки"));
    let page = timeline::list(pool, me, Feed::All, None, 5).await.unwrap();
    assert_eq!(page.items[0].id, action);
    assert!(
        page.items[0].summary.starts_with("«Английский»: разговор"),
        "{}",
        page.items[0].summary
    );
    assert!(qubite_english::finish(pool, me).await.unwrap().is_none());

    let overview = qubite_english::overview(pool, &ai.gateway, me)
        .await
        .unwrap();
    assert!(overview.session.is_none());
    assert_eq!(overview.last.unwrap().id, session.id);
    assert_eq!(overview.totals.turns, 3);

    // Следующий разговор: репетитор видит заметки (прошлые ошибки).
    qubite_english::start(pool, me).await.unwrap();
    qubite_english::turn(
        pool,
        &ai.gateway,
        &settings,
        me,
        Uuid::now_v7(),
        Said::Text("Hello again".into()),
    )
    .await
    .unwrap();
    let data: String = ai.model.last_call().unwrap().messages[1..]
        .iter()
        .map(|m| m.content.clone())
        .collect();
    assert!(data.contains("source=\"notes\""));
    assert!(data.contains("I goed"));

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn heard_text_is_kept_when_tutor_fails() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(
        pool,
        me,
        vec![MockStep::Refuse],
        vec![spoken("My name is Kirill")],
    )
    .await;
    qubite_english::start(pool, me).await.unwrap();
    let error = qubite_english::turn(
        pool,
        &ai.gateway,
        &Settings::default(),
        me,
        Uuid::now_v7(),
        voice_clip(),
    )
    .await
    .unwrap_err();
    match error {
        Error::Ai { error, heard } => {
            assert!(matches!(error, AiError::ProviderRefused { .. }), "{error}");
            assert_eq!(heard.as_deref(), Some("My name is Kirill"));
        }
        other => panic!("{other}"),
    }
    let count: i64 =
        sqlx::query_scalar("SELECT count(*) FROM english_messages WHERE role = 'learner'")
            .fetch_one(pool)
            .await
            .unwrap();
    assert_eq!(
        count, 0,
        "без ответа реплика не ложится — повтор её не задвоит"
    );

    // Пустое распознавание — просьба сказать ещё раз.
    ai.voice.push(spoken("   "));
    let error = qubite_english::turn(
        pool,
        &ai.gateway,
        &Settings::default(),
        me,
        Uuid::now_v7(),
        voice_clip(),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::Invalid(_)), "{error}");
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn without_ai_grant_nothing_is_sent_and_text_works_without_voice() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(pool, me, vec![], vec![]).await;

    // Человек с агентом, но без AI: разговор начать можно, ответить некому.
    let pupil = qubite_auth::accounts::create(
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
    .bind(pupil)
    .execute(pool)
    .await
    .unwrap();
    qubite_english::start(pool, pupil).await.unwrap();
    let error = qubite_english::turn(
        pool,
        &ai.gateway,
        &Settings::default(),
        pupil,
        Uuid::now_v7(),
        voice_clip(),
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::Denied(_)), "{error}");
    assert_eq!(ai.model.calls() + ai.voice.stt_calls(), 0);

    // Без агента — нет и английского.
    let stranger = Uuid::now_v7();
    assert!(matches!(
        qubite_english::start(pool, stranger).await.unwrap_err(),
        Error::Denied(_)
    ));

    // Голос не настроен (нет ключа ElevenLabs) — экран честно это видит, текст работает.
    let textual =
        Gateway::new(pool.clone(), AiConfig::default()).with_provider("mock", ai.model.clone());
    let overview = qubite_english::overview(pool, &textual, me).await.unwrap();
    assert!(!overview.voice.listen && !overview.voice.speak);
    qubite_english::turn(
        pool,
        &textual,
        &Settings::default(),
        me,
        Uuid::now_v7(),
        Said::Text("I like olympiads".into()),
    )
    .await
    .unwrap();
    let error = qubite_english::turn(
        pool,
        &textual,
        &Settings::default(),
        me,
        Uuid::now_v7(),
        voice_clip(),
    )
    .await
    .unwrap_err();
    assert!(
        matches!(
            error,
            Error::Ai {
                error: AiError::ModelNotAllowed,
                ..
            }
        ),
        "{error}"
    );
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn idle_conversation_closes_and_notes_are_kept() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(
        pool,
        me,
        vec![reply(json!({
            "say": "\"Is\"? Are. They are. Say it again: They are my friends.",
            "verdict": "mistake",
            "mistakes": [{"wrong": "They is", "right": "They are", "why": "they → are"}],
            "repeat": "They are my friends."
        }))],
        vec![],
    )
    .await;
    // Свои заметки в файле — репетитор их не трогает.
    let who = qubite_agent::Who::agent(
        &qubite_agent::start_run(pool, me, qubite_agent::Trigger::Manual)
            .await
            .unwrap(),
    );
    qubite_agent::memory::put(
        pool,
        &who,
        "Английский.md",
        "# Английский\n\n## Заметки\n- готовлюсь к ОГЭ, слабое место — времена\n",
        "заметки",
        None,
    )
    .await
    .unwrap();

    let (first, _) = qubite_english::start(pool, me).await.unwrap();
    qubite_english::turn(
        pool,
        &ai.gateway,
        &Settings::default(),
        me,
        Uuid::now_v7(),
        Said::Text("They is my friends".into()),
    )
    .await
    .unwrap();
    // Полчаса тишины — разговор закончен; следующий «Начать» — новый разговор.
    sqlx::query("UPDATE english_sessions SET last_at = now() - interval '31 minutes'")
        .execute(pool)
        .await
        .unwrap();
    let overview = qubite_english::overview(pool, &ai.gateway, me)
        .await
        .unwrap();
    assert!(
        overview.session.is_none(),
        "заснувший разговор не показывается идущим"
    );
    let (second, messages) = qubite_english::start(pool, me).await.unwrap();
    assert_ne!(second.id, first.id);
    assert_eq!(messages.len(), 1);
    let closed: Option<Uuid> =
        sqlx::query_scalar("SELECT memory_action FROM english_sessions WHERE id = $1")
            .bind(first.id)
            .fetch_one(pool)
            .await
            .unwrap();
    assert!(closed.is_some(), "итог заснувшего разговора записан");
    let body = english_file(pool, me).await.unwrap();
    assert!(body.contains("«They is» → «They are»"), "{body}");
    assert!(
        body.ends_with("## Заметки\n- готовлюсь к ОГЭ, слабое место — времена\n"),
        "{body}"
    );
    db.close().await;
    test_db.drop_db().await;
}
