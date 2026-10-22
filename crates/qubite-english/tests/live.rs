//! Разговор потоком (ENG-001, «ответ почти сразу»): на поддельных модели и
//! ElevenLabs меряем задержку и проверяем, что голос идёт, **пока модель ещё
//! пишет**, а перебивание глушит голос, но ответ сохраняется. Платных запросов нет.

use std::{
    sync::Arc,
    time::{Duration, Instant},
};

use qubite_ai::{
    AiConfig, Gateway, MockHeard, MockProvider, MockStep, MockVoice,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
    catalog, elevenlabs,
};
use qubite_auth::Passwords;
use qubite_english::{
    Settings, Verdict,
    live::{self, In, Out},
};
use qubite_testkit::TestDb;
use sqlx::PgPool;
use tokio::sync::mpsc;
use uuid::Uuid;

/// Модель пишет ответ 8 кусками по 100 мс — целиком за ~0,8 с.
const CHUNK_MS: u64 = 100;

fn tutor_chunks() -> Vec<String> {
    [
        "{\"say\": \"",
        "\\\"I goed\\\"? Seriously? ",
        "Go is irregular: went. ",
        "Say it again: ",
        "I went to school yesterday.\", ",
        "\"verdict\": \"mistake\", \"mistakes\": [{\"wrong\": \"I goed\", ",
        "\"right\": \"I went\", \"why\": \"go — неправильный глагол\"}], ",
        "\"repeat\": \"I went to school yesterday.\", \"repeated\": false}",
    ]
    .map(String::from)
    .to_vec()
}

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

async fn setup(
    pool: &PgPool,
    me: Uuid,
    steps: Vec<MockStep>,
    voice: Option<Arc<MockVoice>>,
) -> Gateway {
    let console = qubite_policy::decide_owner(pool, &qubite_policy::Subject::account(me, None))
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
    admin::set_task_model(pool, &console, "english.tutor", Some("mock-tutor"))
        .await
        .unwrap();
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
    catalog::ensure_provider(
        pool,
        elevenlabs::PROVIDER_ID,
        "elevenlabs",
        elevenlabs::DEFAULT_BASE_URL,
        true,
    )
    .await
    .unwrap();
    let model = Arc::new(MockProvider::new(MockStep::Refuse).script(steps));
    let gateway = Gateway::new(pool.clone(), AiConfig::default()).with_provider("mock", model);
    match voice {
        Some(voice) => gateway.with_voice(elevenlabs::PROVIDER_ID, voice),
        None => gateway,
    }
}

/// Разговор в отдельной задаче: что слать и что пришло (с отметкой времени).
struct Talk {
    tx: mpsc::Sender<In>,
    rx: mpsc::Receiver<Out>,
}

fn open(pool: &PgPool, gateway: Gateway, me: Uuid) -> Talk {
    let (tx, inbox) = mpsc::channel(64);
    let (out, rx) = mpsc::channel(256);
    let pool = pool.clone();
    tokio::spawn(async move {
        let gateway = gateway;
        live::serve(&pool, &gateway, &Settings::default(), me, inbox, out)
            .await
            .unwrap();
    });
    Talk { tx, rx }
}

impl Talk {
    /// Всё, что пришло до записанного хода (включительно), с временем от `t0`.
    async fn until_reply(&mut self, t0: Instant) -> Vec<(u128, Out)> {
        let mut got = Vec::new();
        loop {
            let out = tokio::time::timeout(Duration::from_secs(10), self.rx.recv())
                .await
                .expect("ответ не пришёл за 10 с")
                .expect("разговор закрылся");
            let done = matches!(out, Out::Reply(_) | Out::Error { .. });
            got.push((t0.elapsed().as_millis(), out));
            if done {
                // Замеры приходят перед ходом — уже в списке.
                return got;
            }
        }
    }
}

fn speech() -> Vec<u8> {
    vec![7u8; 3200] // 0,1 с «речи» (не нули)
}

fn silence() -> Vec<u8> {
    vec![0u8; 3200] // пауза — поддельное распознавание считает фразу законченной
}

#[tokio::test]
async fn voice_starts_before_the_model_finishes_and_latency_is_measured() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let voice = Arc::new(
        MockVoice::new()
            .with_tts_delay(20)
            .script([MockHeard::Text {
                text: "I goed to school yesterday".into(),
                seconds: 2.0,
            }]),
    );
    let gateway = setup(
        pool,
        me,
        vec![MockStep::Stream {
            chunks: tutor_chunks(),
            delay_ms: CHUNK_MS,
            tokens_in: 400,
            tokens_out: 90,
        }],
        Some(voice.clone()),
    )
    .await;
    qubite_english::start(pool, me).await.unwrap();
    let mut talk = open(pool, gateway, me);

    talk.tx.send(In::Listen).await.unwrap();
    for _ in 0..5 {
        talk.tx.send(In::Audio(speech())).await.unwrap();
    }
    // Конец фразы: пауза — с этого момента меряем.
    let t0 = Instant::now();
    talk.tx.send(In::Audio(silence())).await.unwrap();
    let got = talk.until_reply(t0).await;

    assert!(
        got.iter().any(|(_, o)| matches!(o, Out::Partial(_))),
        "черновик, пока говорил"
    );
    assert!(
        got.iter()
            .any(|(_, o)| matches!(o, Out::Heard(t) if t == "I goed to school yesterday"))
    );
    let first_audio = got
        .iter()
        .find(|(_, o)| matches!(o, Out::Audio(_)))
        .map(|(t, _)| *t)
        .expect("голос был");
    let last_say = got
        .iter()
        .filter(|(_, o)| matches!(o, Out::Say(_)))
        .map(|(t, _)| *t)
        .max()
        .unwrap();
    let reply_at = got
        .iter()
        .find(|(_, o)| matches!(o, Out::Reply(_)))
        .map(|(t, _)| *t)
        .unwrap();
    assert!(
        first_audio < last_say,
        "голос начался ({first_audio} мс) раньше, чем модель дописала ({last_say} мс) — поток не ждёт"
    );
    let total_model = u128::from(CHUNK_MS) * tutor_chunks().len() as u128;
    assert!(
        first_audio < total_model / 2,
        "первый звук через {first_audio} мс при ответе модели {total_model} мс"
    );

    let latency = got
        .iter()
        .find_map(|(_, o)| match o {
            Out::Metrics(l) => Some(l.clone()),
            _ => None,
        })
        .expect("замеры");
    let first = latency.first_audio_ms.expect("первый звук замерен");
    assert!(first < latency.reply_ms, "{latency:?}");
    assert_eq!(
        latency.heard_ms,
        Some(0),
        "живое распознавание — фраза готова сразу"
    );
    // Модель дала первое предложение через ~2 куска (200 мс); остальное — наш путь.
    println!(
        "ЗАМЕР (поддельные провайдеры: модель {CHUNK_MS} мс/кусок, синтез 20 мс): первый звук {first} мс, \
         первое слово {:?} мс, ответ целиком {} мс, накладные нашего пути ≈ {} мс",
        latency.first_text_ms,
        latency.reply_ms,
        first.saturating_sub(2 * CHUNK_MS + 20),
    );

    let Out::Reply(turn) = &got.last().unwrap().1 else {
        panic!("последним — ход")
    };
    assert_eq!(turn.learner.via, "voice");
    assert_eq!(turn.tutor.verdict, Some(Verdict::Mistake));
    assert_eq!(turn.tutor.mistakes[0].right, "I went");
    assert!(
        turn.tutor.has_speech,
        "речь сохранена — «Ещё раз» бесплатно"
    );
    assert_eq!(
        turn.tutor.latency.as_ref().unwrap().first_audio_ms,
        Some(first)
    );
    assert!(reply_at >= last_say);
    // Предложения озвучены по одному, не всем ответом сразу.
    assert!(
        voice.tts_calls() >= 3,
        "синтез по предложениям: {}",
        voice.tts_calls()
    );
    assert_eq!(voice.live_calls(), 1);

    // Живое распознавание списано по секундам звука (6 × 0,1 с → 1 с).
    let (status, seconds): (String, i64) = sqlx::query_as(
        "SELECT status, tokens_in FROM ai_calls WHERE model_id = 'elevenlabs/scribe_v2_realtime'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!((status.as_str(), seconds), ("succeeded", 1));
    let speech_status: Vec<String> = sqlx::query_scalar(
        "SELECT status FROM ai_calls WHERE model_id = 'elevenlabs/eleven_flash_v2_5'",
    )
    .fetch_all(pool)
    .await
    .unwrap();
    assert!(speech_status.iter().all(|s| s == "succeeded"));
    drop(talk);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn interrupt_mutes_the_voice_but_keeps_the_answer() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let voice = Arc::new(MockVoice::new().with_tts_delay(150));
    let gateway = setup(
        pool,
        me,
        vec![MockStep::Stream {
            chunks: tutor_chunks(),
            delay_ms: CHUNK_MS,
            tokens_in: 400,
            tokens_out: 90,
        }],
        Some(voice.clone()),
    )
    .await;
    let mut talk = open(pool, gateway, me);
    let t0 = Instant::now();
    talk.tx
        .send(In::Text("I goed to school yesterday".into()))
        .await
        .unwrap();
    // Ждём первый звук и перебиваем.
    loop {
        match talk.rx.recv().await.unwrap() {
            Out::Audio(_) => break,
            Out::Error { message, .. } => panic!("{message}"),
            _ => {}
        }
    }
    talk.tx.send(In::Interrupt).await.unwrap();
    let interrupted = t0.elapsed().as_millis();
    let got = talk.until_reply(t0).await;
    let late: Vec<u128> = got
        .iter()
        .filter(|(t, o)| matches!(o, Out::Audio(_)) && *t > interrupted + 50)
        .map(|(t, _)| *t)
        .collect();
    assert!(late.is_empty(), "после «замолчи» голос не идёт: {late:?}");
    let Out::Reply(turn) = &got.last().unwrap().1 else {
        panic!("ход записан")
    };
    assert_eq!(
        turn.tutor.verdict,
        Some(Verdict::Mistake),
        "ответ дописан и сохранён"
    );
    assert!(!turn.tutor.has_speech, "оборванная речь не сохраняется");
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn text_works_without_voice_and_without_ai_grant_is_refused() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let gateway = setup(
        pool,
        me,
        vec![MockStep::Stream {
            chunks: tutor_chunks(),
            delay_ms: 10,
            tokens_in: 400,
            tokens_out: 90,
        }],
        None,
    )
    .await;
    let mut talk = open(pool, gateway, me);
    let t0 = Instant::now();
    talk.tx.send(In::Listen).await.unwrap();
    talk.tx
        .send(In::Text("I goed to school yesterday".into()))
        .await
        .unwrap();
    let got = talk.until_reply(t0).await;
    assert!(
        matches!(&got[0].1, Out::Error { message, .. } if message.contains("голос не настроен")),
        "без голоса микрофон честно отказывает"
    );
    let got = if got.len() == 1 {
        talk.until_reply(t0).await
    } else {
        got
    };
    assert!(
        got.iter().any(|(_, o)| matches!(o, Out::Say(_))),
        "текст ответа идёт потоком"
    );
    assert!(!got.iter().any(|(_, o)| matches!(o, Out::Audio(_))));
    assert!(matches!(got.last().unwrap().1, Out::Reply(_)));

    // Человек без AI-гранта: ответа нет, к модели ничего не ушло.
    let pupil = qubite_auth::accounts::create(
        pool,
        &Passwords::default(),
        qubite_auth::accounts::NewAccount {
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
        "INSERT INTO module_grants (id, account_id, module_id, can_read, can_write) VALUES ($1, $2, 'agent', true, true)",
    )
    .bind(Uuid::now_v7())
    .bind(pupil)
    .execute(pool)
    .await
    .unwrap();
    let other = Gateway::new(pool.clone(), AiConfig::default());
    let mut talk = open(pool, other, pupil);
    talk.tx.send(In::Text("Hello".into())).await.unwrap();
    let got = talk.until_reply(Instant::now()).await;
    assert!(
        matches!(&got[0].1, Out::Error { code, .. } if code != &"internal"),
        "отказ по правам"
    );
    db.close().await;
    test_db.drop_db().await;
}

/// Баг владельца 22.10.2026: ход — распознавание, ответ и голос по предложениям
/// (6 вызовов) — упирался в «20 AI-запросов в минуту» и в повтор одной фразы.
/// 5 минут разговора: 30 ходов, между ходами «проходит» 10 с.
#[tokio::test]
async fn thirty_turns_in_five_minutes_do_not_trip_the_loop_guard() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let voice = Arc::new(MockVoice::new());
    let steps = (0..30)
        .map(|_| MockStep::Stream {
            chunks: tutor_chunks(),
            delay_ms: 1,
            tokens_in: 400,
            tokens_out: 90,
        })
        .collect();
    // Защита — как по умолчанию в .env: 20 в минуту, повтор — 3 раза за 10 минут.
    let gateway = setup(pool, me, steps, Some(voice.clone())).await;
    qubite_english::start(pool, me).await.unwrap();
    let mut talk = open(pool, gateway, me);

    for turn in 1..=30 {
        talk.tx.send(In::Listen).await.unwrap();
        for _ in 0..3 {
            talk.tx.send(In::Audio(speech())).await.unwrap();
        }
        talk.tx.send(In::Audio(silence())).await.unwrap();
        let got = talk.until_reply(Instant::now()).await;
        match &got.last().unwrap().1 {
            Out::Reply(_) => {}
            Out::Error { code, message, .. } => panic!("ход {turn}: {code} — {message}"),
            _ => unreachable!(),
        }
        // Прошло 10 секунд.
        sqlx::query("UPDATE ai_calls SET created_at = created_at - interval '10 seconds'")
            .execute(pool)
            .await
            .unwrap();
    }

    assert_eq!(voice.live_calls(), 30);
    assert!(
        voice.tts_calls() >= 90,
        "голос по предложениям: {}",
        voice.tts_calls()
    );
    let (calls, turns): (i64, i64) = sqlx::query_as(
        "SELECT count(*), count(DISTINCT turn_id) FROM ai_calls WHERE status = 'succeeded'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(calls >= 150, "вызовов {calls} — каждый списан по факту");
    assert_eq!(turns, 30, "каждый ход — один запрос для защиты");
    drop(talk);
    db.close().await;
    test_db.drop_db().await;
}

/// Лимит закончился: экран узнаёт об этом сразу, запись целиком не начинается
/// (она упёрлась бы в тот же лимит), к провайдеру ничего не уходит.
#[tokio::test]
async fn budget_error_stops_listening_instead_of_falling_back() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let voice = Arc::new(MockVoice::new());
    let gateway = setup(pool, me, Vec::new(), Some(voice.clone())).await;
    let console = qubite_policy::decide_owner(pool, &qubite_policy::Subject::account(me, None))
        .await
        .unwrap();
    admin::set_limit(
        pool,
        &console,
        &LimitScope::User(me),
        Period::Day,
        Metric::Usd,
        1,
    )
    .await
    .unwrap();
    qubite_english::start(pool, me).await.unwrap();
    let mut talk = open(pool, gateway, me);

    talk.tx.send(In::Listen).await.unwrap();
    let got = talk.until_reply(Instant::now()).await;
    assert!(
        matches!(
            &got[0].1,
            Out::Error {
                code: "budget_exhausted",
                stop: true,
                ..
            }
        ),
        "{:?}",
        got.iter().map(|(_, o)| o).collect::<Vec<_>>()
    );
    // Фраза дошла до конца — ни записи, ни распознавания, ни новых ошибок.
    talk.tx.send(In::Audio(speech())).await.unwrap();
    talk.tx.send(In::Done).await.unwrap();
    let more = tokio::time::timeout(Duration::from_millis(300), talk.rx.recv()).await;
    assert!(
        more.is_err(),
        "после отказа по лимиту экран больше ничего не получает"
    );
    assert_eq!((voice.live_calls(), voice.stt_calls()), (0, 0));
    drop(talk);
    db.close().await;
    test_db.drop_db().await;
}

/// ElevenLabs отказал (302 из закрытой страны): экран узнаёт сразу, запись
/// целиком не начинается — она упёрлась бы в тот же отказ (D-515).
#[tokio::test]
async fn provider_refusal_stops_listening_instead_of_falling_back() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let voice = Arc::new(MockVoice::new().script([MockHeard::Refuse]));
    let gateway = setup(pool, me, Vec::new(), Some(voice.clone())).await;
    qubite_english::start(pool, me).await.unwrap();
    let mut talk = open(pool, gateway, me);

    talk.tx.send(In::Listen).await.unwrap();
    let got = talk.until_reply(Instant::now()).await;
    assert!(
        matches!(&got[0].1, Out::Error { code: "provider_refused", message, stop: true, .. } if !message.contains("другую модель")),
        "{:?}",
        got.iter().map(|(_, o)| o).collect::<Vec<_>>()
    );
    talk.tx.send(In::Audio(speech())).await.unwrap();
    talk.tx.send(In::Done).await.unwrap();
    let more = tokio::time::timeout(Duration::from_millis(300), talk.rx.recv()).await;
    assert!(
        more.is_err(),
        "после отказа провайдера — тишина, без записи"
    );
    assert_eq!((voice.live_calls(), voice.stt_calls()), (1, 0));
    drop(talk);
    db.close().await;
    test_db.drop_db().await;
}

/// Кончились символы у ElevenLabs: это лимит подписки (экран подскажет), а не
/// «отказ», и микрофон выключается — запись целиком упёрлась бы в то же.
#[tokio::test]
async fn subscription_limit_on_live_listen_stops_with_its_own_code() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let voice = Arc::new(MockVoice::new().script([MockHeard::Limit]));
    let gateway = setup(pool, me, Vec::new(), Some(voice.clone())).await;
    qubite_english::start(pool, me).await.unwrap();
    let mut talk = open(pool, gateway, me);

    talk.tx.send(In::Listen).await.unwrap();
    let got = talk.until_reply(Instant::now()).await;
    assert!(
        matches!(
            &got[0].1,
            Out::Error {
                code: "subscription_limit",
                stop: true,
                ..
            }
        ),
        "{:?}",
        got.iter().map(|(_, o)| o).collect::<Vec<_>>()
    );
    talk.tx.send(In::Audio(speech())).await.unwrap();
    talk.tx.send(In::Done).await.unwrap();
    let more = tokio::time::timeout(Duration::from_millis(300), talk.rx.recv()).await;
    assert!(more.is_err(), "после лимита подписки — тишина, без записи");
    assert_eq!((voice.live_calls(), voice.stt_calls()), (1, 0));
    drop(talk);
    db.close().await;
    test_db.drop_db().await;
}

/// Живое распознавание не открылось на миг (429, нет соединения) — шлюз
/// повторяет, как и у остальных вызовов, и разговор идёт потоком.
#[tokio::test]
async fn live_listen_retries_when_not_sent() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let voice = Arc::new(MockVoice::new().script([
        MockHeard::FailBeforeSend,
        MockHeard::Text {
            text: "I went home".into(),
            seconds: 1.0,
        },
    ]));
    let gateway = setup(
        pool,
        me,
        vec![MockStep::Stream {
            chunks: tutor_chunks(),
            delay_ms: 10,
            tokens_in: 400,
            tokens_out: 90,
        }],
        Some(voice.clone()),
    )
    .await;
    qubite_english::start(pool, me).await.unwrap();
    let mut talk = open(pool, gateway, me);

    talk.tx.send(In::Listen).await.unwrap();
    talk.tx.send(In::Audio(speech())).await.unwrap();
    talk.tx.send(In::Done).await.unwrap();
    let got = talk.until_reply(Instant::now()).await;
    assert!(
        got.iter()
            .any(|(_, o)| matches!(o, Out::Heard(text) if text == "I went home")),
        "{:?}",
        got.iter().map(|(_, o)| o).collect::<Vec<_>>()
    );
    assert_eq!((voice.live_calls(), voice.stt_calls()), (2, 0));
    drop(talk);
    db.close().await;
    test_db.drop_db().await;
}
