//! Живой голос Нейта через подписку ChatGPT (ENG-005) на настоящей
//! PostgreSQL: выбор голоса, сеанс с Нейтом и уроком, расшифровка в историю
//! без повторов, конец с итогом в «Английский.md». OpenAI — подделка
//! (`MockRealtime`), платных и сетевых запросов нет.

use std::sync::Arc;

use qubite_ai::{AiConfig, Gateway, MockRealtime, MockRealtimeStep, catalog, realtime as rt};
use qubite_auth::Passwords;
use qubite_english::{
    Error,
    lessons::{self, LearnerChange},
    realtime::{self, Line},
};
use qubite_testkit::TestDb;
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

/// Вход в ChatGPT — как после «Войти через ChatGPT» (токены здесь не нужны:
/// ключ выдаёт подделка).
async fn connect_chatgpt(pool: &PgPool, account: Uuid) {
    sqlx::query(
        "INSERT INTO ai_chatgpt_tokens (account_id, access_token_enc, refresh_token_enc, expires_at) \
         VALUES ($1, 'sealed-at', 'sealed-rt', now() + interval '1 hour')",
    )
    .bind(account)
    .execute(pool)
    .await
    .unwrap();
}

async fn gateway(pool: &PgPool, provider: Arc<MockRealtime>) -> Gateway {
    catalog::ensure_provider(pool, "chatgpt", "chatgpt", "", true)
        .await
        .unwrap();
    Gateway::new(pool.clone(), AiConfig::default()).with_realtime("chatgpt", provider)
}

fn line(item: &str, role: &str, text: &str) -> Line {
    Line {
        item: item.into(),
        role: role.into(),
        text: text.into(),
    }
}

#[tokio::test]
async fn engine_is_chatgpt_when_connected_unless_chosen_otherwise() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = gateway(pool, Arc::new(MockRealtime::new())).await;

    let e = realtime::engine(pool, &ai, me).await.unwrap();
    assert_eq!(
        (e.engine, e.chatgpt_connected, e.realtime_ready),
        ("elevenlabs", false, true),
        "без подписки — ElevenLabs"
    );
    connect_chatgpt(pool, me).await;
    let e = realtime::engine(pool, &ai, me).await.unwrap();
    assert_eq!(e.engine, "chatgpt", "подписка есть — по умолчанию ChatGPT");
    assert_eq!(e.model, rt::DEFAULT_MODEL);
    assert_eq!(e.voice, rt::DEFAULT_VOICE);

    lessons::change_settings(
        pool,
        me,
        LearnerChange {
            voice_engine: Some("elevenlabs".into()),
            realtime_voice: Some("cedar".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let e = realtime::engine(pool, &ai, me).await.unwrap();
    assert_eq!((e.engine, e.voice.as_str()), ("elevenlabs", "cedar"));
    // Пустая строка — снова «сам».
    let s = lessons::change_settings(
        pool,
        me,
        LearnerChange {
            voice_engine: Some(String::new()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(s.voice_engine, None);
    for bad in [
        LearnerChange {
            voice_engine: Some("whisper".into()),
            ..Default::default()
        },
        LearnerChange {
            realtime_model: Some("chatgpt:gpt-6".into()),
            ..Default::default()
        },
        LearnerChange {
            realtime_voice: Some("george".into()),
            ..Default::default()
        },
    ] {
        assert!(matches!(
            lessons::change_settings(pool, me, bad).await,
            Err(Error::Invalid(_))
        ));
    }
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn live_session_has_nate_and_lesson_and_saves_transcript_once() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let provider = Arc::new(MockRealtime::new());
    let ai = gateway(pool, provider.clone()).await;

    // Без подписки — понятный отказ, к OpenAI ничего не уходит.
    let error = realtime::open(pool, &ai, me, Uuid::now_v7())
        .await
        .unwrap_err();
    assert!(matches!(error, Error::NoSubscription));
    assert_eq!(error.code(), "chatgpt_not_connected");
    assert!(provider.calls().is_empty());

    connect_chatgpt(pool, me).await;
    let started = realtime::open(pool, &ai, me, Uuid::now_v7()).await.unwrap();
    assert_eq!(started.realtime.key, "ek_test_1");
    assert_eq!(started.fallback, None);
    let call = &provider.calls()[0];
    assert_eq!(call.account_id, me);
    assert!(call.instructions.contains("Ты — Нейт"), "характер Нейта");
    assert!(
        call.instructions.contains("Say it again"),
        "заставляет повторить"
    );
    assert!(
        call.instructions.contains("source=\"lesson\""),
        "текущий урок — данными"
    );
    assert!(!call.instructions.contains("JSON"), "голосом, без JSON");

    // Расшифровка: обе стороны, по порядку; повтор той же реплики не пишется.
    let id = started.realtime.call_id;
    let (session, added) = realtime::lines(
        pool,
        me,
        id,
        vec![
            line("item_a", "tutor", "Hi! What did you do yesterday?"),
            line("item_b", "learner", "I goed to school"),
            line(
                "item_c",
                "tutor",
                "Goed? Went. Say it again: I went to school.",
            ),
        ],
    )
    .await
    .unwrap();
    assert_eq!(added.len(), 3);
    assert_eq!(session.turns, 1, "реплик ученика — одна");
    assert_eq!(added[1].role, "learner");
    assert_eq!(added[1].via, "voice");
    let (session, again) = realtime::lines(
        pool,
        me,
        id,
        vec![
            line(
                "item_c",
                "tutor",
                "Goed? Went. Say it again: I went to school.",
            ),
            line("item_d", "learner", "  "),
            line("item_e", "learner", "I went to school"),
        ],
    )
    .await
    .unwrap();
    assert_eq!(again.len(), 1, "повтор и пустая — пропущены");
    assert_eq!(session.turns, 2);
    let xp: i64 = sqlx::query_scalar("SELECT xp FROM english_learners WHERE account_id = $1")
        .bind(me)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(xp, 2, "1 XP за реплику, как в разговоре ElevenLabs");

    // Неверная роль — отказ; чужой сеанс — не найден.
    assert!(matches!(
        realtime::lines(pool, me, id, vec![line("x", "system", "hi")]).await,
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        realtime::lines(pool, me, Uuid::now_v7(), vec![]).await,
        Err(Error::NotFound)
    ));

    // Новый сеанс в том же разговоре видит прошлые реплики.
    let resumed = realtime::open(pool, &ai, me, Uuid::now_v7()).await.unwrap();
    assert_eq!(resumed.session.id, started.session.id);
    assert_eq!(resumed.messages.len(), 4);
    assert!(
        provider.calls()[1]
            .instructions
            .contains("I went to school")
    );

    // «Закончить»: секунды — в учёт, разговор закрыт, итог — в «Английский.md».
    let (seconds, closed) = realtime::finish(pool, &ai, me, resumed.realtime.call_id, 2, true)
        .await
        .unwrap();
    assert_eq!(seconds, 2);
    let closed = closed.unwrap();
    assert!(closed.finished_at.is_some());
    assert!(closed.memory_action.is_some(), "итог в памяти агента");
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn mini_model_refused_falls_back_to_main_one() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let provider =
        Arc::new(MockRealtime::new().script([MockRealtimeStep::Refused("model_not_found".into())]));
    let ai = gateway(pool, provider.clone()).await;
    connect_chatgpt(pool, me).await;
    lessons::change_settings(
        pool,
        me,
        LearnerChange {
            realtime_model: Some(rt::MINI_MODEL.into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let started = realtime::open(pool, &ai, me, Uuid::now_v7()).await.unwrap();
    let calls = provider.calls();
    assert_eq!(calls[0].external_id, "gpt-realtime-mini");
    assert_eq!(calls[1].external_id, "gpt-realtime-1.5");
    assert_eq!(started.realtime.model, rt::DEFAULT_MODEL);
    assert!(started.fallback.unwrap().contains("1.5"));
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn dictation_needs_own_subscription_and_finishes_without_conversation() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let provider = Arc::new(MockRealtime::new());
    let ai = gateway(pool, provider.clone()).await;
    assert!(matches!(
        realtime::dictation(pool, &ai, me, Uuid::now_v7(), None).await,
        Err(Error::NoSubscription)
    ));
    connect_chatgpt(pool, me).await;
    assert!(matches!(
        realtime::dictation(pool, &ai, me, Uuid::now_v7(), Some("english".into())).await,
        Err(Error::Invalid(_))
    ));
    let d = realtime::dictation(pool, &ai, me, Uuid::now_v7(), Some("en".into()))
        .await
        .unwrap();
    assert_eq!(d.key, "ek_test_1");
    assert!(provider.calls()[0].transcription_only);
    let (seconds, closed) = realtime::finish(pool, &ai, me, d.call_id, 3, false)
        .await
        .unwrap();
    assert!(seconds <= 3);
    assert!(closed.is_none());
    db.close().await;
    test_db.drop_db().await;
}
