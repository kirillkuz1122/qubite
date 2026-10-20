//! Сводка от AI на Главной (HOME-001) на настоящей PostgreSQL: агент пишет
//! её инструментом `home.digest.write`, каждый пункт ведёт к своему объекту,
//! сводка — строка ленты и откатывается; без гранта агента сводки нет.

use qubite_agent::{Error, Trigger, Who, call, digest, revert_action, start_run, timeline};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_sync::{OpKind, Operation, PushRequest};
use qubite_sync_server::Rules;
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use sqlx::PgPool;
use uuid::Uuid;

async fn person(pool: &PgPool, email: &str, modules: &[&str]) -> Uuid {
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
    for module in modules {
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

async fn create(pool: &PgPool, owner: Uuid, object_type: &str, title: &str) -> Uuid {
    let id = Uuid::now_v7();
    let rules = Rules {
        registry: timeline::registry(),
        strict: true,
        writable: None,
        readable: None,
    };
    let request = PushRequest {
        device_id: Uuid::now_v7(),
        ops: vec![Operation {
            op_id: Uuid::now_v7(),
            object_id: id,
            base_revision: None,
            kind: OpKind::Create {
                object_type: object_type.into(),
                title: title.into(),
                fields: None,
            },
        }],
    };
    qubite_sync_server::push_with(pool, owner, &request, &rules)
        .await
        .unwrap();
    id
}

async fn write(pool: &PgPool, owner: Uuid, args: Value) -> Result<qubite_agent::Action, Error> {
    let run = start_run(pool, owner, Trigger::Morning).await?;
    let agent = Who::agent(&run);
    Ok(call(
        pool,
        &agent,
        digest::TOOL,
        args,
        Some("утро: что важно сегодня"),
        None,
    )
    .await?
    .action()
    .expect("сводка — строка ленты"))
}

#[tokio::test]
async fn agent_writes_digest_with_links_and_revert_hides_it() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "home@example.com", &["planner", "inbox", "agent"]).await;
    let task = create(pool, me, "planner.task", "Упр. 145 по русскому").await;
    let thought = create(pool, me, "inbox.item", "купить тетради").await;
    let owner = Who::owner(me, None);

    assert!(digest::today(pool, &owner).await.unwrap().is_none());

    let action = write(
        pool,
        me,
        json!({"items": [
            {"kind": "important", "text": "Сегодня  сдать упр. 145", "task_id": task},
            {"kind": "question", "text": "Тетради — купить по дороге?", "inbox_id": thought},
            {"kind": "news", "text": "Вышла новая открытая модель", "url": "https://habr.com/ru/articles/1/"},
        ]}),
    )
    .await
    .unwrap();
    assert_eq!(action.tool, "home.digest.write");
    assert_eq!(action.summary, "Написал сводку на Главную: 3 пункта");
    assert_eq!(action.reason.as_deref(), Some("утро: что важно сегодня"));
    assert!(action.changes.is_empty(), "данные сводка не меняет");

    let shown = digest::today(pool, &owner)
        .await
        .unwrap()
        .expect("сводка есть");
    assert_eq!(shown.action_id, action.id);
    assert_eq!(shown.items.len(), 3);
    assert_eq!(shown.items[0].text, "Сегодня сдать упр. 145");
    assert_eq!(
        shown.items[0].link,
        digest::Link::Task {
            id: task,
            title: "Упр. 145 по русскому".into()
        }
    );
    assert!(
        matches!(&shown.items[1].link, digest::Link::Inbox { id, title } if *id == thought && title == "купить тетради")
    );
    assert!(
        matches!(&shown.items[2].link, digest::Link::Url { url } if url == "https://habr.com/ru/articles/1/")
    );

    // Пункт может вести к записи ленты.
    let second = write(
        pool,
        me,
        json!({"items": [{"kind": "noticed", "text": "Утром написал сводку", "action_id": action.id}]}),
    )
    .await
    .unwrap();
    let shown = digest::today(pool, &owner).await.unwrap().unwrap();
    assert_eq!(shown.action_id, second.id, "новая сводка заменяет прежнюю");
    assert!(matches!(&shown.items[0].link, digest::Link::Action { id, .. } if *id == action.id));

    // Откатил новую — снова видна прежняя; откатил откат — снова новая.
    let reverted = match revert_action(pool, &owner, second.id, false).await.unwrap() {
        qubite_agent::RevertOutcome::Reverted { actions } => actions,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        digest::today(pool, &owner)
            .await
            .unwrap()
            .unwrap()
            .action_id,
        action.id
    );
    revert_action(pool, &owner, reverted[0].id, false)
        .await
        .unwrap();
    assert_eq!(
        digest::today(pool, &owner)
            .await
            .unwrap()
            .unwrap()
            .action_id,
        second.id
    );

    test_db.drop_db().await;
}

#[tokio::test]
async fn digest_items_are_checked() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "check@example.com", &["planner", "inbox", "agent"]).await;
    let other = person(pool, "other@example.com", &["planner", "inbox", "agent"]).await;
    let mine = create(pool, me, "planner.task", "Моё дело").await;
    let theirs = create(pool, other, "planner.task", "Чужое дело").await;

    let invalid = |args: Value| async move {
        match write(pool, me, args).await {
            Err(Error::Invalid(message)) => message,
            other => panic!("ждали отказ, а вышло {other:?}"),
        }
    };
    invalid(json!({"items": []})).await;
    let many: Vec<Value> = (0..8)
        .map(|_| json!({"kind": "tip", "text": "x", "task_id": mine}))
        .collect();
    invalid(json!({ "items": many })).await;
    // Без ссылки и с двумя ссылками.
    invalid(json!({"items": [{"kind": "tip", "text": "просто так"}]})).await;
    invalid(
        json!({"items": [{"kind": "tip", "text": "x", "task_id": mine, "url": "https://a.b/"}]}),
    )
    .await;
    // Ссылка на статью — только у новости и только https.
    invalid(json!({"items": [{"kind": "tip", "text": "x", "url": "https://a.b/"}]})).await;
    invalid(json!({"items": [{"kind": "news", "text": "x", "url": "javascript:alert(1)"}]})).await;
    invalid(json!({"items": [{"kind": "news", "text": "x", "task_id": mine}]})).await;
    invalid(json!({"items": [{"kind": "tip", "text": "  ", "task_id": mine}]})).await;
    invalid(json!({"items": [{"kind": "tip", "text": "x".repeat(301), "task_id": mine}]})).await;
    invalid(json!({"items": [{"kind": "tip", "text": "x", "task_id": mine, "extra": 1}]})).await;

    // Чужое дело и несуществующая запись ленты — «не найдено».
    for args in [
        json!({"items": [{"kind": "tip", "text": "x", "task_id": theirs}]}),
        json!({"items": [{"kind": "tip", "text": "x", "action_id": Uuid::now_v7()}]}),
    ] {
        assert!(matches!(write(pool, me, args).await, Err(Error::NotFound)));
    }
    assert!(
        digest::today(pool, &Who::owner(me, None))
            .await
            .unwrap()
            .is_none(),
        "отказ ничего не записал"
    );

    // Сам человек сводку не пишет — это работа агента.
    let owner = Who::owner(me, None);
    assert!(matches!(
        call(
            pool,
            &owner,
            digest::TOOL,
            json!({"items": [{"kind": "tip", "text": "x", "task_id": mine}]}),
            None,
            None
        )
        .await,
        Err(Error::Invalid(_))
    ));

    test_db.drop_db().await;
}

#[tokio::test]
async fn without_agent_grant_there_is_no_digest() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "plain@example.com", &["planner", "inbox"]).await;
    let task = create(pool, me, "planner.task", "Дело").await;
    assert!(matches!(
        digest::today(pool, &Who::owner(me, None)).await,
        Err(Error::Denied(_))
    ));
    assert!(matches!(
        start_run(pool, me, Trigger::Morning).await,
        Err(Error::Denied(_))
    ));
    let _ = task;
    test_db.drop_db().await;
}

#[tokio::test]
async fn recent_filed_shows_what_agent_sorted() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "filed@example.com", &["planner", "inbox", "agent"]).await;
    let thought = create(pool, me, "inbox.item", "упр. 145 по русскому").await;
    let run = start_run(pool, me, Trigger::Inbox).await.unwrap();
    let agent = Who::agent(&run);
    let filed = call(
        pool,
        &agent,
        "inbox.file",
        json!({"item_id": thought, "to": "task", "title": "Упр. 145"}),
        Some("похоже на домашнее задание"),
        None,
    )
    .await
    .unwrap()
    .action()
    .unwrap();
    call(
        pool,
        &agent,
        "task.create",
        json!({"title": "Не из Входящих"}),
        None,
        None,
    )
    .await
    .unwrap();
    let owner = Who::owner(me, None);
    let list = digest::recent_filed(pool, &owner, 5).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].id, filed.id);

    revert_action(pool, &owner, filed.id, false).await.unwrap();
    assert!(
        digest::recent_filed(pool, &owner, 5)
            .await
            .unwrap()
            .is_empty()
    );
    test_db.drop_db().await;
}
