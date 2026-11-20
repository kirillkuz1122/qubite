mod common;

use common::{Browser, PASSWORD, logged_in_unconfirmed, setup};
use qubite_server::auth::AuthSettings;
use serde_json::{Value, json};
use std::net::SocketAddr;
use time::{Duration, OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

const SCHEDULES: &str = "/api/pult/schedules";
const DUE: &str = "/api/pult/schedules/due";
const RUNS: &str = "/api/pult/schedules/runs";

fn schedule(name: &str, cap_tokens: Option<i64>, cap_usd: Option<f64>) -> Value {
    json!({
        "name": name,
        "kind": "quiet",
        "schedule_text": "пт 18:00",
        "days": [4],
        "where_run": "pi",
        "cap_tokens": cap_tokens,
        "cap_usd": cap_usd
    })
}

async fn collector(address: SocketAddr, owner: &mut Browser) -> String {
    let response = owner
        .post_json(
            address,
            "/api/owner/pult/collectors",
            json!({ "name": "Тест" }),
        )
        .await;
    assert_eq!(response.status, 201, "{:?}", response.body);
    response.body["token"].as_str().unwrap().into()
}

async fn report(address: SocketAddr, token: &str, run: &Value) -> u16 {
    qubite_testkit::http_client()
        .post(format!("http://{address}{RUNS}"))
        .bearer_auth(token)
        .json(run)
        .send()
        .await
        .unwrap()
        .status()
        .as_u16()
}

#[tokio::test]
async fn rolling_token_cap_pauses_and_owner_can_raise_it() {
    let (test_db, _db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in_unconfirmed(address).await;
    let token = collector(address, &mut owner).await;
    let created = owner
        .post_json(address, SCHEDULES, schedule("Проверка", Some(100), None))
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let id = created.body["id"].as_str().unwrap();
    let path = format!("{SCHEDULES}/{id}");
    let off = owner
        .post_json(address, SCHEDULES, schedule("Выключена", None, None))
        .await;
    let off_id = off.body["id"].as_str().unwrap();
    assert_eq!(
        owner
            .patch_json(
                address,
                &format!("{SCHEDULES}/{off_id}"),
                json!({"enabled": false}),
            )
            .await
            .status,
        200
    );

    let old = (OffsetDateTime::now_utc() - Duration::days(8))
        .format(&Rfc3339)
        .unwrap();
    assert_eq!(
        report(
            address,
            &token,
            &json!({"name": "Проверка", "at": old, "tokens": 1000, "usd": 5, "outcome": "found"}),
        )
        .await,
        204
    );

    for (added, total, status) in [(79, 79, "ok"), (1, 80, "warn"), (20, 100, "reached")] {
        let run = json!({
            "id": Uuid::now_v7(),
            "name": "Проверка",
            "tokens": added,
            "usd": 0,
            "outcome": "quiet"
        });
        assert_eq!(report(address, &token, &run).await, 204);
        assert_eq!(report(address, &token, &run).await, 204);
        let list = owner.get(address, SCHEDULES).await;
        assert_eq!(list.status, 200, "{:?}", list.body);
        let row = list.body["schedules"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["id"] == id)
            .unwrap();
        assert_eq!(row["tokens_7d"].as_f64(), Some(f64::from(total)));
        assert_eq!(row["cap_percent"].as_f64(), Some(f64::from(total)));
        assert_eq!(row["cap_status"], status);
        assert_eq!(row["last_outcome"], "quiet");
        assert_eq!(row["enabled"], total < 100);
        let due = owner.get(address, DUE).await;
        assert_eq!(due.status, 200, "{:?}", due.body);
        assert_eq!(
            due.body.as_array().unwrap().len(),
            if total < 100 { 1 } else { 0 }
        );
        if total < 100 {
            assert_eq!(due.body[0]["id"], id);
        }
    }

    let board = owner.get(address, "/api/owner/pult").await;
    assert_eq!(board.body["waiting"][0]["key"], id);
    assert_eq!(board.body["waiting"][0]["number"], Value::Null);
    assert_eq!(board.body["counts"]["waiting"], 1);
    let conflict = owner
        .patch_json(address, &path, json!({"enabled": true}))
        .await;
    assert_eq!(conflict.status, 409);
    assert_eq!(conflict.body["error"], "schedule_cap_reached");

    // Раннер мог закончить уже начатую работу после паузы.
    assert_eq!(
        report(
            address,
            &token,
            &json!({"name": "Проверка", "tokens": 1, "usd": 0, "outcome": "failed"}),
        )
        .await,
        204
    );
    let resumed = owner
        .patch_json(address, &path, json!({"enabled": true, "cap_tokens": 200}))
        .await;
    assert_eq!(resumed.status, 200, "{:?}", resumed.body);
    assert_eq!(resumed.body["enabled"], true);
    assert_eq!(resumed.body["paused_reason"], Value::Null);
    assert_eq!(resumed.body["tokens_7d"].as_f64(), Some(101.0));

    // Задачу переименовали между `due` и отчётом: отчёт по ID всё равно находит её,
    // а по старому имени — нет.
    let renamed = owner
        .patch_json(address, &path, json!({"name": "Проверка 2"}))
        .await;
    assert_eq!(renamed.status, 200, "{:?}", renamed.body);
    assert_eq!(
        report(
            address,
            &token,
            &json!({"schedule_id": id, "tokens": 0, "usd": 0, "outcome": "quiet"}),
        )
        .await,
        204
    );
    assert_eq!(
        report(
            address,
            &token,
            &json!({"name": "Проверка", "tokens": 0, "usd": 0, "outcome": "quiet"}),
        )
        .await,
        404
    );
    assert_eq!(owner.get(address, DUE).await.body[0]["id"], id);
    assert_eq!(
        owner.get(address, "/api/owner/pult").await.body["waiting"],
        json!([])
    );

    let log = owner.get(address, "/api/owner/audit").await;
    assert!(log.body.to_string().contains("pult.schedule_paused"));
    assert_eq!(owner.delete(address, &path).await.status, 204);
    assert_eq!(owner.get(address, DUE).await.body, json!([]));
    test_db.drop_db().await;
}

#[tokio::test]
async fn dollar_cap_and_explicit_removal() {
    let (test_db, _db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in_unconfirmed(address).await;
    let created = owner
        .post_json(address, SCHEDULES, schedule("Отчёт", Some(1000), Some(1.0)))
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let path = format!("{SCHEDULES}/{}", created.body["id"].as_str().unwrap());
    for (added, status) in [(0.79, "ok"), (0.01, "warn"), (0.20, "reached")] {
        assert_eq!(
            owner
                .post_json(
                    address,
                    RUNS,
                    json!({
                        "name": "Отчёт", "tokens": 1, "usd": added, "outcome": "found"
                    }),
                )
                .await
                .status,
            204
        );
        let list = owner.get(address, SCHEDULES).await;
        assert_eq!(list.body["schedules"][0]["cap_status"], status);
    }
    let resumed = owner
        .patch_json(address, &path, json!({"enabled": true, "cap_usd": null}))
        .await;
    assert_eq!(resumed.status, 200, "{:?}", resumed.body);
    assert_eq!(resumed.body["cap_usd"], Value::Null);
    assert_eq!(resumed.body["cap_tokens"], 1000);
    assert_eq!(resumed.body["enabled"], true);
    test_db.drop_db().await;
}

#[tokio::test]
async fn owner_only_except_collector_run_reports() {
    let (test_db, _db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in_unconfirmed(address).await;
    owner.confirm(address, PASSWORD).await;
    let email = "pult-friend@qubite.ru";
    let password = "длинный пароль друга";
    assert_eq!(
        owner
            .post_json(
                address,
                "/api/owner/accounts",
                json!({ "email": email, "display_name": "Друг", "password": password }),
            )
            .await
            .status,
        201
    );
    let mut friend = Browser::default();
    assert_eq!(friend.login(address, email, password).await.status, 200);
    let definition = schedule("Тихая", None, None);
    let created = owner
        .post_json(address, SCHEDULES, definition.clone())
        .await;
    assert_eq!(created.status, 201, "{:?}", created.body);
    let path = format!("{SCHEDULES}/{}", created.body["id"].as_str().unwrap());
    let run = json!({"name": "Тихая", "tokens": 0, "usd": 0, "outcome": "quiet"});

    assert_eq!(friend.get(address, SCHEDULES).await.status, 403);
    assert_eq!(friend.get(address, DUE).await.status, 403);
    assert_eq!(
        friend
            .post_json(address, SCHEDULES, definition.clone())
            .await
            .status,
        403
    );
    assert_eq!(
        friend
            .patch_json(address, &path, json!({"enabled": false}))
            .await
            .status,
        403
    );
    assert_eq!(friend.delete(address, &path).await.status, 403);
    assert_eq!(
        friend.post_json(address, RUNS, run.clone()).await.status,
        403
    );

    let token = collector(address, &mut owner).await;
    let client = qubite_testkit::http_client();
    let base = format!("http://{address}");
    let forbidden = [
        client.get(format!("{base}{SCHEDULES}")),
        client.get(format!("{base}{DUE}")),
        client.post(format!("{base}{SCHEDULES}")).json(&definition),
        client
            .patch(format!("{base}{path}"))
            .json(&json!({"enabled": false})),
        client.delete(format!("{base}{path}")),
    ];
    for request in forbidden {
        assert_eq!(
            request.bearer_auth(&token).send().await.unwrap().status(),
            403
        );
    }
    assert_eq!(report(address, "qpult_invalid", &run).await, 401);
    assert_eq!(report(address, &token, &run).await, 204);
    test_db.drop_db().await;
}
