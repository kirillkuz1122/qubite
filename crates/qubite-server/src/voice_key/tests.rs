#[path = "../../tests/common/mod.rs"]
mod common;

use super::*;
use base64::Engine;
use common::{Browser, EMAIL, PASSWORD, logged_in};
use qubite_ai::{MockHeard, MockVoice, secret::SecretBox};
use qubite_auth::Passwords;
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use std::net::SocketAddr;

const TEST_KEY: &str = "test-only-voice-key-5678";
// Буквальный публичный IP: проверка адреса без DNS и внешней сети.
const TEST_BASE: &str = "https://8.8.8.8/v1";

async fn setup() -> (TestDb, qubite_db::Database, SocketAddr, Arc<MockVoice>, Arc<SecretBox>) {
    setup_config(true).await
}

async fn setup_config(ready: bool) -> (TestDb, qubite_db::Database, SocketAddr, Arc<MockVoice>, Arc<SecretBox>) {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await.unwrap();
    let secret = Arc::new(SecretBox::from_base64(&SecretBox::generate_key()).unwrap());
    let voice = Arc::new(MockVoice::new());
    let mut state = AppState::new(db.clone()).with_ai_panel(crate::ai_console::AiPanel {
        secrets: ready.then(|| secret.clone()), ..Default::default()
    });
    state.own_key_voice = Some(voice.clone());
    let app = crate::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
    (test_db, db, address, voice, secret)
}

fn recording(id: Uuid) -> Value {
    json!({ "id": id, "audio_base64": base64::engine::general_purpose::STANDARD.encode(b"fake audio"),
        "mime": "audio/webm", "duration_ms": 1000 })
}

async fn save(browser: &mut Browser, address: SocketAddr) -> common::Reply {
    browser.put_json(address, "/api/v1/voice/key", json!({
        "api_key": TEST_KEY, "base_url": TEST_BASE,
    })).await
}

#[test]
fn input_defaults_and_limits() {
    let input: VoiceKeyInput = serde_json::from_value(json!({ "api_key": TEST_KEY })).unwrap();
    let (_, base, model) = key_parts(&input).unwrap();
    assert_eq!(base, openai_voice::DEFAULT_BASE_URL);
    assert_eq!(model, openai_voice::DEFAULT_MODEL);
    for key in ["short".into(), "a".repeat(4097), "bad key with spaces".into(), "bad\r\nheader-123456".into()] {
        let input: VoiceKeyInput = serde_json::from_value(json!({"api_key": key})).unwrap();
        assert!(key_parts(&input).is_err());
    }
}

#[tokio::test]
async fn key_is_encrypted_masked_replaced_and_removed() {
    let (test_db, db, address, _, secret) = setup().await;
    let mut owner = logged_in(address).await;
    let empty = json!({ "configured": false, "base_url": null, "model": null, "last4": null });
    assert_eq!(owner.get(address, "/api/v1/voice/key").await.body, empty);
    let saved = save(&mut owner, address).await;
    assert_eq!(saved.status, 200);
    assert_eq!(saved.body, json!({
        "configured": true, "base_url": TEST_BASE, "model": "whisper-1", "last4": "5678",
    }));
    let sealed: String = sqlx::query_scalar("SELECT key_sealed FROM voice_keys")
        .fetch_one(db.pool()).await.unwrap();
    assert_ne!(sealed, TEST_KEY);
    assert_eq!(secret.open("voice.own_key", &sealed).unwrap(), TEST_KEY);
    assert!(secret.open("other", &sealed).is_err());
    let get = owner.get(address, "/api/v1/voice/key").await;
    assert_eq!(get.body, saved.body);
    assert!(!get.body.to_string().contains(TEST_KEY));
    assert!(!get.body.to_string().contains(&sealed));
    let updated = owner.put_json(address, "/api/v1/voice/key", json!({
        "api_key": "another-test-key-9012", "base_url": TEST_BASE, "model": "custom-stt",
    })).await;
    assert_eq!(updated.status, 200);
    assert_eq!(updated.body["last4"], "9012");
    assert_eq!(updated.body["model"], "custom-stt");
    assert_eq!(owner.delete(address, "/api/v1/voice/key").await.status, 204);
    assert_eq!(owner.delete(address, "/api/v1/voice/key").await.status, 204);
    assert_eq!(owner.get(address, "/api/v1/voice/key").await.body, empty);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn own_key_calls_once_without_platform_budget_and_preserves_failed_audio() {
    let (test_db, db, address, voice, _) = setup().await;
    let mut owner = logged_in(address).await;
    assert_eq!(owner.put_json(address, "/api/v1/voice/prefs", json!({"method": "own_key"})).await.status, 200);
    let missing_id = Uuid::now_v7();
    let missing = owner.post_json(address, "/api/v1/inbox/voice", recording(missing_id)).await;
    assert_eq!(missing.status, 201);
    assert_eq!(missing.body["transcribed"], false);
    assert!(missing.body["reason"].as_str().unwrap().contains("добавьте ключ"));
    assert_eq!(voice.stt_calls(), 0);
    assert_eq!(save(&mut owner, address).await.status, 200);
    let replay = owner.post_json(address, "/api/v1/inbox/voice", recording(missing_id)).await;
    assert_eq!(replay.status, 200);
    assert_eq!(replay.body, missing.body);
    assert_eq!(voice.stt_calls(), 0);
    voice.push(MockHeard::Text { text: "Купить хлеб".into(), seconds: 1.0 });
    voice.push(MockHeard::Refuse);
    let mut device = owner.clone();
    for (transcribed, calls) in [(true, 1), (false, 2)] {
        let id = Uuid::now_v7();
        let (first, second) = tokio::join!(
            owner.post_json(address, "/api/v1/inbox/voice", recording(id)),
            device.post_json(address, "/api/v1/inbox/voice", recording(id)),
        );
        assert!(matches!((first.status.as_u16(), second.status.as_u16()), (201, 200) | (200, 201)));
        assert_eq!(first.body, second.body);
        assert_eq!(first.body["transcribed"], transcribed);
        assert_eq!(voice.stt_calls(), calls);
        if !transcribed {
            assert_eq!(first.body["item"]["body"], "Голосовая запись");
            assert!(first.body["reason"].as_str().unwrap().contains("Аудиозапись сохранена"));
        }
        let mut conn = db.pool().acquire().await.unwrap();
        let files = qubite_objects::files::attachments(&mut conn, id).await.unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name, "voice.webm");
        assert_eq!(files[0].size, 10);
        let audit = qubite_objects::audit::for_target(&mut conn, "inbox_item", &id.to_string()).await.unwrap();
        assert_eq!(audit.len(), 1);
        assert_eq!(audit[0].after, Some(json!({ "transcribed": transcribed, "cost_usd": 0 })));
        assert!(!serde_json::to_string(&audit).unwrap().contains(TEST_KEY));
    }
    let calls: i64 = sqlx::query_scalar("SELECT count(*) FROM ai_calls")
        .fetch_one(db.pool()).await.unwrap();
    assert_eq!(calls, 0, "бюджет платформы не затрагивается");
    let limits: i64 = sqlx::query_scalar("SELECT count(*) FROM ai_limits")
        .fetch_one(db.pool()).await.unwrap();
    assert_eq!(limits, 0, "распознаёт без выдачи бюджета платформы");
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn write_permission_and_account_isolation_cover_all_key_methods() {
    let (test_db, db, address, voice, _) = setup().await;
    let mut owner = logged_in(address).await;
    assert_eq!(save(&mut owner, address).await.status, 200);
    let user = qubite_auth::accounts::create(db.pool(), &Passwords::default(), qubite_auth::accounts::NewAccount {
        email: "voice-key@qubite.ru", display_name: "Ученик", password: PASSWORD, email_verified: true,
    }, None).await.unwrap();
    let mut student = Browser::default();
    assert_eq!(student.login(address, "voice-key@qubite.ru", PASSWORD).await.status, 200);
    let mut anonymous = Browser::default();
    assert_eq!(anonymous.get(address, "/api/v1/voice/key").await.status, 401);
    assert_eq!(student.get(address, "/api/v1/voice/key").await.status, 403);
    assert_eq!(save(&mut student, address).await.status, 403);
    assert_eq!(student.delete(address, "/api/v1/voice/key").await.status, 403);
    assert_eq!(owner.put_json(address, &format!("/api/owner/accounts/{}/grants/inbox", user.id),
        json!({"read": true, "write": true, "manage": false, "ai": false})).await.status, 200);
    assert_eq!(student.get(address, "/api/v1/voice/key").await.body["configured"], false);
    assert_eq!(student.delete(address, "/api/v1/voice/key").await.status, 204);
    assert_eq!(owner.get(address, "/api/v1/voice/key").await.body["configured"], true);
    assert_eq!(student.put_json(address, "/api/v1/voice/key", json!({
        "api_key": "student-test-key-9012", "base_url": TEST_BASE,
    })).await.status, 200);
    assert_eq!(student.get(address, "/api/v1/voice/key").await.body["last4"], "9012");
    assert_eq!(owner.get(address, "/api/v1/voice/key").await.body["last4"], "5678");
    assert_eq!(student.put_json(address, "/api/v1/voice/prefs", json!({"method": "own_key"})).await.status, 200);
    voice.push(MockHeard::Text { text: "Без гранта AI".into(), seconds: 1.0 });
    assert_eq!(student.post_json(address, "/api/v1/inbox/voice", recording(Uuid::now_v7())).await.body["transcribed"], true);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn invalid_key_url_model_and_account_override_are_json_errors() {
    let (test_db, db, address, _, _) = setup().await;
    let mut owner = logged_in(address).await;
    for input in [
        json!({"api_key": "short", "base_url": TEST_BASE}),
        json!({"api_key": "a".repeat(4097), "base_url": TEST_BASE}),
        json!({"api_key": TEST_KEY, "base_url": "http://8.8.8.8/v1"}),
        json!({"api_key": TEST_KEY, "base_url": "https://127.0.0.1/v1"}),
        json!({"api_key": TEST_KEY, "base_url": "https://[::ffff:10.0.0.1]/v1"}),
        json!({"api_key": TEST_KEY, "base_url": "https://169.254.169.254/"}),
        json!({"api_key": TEST_KEY, "base_url": format!("https://8.8.8.8/{}", "x".repeat(2048))}),
        json!({"api_key": TEST_KEY, "base_url": TEST_BASE, "model": ""}),
        json!({"api_key": TEST_KEY, "base_url": TEST_BASE, "model": "x".repeat(257)}),
        json!({"api_key": TEST_KEY, "base_url": TEST_BASE, "account_id": Uuid::now_v7()}),
        json!({"api_key": TEST_KEY, "base_url": TEST_BASE, "model": "bad\r\nmodel"}),
    ] {
        let reply = owner.put_json(address, "/api/v1/voice/key", input).await;
        assert_eq!(reply.status, 400, "{:?}", reply.body);
        assert_eq!(reply.body["error"], "invalid");
        assert!(reply.body["message"].is_string());
        assert!(!reply.body.to_string().contains(TEST_KEY));
    }
    assert_eq!(owner.get(address, "/api/v1/voice/key").await.body["configured"], false);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn missing_encryption_setup_and_damaged_key_preserve_audio() {
    let (test_db, db, address, voice, _) = setup_config(false).await;
    let mut owner = logged_in(address).await;
    let reply = save(&mut owner, address).await;
    assert_eq!(reply.status, 409);
    assert_eq!(reply.body["error"], "secret_key_not_set");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM voice_keys")
        .fetch_one(db.pool()).await.unwrap();
    assert_eq!(count, 0);
    db.close().await;
    test_db.drop_db().await;
    assert_eq!(voice.stt_calls(), 0);

    let (test_db, db, address, voice, _) = setup().await;
    let mut owner = logged_in(address).await;
    assert_eq!(save(&mut owner, address).await.status, 200);
    sqlx::query("UPDATE voice_keys SET key_sealed = 'damaged'")
        .execute(db.pool()).await.unwrap();
    owner.put_json(address, "/api/v1/voice/prefs", json!({"method": "own_key"})).await;
    let id = Uuid::now_v7();
    let reply = owner.post_json(address, "/api/v1/inbox/voice", recording(id)).await;
    assert_eq!(reply.status, 201);
    assert_eq!(reply.body["transcribed"], false);
    assert!(reply.body["reason"].as_str().unwrap().contains("Сохраните его в настройках"));
    let mut conn = db.pool().acquire().await.unwrap();
    assert_eq!(qubite_objects::files::attachments(&mut conn, id).await.unwrap().len(), 1);
    drop(conn);
    assert_eq!(voice.stt_calls(), 0);
    db.close().await;
    test_db.drop_db().await;
}
