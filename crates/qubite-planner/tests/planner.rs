//! Planner на настоящей PostgreSQL: проекты и дела через синхронизацию,
//! шаги, важность, срок, повторения, права по модулям, конфликты.

use std::collections::HashSet;

use qubite_planner::{
    Priority, ProjectFieldsHandler, Status, TaskFieldsHandler, format_date, next_due,
};
use qubite_sync::{OpKind, OpResult, Operation, PushRequest, RejectReason};
use qubite_sync_server::{Registry, Rules};
use qubite_testkit::TestDb;
use serde_json::{Value, json};
use uuid::Uuid;

fn rules() -> Rules {
    Rules {
        registry: Registry::default()
            .with(ProjectFieldsHandler)
            .with(TaskFieldsHandler),
        strict: true,
        writable: Some(HashSet::from(["planner".to_owned()])),
        readable: Some(vec!["planner".to_owned()]),
    }
}

fn create(object_id: Uuid, object_type: &str, title: &str, fields: Option<Value>) -> Operation {
    Operation {
        op_id: Uuid::now_v7(),
        object_id,
        base_revision: None,
        kind: OpKind::Create {
            object_type: object_type.into(),
            title: title.into(),
            fields,
        },
    }
}

fn task(object_id: Uuid, title: &str, fields: Value) -> Operation {
    create(object_id, "planner.task", title, Some(fields))
}

fn patch(object_id: Uuid, base: i64, fields: Value) -> Operation {
    Operation {
        op_id: Uuid::now_v7(),
        object_id,
        base_revision: Some(base),
        kind: OpKind::Patch { fields },
    }
}

async fn push(
    db: &qubite_db::Database,
    owner: Uuid,
    ops: Vec<Operation>,
    rules: &Rules,
) -> Vec<OpResult> {
    qubite_sync_server::push_with(
        db.pool(),
        owner,
        &PushRequest {
            device_id: Uuid::now_v7(),
            ops,
        },
        rules,
    )
    .await
    .unwrap()
    .results
}

fn applied(result: &OpResult) -> i64 {
    match result {
        OpResult::Applied { revision, .. } => *revision,
        other => panic!("ожидали «применено»: {other:?}"),
    }
}

fn rejected(result: &OpResult) -> String {
    match result {
        OpResult::Rejected {
            reason: RejectReason::Invalid,
            message,
            ..
        } => message.clone(),
        other => panic!("ожидали отказ: {other:?}"),
    }
}

#[tokio::test]
async fn offline_project_and_task_with_steps_and_priority() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let project = Uuid::now_v7();
    let homework = Uuid::now_v7();
    // Без сети: проект и дело в нём одним пакетом, по порядку.
    let results = push(
        &db,
        owner,
        vec![
            create(
                project,
                "planner.project",
                "Алгебра",
                Some(json!({ "color": "sky" })),
            ),
            task(
                homework,
                "Алгебра: № 214–220",
                json!({
                    "priority": "urgent",
                    "due_date": "2026-10-20",
                    "due_time": "18:00",
                    "project_id": project,
                    "subtasks": [
                        { "id": "a", "title": "№ 214–216" },
                        { "id": "b", "title": "№ 217–220", "done": true },
                    ],
                }),
            ),
        ],
        &rules(),
    )
    .await;
    applied(&results[0]);
    applied(&results[1]);

    let mut conn = db.pool().acquire().await.unwrap();
    let saved = qubite_planner::get_task(&mut conn, owner, homework)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.priority, Priority::Urgent);
    assert_eq!(saved.status, Status::Todo);
    assert_eq!(saved.project_id, Some(project), "связь part_of");
    assert_eq!(saved.subtasks.len(), 2);
    assert!(saved.subtasks[1].done);
    assert_eq!(
        saved.due_date.map(format_date).as_deref(),
        Some("2026-10-20")
    );

    // Command находит проект по #тегу: точно и по началу слова.
    for tag in ["#алгебра", "Алгебра", "алг"] {
        let found = qubite_planner::project_by_tag(&mut conn, owner, tag)
            .await
            .unwrap();
        assert_eq!(found.map(|p| p.id), Some(project), "{tag}");
    }
    assert!(
        qubite_planner::project_by_tag(&mut conn, Uuid::now_v7(), "алгебра")
            .await
            .unwrap()
            .is_none(),
        "чужой проект не находится"
    );
    let in_project = qubite_planner::list_tasks(&mut conn, owner, Some(project), 100)
        .await
        .unwrap();
    assert_eq!(in_project.len(), 1);

    // Другое устройство забирает проект и дело с полями.
    let pulled = qubite_sync_server::pull_with(db.pool(), owner, 0, 100, &rules())
        .await
        .unwrap();
    let by_id = |id: Uuid| {
        pulled
            .changes
            .iter()
            .find(|change| change.id == id)
            .and_then(|change| change.fields.clone())
            .unwrap()
    };
    assert_eq!(by_id(project)["tag"], "алгебра");
    assert_eq!(by_id(project)["color"], "sky");
    let fields = by_id(homework);
    assert_eq!(fields["due_time"], "18:00");
    assert_eq!(fields["project_id"], project.to_string());
    assert_eq!(fields["subtasks"][0]["done"], false);

    // Отметил шаг и сделал важным — меняются только эти поля.
    let results = push(
        &db,
        owner,
        vec![patch(
            homework,
            saved.revision,
            json!({
                "priority": "important",
                "subtasks": [
                    { "id": "a", "title": "№ 214–216", "done": true },
                    { "id": "b", "title": "№ 217–220", "done": true },
                ],
            }),
        )],
        &rules(),
    )
    .await;
    applied(&results[0]);
    // Сделано: время выполнения ставится, проект и срок остаются.
    let results = push(
        &db,
        owner,
        vec![patch(
            homework,
            saved.revision + 1,
            json!({ "status": "done" }),
        )],
        &rules(),
    )
    .await;
    applied(&results[0]);
    let done = qubite_planner::get_task(&mut conn, owner, homework)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(done.status, Status::Done);
    assert!(done.completed_at.is_some());
    assert_eq!(done.priority, Priority::Important);
    assert!(done.next_id.is_none(), "не повторяется — следующего нет");
    // Вернул в работу — время выполнения снимается.
    let results = push(
        &db,
        owner,
        vec![patch(homework, done.revision, json!({ "status": "doing" }))],
        &rules(),
    )
    .await;
    applied(&results[0]);
    let doing = qubite_planner::get_task(&mut conn, owner, homework)
        .await
        .unwrap()
        .unwrap();
    assert!(doing.completed_at.is_none());

    // Убрал из проекта.
    let results = push(
        &db,
        owner,
        vec![patch(
            homework,
            doing.revision,
            json!({ "project_id": null }),
        )],
        &rules(),
    )
    .await;
    applied(&results[0]);
    let loose = qubite_planner::get_task(&mut conn, owner, homework)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(loose.project_id, None);
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn repeating_task_creates_the_next_one_once() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let project = Uuid::now_v7();
    let mut conn = db.pool().acquire().await.unwrap();
    let today = qubite_planner::today(&mut conn).await.unwrap();
    let id = Uuid::now_v7();
    // «Каждый вторник» с первым разом сегодня — день недели берётся из правила.
    let tuesday = 2;
    let results = push(
        &db,
        owner,
        vec![
            create(project, "planner.project", "Кружок", None),
            task(
                id,
                "Кружок: ДП",
                json!({
                    "due_date": format_date(today),
                    "due_time": "16:00",
                    "priority": "important",
                    "project_id": project,
                    "recurrence": { "freq": "weekly", "weekdays": [tuesday] },
                    "subtasks": [{ "id": "s1", "title": "решить разбор", "done": true }],
                }),
            ),
        ],
        &rules(),
    )
    .await;
    applied(&results[1]);
    let first = qubite_planner::get_task(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    let rule = first.recurrence.clone().unwrap();
    assert_eq!(rule.weekdays, [tuesday]);
    assert_eq!(rule.interval, 1);

    // Отметил выполненным — сервер создал следующее.
    let cursor = qubite_sync_server::pull_with(db.pool(), owner, 0, 500, &rules())
        .await
        .unwrap()
        .cursor;
    let revision = applied(
        &push(
            &db,
            owner,
            vec![patch(id, first.revision, json!({ "status": "done" }))],
            &rules(),
        )
        .await[0],
    );
    let first = qubite_planner::get_task(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    let next_id = first.next_id.expect("следующее создано");
    let next = qubite_planner::get_task(&mut conn, owner, next_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(next.title, "Кружок: ДП");
    assert_eq!(next.status, Status::Todo);
    assert_eq!(next.due_date, next_due(&rule, today, today));
    assert!(next.due_date.unwrap() > today);
    assert_eq!(
        next.due_date.unwrap().weekday().number_from_monday(),
        tuesday
    );
    assert_eq!(next.due_time, first.due_time);
    assert_eq!(next.priority, Priority::Important);
    assert_eq!(next.project_id, Some(project), "тот же проект");
    assert!(!next.subtasks[0].done, "шаги — без галочек");
    assert_eq!(next.series_id, Some(id));
    assert_eq!(first.series_id, Some(id));
    assert_eq!(next.recurrence, first.recurrence);

    // Устройство узнаёт о новом деле через pull.
    let pulled = qubite_sync_server::pull_with(db.pool(), owner, cursor, 500, &rules())
        .await
        .unwrap();
    let ids: Vec<Uuid> = pulled.changes.iter().map(|change| change.id).collect();
    assert!(ids.contains(&id) && ids.contains(&next_id), "{ids:?}");
    assert_eq!(
        pulled
            .changes
            .iter()
            .find(|change| change.id == id)
            .unwrap()
            .fields
            .as_ref()
            .unwrap()["next_id"],
        next_id.to_string()
    );

    // Снял галочку и поставил снова — второго «следующего» нет.
    let revision = applied(
        &push(
            &db,
            owner,
            vec![patch(id, revision, json!({ "status": "todo" }))],
            &rules(),
        )
        .await[0],
    );
    applied(
        &push(
            &db,
            owner,
            vec![patch(id, revision, json!({ "status": "done" }))],
            &rules(),
        )
        .await[0],
    );
    let series: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM planner_tasks WHERE series_id = $1 OR object_id = $1",
    )
    .bind(id)
    .fetch_one(&mut *conn)
    .await
    .unwrap();
    assert_eq!(series, 2, "одно и то же — не дважды");

    // Два устройства без сети отметили следующее одновременно: одно
    // применяется, другое получает конфликт — третьего дела не появляется.
    let both = push(
        &db,
        owner,
        vec![
            patch(next_id, next.revision, json!({ "status": "done" })),
            patch(next_id, next.revision, json!({ "status": "done" })),
        ],
        &rules(),
    )
    .await;
    applied(&both[0]);
    assert!(
        matches!(both[1], OpResult::Conflict { .. }),
        "{:?}",
        both[1]
    );
    let series: i64 = sqlx::query_scalar("SELECT count(*) FROM planner_tasks WHERE series_id = $1")
        .bind(id)
        .fetch_one(&mut *conn)
        .await
        .unwrap();
    assert_eq!(series, 3);

    // «Каждый день», забытое на неделю: следующее — сегодня, а не пачка.
    let daily = Uuid::now_v7();
    let week_ago = today - time::Duration::days(7);
    applied(
        &push(
            &db,
            owner,
            vec![task(
                daily,
                "Зарядка",
                json!({ "due_date": format_date(week_ago), "recurrence": { "freq": "daily" },
                        "status": "done" }),
            )],
            &rules(),
        )
        .await[0],
    );
    let done_daily = qubite_planner::get_task(&mut conn, owner, daily)
        .await
        .unwrap()
        .unwrap();
    let after = qubite_planner::get_task(&mut conn, owner, done_daily.next_id.unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(after.due_date, Some(today));
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn bad_fields_and_foreign_projects() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let stranger = Uuid::now_v7();
    let foreign = Uuid::now_v7();
    applied(
        &push(
            &db,
            stranger,
            vec![create(foreign, "planner.project", "Чужой", None)],
            &rules(),
        )
        .await[0],
    );

    let cases = [
        json!({ "due_time": "16:00" }),
        json!({ "recurrence": { "freq": "daily" } }),
        json!({ "due_date": "2026-02-30" }),
        json!({ "due_date": "2026-10-20", "due_time": "25:00" }),
        json!({ "due_date": "2026-10-20", "recurrence": { "freq": "weekly", "weekdays": [9] } }),
        json!({ "subtasks": [{ "id": "a", "title": "" }] }),
        json!({ "subtasks": [{ "id": "a", "title": "x" }, { "id": "a", "title": "y" }] }),
        json!({ "priority": "очень" }),
        json!({ "colour": "sky" }),
    ];
    for fields in cases {
        let results = push(
            &db,
            owner,
            vec![task(Uuid::now_v7(), "дело", fields.clone())],
            &rules(),
        )
        .await;
        let message = rejected(&results[0]);
        assert!(!message.is_empty(), "{fields}");
    }
    assert!(
        rejected(
            &push(
                &db,
                owner,
                vec![task(Uuid::now_v7(), "  ", json!({}))],
                &rules()
            )
            .await[0]
        )
        .contains("назван")
    );
    let left: i64 = sqlx::query_scalar("SELECT count(*) FROM objects WHERE owner_id = $1")
        .bind(owner)
        .fetch_one(db.pool())
        .await
        .unwrap();
    assert_eq!(left, 0, "отклонённое не оставляет половину объекта");

    // Создано без сети с чужим (или удалённым) проектом — дело не теряется,
    // просто без проекта. Поставить чужой проект правкой — нельзя.
    let id = Uuid::now_v7();
    let revision = applied(
        &push(
            &db,
            owner,
            vec![task(id, "моё дело", json!({ "project_id": foreign }))],
            &rules(),
        )
        .await[0],
    );
    let mut conn = db.pool().acquire().await.unwrap();
    let mine = qubite_planner::get_task(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(mine.project_id, None);
    let message = rejected(
        &push(
            &db,
            owner,
            vec![patch(id, revision, json!({ "project_id": foreign }))],
            &rules(),
        )
        .await[0],
    );
    assert!(message.contains("проект не найден"), "{message}");
    // Чужое дело для меня «не существует».
    let results = push(
        &db,
        stranger,
        vec![patch(id, revision, json!({ "status": "done" }))],
        &rules(),
    )
    .await;
    assert!(
        matches!(
            results[0],
            OpResult::Rejected {
                reason: RejectReason::NotFound,
                ..
            }
        ),
        "{results:?}"
    );
    assert!(
        qubite_planner::get_task(&mut conn, stranger, id)
            .await
            .unwrap()
            .is_none()
    );

    // Убрал срок — уходят и время, и повторение.
    let repeating = Uuid::now_v7();
    let revision = applied(
        &push(
            &db,
            owner,
            vec![task(
                repeating,
                "Зарядка",
                json!({ "due_date": "2026-10-20", "due_time": "07:30",
                        "recurrence": { "freq": "daily" } }),
            )],
            &rules(),
        )
        .await[0],
    );
    applied(
        &push(
            &db,
            owner,
            vec![patch(repeating, revision, json!({ "due_date": null }))],
            &rules(),
        )
        .await[0],
    );
    let cleared = qubite_planner::get_task(&mut conn, owner, repeating)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        (cleared.due_date, cleared.due_time, cleared.recurrence),
        (None, None, None)
    );
    drop(conn);
    test_db.drop_db().await;
}

#[tokio::test]
async fn planner_follows_module_rights() {
    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    // Права на Planner нет — операция отклоняется, остальные идут.
    let no_write = Rules {
        writable: Some(HashSet::new()),
        ..rules()
    };
    let results = push(
        &db,
        owner,
        vec![task(Uuid::now_v7(), "дело", json!({}))],
        &no_write,
    )
    .await;
    assert!(
        matches!(
            results[0],
            OpResult::Rejected {
                reason: RejectReason::Forbidden,
                ..
            }
        ),
        "{results:?}"
    );
    applied(
        &push(
            &db,
            owner,
            vec![task(Uuid::now_v7(), "дело", json!({}))],
            &rules(),
        )
        .await[0],
    );
    // Читать Planner нельзя — pull его не отдаёт.
    let no_read = Rules {
        readable: Some(vec!["inbox".to_owned()]),
        ..rules()
    };
    let pulled = qubite_sync_server::pull_with(db.pool(), owner, 0, 100, &no_read)
        .await
        .unwrap();
    assert!(pulled.changes.is_empty());
    // В модуле Planner — только его типы.
    let results = push(
        &db,
        owner,
        vec![create(Uuid::now_v7(), "planner.milestone", "этап", None)],
        &rules(),
    )
    .await;
    assert!(rejected(&results[0]).contains("не синхронизируется"));
    test_db.drop_db().await;
}

#[tokio::test]
async fn duration_migration_sync_and_constraints() {
    use qubite_planner::DurationBy;

    let (test_db, db) = TestDb::migrated().await;
    let owner = Uuid::now_v7();
    let id = Uuid::now_v7();
    let result = push(
        &db,
        owner,
        vec![task(id, "Дело", json!({"duration_minutes": 1}))],
        &rules(),
    )
    .await;
    let mut revision = applied(&result[0]);
    // Длительность человека агент не перезаписывает — отказ в самой записи.
    let result = push(
        &db,
        owner,
        vec![patch(
            id,
            revision,
            json!({"duration_minutes": 5, "duration_by": "agent"}),
        )],
        &rules(),
    )
    .await;
    assert!(rejected(&result[0]).contains("человека"));
    let result = push(
        &db,
        owner,
        vec![patch(id, revision, json!({"duration_minutes": null}))],
        &rules(),
    )
    .await;
    revision = applied(&result[0]);
    for minutes in [1440, 1] {
        let result = push(
            &db,
            owner,
            vec![patch(
                id,
                revision,
                json!({"duration_minutes": minutes, "duration_by": "agent"}),
            )],
            &rules(),
        )
        .await;
        revision = applied(&result[0]);
        let mut conn = db.pool().acquire().await.unwrap();
        let saved = qubite_planner::get_task(&mut conn, owner, id)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(saved.duration_minutes, Some(minutes));
        assert_eq!(saved.duration_by, Some(DurationBy::Agent));
    }
    for fields in [
        json!({"duration_minutes": 0}),
        json!({"duration_minutes": 1441}),
        json!({"duration_minutes": 10, "duration_by": "auto"}),
    ] {
        let result = push(&db, owner, vec![patch(id, revision, fields)], &rules()).await;
        rejected(&result[0]);
    }
    // Ограничение есть и в БД: запись в обход синхронизации не обходит диапазон.
    for minutes in [0, 1441] {
        assert!(
            sqlx::query("UPDATE planner_tasks SET duration_minutes = $2 WHERE object_id = $1")
                .bind(id)
                .bind(minutes)
                .execute(db.pool())
                .await
                .is_err()
        );
    }
    let result = push(
        &db,
        owner,
        vec![patch(id, revision, json!({"duration_minutes": null}))],
        &rules(),
    )
    .await;
    applied(&result[0]);
    let mut conn = db.pool().acquire().await.unwrap();
    let saved = qubite_planner::get_task(&mut conn, owner, id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(saved.duration_minutes, None);
    assert_eq!(saved.duration_by, None);
    assert_eq!(saved.fields()["duration_by"], Value::Null);
    drop(conn);
    test_db.drop_db().await;
}
