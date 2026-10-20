//! Напоминания и каналы (PLAN-004) через настоящий HTTP-сервер: напоминание
//! о деле — задача в очереди на нужный момент; доставка — push (браузер
//! расшифровывает) или Telegram; прочитанное гаснет в другом канале;
//! тишина держит только то, где агент пишет первым.

mod common;

use std::{
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
};

use common::{EMAIL, logged_in};
use qubite_db::Database;
use qubite_notify::{
    Kind, NewNotice, Origin,
    deliver::Channels,
    webpush::{TestBrowser, WebPush},
};
use qubite_server::{AppState, auth::AuthSettings};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp},
};
use serde_json::{Value, json};
use time::OffsetDateTime;
use uuid::Uuid;

struct Lab {
    test_db: TestDb,
    db: Database,
    address: SocketAddr,
    channels: Channels,
    push: FakeHttp,
    telegram: FakeHttp,
    owner: Uuid,
}

/// Поддельный Bot API: sendMessage отвечает новым ID сообщения.
async fn fake_telegram() -> FakeHttp {
    let next = Arc::new(AtomicI64::new(100));
    FakeHttp::start(
        [],
        Action::With(Arc::new(move |request| {
            if request.line.contains("/sendMessage") {
                let id = next.fetch_add(1, Ordering::SeqCst);
                (
                    200,
                    json!({ "ok": true, "result": { "message_id": id } }).to_string(),
                )
            } else {
                (200, json!({ "ok": true, "result": true }).to_string())
            }
        })),
    )
    .await
}

async fn lab(push_script: Vec<Action>) -> Lab {
    let (test_db, db) = TestDb::migrated().await;
    let owner = qubite_auth::owner::create(
        db.pool(),
        &qubite_auth::Passwords::default(),
        EMAIL,
        "Кирилл",
        common::PASSWORD,
    )
    .await
    .unwrap()
    .id;
    let push = FakeHttp::start(push_script, Action::Respond(201, "{}".into())).await;
    let telegram = fake_telegram().await;
    let (private, _) = qubite_notify::webpush::generate_keys().unwrap();
    let mut web_push = WebPush::new(&private, "mailto:owner@qubiteapp.ru").unwrap();
    web_push.allow_loopback = true;
    let channels = Channels {
        push: Some(Arc::new(web_push)),
        telegram: Some(Arc::new(qubite_bot::TelegramApi::new(
            telegram.root_url(),
            "123:TEST",
        ))),
        public_url: "http://localhost:5173".into(),
    };
    let state =
        AppState::with_auth(db.clone(), AuthSettings::default()).with_notify(channels.clone());
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Lab {
        test_db,
        db,
        address,
        channels,
        push,
        telegram,
        owner,
    }
}

impl Lab {
    /// Время пришло: задачи напоминаний становятся готовыми, обработчик их берёт.
    async fn time_passes(&self) -> usize {
        sqlx::query("UPDATE jobs SET run_at = now() WHERE status = 'queued'")
            .execute(self.db.pool())
            .await
            .unwrap();
        qubite_notify::worker::run_ready(self.db.pool(), &self.channels)
            .await
            .unwrap()
    }

    async fn link_telegram(&self, chat: i64) {
        sqlx::query(
            "INSERT INTO oauth_identities (provider, subject, account_id) VALUES ('telegram', $1, $2)",
        )
        .bind(chat.to_string())
        .bind(self.owner)
        .execute(self.db.pool())
        .await
        .unwrap();
    }

    fn telegram_calls(&self, method: &str) -> Vec<Value> {
        self.telegram
            .received()
            .into_iter()
            .filter(|request| request.line.contains(&format!("/{method}")))
            .map(|request| serde_json::from_str(&request.body).unwrap())
            .collect()
    }

    async fn finish(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

fn task(id: Uuid, title: &str, fields: Value) -> Value {
    json!({
        "device_id": Uuid::now_v7(),
        "ops": [{
            "op_id": Uuid::now_v7(),
            "object_id": id,
            "kind": "create",
            "object_type": "planner.task",
            "title": title,
            "fields": fields,
        }],
    })
}

fn patch(id: Uuid, revision: i64, fields: Value) -> Value {
    json!({
        "device_id": Uuid::now_v7(),
        "ops": [{
            "op_id": Uuid::now_v7(),
            "object_id": id,
            "kind": "patch",
            "base_revision": revision,
            "fields": fields,
        }],
    })
}

async fn reminder_jobs(db: &Database, task: Uuid) -> Vec<(OffsetDateTime, String)> {
    sqlx::query_as(
        "SELECT run_at, status FROM jobs WHERE kind = 'planner.remind' \
         AND payload->>'task_id' = $1 ORDER BY run_at",
    )
    .bind(task.to_string())
    .fetch_all(db.pool())
    .await
    .unwrap()
}

#[tokio::test]
async fn reminder_finds_the_owner_outside_qubite() {
    let lab = lab(vec![Action::Respond(201, "{}".into())]).await;
    let address = lab.address;
    let mut owner = logged_in(address).await;

    // Настройки по умолчанию: ночь 23–8, «само» — 15 минут и час на дорогу.
    let settings = owner.get(address, "/api/v1/notifications/settings").await;
    assert_eq!(settings.status, 200, "{:?}", settings.body);
    assert_eq!(settings.body["quiet_from"], "23:00");
    assert_eq!(settings.body["quiet_to"], "08:00");
    assert_eq!(settings.body["before_minutes"], 15);
    assert_eq!(settings.body["travel_minutes"], 60);
    assert_eq!(settings.body["telegram_linked"], false);
    let key = settings.body["push_key"].as_str().unwrap().to_owned();
    assert_eq!(key.len(), 87, "открытый ключ P-256 в base64url");

    // Браузер подписывается; чужие адреса (не служба push) не принимаются.
    let mut browser = TestBrowser::new();
    let endpoint = format!("{}/push/firefox", lab.push.root_url());
    let reply = owner
        .post_json(
            address,
            "/api/v1/notifications/push",
            json!({ "endpoint": endpoint, "label": "Firefox",
                    "keys": { "p256dh": browser.p256dh(), "auth": browser.auth() } }),
        )
        .await;
    assert_eq!(reply.status, 204, "{:?}", reply.body);
    let reply = owner
        .post_json(
            address,
            "/api/v1/notifications/push",
            json!({ "endpoint": "https://169.254.169.254/latest", "label": "",
                    "keys": { "p256dh": browser.p256dh(), "auth": browser.auth() } }),
        )
        .await;
    assert_eq!(reply.status, 400);

    // «Сходить в музей» в 16:00 по Екатеринбургу → напомнить в 15:00 (10:00 UTC).
    let museum = Uuid::now_v7();
    let reply = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            task(
                museum,
                "Сходить в музей",
                json!({ "due_date": "2030-01-15", "due_time": "16:00" }),
            ),
        )
        .await;
    assert_eq!(
        reply.body["results"][0]["status"], "applied",
        "{:?}",
        reply.body
    );
    let jobs = reminder_jobs(&lab.db, museum).await;
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        jobs[0].0,
        time::macros::datetime!(2030-01-15 10:00 UTC),
        "задача очереди на нужный момент, без постоянного процесса"
    );
    let pulled = owner.get(address, "/api/v1/sync/pull?cursor=0").await;
    let fields = &pulled.body["changes"][0]["fields"];
    assert_eq!(fields["remind_at"], "2030-01-15T15:00");
    assert_eq!(
        fields["remind_why"],
        "сходить куда-то — за час, с запасом на дорогу"
    );
    assert_eq!(fields["remind_by"], "auto");

    // Время пришло, Qubite закрыт → push в браузер; Telegram молчит.
    lab.link_telegram(777).await;
    assert!(lab.time_passes().await >= 2, "напоминание и доставка");
    let pushed = lab.push.received();
    assert_eq!(pushed.len(), 1);
    assert!(pushed[0].line.starts_with("POST /push/firefox"));
    assert_eq!(pushed[0].header("content-encoding"), Some("aes128gcm"));
    assert!(
        pushed[0]
            .header("authorization")
            .unwrap()
            .starts_with("vapid t=")
    );
    let message: Value = serde_json::from_slice(&browser.decrypt(&pushed[0].raw).unwrap()).unwrap();
    assert_eq!(message["title"], "Сходить в музей");
    assert_eq!(
        message["body"],
        "в 16:00 · сходить куда-то — за час, с запасом на дорогу"
    );
    assert!(
        lab.telegram_calls("sendMessage").is_empty(),
        "одно сообщение — один канал"
    );

    let bell = owner.get(address, "/api/v1/notifications").await;
    assert_eq!(bell.body["unread"], 1);
    assert_eq!(bell.body["items"][0]["channel"], "push");
    assert_eq!(bell.body["items"][0]["object_id"], museum.to_string());

    // Дело перенесли на 17:00: старая задача устарела и молчит, новая — в 16:00.
    let revision = pulled.body["changes"][0]["revision"].as_i64().unwrap();
    let reply = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            patch(museum, revision, json!({ "due_time": "17:00" })),
        )
        .await;
    assert_eq!(
        reply.body["results"][0]["status"], "applied",
        "{:?}",
        reply.body
    );
    assert_eq!(reminder_jobs(&lab.db, museum).await.len(), 2);

    // Человек сидит в Qubite → только колокольчик. Браузер сменился: старая
    // подписка отвечает 410 и удаляется, второй канал — Telegram с кнопками.
    let reply = owner
        .post_json(
            address,
            "/api/v1/notifications/presence",
            json!({ "visible": true }),
        )
        .await;
    assert_eq!(reply.status, 204);
    lab.time_passes().await;
    let bell = owner.get(address, "/api/v1/notifications").await;
    assert_eq!(bell.body["unread"], 2);
    assert!(
        bell.body["items"][0]["channel"].is_null(),
        "только колокольчик"
    );
    assert_eq!(lab.push.received().len(), 1);

    owner
        .post_json(
            address,
            "/api/v1/notifications/presence",
            json!({ "visible": false }),
        )
        .await;
    let exam = Uuid::now_v7();
    owner
        .post_json(
            address,
            "/api/v1/sync/push",
            task(
                exam,
                "Контрольная по алгебре",
                json!({ "due_date": "2030-01-16", "due_time": "10:00",
                 "remind": { "before": 120 } }),
            ),
        )
        .await;
    let push_after_gone = FakeHttp::start([], Action::Respond(410, "{}".into())).await;
    sqlx::query("UPDATE push_subscriptions SET endpoint = $1")
        .bind(format!("{}/push/old", push_after_gone.root_url()))
        .execute(lab.db.pool())
        .await
        .unwrap();
    lab.time_passes().await;
    let sent = lab.telegram_calls("sendMessage");
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["chat_id"], 777);
    assert_eq!(
        sent[0]["text"],
        "🔔 Контрольная по алгебре\nв 10:00\n— за 2 ч до срока"
    );
    assert_eq!(
        sent[0]["reply_markup"]["inline_keyboard"][0][0]["text"],
        "✓ Понял"
    );
    let settings = owner.get(address, "/api/v1/notifications/settings").await;
    assert_eq!(
        settings.body["push_devices"],
        json!([]),
        "мёртвая подписка удалена"
    );
    assert_eq!(settings.body["telegram_linked"], true);

    // Прочитал в колокольчике → в Telegram сообщение гаснет (без кнопок).
    let bell = owner.get(address, "/api/v1/notifications").await;
    let exam_notice = bell.body["items"][0]["id"].as_str().unwrap().to_owned();
    assert_eq!(bell.body["items"][0]["channel"], "telegram");
    let reply = owner
        .post(
            address,
            &format!("/api/v1/notifications/{exam_notice}/read"),
        )
        .await;
    assert_eq!(reply.status, 204);
    lab.time_passes().await;
    let edits = lab.telegram_calls("editMessageText");
    assert_eq!(edits.len(), 1);
    assert_eq!(edits[0]["message_id"], 100, "то самое сообщение");
    assert!(edits[0]["text"].as_str().unwrap().ends_with("✓ Прочитано"));
    assert!(edits[0].get("reply_markup").is_none());

    // Кнопка «через 15 мин» в Telegram: прочитано и такое же придёт позже.
    let notice = qubite_notify::notice::get(
        &mut lab.db.pool().acquire().await.unwrap(),
        museum_notice(&lab, museum).await,
    )
    .await
    .unwrap()
    .unwrap();
    let api = qubite_bot::TelegramApi::new(lab.telegram.root_url(), "123:TEST");
    let press = |data: String, from: i64| qubite_bot::telegram::CallbackQuery {
        id: "cb1".into(),
        from: serde_json::from_value(json!({ "id": from, "first_name": "К" })).unwrap(),
        data: Some(data),
    };
    // Чужой Telegram ничего не может.
    let outcome =
        qubite_bot::reminders::handle(lab.db.pool(), &api, &press(format!("n:s:{}", notice.id), 5))
            .await
            .unwrap();
    assert_eq!(outcome, qubite_bot::Outcome::Rejected);
    qubite_bot::reminders::handle(
        lab.db.pool(),
        &api,
        &press(format!("n:s:{}", notice.id), 777),
    )
    .await
    .unwrap();
    let bell = owner.get(address, "/api/v1/notifications").await;
    let unread_before = bell.body["unread"].as_i64().unwrap();
    lab.time_passes().await;
    let bell = owner.get(address, "/api/v1/notifications").await;
    assert_eq!(
        bell.body["unread"].as_i64().unwrap(),
        unread_before + 1,
        "повтор пришёл"
    );
    assert_eq!(bell.body["items"][0]["title"], "Сходить в музей");
    assert_eq!(
        bell.body["items"][0]["why"],
        "ты попросил напомнить ещё раз"
    );

    let reply = owner.post(address, "/api/v1/notifications/read-all").await;
    assert_eq!(reply.status, 200);
    let bell = owner.get(address, "/api/v1/notifications").await;
    assert_eq!(bell.body["unread"], 0);
    lab.finish().await;
}

async fn museum_notice(lab: &Lab, museum: Uuid) -> Uuid {
    sqlx::query_scalar(
        "SELECT id FROM notifications WHERE object_id = $1 ORDER BY created_at LIMIT 1",
    )
    .bind(museum)
    .fetch_one(lab.db.pool())
    .await
    .unwrap()
}

#[tokio::test]
async fn quiet_holds_only_what_the_agent_starts() {
    let lab = lab(vec![]).await;
    let address = lab.address;
    let mut owner = logged_in(address).await;
    lab.link_telegram(777).await;

    // Тишина сейчас: час до и час после текущего времени по часам владельца.
    let now = qubite_notify::settings::local_now(&mut lab.db.pool().acquire().await.unwrap())
        .await
        .unwrap();
    let shift = |hours: i64| {
        let at = now + time::Duration::hours(hours);
        format!("{:02}:{:02}", at.hour(), at.minute())
    };
    let reply = owner
        .patch_json(
            address,
            "/api/v1/notifications/settings",
            json!({ "quiet_from": shift(-1), "quiet_to": shift(1), "first_channel": "telegram" }),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["first_channel"], "telegram");

    let mut conn = lab.db.pool().acquire().await.unwrap();
    let new = |origin: Origin, title: &str| NewNotice {
        account_id: lab.owner,
        kind: if origin == Origin::Agent {
            Kind::Agent
        } else {
            Kind::Reminder
        },
        origin,
        title: title.into(),
        body: String::new(),
        why: String::new(),
        object_id: None,
        dedup_key: None,
    };
    let agent = qubite_notify::notice::send(&mut conn, new(Origin::Agent, "Есть 30 минут?"))
        .await
        .unwrap()
        .unwrap();
    assert!(agent.held, "агент первым в тишину — только колокольчик");
    let mine = qubite_notify::notice::send(&mut conn, new(Origin::Owner, "Напомни в 7"))
        .await
        .unwrap()
        .unwrap();
    assert!(!mine.held, "своё напоминание приходит всегда");
    drop(conn);
    lab.time_passes().await;
    let sent = lab.telegram_calls("sendMessage");
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["text"], "🔔 Напомни в 7");

    // Пробное из профиля — наружу, даже когда Qubite открыт.
    owner
        .post_json(
            address,
            "/api/v1/notifications/presence",
            json!({ "visible": true }),
        )
        .await;
    let reply = owner.post(address, "/api/v1/notifications/test").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    lab.time_passes().await;
    assert_eq!(lab.telegram_calls("sendMessage").len(), 2);

    // Неверные настройки не сохраняются.
    let reply = owner
        .patch_json(
            address,
            "/api/v1/notifications/settings",
            json!({ "quiet_from": "25:00" }),
        )
        .await;
    assert_eq!(reply.status, 400);
    let reply = owner
        .patch_json(
            address,
            "/api/v1/notifications/settings",
            json!({ "first_channel": "email" }),
        )
        .await;
    assert_eq!(reply.status, 400, "почты нет");
    lab.finish().await;
}

#[tokio::test]
async fn done_and_repeating_tasks() {
    let lab = lab(vec![]).await;
    let address = lab.address;
    let mut owner = logged_in(address).await;
    lab.link_telegram(777).await;

    // Без времени — само не напоминает (о нём вспомнит агент).
    let idea = Uuid::now_v7();
    owner
        .post_json(
            address,
            "/api/v1/sync/push",
            task(
                idea,
                "Амбициозная идея",
                json!({ "due_date": "2030-01-15" }),
            ),
        )
        .await;
    assert!(reminder_jobs(&lab.db, idea).await.is_empty());

    // Агент выбрал время и написал почему.
    let reply = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            patch(
                idea,
                1,
                json!({ "remind": { "at": "2030-01-14T19:00" }, "remind_by": "agent",
                                   "remind_why": "ДЗ — вечером накануне" }),
            ),
        )
        .await;
    assert_eq!(
        reply.body["results"][0]["status"], "applied",
        "{:?}",
        reply.body
    );
    assert_eq!(reminder_jobs(&lab.db, idea).await.len(), 1);

    // Повторяющееся дело со временем: отметил — у следующего своё напоминание.
    let weekly = Uuid::now_v7();
    owner
        .post_json(
            address,
            "/api/v1/sync/push",
            task(
                weekly,
                "Русский",
                json!({ "due_date": "2030-01-15", "due_time": "14:00",
                                            "recurrence": { "freq": "weekly" } }),
            ),
        )
        .await;
    let reply = owner
        .post_json(
            address,
            "/api/v1/sync/push",
            patch(weekly, 1, json!({ "status": "done" })),
        )
        .await;
    assert_eq!(
        reply.body["results"][0]["status"], "applied",
        "{:?}",
        reply.body
    );
    let next: Uuid = sqlx::query_scalar("SELECT next_id FROM planner_tasks WHERE object_id = $1")
        .bind(weekly)
        .fetch_one(lab.db.pool())
        .await
        .unwrap();
    let jobs = reminder_jobs(&lab.db, next).await;
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].0, time::macros::datetime!(2030-01-22 08:45 UTC));

    // Сделанное не напоминает: задача есть, но молчит.
    lab.time_passes().await;
    let titles: Vec<String> =
        sqlx::query_scalar("SELECT title FROM notifications ORDER BY created_at")
            .fetch_all(lab.db.pool())
            .await
            .unwrap();
    assert_eq!(titles, ["Амбициозная идея", "Русский"]);
    let why: String = sqlx::query_scalar("SELECT why FROM notifications WHERE object_id = $1")
        .bind(idea)
        .fetch_one(lab.db.pool())
        .await
        .unwrap();
    assert_eq!(why, "ДЗ — вечером накануне");

    // Устаревшая задача (другое время) и пропавшее дело — молчат.
    let mut conn = lab.db.pool().acquire().await.unwrap();
    let stale = qubite_planner::reminder::due(&mut conn, idea, 0)
        .await
        .unwrap();
    assert!(stale.is_none(), "другое время — устаревшая задача");
    let none = qubite_notify::worker::remind(lab.db.pool(), Uuid::now_v7(), 0)
        .await
        .unwrap();
    assert!(none.is_none());
    drop(conn);
    lab.finish().await;
}
