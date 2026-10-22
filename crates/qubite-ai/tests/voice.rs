//! Голосовой слой шлюза (ENG-001): распознавание и речь — с грантом,
//! резервом и списанием, как у моделей; адаптер ElevenLabs — на поддельном
//! сервере. Настоящих платных вызовов нет.

use std::{sync::Arc, time::Duration};

use qubite_ai::{
    AiConfig, AiError, AiRequest, Gateway, ListenRequest, MockHeard, MockProvider, MockStep,
    MockVoice, SpeakRequest,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
    catalog,
    elevenlabs::{self, ElevenLabs, ElevenLabsConfig},
    voice::{self, MAX_SECONDS},
};
use qubite_db::Database;
use qubite_kernel::Secret;
use qubite_policy::{Authorized, Flags, ModuleId, ModulePatch, OwnerConsole, Subject, UseAi};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp},
};
use uuid::Uuid;

const STT_MODEL: &str = "elevenlabs/scribe_v1";
const TTS_MODEL: &str = "elevenlabs/eleven_flash_v2_5";

struct Env {
    test_db: TestDb,
    db: Database,
    owner: OwnerConsole,
    docs: ModuleId,
}

impl Env {
    async fn new() -> Self {
        let (test_db, db) = TestDb::migrated().await;
        let owner = qubite_auth::owner::create(
            db.pool(),
            &qubite_auth::Passwords::default(),
            "owner@qubite.ru",
            "",
            "пароль владельца",
        )
        .await
        .unwrap();
        let owner = qubite_policy::decide_owner(db.pool(), &Subject::account(owner.id, None))
            .await
            .unwrap();
        let docs = ModuleId::new("docs").unwrap();
        qubite_policy::catalog::update(
            db.pool(),
            &owner,
            &docs,
            ModulePatch {
                installed: Some(true),
                readiness: Some("stable".into()),
                ..ModulePatch::default()
            },
        )
        .await
        .unwrap();
        // Голосовые модели и провайдер — из миграции; провайдер включает запуск с ключом.
        catalog::ensure_provider(
            db.pool(),
            elevenlabs::PROVIDER_ID,
            "elevenlabs",
            elevenlabs::DEFAULT_BASE_URL,
            true,
        )
        .await
        .unwrap();
        Self {
            test_db,
            db,
            owner,
            docs,
        }
    }

    async fn user(&self, email: &str, ai: bool) -> Uuid {
        let id = Uuid::now_v7();
        sqlx::query(
            "INSERT INTO accounts (id, email, email_verified_at, status) VALUES ($1, $2, now(), 'active')",
        )
        .bind(id)
        .bind(email)
        .execute(self.db.pool())
        .await
        .unwrap();
        let flags = Flags {
            read: true,
            ai,
            ..Flags::NONE
        };
        qubite_policy::grants::set(self.db.pool(), &self.owner, id, &self.docs, flags, None)
            .await
            .unwrap();
        id
    }

    async fn auth(&self, account: Uuid) -> Authorized<UseAi> {
        qubite_policy::decide::<UseAi>(self.db.pool(), &Subject::account(account, None), &self.docs)
            .await
            .unwrap()
    }

    async fn budget(&self, account: Uuid, usd: i64) -> Uuid {
        admin::set_limit(
            self.db.pool(),
            &self.owner,
            &LimitScope::User(account),
            Period::Day,
            Metric::Usd,
            usd,
        )
        .await
        .unwrap()
    }

    fn gateway(&self, voice: Arc<dyn qubite_ai::VoiceProvider>) -> Gateway {
        Gateway::new(self.db.pool().clone(), AiConfig::default())
            .with_voice(elevenlabs::PROVIDER_ID, voice)
    }

    async fn spent(&self, limit: Uuid) -> (i64, i64) {
        sqlx::query_as(
            "SELECT coalesce(sum(reserved), 0)::bigint, coalesce(sum(spent), 0)::bigint \
             FROM ai_usage_counters WHERE limit_id = $1",
        )
        .bind(limit)
        .fetch_one(self.db.pool())
        .await
        .unwrap()
    }

    async fn close(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

fn listen(id: &str, duration_ms: u64) -> ListenRequest {
    ListenRequest {
        request_id: id.into(),
        model: STT_MODEL.into(),
        audio: b"OPUS-FAKE".to_vec(),
        mime: "audio/webm;codecs=opus".into(),
        language: None,
        duration_ms,
    }
}

fn say(id: &str, text: &str) -> SpeakRequest {
    SpeakRequest {
        request_id: id.into(),
        model: TTS_MODEL.into(),
        voice: elevenlabs::DEFAULT_VOICE.into(),
        text: text.into(),
    }
}

#[tokio::test]
async fn voice_is_charged_like_models() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    let limit = env.budget(me, 1_000_000).await;
    let mock = Arc::new(MockVoice::new().script([MockHeard::Text {
        text: "  I goed to school  ".into(),
        seconds: 4.2,
    }]));
    let gateway = env.gateway(mock.clone());
    assert!(gateway.voice_ready(voice::STT).await.unwrap());
    assert!(gateway.voice_ready(voice::TTS).await.unwrap());
    let auth = env.auth(me).await;

    let heard = gateway
        .transcribe(&auth, listen("stt-1", 3_000))
        .await
        .unwrap();
    assert_eq!(heard.text, "I goed to school");
    assert_eq!(heard.seconds, 5, "списано по длине от провайдера, вверх");
    // 5 с по $111,12 за миллион секунд = 556 микродолларов (вверх).
    assert_eq!(heard.cost_usd, 556);

    let spoken = gateway
        .speak(&auth, say("tts-1", "Say it again."))
        .await
        .unwrap();
    assert_eq!(spoken.audio, b"MOCK-MP3:Say it again.");
    assert_eq!(spoken.mime, "audio/mpeg");
    // 13 знаков по $100 за миллион = 1300 микродолларов.
    assert_eq!(spoken.cost_usd, 1300);
    assert_eq!(mock.last_speech().unwrap().voice, elevenlabs::DEFAULT_VOICE);
    assert_eq!(
        env.spent(limit).await,
        (0, 556 + 1300),
        "резерв отпущен, списан факт"
    );

    // Повтор того же действия не платится дважды.
    let again = gateway.transcribe(&auth, listen("stt-1", 3_000)).await;
    assert!(matches!(again, Err(AiError::DuplicateRequest { .. })));
    assert_eq!(mock.stt_calls(), 1);

    let calls: Vec<(String, String, i64)> =
        sqlx::query_as("SELECT model_id, status, tokens_in FROM ai_calls ORDER BY created_at")
            .fetch_all(env.db.pool())
            .await
            .unwrap();
    assert_eq!(
        calls,
        vec![
            (STT_MODEL.into(), "succeeded".into(), 5),
            (TTS_MODEL.into(), "succeeded".into(), 13),
        ],
        "голос — в том же журнале расходов"
    );
    env.close().await;
}

#[tokio::test]
async fn no_grant_or_budget_means_no_call() {
    let env = Env::new().await;
    let mock = Arc::new(MockVoice::new());
    let gateway = env.gateway(mock.clone());

    // Без гранта `ai` до шлюза даже не дойти.
    let plain = env.user("plain@qubite.ru", false).await;
    assert!(
        qubite_policy::decide::<UseAi>(env.db.pool(), &Subject::account(plain, None), &env.docs)
            .await
            .is_err()
    );

    // Грант есть, бюджета нет — отказ до провайдера.
    let me = env.user("me@qubite.ru", true).await;
    let auth = env.auth(me).await;
    let error = gateway
        .transcribe(&auth, listen("stt-x", 1_000))
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::BudgetNotSet), "{error}");
    let error = gateway
        .speak(&auth, say("tts-x", "Hello"))
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::BudgetNotSet), "{error}");

    // Бюджет меньше худшей стоимости записи (120 с ≈ $0,0134) — тоже отказ.
    env.budget(me, 10_000).await;
    let error = gateway
        .transcribe(&auth, listen("stt-y", 1_000))
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::BudgetExhausted { .. }), "{error}");
    assert_eq!(
        mock.stt_calls() + mock.tts_calls(),
        0,
        "к провайдеру ничего не ушло"
    );
    env.close().await;
}

#[tokio::test]
async fn voice_and_text_models_do_not_mix() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    env.budget(me, 1_000_000).await;
    let pool = env.db.pool();
    admin::upsert_provider(
        pool,
        &env.owner,
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
        &env.owner,
        ModelSpec {
            id: "mock-text",
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
    let text = Arc::new(MockProvider::new(MockStep::Succeed {
        tokens_in: 1,
        tokens_out: 1,
    }));
    let voice = Arc::new(MockVoice::new());
    let gateway = env
        .gateway(voice.clone())
        .with_provider("mock", text.clone());
    let auth = env.auth(me).await;

    let error = gateway
        .transcribe(
            &auth,
            ListenRequest {
                model: "mock-text".into(),
                ..listen("stt-text", 1_000)
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::ModelNotAllowed), "{error}");
    let error = gateway
        .complete(
            &auth,
            AiRequest {
                request_id: "chat-voice".into(),
                model: STT_MODEL.into(),
                prompt: "Скажи привет".into(),
                untrusted: vec![],
                input_tokens: 0,
                max_output_tokens: 10,
                job_id: None,
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::ModelNotAllowed), "{error}");
    let error = gateway
        .speak(
            &auth,
            SpeakRequest {
                model: STT_MODEL.into(),
                ..say("tts-stt", "Hello")
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::ModelNotAllowed), "{error}");
    assert_eq!(text.calls() + voice.stt_calls() + voice.tts_calls(), 0);

    // Слишком длинная запись и неизвестный формат — отказ без вызова.
    let error = gateway
        .transcribe(&auth, listen("stt-long", (MAX_SECONDS + 1) * 1000))
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::Invalid(_)), "{error}");
    let error = gateway
        .transcribe(
            &auth,
            ListenRequest {
                mime: "text/plain".into(),
                ..listen("stt-mime", 1_000)
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(error, AiError::Invalid(_)), "{error}");
    env.close().await;
}

#[tokio::test]
async fn voice_not_ready_without_provider() {
    let env = Env::new().await;
    let gateway = Gateway::new(env.db.pool().clone(), AiConfig::default());
    assert!(!gateway.voice_ready(voice::STT).await.unwrap());
    // Провайдер выключен (нет ключа) — тоже не готов, даже с адаптером.
    catalog::ensure_provider(
        env.db.pool(),
        elevenlabs::PROVIDER_ID,
        "elevenlabs",
        elevenlabs::DEFAULT_BASE_URL,
        false,
    )
    .await
    .unwrap();
    let gateway = env.gateway(Arc::new(MockVoice::new()));
    assert!(!gateway.voice_ready(voice::TTS).await.unwrap());
    env.close().await;
}

// ---------------------------------------------------------------- ElevenLabs

fn adapter(base_url: String) -> Arc<ElevenLabs> {
    adapter_via(base_url, None)
}

fn adapter_via(base_url: String, proxy: Option<String>) -> Arc<ElevenLabs> {
    Arc::new(
        ElevenLabs::new(ElevenLabsConfig {
            base_url,
            connect_timeout: Duration::from_secs(2),
            proxy,
            ..ElevenLabsConfig::new(Secret::new("xi-test-key-not-real"))
        })
        .unwrap(),
    )
}

#[tokio::test]
async fn elevenlabs_adapter_on_fake_server() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    let limit = env.budget(me, 1_000_000).await;
    let server = FakeHttp::start(
        [
            Action::Respond(
                200,
                r#"{"language_code":"en","language_probability":0.98,"text":"He go to school.","words":[{"text":"He","start":0.1,"end":0.3,"type":"word"},{"text":"school.","start":1.2,"end":2.6,"type":"word"}]}"#.into(),
            ),
            Action::Reply(
                200,
                vec![("content-type", "audio/mpeg".into())],
                "ID3-FAKE-MP3".into(),
            ),
            Action::Respond(
                401,
                r#"{"detail":{"status":"quota_exceeded","message":"This request exceeds your quota."}}"#
                    .into(),
            ),
        ],
        Action::Respond(500, "{}".into()),
    )
    .await;
    let gateway = env.gateway(adapter(server.root_url()));
    let auth = env.auth(me).await;

    let heard = gateway
        .transcribe(&auth, listen("el-stt", 2_000))
        .await
        .unwrap();
    assert_eq!(heard.text, "He go to school.");
    assert_eq!(heard.language.as_deref(), Some("en"));
    assert_eq!(heard.seconds, 3);

    let spoken = gateway.speak(&auth, say("el-tts", "Wrong.")).await.unwrap();
    assert_eq!(spoken.audio, b"ID3-FAKE-MP3");

    // Кончились символы — отказ без повтора, резерв вернулся.
    let error = gateway
        .speak(&auth, say("el-tts-2", "Again."))
        .await
        .unwrap_err();
    match error {
        AiError::ProviderRefused { reason, .. } => assert!(reason.contains("quota_exceeded")),
        other => panic!("{other}"),
    }
    let (reserved, _) = env.spent(limit).await;
    assert_eq!(reserved, 0);

    let received = server.received();
    assert_eq!(received.len(), 3);
    assert_eq!(received[0].line, "POST /v1/speech-to-text HTTP/1.1");
    assert_eq!(
        received[0].header("xi-api-key"),
        Some("xi-test-key-not-real")
    );
    assert!(
        received[0]
            .header("content-type")
            .unwrap()
            .starts_with("multipart/form-data; boundary=")
    );
    assert!(received[0].body.contains("scribe_v1"));
    assert!(received[0].body.contains("OPUS-FAKE"));
    assert!(
        received[1].line.starts_with(&format!(
            "POST /v1/text-to-speech/{}?output_format=mp3_44100_64",
            elevenlabs::DEFAULT_VOICE
        )),
        "{}",
        received[1].line
    );
    assert!(received[1].body.contains("eleven_flash_v2_5"));
    env.close().await;
}

#[tokio::test]
async fn elevenlabs_unreachable_is_not_sent() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    let limit = env.budget(me, 1_000_000).await;
    let url = qubite_testkit::fake_http::closed_port_url().await;
    let gateway = Gateway::new(env.db.pool().clone(), AiConfig::default().with_attempts(1))
        .with_voice(elevenlabs::PROVIDER_ID, adapter(url));
    let auth = env.auth(me).await;
    let error = gateway
        .transcribe(&auth, listen("el-down", 1_000))
        .await
        .unwrap_err();
    assert!(
        matches!(error, AiError::ProviderUnavailable { .. }),
        "{error}"
    );
    assert_eq!(env.spent(limit).await, (0, 0), "не ушло — не стоило денег");
    env.close().await;
}

// ---------------------------------------------------------------- потоком (ENG-001)

#[tokio::test]
async fn speech_stream_and_live_listening_are_charged() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    let limit = env.budget(me, 1_000_000).await;
    let mock = Arc::new(MockVoice::new().script([MockHeard::Text {
        text: "I goed home".into(),
        seconds: 1.0,
    }]));
    let gateway = env.gateway(mock.clone());
    assert!(gateway.voice_ready(voice::STT_LIVE).await.unwrap());
    let auth = env.auth(me).await;

    // Речь потоком: куски по мере синтеза, списание по знакам — сразу.
    let mut stream = gateway
        .speak_stream(&auth, say("tts-stream", "Wrong."))
        .await
        .unwrap();
    assert_eq!(stream.mime, voice::STREAM_MIME);
    assert_eq!(stream.cost_usd, 600, "6 знаков по $100 за миллион");
    let mut parts = 0;
    while let Some(chunk) = stream.chunks.recv().await {
        assert!(chunk.unwrap().ends_with(b"Wrong.|"));
        parts += 1;
    }
    assert_eq!(parts, 3);

    // Живое распознавание: резерв до соединения, списание по секундам звука.
    let mut listen = gateway
        .listen_live(
            &auth,
            voice::LiveRequest {
                request_id: "live-1".into(),
                model: "elevenlabs/scribe_v2_realtime".into(),
                language: None,
                sample_rate: 16_000,
                silence_secs: 0.5,
            },
        )
        .await
        .unwrap();
    let (reserved, _) = env.spent(limit).await;
    assert!(reserved > 0, "резерв на 120 с до первого звука");
    listen.send(vec![9u8; 40_000]).await.unwrap(); // 1,25 с
    listen.commit().await;
    let mut events = Vec::new();
    while let Some(event) = listen.next().await {
        let done = matches!(event, voice::LiveOut::Committed(_));
        events.push(event);
        if done {
            break;
        }
    }
    assert_eq!(
        events.last(),
        Some(&voice::LiveOut::Committed("I goed home".into()))
    );
    assert!(matches!(events[0], voice::LiveOut::Partial(_)));
    let (_, seconds, cost) = listen.finish().await.unwrap();
    assert_eq!(seconds, 2, "1,25 с — вверх до 2");
    // 2 с по $166,67 за миллион секунд = 334 микродоллара (вверх).
    assert_eq!(cost, 334);
    assert_eq!(
        env.spent(limit).await,
        (0, 600 + 334),
        "резерв отпущен, списан факт"
    );

    // Длиннее резерва — отказ, звук не уходит.
    let mut long = gateway
        .listen_live(
            &auth,
            voice::LiveRequest {
                request_id: "live-2".into(),
                model: "elevenlabs/scribe_v2_realtime".into(),
                language: None,
                sample_rate: 16_000,
                silence_secs: 0.5,
            },
        )
        .await
        .unwrap();
    let error = long.send(vec![1u8; 16_000 * 2 * 121]).await.unwrap_err();
    assert!(matches!(error, AiError::Invalid(_)), "{error}");
    long.finish().await.unwrap();
    env.close().await;
}

// Обратный вызов рукопожатия tungstenite возвращает большой `Err` — это их тип.
#[allow(clippy::result_large_err)]
#[tokio::test]
async fn elevenlabs_live_protocol_on_fake_websocket() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::{
        Message,
        handshake::server::{Request, Response},
    };

    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    env.budget(me, 1_000_000).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let (seen_tx, mut seen_rx) = tokio::sync::mpsc::unbounded_channel::<String>();
    tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let seen = seen_tx.clone();
        let mut socket = tokio_tungstenite::accept_hdr_async(
            tcp,
            move |request: &Request, response: Response| {
                let _ = seen.send(format!(
                    "{} key={}",
                    request.uri(),
                    request
                        .headers()
                        .get("xi-api-key")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                ));
                Ok(response)
            },
        )
        .await
        .unwrap();
        socket
            .send(Message::text(
                r#"{"message_type":"session_started","session_id":"s1"}"#,
            ))
            .await
            .unwrap();
        while let Some(Ok(Message::Text(text))) = socket.next().await {
            let _ = seen_tx.send(text.to_string());
            let json: serde_json::Value = serde_json::from_str(text.as_str()).unwrap();
            if json["commit"] == true {
                socket
                    .send(Message::text(
                        r#"{"message_type":"committed_transcript","text":"He go home."}"#,
                    ))
                    .await
                    .unwrap();
            } else {
                socket
                    .send(Message::text(
                        r#"{"message_type":"partial_transcript","text":"He go"}"#,
                    ))
                    .await
                    .unwrap();
            }
        }
    });
    let gateway = env.gateway(adapter(format!("http://{address}")));
    let auth = env.auth(me).await;
    let mut listen = gateway
        .listen_live(
            &auth,
            voice::LiveRequest {
                request_id: "el-live".into(),
                model: "elevenlabs/scribe_v2_realtime".into(),
                language: Some("en".into()),
                sample_rate: 16_000,
                silence_secs: 0.5,
            },
        )
        .await
        .unwrap();
    listen.send(vec![1, 2, 3, 4]).await.unwrap();
    assert_eq!(
        listen.next().await,
        Some(voice::LiveOut::Partial("He go".into()))
    );
    listen.commit().await;
    assert_eq!(
        listen.next().await,
        Some(voice::LiveOut::Committed("He go home.".into()))
    );
    listen.finish().await.unwrap();

    let handshake = seen_rx.recv().await.unwrap();
    assert!(
        handshake.starts_with("/v1/speech-to-text/realtime?model_id=scribe_v2_realtime&audio_format=pcm_16000&commit_strategy=vad&vad_silence_threshold_secs=0.50&language_code=en"),
        "{handshake}"
    );
    assert!(handshake.ends_with("key=xi-test-key-not-real"));
    let audio: serde_json::Value = serde_json::from_str(&seen_rx.recv().await.unwrap()).unwrap();
    assert_eq!(audio["message_type"], "input_audio_chunk");
    assert_eq!(audio["audio_base_64"], "AQIDBA==");
    assert_eq!(audio["commit"], false);
    assert_eq!(audio["sample_rate"], 16_000);
    let commit: serde_json::Value = serde_json::from_str(&seen_rx.recv().await.unwrap()).unwrap();
    assert_eq!(commit["commit"], true);
    env.close().await;
}

#[tokio::test]
async fn elevenlabs_speech_stream_on_fake_server() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    env.budget(me, 1_000_000).await;
    // Нечётное число байт: последний ждёт пары и в поток не уходит.
    let server = FakeHttp::start(
        [Action::Reply(
            200,
            vec![("content-type", "application/octet-stream".into())],
            "ABCDE".into(),
        )],
        Action::Respond(500, "{}".into()),
    )
    .await;
    let gateway = env.gateway(adapter(server.root_url()));
    let auth = env.auth(me).await;
    let mut stream = gateway
        .speak_stream(&auth, say("el-stream", "Again."))
        .await
        .unwrap();
    let mut audio = Vec::new();
    while let Some(chunk) = stream.chunks.recv().await {
        audio.extend(chunk.unwrap());
    }
    assert_eq!(audio, b"ABCD", "куски — целыми отсчётами по 2 байта");
    let line = &server.received()[0].line;
    assert!(
        line.starts_with(&format!(
            "POST /v1/text-to-speech/{}/stream?output_format=pcm_24000",
            elevenlabs::DEFAULT_VOICE
        )),
        "{line}"
    );
    env.close().await;
}

// ---------------------------------------------------------------- сеть (баг владельца 22.10, D-515)

/// Из закрытой страны ElevenLabs отвечает 302: по редиректу не идём (иначе
/// HTML-страница играла бы как шипение), отказ — с адресом и подсказкой, без
/// повторов и без «другую модель: []». HTML вместо звука — тоже отказ.
#[tokio::test]
async fn elevenlabs_redirect_and_html_are_clear_refusals() {
    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    let limit = env.budget(me, 1_000_000).await;
    let server = FakeHttp::start(
        [
            Action::Reply(
                302,
                vec![("location", "https://elevenlabs.io/blocked?from=ru".into())],
                String::new(),
            ),
            Action::Reply(
                200,
                vec![("content-type", "text/html; charset=utf-8".into())],
                "<html>blocked</html>".into(),
            ),
            // Так отвечает ElevenLabs из России (проверено владельцем curl-ом).
            Action::Reply(
                302,
                vec![(
                    "location",
                    "https://help.elevenlabs.io/hc/en-us/articles/22497891312401-Do-you-restrict-access-for-any-specific-countries".into(),
                )],
                String::new(),
            ),
        ],
        Action::Respond(500, "{}".into()),
    )
    .await;
    let gateway = env.gateway(adapter(server.root_url()));
    let auth = env.auth(me).await;

    let error = gateway
        .speak(&auth, say("el-302", "Hello."))
        .await
        .unwrap_err();
    let text = error.to_string();
    assert!(matches!(error, AiError::ProviderRefused { .. }), "{text}");
    assert!(
        text.contains("HTTP 302 → https://elevenlabs.io/blocked"),
        "{text}"
    );
    assert!(!text.contains("from=ru"), "адрес без параметров: {text}");
    assert!(text.contains("QUBITE_PROXY"), "{text}");
    assert!(
        !text.contains("другую модель"),
        "пустой список не показываем: {text}"
    );
    assert_eq!(
        server.received().len(),
        1,
        "по редиректу не пошли, не повторяли"
    );

    let error = gateway
        .speak_stream(&auth, say("el-html", "Hello."))
        .await
        .err()
        .unwrap();
    assert!(error.to_string().contains("«text/html»"), "{error}");
    assert_eq!(server.received().len(), 2);

    let error = gateway
        .speak(&auth, say("el-country", "Hi."))
        .await
        .unwrap_err();
    let text = error.to_string();
    assert!(
        text.contains("ElevenLabs закрыт для твоей страны"),
        "{text}"
    );
    assert!(text.contains("QUBITE_PROXY"), "{text}");
    assert_eq!(server.received().len(), 3);
    assert_eq!(env.spent(limit).await, (0, 0), "отказ — резерв вернулся");
    env.close().await;
}

/// HTTP-прокси, который соединяет с `target` и запоминает строку CONNECT.
async fn connect_proxy(
    target: std::net::SocketAddr,
) -> (u16, tokio::sync::mpsc::UnboundedReceiver<String>) {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let tx = tx.clone();
            tokio::spawn(async move {
                let mut head = Vec::new();
                while !head.ends_with(b"\r\n\r\n") {
                    let mut b = [0u8; 1];
                    socket.read_exact(&mut b).await.unwrap();
                    head.push(b[0]);
                }
                let _ = tx.send(
                    String::from_utf8_lossy(&head)
                        .lines()
                        .next()
                        .unwrap_or_default()
                        .to_owned(),
                );
                socket.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await.unwrap();
                let mut upstream = tokio::net::TcpStream::connect(target).await.unwrap();
                let _ = tokio::io::copy_bidirectional(&mut socket, &mut upstream).await;
            });
        }
    });
    (port, rx)
}

/// Живое распознавание идёт через прокси (QUBITE_PROXY / QUBITE_ELEVENLABS_PROXY);
/// 302 на WebSocket — тот же понятный отказ с адресом.
#[tokio::test]
async fn elevenlabs_live_goes_through_proxy_and_redirect_is_explained() {
    use futures_util::SinkExt;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_tungstenite::tungstenite::Message;

    let env = Env::new().await;
    let me = env.user("me@qubite.ru", true).await;
    env.budget(me, 1_000_000).await;
    let auth = env.auth(me).await;
    let live = |id: &str| voice::LiveRequest {
        request_id: id.into(),
        model: "elevenlabs/scribe_v2_realtime".into(),
        language: None,
        sample_rate: 16_000,
        silence_secs: 0.5,
    };

    // Распознавание за прокси: хост elevenlabs.test знает только прокси.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (tcp, _) = listener.accept().await.unwrap();
        let mut socket = tokio_tungstenite::accept_async(tcp).await.unwrap();
        socket
            .send(Message::text(
                r#"{"message_type":"partial_transcript","text":"Hi"}"#,
            ))
            .await
            .unwrap();
        std::future::pending::<()>().await;
    });
    let (proxy, mut connects) = connect_proxy(address).await;
    let gateway = env.gateway(adapter_via(
        format!("http://elevenlabs.test:{}", address.port()),
        Some(format!("http://127.0.0.1:{proxy}")),
    ));
    let mut listen = gateway.listen_live(&auth, live("via-proxy")).await.unwrap();
    assert_eq!(
        listen.next().await,
        Some(voice::LiveOut::Partial("Hi".into()))
    );
    assert_eq!(
        connects.recv().await.unwrap(),
        format!("CONNECT elevenlabs.test:{} HTTP/1.1", address.port())
    );
    drop(listen);

    // 302 вместо WebSocket.
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        let (mut tcp, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 2048];
        let _ = tcp.read(&mut buf).await;
        tcp.write_all(b"HTTP/1.1 302 Found\r\nLocation: https://elevenlabs.io/app/blocked\r\ncontent-length: 0\r\n\r\n")
            .await
            .unwrap();
    });
    let gateway = env.gateway(adapter(format!("http://{address}")));
    let error = gateway
        .listen_live(&auth, live("redirect"))
        .await
        .err()
        .unwrap();
    let text = error.to_string();
    assert!(
        text.contains("HTTP 302 → https://elevenlabs.io/app/blocked"),
        "{text}"
    );
    assert!(text.contains("включи VPN"), "{text}");
    assert!(!text.contains("другую модель"), "{text}");
    env.close().await;
}
