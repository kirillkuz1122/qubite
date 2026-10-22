//! Проект как папка через настоящий HTTP-сервер (PROJ-001): страница проекта,
//! файлы, документы, память агента и лента; чужой проект не виден.

mod common;

use std::net::SocketAddr;

use common::{Browser, logged_in};
use qubite_agent::{Trigger, Who, call, finish_run, start_run};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use uuid::Uuid;

const USER_PASSWORD: &str = "пароль пользователя";

async fn user(db: &qubite_db::Database, address: SocketAddr, email: &str) -> (Uuid, Browser) {
    let account = qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email,
            display_name: "",
            password: USER_PASSWORD,
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut browser = Browser::default();
    let reply = browser.login(address, email, USER_PASSWORD).await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    (account.id, browser)
}

fn create(object_id: Uuid, object_type: &str, title: &str, fields: Value) -> Value {
    json!({
        "op_id": Uuid::now_v7(),
        "object_id": object_id,
        "kind": "create",
        "object_type": object_type,
        "title": title,
        "fields": fields,
    })
}

async fn push(browser: &mut Browser, address: SocketAddr, ops: Vec<Value>) {
    let reply = browser
        .post_json(
            address,
            "/api/v1/sync/push",
            json!({ "device_id": Uuid::now_v7(), "ops": ops }),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    for result in reply.body["results"].as_array().unwrap() {
        assert_eq!(result["status"], "applied", "{result}");
    }
}

fn cookies(browser: &Browser) -> String {
    format!(
        "qubite_session={}; qubite_csrf={}",
        browser.session.as_deref().unwrap_or_default(),
        browser.csrf.as_deref().unwrap_or_default()
    )
}

/// Загрузить файл: тело — сам файл (как делает сайт).
async fn upload(
    browser: &Browser,
    address: SocketAddr,
    project: Uuid,
    name: &str,
    mime: &str,
    content: &[u8],
) -> (reqwest::StatusCode, Value) {
    let response = qubite_testkit::http_client()
        .post(format!(
            "http://{address}/api/v1/projects/{project}/files?name={}",
            urlencoding(name)
        ))
        .header("cookie", cookies(browser))
        .header("x-csrf-token", browser.csrf.as_deref().unwrap_or_default())
        .header("content-type", mime)
        .body(content.to_vec())
        .send()
        .await
        .unwrap();
    let status = response.status();
    (status, response.json().await.unwrap_or(Value::Null))
}

async fn download(
    browser: &Browser,
    address: SocketAddr,
    project: Uuid,
    name: &str,
) -> (reqwest::StatusCode, reqwest::header::HeaderMap, Vec<u8>) {
    let response = qubite_testkit::http_client()
        .get(format!(
            "http://{address}/api/v1/projects/{project}/files/{}",
            urlencoding(name)
        ))
        .header("cookie", cookies(browser))
        .send()
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    (status, headers, response.bytes().await.unwrap().to_vec())
}

fn urlencoding(text: &str) -> String {
    text.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-._~".contains(&b) {
                char::from(b).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}

fn kinds(page: &Value) -> Vec<String> {
    page["feed"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| {
            format!(
                "{}:{}",
                item["object"].as_str().unwrap(),
                item["kind"].as_str().unwrap()
            )
        })
        .collect()
}

#[tokio::test]
async fn project_page_files_docs_and_rights() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;

    // Проект «Qubite» и дело в нём со сроком — как из Planner.
    let project = Uuid::now_v7();
    let task = Uuid::now_v7();
    push(
        &mut owner,
        address,
        vec![
            create(
                project,
                "planner.project",
                "Qubite",
                json!({ "color": "sky", "notes": "Личная цифровая среда" }),
            ),
            create(
                task,
                "planner.task",
                "Страница проекта",
                json!({ "project_id": project, "due_date": "2026-10-23", "due_time": "16:00" }),
            ),
        ],
    )
    .await;

    let page = owner
        .get(address, &format!("/api/v1/projects/{project}"))
        .await;
    assert_eq!(page.status, 200, "{:?}", page.body);
    assert_eq!(page.body["project"]["title"], "Qubite");
    assert_eq!(page.body["project"]["notes"], "Личная цифровая среда");
    assert_eq!(page.body["tasks"][0]["id"], task.to_string());
    assert_eq!(page.body["tasks"][0]["due_time"], "16:00");
    assert_eq!(page.body["files"], json!([]));
    assert_eq!(page.body["docs"], json!([]));
    assert_eq!(page.body["agent"], true);
    assert!(page.body["memory"].is_null());
    assert_eq!(page.body["events"], json!([]));
    assert_eq!(kinds(&page.body), ["task:created", "project:created"]);

    // Файл: загрузить, имя занято — «(2)», скачать то же самое.
    let (status, file) = upload(
        &owner,
        address,
        project,
        "план.pdf",
        "application/pdf",
        b"%PDF-1",
    )
    .await;
    assert_eq!(status, 201, "{file:?}");
    assert_eq!(file["name"], "план.pdf");
    assert_eq!(file["size"], 6);
    let (status, again) = upload(
        &owner,
        address,
        project,
        "../план.pdf",
        "application/pdf",
        b"%PDF-2",
    )
    .await;
    assert_eq!(status, 201, "{again:?}");
    assert_eq!(again["name"], "план (2).pdf");
    let (status, html) = upload(
        &owner,
        address,
        project,
        "страница.html",
        "text/html",
        b"<script>alert(1)</script>",
    )
    .await;
    assert_eq!(status, 201, "{html:?}");
    let (status, headers, bytes) = download(&owner, address, project, "план.pdf").await;
    assert_eq!(status, 200);
    assert_eq!(bytes, b"%PDF-1");
    assert_eq!(headers["content-type"], "application/pdf");
    // HTML с нашего адреса не откроется как страница — только скачать.
    let (_, headers, _) = download(&owner, address, project, "страница.html").await;
    assert_eq!(headers["content-type"], "application/octet-stream");
    assert!(
        headers["content-disposition"]
            .to_str()
            .unwrap()
            .starts_with("attachment")
    );
    assert_eq!(headers["x-content-type-options"], "nosniff");
    let removed = owner
        .delete(
            address,
            &format!(
                "/api/v1/projects/{project}/files/{}",
                urlencoding("страница.html")
            ),
        )
        .await;
    assert_eq!(removed.status, 204);
    let (status, ..) = download(&owner, address, project, "страница.html").await;
    assert_eq!(status, 404);
    let (status, empty) = upload(&owner, address, project, "  ", "text/plain", b"x").await;
    assert_eq!(status, 400, "{empty:?}");

    // Документ проекта: создать, поправить, конфликт версий.
    let made = owner
        .post_json(
            address,
            &format!("/api/v1/projects/{project}/docs"),
            json!({ "title": "Устройство", "body": "# Стек\n\nRust и React" }),
        )
        .await;
    assert_eq!(made.status, 201, "{:?}", made.body);
    let doc = made.body["id"].as_str().unwrap().to_owned();
    assert_eq!(made.body["preview"], "Стек");
    let edited = owner
        .put_json(
            address,
            &format!("/api/v1/docs/{doc}"),
            json!({ "title": "Как устроен Qubite", "body": "# Стек\n\nRust, React, Tauri", "revision": 1 }),
        )
        .await;
    assert_eq!(edited.status, 200, "{:?}", edited.body);
    assert_eq!(edited.body["revision"], 3, "название и текст — две версии");
    let stale = owner
        .put_json(
            address,
            &format!("/api/v1/docs/{doc}"),
            json!({ "title": "x", "body": "y", "revision": 1 }),
        )
        .await;
    assert_eq!(stale.status, 409, "{:?}", stale.body);

    // Документ другого проекта можно привязать и к этому, и убрать.
    let other = Uuid::now_v7();
    push(
        &mut owner,
        address,
        vec![create(other, "planner.project", "Олимпиада", json!({}))],
    )
    .await;
    let theirs = owner
        .post_json(
            address,
            &format!("/api/v1/projects/{other}/docs"),
            json!({ "title": "Задачи прошлых лет" }),
        )
        .await;
    let theirs = theirs.body["id"].as_str().unwrap().to_owned();
    let linked = owner
        .post(
            address,
            &format!("/api/v1/projects/{project}/docs/{theirs}"),
        )
        .await;
    assert_eq!(linked.status, 200, "{:?}", linked.body);
    assert_eq!(linked.body["project_ids"].as_array().unwrap().len(), 2);
    let all = owner.get(address, "/api/v1/docs").await;
    assert_eq!(all.body["docs"].as_array().unwrap().len(), 2);
    let unlinked = owner
        .delete(
            address,
            &format!("/api/v1/projects/{project}/docs/{theirs}"),
        )
        .await;
    assert_eq!(unlinked.status, 204);
    let still = owner.get(address, &format!("/api/v1/docs/{theirs}")).await;
    assert_eq!(still.status, 200, "документ остался");

    // Память агента о проекте — файл «Проекты/Qubite.md» в папке агента.
    let memory = owner
        .post_json(
            address,
            "/api/v1/agent/files",
            json!({ "path": "Проекты/Qubite", "body": "- стек: Rust + React" }),
        )
        .await;
    assert_eq!(memory.status, 200, "{:?}", memory.body);

    // Агент кладёт дело в проект — оно на странице проекта.
    let run = start_run(db.pool(), owner_id(&db).await, Trigger::Manual)
        .await
        .unwrap();
    let agent = Who::agent(&run);
    call(
        db.pool(),
        &agent,
        "task.create",
        json!({ "title": "Календарь", "fields": { "project_id": project, "due_date": "2026-10-24" } }),
        Some("дело про Qubite"),
        None,
    )
    .await
    .unwrap();
    finish_run(db.pool(), &run, true).await.unwrap();

    let page = owner
        .get(address, &format!("/api/v1/projects/{project}"))
        .await;
    assert_eq!(page.status, 200, "{:?}", page.body);
    let titles: Vec<&str> = page.body["tasks"]
        .as_array()
        .unwrap()
        .iter()
        .map(|t| t["title"].as_str().unwrap())
        .collect();
    assert_eq!(titles, ["Страница проекта", "Календарь"]);
    let names: Vec<&str> = page.body["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["name"].as_str().unwrap())
        .collect();
    assert_eq!(names, ["план.pdf", "план (2).pdf"]);
    assert_eq!(page.body["docs"][0]["title"], "Как устроен Qubite");
    assert_eq!(page.body["docs"].as_array().unwrap().len(), 1);
    assert_eq!(page.body["memory"]["path"], "Проекты/Qubite.md");
    assert_eq!(page.body["memory"]["body"], "- стек: Rust + React");
    let feed = kinds(&page.body);
    for expected in [
        "task:created",
        "doc:doc_unlinked",
        "doc:doc_linked",
        "doc:changed",
        "doc:created",
        "project:file_removed",
        "project:file_added",
    ] {
        assert!(
            feed.contains(&expected.to_owned()),
            "{expected} нет в {feed:?}"
        );
    }
    let more = owner
        .get(
            address,
            &format!(
                "/api/v1/projects/{project}/feed?before={}",
                page.body["feed"][2]["seq"]
            ),
        )
        .await;
    assert_eq!(more.status, 200);
    assert_eq!(
        more.body["items"].as_array().unwrap().len(),
        page.body["feed"].as_array().unwrap().len() - 3
    );

    // Чужой человек с правами на Planner и Docs: чужого проекта и файлов «нет».
    let (account, mut student) = user(&db, address, "student@qubite.ru").await;
    for module in ["planner", "docs"] {
        let reply = owner
            .put_json(
                address,
                &format!("/api/owner/accounts/{account}/grants/{module}"),
                json!({ "read": true, "write": true, "manage": false, "ai": false }),
            )
            .await;
        assert_eq!(reply.status, 200, "{:?}", reply.body);
    }
    let theirs_page = student
        .get(address, &format!("/api/v1/projects/{project}"))
        .await;
    assert_eq!(theirs_page.status, 404);
    let (status, ..) = download(&student, address, project, "план.pdf").await;
    assert_eq!(status, 404);
    let (status, _) = upload(
        &student,
        address,
        project,
        "вирус.exe",
        "application/x-msdownload",
        b"MZ",
    )
    .await;
    assert_eq!(status, 404);
    let wipe = student
        .delete(
            address,
            &format!(
                "/api/v1/projects/{project}/files/{}",
                urlencoding("план.pdf")
            ),
        )
        .await;
    assert_eq!(wipe.status, 404);
    assert_eq!(
        student
            .get(address, &format!("/api/v1/docs/{doc}"))
            .await
            .status,
        404
    );
    let feed = student
        .get(address, &format!("/api/v1/projects/{project}/feed"))
        .await;
    assert_eq!(feed.status, 404);
    // Свой проект: чужой документ не привязать, чужой список документов не виден.
    let mine = Uuid::now_v7();
    push(
        &mut student,
        address,
        vec![create(mine, "planner.project", "Моё", json!({}))],
    )
    .await;
    let steal = student
        .post(address, &format!("/api/v1/projects/{mine}/docs/{doc}"))
        .await;
    assert_eq!(steal.status, 404);
    assert_eq!(
        student.get(address, "/api/v1/docs").await.body["docs"],
        json!([])
    );
    let page = student
        .get(address, &format!("/api/v1/projects/{mine}"))
        .await;
    assert_eq!(page.status, 200, "{:?}", page.body);
    assert_eq!(page.body["agent"], false, "гранта на агента нет");
    assert!(page.body["memory"].is_null());

    // Без гранта на Docs: блок документов не приходит, создать нельзя.
    let revoked = owner
        .delete(
            address,
            &format!("/api/owner/accounts/{account}/grants/docs"),
        )
        .await;
    assert_eq!(revoked.status, 204);
    let page = student
        .get(address, &format!("/api/v1/projects/{mine}"))
        .await;
    assert!(page.body["docs"].is_null(), "{:?}", page.body);
    let denied = student
        .post_json(
            address,
            &format!("/api/v1/projects/{mine}/docs"),
            json!({ "title": "Конспект" }),
        )
        .await;
    assert_eq!(denied.status, 403, "{:?}", denied.body);
    // Без гранта на Planner — страница закрыта.
    owner
        .delete(
            address,
            &format!("/api/owner/accounts/{account}/grants/planner"),
        )
        .await;
    let closed = student
        .get(address, &format!("/api/v1/projects/{mine}"))
        .await;
    assert_eq!(closed.status, 403, "{:?}", closed.body);

    db.close().await;
    test_db.drop_db().await;
}

async fn owner_id(db: &qubite_db::Database) -> Uuid {
    sqlx::query_scalar("SELECT id FROM accounts WHERE lower(email) = lower($1)")
        .bind(common::EMAIL)
        .fetch_one(db.pool())
        .await
        .unwrap()
}

async fn revision(db: &qubite_db::Database, id: Uuid) -> i64 {
    sqlx::query_scalar("SELECT revision FROM objects WHERE id = $1")
        .bind(id)
        .fetch_one(db.pool())
        .await
        .unwrap()
}

fn patch(id: Uuid, base_revision: i64, fields: Value) -> Value {
    json!({
        "op_id": Uuid::now_v7(),
        "object_id": id,
        "kind": "patch",
        "base_revision": base_revision,
        "fields": fields,
    })
}

/// Лента проекта — только пока дело в нём: перенесённое из другого проекта
/// не тянет свою прошлую историю. Страница ленты полная: короткая — значит,
/// дальше ничего нет (иначе «Показать ещё» пропадало раньше времени).
#[tokio::test]
async fn project_feed_shows_only_membership_and_full_pages() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let (a, b, moved) = (Uuid::now_v7(), Uuid::now_v7(), Uuid::now_v7());
    push(
        &mut owner,
        address,
        vec![
            create(a, "planner.project", "A", json!({})),
            create(b, "planner.project", "B", json!({})),
            create(moved, "planner.task", "Дело", json!({ "project_id": a })),
        ],
    )
    .await;
    let r = revision(&db, moved).await;
    push(
        &mut owner,
        address,
        vec![patch(moved, r, json!({ "due_date": "2030-01-07" }))],
    )
    .await;
    let r = revision(&db, moved).await;
    push(
        &mut owner,
        address,
        vec![patch(moved, r, json!({ "project_id": b }))],
    )
    .await;
    let r = revision(&db, moved).await;
    push(
        &mut owner,
        address,
        vec![patch(moved, r, json!({ "due_date": "2030-01-08" }))],
    )
    .await;

    let page_b = owner.get(address, &format!("/api/v1/projects/{b}")).await;
    assert_eq!(page_b.status, 200, "{:?}", page_b.body);
    let feed_b = kinds(&page_b.body);
    assert!(
        !feed_b.contains(&"task:created".to_owned()),
        "дело создано в A — в ленте B его рождения нет: {feed_b:?}"
    );
    // В B — перенос (вход в проект) и правка после него; правки срока в A нет.
    let changed: Vec<&Value> = page_b.body["feed"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|item| item["kind"] == "changed")
        .map(|item| &item["details"])
        .collect();
    assert_eq!(
        changed,
        [&json!(["due_date"]), &json!(["project"])],
        "{feed_b:?}"
    );
    let feed_a = kinds(
        &owner
            .get(address, &format!("/api/v1/projects/{a}"))
            .await
            .body,
    );
    assert!(feed_a.contains(&"task:created".to_owned()), "{feed_a:?}");

    // 60 дел: у каждого «новое» и связь с проектом (её в ленте нет). Страница —
    // ровно 50 строк, остальное (10 дел и сам проект) — на следующей.
    let many = Uuid::now_v7();
    let mut ops = vec![create(many, "planner.project", "Много", json!({}))];
    for i in 0..60 {
        ops.push(create(
            Uuid::now_v7(),
            "planner.task",
            &format!("Дело {i}"),
            json!({ "project_id": many }),
        ));
    }
    push(&mut owner, address, ops).await;
    let page = owner
        .get(address, &format!("/api/v1/projects/{many}"))
        .await;
    let first = page.body["feed"].as_array().unwrap();
    assert_eq!(first.len(), 50, "{:?}", page.body);
    let rest = owner
        .get(
            address,
            &format!(
                "/api/v1/projects/{many}/feed?before={}",
                first.last().unwrap()["seq"]
            ),
        )
        .await;
    assert_eq!(rest.body["items"].as_array().unwrap().len(), 11);

    // Память проекта со «служебным» названием заводится под понятным путём.
    let site = Uuid::now_v7();
    push(
        &mut owner,
        address,
        vec![create(site, "planner.project", "Сайт: v2", json!({}))],
    )
    .await;
    let page = owner
        .get(address, &format!("/api/v1/projects/{site}"))
        .await;
    assert_eq!(page.body["memory_path"], "Проекты/Сайт v2.md");
    let made = owner
        .post_json(
            address,
            "/api/v1/agent/files",
            json!({ "path": page.body["memory_path"], "body": "" }),
        )
        .await;
    assert!(made.status.is_success(), "{:?}", made.body);
    let page = owner
        .get(address, &format!("/api/v1/projects/{site}"))
        .await;
    assert_eq!(page.body["memory"]["path"], "Проекты/Сайт v2.md");

    db.close().await;
    test_db.drop_db().await;
}
