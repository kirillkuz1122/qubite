//! «Английский» через настоящий HTTP-сервер (ENG-001): экран, разговор,
//! голос в base64, речь MP3, отказ с распознанным текстом, итог в памяти.
//! Модель и ElevenLabs — поддельные.

mod common;

use std::{net::SocketAddr, sync::Arc};

use base64::Engine;
use common::{Browser, EMAIL, PASSWORD};
use qubite_ai::{
    AiConfig, Gateway, MockHeard, MockProvider, MockStep, MockVoice,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
    catalog, elevenlabs,
};
use qubite_auth::Passwords;
use qubite_server::{AppState, auth::AuthSettings};
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

fn reply(value: Value) -> MockStep {
    MockStep::Reply {
        text: value.to_string(),
        tokens_in: 200,
        tokens_out: 60,
    }
}

async fn gateway(
    pool: &PgPool,
    owner: Uuid,
    steps: Vec<MockStep>,
    heard: Vec<MockHeard>,
) -> (Gateway, Arc<MockVoice>) {
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
    admin::set_task_model(pool, &console, "english.tutor", Some("mock-tutor"))
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
    let model = Arc::new(MockProvider::new(MockStep::Refuse).script(steps));
    let voice = Arc::new(MockVoice::new().script(heard));
    (
        Gateway::new(pool.clone(), AiConfig::default())
            .with_provider("mock", model)
            .with_voice(elevenlabs::PROVIDER_ID, voice.clone()),
        voice,
    )
}

async fn serve(state: AppState) -> SocketAddr {
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    address
}

/// POST без тела, ответ — байты (речь).
async fn post_bytes(browser: &Browser, address: SocketAddr, path: &str) -> (u16, String, Vec<u8>) {
    let response = qubite_testkit::http_client()
        .post(format!("http://{address}{path}"))
        .header(
            "cookie",
            format!(
                "qubite_session={}; qubite_csrf={}",
                browser.session.as_deref().unwrap(),
                browser.csrf.as_deref().unwrap()
            ),
        )
        .header("x-csrf-token", browser.csrf.as_deref().unwrap())
        .send()
        .await
        .unwrap();
    let status = response.status().as_u16();
    let kind = response
        .headers()
        .get("content-type")
        .map(|v| v.to_str().unwrap().to_owned())
        .unwrap_or_default();
    (status, kind, response.bytes().await.unwrap().to_vec())
}

#[tokio::test]
async fn english_conversation_over_http() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = qubite_auth::owner::create(pool, &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap()
        .id;
    let (gateway, voice) = gateway(
        pool,
        owner,
        vec![
            reply(json!({
                "say": "\"Yesterday I go\"? Went. Say it again: Yesterday I went home.",
                "verdict": "mistake",
                "mistakes": [{"wrong": "Yesterday I go", "right": "Yesterday I went", "why": "прошлое — went"}],
                "repeat": "Yesterday I went home."
            })),
            MockStep::Refuse,
        ],
        vec![
            MockHeard::Text {
                text: "Yesterday I go home".into(),
                seconds: 2.0,
            },
            MockHeard::Text {
                text: "Yesterday I went home".into(),
                seconds: 2.0,
            },
        ],
    )
    .await;
    let address =
        serve(AppState::with_auth(db.clone(), AuthSettings::default()).with_ai(Arc::new(gateway)))
            .await;
    let mut me = Browser::default();
    assert_eq!(me.login(address, EMAIL, PASSWORD).await.status, 200);

    let screen = me.get(address, "/api/v1/english").await;
    assert_eq!(screen.status, 200, "{:?}", screen.body);
    assert_eq!(screen.body["session"], Value::Null);
    assert_eq!(
        screen.body["voice"],
        json!({"listen": true, "speak": true, "live": true})
    );

    let started = me.post(address, "/api/v1/english/session").await;
    assert_eq!(started.status, 200, "{:?}", started.body);
    assert_eq!(started.body["messages"][0]["role"], "tutor");
    let greeting = started.body["messages"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();

    // Голос — base64 в JSON.
    let audio = base64::engine::general_purpose::STANDARD.encode(b"OPUS-FAKE");
    let turn = me
        .post_json(
            address,
            "/api/v1/english/turn",
            json!({"key": Uuid::now_v7(), "audio_base64": audio, "mime": "audio/webm;codecs=opus", "duration_ms": 2100}),
        )
        .await;
    assert_eq!(turn.status, 200, "{:?}", turn.body);
    assert_eq!(turn.body["learner"]["text"], "Yesterday I go home");
    assert_eq!(turn.body["learner"]["via"], "voice");
    assert_eq!(turn.body["tutor"]["verdict"], "mistake");
    assert_eq!(
        turn.body["tutor"]["mistakes"][0]["right"],
        "Yesterday I went"
    );
    assert_eq!(turn.body["tutor"]["repeat"], "Yesterday I went home.");
    let tutor = turn.body["tutor"]["id"].as_str().unwrap().to_owned();

    // Речь — MP3; второй раз — из базы.
    let (status, kind, bytes) = post_bytes(
        &me,
        address,
        &format!("/api/v1/english/messages/{tutor}/speech"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(kind, "audio/mpeg");
    assert!(bytes.starts_with(b"MOCK-MP3:"));
    post_bytes(
        &me,
        address,
        &format!("/api/v1/english/messages/{tutor}/speech"),
    )
    .await;
    post_bytes(
        &me,
        address,
        &format!("/api/v1/english/messages/{greeting}/speech"),
    )
    .await;
    assert_eq!(voice.tts_calls(), 2);

    // Модель отказала после распознавания — распознанное возвращается.
    let failed = me
        .post_json(
            address,
            "/api/v1/english/turn",
            json!({"key": Uuid::now_v7(), "audio_base64": audio, "mime": "audio/webm", "duration_ms": 2000}),
        )
        .await;
    assert_eq!(failed.status, 409, "{:?}", failed.body);
    assert_eq!(failed.body["error"], "provider_refused");
    assert_eq!(failed.body["heard"], "Yesterday I went home");

    // Ни текста, ни записи — или оба — неверный запрос.
    let bad = me
        .post_json(
            address,
            "/api/v1/english/turn",
            json!({"key": Uuid::now_v7()}),
        )
        .await;
    assert_eq!(bad.status, 400);

    let screen = me.get(address, "/api/v1/english").await;
    assert_eq!(screen.body["messages"].as_array().unwrap().len(), 3);
    assert_eq!(screen.body["messages"][2]["has_speech"], true);

    let done = me.post(address, "/api/v1/english/session/finish").await;
    assert_eq!(done.status, 200, "{:?}", done.body);
    assert!(done.body["session"]["memory_action"].is_string());
    let files = me.get(address, "/api/v1/agent/files").await;
    assert!(
        files.body["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|f| f["path"] == "Английский.md"),
        "итог — в папке агента"
    );

    // Чужой без агента — 403.
    qubite_auth::accounts::create(
        pool,
        &Passwords::default(),
        qubite_auth::accounts::NewAccount {
            email: "student@qubite.ru",
            display_name: "",
            password: "пароль ученика",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut other = Browser::default();
    other
        .login(address, "student@qubite.ru", "пароль ученика")
        .await;
    assert_eq!(other.get(address, "/api/v1/english").await.status, 403);
    let (status, _, _) = post_bytes(
        &other,
        address,
        &format!("/api/v1/english/messages/{tutor}/speech"),
    )
    .await;
    assert_eq!(status, 403);

    db.close().await;
    test_db.drop_db().await;
}

/// Разговор потоком по WebSocket: текст — ответ кусками и голос PCM кадрами,
/// потом записанный ход и замеры; чужой сайт — отказ.
#[tokio::test]
async fn english_live_over_websocket() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::{Message, client::IntoClientRequest, http::HeaderValue};

    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = qubite_auth::owner::create(pool, &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap()
        .id;
    let chunks = [
        "{\"say\": \"",
        "\\\"He go\\\"? No. ",
        "He goes. Say it again.\", ",
        "\"verdict\": \"mistake\", \"mistakes\": [{\"wrong\": \"He go\", \"right\": \"He goes\", \"why\": \"he → goes\"}], \"repeat\": \"He goes home.\"}",
    ]
    .map(String::from)
    .to_vec();
    let (gateway, _voice) = gateway(
        pool,
        owner,
        vec![MockStep::Stream {
            chunks,
            delay_ms: 30,
            tokens_in: 100,
            tokens_out: 40,
        }],
        vec![],
    )
    .await;
    let address =
        serve(AppState::with_auth(db.clone(), AuthSettings::default()).with_ai(Arc::new(gateway)))
            .await;
    let mut me = Browser::default();
    assert_eq!(me.login(address, EMAIL, PASSWORD).await.status, 200);

    let connect = |origin: &str| {
        let mut request = format!("ws://{address}/api/v1/english/live")
            .into_client_request()
            .unwrap();
        request.headers_mut().insert(
            "cookie",
            HeaderValue::from_str(&format!(
                "qubite_session={}",
                me.session.as_deref().unwrap()
            ))
            .unwrap(),
        );
        request
            .headers_mut()
            .insert("origin", HeaderValue::from_str(origin).unwrap());
        tokio_tungstenite::connect_async(request)
    };
    assert!(
        connect("https://evil.example").await.is_err(),
        "с чужого сайта — нельзя"
    );
    let (mut socket, _) = connect(&format!("http://{address}")).await.unwrap();
    socket
        .send(Message::text(r#"{"type":"text","text":"He go home"}"#))
        .await
        .unwrap();
    let mut said = String::new();
    let mut audio = 0;
    let mut metrics = None;
    let turn = loop {
        let frame = tokio::time::timeout(std::time::Duration::from_secs(10), socket.next())
            .await
            .expect("ответ за 10 с")
            .unwrap()
            .unwrap();
        match frame {
            Message::Binary(pcm) => {
                assert!(!said.is_empty(), "голос — после первых слов");
                audio += pcm.len();
            }
            Message::Text(text) => {
                let json: Value = serde_json::from_str(text.as_str()).unwrap();
                match json["type"].as_str().unwrap() {
                    "say" => said.push_str(json["text"].as_str().unwrap()),
                    "metrics" => metrics = Some(json),
                    "reply" => break json["turn"].clone(),
                    "error" => panic!("{json}"),
                    _ => {}
                }
            }
            _ => {}
        }
    };
    assert_eq!(said, "\"He go\"? No. He goes. Say it again.");
    assert!(audio > 0, "голос пришёл кадрами");
    let metrics = metrics.expect("замеры до хода");
    assert!(metrics["first_audio_ms"].as_u64().unwrap() <= metrics["reply_ms"].as_u64().unwrap());
    assert_eq!(turn["tutor"]["verdict"], "mistake");
    assert_eq!(turn["tutor"]["mistakes"][0]["right"], "He goes");
    assert_eq!(turn["learner"]["via"], "text");
    assert!(turn["tutor"]["latency"]["first_audio_ms"].is_u64());

    let screen = me.get(address, "/api/v1/english").await;
    assert_eq!(screen.body["voice"]["live"], true);
    db.close().await;
    test_db.drop_db().await;
}

/// Уроки (ENG-002) по HTTP: тест уровня → урок → ответ голосом → итог с
/// огоньком; настройки; без входа — 401.
#[tokio::test]
async fn english_lesson_over_http() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = qubite_auth::owner::create(pool, &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap()
        .id;
    let (gateway, _voice) = gateway(
        pool,
        owner,
        vec![],
        vec![MockHeard::Text {
            text: "nice to meet you".into(),
            seconds: 1.5,
        }],
    )
    .await;
    let address =
        serve(AppState::with_auth(db.clone(), AuthSettings::default()).with_ai(Arc::new(gateway)))
            .await;
    let mut guest = Browser::default();
    assert_eq!(guest.get(address, "/api/v1/english/home").await.status, 401);
    let mut me = Browser::default();
    assert_eq!(me.login(address, EMAIL, PASSWORD).await.status, 200);

    let test = me.get(address, "/api/v1/english/placement").await;
    assert_eq!(test.status, 200);
    assert_eq!(test.body["stages"].as_array().unwrap().len(), 5);
    let placed = me
        .post_json(
            address,
            "/api/v1/english/placement",
            json!({"answers": {}, "shift": 0}),
        )
        .await;
    assert_eq!(placed.status, 200, "{:?}", placed.body);
    assert_eq!(placed.body["start_lesson"], "a0-m1-l1");

    let lesson = me.get(address, "/api/v1/english/lessons/a0-m1-l1").await;
    assert_eq!(lesson.status, 200, "{:?}", lesson.body);
    assert_eq!(lesson.body["lesson"]["id"], "a0-m1-l1");
    assert_eq!(
        me.get(address, "/api/v1/english/lessons/b1-m1-l1")
            .await
            .status,
        404,
        "B1 — планом"
    );

    let run = me
        .post_json(
            address,
            "/api/v1/english/lessons/a0-m1-l1/start",
            json!({"kind": "lesson"}),
        )
        .await;
    assert_eq!(run.status, 200, "{:?}", run.body);
    let run = run.body["id"].as_str().unwrap().to_owned();
    let audio = base64::engine::general_purpose::STANDARD.encode(b"OPUS-FAKE");
    let said = me
        .post_json(
            address,
            &format!("/api/v1/english/runs/{run}/answer"),
            json!({"key": Uuid::now_v7(), "task_id": "t7", "audio_base64": audio, "mime": "audio/webm", "duration_ms": 1500}),
        )
        .await;
    assert_eq!(said.status, 200, "{:?}", said.body);
    assert_eq!(said.body["correct"], true);
    assert_eq!(said.body["heard"], "nice to meet you");
    let finished = me
        .post(address, &format!("/api/v1/english/runs/{run}/finish"))
        .await;
    assert_eq!(finished.status, 200, "{:?}", finished.body);
    assert_eq!(finished.body["passed"], false, "одно задание из десяти");

    let settings = me
        .patch_json(
            address,
            "/api/v1/english/settings",
            json!({"goal_minutes": 20, "strictness": 1}),
        )
        .await;
    assert_eq!(settings.status, 200, "{:?}", settings.body);
    assert_eq!(settings.body["settings"]["goal_minutes"], 20);
    assert!(settings.body["voices"].as_array().unwrap().len() >= 5);
    let home = me.get(address, "/api/v1/english/home").await;
    assert_eq!(home.status, 200);
    assert_eq!(home.body["game"]["goal_minutes"], 20);
    assert_eq!(home.body["next"], "a0-m1-l1");
    test_db.drop_db().await;
}

/// Живой голос через подписку ChatGPT (ENG-005): настройка, ключ сеанса,
/// расшифровка в историю, конец. OpenAI — подделка.
#[tokio::test]
async fn english_realtime_over_http() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let owner = qubite_auth::owner::create(pool, &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap()
        .id;
    catalog::ensure_provider(pool, "chatgpt", "chatgpt", "", true)
        .await
        .unwrap();
    let provider = Arc::new(qubite_ai::MockRealtime::new());
    let gateway =
        Gateway::new(pool.clone(), AiConfig::default()).with_realtime("chatgpt", provider);
    let address =
        serve(AppState::with_auth(db.clone(), AuthSettings::default()).with_ai(Arc::new(gateway)))
            .await;
    let mut me = Browser::default();
    assert_eq!(me.login(address, EMAIL, PASSWORD).await.status, 200);

    // Подписки нет: голос — ElevenLabs, живой разговор — понятный отказ.
    let screen = me.get(address, "/api/v1/english").await;
    assert_eq!(screen.status, 200, "{:?}", screen.body);
    assert_eq!(screen.body["engine"]["engine"], "elevenlabs");
    assert_eq!(screen.body["engine"]["chatgpt_connected"], false);
    let refused = me
        .post_json(
            address,
            "/api/v1/english/realtime",
            json!({"key": Uuid::now_v7()}),
        )
        .await;
    assert_eq!(refused.status, 409, "{:?}", refused.body);
    assert_eq!(refused.body["error"], "chatgpt_not_connected");

    sqlx::query(
        "INSERT INTO ai_chatgpt_tokens (account_id, access_token_enc, refresh_token_enc) \
         VALUES ($1, 'a', 'r')",
    )
    .bind(owner)
    .execute(pool)
    .await
    .unwrap();
    let settings = me.get(address, "/api/v1/english/settings").await;
    assert_eq!(settings.body["engine"]["engine"], "chatgpt");
    assert!(settings.body["realtime_models"].as_array().unwrap().len() >= 2);
    let changed = me
        .patch_json(
            address,
            "/api/v1/english/settings",
            json!({"realtime_voice": "cedar"}),
        )
        .await;
    assert_eq!(changed.status, 200, "{:?}", changed.body);
    assert_eq!(changed.body["settings"]["realtime_voice"], "cedar");

    let started = me
        .post_json(
            address,
            "/api/v1/english/realtime",
            json!({"key": Uuid::now_v7()}),
        )
        .await;
    assert_eq!(started.status, 200, "{:?}", started.body);
    let rt = &started.body["realtime"];
    assert_eq!(rt["client_secret"], "ek_test_1");
    assert_eq!(rt["voice"], "cedar");
    assert_eq!(rt["external_model"], "gpt-realtime-1.5");
    assert!(
        rt["calls_url"]
            .as_str()
            .unwrap()
            .ends_with("/realtime/calls")
    );
    let id = rt["id"].as_str().unwrap().to_owned();

    let saved = me
        .post_json(
            address,
            &format!("/api/v1/english/realtime/{id}/lines"),
            json!({"lines": [
                {"item": "i1", "role": "tutor", "text": "What's up?"},
                {"item": "i2", "role": "learner", "text": "I is fine"}
            ]}),
        )
        .await;
    assert_eq!(saved.status, 200, "{:?}", saved.body);
    assert_eq!(saved.body["messages"].as_array().unwrap().len(), 2);
    assert_eq!(saved.body["session"]["turns"], 1);

    let finished = me
        .post_json(
            address,
            &format!("/api/v1/english/realtime/{id}/finish"),
            json!({"seconds": 1, "end": true}),
        )
        .await;
    assert_eq!(finished.status, 200, "{:?}", finished.body);
    assert_eq!(finished.body["seconds"], 1);
    assert!(finished.body["session"]["finished_at"].is_string());
    let screen = me.get(address, "/api/v1/english").await;
    assert_eq!(screen.body["last"]["turns"], 1, "разговор в истории");
    assert_eq!(screen.body["engine"]["sessions_today"], 1);
    db.close().await;
    test_db.drop_db().await;
}
