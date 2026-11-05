//! CMD-005a: только MockVoice, без реальных провайдеров и ключей.
mod common;

use std::{net::SocketAddr, sync::Arc};

use base64::Engine;
use common::{Browser, EMAIL, PASSWORD, logged_in};
use qubite_ai::{AiConfig, Gateway, MockHeard, MockVoice, catalog, elevenlabs};
use qubite_auth::Passwords;
use qubite_server::AppState;
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use uuid::Uuid;

async fn setup() -> (TestDb, qubite_db::Database, SocketAddr, Arc<MockVoice>) {
    let (test_db, db) = TestDb::migrated().await;
    let owner = qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await.unwrap();
    let console = qubite_policy::decide_owner(db.pool(), &qubite_policy::Subject::account(owner.id, None))
        .await.unwrap();
    qubite_ai::admin::set_limit(db.pool(), &console,
        &qubite_ai::admin::LimitScope::User(owner.id), qubite_ai::admin::Period::Day,
        qubite_ai::admin::Metric::Usd, 10_000_000).await.unwrap();
    catalog::ensure_provider(db.pool(), elevenlabs::PROVIDER_ID, "elevenlabs", "", true)
        .await.unwrap();
    let voice = Arc::new(MockVoice::new().script([MockHeard::Text {
        text: "Купить хлеб\nИ молоко".into(), seconds: 1.0,
    }]));
    let ai = Gateway::new(db.pool().clone(), AiConfig::default())
        .with_voice(elevenlabs::PROVIDER_ID, voice.clone());
    let app = qubite_server::router(AppState::new(db.clone()).with_ai(Arc::new(ai)))
        .into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap(); });
    (test_db, db, address, voice)
}

fn recording(id: Uuid) -> Value {
    json!({
        "id": id, "audio_base64": base64::engine::general_purpose::STANDARD.encode(b"mock audio"),
        "mime": "audio/webm;codecs=opus", "duration_ms": 1000, "source": "android",
    })
}

#[tokio::test]
async fn cloud_transcribes_attaches_and_replays_once() {
    let (test_db, db, address, voice) = setup().await;
    let mut owner = logged_in(address).await;
    assert_eq!(owner.get(address, "/api/v1/voice/prefs").await.body["method"], "cloud");
    let id = Uuid::now_v7();
    let request = recording(id);
    // Два одновременно пришедших повтора должны вызвать провайдер один раз.
    let mut other_device = owner.clone();
    let (first, second) = tokio::join!(
        owner.post_json(address, "/api/v1/inbox/voice", request.clone()),
        other_device.post_json(address, "/api/v1/inbox/voice", request.clone()),
    );
    assert!(matches!((first.status.as_u16(), second.status.as_u16()), (201, 200) | (200, 201)),
        "{:?} {:?}", first.body, second.body);
    assert_eq!(first.body, second.body);
    assert_eq!(first.body["transcribed"], true);
    assert_eq!(first.body["item"]["body"], "Купить хлеб\nИ молоко");
    assert_eq!(first.body["item"]["title"], "Купить хлеб");
    assert_eq!(first.body["item"]["kind"], "voice");
    assert_eq!(first.body["item"]["source"], "android");
    assert_eq!(voice.stt_calls(), 1);
    let mut conn = db.pool().acquire().await.unwrap();
    let files = qubite_objects::files::attachments(&mut conn, id).await.unwrap();
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].name, "voice.webm");
    assert_eq!(files[0].size, 10);
    let calls: i64 = sqlx::query_scalar("SELECT count(*) FROM ai_calls")
        .fetch_one(&mut *conn).await.unwrap();
    assert_eq!(calls, 1);
    drop(conn);
    let replay = owner.post_json(address, "/api/v1/inbox/voice", request).await;
    assert_eq!(replay.status, 200);
    assert_eq!(replay.body, first.body);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn no_ai_grant_preserves_audio_and_hides_other_accounts() {
    let (test_db, db, address, voice) = setup().await;
    let mut owner = logged_in(address).await;
    let user = qubite_auth::accounts::create(
        db.pool(), &Passwords::default(), qubite_auth::accounts::NewAccount {
            email: "voice@qubite.ru", display_name: "Ученик", password: PASSWORD, email_verified: true,
        }, None,
    ).await.unwrap();
    let mut student = Browser::default();
    assert_eq!(student.login(address, "voice@qubite.ru", PASSWORD).await.status, 200);
    assert_eq!(student.get(address, "/api/v1/voice/prefs").await.status, 403);
    assert_eq!(student.put_json(address, "/api/v1/voice/prefs", json!({"method": "device"})).await.status, 403);
    assert_eq!(student.post_json(address, "/api/v1/inbox/voice", recording(Uuid::now_v7())).await.status, 403);
    let grant = format!("/api/owner/accounts/{}/grants/inbox", user.id);
    assert_eq!(owner.put_json(address, &grant,
        json!({"read": true, "write": true, "manage": false, "ai": false})).await.status, 200);
    let id = Uuid::now_v7();
    let reply = student.post_json(address, "/api/v1/inbox/voice", recording(id)).await;
    assert_eq!(reply.status, 201, "{:?}", reply.body);
    assert_eq!(reply.body["transcribed"], false);
    assert_eq!(reply.body["item"]["body"], "Голосовая запись");
    assert!(reply.body["reason"].as_str().unwrap().contains("разрешения"));
    assert_eq!(voice.stt_calls(), 0);
    let mut conn = db.pool().acquire().await.unwrap();
    assert_eq!(qubite_objects::files::attachments(&mut conn, id).await.unwrap().len(), 1);
    drop(conn);
    let again = student.post_json(address, "/api/v1/inbox/voice", recording(id)).await;
    assert_eq!(again.status, 200);
    assert_eq!(again.body, reply.body);
    assert_eq!(owner.post_json(address, "/api/v1/inbox/voice", recording(id)).await.status, 404);
    assert_eq!(owner.get(address, &format!("/api/v1/inbox/{id}")).await.status, 404);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn client_text_and_unavailable_methods_keep_audio() {
    let (test_db, db, address, voice) = setup().await;
    let mut owner = logged_in(address).await;
    for method in ["device", "local"] {
        let prefs = owner.put_json(address, "/api/v1/voice/prefs", json!({"method": method})).await;
        assert_eq!(prefs.status, 200);
        assert_eq!(owner.get(address, "/api/v1/voice/prefs").await.body["method"], method);
        let mut request = recording(Uuid::now_v7());
        request["text"] = json!("  Текст с устройства\nбез изменений  ");
        let reply = owner.post_json(address, "/api/v1/inbox/voice", request).await;
        assert_eq!(reply.status, 201, "{:?}", reply.body);
        assert_eq!(reply.body["transcribed"], true);
        assert_eq!(reply.body["item"]["body"], "  Текст с устройства\nбез изменений  ");
        let missing = owner.post_json(address, "/api/v1/inbox/voice", recording(Uuid::now_v7())).await;
        assert_eq!(missing.status, 201);
        assert_eq!(missing.body["transcribed"], false);
    }
    assert_eq!(voice.stt_calls(), 0);
    owner.put_json(address, "/api/v1/voice/prefs", json!({"method": "own_key"})).await;
    let reply = owner.post_json(address, "/api/v1/inbox/voice", recording(Uuid::now_v7())).await;
    assert_eq!(reply.status, 201);
    assert_eq!(reply.body["transcribed"], false);
    assert!(reply.body["reason"].as_str().unwrap().contains("своим ключом"));
    assert_eq!(voice.stt_calls(), 0);
    owner.put_json(address, "/api/v1/voice/prefs", json!({"method": "cloud"})).await;
    voice.push(MockHeard::Refuse);
    // Сначала в очереди успешный ответ, затем отказ провайдера.
    owner.post_json(address, "/api/v1/inbox/voice", recording(Uuid::now_v7())).await;
    let reply = owner.post_json(address, "/api/v1/inbox/voice", recording(Uuid::now_v7())).await;
    assert_eq!(reply.status, 201);
    assert_eq!(reply.body["transcribed"], false);
    assert_eq!(reply.body["item"]["body"], "Голосовая запись");
    assert!(reply.body["reason"].is_string());
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn invalid_audio_is_rejected_before_ai_or_item_creation() {
    let (test_db, db, address, voice) = setup().await;
    let mut owner = logged_in(address).await;
    for audio in [String::new(), "%%%".into(),
        base64::engine::general_purpose::STANDARD.encode(vec![0; qubite_ai::voice::MAX_AUDIO_BYTES + 1]),
        "A".repeat(2 * 1024 * 1024),
    ] {
        let mut request = recording(Uuid::now_v7());
        request["audio_base64"] = json!(audio);
        let reply = owner.post_json(address, "/api/v1/inbox/voice", request).await;
        assert_eq!(reply.status, 400, "{:?}", reply.body);
    }
    for (field, value) in [("mime", json!("text/html")), ("source", json!("telegram")),
        ("duration_ms", json!(0)), ("duration_ms", json!(120001))] {
        let mut request = recording(Uuid::now_v7());
        request[field] = value;
        assert_eq!(owner.post_json(address, "/api/v1/inbox/voice", request).await.status, 400);
    }
    assert_eq!(voice.stt_calls(), 0);
    assert_eq!(owner.get(address, "/api/v1/inbox").await.body, json!([]));
    let invalid = owner.put_json(address, "/api/v1/voice/prefs", json!({"method": "unknown"})).await;
    assert_eq!(invalid.status, 422);
    db.close().await;
    test_db.drop_db().await;
}
