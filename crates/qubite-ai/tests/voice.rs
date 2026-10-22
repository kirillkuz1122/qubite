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
    Arc::new(
        ElevenLabs::new(ElevenLabsConfig {
            base_url,
            connect_timeout: Duration::from_secs(2),
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
            Action::Respond(200, "ID3-FAKE-MP3".into()),
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
