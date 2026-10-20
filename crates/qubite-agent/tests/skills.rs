//! Навыки на настоящей PostgreSQL (AGT-003): встроенные навыки, skill.* через
//! ленту и откат, уточнение одной строкой, куратор раз в неделю; урок на
//! поправке владельца и «в следующий раз по-новому» — на поддельной модели
//! (настоящих вызовов AI в тестах нет).

use std::sync::Arc;

use qubite_agent::{
    Actor, Error, Feed, RevertOutcome, Trigger, Who, brain, call,
    chat::{self, Channel, NewMessage},
    files::{self, Kind},
    fix, memory, revert_action, revert_batch,
    skills::{self, OwnerChange},
    start_run, timeline,
};
use qubite_ai::{
    AiConfig, Gateway, MockProvider, MockStep,
    admin::{self, LimitScope, Metric, ModelSpec, Period, ProviderSpec},
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_testkit::TestDb;
use serde_json::{Map, Value, json};
use sqlx::PgPool;
use time::{Duration, OffsetDateTime};
use uuid::Uuid;

async fn person(pool: &PgPool, email: &str) -> Uuid {
    let id = qubite_auth::accounts::create(
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
    .id;
    for module in ["planner", "inbox", "agent"] {
        sqlx::query(
            "INSERT INTO module_grants (id, account_id, module_id, can_read, can_write) \
             VALUES ($1, $2, $3, true, true)",
        )
        .bind(Uuid::now_v7())
        .bind(id)
        .bind(module)
        .execute(pool)
        .await
        .unwrap();
    }
    id
}

async fn agent(pool: &PgPool, account: Uuid) -> Who {
    let run = start_run(pool, account, Trigger::Manual).await.unwrap();
    Who::agent(&run)
}

async fn tool(
    pool: &PgPool,
    who: &Who,
    name: &str,
    args: Value,
    why: Option<&str>,
) -> qubite_agent::Result<String> {
    call(pool, who, name, args, why, None)
        .await
        .map(|outcome| match outcome {
            qubite_agent::Outcome::Done(action) => action.summary,
            qubite_agent::Outcome::Read(value) => value.to_string(),
        })
}

async fn skill(pool: &PgPool, account: Uuid, name: &str) -> files::File {
    let mut conn = pool.acquire().await.unwrap();
    skills::find(&mut conn, account, name)
        .await
        .unwrap()
        .unwrap_or_else(|| panic!("нет навыка {name}"))
}

const DZ: &str = "## Когда\nВладелец записал ДЗ по русскому.\n\n## Как\n1. Срок — день следующего урока.\n2. Сделать — утром в день урока.\n";

#[tokio::test]
async fn skills_are_written_refined_by_one_line_and_reverted() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@qubite.ru").await;

    // Встроенные навыки заводятся вместе с папкой — один раз, без ленты.
    memory::ensure_base(pool, me).await.unwrap();
    memory::ensure_base(pool, me).await.unwrap();
    let all = {
        let mut conn = pool.acquire().await.unwrap();
        skills::list(&mut conn, me).await.unwrap()
    };
    let names: Vec<&str> = all.iter().map(|s| s.name.as_str()).collect();
    assert_eq!(
        names,
        ["ДЗ к уроку", "Записать расписание", "Сходить куда-то"]
    );
    assert!(all.iter().all(|s| s.builtin && s.version == Some(1)));
    let page = timeline::list(pool, me, Feed::All, None, 10).await.unwrap();
    assert!(page.items.is_empty(), "основа — не действие агента");

    let who = agent(pool, me).await;
    // Новый навык — только с причиной; память-инструменты навык не правят.
    let error = tool(
        pool,
        &who,
        "skill.create",
        json!({"name": "ДЗ по русскому", "description": "как ставить ДЗ по русскому", "body": DZ}),
        None,
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("нужна причина"), "{error}");
    let error = tool(
        pool,
        &who,
        "skill.create",
        json!({"name": "Терминал", "description": "запускать команды", "body": DZ, "tools": ["shell.run"]}),
        Some("три повтора"),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("не даёт новых"), "{error}");
    let summary = tool(
        pool,
        &who,
        "skill.create",
        json!({"name": "ДЗ по русскому", "description": "Как ставить ДЗ по русскому", "body": DZ, "tools": ["task.create"]}),
        Some("ты поправил срок ДЗ 20.10"),
    )
    .await
    .unwrap();
    assert_eq!(
        summary,
        "Завёл навык «ДЗ по русскому»: Как ставить ДЗ по русскому"
    );
    let created = skill(pool, me, "дз по русскому").await;
    assert_eq!(created.path, "Навыки/ДЗ по русскому.md");
    assert_eq!(created.kind, Kind::Skill);
    assert!(created.body.starts_with("---\nname: ДЗ по русскому\n"));
    assert!(created.body.contains("tools: [task.create]"));
    for (name, args) in [
        (
            "memory.patch",
            json!({"path": "Навыки/ДЗ по русскому.md", "old": "утром", "new": "вечером"}),
        ),
        (
            "files.create",
            json!({"path": "Навыки/Новый.md", "body": "---\nname: Новый\ndescription: а\n---\n"}),
        ),
    ] {
        let error = tool(pool, &who, name, args, Some("тест"))
            .await
            .unwrap_err();
        assert!(error.to_string().contains("skill.patch"), "{name}: {error}");
    }
    let error = tool(
        pool,
        &who,
        "skill.create",
        json!({"name": "ДЗ по русскому", "description": "ещё раз", "body": DZ}),
        Some("тест"),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("уже есть"), "{error}");

    // Уточнение — одной строкой: переписать или менять имя нельзя.
    for args in [
        json!({"name": "ДЗ по русскому", "old": "1. Срок — день следующего урока.\n2.", "new": "2."}),
        json!({"name": "ДЗ по русскому", "old": "name: ДЗ по русскому", "new": "name: ДЗ"}),
        json!({"name": "ДЗ по русскому", "old": "в полночь", "new": "вечером"}),
    ] {
        assert!(
            matches!(
                tool(pool, &who, "skill.patch", args.clone(), Some("тест")).await,
                Err(Error::Invalid(_))
            ),
            "{args}"
        );
    }
    let summary = tool(
        pool,
        &who,
        "skill.patch",
        json!({"name": "ДЗ по русскому", "old": "Сделать — утром в день урока.", "new": "Сделать — вечером накануне урока."}),
        Some("ты поправил: «ДЗ — вечером накануне», 20.10"),
    )
    .await
    .unwrap();
    assert_eq!(
        summary,
        "Навык «ДЗ по русскому»: «утром в день» → «вечером накануне»"
    );
    let patched = skill(pool, me, "ДЗ по русскому").await;
    assert!(patched.body.contains("вечером накануне урока"));
    assert!(patched.body.contains("version: 2\n"), "версия растёт сама");

    // В ленте — «было → стало» и причина; откат возвращает строку.
    let page = timeline::list(pool, me, Feed::Object(patched.id), None, 10)
        .await
        .unwrap();
    let last = &page.items[0];
    assert_eq!(last.tool, "skill.patch");
    assert_eq!(
        last.reason.as_deref(),
        Some("ты поправил: «ДЗ — вечером накануне», 20.10")
    );
    assert_eq!(last.changes[0].diff[0].field, "body");
    let owner = Who::owner(me, None);
    let RevertOutcome::Reverted { .. } = revert_action(pool, &owner, last.id, false).await.unwrap()
    else {
        panic!("откат без конфликта");
    };
    let back = skill(pool, me, "ДЗ по русскому").await;
    assert!(back.body.contains("утром в день урока") && back.body.contains("version: 1\n"));

    // Список — с описаниями; открыть целиком — значит, воспользоваться.
    let listed = tool(pool, &who, "skill.list", json!({}), None)
        .await
        .unwrap();
    assert!(listed.contains("Как ставить ДЗ по русскому"), "{listed}");
    assert!(!listed.contains("## Как"), "целиком — только skill.view");
    let viewed = tool(
        pool,
        &who,
        "skill.view",
        json!({"name": "ДЗ по русскому"}),
        None,
    )
    .await
    .unwrap();
    assert!(viewed.contains("утром в день урока"));
    assert_eq!(skill(pool, me, "ДЗ по русскому").await.uses, 1);

    // Закреплённый агент не убирает; остальные — в архив и из списка.
    skills::owner_set(pool, &owner, back.id, OwnerChange::Pin(true))
        .await
        .unwrap();
    let error = tool(
        pool,
        &who,
        "skill.archive",
        json!({"name": "ДЗ по русскому"}),
        Some("устарел"),
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("закреплён"), "{error}");
    tool(
        pool,
        &who,
        "skill.archive",
        json!({"name": "Сходить куда-то"}),
        Some("не ходит никуда"),
    )
    .await
    .unwrap();
    let listed = tool(pool, &who, "skill.list", json!({}), None)
        .await
        .unwrap();
    assert!(!listed.contains("Сходить куда-то"));
    let archived = tool(pool, &who, "skill.list", json!({"archived": true}), None)
        .await
        .unwrap();
    assert!(archived.contains("Сходить куда-то"));
    // Флаги навыка есть только у навыка.
    let memory_file = {
        let mut conn = pool.acquire().await.unwrap();
        files::by_path(&mut conn, me, "Память.md")
            .await
            .unwrap()
            .unwrap()
    };
    assert!(matches!(
        skills::owner_set(pool, &owner, memory_file.id, OwnerChange::Pin(true)).await,
        Err(Error::NotFound)
    ));
    // Действовать по навыку — тоже пользоваться: в ленте видно, по какому.
    let action = call(
        pool,
        &who.clone().with_skill(back.id),
        "task.create",
        json!({"title": "Русский: упр. 145", "fields": {"due_date": "2026-10-22"}}),
        Some("по навыку"),
        None,
    )
    .await
    .unwrap()
    .action()
    .unwrap();
    assert_eq!(action.skill_id, Some(back.id));
    assert_eq!(skill(pool, me, "ДЗ по русскому").await.uses, 2);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn curator_archives_unused_skills_weekly_and_they_come_back() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "me@qubite.ru").await;
    memory::ensure_base(pool, me).await.unwrap();
    let owner = Who::owner(me, None);
    let pinned = skill(pool, me, "Записать расписание").await;
    skills::owner_set(pool, &owner, pinned.id, OwnerChange::Pin(true))
        .await
        .unwrap();

    // Свежие навыки куратор не трогает.
    let now = OffsetDateTime::now_utc();
    assert!(skills::curate(pool, me, now).await.unwrap().is_empty());
    // Через 31 день: два встроенных — в архив, закреплённый остался.
    let later = now + Duration::days(31);
    assert_eq!(skills::curate_all(pool, later).await.unwrap(), 2);
    let page = timeline::list(pool, me, Feed::All, None, 10).await.unwrap();
    let curated: Vec<_> = page
        .items
        .iter()
        .filter(|a| a.tool == "skill.curate")
        .collect();
    assert_eq!(curated.len(), 2);
    assert!(curated.iter().all(|a| a.actor == Actor::System));
    assert!(
        curated[0]
            .summary
            .starts_with("Куратор: убрал в архив навык «")
    );
    assert!(curated[0].summary.ends_with("— не пользовался 30 дней"));
    assert_eq!(curated[0].batch_id, curated[1].batch_id, "одним пакетом");
    assert_eq!(curated[0].changes[0].diff[0].field, "archived");
    let mut conn = pool.acquire().await.unwrap();
    let all = skills::list(&mut conn, me).await.unwrap();
    drop(conn);
    let archived: Vec<&str> = all
        .iter()
        .filter(|s| s.archived)
        .map(|s| s.name.as_str())
        .collect();
    assert_eq!(archived, ["ДЗ к уроку", "Сходить куда-то"]);
    assert!(
        skills::prompt_list(&all).contains("Записать расписание")
            && !skills::prompt_list(&all).contains("ДЗ к уроку"),
        "агент видит только живые"
    );
    // Второй раз — ничего нового.
    assert_eq!(skills::curate_all(pool, later).await.unwrap(), 0);

    // Вернуть — одной кнопкой: откат пакета куратора…
    let RevertOutcome::Reverted { actions } =
        revert_batch(pool, &owner, curated[0].batch_id, false)
            .await
            .unwrap()
    else {
        panic!("откат без конфликта");
    };
    assert_eq!(actions.len(), 2);
    let homework = skill(pool, me, "ДЗ к уроку").await;
    assert!(!homework.archived);
    // … или «Вернуть из архива»: часы куратора идут заново.
    skills::owner_set(pool, &owner, homework.id, OwnerChange::Archive)
        .await
        .unwrap();
    let restored = skills::owner_set(pool, &owner, homework.id, OwnerChange::Restore)
        .await
        .unwrap();
    assert_eq!(restored.tool, "skill.restore");
    assert_eq!(restored.summary, "Вернул из архива навык «ДЗ к уроку»");
    let homework = skill(pool, me, "ДЗ к уроку").await;
    let info = skills::Skill::from(&homework);
    assert!(info.archive_after.unwrap() > now + Duration::days(29));
    assert!(matches!(
        skills::owner_set(pool, &owner, homework.id, OwnerChange::Restore).await,
        Err(Error::Invalid(_))
    ));

    // Без гранта агента куратор ничего не делает.
    sqlx::query("DELETE FROM module_grants WHERE account_id = $1 AND module_id = 'agent'")
        .bind(me)
        .execute(pool)
        .await
        .unwrap();
    assert!(
        skills::curate(pool, me, later + Duration::days(60))
            .await
            .unwrap()
            .is_empty()
    );

    // Раз в неделю: на одной неделе — одна задача в очереди.
    skills::schedule_curator(pool, now).await.unwrap();
    skills::schedule_curator(pool, now).await.unwrap();
    skills::schedule_curator(pool, now + skills::CURATE_EVERY)
        .await
        .unwrap();
    let jobs: i64 = sqlx::query_scalar("SELECT count(*) FROM jobs WHERE kind = 'agent.curate'")
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(jobs, 2);

    db.close().await;
    test_db.drop_db().await;
}

// ---------------------------------------------------------------- с моделью

fn reply(value: Value) -> MockStep {
    MockStep::Reply {
        text: value.to_string(),
        tokens_in: 100,
        tokens_out: 50,
    }
}

/// Owner с поддельной моделью для задач агента.
async fn owner_with_ai(pool: &PgPool, steps: Vec<MockStep>) -> (Uuid, Gateway, Arc<MockProvider>) {
    let me = qubite_auth::owner::create(
        pool,
        &Passwords::default(),
        "owner@qubite.ru",
        "",
        "пароль владельца",
    )
    .await
    .unwrap()
    .id;
    let console = qubite_policy::decide_owner(pool, &qubite_policy::Subject::account(me, None))
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
        &LimitScope::User(me),
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
    let gateway =
        Gateway::new(pool.clone(), AiConfig::default()).with_provider("mock", mock.clone());
    (me, gateway, mock)
}

async fn say(pool: &PgPool, account: Uuid, text: &str) -> chat::Message {
    chat::post(
        pool,
        NewMessage {
            account,
            channel: Channel::Web,
            text: text.into(),
            file_id: None,
            telegram: None,
        },
    )
    .await
    .unwrap()
}

const OLD_STEP: &str = "4. Сделать — в свободное время накануне урока, не в день урока.";
const NEW_STEP: &str = "4. Сделать — вечером накануне урока, не в день урока.";

#[tokio::test]
async fn correction_refines_skill_and_next_time_agent_does_it_the_new_way() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let (me, gateway, mock) = owner_with_ai(
        pool,
        vec![
            // Разговор 1: ДЗ по навыку «ДЗ к уроку» — срок утром дня урока.
            reply(json!({
                "say": "Записал ДЗ на 22.10, 08:00.",
                "tools": [{"tool": "task.create", "skill": "ДЗ к уроку", "why": "навык «ДЗ к уроку»",
                           "args": {"title": "Русский: упр. 145", "fields": {"due_date": "2026-10-22", "due_time": "08:00"}}}],
            })),
            // Урок на поправке: открыть навык, уточнить одну строку.
            reply(json!({"tools": [{"tool": "skill.view", "args": {"name": "ДЗ к уроку"}}]})),
            reply(json!({"tools": [{"tool": "skill.patch", "why": "ты поправил срок ДЗ: «вечером накануне», 20.10",
                                     "args": {"name": "ДЗ к уроку", "old": OLD_STEP, "new": NEW_STEP}}]})),
            // Разговор 2: агент открывает навык — и делает по-новому.
            reply(json!({"tools": [{"tool": "skill.view", "args": {"name": "ДЗ к уроку"}}]})),
            reply(json!({
                "say": "Записал ДЗ на 23.10, сделать 22.10 вечером.",
                "tools": [{"tool": "task.create", "skill": "ДЗ к уроку", "why": "навык «ДЗ к уроку»: вечером накануне",
                           "args": {"title": "Русский: упр. 150", "fields": {"due_date": "2026-10-22", "due_time": "19:00"}}}],
            })),
        ],
    )
    .await;

    let first = say(pool, me, "ДЗ по русскому упр. 145").await;
    brain::chat_turn(pool, &gateway, first.id, None)
        .await
        .unwrap()
        .unwrap();
    // Модель видела список навыков с описаниями, но не навыки целиком.
    let data = &mock.last_call().unwrap().messages[1].content;
    assert!(data.contains("source=\"skills\"") && data.contains("ДЗ к уроку — Как ставить"));
    assert!(!data.contains(OLD_STEP));
    let homework = {
        let mut conn = pool.acquire().await.unwrap();
        skills::find(&mut conn, me, "ДЗ к уроку")
            .await
            .unwrap()
            .unwrap()
    };
    let page = timeline::list(pool, me, Feed::All, None, 10).await.unwrap();
    let created = &page.items[0];
    assert_eq!(created.tool, "task.create");
    assert_eq!(created.skill_id, Some(homework.id), "по навыку");
    let task = created.changes[0].object_id;

    // Владелец «Исправить»: не утром, а вечером накануне. Это поправка — урок агенту.
    let mut fields = Map::new();
    fields.insert("due_date".into(), json!("2026-10-21"));
    fields.insert("due_time".into(), json!("19:00"));
    let correction = fix(pool, &Who::owner(me, None), created.id, task, None, fields)
        .await
        .unwrap();
    let learn: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM jobs WHERE kind = 'agent.learn' AND payload->>'action_id' = $1",
    )
    .bind(correction.id.to_string())
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(learn, 1, "урок ставится той же транзакцией");
    assert_eq!(
        brain::learn(pool, &gateway, me, correction.id, None)
            .await
            .unwrap(),
        1
    );
    let call = mock.last_call().unwrap();
    assert!(
        call.messages[0]
            .content
            .contains("исправил то, что ты сделал")
    );
    let data = &call.messages[1].content;
    assert!(data.contains("source=\"correction\""));
    assert!(data.contains("По навыку: ДЗ к уроку"));
    assert!(data.contains("Владелец исправил"));
    assert!(data.contains("due_time: \"08:00\" → \"19:00\""), "{data}");

    // Навык уточнился одной строкой; в ленте видно, почему, и откатывается.
    let refined = {
        let mut conn = pool.acquire().await.unwrap();
        skills::find(&mut conn, me, "ДЗ к уроку")
            .await
            .unwrap()
            .unwrap()
    };
    assert!(refined.body.contains(NEW_STEP) && !refined.body.contains(OLD_STEP));
    assert!(refined.body.contains("version: 2"));
    let page = timeline::list(pool, me, Feed::Object(refined.id), None, 10)
        .await
        .unwrap();
    let patch = &page.items[0];
    assert_eq!(
        patch.summary,
        "Навык «ДЗ к уроку»: «в свободное время» → «вечером»"
    );
    assert_eq!(
        patch.reason.as_deref(),
        Some("ты поправил срок ДЗ: «вечером накануне», 20.10")
    );
    let owner = Who::owner(me, None);
    revert_action(pool, &owner, patch.id, false).await.unwrap();
    let mut conn = pool.acquire().await.unwrap();
    assert!(
        skills::find(&mut conn, me, "ДЗ к уроку")
            .await
            .unwrap()
            .unwrap()
            .body
            .contains(OLD_STEP)
    );
    drop(conn);
    let page = timeline::list(pool, me, Feed::Object(refined.id), None, 10)
        .await
        .unwrap();
    // Откатить откат — уточнение снова в силе.
    revert_action(pool, &owner, page.items[0].id, false)
        .await
        .unwrap();

    // В следующий раз агент открывает навык и видит новую строку.
    let second = say(pool, me, "ДЗ по русскому упр. 150 к пятнице").await;
    let answer = brain::chat_turn(pool, &gateway, second.id, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(answer.text, "Записал ДЗ на 23.10, сделать 22.10 вечером.");
    let data = &mock.last_call().unwrap().messages[1].content;
    assert!(data.contains(NEW_STEP), "skill.view — новая строка");
    let page = timeline::list(pool, me, Feed::All, None, 1).await.unwrap();
    assert_eq!(page.items[0].skill_id, Some(refined.id));
    let mut conn = pool.acquire().await.unwrap();
    let used = skills::find(&mut conn, me, "ДЗ к уроку")
        .await
        .unwrap()
        .unwrap();
    assert!(used.uses >= 4, "открыл и действовал по нему: {}", used.uses);
    drop(conn);

    db.close().await;
    test_db.drop_db().await;
}

#[tokio::test]
async fn review_sees_multistep_success_and_three_repeats() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let (me, gateway, mock) = owner_with_ai(
        pool,
        vec![
            reply(json!({
                "say": "Готово: проект и три дела.",
                "tools": [
                    {"tool": "project.create", "args": {"title": "Олимпиада по физике", "fields": {}}},
                    {"tool": "task.create", "args": {"title": "Зарегистрироваться", "fields": {}}},
                    {"tool": "task.create", "args": {"title": "Решить прошлый год", "fields": {}}},
                    {"tool": "task.create", "args": {"title": "Повторить механику", "fields": {}}},
                ],
            })),
            reply(json!({
                "tools": [{"tool": "skill.create", "why": "удачное многошаговое дело: подготовка к олимпиаде",
                           "args": {"name": "Подготовка к олимпиаде", "description": "Проект и первые шаги к олимпиаде",
                                    "body": "## Когда\nОлимпиада.\n\n## Как\n1. Проект.\n2. Регистрация.\n",
                                    "tools": ["project.create", "task.create"]}}],
            })),
        ],
    )
    .await;
    let message = say(pool, me, "Готовлюсь к олимпиаде по физике").await;
    let answer = brain::chat_turn(pool, &gateway, message.id, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(answer.actions, 4);
    assert_eq!(
        brain::review(pool, &gateway, me, answer.seq, None)
            .await
            .unwrap(),
        1
    );
    let call = mock.last_call().unwrap();
    let data = &call.messages[1].content;
    assert!(data.contains("source=\"multistep\""), "{data}");
    assert!(
        data.contains("Создал проект «Олимпиада по физике» → Создал дело «Зарегистрироваться»")
    );
    assert!(
        data.contains("source=\"repeats\"") && data.contains("3 раза"),
        "три «Создал дело» подряд: {data}"
    );
    assert!(call.messages[0].content.contains("Блок multistep"));
    let mut conn = pool.acquire().await.unwrap();
    assert!(
        skills::find(&mut conn, me, "Подготовка к олимпиаде")
            .await
            .unwrap()
            .is_some()
    );
    drop(conn);

    db.close().await;
    test_db.drop_db().await;
}
