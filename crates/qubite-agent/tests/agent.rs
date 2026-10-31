//! Таймлайн агента на настоящей PostgreSQL (AGT-002): каждое действие
//! инструмента в ленте, откат возвращает объект и связи, откат отката,
//! пакет, конфликт с более поздней правкой, «исправить», права.

use qubite_agent::{
    Error, Feed, RevertOutcome, Trigger, Who, call, fix, revert_action, revert_batch, start_run,
    timeline,
};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_sync::{OpKind, OpResult, Operation, PushRequest};
use qubite_sync_server::Rules;
use qubite_testkit::TestDb;
use serde_json::{Map, Value, json};
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

async fn revoke(pool: &PgPool, account: Uuid, module: &str) {
    sqlx::query(
        "UPDATE module_grants SET revoked_at = now() \
         WHERE account_id = $1 AND module_id = $2 AND revoked_at IS NULL",
    )
    .bind(account)
    .bind(module)
    .execute(pool)
    .await
    .unwrap();
}

/// Человек с Planner, Входящими и агентом.
async fn person(pool: &PgPool, email: &str) -> Uuid {
    let id = account(pool, email).await;
    for module in ["planner", "inbox", "agent"] {
        grant(pool, id, module).await;
    }
    id
}

/// Правка с устройства человека (как экран Planner).
async fn device(pool: &PgPool, owner: Uuid, object_id: Uuid, kind: OpKind) -> OpResult {
    let revision: Option<i64> = sqlx::query_scalar("SELECT revision FROM objects WHERE id = $1")
        .bind(object_id)
        .fetch_optional(pool)
        .await
        .unwrap();
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
            object_id,
            base_revision: revision,
            kind,
        }],
    };
    qubite_sync_server::push_with(pool, owner, &request, &rules)
        .await
        .unwrap()
        .results
        .remove(0)
}

async fn thought(pool: &PgPool, owner: Uuid, text: &str) -> Uuid {
    let id = Uuid::now_v7();
    let result = device(
        pool,
        owner,
        id,
        OpKind::Create {
            object_type: "inbox.item".into(),
            title: text.into(),
            fields: None,
        },
    )
    .await;
    assert!(matches!(result, OpResult::Applied { .. }), "{result:?}");
    id
}

async fn task(pool: &PgPool, owner: Uuid, id: Uuid) -> qubite_planner::Task {
    let mut conn = pool.acquire().await.unwrap();
    qubite_planner::get_task(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap()
}

async fn inbox_status(pool: &PgPool, id: Uuid) -> String {
    sqlx::query_scalar("SELECT status FROM inbox_items WHERE object_id = $1")
        .bind(id)
        .fetch_one(pool)
        .await
        .unwrap()
}

fn created_id(action: &qubite_agent::Action, object_type: &str) -> Uuid {
    action
        .changes
        .iter()
        .find(|change| change.created && change.object_type == object_type)
        .unwrap_or_else(|| panic!("нет созданного {object_type}: {action:?}"))
        .object_id
}

async fn done(
    pool: &PgPool,
    who: &Who,
    tool: &str,
    args: Value,
    reason: Option<&str>,
) -> qubite_agent::Action {
    call(pool, who, tool, args, reason, None)
        .await
        .unwrap_or_else(|error| panic!("{tool}: {error}"))
        .action()
        .expect("меняющий инструмент пишет в ленту")
}

fn reverted(outcome: RevertOutcome) -> Vec<qubite_agent::Action> {
    match outcome {
        RevertOutcome::Reverted { actions } => actions,
        RevertOutcome::Conflict { conflicts } => panic!("неожиданный конфликт: {conflicts:?}"),
    }
}

#[tokio::test]
async fn every_tool_writes_to_the_timeline_and_reverts() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "agent@example.com").await;
    let run = start_run(pool, me, Trigger::Manual).await.unwrap();
    let agent = Who::agent(&run);

    // Проект и дело в нём.
    let made = done(
        pool,
        &agent,
        "project.create",
        json!({"title": "Русский", "fields": {"color": "sky"}}),
        Some("встретился #русский"),
    )
    .await;
    let russian = created_id(&made, "planner.project");
    assert_eq!(made.summary, "Создал проект «Русский»");
    let made = done(
        pool,
        &agent,
        "task.create",
        json!({"title": "Упр. 145", "fields": {"project_id": russian, "due_date": "2026-10-22"}}),
        Some("в памяти «Русский» урок по чт"),
    )
    .await;
    let homework = created_id(&made, "planner.task");
    assert!(
        made.summary
            .starts_with("Создал дело «Упр. 145»: в «Русский», срок 22.10")
    );
    assert!(made.summary.contains("question.ask"));
    assert_eq!(
        made.reason.as_deref(),
        Some("в памяти «Русский» урок по чт")
    );

    // Перенос без причины — нельзя; с причиной — в ленте «было → стало».
    let error = call(
        pool,
        &agent,
        "task.reschedule",
        json!({"task_id": homework, "due_date": "2026-10-23"}),
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::Invalid(_)), "{error}");
    let moved = done(
        pool,
        &agent,
        "task.reschedule",
        json!({"task_id": homework, "due_date": "2026-10-23", "due_time": "18:00"}),
        Some("в среду урок перенесли"),
    )
    .await;
    assert_eq!(moved.summary, "Перенёс «Упр. 145» на 23.10 18:00");
    let diff = &moved.changes[0].diff;
    assert!(diff.iter().any(|field| field.field == "due_date"
        && field.before == json!("2026-10-22")
        && field.after == json!("2026-10-23")));

    // Новое название и важность, потом — в другой проект.
    let other = created_id(
        &done(
            pool,
            &agent,
            "project.create",
            json!({"title": "Школа"}),
            None,
        )
        .await,
        "planner.project",
    );
    done(
        pool,
        &agent,
        "task.update",
        json!({"task_id": homework, "title": "Упр. 145 (тетрадь)", "fields": {"priority": "important"}}),
        None,
    )
    .await;
    let relinked = done(
        pool,
        &agent,
        "task.update",
        json!({"task_id": homework, "fields": {"project_id": other}}),
        None,
    )
    .await;
    assert_eq!(task(pool, me, homework).await.project_id, Some(other));
    done(
        pool,
        &agent,
        "project.update",
        json!({"project_id": other, "title": "Школа 9Б"}),
        None,
    )
    .await;

    // Мысль из Входящих — в дело; мысль уходит в архив.
    let item = thought(pool, me, "купить тетрадь в клетку").await;
    let filed = done(
        pool,
        &agent,
        "inbox.file",
        json!({"item_id": item, "to": "task", "fields": {"project_id": russian}}),
        Some("тетрадь для русского"),
    )
    .await;
    let notebook = created_id(&filed, "planner.task");
    assert_eq!(filed.changes.len(), 2, "дело и мысль — одно действие");
    assert_eq!(inbox_status(pool, item).await, "archived");
    let derived: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM relations WHERE from_id = $1 AND to_id = $2 \
         AND type = 'derived_from' AND deleted_at IS NULL",
    )
    .bind(notebook)
    .bind(item)
    .fetch_one(pool)
    .await
    .unwrap();
    assert_eq!(derived, 1);

    let trashed = done(
        pool,
        &agent,
        "task.trash",
        json!({"task_id": notebook}),
        None,
    )
    .await;
    assert!(task(pool, me, notebook).await.deleted);

    // Читающие инструменты в ленту не пишут.
    let before = timeline::list(pool, me, Feed::All, None, 100)
        .await
        .unwrap()
        .items
        .len();
    let found = call(
        pool,
        &agent,
        "task.search",
        json!({"query": "упр"}),
        None,
        None,
    )
    .await
    .unwrap();
    assert!(found.action().is_none());
    let after = timeline::list(pool, me, Feed::All, None, 100)
        .await
        .unwrap()
        .items
        .len();
    assert_eq!(before, after);
    assert_eq!(after, 9, "каждое меняющее действие — строка ленты");

    // Лента у дела и у проекта.
    let at_task = timeline::list(pool, me, Feed::Object(homework), None, 100)
        .await
        .unwrap();
    assert_eq!(at_task.items.len(), 4);
    let at_russian = timeline::list(pool, me, Feed::Project(russian), None, 100)
        .await
        .unwrap();
    // проект, дело в нём, перенос, название, переезд из него, мысль → дело в нём, корзина
    assert_eq!(
        at_russian.items.len(),
        7,
        "{:#?}",
        at_russian
            .items
            .iter()
            .map(|a| &a.summary)
            .collect::<Vec<_>>()
    );

    // Страницы: новые сверху, курсор «ещё».
    let first = timeline::list(pool, me, Feed::All, None, 4).await.unwrap();
    assert_eq!(first.items.len(), 4);
    let rest = timeline::list(pool, me, Feed::All, first.next, 100)
        .await
        .unwrap();
    assert_eq!(rest.items.len(), 5);
    assert!(rest.next.is_none());
    assert!(first.items[0].seq > rest.items[0].seq);

    // Откат корзины возвращает дело.
    let me_owner = Who::owner(me, None);
    reverted(
        revert_action(pool, &me_owner, trashed.id, false)
            .await
            .unwrap(),
    );
    assert!(!task(pool, me, notebook).await.deleted);

    // Откат «разложил мысль»: дело — в корзину, мысль — снова новая.
    let undo = reverted(
        revert_action(pool, &me_owner, filed.id, false)
            .await
            .unwrap(),
    );
    assert!(task(pool, me, notebook).await.deleted);
    assert_eq!(inbox_status(pool, item).await, "new");
    assert_eq!(undo[0].reverts, Some(filed.id));
    assert!(undo[0].summary.starts_with("Откатил: Разложил мысль"));

    // Откат смены проекта возвращает связь `part_of`.
    reverted(
        revert_action(pool, &me_owner, relinked.id, false)
            .await
            .unwrap(),
    );
    assert_eq!(task(pool, me, homework).await.project_id, Some(russian));

    // Уже откаченное второй раз не откатывается.
    let again = revert_action(pool, &me_owner, filed.id, false)
        .await
        .unwrap_err();
    assert!(matches!(again, Error::NotRevertible(_)), "{again}");

    // Откат отката: мысль снова разложена.
    reverted(
        revert_action(pool, &me_owner, undo[0].id, false)
            .await
            .unwrap(),
    );
    assert!(!task(pool, me, notebook).await.deleted);
    assert_eq!(inbox_status(pool, item).await, "archived");
    let state = timeline::get(pool, me, filed.id)
        .await
        .unwrap()
        .unwrap()
        .state;
    assert!(
        state.reverted_by.is_none(),
        "откат откачен — действие снова в силе"
    );
    let state = timeline::get(pool, me, undo[0].id)
        .await
        .unwrap()
        .unwrap()
        .state;
    assert!(state.reverted_by.is_some());

    test_db.drop_db().await;
}

#[tokio::test]
async fn later_edit_is_a_conflict_not_an_overwrite() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "conflict@example.com").await;
    let run = start_run(pool, me, Trigger::Manual).await.unwrap();
    let agent = Who::agent(&run);
    let owner = Who::owner(me, None);

    let made = done(
        pool,
        &agent,
        "task.create",
        json!({"title": "Музей", "fields": {"due_date": "2026-10-24", "notes": ""}}),
        None,
    )
    .await;
    let museum = created_id(&made, "planner.task");
    let moved = done(
        pool,
        &agent,
        "task.reschedule",
        json!({"task_id": museum, "due_date": "2026-10-25"}),
        Some("в субботу дождь"),
    )
    .await;

    // Ты поменял заметку — это не мешает откату переноса.
    let result = device(
        pool,
        me,
        museum,
        OpKind::Patch {
            fields: json!({"notes": "взять билеты"}),
        },
    )
    .await;
    assert!(matches!(result, OpResult::Applied { .. }));
    // А потом сам передвинул срок ещё раз.
    let result = device(
        pool,
        me,
        museum,
        OpKind::Patch {
            fields: json!({"due_date": "2026-10-26"}),
        },
    )
    .await;
    assert!(matches!(result, OpResult::Applied { .. }));

    let outcome = revert_action(pool, &owner, moved.id, false).await.unwrap();
    let RevertOutcome::Conflict { conflicts } = outcome else {
        panic!("ожидали конфликт: {outcome:?}");
    };
    assert_eq!(conflicts.len(), 1);
    let conflict = &conflicts[0];
    assert_eq!(conflict.field, "due_date");
    assert_eq!(conflict.before, json!("2026-10-24"));
    assert_eq!(conflict.action, json!("2026-10-25"));
    assert_eq!(conflict.now, json!("2026-10-26"));
    // Ничего не изменено и в ленту не записано.
    let current = task(pool, me, museum).await;
    assert_eq!(
        qubite_planner::format_date(current.due_date.unwrap()),
        "2026-10-26"
    );
    assert_eq!(current.notes, "взять билеты");
    assert!(
        timeline::get(pool, me, moved.id)
            .await
            .unwrap()
            .unwrap()
            .state
            .reverted_by
            .is_none()
    );

    // «Вернуть как было» — срок возвращается, заметка остаётся.
    reverted(revert_action(pool, &owner, moved.id, true).await.unwrap());
    let current = task(pool, me, museum).await;
    assert_eq!(
        qubite_planner::format_date(current.due_date.unwrap()),
        "2026-10-24"
    );
    assert_eq!(current.notes, "взять билеты");

    // Созданное агентом и потом поправленное — тоже конфликт при откате.
    let outcome = revert_action(pool, &owner, made.id, false).await.unwrap();
    let RevertOutcome::Conflict { conflicts } = outcome else {
        panic!("ожидали конфликт: {outcome:?}");
    };
    assert!(
        conflicts
            .iter()
            .any(|c| c.field == "notes" && c.before == Value::Null)
    );
    assert!(!task(pool, me, museum).await.deleted);

    test_db.drop_db().await;
}

#[tokio::test]
async fn batch_reverts_together_and_fix_is_a_correction() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "batch@example.com").await;
    let run = start_run(pool, me, Trigger::Inbox).await.unwrap();
    let agent = Who::agent(&run);
    let owner = Who::owner(me, None);

    // Одно решение — три шага: проект, дело в нём, перенос.
    let batch = Uuid::now_v7();
    let step = async |tool: &str, args: Value| {
        call(pool, &agent, tool, args, Some("одно решение"), Some(batch))
            .await
            .unwrap()
            .action()
            .unwrap()
    };
    let physics = created_id(
        &step("project.create", json!({"title": "Физика"})).await,
        "planner.project",
    );
    let lab = step(
        "task.create",
        json!({"title": "Лабораторная", "fields": {"project_id": physics, "due_date": "2026-10-21"}}),
    )
    .await;
    let lab_id = created_id(&lab, "planner.task");
    step(
        "task.reschedule",
        json!({"task_id": lab_id, "due_date": "2026-10-28"}),
    )
    .await;
    let page = timeline::list(pool, me, Feed::Batch(batch), None, 10)
        .await
        .unwrap();
    assert_eq!(page.items.len(), 3);
    assert!(page.items.iter().all(|action| action.state.batch_size == 3));

    // Ты исправил результат: «не 21-го, а 22-го». Это поправка к действию агента.
    let mut fields = Map::new();
    fields.insert("due_date".into(), json!("2026-10-29"));
    let correction = fix(pool, &owner, lab.id, lab_id, None, fields)
        .await
        .unwrap();
    assert_eq!(correction.corrects, Some(lab.id));
    assert_eq!(correction.actor, qubite_agent::Actor::Owner);
    let state = timeline::get(pool, me, lab.id)
        .await
        .unwrap()
        .unwrap()
        .state;
    assert_eq!(state.corrected_by, vec![correction.id]);
    // Исправлять за человека агент не может.
    let error = fix(pool, &agent, lab.id, lab_id, Some("x".into()), Map::new())
        .await
        .unwrap_err();
    assert!(matches!(error, Error::NeedsOwner(_)));

    // Пакет — одной кнопкой; поправка после агента — конфликт на весь пакет.
    let outcome = revert_batch(pool, &owner, batch, false).await.unwrap();
    assert!(
        matches!(outcome, RevertOutcome::Conflict { .. }),
        "{outcome:?}"
    );
    assert!(
        !task(pool, me, lab_id).await.deleted,
        "при конфликте ничего не менялось"
    );
    let undone = reverted(revert_batch(pool, &owner, batch, true).await.unwrap());
    assert_eq!(undone.len(), 3);
    assert!(
        undone
            .iter()
            .all(|action| action.batch_id == undone[0].batch_id)
    );
    assert!(task(pool, me, lab_id).await.deleted);
    let mut conn = pool.acquire().await.unwrap();
    let project = qubite_planner::get_project(&mut conn, me, physics)
        .await
        .unwrap()
        .unwrap();
    assert!(project.deleted);
    // Откат пакета — тоже пакет: вернуть всё одной кнопкой.
    reverted(
        revert_batch(pool, &owner, undone[0].batch_id, false)
            .await
            .unwrap(),
    );
    assert!(!task(pool, me, lab_id).await.deleted);

    test_db.drop_db().await;
}

#[tokio::test]
async fn without_agent_grant_tools_refuse() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = account(pool, "plain@example.com").await;
    grant(pool, me, "planner").await;
    grant(pool, me, "inbox").await;

    // Нет гранта `agent` — агента нет.
    let error = start_run(pool, me, Trigger::Manual).await.unwrap_err();
    assert!(matches!(error, Error::Denied(_)), "{error}");
    let error = timeline::authorize_read(pool, &Who::owner(me, None))
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Denied(_)));

    // С грантом — работает; отозвали — следующий же вызов отказывает.
    grant(pool, me, "agent").await;
    let run = start_run(pool, me, Trigger::Manual).await.unwrap();
    let agent = Who::agent(&run);
    let made = done(pool, &agent, "task.create", json!({"title": "Дело"}), None).await;
    revoke(pool, me, "agent").await;
    let error = call(
        pool,
        &agent,
        "task.create",
        json!({"title": "Ещё"}),
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::Denied(_)), "{error}");
    let error = call(pool, &agent, "task.search", json!({}), None, None)
        .await
        .unwrap_err();
    assert!(matches!(error, Error::Denied(_)), "{error}");

    // Агент не шире человека: без Planner дел не трогает.
    grant(pool, me, "agent").await;
    revoke(pool, me, "planner").await;
    let task_id = created_id(&made, "planner.task");
    let error = call(
        pool,
        &agent,
        "task.trash",
        json!({"task_id": task_id}),
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::Denied(_)), "{error}");

    // Чужое для агента не существует.
    grant(pool, me, "planner").await;
    let stranger = person(pool, "stranger@example.com").await;
    let stranger_run = start_run(pool, stranger, Trigger::Manual).await.unwrap();
    let error = call(
        pool,
        &Who::agent(&stranger_run),
        "task.update",
        json!({"task_id": task_id, "title": "моё"}),
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::NotFound), "{error}");
    let error = revert_action(pool, &Who::owner(stranger, None), made.id, false)
        .await
        .unwrap_err();
    assert!(matches!(error, Error::NotFound), "{error}");

    test_db.drop_db().await;
}

#[tokio::test]
async fn agent_never_marks_done_and_timeline_is_append_only() {
    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "done@example.com").await;
    let run = start_run(pool, me, Trigger::Manual).await.unwrap();
    let agent = Who::agent(&run);

    let error = call(
        pool,
        &agent,
        "task.create",
        json!({"title": "Сделано?", "fields": {"status": "done"}}),
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::NeedsOwner(_)), "{error}");
    let made = done(pool, &agent, "task.create", json!({"title": "Дело"}), None).await;
    let task_id = created_id(&made, "planner.task");
    let error = call(
        pool,
        &agent,
        "task.update",
        json!({"task_id": task_id, "fields": {"status": "done"}}),
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::NeedsOwner(_)));
    // Неверные поля — ошибка, и в ленте ничего лишнего.
    let error = call(
        pool,
        &agent,
        "task.update",
        json!({"task_id": task_id, "fields": {"due_time": "18:00"}}),
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::Invalid(_)), "{error}");
    assert_eq!(
        timeline::list(pool, me, Feed::All, None, 10)
            .await
            .unwrap()
            .items
            .len(),
        1
    );

    for sql in [
        "UPDATE agent_actions SET summary = 'другое'",
        "DELETE FROM agent_actions",
        "UPDATE agent_action_changes SET after = '{}'::jsonb",
        "DELETE FROM agent_action_changes",
        "UPDATE agent_runs SET trigger = 'morning'",
    ] {
        assert!(sqlx::query(sql).execute(pool).await.is_err(), "{sql}");
    }
    // Пробуждение закрывается один раз.
    qubite_agent::finish_run(pool, &run, true).await.unwrap();
    let status: String = sqlx::query_scalar("SELECT status FROM agent_runs WHERE id = $1")
        .bind(run.id)
        .fetch_one(pool)
        .await
        .unwrap();
    assert_eq!(status, "done");
    assert!(
        sqlx::query("UPDATE agent_runs SET status = 'failed'")
            .execute(pool)
            .await
            .is_err()
    );

    test_db.drop_db().await;
}

#[tokio::test]
async fn duration_estimation_owner_values_and_question_hint() {
    use qubite_planner::DurationBy;

    let (test_db, db) = TestDb::migrated().await;
    let pool = db.pool();
    let me = person(pool, "duration@example.com").await;
    let run = start_run(pool, me, Trigger::Manual).await.unwrap();
    let agent = Who::agent(&run);
    let made = done(
        pool,
        &agent,
        "task.create",
        json!({"title": "Позвонить маме"}),
        None,
    )
    .await;
    let id = created_id(&made, "planner.task");
    let saved = task(pool, me, id).await;
    assert_eq!(saved.duration_minutes, Some(10));
    assert_eq!(saved.duration_by, Some(DurationBy::Agent));
    assert!(made.summary.contains("по смыслу дела: ~10 мин"));
    assert_eq!(saved.fields()["duration_minutes"], 10);

    let made = done(
        pool,
        &agent,
        "task.create",
        json!({"title": "Позвонить папе", "fields": {"duration_minutes": 25}}),
        None,
    )
    .await;
    let id = created_id(&made, "planner.task");
    assert_eq!(
        task(pool, me, id).await.duration_by,
        Some(DurationBy::Owner)
    );
    assert_eq!(task(pool, me, id).await.duration_minutes, Some(25));
    let error = call(
        pool,
        &agent,
        "task.update",
        json!({"task_id": id, "fields": {"duration_minutes": 10, "duration_by": "agent"}}),
        None,
        None,
    )
    .await
    .unwrap_err();
    assert!(matches!(error, Error::NeedsOwner(_)));
    done(
        pool,
        &agent,
        "task.update",
        json!({"task_id": id, "fields": {"notes": "не менять длительность"}}),
        None,
    )
    .await;
    assert_eq!(task(pool, me, id).await.duration_minutes, Some(25));

    let made = done(
        pool,
        &agent,
        "task.create",
        json!({"title": "Позвонить другу", "fields": {"duration_minutes": null}}),
        None,
    )
    .await;
    let saved = task(pool, me, created_id(&made, "planner.task")).await;
    assert_eq!(saved.duration_minutes, None);
    assert_eq!(saved.duration_by, None);
    assert!(!made.summary.contains("спросила"));

    let unknown = json!({"title": "Новая идея"});
    let made = done(pool, &agent, "task.create", unknown.clone(), None).await;
    assert!(
        made.summary
            .contains("спросила: «Сколько займёт «Новая идея»?»")
    );
    let asked = made.clone();
    let saved = task(pool, me, created_id(&made, "planner.task")).await;
    assert_eq!(saved.duration_minutes, None);
    let repeated = done(pool, &agent, "task.create", unknown.clone(), None).await;
    assert!(!repeated.summary.contains("спросила"));
    done(
        pool,
        &agent,
        "question.close",
        json!({"question_id": created_id(&asked, "agent.question"), "answer": "40 минут"}),
        None,
    )
    .await;
    let repeated = done(pool, &agent, "task.create", unknown, None).await;
    assert!(
        !repeated.summary.contains("спросила"),
        "недельный лимит после ответа"
    );

    for minutes in [40, 44] {
        let past = Uuid::now_v7();
        let result = device(
            pool,
            me,
            past,
            OpKind::Create {
                object_type: "planner.task".into(),
                title: "ДЗ по русскому".into(),
                fields: Some(json!({"status": "done", "duration_minutes": minutes})),
            },
        )
        .await;
        assert!(matches!(result, OpResult::Applied { .. }));
    }
    let made = done(
        pool,
        &agent,
        "task.create",
        json!({"title": "ДЗ по русскому № 20"}),
        None,
    )
    .await;
    let saved = task(pool, me, created_id(&made, "planner.task")).await;
    assert_eq!(saved.duration_minutes, Some(42));
    assert_eq!(saved.duration_by, Some(DurationBy::Agent));
    assert!(made.summary.contains("как прошлые"));
    test_db.drop_db().await;
}
