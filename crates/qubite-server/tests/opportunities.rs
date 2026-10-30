//! Доступ к возможностям и очередь проверяются без внешней сети и AI.

mod common;

use std::{net::SocketAddr, sync::Arc, time::Duration};

use common::{Browser, EMAIL, PASSWORD};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_home::{Sources, Urls};
use qubite_server::{AppState, auth::AuthSettings, opportunities};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp, Received},
};
use serde_json::json;
use time::macros::datetime;
use uuid::Uuid;

const CODOLYMP: &str = include_str!("../../qubite-home/tests/fixtures/codolymp-schedule.html");
const DEVPOST: &str = include_str!("../../qubite-home/tests/fixtures/devpost-hackathons.json");
const CODEFORCES: &str = include_str!("../../qubite-home/tests/fixtures/codeforces-contests.json");

async fn sources() -> (FakeHttp, Sources) {
    let fake = FakeHttp::start(
        [],
        Action::With(Arc::new(|req: &Received| {
            if req.line.contains("/olympiads/raspisanie-2026-2027") {
                (200, CODOLYMP.into())
            } else if req.line.contains("/api/contest.list") {
                (200, CODEFORCES.into())
            } else if req.line.contains("/api/hackathons?") {
                if req.line.contains("page=1&") {
                    (200, DEVPOST.into())
                } else {
                    (200, r#"{"hackathons":[]}"#.into())
                }
            } else {
                (404, "неизвестный источник".into())
            }
        })),
    )
    .await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    (fake, sources)
}

#[tokio::test]
async fn api_requires_login_csrf_and_never_reads_another_account() {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let other = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "other@example.org",
            display_name: "Другой",
            password: PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let (_fake, sources) = sources().await;
    let state = AppState::with_auth(db.clone(), AuthSettings::default()).with_home(sources);
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let mut guest = Browser::default();
    assert_eq!(
        guest.get(address, "/api/v1/opportunities").await.status,
        401
    );
    let mut me = common::logged_in_unconfirmed(address).await;
    assert_eq!(
        me.send(
            address,
            reqwest::Method::POST,
            "/api/v1/opportunities/refresh",
            None,
            false,
        )
        .await
        .status,
        403
    );
    let refresh = me.post(address, "/api/v1/opportunities/refresh").await;
    assert_eq!(refresh.status, 200, "{:?}", refresh.body);
    assert_eq!(refresh.body["inserted"], 23);
    assert_eq!(refresh.body["failed_sources"], json!([]));
    let again = me.post(address, "/api/v1/opportunities/refresh").await;
    assert_eq!(again.body["inserted"], 0);
    assert_eq!(
        me.get(address, "/api/v1/opportunities?status=new&kind=contest")
            .await
            .body["items"]
            .as_array()
            .unwrap()
            .len(),
        2
    );
    assert_eq!(
        me.get(address, "/api/v1/opportunities?kind=unknown")
            .await
            .status,
        400
    );
    let mut theirs = Browser::default();
    assert_eq!(
        theirs
            .login(address, "other@example.org", PASSWORD)
            .await
            .status,
        200
    );
    let list = theirs.get(address, "/api/v1/opportunities").await;
    assert_eq!(list.status, 200);
    assert_eq!(list.body["items"], json!([]));
    theirs.post(address, "/api/v1/opportunities/refresh").await;
    let list = theirs.get(address, "/api/v1/opportunities").await;
    assert!(
        list.body["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["account_id"] == other.id.to_string())
    );
    let mine = me.get(address, "/api/v1/opportunities").await;
    assert_eq!(mine.body["items"].as_array().unwrap().len(), 23);
    assert!(
        mine.body["items"]
            .as_array()
            .unwrap()
            .iter()
            .all(|i| i["account_id"] != other.id.to_string())
    );
    server.abort();
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn daily_jobs_are_idempotent_and_refresh_the_payload_account() {
    let (test_db, db) = TestDb::migrated().await;
    let owner =
        qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
            .await
            .unwrap();
    let now = datetime!(2026-10-30 12:00 UTC);
    opportunities::schedule(db.pool(), now).await.unwrap();
    opportunities::schedule(db.pool(), now).await.unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = $1")
        .bind(opportunities::JOB)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 1);
    let job = qubite_jobs::claim(
        db.pool(),
        "opportunities-test",
        &[opportunities::JOB],
        Duration::from_secs(300),
    )
    .await
    .unwrap()
    .unwrap();
    let (_fake, sources) = sources().await;
    opportunities::handle(db.pool(), &sources, &job)
        .await
        .unwrap();
    qubite_jobs::complete(db.pool(), job.id, "opportunities-test")
        .await
        .unwrap();
    assert_eq!(
        qubite_home::opportunities::list(db.pool(), owner.id, None, None)
            .await
            .unwrap()
            .len(),
        23
    );
    opportunities::schedule(db.pool(), now + time::Duration::days(1))
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = $1")
        .bind(opportunities::JOB)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 2);
    // Созданные позднее активные аккаунты подхватываются тем же днём.
    qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "new@example.org",
            display_name: "Новый",
            password: PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    opportunities::schedule(db.pool(), now + time::Duration::days(1))
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = $1")
        .bind(opportunities::JOB)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(count, 3);
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn decisions_require_login_csrf_grants_and_ownership_and_return_one_action() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let owner: Uuid = sqlx::query_scalar("SELECT id FROM accounts WHERE email = $1")
        .bind(EMAIL)
        .fetch_one(db.pool())
        .await
        .unwrap();
    let other = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "other@example.org",
            display_name: "Другой",
            password: PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let id = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO opportunities (id, account_id, source, external_id, kind, title, \
         registration_until, starts_at, ends_at, url) VALUES ($1, $2, 'manual', $3, 'contest', \
         'Тестовый конкурс', now() + interval '10 days', now() + interval '20 days', \
         now() + interval '21 days', '')",
    )
    .bind(id)
    .bind(owner)
    .bind(id.to_string())
    .execute(db.pool())
    .await
    .unwrap();
    let interested = format!("/api/v1/opportunities/{id}/interested");
    let dismiss = format!("/api/v1/opportunities/{id}/dismiss");
    let mut guest = Browser::default();
    for path in [&interested, &dismiss] {
        assert_eq!(guest.post(address, path).await.status, 401);
    }
    let mut me = common::logged_in_unconfirmed(address).await;
    let mut theirs = Browser::default();
    theirs.login(address, "other@example.org", PASSWORD).await;
    for path in [&interested, &dismiss] {
        assert_eq!(
            me.send(address, reqwest::Method::POST, path, None, false)
                .await
                .status,
            403
        );
        assert_eq!(
            theirs.post(address, path).await.status,
            404,
            "чужое мероприятие скрыто даже без гранта"
        );
    }
    // Собственное мероприятие без agent — отказ.
    let own = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO opportunities (id, account_id, source, external_id, kind, title, starts_at, ends_at, url) \
         VALUES ($1, $2, 'manual', $3, 'contest', 'Своё', now() + interval '1 day', now() + interval '2 days', '')",
    )
    .bind(own)
    .bind(other.id)
    .bind(own.to_string())
    .execute(db.pool())
    .await
    .unwrap();
    for suffix in ["interested", "dismiss"] {
        let path = format!("/api/v1/opportunities/{own}/{suffix}");
        assert_eq!(theirs.post(address, &path).await.status, 403);
        let unknown = format!("/api/v1/opportunities/{}/{suffix}", Uuid::now_v7());
        assert_eq!(me.post(address, &unknown).await.status, 404);
    }
    let result = me.post(address, &interested).await;
    assert_eq!(result.status, 200, "{:?}", result.body);
    assert_eq!(
        result.body["action"]["changes"].as_array().unwrap().len(),
        4
    );
    assert_eq!(result.body["action"]["state"]["batch_size"], 1);
    let again = me.post(address, &interested).await;
    assert_eq!(again.status, 200);
    assert!(again.body["action"].is_null());
    let batch = result.body["action"]["batch_id"].as_str().unwrap();
    let undone = me
        .post_json(
            address,
            &format!("/api/v1/agent/batches/{batch}/revert"),
            json!({}),
        )
        .await;
    assert_eq!(undone.status, 200, "{:?}", undone.body);
    assert_eq!(undone.body["status"], "reverted");
    let result = me.post(address, &dismiss).await;
    assert_eq!(result.status, 200);
    let status: String = sqlx::query_scalar("SELECT status FROM opportunities WHERE id = $1")
        .bind(id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(status, "dismissed");
    let action = result.body["action"]["id"].as_str().unwrap();
    let undone = me
        .post_json(
            address,
            &format!("/api/v1/agent/actions/{action}/revert"),
            json!({}),
        )
        .await;
    assert_eq!(undone.status, 200, "{:?}", undone.body);
    assert_eq!(undone.body["status"], "reverted");
    let status: String = sqlx::query_scalar("SELECT status FROM opportunities WHERE id = $1")
        .bind(id)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(status, "new");
    db.close().await;
    test_db.drop_db().await;
}
