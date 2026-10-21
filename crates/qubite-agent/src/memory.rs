//! Инструменты папки агента (AGT-001): `files.list`, `files.read`,
//! `files.create`, `memory.add`, `memory.patch`, `memory.remove`,
//! `question.ask`, `question.close`; правка файла руками и ответ на вопрос.
//!
//! Как у Hermes, память правится **строками**, а не переписыванием целиком:
//! добавить строку, заменить кусок, убрать строку. Каждая правка — шаг
//! движка синхронизации и строка ленты с откатом (`timeline::execute`).

use qubite_sync::OpKind;
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use uuid::Uuid;

use crate::{
    Actor, Error, Result, Who,
    files::{self, File, Kind},
    questions,
    timeline::{self, Action, Plan, Step},
};

pub const READ_TOOLS: &[&str] = &["files.list", "files.read", "question.list"];
pub const WRITE_TOOLS: &[&str] = &[
    "files.create",
    "memory.add",
    "memory.patch",
    "memory.remove",
    "question.ask",
    "question.close",
];

fn args<T: for<'de> Deserialize<'de>>(tool: &str, value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|error| Error::Invalid(format!("{tool}: {error}")))
}

fn memory_path() -> String {
    files::MEMORY_PATH.to_owned()
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PathArg {
    path: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateArgs {
    path: String,
    #[serde(default)]
    body: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AddArgs {
    #[serde(default = "memory_path")]
    path: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchArgs {
    #[serde(default = "memory_path")]
    path: String,
    old: String,
    #[serde(default)]
    new: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RemoveArgs {
    #[serde(default = "memory_path")]
    path: String,
    text: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AskArgs {
    text: String,
    #[serde(default)]
    why: String,
    #[serde(default)]
    options: Vec<String>,
    project_id: Option<Uuid>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CloseArgs {
    question_id: Uuid,
    /// Ответ, если агент узнал его сам; нет — вопрос отпущен.
    #[serde(default)]
    answer: String,
}

/// «Память» — короткое имя файла для ленты.
fn name(path: &str) -> String {
    format!("«{}»", files::display_name(path))
}

/// Кусок текста для ленты: одна строка, не длиннее `max` знаков.
pub(crate) fn quote(text: &str, max: usize) -> String {
    let line = text.split_whitespace().collect::<Vec<_>>().join(" ");
    if line.chars().count() > max {
        format!("{}…", line.chars().take(max).collect::<String>())
    } else {
        line
    }
}

/// Строка памяти: списком, если это не таблица, заголовок или уже список.
fn as_line(text: &str) -> String {
    let text = text.trim();
    let first = text.chars().next().unwrap_or('-');
    if matches!(first, '-' | '*' | '|' | '#' | '>') || text.contains('\n') {
        text.to_owned()
    } else {
        format!("- {text}")
    }
}

fn append(body: &str, line: &str) -> String {
    let body = body.trim_end();
    if body.is_empty() {
        format!("{line}\n")
    } else {
        format!("{body}\n{line}\n")
    }
}

/// Навыки правятся своими инструментами: одной строкой и с причиной (AGT-003).
fn not_skill(path: &str) -> Result<()> {
    if files::kind_of(path) == Kind::Skill {
        return Err(Error::Invalid(
            "навыки — skill.create (новый) и skill.patch (одна строка)".into(),
        ));
    }
    Ok(())
}

async fn file(conn: &mut PgConnection, account: Uuid, path: &str) -> Result<File> {
    let path = files::normalize_path(path).map_err(Error::Invalid)?;
    not_skill(&path)?;
    files::by_path(conn, account, &path)
        .await?
        .ok_or_else(|| Error::Invalid(format!("нет файла «{path}» — заведи его files.create")))
}

fn listing(files: &[File]) -> Value {
    Value::Array(
        files
            .iter()
            .map(|file| {
                let (chars, limit) = file.usage();
                json!({
                    "path": file.path,
                    "kind": file.kind.as_str(),
                    "chars": chars,
                    "limit": limit,
                    "project_id": file.project_id,
                })
            })
            .collect(),
    )
}

/// Читающие инструменты папки.
pub(crate) async fn read(
    conn: &mut PgConnection,
    account: Uuid,
    tool: &str,
    arguments: Value,
) -> Result<Value> {
    match tool {
        "files.list" => Ok(listing(&files::list(conn, account).await?)),
        "files.read" => {
            let PathArg { path } = args(tool, arguments)?;
            let file = file(conn, account, &path).await?;
            let (chars, limit) = file.usage();
            Ok(json!({
                "path": file.path,
                "kind": file.kind.as_str(),
                "chars": chars,
                "limit": limit,
                "text": file.text(),
            }))
        }
        "question.list" => {
            let open = questions::open(conn, account).await?;
            Ok(serde_json::to_value(open)?)
        }
        other => Err(Error::Invalid(format!("нет инструмента {other}"))),
    }
}

fn patch_step(file: &File, body: String) -> Step {
    Step {
        object_id: file.id,
        kind: OpKind::Patch {
            fields: json!({ "body": body }),
        },
    }
}

fn create_step(path: &str, body: String) -> Step {
    Step {
        object_id: Uuid::now_v7(),
        kind: OpKind::Create {
            object_type: files::FILE_TYPE.into(),
            title: path.to_owned(),
            fields: Some(json!({ "path": path, "body": body })),
        },
    }
}

/// Заранее проверить текст (размер, формат, секреты): агент получает
/// понятную ошибку, а не «отклонено синхронизацией».
fn check(path: &str, body: &str) -> Result<(String, usize)> {
    files::prepare(path, files::kind_of(path), body).map_err(Error::Invalid)
}

fn redacted_note(count: usize) -> &'static str {
    if count > 0 {
        " (секреты вычеркнуты)"
    } else {
        ""
    }
}

/// Меняющие инструменты папки: фраза для ленты и шаги.
pub(crate) async fn plan(
    conn: &mut PgConnection,
    account: Uuid,
    tool: &str,
    arguments: Value,
) -> Result<(String, Vec<Step>)> {
    match tool {
        "files.create" => {
            let CreateArgs { path, body } = args(tool, arguments)?;
            let path = files::normalize_path(&path).map_err(Error::Invalid)?;
            not_skill(&path)?;
            if matches!(
                files::kind_of(&path),
                Kind::Core | Kind::User | Kind::Memory
            ) {
                return Err(Error::Invalid(format!(
                    "«{path}» уже есть всегда — правь его memory.add / memory.patch"
                )));
            }
            if files::by_path(conn, account, &path).await?.is_some() {
                return Err(Error::Invalid(format!(
                    "«{path}» уже есть — правь его memory.add / memory.patch"
                )));
            }
            let (body, redacted) = check(&path, &body)?;
            Ok((
                format!("Завёл файл {}{}", name(&path), redacted_note(redacted)),
                vec![create_step(&path, body)],
            ))
        }
        "memory.add" => {
            let AddArgs { path, text } = args(tool, arguments)?;
            if text.trim().is_empty() {
                return Err(Error::Invalid("пустая строка".into()));
            }
            let path = files::normalize_path(&path).map_err(Error::Invalid)?;
            not_skill(&path)?;
            let line = as_line(&text);
            match files::by_path(conn, account, &path).await? {
                Some(file) => {
                    let (body, redacted) = check(&file.path, &append(&file.body, &line))?;
                    Ok((
                        format!(
                            "{}: + «{}»{}",
                            name(&file.path),
                            quote(&files::redact(&line).0, 120),
                            redacted_note(redacted)
                        ),
                        vec![patch_step(&file, body)],
                    ))
                }
                // Новый файл проекта или свой — заводим сразу с этой строкой.
                None if matches!(files::kind_of(&path), Kind::Project | Kind::File) => {
                    let (body, redacted) = check(&path, &append("", &line))?;
                    Ok((
                        format!(
                            "Завёл файл {}: + «{}»{}",
                            name(&path),
                            quote(&files::redact(&line).0, 120),
                            redacted_note(redacted)
                        ),
                        vec![create_step(&path, body)],
                    ))
                }
                None => Err(Error::Invalid(format!(
                    "нет файла «{path}» — заведи его files.create"
                ))),
            }
        }
        "memory.patch" => {
            let PatchArgs { path, old, new } = args(tool, arguments)?;
            let file = file(conn, account, &path).await?;
            if old.is_empty() {
                return Err(Error::Invalid("что заменить (old) — не пусто".into()));
            }
            let found = file.body.matches(old.as_str()).count();
            if found == 0 {
                return Err(Error::Invalid(if file.kind == Kind::Core {
                    "в «Твоих правилах» нет такого текста; основу «Кто я» менять нельзя".into()
                } else {
                    format!(
                        "в {} нет такого текста — прочитай файл (files.read)",
                        name(&file.path)
                    )
                }));
            }
            if found > 1 {
                return Err(Error::Invalid(format!(
                    "этот текст встречается в {} {found} раза — возьми кусок длиннее",
                    name(&file.path)
                )));
            }
            let (body, redacted) = check(&file.path, &file.body.replacen(&old, &new, 1))?;
            let what = if new.trim().is_empty() {
                format!("− «{}»", quote(&old, 80))
            } else {
                format!(
                    "«{}» → «{}»",
                    quote(&old, 60),
                    quote(&files::redact(&new).0, 60)
                )
            };
            Ok((
                format!("{}: {what}{}", name(&file.path), redacted_note(redacted)),
                vec![patch_step(&file, body)],
            ))
        }
        "memory.remove" => {
            let RemoveArgs { path, text } = args(tool, arguments)?;
            let file = file(conn, account, &path).await?;
            let needle = text.trim();
            if needle.is_empty() {
                return Err(Error::Invalid("какую строку убрать — не пусто".into()));
            }
            let matching: Vec<&str> = file.body.lines().filter(|l| l.contains(needle)).collect();
            match matching.len() {
                0 => {
                    return Err(Error::Invalid(format!(
                        "в {} нет строки с «{}»",
                        name(&file.path),
                        quote(needle, 60)
                    )));
                }
                1 => {}
                n => {
                    return Err(Error::Invalid(format!(
                        "«{}» есть в {n} строках — уточни",
                        quote(needle, 60)
                    )));
                }
            }
            let removed = matching[0].to_owned();
            let mut body: String = file
                .body
                .lines()
                .filter(|line| *line != removed)
                .collect::<Vec<_>>()
                .join("\n");
            if file.body.ends_with('\n') && !body.is_empty() {
                body.push('\n');
            }
            let (body, _) = check(&file.path, &body)?;
            Ok((
                format!("{}: − «{}»", name(&file.path), quote(&removed, 100)),
                vec![patch_step(&file, body)],
            ))
        }
        "question.ask" => {
            let AskArgs {
                text,
                why,
                options,
                project_id,
            } = args(tool, arguments)?;
            let text = files::redact(text.trim()).0;
            if text.is_empty() {
                return Err(Error::Invalid("пустой вопрос".into()));
            }
            if let Err(reason) = questions::may_ask(conn, account, &text).await? {
                return Err(Error::Invalid(reason));
            }
            Ok((
                format!("Спросил: «{}»", quote(&text, 200)),
                vec![Step {
                    object_id: Uuid::now_v7(),
                    kind: OpKind::Create {
                        object_type: questions::QUESTION_TYPE.into(),
                        title: text,
                        fields: Some(json!({
                            "why": why.trim(),
                            "options": options,
                            "project_id": project_id,
                        })),
                    },
                }],
            ))
        }
        "question.close" => {
            let CloseArgs {
                question_id,
                answer,
            } = args(tool, arguments)?;
            let question = questions::get(conn, account, question_id)
                .await?
                .ok_or(Error::NotFound)?;
            if question.status != questions::Status::Open {
                return Err(Error::Invalid("этот вопрос уже закрыт".into()));
            }
            let answer = files::redact(answer.trim()).0;
            let (summary, fields) = if answer.is_empty() {
                (
                    format!("Отпустил вопрос «{}»", quote(&question.text, 120)),
                    json!({ "status": "dropped" }),
                )
            } else {
                (
                    format!(
                        "Узнал ответ на «{}»: {}",
                        quote(&question.text, 100),
                        quote(&answer, 100)
                    ),
                    json!({ "status": "answered", "answer": answer }),
                )
            };
            Ok((
                summary,
                vec![Step {
                    object_id: question_id,
                    kind: OpKind::Patch { fields },
                }],
            ))
        }
        other => Err(Error::Invalid(format!("нет инструмента {other}"))),
    }
}

// ---------------------------------------------------------------- база папки

/// Завести «Кто я», «О тебе», «Память» и встроенные навыки, если их ещё нет.
/// Это не действие агента, а пустая папка нового человека — в ленту не пишется.
pub async fn ensure_base(pool: &PgPool, account: Uuid) -> Result<()> {
    let mut tx = pool.begin().await?;
    timeline::lock(&mut tx, account).await?;
    timeline::check_agent(&mut tx, &Who::owner(account, None)).await?;
    let rules = qubite_sync_server::Rules {
        registry: timeline::registry(),
        strict: true,
        writable: None,
        readable: None,
    };
    let base = [
        (files::CORE_PATH, ""),
        (files::USER_PATH, "# О тебе\n"),
        (
            files::MEMORY_PATH,
            "# Память\n\nКороткие факты одной строкой и оглавление: что в каком файле.\n",
        ),
    ];
    for (path, body) in base {
        if files::by_path(&mut tx, account, path).await?.is_some() {
            continue;
        }
        let op = qubite_sync::Operation {
            op_id: Uuid::now_v7(),
            object_id: Uuid::now_v7(),
            base_revision: None,
            kind: OpKind::Create {
                object_type: files::FILE_TYPE.into(),
                title: path.into(),
                fields: Some(json!({ "path": path, "body": body })),
            },
        };
        qubite_sync_server::apply_in(&mut tx, account, account, &op, &rules).await?;
    }
    crate::skills::ensure_builtin(&mut tx, account, &rules).await?;
    tx.commit().await?;
    Ok(())
}

/// Правка файла руками (владелец): весь текст целиком, `revision` — версия,
/// которую он видел. Это его поправка — видна в ленте и откатывается.
pub async fn edit(
    pool: &PgPool,
    who: &Who,
    file_id: Uuid,
    body: &str,
    revision: i64,
) -> Result<Action> {
    if who.actor() != Actor::Owner {
        return Err(Error::NeedsOwner("руками правит только человек".into()));
    }
    let mut conn = pool.acquire().await?;
    let file = files::by_id(&mut conn, who.account(), file_id)
        .await?
        .ok_or(Error::NotFound)?;
    drop(conn);
    if file.revision != revision {
        return Err(Error::Busy);
    }
    if file.body == body {
        return Err(Error::Invalid("ничего не изменилось".into()));
    }
    let (body, redacted) = check(&file.path, body)?;
    let plan = Plan {
        tool: "files.edit".into(),
        summary: format!(
            "Поправил {} руками{}",
            name(&file.path),
            redacted_note(redacted)
        ),
        reason: Some("правка руками — поправка для агента".into()),
        batch: Uuid::now_v7(),
        reverts: None,
        corrects: None,
        steps: vec![patch_step(&file, body)],
    };
    timeline::execute(pool, who, plan).await
}

/// «Новый файл» руками (владелец, D-391): имя и текст. Как и правка руками —
/// строка ленты с откатом (откат кладёт файл в корзину).
pub async fn create(pool: &PgPool, who: &Who, path: &str, body: &str) -> Result<Action> {
    if who.actor() != Actor::Owner {
        return Err(Error::NeedsOwner("руками заводит только человек".into()));
    }
    let path = files::normalize_path(path).map_err(Error::Invalid)?;
    match files::kind_of(&path) {
        Kind::Skill => {
            return Err(Error::Invalid(
                "навык заводит агент — напиши ему в поле внизу, что он должен уметь".into(),
            ));
        }
        Kind::Core | Kind::User | Kind::Memory => {
            return Err(Error::Invalid(format!(
                "{} уже есть — открой его",
                name(&path)
            )));
        }
        _ => {}
    }
    let mut conn = pool.acquire().await?;
    if files::by_path(&mut conn, who.account(), &path)
        .await?
        .is_some()
    {
        return Err(Error::Invalid(format!(
            "{} уже есть — открой его",
            name(&path)
        )));
    }
    drop(conn);
    let (body, redacted) = check(&path, body)?;
    let plan = Plan {
        tool: "files.create".into(),
        summary: format!("Завёл файл {}{}", name(&path), redacted_note(redacted)),
        reason: None,
        batch: Uuid::now_v7(),
        reverts: None,
        corrects: None,
        steps: vec![create_step(&path, body)],
    };
    timeline::execute(pool, who, plan).await
}

/// Ответить на вопрос агента (владелец) или отмахнуться (`answer` пустой).
pub async fn answer(pool: &PgPool, who: &Who, question_id: Uuid, answer: &str) -> Result<Action> {
    if who.actor() != Actor::Owner {
        return Err(Error::NeedsOwner("отвечает человек".into()));
    }
    let mut conn = pool.acquire().await?;
    let question = questions::get(&mut conn, who.account(), question_id)
        .await?
        .ok_or(Error::NotFound)?;
    drop(conn);
    if question.status != questions::Status::Open {
        return Err(Error::Invalid("на этот вопрос уже ответили".into()));
    }
    let answer = files::redact(answer.trim()).0;
    let (summary, fields) = if answer.is_empty() {
        (
            format!("Отмахнулся от вопроса «{}»", quote(&question.text, 120)),
            json!({ "status": "dropped" }),
        )
    } else {
        (
            format!(
                "Ответил на «{}»: {}",
                quote(&question.text, 100),
                quote(&answer, 120)
            ),
            json!({ "status": "answered", "answer": answer }),
        )
    };
    let plan = Plan {
        tool: "question.answer".into(),
        summary,
        reason: None,
        batch: Uuid::now_v7(),
        reverts: None,
        corrects: None,
        steps: vec![Step {
            object_id: question_id,
            kind: OpKind::Patch { fields },
        }],
    };
    timeline::execute(pool, who, plan).await
}
