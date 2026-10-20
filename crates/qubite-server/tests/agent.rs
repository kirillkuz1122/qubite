//! Лента агента через настоящий HTTP-сервер (AGT-002): грант `agent`,
//! лента у дела и проекта, откат, конфликт, пакет, «исправить».

mod common;

use common::logged_in;
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_server::{agent::AgentCommand, auth::AuthSettings};
use serde_json::{Value, json};
use uuid::Uuid;

fn find<'a>(items: &'a [Value], summary: &str) -> &'a Value {
    items
        .iter()
        .find(|item| item["summary"].as_str().unwrap().starts_with(summary))
        .unwrap_or_else(|| panic!("нет «{summary}» в {items:#?}"))
}

#[tokio::test]
async fn timeline_revert_conflict_and_fix_over_http() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;

    // Человек без гранта `agent` ленты не видит.
    qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "student@qubite.ru",
            display_name: "",
            password: "пароль ученика",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut student = common::Browser::default();
    let reply = student
        .login(address, "student@qubite.ru", "пароль ученика")
        .await;
    assert_eq!(reply.status, 200);
    let reply = student.get(address, "/api/v1/agent/timeline").await;
    assert_eq!(reply.status, 403, "{:?}", reply.body);

    // Пример без AI: агент разложил мысль (пакет из двух шагов), создал и перенёс дело.
    let said = qubite_server::agent::run(&db, AgentCommand::Demo { email: None })
        .await
        .unwrap();
    assert!(said.starts_with("Готово"));
    let reply = owner.get(address, "/api/v1/agent/timeline").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let items = reply.body["items"].as_array().unwrap().clone();
    assert_eq!(items.len(), 4);
    assert!(reply.body["next"].is_null());
    let moved = find(&items, "Перенёс «Сходить в музей»");
    assert_eq!(moved["actor"], "agent");
    assert_eq!(moved["reason"], "в субботу обещают дождь (пример)");
    let museum = moved["changes"][0]["object_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let diff = moved["changes"][0]["diff"].as_array().unwrap();
    assert_eq!(diff.len(), 1);
    assert_eq!(diff[0]["field"], "due_date");
    let filed = find(&items, "Разложил мысль «упр. 145 по русскому»");
    assert_eq!(filed["state"]["batch_size"], 2);
    let batch = filed["batch_id"].as_str().unwrap().to_owned();
    let project = find(&items, "Создал проект «Русский (пример)»")["changes"][0]["object_id"]
        .as_str()
        .unwrap()
        .to_owned();

    // Лента у дела и у проекта; два фильтра сразу — нельзя.
    let reply = owner
        .get(address, &format!("/api/v1/agent/timeline?object={museum}"))
        .await;
    assert_eq!(reply.body["items"].as_array().unwrap().len(), 2);
    let reply = owner
        .get(
            address,
            &format!("/api/v1/agent/timeline?project={project}"),
        )
        .await;
    assert_eq!(reply.body["items"].as_array().unwrap().len(), 2);
    let reply = owner
        .get(
            address,
            &format!("/api/v1/agent/timeline?object={museum}&project={project}"),
        )
        .await;
    assert_eq!(reply.status, 400);
    let reply = owner.get(address, "/api/v1/agent/timeline?limit=3").await;
    assert_eq!(reply.body["items"].as_array().unwrap().len(), 3);
    let next = reply.body["next"].as_i64().unwrap();
    let reply = owner
        .get(address, &format!("/api/v1/agent/timeline?before={next}"))
        .await;
    assert_eq!(reply.body["items"].as_array().unwrap().len(), 1);

    // Ты передвинул музей на другой день — откат переноса не затирает, а спрашивает.
    let revision: i64 = sqlx::query_scalar("SELECT revision FROM objects WHERE id = $1")
        .bind(museum.parse::<Uuid>().unwrap())
        .fetch_one(db.pool())
        .await
        .unwrap();
    let reply = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            json!({ "device_id": Uuid::now_v7(), "ops": [{
                "op_id": Uuid::now_v7(), "object_id": museum, "base_revision": revision,
                "kind": "patch", "fields": { "due_date": "2030-01-07" },
            }]}),
        )
        .await;
    assert_eq!(
        reply.body["results"][0]["status"], "applied",
        "{:?}",
        reply.body
    );
    let path = format!(
        "/api/v1/agent/actions/{}/revert",
        moved["id"].as_str().unwrap()
    );
    let reply = owner.post_json(address, &path, json!({})).await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["status"], "conflict");
    let conflict = &reply.body["conflicts"][0];
    assert_eq!(conflict["field"], "due_date");
    assert_eq!(conflict["action"], diff[0]["after"]);
    assert_eq!(conflict["before"], diff[0]["before"]);
    assert_eq!(conflict["now"], "2030-01-07");
    // «Вернуть как было».
    let reply = owner
        .post_json(address, &path, json!({ "force": true }))
        .await;
    assert_eq!(reply.body["status"], "reverted", "{:?}", reply.body);
    let revert_id = reply.body["actions"][0]["id"].as_str().unwrap().to_owned();
    assert_eq!(reply.body["actions"][0]["actor"], "owner");
    assert_eq!(reply.body["actions"][0]["tool"], "timeline.revert");
    let reply = owner
        .get(
            address,
            &format!("/api/v1/agent/actions/{}", moved["id"].as_str().unwrap()),
        )
        .await;
    assert_eq!(reply.body["state"]["reverted_by"], revert_id.as_str());
    // Второй раз — уже откачено.
    let reply = owner.post_json(address, &path, json!({})).await;
    assert_eq!(reply.status, 409);
    assert_eq!(reply.body["error"], "not_revertible");

    // Пакет «разложил мысль» — одной кнопкой.
    let reply = owner
        .post_json(
            address,
            &format!("/api/v1/agent/batches/{batch}/revert"),
            json!({}),
        )
        .await;
    assert_eq!(reply.body["status"], "reverted", "{:?}", reply.body);
    assert_eq!(reply.body["actions"].as_array().unwrap().len(), 2);
    let status: String = sqlx::query_scalar(
        "SELECT i.status FROM inbox_items i JOIN objects o ON o.id = i.object_id \
         WHERE o.title = 'упр. 145 по русскому'",
    )
    .fetch_one(db.pool())
    .await
    .unwrap();
    assert_eq!(status, "new", "мысль снова ждёт разбора");

    // «Исправить»: не 14:00, а 15:00 — твоя поправка к действию агента.
    let created = find(&items, "Создал дело «Сходить в музей»");
    let reply = owner
        .post_json(
            address,
            &format!(
                "/api/v1/agent/actions/{}/fix",
                created["id"].as_str().unwrap()
            ),
            json!({ "object_id": museum, "fields": { "due_time": "15:00" } }),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["corrects"], created["id"]);
    assert_eq!(reply.body["actor"], "owner");
    assert!(
        reply.body["summary"]
            .as_str()
            .unwrap()
            .starts_with("Поправил дело «Сходить в музей»")
    );
    // Объект не из этого действия — 404.
    let reply = owner
        .post_json(
            address,
            &format!(
                "/api/v1/agent/actions/{}/fix",
                created["id"].as_str().unwrap()
            ),
            json!({ "object_id": project, "title": "x" }),
        )
        .await;
    assert_eq!(reply.status, 404);

    // Чужую ленту не видно и не откатить.
    let reply = student.post_json(address, &path, json!({})).await;
    assert_eq!(reply.status, 403);

    test_db.drop_db().await;
}
