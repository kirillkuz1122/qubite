mod common;

use std::net::SocketAddr;

use common::{Browser, logged_in, logged_in_unconfirmed, setup};
use qubite_server::auth::AuthSettings;
use reqwest::{Method, Response};
use serde_json::{Value, json};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

const RECOS: &str = "/api/pult/recos";
const REPORT: &str = "/api/pult/recos/report";
const WEEK: &str = "/api/pult/recos/week";
const APPLY: &str = "/api/pult/recos/apply";
const QUEUE: &str = "/api/pult/recos/batches?status=queued";

async fn collector(address: SocketAddr, owner: &mut Browser) -> String {
    let response = owner
        .post_json(
            address,
            "/api/owner/pult/collectors",
            json!({"name": "Recos"}),
        )
        .await;
    assert_eq!(response.status, 201, "{:?}", response.body);
    response.body["token"].as_str().unwrap().into()
}

async fn collect(
    address: SocketAddr,
    token: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> Response {
    let mut request = qubite_testkit::http_client()
        .request(method, format!("http://{address}{path}"))
        .bearer_auth(token);
    if let Some(body) = body {
        request = request.json(&body);
    }
    request.send().await.unwrap()
}

fn card(reference: &str, title: &str) -> Value {
    json!({
        "ref": reference, "arms": "memory", "title": title, "noticed": "Дублируется правило",
        "will_do": "Поставлю ссылку", "effort": "S", "saving": null,
        "files": ["AGENTS.md"], "joker": false
    })
}

async fn report(address: SocketAddr, token: &str, week: &str, cards: Vec<Value>) -> u16 {
    collect(
        address,
        token,
        Method::POST,
        REPORT,
        Some(json!({"week": week, "cards": cards})),
    )
    .await
    .status()
    .as_u16()
}

fn find_card<'a>(list: &'a Value, reference: &str) -> &'a Value {
    list["cards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|card| card["ref"] == reference)
        .unwrap()
}

#[tokio::test]
async fn report_replaces_only_new_cards_of_the_same_week() {
    let (test_db, _db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in_unconfirmed(address).await;
    let token = collector(address, &mut owner).await;
    assert_eq!(owner.get(address, RECOS).await.body["cards"], json!([]));
    // Свежая БД, первая запись с NULL в saving проходит ограничения миграции.
    assert_eq!(
        report(
            address,
            &token,
            "2026-W47",
            vec![
                card("keep", "Выбрано"),
                card("change", "Было"),
                card("delete", "Удалится"),
                card("decline", "Отклонено"),
                card("defer", "Отложено"),
            ],
        )
        .await,
        204
    );
    let first = owner.get(address, RECOS).await.body;
    assert_eq!(first["counts"]["memory"], 5);
    assert_eq!(find_card(&first, "keep")["saving"], Value::Null);
    for (reference, status) in [("keep", "basket"), ("decline", "no"), ("defer", "later")] {
        let id = find_card(&first, reference)["id"].as_str().unwrap();
        assert_eq!(
            owner
                .patch_json(address, &format!("{RECOS}/{id}"), json!({"status": status}))
                .await
                .status,
            200
        );
    }
    assert_eq!(
        report(
            address,
            &token,
            "2026-W47",
            vec![
                card("keep", "Не заменит выбор"),
                card("change", "Стало"),
                card("add", "Добавлено"),
            ],
        )
        .await,
        204
    );
    let second = owner.get(address, RECOS).await.body;
    assert_eq!(second["basket_count"], 1);
    assert_eq!(second["counts"]["all"], 5);
    assert_eq!(find_card(&second, "keep")["title"], "Выбрано");
    assert_eq!(find_card(&second, "keep")["status"], "basket");
    assert_eq!(find_card(&second, "decline")["status"], "no");
    assert_eq!(find_card(&second, "defer")["status"], "later");
    assert_eq!(find_card(&second, "change")["title"], "Стало");
    assert_ne!(
        find_card(&second, "change")["id"],
        find_card(&first, "change")["id"]
    );

    assert_eq!(
        report(
            address,
            &token,
            "2026-W48",
            vec![card("next", "Новая неделя")]
        )
        .await,
        204
    );
    let latest = owner.get(address, RECOS).await.body;
    assert_eq!(latest["week"], "2026-W48");
    assert_eq!(latest["counts"]["all"], 1);
    assert_eq!(latest["older_basket"][0]["ref"], "keep");
    test_db.drop_db().await;
}

#[tokio::test]
async fn apply_writes_one_brief_and_collector_takes_it_once() {
    let (test_db, _db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in_unconfirmed(address).await;
    let token = collector(address, &mut owner).await;
    assert_eq!(owner.post(address, APPLY).await.status, 409);
    let mut with_saving = card("a", "Сжать правила");
    with_saving["saving"] = json!("≈ 5000 токенов");
    assert_eq!(
        report(
            address,
            &token,
            "2026-W47",
            vec![
                with_saving,
                card("b", "Проверить ссылки"),
                card("c", "Лишняя карточка"),
            ],
        )
        .await,
        204
    );
    let list = owner.get(address, RECOS).await.body;
    let a = find_card(&list, "a")["id"].as_str().unwrap();
    let b = find_card(&list, "b")["id"].as_str().unwrap();
    for id in [a, b] {
        let path = format!("{RECOS}/{id}");
        let updated = owner
            .patch_json(address, &path, json!({"status": "basket"}))
            .await;
        assert_eq!(updated.status, 200);
    }
    assert_eq!(
        owner.get(address, RECOS).await.body["basket_saving"],
        "≈ 5000 токенов"
    );
    let applied = owner.post(address, APPLY).await;
    assert_eq!(applied.status, 201, "{:?}", applied.body);
    assert_eq!(applied.body["card_ids"], json!([a, b]));
    assert_eq!(applied.body["status"], "queued");
    assert_eq!(applied.body["taken_at"], Value::Null);
    let brief = applied.body["brief"].as_str().unwrap();
    for text in [
        "Сжать правила",
        "Проверить ссылки",
        "AGENTS.md",
        "один PR",
        "Вливает владелец",
    ] {
        assert!(brief.contains(text), "{brief}");
    }
    assert!(!brief.contains("Лишняя карточка"));
    assert_eq!(owner.post(address, APPLY).await.status, 409);
    assert_eq!(
        report(
            address,
            &token,
            "2026-W47",
            vec![card("a", "Не заменит задание")]
        )
        .await,
        204
    );
    let list = owner.get(address, RECOS).await.body;
    assert_eq!(list["basket_count"], 0);
    assert_eq!(find_card(&list, "a")["status"], "applied");
    assert_eq!(find_card(&list, "a")["title"], "Сжать правила");
    assert_eq!(
        owner
            .patch_json(
                address,
                &format!("{RECOS}/{a}"),
                json!({"status": "basket"})
            )
            .await
            .status,
        409
    );

    let queued: Value = collect(address, &token, Method::GET, QUEUE, None)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(queued, json!([applied.body]));
    let id = queued[0]["id"].as_str().unwrap();
    let take = format!("{RECOS}/batches/{id}/taken");
    assert_eq!(
        collect(address, &token, Method::POST, &take, None)
            .await
            .status(),
        204
    );
    assert_eq!(
        collect(address, &token, Method::POST, &take, None)
            .await
            .status(),
        409
    );
    let queued: Value = collect(address, &token, Method::GET, QUEUE, None)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(queued, json!([]));
    let taken: Value = collect(
        address,
        &token,
        Method::GET,
        "/api/pult/recos/batches?status=taken",
        None,
    )
    .await
    .json()
    .await
    .unwrap();
    assert_eq!(taken[0]["status"], "taken");
    assert!(taken[0]["taken_at"].is_string());
    let audit = owner
        .get(address, "/api/owner/audit")
        .await
        .body
        .to_string();
    assert!(audit.contains("pult.reco_decided"));
    assert!(audit.contains("pult.reco_applied"));
    test_db.drop_db().await;
}

#[tokio::test]
async fn recos_require_the_right_credential_and_week_uses_collected_data() {
    let (test_db, _db, address) = setup(AuthSettings::default()).await;
    let mut owner = logged_in(address).await;
    let token = collector(address, &mut owner).await;
    let mut anonymous = Browser::default();
    let mut friend = Browser::default();
    let email = "recos-friend@qubite.ru";
    let password = "длинный пароль друга";
    assert_eq!(
        owner
            .post_json(
                address,
                "/api/owner/accounts",
                json!({"email": email, "display_name": "Друг", "password": password}),
            )
            .await
            .status,
        201
    );
    assert_eq!(friend.login(address, email, password).await.status, 200);
    let unknown = Uuid::now_v7();
    let patch = format!("{RECOS}/{unknown}");
    let take = format!("{RECOS}/batches/{unknown}/taken");
    for (method, path) in [
        (Method::GET, RECOS),
        (Method::PATCH, &patch),
        (Method::POST, APPLY),
        (Method::POST, REPORT),
        (Method::GET, WEEK),
        (Method::GET, QUEUE),
        (Method::POST, &take),
    ] {
        assert_eq!(
            anonymous
                .send(address, method.clone(), path, Some(json!({})), true)
                .await
                .status,
            404
        );
        assert_eq!(
            friend
                .send(address, method, path, Some(json!({})), true)
                .await
                .status,
            403
        );
    }
    assert_eq!(owner.get(address, WEEK).await.status, 403);
    assert_eq!(
        collect(address, &token, Method::GET, RECOS, None)
            .await
            .status(),
        404
    );
    assert_eq!(
        report(address, "qpult_invalid", "2026-W47", vec![]).await,
        401
    );
    assert_eq!(report(address, &token, "2026-W00", vec![]).await, 400);

    let empty: Value = collect(address, &token, Method::GET, WEEK, None)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(empty, json!([]));
    // Пустой отчёт недели не принимается: он не запомнил бы неделю.
    assert_eq!(report(address, &token, "2026-W48", vec![]).await, 400);
    let now = OffsetDateTime::now_utc();
    let at = now.format(&Rfc3339).unwrap();
    let day = now.date().to_string();
    let report = json!({
        "version": 1,
        "source": "cloud",
        "host": "облако",
        "at": at,
        "sessions": [{
            "id": "session",
            "title": "Личный заголовок",
            "branch": "task/AOS-293b",
            "model": "claude-sonnet-5",
            "started_at": at,
            "last_at": at,
            "usage": [{"model": "claude-sonnet-5", "output": 42}]
        }],
        "days": [{"date": day, "usage": [{"model": "claude-sonnet-5", "output": 42}]}]
    });
    assert_eq!(
        collect(
            address,
            &token,
            Method::POST,
            "/api/pult/report",
            Some(report)
        )
        .await
        .status(),
        204
    );
    let week: Value = collect(address, &token, Method::GET, WEEK, None)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(week["sessions"][0]["tokens"], 42);
    assert_eq!(week["days"][0]["tokens"], 42);
    assert_eq!(week["top"]["title"], "AOS-293b");
    assert!(!week.to_string().contains("Личный заголовок"));
    test_db.drop_db().await;
}
