//! Навыки агента через настоящий HTTP-сервер (AGT-003): список с описаниями,
//! закрепить, в архив и вернуть — строки ленты; куратор и урок на поправке —
//! задачи очереди, как в `qubite serve`.

mod common;

use common::logged_in;
use qubite_ai::{AiConfig, Gateway};
use qubite_notify::deliver::Channels;
use qubite_server::{agent_memory, auth::AuthSettings};
use serde_json::{Value, json};
use time::OffsetDateTime;

fn skill<'a>(list: &'a Value, name: &str) -> &'a Value {
    list["skills"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["name"] == name)
        .unwrap_or_else(|| panic!("нет {name} в {list:#?}"))
}

#[tokio::test]
async fn skills_screen_pin_archive_restore_and_curator_over_http() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let pool = db.pool();
    let mut owner = logged_in(address).await;

    // Встроенные навыки — сразу, с описаниями; навык не даёт новых инструментов.
    let list = owner.get(address, "/api/v1/agent/skills").await;
    assert_eq!(list.status, 200, "{:?}", list.body);
    assert_eq!(list.body["unused_days"], 30);
    let homework = skill(&list.body, "ДЗ к уроку").clone();
    assert_eq!(homework["builtin"], true);
    assert_eq!(homework["archived"], false);
    assert_eq!(homework["uses"], 0);
    assert!(
        homework["description"]
            .as_str()
            .unwrap()
            .contains("накануне")
    );
    assert!(homework["archive_after"].is_string());
    let id = homework["id"].as_str().unwrap().to_owned();
    // Навык — файл папки: читать и выгружать как SKILL.md.
    let files = owner.get(address, "/api/v1/agent/files").await;
    let file = files.body["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["id"] == id.as_str())
        .unwrap();
    assert_eq!(file["kind"], "skill");
    assert_eq!(file["pinned"], false);

    // Закрепить: куратор не трогает; второй раз — 400.
    let pinned = owner
        .post_json(
            address,
            &format!("/api/v1/agent/skills/{id}/pin"),
            json!({"pinned": true}),
        )
        .await;
    assert_eq!(pinned.status, 200, "{:?}", pinned.body);
    assert_eq!(pinned.body["tool"], "skill.pin");
    assert_eq!(pinned.body["summary"], "Закрепил навык «ДЗ к уроку»");
    let again = owner
        .post_json(
            address,
            &format!("/api/v1/agent/skills/{id}/pin"),
            json!({"pinned": true}),
        )
        .await;
    assert_eq!(again.status, 400);

    // Куратор (задача очереди): через 31 день незакреплённые — в архив.
    sqlx::query(
        "UPDATE objects SET created_at = now() - interval '40 days' WHERE type = 'agent.file'",
    )
    .execute(pool)
    .await
    .unwrap();
    qubite_agent::skills::schedule_curator(pool, OffsetDateTime::now_utc())
        .await
        .unwrap();
    let gateway = Gateway::new(pool.clone(), AiConfig::default());
    assert_eq!(
        agent_memory::run_ready(pool, &gateway, &Channels::default())
            .await
            .unwrap(),
        1
    );
    let next: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM jobs WHERE kind = 'agent.curate' AND run_at > now() + interval '6 days'",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(next, 1, "следующий обход — через неделю");
    let list = owner.get(address, "/api/v1/agent/skills").await;
    assert_eq!(
        skill(&list.body, "ДЗ к уроку")["archived"],
        false,
        "закреплён"
    );
    let outing = skill(&list.body, "Сходить куда-то").clone();
    assert_eq!(outing["archived"], true);
    assert!(outing["archive_after"].is_null());
    let timeline = owner.get(address, "/api/v1/agent/timeline").await;
    let curated = timeline.body["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|a| a["tool"] == "skill.curate")
        .unwrap();
    assert_eq!(curated["actor"], "system");

    // Вернуть одной кнопкой.
    let outing_id = outing["id"].as_str().unwrap();
    let restored = owner
        .post(
            address,
            &format!("/api/v1/agent/skills/{outing_id}/restore"),
        )
        .await;
    assert_eq!(restored.status, 200, "{:?}", restored.body);
    assert_eq!(
        restored.body["summary"],
        "Вернул из архива навык «Сходить куда-то»"
    );
    let archived = owner
        .post(
            address,
            &format!("/api/v1/agent/skills/{outing_id}/archive"),
        )
        .await;
    assert_eq!(archived.status, 200);
    // Не навык — 404.
    let memory = files.body["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == "Память.md")
        .unwrap();
    let not_skill = owner
        .post(
            address,
            &format!(
                "/api/v1/agent/skills/{}/archive",
                memory["id"].as_str().unwrap()
            ),
        )
        .await;
    assert_eq!(not_skill.status, 404);

    db.close().await;
    test_db.drop_db().await;
}
