//! Сохранённые Кодолимп/Devpost и поддельный Codeforces: только localhost.

use std::sync::{
    Arc,
    atomic::{AtomicU8, Ordering},
};

use qubite_home::{Error, Sources, Urls, opportunities};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp, Received},
};
use serde_json::{Value, json};
use time::macros::datetime;
use uuid::Uuid;

const CODOLYMP: &str = include_str!("fixtures/codolymp-schedule.html");
const DEVPOST: &str = include_str!("fixtures/devpost-hackathons.json");
const CODEFORCES: &str = include_str!("fixtures/codeforces-contests.json");

#[test]
fn codolymp_fixture_has_dates_stages_grades_and_organizer() {
    let items = opportunities::parse_codolymp(CODOLYMP.as_bytes()).unwrap();
    // Неоднозначные ориентиры, «до», даты с часами и пояснениями пропущены.
    assert_eq!(items.len(), 14);
    let registration = items
        .iter()
        .find(|i| i.title == "Устная геометрия ВШЭ")
        .unwrap();
    assert_eq!(registration.kind, "olympiad");
    assert_eq!(registration.subject, "математика");
    assert_eq!(registration.stage, "Регистрация");
    assert_eq!(registration.grades, "8–11 класс");
    assert_eq!(registration.starts_at, datetime!(2026-10-01 00:00 +03:00));
    assert_eq!(registration.ends_at, datetime!(2026-10-27 23:59:59 +03:00));
    assert_eq!(registration.registration_until, Some(registration.ends_at));
    assert!(
        registration
            .url
            .starts_with("https://school.hse.ru/olymp-geometry/polls/1205411187.html")
    );
    assert!(registration.url.contains("&utm_medium=referral"));
    let foxford = items
        .iter()
        .find(|i| i.title == "Олимпиада Фоксфорда")
        .unwrap();
    assert_eq!(foxford.starts_at, datetime!(2026-10-01 00:00 +03:00));
    assert_eq!(foxford.ends_at, datetime!(2026-12-14 23:59:59 +03:00));
    assert!(foxford.registration_until.is_none());
    let sammat = items.iter().find(|i| i.stage == "Интернет-отбор").unwrap();
    assert_eq!(sammat.starts_at, datetime!(2026-12-03 00:00 +03:00));
    assert_eq!(sammat.ends_at, datetime!(2027-01-15 23:59:59 +03:00));
    let one_day = items.iter().find(|i| i.title == "DANO").unwrap();
    assert_eq!(one_day.starts_at, datetime!(2026-11-01 00:00 +03:00));
    assert_eq!(one_day.ends_at, datetime!(2026-11-01 23:59:59 +03:00));
}

#[test]
fn codolymp_uses_month_context_and_skips_broken_rows() {
    let html = CODOLYMP
        .replace("1–27 октября 2026", "1–27")
        .replace(
            "Региональный этап: 7–11 классы — 3 октября 2026",
            "неизвестный формат",
        );
    let items = opportunities::parse_codolymp(html.as_bytes()).unwrap();
    assert_eq!(items.len(), 13);
    let registration = items.iter().find(|i| i.stage == "Регистрация").unwrap();
    assert_eq!(registration.ends_at, datetime!(2026-10-27 23:59:59 +03:00));
    assert!(opportunities::parse_codolymp(b"<html>captcha</html>").is_err());
    assert!(opportunities::parse_codolymp(&[0xff]).is_err());
    let html = CODOLYMP.replace("1–27 октября 2026", "31–32 октября 2026");
    assert_eq!(
        opportunities::parse_codolymp(html.as_bytes()).unwrap().len(),
        13
    );
}

#[test]
fn codeforces_fixture_filters_phase_and_keeps_duration() {
    let items = opportunities::parse_codeforces(CODEFORCES.as_bytes()).unwrap();
    assert_eq!(items.len(), 2);
    assert_eq!(items[0].external_id, "1");
    assert_eq!(items[0].kind, "contest");
    assert_eq!(items[0].starts_at.unix_timestamp(), 1800000000);
    assert_eq!(items[0].ends_at.unix_timestamp(), 1800007200);
    assert_eq!(items[0].url, "https://codeforces.com/contests/1");
    let mut root: Value = serde_json::from_str(CODEFORCES).unwrap();
    root["result"][0]["startTimeSeconds"] = json!(i64::MAX);
    assert_eq!(
        opportunities::parse_codeforces(root.to_string().as_bytes())
            .unwrap()
            .len(),
        1
    );
    for body in ["not json", "{}", r#"{"status":"FAILED","result":[]}"#] {
        assert!(opportunities::parse_codeforces(body.as_bytes()).is_err());
    }
}

#[test]
fn devpost_fixture_filters_online_invites_and_parses_date_ranges() {
    let items = opportunities::parse_devpost(DEVPOST.as_bytes()).unwrap();
    assert_eq!(items.len(), 7);
    let kiroween = items.iter().find(|i| i.external_id == "31667").unwrap();
    assert_eq!(kiroween.title, "Kiroween 2026");
    assert_eq!(kiroween.kind, "hackathon");
    assert_eq!(kiroween.starts_at, datetime!(2026-10-30 00:00 UTC));
    assert_eq!(kiroween.ends_at, datetime!(2026-12-04 23:59:59 UTC));
    assert!(kiroween.registration_until.is_none());
    assert!(kiroween.tags.contains(&"Machine Learning/AI".to_owned()));
    assert!(
        items
            .iter()
            .all(|i| i.external_id != "30463" && i.external_id != "31811")
    );
    let cosmo = items.iter().find(|i| i.external_id == "30455").unwrap();
    assert_eq!(cosmo.starts_at, datetime!(2026-12-19 00:00 UTC));
    assert_eq!(cosmo.ends_at, datetime!(2027-01-18 23:59:59 UTC));
    let hybrid = items.iter().find(|i| i.external_id == "31808").unwrap();
    assert_eq!(hybrid.starts_at, datetime!(2026-11-09 00:00 UTC));
    assert_eq!(hybrid.ends_at, datetime!(2026-11-30 23:59:59 UTC));
    let mut root: Value = serde_json::from_str(DEVPOST).unwrap();
    root["hackathons"][0]["url"] = json!("javascript:alert(1)");
    root["hackathons"][1]["submission_period_dates"] = json!("TBD");
    assert_eq!(
        opportunities::parse_devpost(root.to_string().as_bytes())
            .unwrap()
            .len(),
        5
    );
    assert!(opportunities::parse_devpost(b"{}").is_err());
}

async fn account(pool: &sqlx::PgPool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query("INSERT INTO accounts (id, email) VALUES ($1, $2)")
        .bind(id)
        .bind(format!("{id}@example.org"))
        .execute(pool)
        .await
        .unwrap();
    id
}

async fn fake_sources() -> (FakeHttp, Sources, Arc<AtomicU8>) {
    let down = Arc::new(AtomicU8::new(0));
    let failing = down.clone();
    let fake = FakeHttp::start(
        [],
        Action::With(Arc::new(move |req: &Received| {
            let mode = failing.load(Ordering::SeqCst);
            if mode == 2 || (mode == 1 && req.line.contains("/api/contest.list")) {
                return (503, "недоступно".into());
            }
            if req.line.contains("/olympiads/raspisanie-2026-2027") {
                (200, CODOLYMP.into())
            } else if req.line.contains("/api/contest.list?gym=false") {
                (200, CODEFORCES.into())
            } else if req.line.contains("/api/hackathons?") {
                if req.line.contains("page=1&") {
                    (200, DEVPOST.into())
                } else {
                    (
                        200,
                        r#"{"hackathons":[],"meta":{"total_count":130,"per_page":9}}"#.into(),
                    )
                }
            } else {
                (404, "неизвестный источник".into())
            }
        })),
    )
    .await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    (fake, sources, down)
}

#[tokio::test]
async fn refresh_is_idempotent_keeps_status_and_isolates_accounts() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = account(db.pool()).await;
    let other = account(db.pool()).await;
    let (fake, sources, _) = fake_sources().await;
    let first = sources
        .refresh_opportunities(db.pool(), owner)
        .await
        .unwrap();
    assert_eq!(first.inserted, 23);
    assert!(first.failed_sources.is_empty());
    let items = opportunities::list(db.pool(), owner, None, None)
        .await
        .unwrap();
    let id = items[0].id;
    sqlx::query("UPDATE opportunities SET status = 'dismissed', why = 'не подходит' WHERE id = $1 AND account_id = $2")
        .bind(id)
        .bind(owner)
        .execute(db.pool())
        .await
        .unwrap();
    let (a, b) = tokio::join!(
        sources.refresh_opportunities(db.pool(), owner),
        sources.refresh_opportunities(db.pool(), owner)
    );
    assert_eq!(a.unwrap().inserted + b.unwrap().inserted, 0);
    let dismissed = opportunities::list(db.pool(), owner, Some("dismissed"), None)
        .await
        .unwrap();
    assert_eq!(dismissed.len(), 1);
    assert_eq!(dismissed[0].id, id);
    assert_eq!(dismissed[0].why, "не подходит");
    assert_eq!(dismissed[0].created_at, items[0].created_at);
    assert!(
        opportunities::list(db.pool(), other, None, None)
            .await
            .unwrap()
            .is_empty()
    );
    sources
        .refresh_opportunities(db.pool(), other)
        .await
        .unwrap();
    let theirs = opportunities::list(db.pool(), other, None, Some("hackathon"))
        .await
        .unwrap();
    assert_eq!(theirs.len(), 7);
    assert!(
        theirs
            .iter()
            .all(|i| i.account_id == other && !items.iter().any(|mine| mine.id == i.id))
    );
    assert_eq!(
        opportunities::list(db.pool(), owner, Some("new"), None)
            .await
            .unwrap()
            .len(),
        22
    );
    assert!(matches!(
        opportunities::list(db.pool(), owner, Some("unknown"), None).await,
        Err(Error::Invalid(_))
    ));
    assert!(matches!(
        opportunities::list(db.pool(), owner, None, Some("unknown")).await,
        Err(Error::Invalid(_))
    ));
    assert!(items.windows(2).all(|pair| {
        pair[0].registration_until.unwrap_or(pair[0].starts_at)
            <= pair[1].registration_until.unwrap_or(pair[1].starts_at)
    }));
    let requests = fake.received();
    assert!(requests.iter().all(|r| !r.line.contains("olimpiada.ru")));
    assert!(
        requests
            .iter()
            .any(|r| r.line.contains("status%5B%5D=upcoming&status%5B%5D=open"))
    );
    assert!(requests.iter().any(|r| r.line.contains("page=2&")));
    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn source_failure_preserves_previous_records() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = account(db.pool()).await;
    let (_fake, sources, down) = fake_sources().await;
    sources
        .refresh_opportunities(db.pool(), owner)
        .await
        .unwrap();
    down.store(1, Ordering::SeqCst);
    let partial = sources
        .refresh_opportunities(db.pool(), owner)
        .await
        .unwrap();
    assert_eq!(partial.inserted, 0);
    assert_eq!(partial.failed_sources, ["codeforces"]);
    assert_eq!(
        opportunities::list(db.pool(), owner, None, None)
            .await
            .unwrap()
            .len(),
        23
    );
    down.store(2, Ordering::SeqCst);
    assert!(matches!(
        sources.refresh_opportunities(db.pool(), owner).await,
        Err(Error::Upstream(_))
    ));
    assert_eq!(
        opportunities::list(db.pool(), owner, None, None)
            .await
            .unwrap()
            .len(),
        23
    );
    db.close().await;
    test_db.drop_db().await;
}
