//! AGT-006a: настоящий HTTP, права и синхронизация; карты — только FakeHttp.
mod common;

use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use common::{Browser, Reply, logged_in};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_db::Database;
use qubite_route::{BoxFuture, OsrmNominatim, Point, Route, RouteProvider, Settings};
use qubite_server::{AppState, auth::AuthSettings};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp},
};
use serde_json::{Value, json};
use uuid::Uuid;

fn route_reply() -> String {
    json!({"code":"Ok","routes":[{"duration":5401,"distance":35000,
        "geometry":{"type":"LineString","coordinates":[[61.235,55.123],[61.5,55.5]]}}]})
    .to_string()
}

async fn setup(fake: &FakeHttp, enabled: bool) -> (TestDb, Database, SocketAddr) {
    setup_provider(OsrmNominatim::new(Settings {
        enabled,
        osrm_url: fake.root_url(),
        nominatim_url: fake.root_url(),
    }))
    .await
}

async fn setup_provider(provider: impl RouteProvider + 'static) -> (TestDb, Database, SocketAddr) {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(
        db.pool(),
        &Passwords::default(),
        common::EMAIL,
        "Кирилл",
        common::PASSWORD,
    )
    .await
    .unwrap();
    let state = AppState::with_auth(db.clone(), AuthSettings::default()).with_route(provider);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (test_db, db, address)
}

async fn create(owner: &mut Browser, address: SocketAddr, fields: Value) -> Uuid {
    let id = Uuid::now_v7();
    let body = json!({
        "device_id":Uuid::now_v7(),"ops":[{"op_id":Uuid::now_v7(),"object_id":id,
            "kind":"create","object_type":"planner.task","title":"Важное дело","fields":fields}]
    });
    let reply = owner.post_json(address, "/api/v1/sync/push", body).await;
    assert_eq!(
        reply.body["results"][0]["status"], "applied",
        "{:?}",
        reply.body
    );
    id
}

async fn patch(
    owner: &mut Browser,
    address: SocketAddr,
    id: Uuid,
    revision: i64,
    fields: Value,
) -> Value {
    let body = json!({
        "device_id":Uuid::now_v7(),"ops":[{"op_id":Uuid::now_v7(),"object_id":id,
            "kind":"patch","base_revision":revision,"fields":fields}]
    });
    owner
        .post_json(address, "/api/v1/sync/push", body)
        .await
        .body
}

fn path(id: Uuid) -> String {
    format!("/api/v1/planner/tasks/{id}/route")
}

fn from() -> Value {
    json!({"from":{"lat":55.123456,"lon":61.234567}})
}

async fn calculate(owner: &mut Browser, address: SocketAddr, id: Uuid) -> Reply {
    owner.post_json(address, &path(id), from()).await
}

fn error(reply: Reply, status: u16, code: &str) {
    assert_eq!(reply.status.as_u16(), status, "{:?}", reply.body);
    assert_eq!(reply.body["error"], code);
}

#[derive(Clone, Default)]
struct Journal(Arc<Mutex<Vec<u8>>>);

impl std::io::Write for Journal {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        self.0.lock().unwrap().extend_from_slice(bytes);
        Ok(bytes.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

impl<'a> tracing_subscriber::fmt::MakeWriter<'a> for Journal {
    type Writer = Self;
    fn make_writer(&'a self) -> Self::Writer {
        self.clone()
    }
}

#[tokio::test]
async fn route_saves_only_destination_and_minutes_reschedules_and_syncs() {
    let journal = Journal::default();
    tracing::subscriber::set_global_default(
        tracing_subscriber::fmt()
            .with_max_level(tracing::Level::TRACE)
            .with_ansi(false)
            .with_writer(journal.clone())
            .finish(),
    )
    .unwrap();
    let fake = FakeHttp::start(
        [
            Action::Respond(200, r#"[{"lat":"55.5","lon":"61.5"}]"#.into()),
            Action::Respond(200, route_reply()),
        ],
        Action::Respond(500, "{}".into()),
    )
    .await;
    let (test_db, db, address) = setup(&fake, true).await;
    let mut owner = logged_in(address).await;
    let fields = json!({"place_text":"Музей", "due_date":"2030-01-15","due_time":"16:00"});
    let id = create(&mut owner, address, fields).await;
    let reply = calculate(&mut owner, address, id).await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["minutes"], 91);
    assert_eq!(reply.body["meters"], 35000.0);
    assert_eq!(reply.body["provider"], "osrm");
    assert_eq!(reply.body["attribution"], "© OpenStreetMap");
    assert_eq!(reply.body["to"], json!({"lat":55.5,"lon":61.5}));
    assert_eq!(reply.body["place_text"], "Музей");
    assert_eq!(reply.body["geometry"].as_array().unwrap().len(), 2);
    let owner_id: Uuid = sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_one(db.pool())
        .await
        .unwrap();
    let task = qubite_planner::get_task(&mut db.pool().acquire().await.unwrap(), owner_id, id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(task.place_lat, Some(55.5));
    assert_eq!(task.place_lon, Some(61.5));
    assert_eq!(task.travel_minutes, Some(91));
    let at: time::OffsetDateTime = sqlx::query_scalar(
        "SELECT run_at FROM jobs WHERE kind='planner.remind' AND payload->>'task_id'=$1 \
         ORDER BY run_at LIMIT 1",
    )
    .bind(id.to_string())
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(at, time::macros::datetime!(2030-01-15 09:19 UTC));
    let pulled = owner.get(address, "/api/v1/sync/pull?cursor=0").await;
    let snapshot = pulled.body["changes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|snapshot| snapshot["id"] == id.to_string())
        .unwrap();
    assert_eq!(snapshot["fields"]["travel_minutes"], 91);
    assert_eq!(snapshot["fields"]["place_lat"], 55.5);
    assert_eq!(snapshot["fields"]["remind_at"], "2030-01-15T14:19");
    // Повторный расчёт и другое дело с тем же местом используют общий кэш.
    assert_eq!(calculate(&mut owner, address, id).await.status, 200);
    let second = create(&mut owner, address, json!({"place_text":"Музей"})).await;
    assert_eq!(calculate(&mut owner, address, second).await.status, 200);
    assert_eq!(fake.received().len(), 2);

    // Все места, куда могли бы случайно записать исходную точку.
    let persisted: Vec<String> = sqlx::query_scalar(
        "SELECT row_to_json(t)::text FROM planner_tasks t \
         UNION ALL SELECT row_to_json(t)::text FROM sync_ops t \
         UNION ALL SELECT row_to_json(t)::text FROM events t \
         UNION ALL SELECT row_to_json(t)::text FROM audit_log t \
         UNION ALL SELECT row_to_json(t)::text FROM jobs t",
    )
    .fetch_all(db.pool())
    .await
    .unwrap();
    let log = String::from_utf8(journal.0.lock().unwrap().clone()).unwrap();
    for coordinate in ["55.123456", "61.234567"] {
        assert!(!persisted.join("\n").contains(coordinate));
        assert!(!log.contains(coordinate));
    }
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn missing_not_found_and_unavailable_have_stable_codes() {
    let fake = FakeHttp::start(
        [
            Action::Respond(200, "[]".into()),
            Action::Respond(503, "{}".into()),
            Action::Respond(200, r#"[{"lat":"55.5","lon":"61.5"}]"#.into()),
            Action::Respond(200, r#"{"code":"NoRoute","routes":[]}"#.into()),
        ],
        Action::Respond(500, "{}".into()),
    )
    .await;
    let (test_db, db, address) = setup(&fake, true).await;
    let mut owner = logged_in(address).await;
    let missing = create(&mut owner, address, json!({})).await;
    error(
        calculate(&mut owner, address, missing).await,
        400,
        "place_missing",
    );
    let unknown = create(&mut owner, address, json!({"place_text":"Неизвестно"})).await;
    error(
        calculate(&mut owner, address, unknown).await,
        404,
        "place_not_found",
    );
    let fields = json!({"place_lat":55.5,"place_lon":61.5});
    let offline = create(&mut owner, address, fields).await;
    error(
        calculate(&mut owner, address, offline).await,
        503,
        "route_unavailable",
    );
    let no_route = create(&mut owner, address, json!({"place_text":"Музей"})).await;
    error(
        calculate(&mut owner, address, no_route).await,
        503,
        "route_unavailable",
    );
    let stored: (Option<f64>, Option<f64>, Option<i32>) = sqlx::query_as(
        "SELECT place_lat,place_lon,travel_minutes FROM planner_tasks WHERE object_id=$1",
    )
    .bind(no_route)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(stored, (Some(55.5), Some(61.5), None));
    let invalid = json!({"from":{"lat":91,"lon":0}});
    let reply = owner.post_json(address, &path(offline), invalid).await;
    error(reply, 400, "invalid");
    assert_eq!(fake.received().len(), 4);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn rights_and_ownership_are_checked_before_external_requests() {
    let fake = FakeHttp::start([], Action::Respond(500, "{}".into())).await;
    let (test_db, db, address) = setup(&fake, true).await;
    let mut owner = logged_in(address).await;
    let id = create(&mut owner, address, json!({"place_text":"Музей"})).await;
    let user = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "routes@qubite.ru",
            display_name: "",
            password: common::PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut other = Browser::default();
    assert_eq!(calculate(&mut other, address, id).await.status, 401);
    let login = other
        .login(address, "routes@qubite.ru", common::PASSWORD)
        .await;
    assert_eq!(login.status, 200);
    assert_eq!(calculate(&mut other, address, id).await.status, 403);
    let grant_path = format!("/api/owner/accounts/{}/grants/planner", user.id);
    let flags = json!({"read":true,"write":true,"manage":false,"ai":false});
    let grant = owner.put_json(address, &grant_path, flags).await;
    assert_eq!(grant.status, 200);
    assert_eq!(calculate(&mut other, address, id).await.status, 404);
    assert_eq!(
        calculate(&mut owner, address, Uuid::now_v7()).await.status,
        404
    );
    let flags = json!({"read":true,"write":false,"manage":false,"ai":false});
    let grant = owner.put_json(address, &grant_path, flags).await;
    assert_eq!(grant.status, 200);
    assert_eq!(calculate(&mut other, address, id).await.status, 403);
    assert!(fake.received().is_empty());
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn place_fields_roundtrip_clear_and_invalidate_old_travel() {
    let fake = FakeHttp::start([], Action::Respond(500, "{}".into())).await;
    let (test_db, db, address) = setup(&fake, false).await;
    let mut owner = logged_in(address).await;
    let fields =
        json!({"place_text":"Музей","place_lat":55.5,"place_lon":61.5,"travel_minutes":91});
    let id = create(&mut owner, address, fields).await;
    error(
        calculate(&mut owner, address, id).await,
        503,
        "route_unavailable",
    );
    let patched = patch(&mut owner, address, id, 1, json!({"place_text":"Парк"})).await;
    assert_eq!(patched["results"][0]["status"], "applied");
    let stored: (Option<String>, Option<f64>, Option<f64>, Option<i32>) = sqlx::query_as(
        "SELECT place_text,place_lat,place_lon,travel_minutes FROM planner_tasks WHERE object_id=$1",
    )
    .bind(id)
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(stored, (Some("Парк".into()), None, None, None));
    let cleared =
        json!({"place_text":null,"place_lat":null,"place_lon":null,"travel_minutes":null});
    let patched = patch(&mut owner, address, id, 2, cleared).await;
    assert_eq!(patched["results"][0]["status"], "applied");
    for invalid in [
        json!({"place_lat":91,"place_lon":0}),
        json!({"place_lat":55}),
        json!({"travel_minutes":-1}),
    ] {
        let reply = patch(&mut owner, address, id, 3, invalid).await;
        assert_eq!(reply["results"][0]["status"], "rejected");
    }
    assert!(fake.received().is_empty());
    db.close().await;
    test_db.drop_db().await;
}

struct PausedRoute {
    inner: OsrmNominatim,
    started: Arc<tokio::sync::Notify>,
    resume: Arc<tokio::sync::Notify>,
}

impl RouteProvider for PausedRoute {
    fn geocode<'a>(&'a self, text: &'a str) -> BoxFuture<'a, Option<Point>> {
        self.inner.geocode(text)
    }

    fn route(&self, from: Point, to: Point) -> BoxFuture<'_, Route> {
        Box::pin(async move {
            self.started.notify_one();
            self.resume.notified().await;
            self.inner.route(from, to).await
        })
    }
}

#[tokio::test]
async fn concurrent_edit_does_not_save_a_stale_route() {
    let fake = FakeHttp::start([], Action::Respond(200, route_reply())).await;
    let started = Arc::new(tokio::sync::Notify::new());
    let resume = Arc::new(tokio::sync::Notify::new());
    let provider = PausedRoute {
        inner: OsrmNominatim::new(Settings {
            enabled: true,
            osrm_url: fake.root_url(),
            nominatim_url: fake.root_url(),
        }),
        started: started.clone(),
        resume: resume.clone(),
    };
    let (test_db, db, address) = setup_provider(provider).await;
    let mut owner = logged_in(address).await;
    let fields = json!({"place_lat":55.5,"place_lon":61.5});
    let id = create(&mut owner, address, fields).await;
    let mut caller = owner.clone();
    let pending = tokio::spawn(async move { calculate(&mut caller, address, id).await });
    tokio::time::timeout(std::time::Duration::from_secs(5), started.notified())
        .await
        .unwrap();
    let patched = patch(&mut owner, address, id, 1, json!({"notes":"Изменено"})).await;
    assert_eq!(patched["results"][0]["status"], "applied");
    resume.notify_one();
    error(pending.await.unwrap(), 409, "conflict");
    let minutes: Option<i32> =
        sqlx::query_scalar("SELECT travel_minutes FROM planner_tasks WHERE object_id=$1")
            .bind(id)
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(minutes, None);
    db.close().await;
    test_db.drop_db().await;
}
