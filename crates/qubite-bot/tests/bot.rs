//! Бот на настоящей PostgreSQL и поддельном Telegram Bot API.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{
    Json, Router,
    extract::State,
    routing::{get, post},
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_bot::{Bot, BotConfig, Kind, Outcome, notify, watch};
use qubite_db::Database;
use qubite_objects::{NewAuditEntry, audit, files};
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use uuid::Uuid;

const TOKEN: &str = "TOKEN";
const OWNER_TG: i64 = 4242;

#[derive(Clone, Default)]
struct FakeTelegram {
    updates: Arc<Mutex<Vec<Value>>>,
    sent: Arc<Mutex<Vec<(i64, String)>>>,
    down: Arc<Mutex<bool>>,
}

impl FakeTelegram {
    fn push(&self, update: Value) {
        self.updates.lock().unwrap().push(update);
    }
    fn sent_to(&self, chat: i64) -> Vec<String> {
        self.sent
            .lock()
            .unwrap()
            .iter()
            .filter(|(id, _)| *id == chat)
            .map(|(_, text)| text.clone())
            .collect()
    }
}

async fn get_updates(State(tg): State<FakeTelegram>, Json(body): Json<Value>) -> Json<Value> {
    let offset = body["offset"].as_i64().unwrap_or(0);
    let updates: Vec<Value> = tg
        .updates
        .lock()
        .unwrap()
        .iter()
        .filter(|u| u["update_id"].as_i64().unwrap() >= offset)
        .cloned()
        .collect();
    Json(json!({ "ok": true, "result": updates }))
}

async fn send_message(State(tg): State<FakeTelegram>, Json(body): Json<Value>) -> Json<Value> {
    if *tg.down.lock().unwrap() {
        return Json(json!({ "ok": false, "description": "Bad Gateway" }));
    }
    tg.sent.lock().unwrap().push((
        body["chat_id"].as_i64().unwrap(),
        body["text"].as_str().unwrap().to_owned(),
    ));
    Json(json!({ "ok": true, "result": { "message_id": 1 } }))
}

async fn get_file(Json(body): Json<Value>) -> Json<Value> {
    let path = format!("files/{}", body["file_id"].as_str().unwrap());
    Json(json!({ "ok": true, "result": { "file_path": path } }))
}

struct Lab {
    test_db: TestDb,
    db: Database,
    tg: FakeTelegram,
    bot: Bot,
    owner: Uuid,
    _dir: tempfile::TempDir,
}

impl Lab {
    async fn new() -> Self {
        let (test_db, db) = TestDb::migrated().await;
        let owner = qubite_auth::owner::create(
            db.pool(),
            &Passwords::default(),
            "kirill@qubite.ru",
            "Кирилл",
            "правильный пароль",
        )
        .await
        .unwrap()
        .id;
        let tg = FakeTelegram::default();
        let app = Router::new()
            .route(&format!("/bot{TOKEN}/getUpdates"), post(get_updates))
            .route(&format!("/bot{TOKEN}/sendMessage"), post(send_message))
            .route(&format!("/bot{TOKEN}/getFile"), post(get_file))
            .route(
                &format!("/file/bot{TOKEN}/files/{{id}}"),
                get(|| async { "голос: OggS…" }),
            )
            .with_state(tg.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let dir = tempfile::tempdir().unwrap();
        let bot = Bot::new(
            db.pool().clone(),
            BotConfig {
                api_base: base,
                token: TOKEN.into(),
                data_dir: dir.path().to_owned(),
                server_url: "http://127.0.0.1:9".into(),
                poll_wait: Duration::ZERO,
                watch_every: Duration::from_secs(60),
            },
        );
        Self {
            test_db,
            db,
            tg,
            bot,
            owner,
            _dir: dir,
        }
    }

    async fn poll(&self) -> Vec<Outcome> {
        self.bot.poll_once(Duration::ZERO).await.unwrap()
    }

    /// Привязать Telegram к аккаунту кодом из профиля.
    async fn link(&self, account: Uuid, telegram: i64, update_id: i64) {
        let code = qubite_bot::capture::create_link_code(
            self.db.pool(),
            account,
            Duration::from_secs(600),
        )
        .await
        .unwrap();
        self.tg
            .push(message(update_id, telegram, &format!("/start {code}")));
        assert_eq!(self.poll().await, [Outcome::Linked(account)]);
    }

    async fn finish(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

fn message(update_id: i64, from: i64, text: &str) -> Value {
    json!({
        "update_id": update_id,
        "message": {
            "message_id": update_id * 10,
            "date": 1_792_224_000,
            "chat": { "id": from, "type": "private" },
            "from": { "id": from, "is_bot": false, "first_name": "Кирилл" },
            "text": text
        }
    })
}

async fn inbox_count(db: &Database) -> i64 {
    sqlx::query_scalar("SELECT count(*) FROM inbox_items")
        .fetch_one(db.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn strangers_are_refused_and_nothing_is_stored() {
    let lab = Lab::new().await;
    lab.tg.push(message(1, 777, "купить молоко"));
    lab.tg.push(message(2, 777, "/start поддельный-код"));
    let mut group = message(3, OWNER_TG, "в группе");
    group["message"]["chat"]["type"] = json!("group");
    lab.tg.push(group);
    assert_eq!(
        lab.poll().await,
        [Outcome::Rejected, Outcome::Rejected, Outcome::Ignored]
    );
    assert_eq!(inbox_count(&lab.db).await, 0);
    let replies = lab.tg.sent_to(777);
    assert_eq!(replies[0], qubite_bot::capture::UNKNOWN_SENDER);
    assert!(replies[1].contains("устарел"));
    // Следующий опрос начинается после обработанных (смещение сохранено).
    assert!(lab.poll().await.is_empty());
    lab.finish().await;
}

#[tokio::test]
async fn owner_messages_land_in_inbox_once_with_files_and_voice() {
    let lab = Lab::new().await;
    lab.link(lab.owner, OWNER_TG, 1).await;

    lab.tg
        .push(message(2, OWNER_TG, "Повторить графы к пятнице"));
    lab.tg
        .push(message(3, OWNER_TG, "https://example.ru/lecture"));
    let mut voice = message(4, OWNER_TG, "");
    voice["message"].as_object_mut().unwrap().remove("text");
    voice["message"]["voice"] =
        json!({ "file_id": "v1", "mime_type": "audio/ogg", "file_size": 20 });
    lab.tg.push(voice);
    let mut photo = message(5, OWNER_TG, "");
    photo["message"].as_object_mut().unwrap().remove("text");
    photo["message"]["caption"] = json!("доска после урока");
    photo["message"]["photo"] =
        json!([{ "file_id": "p-small", "file_size": 1 }, { "file_id": "p-big", "file_size": 9 }]);
    lab.tg.push(photo);
    let outcomes = lab.poll().await;
    assert!(
        outcomes.iter().all(|o| matches!(o, Outcome::Saved(_))),
        "{outcomes:?}"
    );
    let ids: Vec<Uuid> = outcomes
        .iter()
        .map(|o| match o {
            Outcome::Saved(id) => *id,
            _ => unreachable!(),
        })
        .collect();

    let mut conn = lab.db.pool().acquire().await.unwrap();
    let text = qubite_inbox::get(&mut conn, lab.owner, ids[0])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(text.source, qubite_inbox::Source::Telegram);
    assert_eq!(text.title, "Повторить графы к пятнице");
    assert_eq!(
        qubite_inbox::millis(text.captured_at),
        1_792_224_000_000,
        "время из Telegram"
    );
    let link = qubite_inbox::get(&mut conn, lab.owner, ids[1])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(link.kind, qubite_inbox::Kind::Link);
    let voice = qubite_inbox::get(&mut conn, lab.owner, ids[2])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(voice.kind, qubite_inbox::Kind::Voice);
    assert_eq!(voice.body, "Голосовое сообщение");
    let attached = files::attachments(&mut conn, ids[2]).await.unwrap();
    assert_eq!(attached.len(), 1);
    assert_eq!(attached[0].mime, "audio/ogg");
    let photo = qubite_inbox::get(&mut conn, lab.owner, ids[3])
        .await
        .unwrap()
        .unwrap();
    assert_eq!(photo.body, "доска после урока");
    assert_eq!(
        files::attachments(&mut conn, ids[3]).await.unwrap().len(),
        1
    );
    drop(conn);

    // На других устройствах — через обычную синхронизацию.
    let rules = qubite_sync_server::Rules {
        registry: qubite_sync_server::Registry::default().with(qubite_inbox::InboxFields),
        strict: true,
        writable: None,
        readable: Some(vec!["inbox".into()]),
    };
    let pulled = qubite_sync_server::pull_with(lab.db.pool(), lab.owner, 0, 100, &rules)
        .await
        .unwrap();
    assert_eq!(pulled.changes.len(), 4);
    assert!(
        pulled
            .changes
            .iter()
            .all(|c| c.fields.as_ref().unwrap()["source"] == "telegram")
    );

    // Telegram прислал то же сообщение снова (бот упал до сохранения смещения).
    sqlx::query("DELETE FROM bot_state WHERE key = 'telegram.offset'")
        .execute(lab.db.pool())
        .await
        .unwrap();
    let again = lab.poll().await;
    assert!(again.contains(&Outcome::Duplicate(ids[0])), "{again:?}");
    assert_eq!(inbox_count(&lab.db).await, 4, "без дублей");
    assert!(
        lab.tg
            .sent_to(OWNER_TG)
            .iter()
            .any(|t| t == qubite_bot::capture::SAVED)
    );
    lab.finish().await;
}

#[tokio::test]
async fn linked_user_without_inbox_grant_is_refused_and_codes_are_single_use() {
    let lab = Lab::new().await;
    let student = qubite_auth::accounts::create(
        lab.db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "student@qubite.ru",
            display_name: "",
            password: "пароль пользователя",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap()
    .id;
    let code =
        qubite_bot::capture::create_link_code(lab.db.pool(), student, Duration::from_secs(600))
            .await
            .unwrap();
    lab.tg.push(message(1, 555, &format!("/start {code}")));
    lab.tg.push(message(2, 556, &format!("/start {code}")));
    lab.tg.push(message(3, 555, "мысль"));
    assert_eq!(
        lab.poll().await,
        [
            Outcome::Linked(student),
            Outcome::Rejected,
            Outcome::Rejected
        ]
    );
    assert!(lab.tg.sent_to(555).last().unwrap().contains("Нет доступа"));
    assert_eq!(inbox_count(&lab.db).await, 0);

    // Тот же Telegram к другому аккаунту не привязать.
    let code =
        qubite_bot::capture::create_link_code(lab.db.pool(), lab.owner, Duration::from_secs(600))
            .await
            .unwrap();
    lab.tg.push(message(4, 555, &format!("/start {code}")));
    assert_eq!(lab.poll().await, [Outcome::Rejected]);
    assert!(
        lab.tg
            .sent_to(555)
            .last()
            .unwrap()
            .contains("другому аккаунту")
    );
    lab.finish().await;
}

async fn audit_event(
    db: &Database,
    actor: Option<Uuid>,
    action: &str,
    target: Option<Uuid>,
    after: Value,
) {
    let mut conn = db.pool().acquire().await.unwrap();
    audit::record(
        &mut conn,
        NewAuditEntry {
            actor_id: actor,
            action: action.into(),
            target_kind: "account".into(),
            target_id: target.map(|id| id.to_string()),
            after: Some(after),
            ..NewAuditEntry::default()
        },
    )
    .await
    .unwrap();
}

async fn queued(db: &Database) -> Vec<(String, String, bool)> {
    sqlx::query_as("SELECT kind, text, skipped FROM owner_notifications ORDER BY id")
        .fetch_all(db.pool())
        .await
        .unwrap()
}

#[tokio::test]
async fn audit_events_become_owner_notifications_each_can_be_switched_off() {
    let lab = Lab::new().await;
    // Первый проход только запоминает конец истории: старое не присылаем.
    audit_event(
        &lab.db,
        Some(lab.owner),
        "auth.login",
        None,
        json!({ "user_agent": "Firefox ПК", "ip": "1.1.1.1" }),
    )
    .await;
    assert_eq!(watch::scan_audit(lab.db.pool()).await.unwrap(), 0);

    let ua = |name: &str| json!({ "user_agent": name, "ip": "2.2.2.2", "method": "password" });
    audit_event(
        &lab.db,
        Some(lab.owner),
        "auth.login",
        None,
        ua("Firefox ПК"),
    )
    .await;
    audit_event(
        &lab.db,
        Some(lab.owner),
        "auth.login",
        None,
        ua("Chrome на чужом ноутбуке"),
    )
    .await;
    audit_event(
        &lab.db,
        Some(lab.owner),
        "auth.login",
        None,
        ua("Chrome на чужом ноутбуке"),
    )
    .await;
    audit_event(
        &lab.db,
        Some(lab.owner),
        "auth.password_changed",
        Some(lab.owner),
        json!({}),
    )
    .await;
    audit_event(
        &lab.db,
        Some(lab.owner),
        "auth.logout_everywhere",
        None,
        json!({}),
    )
    .await;
    audit_event(
        &lab.db,
        None,
        "account.registered",
        None,
        json!({ "email": "a@b.ru", "invitation": null }),
    )
    .await;
    audit_event(
        &lab.db,
        None,
        "account.registered",
        None,
        json!({ "email": "c@d.ru", "invitation": "inv-1" }),
    )
    .await;
    // Вход обычного пользователя с нового устройства owner не касается.
    audit_event(
        &lab.db,
        Some(Uuid::now_v7()),
        "auth.login",
        None,
        ua("Safari"),
    )
    .await;
    assert_eq!(watch::scan_audit(lab.db.pool()).await.unwrap(), 5);
    assert_eq!(
        watch::scan_audit(lab.db.pool()).await.unwrap(),
        0,
        "второй проход — ничего нового"
    );
    let kinds: Vec<String> = queued(&lab.db)
        .await
        .into_iter()
        .map(|(kind, ..)| kind)
        .collect();
    assert_eq!(
        kinds,
        [
            "new_device_login",
            "password_changed",
            "sessions_revoked",
            "registration",
            "invitation_accepted"
        ]
    );
    assert!(
        queued(&lab.db).await[0]
            .1
            .contains("Chrome на чужом ноутбуке")
    );

    // Telegram owner ещё не привязан — уведомления ждут.
    assert_eq!(
        notify::deliver(lab.db.pool(), lab.bot.api()).await.unwrap(),
        0
    );
    lab.link(lab.owner, OWNER_TG, 1).await;
    // Владелец выключил уведомления о регистрациях.
    notify::set_enabled(lab.db.pool(), Kind::Registration, false)
        .await
        .unwrap();
    let settings = notify::settings(lab.db.pool()).await.unwrap();
    assert!(
        !settings
            .iter()
            .find(|s| s.kind == Kind::Registration)
            .unwrap()
            .enabled
    );
    assert_eq!(settings.len(), Kind::ALL.len());

    // Telegram недоступен — не теряем, пробуем снова.
    *lab.tg.down.lock().unwrap() = true;
    assert_eq!(
        notify::deliver(lab.db.pool(), lab.bot.api()).await.unwrap(),
        0
    );
    *lab.tg.down.lock().unwrap() = false;
    assert_eq!(
        notify::deliver(lab.db.pool(), lab.bot.api()).await.unwrap(),
        4
    );
    let sent = lab.tg.sent_to(OWNER_TG);
    assert!(sent.iter().any(|t| t.contains("нового устройства")));
    assert!(
        !sent.iter().any(|t| t.contains("a@b.ru")),
        "выключенный вид не отправлен"
    );
    assert!(sent.iter().any(|t| t.contains("c@d.ru")));
    let skipped: Vec<bool> = queued(&lab.db)
        .await
        .into_iter()
        .map(|(.., skipped)| skipped)
        .collect();
    assert_eq!(skipped, [false, false, false, true, false]);
    assert_eq!(
        notify::deliver(lab.db.pool(), lab.bot.api()).await.unwrap(),
        0,
        "второй раз не шлём"
    );
    lab.finish().await;
}

#[tokio::test]
async fn ai_spend_80_and_100_percent_server_down_disk_and_backup() {
    let lab = Lab::new().await;
    let pool = lab.db.pool();
    let limit = Uuid::now_v7();
    sqlx::query(
        "INSERT INTO ai_limits (id, scope_kind, account_id, period, metric, limit_value) \
         VALUES ($1, 'user', $2, 'day', 'usd', 1000000)",
    )
    .bind(limit)
    .bind(lab.owner)
    .execute(pool)
    .await
    .unwrap();
    let set_spent = |spent: i64| async move {
        sqlx::query(
            "INSERT INTO ai_usage_counters (limit_id, period_key, spent) VALUES ($1, '2026-10-19', $2) \
             ON CONFLICT (limit_id, period_key) DO UPDATE SET spent = $2, updated_at = now()",
        )
        .bind(limit)
        .bind(spent)
        .execute(pool)
        .await
        .unwrap();
    };
    set_spent(500_000).await;
    assert_eq!(watch::scan_ai(pool).await.unwrap(), 0, "50 % — тихо");
    set_spent(830_000).await;
    assert_eq!(watch::scan_ai(pool).await.unwrap(), 1);
    assert_eq!(
        watch::scan_ai(pool).await.unwrap(),
        0,
        "80 % — один раз за период"
    );
    set_spent(1_000_000).await;
    assert_eq!(watch::scan_ai(pool).await.unwrap(), 1);
    let texts: Vec<(String, String, bool)> = queued(&lab.db).await;
    assert_eq!(texts[0].0, "ai_budget_80");
    assert!(
        texts[0].1.contains("83 %") && texts[0].1.contains("$0.83 из $1.00"),
        "{}",
        texts[0].1
    );
    assert_eq!(texts[1].0, "ai_budget_100");

    // Сервер: три неудачи подряд — одно «упал», потом одно «снова работает».
    for _ in 0..5 {
        watch::record_health(pool, false).await.unwrap();
    }
    watch::record_health(pool, true).await.unwrap();
    watch::record_health(pool, true).await.unwrap();
    let server: Vec<String> = queued(&lab.db)
        .await
        .into_iter()
        .filter(|(kind, ..)| kind == "server_down")
        .map(|(_, text, _)| text)
        .collect();
    assert_eq!(server.len(), 2, "{server:?}");
    assert!(server[0].contains("не отвечает") && server[1].contains("снова"));

    // Бэкап (скрипт OPS-002 вызывает `qubite notify backup_failed …`): один раз на ключ.
    let mut conn = pool.acquire().await.unwrap();
    assert!(
        notify::enqueue(
            &mut conn,
            Kind::BackupFailed,
            "Бэкап не прошёл",
            Some("backup:2026-10-19")
        )
        .await
        .unwrap()
    );
    assert!(
        !notify::enqueue(
            &mut conn,
            Kind::BackupFailed,
            "Бэкап не прошёл",
            Some("backup:2026-10-19")
        )
        .await
        .unwrap()
    );
    assert!("backup_failed".parse::<Kind>().is_ok());
    assert!("что-то".parse::<Kind>().is_err());
    drop(conn);
    lab.finish().await;
}
