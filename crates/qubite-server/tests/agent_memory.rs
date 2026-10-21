//! Папка агента, разговор и вопросы через настоящий HTTP-сервер (AGT-001).
//! Модель — поддельная: ответы агента готовит обработчик очереди, как в
//! `qubite serve`, только запускает его тест.

mod common;

use std::sync::{Arc, Mutex};

use common::logged_in;
use qubite_ai::{
    AiConfig, Gateway, MockProvider, MockStep,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_notify::{BoxFuture, Button, Telegram, deliver::Channels};
use qubite_server::{agent_memory, auth::AuthSettings};
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

/// Telegram, который просто запоминает отправленное.
#[derive(Default)]
struct FakeTelegram {
    sent: Mutex<Vec<(i64, String)>>,
}

impl Telegram for FakeTelegram {
    fn send<'a>(
        &'a self,
        chat: i64,
        text: &'a str,
        _buttons: &'a [Button],
    ) -> BoxFuture<'a, Result<i64, String>> {
        Box::pin(async move {
            let mut sent = self.sent.lock().unwrap();
            sent.push((chat, text.to_owned()));
            Ok(1000 + i64::try_from(sent.len()).unwrap())
        })
    }

    fn edit<'a>(
        &'a self,
        _chat: i64,
        _message: i64,
        _text: &'a str,
    ) -> BoxFuture<'a, Result<(), String>> {
        Box::pin(async { Ok(()) })
    }
}

fn reply(value: Value) -> MockStep {
    MockStep::Reply {
        text: value.to_string(),
        tokens_in: 100,
        tokens_out: 50,
    }
}

async fn gateway(pool: &PgPool, owner: Uuid, steps: Vec<MockStep>) -> (Gateway, Arc<MockProvider>) {
    let console = qubite_policy::decide_owner(pool, &qubite_policy::Subject::account(owner, None))
        .await
        .unwrap();
    admin::upsert_provider(
        pool,
        &console,
        ProviderSpec {
            id: "mock",
            kind: "mock",
            base_url: "",
            enabled: true,
        },
    )
    .await
    .unwrap();
    admin::upsert_model(
        pool,
        &console,
        ModelSpec {
            id: "mock-agent",
            provider_id: "mock",
            external_id: "mock-model",
            price_in_per_mtok: 0,
            price_out_per_mtok: 1_000_000,
            context_tokens: 100_000,
            enabled: true,
        },
    )
    .await
    .unwrap();
    admin::set_task_model(pool, &console, "agent.chat", Some("mock-agent"))
        .await
        .unwrap();
    admin::set_limit(
        pool,
        &console,
        &LimitScope::User(owner),
        Period::Day,
        Metric::Usd,
        10_000_000,
    )
    .await
    .unwrap();
    let mock = Arc::new(
        MockProvider::new(MockStep::Reply {
            text: "{\"say\": \"Понял\"}".into(),
            tokens_in: 1,
            tokens_out: 1,
        })
        .script(steps),
    );
    (
        Gateway::new(pool.clone(), AiConfig::default()).with_provider("mock", mock.clone()),
        mock,
    )
}

fn file<'a>(files: &'a Value, path: &str) -> &'a Value {
    files["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["path"] == path)
        .unwrap_or_else(|| panic!("нет {path} в {files:#?}"))
}

#[tokio::test]
async fn records_edit_fix_chat_and_questions_over_http() {
    let (test_db, db, address) = common::setup(AuthSettings::default()).await;
    let pool = db.pool();
    let mut owner = logged_in(address).await;
    let me: Uuid = sqlx::query_scalar("SELECT account_id FROM platform_owner")
        .fetch_one(pool)
        .await
        .unwrap();

    // Человек без гранта `agent` папки не видит и агенту не пишет.
    qubite_auth::accounts::create(
        pool,
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
    student
        .login(address, "student@qubite.ru", "пароль ученика")
        .await;
    assert_eq!(
        student.get(address, "/api/v1/agent/files").await.status,
        403
    );
    let said = student
        .post_json(address, "/api/v1/agent/chat", json!({"text": "привет"}))
        .await;
    assert_eq!(said.status, 403, "{:?}", said.body);

    // Папка: три файла и встроенные навыки заводятся сами.
    let list = owner.get(address, "/api/v1/agent/files").await;
    assert_eq!(list.status, 200, "{:?}", list.body);
    let paths: Vec<&str> = list.body["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["path"].as_str().unwrap())
        .collect();
    assert_eq!(
        paths,
        [
            "Кто я.md",
            "О тебе.md",
            "Память.md",
            "Навыки/ДЗ к уроку.md",
            "Навыки/Записать расписание.md",
            "Навыки/Подготовка к контрольной.md",
            "Навыки/Подготовка к олимпиаде.md",
            "Навыки/Проектная деятельность.md",
            "Навыки/Прочитать книгу к сроку.md",
            "Навыки/Сходить куда-то.md",
            "Навыки/Хакатон или конкурс.md"
        ]
    );
    let core = file(&list.body, "Кто я.md");
    assert_eq!(core["kind"], "core");
    assert_eq!(core["limit"], 1500);
    let core = owner
        .get(
            address,
            &format!("/api/v1/agent/files/{}", core["id"].as_str().unwrap()),
        )
        .await;
    assert!(core.body["core"].as_str().unwrap().starts_with("# Кто я"));
    assert_eq!(core.body["body"], "");

    // Руками — поправка в ленте; секреты вычёркиваются; старая версия — 409.
    let memory = file(&list.body, "Память.md").clone();
    let memory_id = memory["id"].as_str().unwrap().to_owned();
    let edited = owner
        .put_json(
            address,
            &format!("/api/v1/agent/files/{memory_id}"),
            json!({"body": "# Память\n\n- Русский — по средам\n- пароль от вк: qwerty77\n", "revision": memory["revision"]}),
        )
        .await;
    assert_eq!(edited.status, 200, "{:?}", edited.body);
    assert_eq!(edited.body["actor"], "owner");
    assert_eq!(edited.body["tool"], "files.edit");
    let stale = owner
        .put_json(
            address,
            &format!("/api/v1/agent/files/{memory_id}"),
            json!({"body": "x", "revision": memory["revision"]}),
        )
        .await;
    assert_eq!(stale.status, 409);

    // «Новый файл» руками (D-391) — строка ленты; такой же второй раз — 400.
    let made = owner
        .post_json(
            address,
            "/api/v1/agent/files",
            json!({"path": "Кружок", "body": "# Кружок\nРобототехника по ср\n"}),
        )
        .await;
    assert_eq!(made.status, 200, "{:?}", made.body);
    assert_eq!(made.body["tool"], "files.create");
    assert_eq!(made.body["summary"], "Завёл файл «Кружок»");
    assert_eq!(made.body["state"]["why"], Value::Null);
    let again = owner
        .post_json(address, "/api/v1/agent/files", json!({"path": "кружок.md"}))
        .await;
    assert_eq!(again.status, 400);
    // «Почему откатил» — только у отката действия агента.
    let why = owner
        .post_json(
            address,
            &format!(
                "/api/v1/agent/batches/{}/why",
                made.body["batch_id"].as_str().unwrap()
            ),
            json!({"answer": "ошибся"}),
        )
        .await;
    assert_eq!(why.status, 404);
    let current = owner
        .get(address, &format!("/api/v1/agent/files/{memory_id}"))
        .await;
    assert!(
        current.body["body"]
            .as_str()
            .unwrap()
            .contains("пароль от вк: [вычеркнуто]")
    );

    // Выгрузка .md с русским именем.
    let client = qubite_testkit::http_client();
    let download = client
        .get(format!(
            "http://{address}/api/v1/agent/files/{memory_id}/download"
        ))
        .header(
            "cookie",
            format!("qubite_session={}", owner.session.clone().unwrap()),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(download.status(), 200);
    assert!(
        download.headers()["content-disposition"]
            .to_str()
            .unwrap()
            .contains("UTF-8''%D0%9F%D0%B0%D0%BC%D1%8F%D1%82%D1%8C.md")
    );
    assert!(
        download
            .text()
            .await
            .unwrap()
            .contains("Русский — по средам")
    );

    // «Поправить» → агент исправляет сразу (поддельная модель), видно в ленте.
    let (gateway, mock) = gateway(
        pool,
        me,
        vec![
            reply(json!({
                "say": "Исправил: русский по вт и чт.",
                "tools": [
                    {"tool": "memory.patch", "args": {"path": "Память.md", "old": "по средам", "new": "по вт и чт"}},
                    {"tool": "question.ask", "args": {"text": "Во сколько кончаются уроки в среду?", "why": "чтобы предлагать ДЗ", "options": ["13:00", "14:00"]}},
                ],
            })),
            // Ответ в Telegram.
            reply(json!({"say": "Привет! Я на связи."})),
            // Ответ на вопрос: агент записывает расписание.
            reply(json!({
                "say": "Спасибо, записал.",
                "tools": [{"tool": "files.create", "args": {"path": "Расписание.md", "body": "| День | Начало | Конец | Что |\n|---|---|---|---|\n| пн, вт, ср, чт, пт, сб, вс | 00:00 | 23:59 | Уроки |\n"}}],
            })),
        ],
    )
    .await;
    let telegram = Arc::new(FakeTelegram::default());
    let channels = Channels {
        telegram: Some(telegram.clone()),
        ..Channels::default()
    };
    let fix = owner
        .post_json(
            address,
            &format!("/api/v1/agent/files/{memory_id}/fix"),
            json!({"text": "Это не так, на самом деле по вт и чт"}),
        )
        .await;
    assert_eq!(fix.status, 202, "{:?}", fix.body);
    assert_eq!(fix.body["status"], "pending");
    let chat = owner.get(address, "/api/v1/agent/chat").await;
    assert_eq!(chat.body["pending"], true);
    assert_eq!(
        agent_memory::run_ready(pool, &gateway, &channels)
            .await
            .unwrap(),
        1
    );
    let chat = owner.get(address, "/api/v1/agent/chat").await;
    assert_eq!(chat.body["pending"], false);
    let messages = chat.body["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[1]["role"], "agent");
    assert_eq!(messages[1]["text"], "Исправил: русский по вт и чт.");
    assert_eq!(messages[1]["actions"], 2);
    let current = owner
        .get(address, &format!("/api/v1/agent/files/{memory_id}"))
        .await;
    assert!(
        current.body["body"]
            .as_str()
            .unwrap()
            .contains("Русский — по вт и чт")
    );
    let timeline = owner.get(address, "/api/v1/agent/timeline").await;
    let summary = timeline.body["items"][1]["summary"].as_str().unwrap();
    assert_eq!(summary, "«Память»: «по средам» → «по вт и чт»");
    assert!(timeline.body["items"][1]["cost_usd_micros"].is_number());

    // Telegram: ответ уходит в тот же чат.
    let posted = qubite_agent::chat::post(
        pool,
        qubite_agent::chat::NewMessage {
            account: me,
            channel: qubite_agent::chat::Channel::Telegram,
            text: "привет".into(),
            file_id: None,
            telegram: Some((4242, 77)),
        },
    )
    .await
    .unwrap();
    agent_memory::run_ready(pool, &gateway, &channels)
        .await
        .unwrap();
    assert_eq!(
        telegram.sent.lock().unwrap().as_slice(),
        [(4242, "Привет! Я на связи.".to_owned())]
    );
    assert!(
        qubite_agent::chat::is_agent_telegram(pool, 4242, 1001)
            .await
            .unwrap(),
        "ответ на это сообщение пойдёт агенту"
    );
    assert_ne!(posted.id, Uuid::nil());

    // «Агент хочет знать»: ответ → в ленте и агенту; расписание → тишина на уроке.
    let questions = owner.get(address, "/api/v1/agent/questions").await;
    let question = &questions.body["questions"][0];
    assert_eq!(question["options"], json!(["13:00", "14:00"]));
    let empty = owner
        .post_json(
            address,
            &format!(
                "/api/v1/agent/questions/{}/answer",
                question["id"].as_str().unwrap()
            ),
            json!({"answer": " "}),
        )
        .await;
    assert_eq!(empty.status, 400);
    let answered = owner
        .post_json(
            address,
            &format!(
                "/api/v1/agent/questions/{}/answer",
                question["id"].as_str().unwrap()
            ),
            json!({"answer": "14:00"}),
        )
        .await;
    assert_eq!(answered.status, 202, "{:?}", answered.body);
    assert_eq!(answered.body["action"]["tool"], "question.answer");
    assert_eq!(answered.body["message"]["channel"], "question");
    agent_memory::run_ready(pool, &gateway, &channels)
        .await
        .unwrap();
    assert_eq!(mock.calls(), 3);
    let questions = owner.get(address, "/api/v1/agent/questions").await;
    assert_eq!(questions.body["questions"].as_array().unwrap().len(), 0);
    let schedule = owner.get(address, "/api/v1/agent/schedule").await;
    assert_eq!(schedule.body["slots"].as_array().unwrap().len(), 7);
    assert_eq!(schedule.body["slots"][0]["starts_at"], "00:00");
    let mut conn = pool.acquire().await.unwrap();
    let busy = qubite_notify::settings::busy_slot(&mut conn, me)
        .await
        .unwrap();
    // Урок 00:00–23:59 каждый день: свободна только последняя минута суток.
    let last_minute: bool =
        sqlx::query_scalar("SELECT (now() AT TIME ZONE 'Asia/Yekaterinburg')::time >= '23:59'")
            .fetch_one(&mut *conn)
            .await
            .unwrap();
    if !last_minute {
        assert_eq!(busy.as_deref(), Some("Уроки"), "на уроке агент молчит");
    }
    drop(conn);

    // Фоновый разбор стоит в очереди на потом (через 3 минуты), не сейчас.
    let reviews: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM jobs WHERE kind = 'agent.review' AND run_at > now()",
    )
    .fetch_one(pool)
    .await
    .unwrap();
    assert!(reviews >= 1);

    // Синхронизация с устройства не трогает файлы агента — только через ленту.
    let push = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            json!({"device_id": Uuid::now_v7(), "ops": [{
                "op_id": Uuid::now_v7(),
                "object_id": memory_id,
                "base_revision": null,
                "kind": "delete",
            }]}),
        )
        .await;
    assert_eq!(push.status, 200, "{:?}", push.body);
    assert_eq!(
        push.body["results"][0]["status"], "rejected",
        "{:?}",
        push.body
    );

    db.close().await;
    test_db.drop_db().await;
}
