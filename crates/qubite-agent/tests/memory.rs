//! Папка агента на настоящей PostgreSQL (AGT-001): правки строками через
//! ленту и откат, ядро «Кто я», лимиты, вычёркивание секретов, расписание,
//! файл проекта, вопросы раз в неделю; разговор, «Поправить» и фоновый
//! разбор — на поддельной модели (настоящих вызовов AI в тестах нет).

use std::sync::Arc;

use qubite_agent::{
    Error, Feed, RevertOutcome, Trigger, Who, brain, call,
    chat::{self, Channel, NewMessage},
    files::{self, Kind},
    memory, questions, revert_action, start_run, timeline,
};
use qubite_ai::{
    AiConfig, Gateway, MockProvider, MockStep,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn account(pool: &PgPool, email: &str) -> Uuid {
    qubite_auth::accounts::create(
        pool,
        &Passwords::default(),
        NewAccount {
            email,
            display_name: "",
            password: "пароль для теста",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap()
    .id
}

async fn grant(pool: &PgPool, account: Uuid, module: &str) {
    sqlx::query(
        "INSERT INTO module_grants (id, account_id, module_id, can_read, can_write) \
         VALUES ($1, $2, $3, true, true)",
    )
    .bind(Uuid::now_v7())
    .bind(account)
    .bind(module)
    .execute(pool)
    .await
    .unwrap();
}

/// Человек с Planner, Входящими и агентом (без AI).
async fn person(pool: &PgPool, email: &str) -> Uuid {
    let id = account(pool, email).await;
    for module in ["planner", "inbox", "agent"] {
        grant(pool, id, module).await;
    }
    id
}

async fn agent(pool: &PgPool, account: Uuid) -> Who {
    let run = start_run(pool, account, Trigger::Manual).await.unwrap();
    Who::agent(&run)
}

async fn tool(pool: &PgPool, who: &Who, name: &str, args: Value) -> qubite_agent::Result<String> {
    call(pool, who, name, args, Some("тест"), None)
        .await
        .map(|outcome| match outcome {
            qubite_agent::Outcome::Done(action) => action.summary,
            qubite_agent::Outcome::Read(value) => value.to_string(),
        })
}

async fn body(pool: &PgPool, account: Uuid, path: &str) -> String {
    let mut conn = pool.acquire().await.unwrap();
    files::by_path(&mut conn, account, path)
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("нет файла {path}"))
        .body
}

#[tokio::test]
async fn memory_lines_go_through_timeline_and_revert() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@qubite.ru").await;
    memory::ensure_base(pool, me).await.unwrap();
    memory::ensure_base(pool, me).await.unwrap();
    let list = {
        let mut conn = pool.acquire().await.unwrap();
        files::list(&mut conn, me).await.unwrap()
    };
    let kinds: Vec<Kind> = list.iter().map(|f| f.kind).collect();
    assert_eq!(
        kinds,
        [Kind::Core, Kind::User, Kind::Memory],
        "база — один раз"
    );
    let who = agent(pool, me).await;

    let summary = tool(
        pool,
        &who,
        "memory.add",
        json!({"text": "Русский — по вт и чт, третьим уроком"}),
    )
    .await
    .unwrap();
    assert_eq!(
        summary,
        "«Память»: + «- Русский — по вт и чт, третьим уроком»"
    );
    assert!(
        body(pool, me, "Память.md")
            .await
            .ends_with("- Русский — по вт и чт, третьим уроком\n")
    );

    tool(
        pool,
        &who,
        "memory.patch",
        json!({"path": "Память.md", "old": "третьим", "new": "вторым"}),
    )
    .await
    .unwrap();
    let patched = body(pool, me, "Память.md").await;
    assert!(patched.contains("вторым уроком"));

    // Лента: последнее действие — правка, «было → стало» по тексту файла.
    let page = timeline::list(pool, me, Feed::All, None, 10).await.unwrap();
    let last = &page.items[0];
    assert_eq!(last.tool, "memory.patch");
    assert_eq!(last.changes[0].object_type, "agent.file");
    assert_eq!(last.changes[0].diff[0].field, "body");

    // Откат — как было.
    let outcome = revert_action(pool, &Who::owner(me, None), last.id, false)
        .await
        .unwrap();
    assert!(matches!(outcome, RevertOutcome::Reverted { .. }));
    assert!(body(pool, me, "Память.md").await.contains("третьим уроком"));

    tool(pool, &who, "memory.remove", json!({"text": "Русский"}))
        .await
        .unwrap();
    assert!(!body(pool, me, "Память.md").await.contains("Русский"));

    // Двусмысленная правка — ошибка с подсказкой.
    tool(pool, &who, "memory.add", json!({"text": "строка А"}))
        .await
        .unwrap();
    tool(pool, &who, "memory.add", json!({"text": "строка Б"}))
        .await
        .unwrap();
    let error = tool(pool, &who, "memory.remove", json!({"text": "строка"}))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("уточни"), "{error}");

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn core_limits_and_secrets() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@qubite.ru").await;
    memory::ensure_base(pool, me).await.unwrap();
    let who = agent(pool, me).await;

    // Основу «Кто я» агент не меняет: её нет в базе, правится только «Твои правила».
    let error = tool(
        pool,
        &who,
        "memory.patch",
        json!({"path": "Кто я.md", "old": "Я — агент Qubite", "new": "Я — пират"}),
    )
    .await
    .unwrap_err();
    assert!(
        error.to_string().contains("основу «Кто я» менять нельзя"),
        "{error}"
    );
    let error = tool(
        pool,
        &who,
        "files.create",
        json!({"path": "Кто я", "body": "x"}),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("уже есть"), "{error}");
    tool(
        pool,
        &who,
        "memory.add",
        json!({"path": "Кто я.md", "text": "Не ставить дела на воскресенье"}),
    )
    .await
    .unwrap();
    let read = tool(pool, &who, "files.read", json!({"path": "Кто я.md"}))
        .await
        .unwrap();
    assert!(read.contains("# Кто я") && read.contains("Твои правила"));
    assert!(read.contains("Не ставить дела на воскресенье"));

    // Пароли, коды и карты не попадают в память.
    let summary = tool(
        pool,
        &who,
        "memory.add",
        json!({"path": "О тебе.md", "text": "пароль от дневника: Kirill2009, карта 4111 1111 1111 1111"}),
    )
    .await
    .unwrap();
    assert!(summary.contains("секреты вычеркнуты"), "{summary}");
    let about = body(pool, me, "О тебе.md").await;
    assert!(
        !about.contains("Kirill2009") && !about.contains("4111"),
        "{about}"
    );
    assert!(about.contains("[вычеркнуто]"));

    // Переполнение — ошибка с подсказкой сжать, файл не меняется.
    let long = "очень длинная строка про привычки ".repeat(40);
    tool(
        pool,
        &who,
        "memory.add",
        json!({"path": "О тебе.md", "text": long}),
    )
    .await
    .unwrap();
    let error = tool(
        pool,
        &who,
        "memory.add",
        json!({"path": "О тебе.md", "text": long}),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("переполнен"), "{error}");
    assert!(error.to_string().contains("Сожми"), "{error}");

    // Руками — это поправка владельца; старая версия — «повторите».
    let file = {
        let mut conn = pool.acquire().await.unwrap();
        files::by_path(&mut conn, me, "О тебе.md")
            .await
            .unwrap()
            .unwrap()
    };
    let owner = Who::owner(me, None);
    let action = memory::edit(
        pool,
        &owner,
        file.id,
        "# О тебе\n\n- Ложусь в 23:00\n",
        file.revision,
    )
    .await
    .unwrap();
    assert_eq!(action.summary, "Поправил «О тебе» руками");
    assert!(matches!(
        memory::edit(pool, &owner, file.id, "ещё", file.revision).await,
        Err(Error::Busy)
    ));
    assert!(matches!(
        memory::edit(pool, &who, file.id, "ещё", file.revision + 1).await,
        Err(Error::NeedsOwner(_))
    ));

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn schedule_file_project_file_and_questions() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@qubite.ru").await;
    memory::ensure_base(pool, me).await.unwrap();
    let who = agent(pool, me).await;

    // Расписание — строгая таблица; неверная не записывается.
    let error = tool(
        pool,
        &who,
        "files.create",
        json!({"path": "Расписание.md", "body": "Русский по вторникам"}),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("| День | Начало |"), "{error}");
    tool(
        pool,
        &who,
        "files.create",
        json!({"path": "Расписание", "body": "# Уроки\n\n| День | Начало | Конец | Что | Где |\n|---|---|---|---|---|\n| вт, чт | 10:05 | 10:50 | Русский | школа |\n"}),
    )
    .await
    .unwrap();
    let slots = {
        let mut conn = pool.acquire().await.unwrap();
        files::schedule::slots(&mut conn, me).await.unwrap()
    };
    assert_eq!(slots.len(), 2);
    assert_eq!((slots[0].weekday, slots[1].weekday), (2, 4));
    // Строка в таблицу — тоже проверяется.
    let error = tool(
        pool,
        &who,
        "memory.add",
        json!({"path": "Расписание.md", "text": "| пт | 25:00 | 26:00 | Физра | |"}),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("ЧЧ:ММ"), "{error}");
    tool(
        pool,
        &who,
        "memory.add",
        json!({"path": "Расписание.md", "text": "| пт | 12:00 | 12:45 | Алгебра | 214 |"}),
    )
    .await
    .unwrap();
    let slots = {
        let mut conn = pool.acquire().await.unwrap();
        files::schedule::slots(&mut conn, me).await.unwrap()
    };
    assert_eq!(slots.len(), 3);

    // Файл проекта связан с проектом: виден в ленте проекта.
    let project = tool(
        pool,
        &who,
        "project.create",
        json!({"title": "Алгебра", "fields": {"tag": "алгебра"}}),
    )
    .await
    .unwrap();
    assert_eq!(project, "Создал проект «Алгебра»");
    let project_id: Uuid = sqlx::query_scalar(
        "SELECT id FROM objects WHERE owner_id = $1 AND type = 'planner.project'",
    )
    .bind(me)
    .fetch_one(pool)
    .await
    .unwrap();
    tool(
        pool,
        &who,
        "memory.add",
        json!({"path": "Проекты/алгебра", "text": "Учитель — Ирина Петровна"}),
    )
    .await
    .unwrap();
    let file = {
        let mut conn = pool.acquire().await.unwrap();
        files::of_project(&mut conn, me, project_id)
            .await
            .unwrap()
            .unwrap()
    };
    assert_eq!(
        (file.path.as_str(), file.kind),
        ("Проекты/алгебра.md", Kind::Project)
    );
    let feed = timeline::list(pool, me, Feed::Project(project_id), None, 10)
        .await
        .unwrap();
    assert!(
        feed.items
            .iter()
            .any(|a| a.summary.starts_with("Завёл файл «алгебра»"))
    );

    // Вопрос — не чаще раза в неделю.
    tool(
        pool,
        &who,
        "question.ask",
        json!({"text": "Во сколько кончаются уроки в среду?", "why": "чтобы предлагать ДЗ", "options": ["13:00", "14:00"]}),
    )
    .await
    .unwrap();
    let error = tool(
        pool,
        &who,
        "question.ask",
        json!({"text": "во сколько кончаются уроки в среду"}),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("уже ждёт ответа"), "{error}");
    let open = {
        let mut conn = pool.acquire().await.unwrap();
        questions::open(&mut conn, me).await.unwrap()
    };
    assert_eq!(open.len(), 1);
    assert_eq!(open[0].options, ["13:00", "14:00"]);
    let answered = memory::answer(pool, &Who::owner(me, None), open[0].id, "в 14:00")
        .await
        .unwrap();
    assert!(answered.summary.starts_with("Ответил на"));
    let error = tool(
        pool,
        &who,
        "question.ask",
        json!({"text": "Во сколько кончаются уроки в среду?"}),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("раза в неделю"), "{error}");

    db.close().await;
    test_db.drop_db().await;
}

// ---------------------------------------------------------------- с моделью

struct Ai {
    gateway: Gateway,
    mock: Arc<MockProvider>,
}

/// Owner с поддельной моделью для задач агента и личным лимитом.
async fn ai(pool: &PgPool, owner: Uuid, steps: Vec<MockStep>) -> Ai {
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
    admin::set_task_model(pool, &console, "default", Some("mock-agent"))
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
            tokens_in: 10,
            tokens_out: 10,
        })
        .script(steps),
    );
    Ai {
        gateway: Gateway::new(pool.clone(), AiConfig::default())
            .with_provider("mock", mock.clone()),
        mock,
    }
}

fn reply(value: Value) -> MockStep {
    MockStep::Reply {
        text: value.to_string(),
        tokens_in: 100,
        tokens_out: 50,
    }
}

async fn owner(pool: &PgPool) -> Uuid {
    qubite_auth::owner::create(
        pool,
        &Passwords::default(),
        "owner@qubite.ru",
        "",
        "пароль владельца",
    )
    .await
    .unwrap()
    .id
}

async fn say(
    pool: &PgPool,
    account: Uuid,
    channel: Channel,
    text: &str,
    file: Option<Uuid>,
) -> chat::Message {
    chat::post(
        pool,
        NewMessage {
            account,
            channel,
            text: text.into(),
            file_id: file,
            telegram: None,
        },
    )
    .await
    .unwrap()
}

#[tokio::test]
async fn chat_turn_writes_memory_schedule_and_questions() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    let ai = ai(
        pool,
        me,
        vec![
            // Ход 1: прочитать файлы.
            reply(json!({"tools": [{"tool": "files.list", "args": {}}]})),
            // Ход 2: записать и спросить.
            reply(json!({
                "say": "Запомнил: русский по вт и чт. Во сколько кончаются уроки в среду?",
                "tools": [
                    {"tool": "memory.add", "args": {"path": "О тебе.md", "text": "Учится в 9 классе"}, "why": "сказал сам"},
                    {"tool": "files.create", "args": {"path": "Расписание.md", "body": "| День | Начало | Конец | Что |\n|---|---|---|---|\n| вт, чт | 10:05 | 10:50 | Русский |\n"}},
                    {"tool": "memory.add", "args": {"text": "Расписание — в Расписание.md"}},
                    {"tool": "memory.add", "args": {"path": "Проекты/Русский.md", "text": "Учительница строгая к оформлению"}},
                    {"tool": "question.ask", "args": {"text": "Во сколько кончаются уроки в среду?", "why": "чтобы предлагать ДЗ"}},
                    {"tool": "task.update", "args": {"task_id": Uuid::nil(), "fields": {"status": "done"}}},
                ],
            })),
            // Ход 3: ошибка ушла модели — она отвечает с учётом её.
            reply(json!({"say": "Запомнил: русский по вт и чт. «Сделано» отмечаешь ты. Во сколько кончаются уроки в среду?"})),
        ],
    )
    .await;

    let message = say(
        pool,
        me,
        Channel::Web,
        "Я в 9 классе, русский по вт и чт третьим уроком, учительница строгая",
        None,
    )
    .await;
    assert_eq!(message.status, "pending");
    let reply_message = brain::chat_turn(pool, &ai.gateway, message.id, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(ai.mock.calls(), 3, "чтение → действия → ответ на ошибку");
    assert_eq!(reply_message.role, "agent");
    assert!(reply_message.text.starts_with("Запомнил"));
    assert_eq!(reply_message.actions, 5);

    // Модель видела основу, «Память» и слова владельца отдельными блоками.
    let call = ai.mock.last_call().unwrap();
    let system = &call.messages[0].content;
    assert!(system.contains("# Кто я") && system.contains("memory.add"));
    let data = &call.messages[1].content;
    assert!(data.contains("source=\"owner\"") && data.contains("source=\"memory\""));
    assert!(
        data.contains("source=\"tool_results\""),
        "результаты — следующим ходом"
    );
    assert!(
        data.contains("может только ты"),
        "отказ «сделано» виден модели"
    );

    assert!(
        body(pool, me, "О тебе.md")
            .await
            .contains("Учится в 9 классе")
    );
    assert!(
        body(pool, me, "Память.md")
            .await
            .contains("Расписание — в Расписание.md")
    );
    assert!(
        body(pool, me, "Проекты/Русский.md")
            .await
            .contains("строгая")
    );
    let slots = {
        let mut conn = pool.acquire().await.unwrap();
        files::schedule::slots(&mut conn, me).await.unwrap()
    };
    assert_eq!(slots.len(), 2);

    // Всё — в ленте, с ценой вызова; «сделано» за владельца агент не ставит.
    let page = timeline::list(pool, me, Feed::All, None, 20).await.unwrap();
    assert_eq!(page.items.len(), 5);
    assert!(page.items.iter().all(|a| a.cost_usd_micros.is_some()));
    assert!(
        page.items.iter().all(|a| a.state.batch_size == 5),
        "один ход — один пакет"
    );
    // Сообщение владельца отвечено; разбор разговора поставлен в очередь.
    let mut conn = pool.acquire().await.unwrap();
    let mine = chat::get(&mut conn, message.id).await.unwrap().unwrap();
    assert_eq!(mine.status, "done");
    let review: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = 'agent.review'")
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(review, 1);
    drop(conn);

    // Задачу выполнили второй раз — второго ответа нет.
    assert!(
        brain::chat_turn(pool, &ai.gateway, message.id, None)
            .await
            .unwrap()
            .is_none()
    );

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn fix_field_corrects_file_at_once_and_review_remembers() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = owner(pool).await;
    memory::ensure_base(pool, me).await.unwrap();
    let who = agent(pool, me).await;
    tool(
        pool,
        &who,
        "memory.add",
        json!({"text": "Русский — по средам"}),
    )
    .await
    .unwrap();
    let memory_file = {
        let mut conn = pool.acquire().await.unwrap();
        files::by_path(&mut conn, me, "Память.md")
            .await
            .unwrap()
            .unwrap()
    };
    let ai = ai(
        pool,
        me,
        vec![
            reply(json!({
                "say": "Исправил: русский по вт и чт.",
                "tools": [{"tool": "memory.patch", "args": {"path": "Память.md", "old": "по средам", "new": "по вт и чт"}}],
            })),
            reply(json!({
                "tools": [{"tool": "memory.add", "args": {"path": "О тебе.md", "text": "Поправляет быстро и коротко"}}],
            })),
        ],
    )
    .await;

    let fix = say(
        pool,
        me,
        Channel::Fix,
        "Это не так, на самом деле по вт и чт",
        Some(memory_file.id),
    )
    .await;
    let reply_message = brain::chat_turn(pool, &ai.gateway, fix.id, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reply_message.text, "Исправил: русский по вт и чт.");
    assert_eq!(reply_message.channel, Channel::Fix);
    let fixed = body(pool, me, "Память.md").await;
    assert!(fixed.contains("Русский — по вт и чт") && !fixed.contains("по средам"));
    let call = ai.mock.last_call().unwrap();
    assert!(call.messages[1].content.contains("source=\"fix_file\""));
    assert!(call.messages[0].content.contains("«Поправить»"));
    // Правка — в ленте и откатывается.
    let page = timeline::list(pool, me, Feed::Object(memory_file.id), None, 10)
        .await
        .unwrap();
    assert_eq!(page.items[0].tool, "memory.patch");

    // Фоновый разбор: разговор продолжился — пропуск; иначе — что запомнить.
    let mut conn = pool.acquire().await.unwrap();
    let all = chat::list(&mut conn, me, None, 10).await.unwrap();
    drop(conn);
    let last = all.last().unwrap().seq;
    assert_eq!(
        brain::review(pool, &ai.gateway, me, last - 1, None)
            .await
            .unwrap(),
        0,
        "после него были сообщения"
    );
    assert_eq!(
        brain::review(pool, &ai.gateway, me, last, None)
            .await
            .unwrap(),
        1
    );
    assert!(
        body(pool, me, "О тебе.md")
            .await
            .contains("Поправляет быстро")
    );
    let calls = ai.mock.calls();
    assert_eq!(
        brain::review(pool, &ai.gateway, me, last, None)
            .await
            .unwrap(),
        0
    );
    assert_eq!(ai.mock.calls(), calls, "уже разобрано — модель не зовём");
    let system = &ai.mock.last_call().unwrap().messages[0].content;
    assert!(system.contains("фоновый разбор"));

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn without_agent_or_ai_the_model_is_never_called() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let boss = owner(pool).await;
    let ai = ai(pool, boss, Vec::new()).await;

    // Без гранта на агента писать ему нельзя.
    let stranger = account(pool, "x@qubite.ru").await;
    let error = chat::post(
        pool,
        NewMessage {
            account: stranger,
            channel: Channel::Web,
            text: "привет".into(),
            file_id: None,
            telegram: None,
        },
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::Denied(_)), "{error}");

    // Агент есть, AI нет — агент честно говорит, модель не вызывается.
    let me = person(pool, "me@qubite.ru").await;
    let message = say(
        pool,
        me,
        Channel::Web,
        "пароль от почты: 123456, запомни",
        None,
    )
    .await;
    assert_eq!(message.text, "пароль от почты: [вычеркнуто], запомни");
    let answer = brain::chat_turn(pool, &ai.gateway, message.id, None)
        .await
        .unwrap()
        .unwrap();
    assert!(
        answer.text.starts_with("Не могу ответить: нет AI"),
        "{}",
        answer.text
    );
    assert_eq!(ai.mock.calls(), 0);
    let mut conn = pool.acquire().await.unwrap();
    assert_eq!(
        chat::get(&mut conn, message.id)
            .await
            .unwrap()
            .unwrap()
            .status,
        "failed"
    );
    drop(conn);

    db.close().await;
    test_db.drop_db().await;
}
