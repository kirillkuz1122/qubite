//! Policy Gate через настоящий HTTP-сервер: негативные тесты
//! из docs/architecture/AUTH_AND_PERMISSIONS.md §6.
//!
//! Настоящих модулей ещё нет, поэтому тест подключает проверочный модуль
//! «probe»: его маршруты устроены так же, как будут устроены настоящие —
//! первым делом `authorize`. Mock-провайдер AI считает вызовы: если права
//! нет, счётчик должен остаться нулём.
//!
//! Тесты №3 и №4 (нулевой бюджет и параллельные запросы) — про деньги; они
//! живут в crate'е AI-шлюза `qubite-ai` (AI-001), который резервирует бюджет.

mod common;

use std::{
    net::SocketAddr,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use axum::{
    Json, Router,
    extract::{Path, State},
    routing::{get, post},
};
use common::{Browser, logged_in, spawn_with};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_db::Database;
use qubite_policy::{
    Authority, Authorized, DenyReason, Error, Flags, ModuleId, Read, Subject, UseAi, Write,
};
use qubite_server::{
    AppState,
    auth::{ApiError, AuthSettings, Authenticated},
    modules::authorize,
};
use qubite_testkit::TestDb;
use reqwest::StatusCode;
use serde_json::{Value, json};
use uuid::Uuid;

const USER_PASSWORD: &str = "пароль пользователя";

/// «Внешний» AI-провайдер. Вызвать можно только с доказательством проверки.
fn mock_provider(calls: &AtomicUsize, _proof: &Authorized<UseAi>) {
    calls.fetch_add(1, Ordering::SeqCst);
}

fn probe_routes(calls: Arc<AtomicUsize>) -> Router<AppState> {
    async fn read(
        State(state): State<AppState>,
        session: Authenticated,
        Path(module): Path<String>,
    ) -> Result<Json<Value>, ApiError> {
        authorize::<Read>(&state, &session, &module).await?;
        Ok(Json(json!({ "items": [] })))
    }
    async fn write(
        State(state): State<AppState>,
        session: Authenticated,
        Path(module): Path<String>,
    ) -> Result<Json<Value>, ApiError> {
        authorize::<Write>(&state, &session, &module).await?;
        Ok(Json(json!({ "created": true })))
    }
    async fn later(
        State(state): State<AppState>,
        session: Authenticated,
        Path(module): Path<String>,
    ) -> Result<Json<Value>, ApiError> {
        let allowed = authorize::<UseAi>(&state, &session, &module).await?;
        let job = qubite_jobs::enqueue(
            state.db.pool(),
            qubite_jobs::NewJob::new("probe.ai", json!({ "authority": allowed.authority() })),
        )
        .await
        .unwrap();
        Ok(Json(json!({ "job": job.id })))
    }
    Router::new()
        .route("/api/probe/{module}/items", get(read).post(write))
        .route(
            "/api/probe/{module}/ai",
            post(
                move |State(state): State<AppState>,
                      session: Authenticated,
                      Path(module): Path<String>| {
                    let calls = calls.clone();
                    async move {
                        let allowed = authorize::<UseAi>(&state, &session, &module).await?;
                        mock_provider(&calls, &allowed);
                        Ok::<_, ApiError>(Json(json!({ "answer": "ok" })))
                    }
                },
            ),
        )
        .route("/api/probe/{module}/ai/later", post(later))
}

/// Фоновый обработчик AI-задач: перед вызовом провайдера проверяет права заново.
/// Отказ — задача завершается без вызова. Возвращает, сколько вызовов сделано.
async fn run_ai_jobs(db: &Database, calls: &AtomicUsize) -> usize {
    let mut done = 0;
    while let Some(job) =
        qubite_jobs::claim(db.pool(), "test", &["probe.ai"], Duration::from_secs(30))
            .await
            .unwrap()
    {
        let authority: Authority =
            serde_json::from_value(job.payload["authority"].clone()).unwrap();
        if let Ok(allowed) = authority.recheck::<UseAi>(db.pool()).await {
            mock_provider(calls, &allowed);
            done += 1;
        }
        qubite_jobs::complete(db.pool(), job.id, "test")
            .await
            .unwrap();
    }
    done
}

struct Lab {
    test_db: TestDb,
    db: Database,
    address: SocketAddr,
    owner: Browser,
    calls: Arc<AtomicUsize>,
}

impl Lab {
    async fn new() -> Self {
        let (test_db, db) = TestDb::migrated().await;
        qubite_auth::owner::create(
            db.pool(),
            &Passwords::default(),
            common::EMAIL,
            "Кирилл",
            common::PASSWORD,
        )
        .await
        .unwrap();
        let calls = Arc::new(AtomicUsize::new(0));
        let address = spawn_with(
            db.clone(),
            AuthSettings::default(),
            probe_routes(calls.clone()),
        )
        .await;
        let owner = logged_in(address).await;
        let mut lab = Self {
            test_db,
            db,
            address,
            owner,
            calls,
        };
        // Модули «написаны»: установлены и готовы. Доступа ни у кого нет.
        for module in ["docs", "search", "tournaments", "planner"] {
            lab.install(module).await;
        }
        lab
    }

    async fn install(&mut self, module: &str) {
        let reply = self
            .owner
            .patch_json(
                self.address,
                &format!("/api/owner/modules/{module}"),
                json!({ "installed": true, "readiness": "stable" }),
            )
            .await;
        assert_eq!(reply.status, 200, "{:?}", reply.body);
    }

    /// Новый пользователь с подтверждённой почтой и вошедший браузер.
    async fn user(&self, email: &str) -> (Uuid, Browser) {
        let account = qubite_auth::accounts::create(
            self.db.pool(),
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
        let reply = browser.login(self.address, email, USER_PASSWORD).await;
        assert_eq!(reply.status, 200, "{:?}", reply.body);
        (account.id, browser)
    }

    async fn grant(&mut self, account: Uuid, module: &str, flags: Value) {
        let reply = self
            .owner
            .put_json(
                self.address,
                &format!("/api/owner/accounts/{account}/grants/{module}"),
                flags,
            )
            .await;
        assert_eq!(reply.status, 200, "{:?}", reply.body);
    }

    async fn revoke(&mut self, account: Uuid, module: &str) {
        let reply = self
            .owner
            .delete(
                self.address,
                &format!("/api/owner/accounts/{account}/grants/{module}"),
            )
            .await;
        assert_eq!(reply.status, 204, "{:?}", reply.body);
    }

    fn calls(&self) -> usize {
        self.calls.load(Ordering::SeqCst)
    }

    async fn finish(self) {
        self.db.close().await;
        self.test_db.drop_db().await;
    }
}

fn statuses(catalog: &Value) -> Vec<(String, String)> {
    catalog
        .as_array()
        .unwrap()
        .iter()
        .map(|m| {
            (
                m["id"].as_str().unwrap().into(),
                m["status"].as_str().unwrap().into(),
            )
        })
        .collect()
}

fn status_of(catalog: &Value, id: &str) -> Option<String> {
    statuses(catalog)
        .into_iter()
        .find(|(m, _)| m == id)
        .map(|(_, s)| s)
}

fn denied(result: Result<impl std::fmt::Debug, Error>) -> DenyReason {
    match result {
        Err(Error::Denied(reason)) => reason,
        other => panic!("ожидался отказ, получено {other:?}"),
    }
}

// ---------------------------------------------------------------- №1

#[tokio::test]
async fn t01_new_user_cannot_open_closed_module_or_call_its_api() {
    let mut lab = Lab::new().await;
    let (_, mut user) = lab.user("new@qubite.ru").await;
    let address = lab.address;

    let me = user.get(address, "/api/auth/me").await;
    assert_eq!(me.body["is_owner"], false);

    // Все модули — с замком, доступных нет ни одного (D-054, D-172).
    let catalog = user.get(address, "/api/modules").await.body;
    assert!(!statuses(&catalog).is_empty());
    assert!(
        statuses(&catalog).iter().all(|(_, s)| s == "locked"),
        "{catalog}"
    );

    // Прямой вызов API модуля — отказ.
    for (method_post, path) in [
        (false, "/api/probe/docs/items"),
        (true, "/api/probe/docs/items"),
    ] {
        let reply = if method_post {
            user.post(address, path).await
        } else {
            user.get(address, path).await
        };
        assert_eq!(reply.status, 403);
        assert_eq!(reply.body["error"], "module_not_granted");
    }
    assert_eq!(user.post(address, "/api/probe/docs/ai").await.status, 403);

    // Скрытый модуль не виден и по прямой ссылке (ACC-08).
    let reply = lab
        .owner
        .patch_json(
            address,
            "/api/owner/modules/search",
            json!({ "visibility": "hidden" }),
        )
        .await;
    assert_eq!(reply.status, 200);
    let catalog = user.get(address, "/api/modules").await.body;
    assert_eq!(status_of(&catalog, "search"), None);
    assert_eq!(user.get(address, "/api/modules/search").await.status, 404);
    assert_eq!(
        user.get(address, "/api/probe/search/items").await.status,
        404
    );
    // Несуществующий модуль — тоже 404.
    assert_eq!(
        user.get(address, "/api/probe/nothing/items").await.status,
        404
    );

    assert_eq!(lab.calls(), 0);
    lab.finish().await;
}

// ---------------------------------------------------------------- №2

#[tokio::test]
async fn t02_module_allowed_but_ai_forbidden_everywhere_without_provider_call() {
    let mut lab = Lab::new().await;
    let (user_id, mut user) = lab.user("writer@qubite.ru").await;
    let address = lab.address;
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": true, "manage": false, "ai": false }),
    )
    .await;

    // Модулем пользоваться можно.
    assert_eq!(user.get(address, "/api/probe/docs/items").await.status, 200);
    assert_eq!(
        user.post(address, "/api/probe/docs/items").await.status,
        200
    );

    // AI-эндпоинт — контролируемый отказ.
    let reply = user.post(address, "/api/probe/docs/ai").await;
    assert_eq!(reply.status, 403);
    assert_eq!(reply.body["error"], "ai_not_granted");
    assert_eq!(
        user.post(address, "/api/probe/docs/ai/later").await.status,
        403
    );

    // Агент и MCP с «полным» потолком — всё равно нет.
    let docs = ModuleId::new("docs").unwrap();
    for via in ["agent", "mcp", "plugin"] {
        let agent = Subject::Delegated {
            account_id: user_id,
            session_id: None,
            via: via.into(),
            ceiling: vec![(docs.clone(), Flags::ALL)],
        };
        let reason = denied(qubite_policy::decide::<UseAi>(lab.db.pool(), &agent, &docs).await);
        assert_eq!(reason, DenyReason::AiNotGranted, "{via}");
    }

    // Фоновая задача: поставлена, пока AI был разрешён, AI сняли до запуска —
    // обработчик проверяет заново и к провайдеру не идёт.
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": true, "manage": false, "ai": true }),
    )
    .await;
    assert_eq!(
        user.post(address, "/api/probe/docs/ai/later").await.status,
        200
    );
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": true, "manage": false, "ai": false }),
    )
    .await;
    assert_eq!(run_ai_jobs(&lab.db, &lab.calls).await, 0);

    assert_eq!(lab.calls(), 0, "ни одного внешнего запроса");
    lab.finish().await;
}

// ---------------------------------------------------------------- №5

#[tokio::test]
async fn t05_tournament_organizer_gets_nothing_outside_tournaments() {
    let mut lab = Lab::new().await;
    let (user_id, mut organizer) = lab.user("organizer@qubite.ru").await;
    let address = lab.address;
    // Полный доступ к турнирам, включая «Управление».
    lab.grant(
        user_id,
        "tournaments",
        json!({ "read": true, "write": true, "manage": true, "ai": false }),
    )
    .await;

    let me = organizer.get(address, "/api/auth/me").await;
    assert_eq!(me.body["is_owner"], false);
    let session_id: Uuid = me.body["session_id"].as_str().unwrap().parse().unwrap();
    let subject = Subject::account(user_id, Some(session_id));
    assert_eq!(
        denied(qubite_policy::decide_owner(lab.db.pool(), &subject).await),
        DenyReason::NotFound
    );
    assert_eq!(
        organizer.get(address, "/api/owner/modules").await.status,
        404
    );

    // Другие модули и чужие данные — закрыты.
    assert_eq!(
        organizer
            .get(address, "/api/probe/tournaments/items")
            .await
            .status,
        200
    );
    assert_eq!(
        organizer.get(address, "/api/probe/docs/items").await.status,
        403
    );
    assert_eq!(
        organizer
            .get(address, "/api/probe/planner/items")
            .await
            .status,
        403
    );
    let owner_id = lab.owner.get(address, "/api/auth/me").await.body["id"].clone();
    let foreign = organizer
        .get(
            address,
            &format!("/api/owner/accounts/{}/grants", owner_id.as_str().unwrap()),
        )
        .await;
    assert_eq!(foreign.status, 404);

    let catalog = organizer.get(address, "/api/modules").await.body;
    let available: Vec<_> = statuses(&catalog)
        .into_iter()
        .filter(|(_, s)| s == "available")
        .map(|(m, _)| m)
        .collect();
    assert_eq!(available, ["tournaments"]);

    lab.finish().await;
}

// ---------------------------------------------------------------- №6

#[tokio::test]
async fn t06_revoked_grant_or_session_stops_access_immediately() {
    let mut lab = Lab::new().await;
    let (user_id, mut user) = lab.user("reader@qubite.ru").await;
    let address = lab.address;
    let docs = ModuleId::new("docs").unwrap();
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": false, "manage": false, "ai": true }),
    )
    .await;
    assert_eq!(user.get(address, "/api/probe/docs/items").await.status, 200);

    // Долгоживущее соединение (WebSocket) держит разрешение и проверяет его
    // перед каждым сообщением; фоновая задача уже в очереди.
    let session_id: Uuid = user.get(address, "/api/auth/me").await.body["session_id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let subject = Subject::account(user_id, Some(session_id));
    let socket = qubite_policy::decide::<Read>(lab.db.pool(), &subject, &docs)
        .await
        .unwrap();
    assert!(socket.recheck(lab.db.pool()).await.is_ok());
    assert_eq!(
        user.post(address, "/api/probe/docs/ai/later").await.status,
        200
    );

    lab.revoke(user_id, "docs").await;

    // Всё прекращается сразу: HTTP, соединение, задача.
    let reply = user.get(address, "/api/probe/docs/items").await;
    assert_eq!(reply.status, 403);
    assert_eq!(reply.body["error"], "module_not_granted");
    assert_eq!(
        denied(socket.recheck(lab.db.pool()).await),
        DenyReason::ModuleNotGranted
    );
    assert_eq!(run_ai_jobs(&lab.db, &lab.calls).await, 0);
    let catalog = user.get(address, "/api/modules").await.body;
    assert_eq!(status_of(&catalog, "docs").as_deref(), Some("locked"));

    // Снова выдали — снова работает; отозвали сессию — соединение теряет доступ.
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": false, "manage": false, "ai": false }),
    )
    .await;
    let socket = qubite_policy::decide::<Read>(lab.db.pool(), &subject, &docs)
        .await
        .unwrap();
    assert_eq!(user.post(address, "/api/auth/logout").await.status, 204);
    assert_eq!(
        denied(socket.recheck(lab.db.pool()).await),
        DenyReason::Unauthenticated
    );

    // Блокировка аккаунта останавливает и задачи без сессии.
    let authority = Authority {
        subject: Subject::account(user_id, None),
        module: docs.clone(),
        action: qubite_policy::ActionKind::Read,
    };
    assert!(authority.recheck::<Read>(lab.db.pool()).await.is_ok());
    sqlx::query("UPDATE accounts SET status = 'blocked' WHERE id = $1")
        .bind(user_id)
        .execute(lab.db.pool())
        .await
        .unwrap();
    assert_eq!(
        denied(authority.recheck::<Read>(lab.db.pool()).await),
        DenyReason::AccountInactive
    );

    // Журнал: кто выдал и отозвал.
    let actions: Vec<String> = sqlx::query_scalar(
        "SELECT action FROM audit_log WHERE target_kind = 'module_grant' ORDER BY seq",
    )
    .fetch_all(lab.db.pool())
    .await
    .unwrap();
    assert_eq!(
        actions,
        [
            "module.grant_set",
            "module.grant_revoked",
            "module.grant_set"
        ]
    );

    assert_eq!(lab.calls(), 0);
    lab.finish().await;
}

/// №6, задачи: задача, поставленная из сессии, останавливается, если эту
/// сессию отозвали (украденный вход закрыли — его задачи тоже). Просто
/// истёкшая сессия задачу не останавливает (D-179).
#[tokio::test]
async fn t06_revoked_session_stops_its_scheduled_jobs() {
    let mut lab = Lab::new().await;
    let (user_id, mut first) = lab.user("jobs@qubite.ru").await;
    let address = lab.address;
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": false, "manage": false, "ai": true }),
    )
    .await;

    // Сессия истекла после постановки задачи — задача выполняется.
    assert_eq!(
        first.post(address, "/api/probe/docs/ai/later").await.status,
        200
    );
    sqlx::query("UPDATE sessions SET expires_at = now() - interval '1 second'")
        .execute(lab.db.pool())
        .await
        .unwrap();
    assert_eq!(run_ai_jobs(&lab.db, &lab.calls).await, 1);

    // Сессию отозвали («выйти везде») — её задачи не идут к провайдеру.
    let mut second = Browser::default();
    assert_eq!(
        second
            .login(address, "jobs@qubite.ru", USER_PASSWORD)
            .await
            .status,
        200
    );
    assert_eq!(
        second
            .post(address, "/api/probe/docs/ai/later")
            .await
            .status,
        200
    );
    assert_eq!(
        second
            .post(address, "/api/auth/logout-everywhere")
            .await
            .status,
        200
    );
    assert_eq!(run_ai_jobs(&lab.db, &lab.calls).await, 0);

    // Задача от имени аккаунта без сессии от отзыва сессий не зависит.
    let docs = ModuleId::new("docs").unwrap();
    let authority = Authority {
        subject: Subject::account(user_id, None),
        module: docs,
        action: qubite_policy::ActionKind::Ai,
    };
    assert!(authority.recheck::<UseAi>(lab.db.pool()).await.is_ok());

    assert_eq!(lab.calls(), 1);
    lab.finish().await;
}

// ---------------------------------------------------------------- №7

#[tokio::test]
async fn t07_guest_and_public_link_have_no_paid_capabilities() {
    let lab = Lab::new().await;
    let address = lab.address;
    let docs = ModuleId::new("docs").unwrap();

    // Гость на уровне Policy Gate: ни AI, ни записи, ни чтения модуля.
    assert_eq!(
        denied(qubite_policy::decide::<UseAi>(lab.db.pool(), &Subject::Guest, &docs).await),
        DenyReason::GuestNotAllowed
    );
    assert_eq!(
        denied(qubite_policy::decide::<Write>(lab.db.pool(), &Subject::Guest, &docs).await),
        DenyReason::GuestNotAllowed
    );
    assert!(
        qubite_policy::catalog::catalog_for(lab.db.pool(), &Subject::Guest)
            .await
            .is_err()
    );

    // Аноним по HTTP.
    let mut anonymous = Browser::default();
    assert_eq!(
        anonymous.post(address, "/api/probe/docs/ai").await.status,
        401
    );
    assert_eq!(
        anonymous.get(address, "/api/probe/docs/items").await.status,
        401
    );
    assert_eq!(anonymous.get(address, "/api/modules").await.status, 401);

    assert_eq!(lab.calls(), 0);
    lab.finish().await;
}

// ---------------------------------------------------------------- №8

#[tokio::test]
async fn t08_agent_plugin_mcp_cannot_exceed_initiator() {
    let mut lab = Lab::new().await;
    let (user_id, _user) = lab.user("delegator@qubite.ru").await;
    let docs = ModuleId::new("docs").unwrap();
    let planner = ModuleId::new("planner").unwrap();
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": false, "manage": false, "ai": false }),
    )
    .await;
    let pool = lab.db.pool();

    // Потолок агента шире, чем права человека, — действуют права человека.
    let wide = Subject::Delegated {
        account_id: user_id,
        session_id: None,
        via: "agent".into(),
        ceiling: vec![(docs.clone(), Flags::ALL), (planner.clone(), Flags::ALL)],
    };
    assert!(
        qubite_policy::decide::<Read>(pool, &wide, &docs)
            .await
            .is_ok()
    );
    assert_eq!(
        denied(qubite_policy::decide::<Write>(pool, &wide, &docs).await),
        DenyReason::ActionNotGranted
    );
    assert_eq!(
        denied(qubite_policy::decide::<UseAi>(pool, &wide, &docs).await),
        DenyReason::AiNotGranted
    );
    assert_eq!(
        denied(qubite_policy::decide::<Read>(pool, &wide, &planner).await),
        DenyReason::ModuleNotGranted
    );

    // Потолок уже прав человека — сужает: ключ без модуля в потолке не может ничего.
    let narrow = Subject::Delegated {
        account_id: user_id,
        session_id: None,
        via: "api_key".into(),
        ceiling: vec![],
    };
    assert_eq!(
        denied(qubite_policy::decide::<Read>(pool, &narrow, &docs).await),
        DenyReason::DelegationLimited
    );

    // Даже агент owner не получает Owner Console и не выходит за свой потолок.
    let owner_id: Uuid = lab.owner.get(lab.address, "/api/auth/me").await.body["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let owner_agent = Subject::Delegated {
        account_id: owner_id,
        session_id: None,
        via: "agent".into(),
        ceiling: vec![(
            docs.clone(),
            Flags {
                read: true,
                ..Flags::NONE
            },
        )],
    };
    assert_eq!(
        denied(qubite_policy::decide_owner(pool, &owner_agent).await),
        DenyReason::NotFound
    );
    assert_eq!(
        denied(qubite_policy::decide::<UseAi>(pool, &owner_agent, &docs).await),
        DenyReason::DelegationLimited
    );
    let allowed = qubite_policy::decide::<Read>(pool, &owner_agent, &docs)
        .await
        .unwrap();
    assert!(!allowed.flags().write, "права делегата — пересечение");

    lab.finish().await;
}

// ---------------------------------------------------------------- №9

#[tokio::test]
async fn t09_only_owner_sees_console_others_get_404() {
    let mut lab = Lab::new().await;
    let (user_id, mut user) = lab.user("curious@qubite.ru").await;
    let address = lab.address;
    let mut anonymous = Browser::default();

    // Owner — обычный интерфейс плюс Console.
    let owner_me = lab.owner.get(address, "/api/auth/me").await;
    assert_eq!(owner_me.body["is_owner"], true);
    assert_eq!(
        lab.owner.get(address, "/api/owner/modules").await.status,
        200
    );
    assert_eq!(
        lab.owner.get(address, "/api/probe/docs/items").await.status,
        200
    );
    let catalog = lab.owner.get(address, "/api/modules").await.body;
    assert_eq!(status_of(&catalog, "docs").as_deref(), Some("available"));

    let console = [
        ("GET", "/api/owner/modules".to_owned()),
        ("PATCH", "/api/owner/modules/docs".to_owned()),
        ("GET", format!("/api/owner/accounts/{user_id}/grants")),
        ("PUT", format!("/api/owner/accounts/{user_id}/grants/docs")),
        (
            "DELETE",
            format!("/api/owner/accounts/{user_id}/grants/docs"),
        ),
    ];
    let body =
        json!({ "read": true, "write": true, "manage": true, "ai": true, "installed": false });
    for browser in [&mut user, &mut anonymous] {
        for (method, path) in &console {
            let reply = match *method {
                "GET" => browser.get(address, path).await,
                "PATCH" => browser.patch_json(address, path, body.clone()).await,
                "PUT" => browser.put_json(address, path, body.clone()).await,
                _ => browser.delete(address, path).await,
            };
            assert_eq!(reply.status, 404, "{method} {path}: {:?}", reply.body);
        }
    }
    // Попытки ничего не изменили.
    assert!(
        qubite_policy::grants::for_account(lab.db.pool(), user_id)
            .await
            .unwrap()
            .is_empty()
    );
    let modules = lab.owner.get(address, "/api/owner/modules").await.body;
    let docs = modules
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == "docs")
        .unwrap();
    assert_eq!(docs["installed"], true);

    lab.finish().await;
}

// ---------------------------------------------------------------- №10

#[tokio::test]
async fn t10_docs_granted_only_docs_usable() {
    let mut lab = Lab::new().await;
    let (user_id, mut user) = lab.user("docs-only@qubite.ru").await;
    let address = lab.address;
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": true, "manage": false, "ai": false }),
    )
    .await;

    let catalog = user.get(address, "/api/modules").await.body;
    assert_eq!(status_of(&catalog, "docs").as_deref(), Some("available"));
    for closed in ["search", "tournaments", "planner"] {
        assert_eq!(
            status_of(&catalog, closed).as_deref(),
            Some("locked"),
            "{closed}"
        );
    }
    let docs = user.get(address, "/api/modules/docs").await.body;
    assert_eq!(
        docs["flags"],
        json!({ "read": true, "write": true, "manage": false, "ai": false })
    );

    assert_eq!(
        user.post(address, "/api/probe/docs/items").await.status,
        200
    );
    assert_eq!(user.post(address, "/api/probe/docs/ai").await.status, 403);
    assert_eq!(
        user.get(address, "/api/probe/search/items").await.status,
        403
    );
    assert_eq!(
        user.get(address, "/api/probe/tournaments/items")
            .await
            .status,
        403
    );

    assert_eq!(lab.calls(), 0);
    lab.finish().await;
}

// ---------------------------------------------------------------- остальное

#[tokio::test]
async fn read_only_grant_rejects_changes() {
    let mut lab = Lab::new().await;
    let (user_id, mut user) = lab.user("ro@qubite.ru").await;
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": false, "manage": false, "ai": false }),
    )
    .await;
    let reply = user.post(lab.address, "/api/probe/docs/items").await;
    assert_eq!(reply.status, 403);
    assert_eq!(reply.body["error"], "action_not_granted");
    lab.finish().await;
}

#[tokio::test]
async fn module_state_preparing_disabled_maintenance() {
    let mut lab = Lab::new().await;
    let (user_id, mut user) = lab.user("states@qubite.ru").await;
    let address = lab.address;

    // Доступ выдан, а модуль ещё не установлен — «Готовится» (D-037).
    lab.grant(
        user_id,
        "ink",
        json!({ "read": true, "write": true, "manage": false, "ai": false }),
    )
    .await;
    let catalog = user.get(address, "/api/modules").await.body;
    assert_eq!(status_of(&catalog, "ink").as_deref(), Some("preparing"));
    let reply = user.get(address, "/api/probe/ink/items").await;
    assert_eq!(reply.body["error"], "module_preparing");

    // Выключен — «Временно недоступен», в том числе для owner.
    lab.grant(
        user_id,
        "docs",
        json!({ "read": true, "write": true, "manage": false, "ai": false }),
    )
    .await;
    lab.owner
        .patch_json(
            address,
            "/api/owner/modules/docs",
            json!({ "state": "disabled" }),
        )
        .await;
    let catalog = user.get(address, "/api/modules").await.body;
    assert_eq!(status_of(&catalog, "docs").as_deref(), Some("unavailable"));
    assert_eq!(
        user.get(address, "/api/probe/docs/items").await.body["error"],
        "module_disabled"
    );
    assert_eq!(
        lab.owner.get(address, "/api/probe/docs/items").await.status,
        403
    );

    // Техработы: пользователю нельзя, owner проверяет модуль.
    lab.owner
        .patch_json(
            address,
            "/api/owner/modules/docs",
            json!({ "state": "maintenance" }),
        )
        .await;
    assert_eq!(
        user.get(address, "/api/probe/docs/items").await.body["error"],
        "module_maintenance"
    );
    assert_eq!(
        lab.owner.get(address, "/api/probe/docs/items").await.status,
        200
    );

    // Неверное значение и устаревшая версия — 400.
    let bad = lab
        .owner
        .patch_json(
            address,
            "/api/owner/modules/docs",
            json!({ "state": "broken" }),
        )
        .await;
    assert_eq!(bad.status, 400);
    let stale = lab
        .owner
        .patch_json(
            address,
            "/api/owner/modules/docs",
            json!({ "state": "enabled", "expected_version": 1 }),
        )
        .await;
    assert_eq!(stale.status, 400);

    lab.finish().await;
}

/// Ни один маршрут API не отдаёт данные без входа, кроме короткого списка
/// публичных. Новый маршрут без проверки сломает этот тест.
#[tokio::test]
async fn every_route_requires_login_except_public_ones() {
    let lab = Lab::new().await;
    let address = lab.address;
    // Вход и обмен кода приложения — публичные по смыслу: они и выдают вход.
    // Письма с кодами (AUTH-002) — для тех, кто войти ещё не может.
    let public = [
        "/api/health",
        "/api/ready",
        "/api/auth/login",
        "/api/auth/device/token",
        "/api/auth/email/verify/request",
        "/api/auth/email/verify",
        "/api/auth/password/forgot",
        "/api/auth/password/reset",
        // Регистрация (AUTH-003) — для тех, у кого аккаунта ещё нет.
        "/api/auth/registration",
        "/api/auth/register",
    ];
    let mut anonymous = Browser::default();
    let document = anonymous.get(address, "/api/openapi.json").await.body;

    let mut checked = 0;
    for (path, item) in document["paths"].as_object().unwrap() {
        if public.contains(&path.as_str()) {
            continue;
        }
        let concrete = path
            .replace("{id}", &Uuid::now_v7().to_string())
            .replace("{account_id}", &Uuid::now_v7().to_string())
            .replace("{module_id}", "docs");
        for method in item.as_object().unwrap().keys() {
            let method = reqwest::Method::from_bytes(method.to_uppercase().as_bytes()).unwrap();
            let reply = anonymous
                .send(address, method.clone(), &concrete, Some(json!({})), true)
                .await;
            assert!(
                matches!(
                    reply.status,
                    StatusCode::UNAUTHORIZED | StatusCode::NOT_FOUND
                ),
                "{method} {path} без входа ответил {}",
                reply.status
            );
            checked += 1;
        }
    }
    assert!(checked >= 12, "проверено маршрутов: {checked}");
    lab.finish().await;
}
