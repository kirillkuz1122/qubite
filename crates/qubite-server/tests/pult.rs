//! «Пульт» (HAR-002, AOS-5): Светофор из GitHub и сводки сборщика с ПК, карточка
//! агента с историей, токены сборщика. GitHub подставной, в интернет тест не ходит.

mod common;

use std::{net::SocketAddr, sync::Arc};

use common::{Browser, EMAIL, PASSWORD};
use qubite_auth::Passwords;
use qubite_kernel::Secret;
use qubite_server::{AppState, auth::AuthSettings, harness::WorkSettings};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp, Received},
};
use serde_json::{Value, json};
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};

fn label(name: &str) -> Value {
    json!({ "name": name })
}

async fn github() -> FakeHttp {
    let respond = Arc::new(|req: &Received| -> (u16, String) {
        let line = &req.line;
        if req.header("authorization") != Some("Bearer test-token") {
            return (401, "{}".into());
        }
        if line.starts_with("GET /repos/o/r/issues?state=open") {
            let issues = json!([
                { "number": 78, "title": "HAR-002 — Пульт", "html_url": "https://github.com/o/r/issues/78",
                  "body": "## Цель\nСветофор и агенты.\n\nдальше", "state": "open",
                  "labels": [label("in_progress")], "updated_at": "2026-11-17T10:00:00Z", "comments": 0 },
                { "number": 81, "title": "DS-013: какую панель взять?", "html_url": "https://github.com/o/r/issues/81",
                  "body": "Два варианта в Figma.\n\n- Пульт в центре (рекомендую)\n- Пульт справа", "state": "open",
                  "labels": [label("вопрос")], "updated_at": "2026-11-17T09:00:00Z", "comments": 0 },
                { "number": 70, "title": "ENG-008 — глаголы", "html_url": "https://github.com/o/r/issues/70",
                  "body": null, "state": "open", "labels": [label("review")],
                  "updated_at": "2026-11-16T09:00:00Z", "comments": 0 },
                { "number": 99, "title": "HAR-002 (1/3)", "html_url": "https://github.com/o/r/pull/99",
                  "body": "Часть #78", "state": "open", "labels": [], "pull_request": {},
                  "updated_at": "2026-11-17T10:00:00Z", "comments": 0 }
            ]);
            (200, issues.to_string())
        } else if line.starts_with("GET /repos/o/r/pulls?state=open") {
            let pulls = json!([
                { "number": 99, "html_url": "https://github.com/o/r/pull/99", "title": "HAR-002 (1/3)",
                  "body": "Часть #78", "head": { "sha": "abc123" } }
            ]);
            (200, pulls.to_string())
        } else if line.starts_with("GET /repos/o/r/commits/abc123/check-runs") {
            let runs = json!({ "check_runs": [
                { "name": "web", "status": "completed", "conclusion": "success" },
                { "name": "frames.spec", "status": "completed", "conclusion": "failure" }
            ]});
            (200, runs.to_string())
        } else {
            (404, "{}".into())
        }
    });
    FakeHttp::start([], Action::With(respond)).await
}

async fn spawn(state: AppState) -> SocketAddr {
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    address
}

fn iso(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap()
}

fn day(t: OffsetDateTime) -> String {
    t.date().to_string()
}

/// Сводка сборщика: сессия в ветке задачи HAR-002, отдельная сессия на ПК и лимиты.
fn report() -> Value {
    let now = OffsetDateTime::now_utc();
    json!({
        "version": 1,
        "host": "arch",
        "at": iso(now),
        "limits": {
            "at": iso(now),
            "five_hour": { "used": 38.0, "resets_at": iso(now + Duration::hours(2)) },
            "seven_day": { "used": 88.0, "resets_at": iso(now + Duration::days(3)) }
        },
        "sessions": [
            { "id": "s-task", "title": "Пульт: сервер", "project": "qubite", "branch": "task/HAR-002",
              "model": "claude-opus-5-5", "effort": "high",
              "started_at": iso(now - Duration::minutes(40)), "last_at": iso(now - Duration::minutes(1)),
              "waiting": false, "context_tokens": 640_000, "cache_ttl_s": 3600,
              "usage": [{ "model": "claude-opus-5-5", "input": 1000, "output": 200_000,
                          "cache_read": 1_500_000, "cache_write_1h": 200_000 }] },
            { "id": "s-pc", "title": "", "project": "dotfiles", "branch": "main",
              "model": "claude-haiku-5-5", "effort": "",
              "started_at": iso(now - Duration::minutes(3)), "last_at": iso(now),
              "waiting": false, "context_tokens": 20_000, "cache_ttl_s": 300,
              "usage": [{ "model": "claude-haiku-5-5", "input": 100, "output": 1000 }] }
        ],
        "days": [
            // неделю назад ПК был выключен — этот день в расход не попадает
            { "date": day(now - Duration::days(10)), "usage": [{ "model": "claude-opus-5-5", "output": 9_000_000 }] },
            { "date": day(now - Duration::days(1)), "usage": [{ "model": "claude-opus-5-5", "output": 1_000_000 }] },
            { "date": day(now), "usage": [{ "model": "claude-opus-5-5", "output": 500_000 },
                                          { "model": "local", "output": 10 }] }
        ],
        "skills": ["task-flow", "delegate", "task-flow"]
    })
}

async fn send_report(address: SocketAddr, token: Option<&str>, body: &Value) -> u16 {
    let client = qubite_testkit::http_client();
    let mut request = client.post(format!("http://{address}/api/pult/report"));
    if let Some(token) = token {
        request = request.bearer_auth(token);
    }
    request.json(body).send().await.unwrap().status().as_u16()
}

fn agent<'a>(board: &'a Value, key: &str) -> &'a Value {
    board["agents"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["key"] == key)
        .unwrap_or_else(|| panic!("нет агента {key}: {board}"))
}

#[tokio::test]
async fn traffic_light_from_github_and_collector() {
    let fake = github().await;
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let state = AppState::with_auth(db, AuthSettings::default()).with_work(WorkSettings {
        token: Some(Secret::new("test-token")),
        repo: "o/r".into(),
        api: fake.root_url(),
        proxy: None,
    });
    let address = spawn(state).await;

    // Гостю Пульта нет, сводку без токена не принимаем.
    assert_eq!(
        Browser::default()
            .get(address, "/api/owner/pult")
            .await
            .status,
        404
    );
    assert_eq!(send_report(address, None, &report()).await, 401);
    assert_eq!(
        send_report(address, Some("qpult_чужой"), &report()).await,
        401
    );

    let mut owner = common::logged_in_unconfirmed(address).await;

    // До сборщика: GitHub есть, ПК — честное «нет данных».
    let empty = owner.get(address, "/api/owner/pult").await;
    assert_eq!(empty.status, 200, "{:?}", empty.body);
    let b = &empty.body;
    assert_eq!(b["limits"]["five_hour"], Value::Null);
    assert_eq!(b["spend"], Value::Null);
    assert_eq!(
        b["counts"],
        json!({ "running": 1, "waiting": 1, "done": 1 })
    );
    let pc = b["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == "pc")
        .unwrap();
    assert_eq!(pc["ok"], false);
    assert!(pc["note"].as_str().unwrap().contains("не подключён"));

    // Вопрос — с вариантами, первый — рекомендация.
    assert_eq!(b["waiting"][0]["number"], 81);
    assert_eq!(b["waiting"][0]["key"], "gh-81");
    assert_eq!(b["waiting"][0]["options"][0], "Пульт в центре (рекомендую)");

    // Задача с PR и красным CI; описание — первый абзац без заголовка.
    let task = agent(b, "gh-78");
    assert_eq!(task["status"], "running");
    assert_eq!(task["pr"]["number"], 99);
    assert_eq!(task["pr"]["ci"], "red");
    assert_eq!(task["task"], "Светофор и агенты.");
    assert_eq!(task["model"], Value::Null);

    // Подключить сборщик: токен один раз.
    let created = owner
        .post_json(
            address,
            "/api/owner/pult/collectors",
            json!({ "name": "ПК" }),
        )
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let token = created.body["token"].as_str().unwrap().to_owned();
    assert!(token.starts_with("qpult_"));
    let id = created.body["id"].as_str().unwrap().to_owned();
    let list = owner.get(address, "/api/owner/pult/collectors").await;
    assert_eq!(list.body[0]["name"], "ПК");
    assert!(
        !list.body.to_string().contains(&token),
        "токен второй раз не отдаём"
    );

    assert_eq!(send_report(address, Some(&token), &report()).await, 204);
    // Чужой формат — 400.
    let mut wrong = report();
    wrong["version"] = json!(2);
    assert_eq!(send_report(address, Some(&token), &wrong).await, 400);

    let full = owner.get(address, "/api/owner/pult").await;
    let b = &full.body;
    assert_eq!(b["limits"]["host"], "arch");
    assert_eq!(b["limits"]["five_hour"]["left"], 62.0);
    assert_eq!(b["limits"]["five_hour"]["low"], false);
    assert_eq!(b["limits"]["seven_day"]["left"], 12.0);
    assert_eq!(b["limits"]["seven_day"]["low"], true);
    assert_eq!(
        b["counts"],
        json!({ "running": 2, "waiting": 1, "done": 1 })
    );
    assert_eq!(b["skills"], json!(["delegate", "task-flow"]));

    // Сессия из ветки task/HAR-002 дописала задачу: модель, контекст, цена, кэш.
    let task = agent(b, "gh-78");
    assert_eq!(task["model"], "Opus 5.5");
    assert_eq!(task["effort"], "high");
    assert_eq!(task["context"], 64.0);
    assert_eq!(task["cache"]["warm"], true);
    assert_eq!(task["source"], "облако · ПК arch");
    assert!(task["usd"].as_f64().unwrap() > 0.0);
    assert!(
        b["agents"]
            .as_array()
            .unwrap()
            .iter()
            .all(|a| a["key"] != "pc-s-task"),
        "сессия задачи не дублируется отдельной строкой"
    );
    let own = agent(b, "pc-s-pc");
    assert_eq!(own["status"], "running");
    assert_eq!(own["title"], "dotfiles · main");
    assert_eq!(own["model"], "Haiku 5.5");

    // Расход: % недели главным, ≈ $ — только по известным моделям, «больше всего» — задача.
    let spend = &b["spend"];
    assert_eq!(spend["week_used"], 88.0);
    assert_eq!(spend["days"].as_array().unwrap().len(), 2);
    assert_eq!(spend["days"][1]["tokens"], 500_010);
    assert!((spend["usd"].as_f64().unwrap() - 30.0).abs() < 1e-6);
    assert_eq!(spend["top"]["title"], "HAR-002");
    assert!(!b.to_string().contains(&token));

    // История пишется кодом: взял задачу, PR, красный CI.
    let card = owner.get(address, "/api/owner/pult/agents/gh-78").await;
    assert_eq!(card.status, 200, "{:?}", card.body);
    let kinds: Vec<&str> = card.body["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["kind"].as_str().unwrap())
        .collect();
    assert_eq!(kinds, ["start", "pr", "ci_red"], "{:?}", card.body);
    assert_eq!(card.body["events"][2]["text"], "CI красный: frames.spec");
    // Повтор без перемен событий не плодит.
    let again = owner.get(address, "/api/owner/pult/agents/gh-78").await;
    assert_eq!(again.body["events"].as_array().unwrap().len(), 3);
    assert_eq!(
        owner
            .get(address, "/api/owner/pult/agents/gh-1")
            .await
            .status,
        404
    );

    // Отключить сборщик: токен больше не работает, сводка удалена.
    let gone = owner
        .delete(address, &format!("/api/owner/pult/collectors/{id}"))
        .await;
    assert_eq!(gone.status, 204);
    assert_eq!(send_report(address, Some(&token), &report()).await, 401);
    let after = owner.get(address, "/api/owner/pult").await;
    assert_eq!(after.body["spend"], Value::Null);

    let log = owner.get(address, "/api/owner/audit").await;
    assert!(log.body.to_string().contains("pult.collector_created"));

    test_db.drop_db().await;
}

#[tokio::test]
async fn without_github_and_collector_everything_is_honestly_empty() {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let address = spawn(AppState::with_auth(db, AuthSettings::default())).await;
    let mut owner = common::logged_in_unconfirmed(address).await;
    let board = owner.get(address, "/api/owner/pult").await;
    assert_eq!(board.status, 200, "{:?}", board.body);
    let b = &board.body;
    assert_eq!(b["agents"], json!([]));
    assert_eq!(
        b["counts"],
        json!({ "running": 0, "waiting": 0, "done": 0 })
    );
    let github = &b["sources"][0];
    assert_eq!(github["ok"], false);
    assert!(github["note"].as_str().unwrap().contains("нет токена"));
    let cloud = b["sources"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == "cloud")
        .unwrap();
    assert_eq!(cloud["ok"], false);
    assert!(
        cloud["note"]
            .as_str()
            .unwrap()
            .contains("управляющая сессия ещё не присылала сводку")
    );
    test_db.drop_db().await;
}

#[tokio::test]
async fn cloud_report_shows_cloud_sessions_and_rejects_unknown_source() {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let address = spawn(AppState::with_auth(db, AuthSettings::default())).await;
    let mut owner = common::logged_in_unconfirmed(address).await;
    let created = owner
        .post_json(
            address,
            "/api/owner/pult/collectors",
            json!({ "name": "Управляющая сессия" }),
        )
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let token = created.body["token"].as_str().unwrap();
    let now = OffsetDateTime::now_utc();
    let mut body = json!({
        "version": 1,
        "source": "cloud",
        "host": "облако",
        "at": iso(now),
        "limits": null,
        "sessions": [
            {
                "id": "session_test",
                "title": "Сводка Пульта",
                "session_url": "https://claude.ai/code/session_test",
                "model": "claude-opus-5-5",
                "started_at": iso(now - Duration::minutes(40)),
                "last_at": iso(now),
                "context_tokens": 640_000,
                "usage": [{ "model": "claude-opus-5-5", "output": 1000 }]
            },
            {
                "id": "session_without_usage",
                "title": "Без событий result",
                "started_at": iso(now),
                "last_at": iso(now),
                "usage": []
            }
        ]
    });
    assert_eq!(send_report(address, Some(token), &body).await, 204);

    let board = owner.get(address, "/api/owner/pult").await;
    assert_eq!(board.status, 200, "{:?}", board.body);
    let sources = board.body["sources"].as_array().unwrap();
    let cloud = sources.iter().find(|s| s["id"] == "cloud").unwrap();
    assert_eq!(cloud["name"], "Облако");
    assert_eq!(cloud["ok"], true);
    assert!(
        cloud["note"]
            .as_str()
            .unwrap()
            .contains("не было окон 5ч/7д")
    );
    assert!(sources.iter().all(|s| s["name"] != "ПК облако"));
    assert_eq!(board.body["limits"]["five_hour"], Value::Null);

    let session = agent(&board.body, "cloud-session_test");
    assert_eq!(session["place"], "cloud");
    assert_eq!(session["source"], "облако");
    assert_eq!(session["model"], "Opus 5.5");
    assert_eq!(session["context"], 64.0);
    assert_eq!(session["tokens"], 1000);
    assert!(session["usd"].as_f64().unwrap() > 0.0);
    assert_eq!(
        session["session_url"],
        "https://claude.ai/code/session_test"
    );
    let without_usage = agent(&board.body, "cloud-session_without_usage");
    assert_eq!(without_usage["tokens"], Value::Null);
    assert_eq!(without_usage["usd"], Value::Null);

    body["source"] = json!("unknown");
    let response = qubite_testkit::http_client()
        .post(format!("http://{address}/api/pult/report"))
        .bearer_auth(token)
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status().as_u16(), 400);
    assert_eq!(
        response.json::<Value>().await.unwrap()["error"],
        "invalid_report"
    );
    test_db.drop_db().await;
}

#[tokio::test]
async fn pr_read_failure_is_a_partial_error_not_empty_prs() {
    let respond = Arc::new(|req: &Received| -> (u16, String) {
        if req.line.starts_with("GET /repos/o/r/issues?state=open") {
            let issues = json!([
                { "number": 78, "title": "HAR-002 — Пульт", "html_url": "https://github.com/o/r/issues/78",
                  "body": "", "state": "open", "labels": [label("in_progress")],
                  "updated_at": "2026-11-17T10:00:00Z", "comments": 0 }
            ]);
            (200, issues.to_string())
        } else {
            (500, "{}".into())
        }
    });
    let fake = FakeHttp::start([], Action::With(respond)).await;
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let state = AppState::with_auth(db, AuthSettings::default()).with_work(WorkSettings {
        token: Some(Secret::new("t")),
        repo: "o/r".into(),
        api: fake.root_url(),
        proxy: None,
    });
    let address = spawn(state).await;
    let mut owner = common::logged_in_unconfirmed(address).await;
    let board = owner.get(address, "/api/owner/pult").await;
    assert_eq!(board.status, 200, "{:?}", board.body);
    let github = &board.body["sources"][0];
    assert_eq!(
        github["ok"], false,
        "PR не прочитаны — источник не «исправен»"
    );
    assert!(github["note"].as_str().unwrap().contains("PR и CI — нет"));
    // задача видна, хоть PR и нет
    assert_eq!(agent(&board.body, "gh-78")["status"], "running");
    test_db.drop_db().await;
}
