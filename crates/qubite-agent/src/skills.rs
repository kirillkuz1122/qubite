//! Навыки агента (AGT-003, D-292, D-360…D-369): записанные способы делать
//! типовое — по образцу Hermes Agent.
//!
//! - навык — файл «Навыки/<навык>.md» папки агента в формате SKILL.md
//!   (agentskills.io): шапка `name`, `description`, `version`, `tools`, дальше
//!   разделы «Когда», «Как», «Подводные камни», «Как проверить»;
//! - агент видит **список** навыков с описаниями в каждом запросе, а целиком
//!   открывает нужный сам (`skill.view`), как у Hermes;
//! - заводит навык сам (`skill.create`): после поправки владельца, удачного
//!   многошагового дела или трёх повторов; уточняет **одной строкой**
//!   (`skill.patch`), а не переписывает; всё — через ленту с откатом;
//! - **куратор** раз в неделю убирает в архив навыки, которыми не
//!   пользовались [`UNUSED_DAYS`] дней (закреплённые не трогает); из архива
//!   навык возвращается одной кнопкой;
//! - **встроенные** навыки ([`BUILTIN`]) пишем мы и проверяем тестами;
//!   человеку заводится их копия, дальше она — его навык.
//!
//! Навык **не даёт** инструментов, прав и доступа: инструменты в шапке —
//! только существующие, а вызывает агент всё тем же [`crate::tools::call`]
//! с тем же потолком прав.

use qubite_sync::OpKind;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::{PgConnection, PgPool};
use time::OffsetDateTime;
use uuid::Uuid;

use crate::{
    Actor, Error, Result, Who,
    files::{self, File, Kind},
    memory::quote,
    timeline::{self, Action, Plan, Step},
};

pub const READ_TOOLS: &[&str] = &["skill.list", "skill.view"];
pub const WRITE_TOOLS: &[&str] = &["skill.create", "skill.patch", "skill.archive"];

/// Сколько дней без дела навык живёт до архива (как у Hermes).
pub const UNUSED_DAYS: i64 = 30;
/// Задача очереди: куратор навыков, раз в неделю.
pub const CURATE_JOB: &str = "agent.curate";
pub const CURATE_EVERY: time::Duration = time::Duration::days(7);
/// Задача очереди: научиться на поправке владельца («Исправить»).
pub const LEARN_JOB: &str = "agent.learn";

// ---------------------------------------------------------------- встроенные

/// Встроенный навык: пишем мы, проверен тестами.
#[derive(Debug, Clone, Copy)]
pub struct Builtin {
    /// Ключ — не меняется, даже если навык переименуют.
    pub key: &'static str,
    pub body: &'static str,
}

pub const BUILTIN: &[Builtin] = &[
    Builtin {
        key: "homework",
        body: include_str!("skills/homework.md"),
    },
    Builtin {
        key: "outing",
        body: include_str!("skills/outing.md"),
    },
    Builtin {
        key: "schedule",
        body: include_str!("skills/schedule.md"),
    },
    // AGT-007 (D-392, D-395): интересы владельца и банк идей.
    Builtin {
        key: "olympiad",
        body: include_str!("skills/olympiad.md"),
    },
    Builtin {
        key: "hackathon",
        body: include_str!("skills/hackathon.md"),
    },
    Builtin {
        key: "project-work",
        body: include_str!("skills/project-work.md"),
    },
    Builtin {
        key: "exam",
        body: include_str!("skills/exam.md"),
    },
    Builtin {
        key: "reading",
        body: include_str!("skills/reading.md"),
    },
];

impl Builtin {
    /// «Навыки/<name>.md».
    pub fn path(&self) -> String {
        let name = head(self.body).map(|head| head.name).unwrap_or_default();
        format!("{}/{name}.md", files::SKILLS_DIR)
    }
}

// ---------------------------------------------------------------- шапка

/// Шапка SKILL.md.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Head {
    pub name: String,
    pub description: String,
    pub version: Option<u32>,
    /// Какими инструментами навык пользуется (только существующие).
    pub tools: Vec<String>,
}

/// Все инструменты агента: навык может назвать только их.
pub fn known_tool(name: &str) -> bool {
    [
        crate::tools::READ_TOOLS,
        crate::tools::WRITE_TOOLS,
        crate::memory::READ_TOOLS,
        crate::memory::WRITE_TOOLS,
        READ_TOOLS,
        WRITE_TOOLS,
    ]
    .iter()
    .any(|list| list.contains(&name))
}

fn unquote(value: &str) -> String {
    value
        .trim()
        .trim_matches(|c| c == '"' || c == '\'')
        .trim()
        .to_owned()
}

/// Разобрать шапку навыка: `name` и `description` обязательны, инструменты —
/// только существующие (навык не даёт новых, D-292).
pub fn head(body: &str) -> Result<Head, String> {
    let body = body.trim_start();
    let rest = body.strip_prefix("---").ok_or(
        "навык — SKILL.md: начинается с шапки «---», в ней name: и description:, потом «---»",
    )?;
    let (head, _) = rest
        .split_once("\n---")
        .ok_or("у шапки навыка нет закрывающей строки «---»")?;
    let (mut name, mut description, mut version) = (String::new(), String::new(), None);
    let mut tools = Vec::new();
    let mut tool_lines = false;
    for line in head.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if tool_lines {
            if let Some(item) = line.strip_prefix('-') {
                tools.push(unquote(item));
                continue;
            }
            tool_lines = false;
        }
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        match key.trim() {
            "name" => name = unquote(value),
            "description" => description = unquote(value),
            "version" => version = unquote(value).parse().ok(),
            "tools" => {
                let value = value.trim();
                if value.is_empty() {
                    tool_lines = true;
                } else {
                    tools.extend(
                        value
                            .trim_start_matches('[')
                            .trim_end_matches(']')
                            .split(',')
                            .map(unquote)
                            .filter(|tool| !tool.is_empty()),
                    );
                }
            }
            _ => {}
        }
    }
    if name.is_empty() {
        return Err("в шапке навыка нет «name:»".into());
    }
    if description.is_empty() {
        return Err("в шапке навыка нет «description:»".into());
    }
    if name.contains('/') || name.chars().count() > 80 {
        return Err("имя навыка — до 80 знаков, без «/»".into());
    }
    if let Some(tool) = tools.iter().find(|tool| !known_tool(tool)) {
        return Err(format!(
            "в шапке навыка инструмент «{tool}», а такого нет: навык не даёт новых \
             инструментов и прав, только описывает, как пользоваться теми, что есть"
        ));
    }
    Ok(Head {
        name,
        description,
        version,
        tools,
    })
}

/// Поднять `version:` в шапке на один (если номер есть).
fn bump_version(body: &str) -> String {
    let mut fences = 0;
    let mut done = false;
    let mut out: Vec<String> = Vec::new();
    for line in body.split('\n') {
        if line.trim() == "---" {
            fences += 1;
        }
        if fences == 1
            && !done
            && let Some(value) = line.trim().strip_prefix("version:")
            && let Ok(number) = unquote(value).parse::<u32>()
        {
            out.push(format!("version: {}", number.saturating_add(1)));
            done = true;
            continue;
        }
        out.push(line.to_owned());
    }
    out.join("\n")
}

/// Что поменялось в строке — только отличающиеся слова: «утром» → «вечером
/// накануне», а не две строки целиком.
pub fn changed_words(old: &str, new: &str) -> (String, String) {
    let a: Vec<&str> = old.split_whitespace().collect();
    let b: Vec<&str> = new.split_whitespace().collect();
    let prefix = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let suffix = a[prefix..]
        .iter()
        .rev()
        .zip(b[prefix..].iter().rev())
        .take_while(|(x, y)| x == y)
        .count();
    let (a, b) = (&a[prefix..a.len() - suffix], &b[prefix..b.len() - suffix]);
    if a.is_empty() || b.is_empty() {
        // Слова только добавились или убрались — показать строки целиком.
        return (old.trim().to_owned(), new.trim().to_owned());
    }
    (a.join(" "), b.join(" "))
}

// ---------------------------------------------------------------- список

/// Навык, как его видят агент и экран «Навыки».
#[derive(Debug, Clone, Serialize)]
pub struct Skill {
    pub id: Uuid,
    pub path: String,
    pub name: String,
    pub description: String,
    pub version: Option<u32>,
    pub tools: Vec<String>,
    pub pinned: bool,
    pub archived: bool,
    pub builtin: bool,
    pub uses: i32,
    /// Последнее использование; не пользовались — когда навык завели.
    #[serde(with = "time::serde::rfc3339")]
    pub last_used: OffsetDateTime,
    /// Когда куратор уберёт его в архив, если им не воспользоваться
    /// (закреплённый и уже в архиве — никогда).
    #[serde(with = "time::serde::rfc3339::option")]
    pub archive_after: Option<OffsetDateTime>,
    pub revision: i64,
}

impl From<&File> for Skill {
    fn from(file: &File) -> Self {
        let head = head(&file.body).unwrap_or_else(|_| Head {
            name: files::display_name(&file.path).to_owned(),
            description: String::new(),
            version: None,
            tools: Vec::new(),
        });
        let last_used = file
            .used_at
            .map_or(file.created_at, |used| used.max(file.created_at));
        Self {
            id: file.id,
            path: file.path.clone(),
            name: head.name,
            description: head.description,
            version: head.version,
            tools: head.tools,
            pinned: file.pinned,
            archived: file.archived,
            builtin: file.builtin.is_some(),
            uses: file.uses,
            last_used,
            archive_after: (!file.pinned && !file.archived)
                .then(|| last_used + time::Duration::days(UNUSED_DAYS)),
            revision: file.revision,
        }
    }
}

/// Все навыки человека (и в архиве), по имени.
pub async fn list(conn: &mut PgConnection, account: Uuid) -> Result<Vec<Skill>> {
    let mut skills: Vec<Skill> = files::list(conn, account)
        .await?
        .iter()
        .filter(|file| file.kind == Kind::Skill)
        .map(Skill::from)
        .collect();
    skills.sort_by_key(|skill| skill.name.to_lowercase());
    Ok(skills)
}

/// Файл навыка по имени (из шапки или имени файла, без регистра); сначала
/// живые, потом из архива.
pub async fn find(conn: &mut PgConnection, account: Uuid, name: &str) -> Result<Option<File>> {
    let wanted = name
        .trim()
        .trim_end_matches(".md")
        .rsplit('/')
        .next()
        .unwrap_or_default()
        .to_lowercase();
    let mut found: Vec<File> = files::list(conn, account)
        .await?
        .into_iter()
        .filter(|file| file.kind == Kind::Skill)
        .filter(|file| {
            files::display_name(&file.path).to_lowercase() == wanted
                || head(&file.body).is_ok_and(|head| head.name.to_lowercase() == wanted)
        })
        .collect();
    found.sort_by_key(|file| file.archived);
    Ok(found.into_iter().next())
}

/// Агент воспользовался навыком: открыл его или действовал по нему.
pub(crate) async fn mark_used(conn: &mut PgConnection, account: Uuid, id: Uuid) -> Result<()> {
    sqlx::query(
        "UPDATE agent_files SET used_at = now(), uses = uses + 1 \
         WHERE object_id = $1 AND account_id = $2 AND kind = 'skill' AND NOT archived",
    )
    .bind(id)
    .bind(account)
    .execute(conn)
    .await?;
    Ok(())
}

/// Строка списка для модели: имя и описание (целиком — `skill.view`).
pub fn prompt_list(skills: &[Skill]) -> String {
    skills
        .iter()
        .filter(|skill| !skill.archived)
        .map(|skill| {
            let pin = if skill.pinned {
                " (закреплён)"
            } else {
                ""
            };
            format!("- {}{pin} — {}", skill.name, skill.description)
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Завести встроенные навыки, которых у человека ещё не было (в транзакции
/// `memory::ensure_base`; в ленту не пишется — это наша основа, как «Кто я»).
pub(crate) async fn ensure_builtin(
    conn: &mut PgConnection,
    account: Uuid,
    rules: &qubite_sync_server::Rules,
) -> Result<()> {
    for builtin in BUILTIN {
        let had: bool = sqlx::query_scalar(
            "SELECT EXISTS (SELECT 1 FROM agent_files WHERE account_id = $1 AND builtin = $2)",
        )
        .bind(account)
        .bind(builtin.key)
        .fetch_one(&mut *conn)
        .await?;
        let path = builtin.path();
        if had || files::by_path(conn, account, &path).await?.is_some() {
            continue;
        }
        let op = qubite_sync::Operation {
            op_id: Uuid::now_v7(),
            object_id: Uuid::now_v7(),
            base_revision: None,
            kind: OpKind::Create {
                object_type: files::FILE_TYPE.into(),
                title: path.clone(),
                fields: Some(json!({ "path": path, "body": builtin.body, "builtin": builtin.key })),
            },
        };
        qubite_sync_server::apply_in(conn, account, account, &op, rules).await?;
    }
    Ok(())
}

// ---------------------------------------------------------------- инструменты

fn args<T: for<'de> Deserialize<'de>>(tool: &str, value: Value) -> Result<T> {
    serde_json::from_value(value).map_err(|error| Error::Invalid(format!("{tool}: {error}")))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListArgs {
    /// `true` — навыки в архиве.
    #[serde(default)]
    archived: bool,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NameArg {
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CreateArgs {
    name: String,
    #[serde(default)]
    description: String,
    /// Разделы «Когда», «Как», … (или весь SKILL.md с шапкой).
    #[serde(default)]
    body: String,
    #[serde(default)]
    tools: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchArgs {
    name: String,
    old: String,
    #[serde(default)]
    new: String,
}

fn skill_name(file: &File) -> String {
    head(&file.body).map_or_else(
        |_| files::display_name(&file.path).to_owned(),
        |head| head.name,
    )
}

fn day(at: OffsetDateTime) -> String {
    format!("{:02}.{:02}", at.day(), u8::from(at.month()))
}

async fn existing(conn: &mut PgConnection, account: Uuid, name: &str) -> Result<File> {
    find(conn, account, name).await?.ok_or_else(|| {
        Error::Invalid(format!(
            "нет навыка «{}» — посмотри skill.list или заведи skill.create",
            name.trim()
        ))
    })
}

fn need_reason(reason: Option<&str>, what: &str) -> Result<()> {
    if reason.is_none_or(|reason| reason.trim().is_empty()) {
        return Err(Error::Invalid(format!("{what}: нужна причина (why)")));
    }
    Ok(())
}

/// Читающие инструменты навыков.
pub(crate) async fn read(
    conn: &mut PgConnection,
    account: Uuid,
    tool: &str,
    arguments: Value,
) -> Result<Value> {
    match tool {
        "skill.list" => {
            let ListArgs { archived } = args(tool, arguments)?;
            let skills = list(conn, account).await?;
            Ok(Value::Array(
                skills
                    .iter()
                    .filter(|skill| skill.archived == archived)
                    .map(|skill| {
                        json!({
                            "name": skill.name,
                            "description": skill.description,
                            "pinned": skill.pinned,
                            "uses": skill.uses,
                            "last_used": day(skill.last_used),
                        })
                    })
                    .collect(),
            ))
        }
        "skill.view" => {
            let NameArg { name } = args(tool, arguments)?;
            let file = existing(conn, account, &name).await?;
            if !file.archived {
                mark_used(conn, account, file.id).await?;
            }
            Ok(json!({
                "name": skill_name(&file),
                "path": file.path,
                "archived": file.archived,
                "text": file.body,
            }))
        }
        other => Err(Error::Invalid(format!("нет инструмента {other}"))),
    }
}

/// Меняющие инструменты навыков: фраза для ленты и шаги.
pub(crate) async fn plan(
    conn: &mut PgConnection,
    account: Uuid,
    tool: &str,
    arguments: Value,
    reason: Option<&str>,
) -> Result<(String, Vec<Step>)> {
    match tool {
        "skill.create" => {
            let CreateArgs {
                name,
                description,
                body,
                tools,
            } = args(tool, arguments)?;
            need_reason(
                reason,
                "новый навык — после поправки, удачного многошагового дела или трёх повторов",
            )?;
            let name = name.trim().to_owned();
            let text = if body.trim_start().starts_with("---") {
                body
            } else {
                let tools = if tools.is_empty() {
                    String::new()
                } else {
                    format!("tools: [{}]\n", tools.join(", "))
                };
                format!(
                    "---\nname: {name}\ndescription: {}\nversion: 1\n{tools}---\n{}\n",
                    description.split_whitespace().collect::<Vec<_>>().join(" "),
                    body.trim()
                )
            };
            let parsed = head(&text).map_err(Error::Invalid)?;
            if parsed.name.to_lowercase() != name.to_lowercase() {
                return Err(Error::Invalid(format!(
                    "в шапке name «{}», а навык — «{name}»",
                    parsed.name
                )));
            }
            if find(conn, account, &name).await?.is_some() {
                return Err(Error::Invalid(format!(
                    "навык «{name}» уже есть — уточни его skill.patch"
                )));
            }
            let path = files::normalize_path(&format!("{}/{name}", files::SKILLS_DIR))
                .map_err(Error::Invalid)?;
            let (text, _) = files::prepare(&path, Kind::Skill, &text).map_err(Error::Invalid)?;
            Ok((
                format!("Завёл навык «{name}»: {}", quote(&parsed.description, 160)),
                vec![Step {
                    object_id: Uuid::now_v7(),
                    kind: OpKind::Create {
                        object_type: files::FILE_TYPE.into(),
                        title: path.clone(),
                        fields: Some(json!({ "path": path, "body": text })),
                    },
                }],
            ))
        }
        "skill.patch" => {
            let PatchArgs { name, old, new } = args(tool, arguments)?;
            need_reason(reason, "уточнение навыка")?;
            let file = existing(conn, account, &name).await?;
            if old.trim().is_empty() {
                return Err(Error::Invalid("что заменить (old) — не пусто".into()));
            }
            if old.contains('\n') || new.contains('\n') {
                return Err(Error::Invalid(
                    "навык уточняется одной строкой: old и new — без переносов строк. \
                     Переписать навык целиком может только владелец («Править»)"
                        .into(),
                ));
            }
            let found = file.body.matches(old.as_str()).count();
            let skill = skill_name(&file);
            if found == 0 {
                return Err(Error::Invalid(format!(
                    "в навыке «{skill}» нет такого текста — открой его skill.view"
                )));
            }
            if found > 1 {
                return Err(Error::Invalid(format!(
                    "этот текст встречается в навыке «{skill}» {found} раза — возьми кусок длиннее"
                )));
            }
            let line = file
                .body
                .lines()
                .find(|line| line.contains(old.as_str()))
                .unwrap_or_default();
            if line.trim_start().starts_with("name:") || line.trim_start().starts_with("version:") {
                return Err(Error::Invalid(
                    "имя и версию навыка не меняют — версия растёт сама".into(),
                ));
            }
            let body = bump_version(&file.body.replacen(&old, &new, 1));
            let (body, _) =
                files::prepare(&file.path, Kind::Skill, &body).map_err(Error::Invalid)?;
            let new = files::redact(&new).0;
            let what = if new.trim().is_empty() {
                format!("− «{}»", quote(&old, 100))
            } else {
                let (was, now) = changed_words(&old, &new);
                format!("«{}» → «{}»", quote(&was, 80), quote(&now, 80))
            };
            Ok((
                format!("Навык «{skill}»: {what}"),
                vec![Step {
                    object_id: file.id,
                    kind: OpKind::Patch {
                        fields: json!({ "body": body }),
                    },
                }],
            ))
        }
        "skill.archive" => {
            let NameArg { name } = args(tool, arguments)?;
            let file = existing(conn, account, &name).await?;
            let skill = skill_name(&file);
            if file.pinned {
                return Err(Error::Invalid(format!(
                    "навык «{skill}» закреплён владельцем — его не убирают"
                )));
            }
            if file.archived {
                return Err(Error::Invalid(format!("навык «{skill}» уже в архиве")));
            }
            Ok((
                format!("Убрал в архив навык «{skill}»"),
                vec![Step {
                    object_id: file.id,
                    kind: OpKind::Patch {
                        fields: json!({ "archived": true }),
                    },
                }],
            ))
        }
        other => Err(Error::Invalid(format!("нет инструмента {other}"))),
    }
}

// ---------------------------------------------------------------- владелец

/// Что владелец делает с навыком на экране «Навыки».
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OwnerChange {
    Pin(bool),
    Archive,
    Restore,
}

/// Закрепить / открепить, убрать в архив, вернуть из архива — строка ленты
/// владельца (откатывается, как любая).
pub async fn owner_set(
    pool: &PgPool,
    who: &Who,
    file_id: Uuid,
    change: OwnerChange,
) -> Result<Action> {
    if who.actor() != Actor::Owner {
        return Err(Error::NeedsOwner("это делает человек".into()));
    }
    let mut conn = pool.acquire().await?;
    let file = files::by_id(&mut conn, who.account(), file_id)
        .await?
        .filter(|file| file.kind == Kind::Skill)
        .ok_or(Error::NotFound)?;
    drop(conn);
    let skill = skill_name(&file);
    let (tool, summary, fields) = match change {
        OwnerChange::Pin(true) if !file.pinned => (
            "skill.pin",
            format!("Закрепил навык «{skill}»"),
            json!({ "pinned": true }),
        ),
        OwnerChange::Pin(false) if file.pinned => (
            "skill.pin",
            format!("Открепил навык «{skill}»"),
            json!({ "pinned": false }),
        ),
        OwnerChange::Archive if !file.archived => (
            "skill.archive",
            format!("Убрал в архив навык «{skill}»"),
            json!({ "archived": true }),
        ),
        OwnerChange::Restore if file.archived => (
            "skill.restore",
            format!("Вернул из архива навык «{skill}»"),
            json!({ "archived": false }),
        ),
        _ => return Err(Error::Invalid("ничего не изменилось".into())),
    };
    let plan = Plan {
        tool: tool.into(),
        summary,
        reason: None,
        batch: Uuid::now_v7(),
        reverts: None,
        corrects: None,
        steps: vec![Step {
            object_id: file.id,
            kind: OpKind::Patch { fields },
        }],
    };
    timeline::execute(pool, who, plan).await
}

// ---------------------------------------------------------------- куратор

/// Куратор одного человека: навыки, которыми не пользовались [`UNUSED_DAYS`]
/// дней (на момент `now`), — в архив, одним пакетом в ленте. Закреплённые и
/// уже убранные не трогает. Нет агента — ничего не делает.
pub async fn curate(pool: &PgPool, account: Uuid, now: OffsetDateTime) -> Result<Vec<Action>> {
    let who = Who::system(account);
    let mut tx = pool.begin().await?;
    timeline::lock(&mut tx, account).await?;
    match timeline::check_agent(&mut tx, &who).await {
        Ok(()) => {}
        Err(Error::Denied(_)) => return Ok(Vec::new()),
        Err(error) => return Err(error),
    }
    let stale: Vec<Skill> = list(&mut tx, account)
        .await?
        .into_iter()
        .filter(|skill| skill.archive_after.is_some_and(|after| after <= now))
        .collect();
    let batch = Uuid::now_v7();
    let mut done = Vec::with_capacity(stale.len());
    for skill in stale {
        let plan = Plan {
            tool: "skill.curate".into(),
            summary: format!(
                "Куратор: убрал в архив навык «{}» — не пользовался {UNUSED_DAYS} дней",
                skill.name
            ),
            reason: Some(format!(
                "последний раз — {}; вернуть — «Вернуть из архива» в «Навыках» или «Откатить»",
                day(skill.last_used)
            )),
            batch,
            reverts: None,
            corrects: None,
            steps: vec![Step {
                object_id: skill.id,
                kind: OpKind::Patch {
                    fields: json!({ "archived": true }),
                },
            }],
        };
        done.push(timeline::execute_in(&mut tx, &who, plan).await?);
    }
    tx.commit().await?;
    Ok(done)
}

/// Куратор всех, у кого есть живые незакреплённые навыки. Возвращает, сколько
/// навыков ушло в архив.
pub async fn curate_all(pool: &PgPool, now: OffsetDateTime) -> Result<usize> {
    let accounts: Vec<Uuid> = sqlx::query_scalar(
        "SELECT DISTINCT f.account_id FROM agent_files f JOIN objects o ON o.id = f.object_id \
         WHERE f.kind = 'skill' AND NOT f.archived AND NOT f.pinned AND o.deleted_at IS NULL",
    )
    .fetch_all(pool)
    .await?;
    let mut archived = 0;
    for account in accounts {
        archived += curate(pool, account, now).await?.len();
    }
    Ok(archived)
}

/// Поставить куратора в очередь на `at`. Ключ — неделя запуска: перезапуск
/// сервера на той же неделе второго куратора не ставит.
pub async fn schedule_curator(pool: &PgPool, at: OffsetDateTime) -> Result<()> {
    let (year, week, _) = at.to_iso_week_date();
    qubite_jobs::enqueue(
        pool,
        qubite_jobs::NewJob::new(CURATE_JOB, json!({}))
            .idempotency_key(format!("{CURATE_JOB}:{year}-W{week:02}"))
            .run_at(at)
            .max_attempts(3),
    )
    .await
    .map_err(|error| Error::Invalid(error.to_string()))?;
    Ok(())
}

/// Поставить «научиться на поправке» (в транзакции поправки).
pub(crate) async fn schedule_learn(
    conn: &mut PgConnection,
    account: Uuid,
    correction: Uuid,
) -> Result<()> {
    qubite_jobs::enqueue_in(
        conn,
        qubite_jobs::NewJob::new(
            LEARN_JOB,
            json!({ "account_id": account, "action_id": correction }),
        )
        .idempotency_key(format!("{LEARN_JOB}:{correction}"))
        .max_attempts(2),
    )
    .await
    .map_err(|error| Error::Invalid(error.to_string()))?;
    Ok(())
}

// ---------------------------------------------------------------- поводы

/// Форма действия без подробностей: «Создал дело «…»: в «…», срок .» — по
/// ней видно, что одно и то же повторилось.
fn shape(summary: &str) -> String {
    let mut out = String::new();
    let mut quoted = 0;
    for c in summary.chars() {
        match c {
            '«' => {
                if quoted == 0 {
                    out.push_str("«…»");
                }
                quoted += 1;
            }
            '»' => quoted = (quoted - 1).max(0),
            _ if quoted > 0 => {}
            c if c.is_ascii_digit() => {}
            c => out.push(c),
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Инструменты «дел» — по их повторам и пакетам агент учится навыкам
/// (память, вопросы и сами навыки — нет).
fn is_work(tool: &str) -> bool {
    ![
        "memory.",
        "files.",
        "question.",
        "skill.",
        "home.",
        "timeline.",
    ]
    .iter()
    .any(|prefix| tool.starts_with(prefix))
}

/// Удачные многошаговые дела этих пробуждений: пакет из 3+ действий, ни одно
/// не откачено, не по навыку.
pub(crate) async fn multistep(
    conn: &mut PgConnection,
    account: Uuid,
    runs: &[Uuid],
) -> Result<Vec<String>> {
    if runs.is_empty() {
        return Ok(Vec::new());
    }
    let rows: Vec<(Uuid, Uuid, String, String, bool)> = sqlx::query_as(
        "SELECT batch_id, id, tool, summary, skill_id IS NOT NULL FROM agent_actions \
         WHERE account_id = $1 AND run_id = ANY($2) AND actor = 'agent' ORDER BY seq",
    )
    .bind(account)
    .bind(runs)
    .fetch_all(&mut *conn)
    .await?;
    let links = timeline::Links::load(conn, account).await?;
    let mut batches: Vec<(Uuid, Vec<String>, bool)> = Vec::new();
    for (batch, id, tool, summary, by_skill) in rows {
        let ok = links.reverted_by(id).is_none() && !by_skill;
        match batches.iter_mut().find(|(b, ..)| *b == batch) {
            Some(entry) => {
                entry.2 &= ok;
                if is_work(&tool) {
                    entry.1.push(summary);
                }
            }
            None => batches.push((
                batch,
                if is_work(&tool) {
                    vec![summary]
                } else {
                    Vec::new()
                },
                ok,
            )),
        }
    }
    Ok(batches
        .into_iter()
        .filter(|(_, steps, ok)| *ok && steps.len() >= 3)
        .map(|(_, steps, _)| steps.join(" → "))
        .collect())
}

/// Что агент делал одинаково 3 раза и больше за 30 дней без навыка.
pub(crate) async fn repeats(conn: &mut PgConnection, account: Uuid) -> Result<Vec<String>> {
    let rows: Vec<(Uuid, String, String)> = sqlx::query_as(
        "SELECT id, tool, summary FROM agent_actions WHERE account_id = $1 AND actor = 'agent' \
         AND skill_id IS NULL AND reverts IS NULL AND at > now() - interval '30 days' \
         ORDER BY seq DESC LIMIT 500",
    )
    .bind(account)
    .fetch_all(&mut *conn)
    .await?;
    let links = timeline::Links::load(conn, account).await?;
    let mut groups: Vec<(String, Vec<String>)> = Vec::new();
    for (id, tool, summary) in rows {
        if !is_work(&tool) || links.reverted_by(id).is_some() {
            continue;
        }
        let key = format!("{tool}: {}", shape(&summary));
        match groups.iter_mut().find(|(k, _)| *k == key) {
            Some((_, examples)) => examples.push(summary),
            None => groups.push((key, vec![summary])),
        }
    }
    let mut found: Vec<(String, Vec<String>)> = groups
        .into_iter()
        .filter(|(_, examples)| examples.len() >= 3)
        .collect();
    found.sort_by_key(|(_, examples)| std::cmp::Reverse(examples.len()));
    Ok(found
        .into_iter()
        .take(5)
        .map(|(_, examples)| {
            format!(
                "{} раза: {}",
                examples.len(),
                examples
                    .iter()
                    .take(3)
                    .map(|e| format!("«{}»", quote(e, 100)))
                    .collect::<Vec<_>>()
                    .join("; ")
            )
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtin_skills_are_valid_and_give_no_new_tools() {
        let mut names = Vec::new();
        for builtin in BUILTIN {
            let head = head(builtin.body).unwrap_or_else(|e| panic!("{}: {e}", builtin.key));
            assert_eq!(head.version, Some(1), "{}", builtin.key);
            assert!(!head.tools.is_empty(), "{}: tools", builtin.key);
            assert!(head.tools.iter().all(|tool| known_tool(tool)));
            for section in [
                "## Когда",
                "## Как\n",
                "## Подводные камни",
                "## Как проверить",
            ] {
                assert!(
                    builtin.body.contains(section),
                    "{}: нет «{section}»",
                    builtin.key
                );
            }
            let path = builtin.path();
            assert_eq!(files::kind_of(&path), Kind::Skill);
            assert_eq!(files::normalize_path(&path).unwrap(), path);
            files::prepare(&path, Kind::Skill, builtin.body).unwrap();
            assert_eq!(files::redact(builtin.body).1, 0, "{}: секрет", builtin.key);
            names.push(head.name.to_lowercase());
        }
        names.dedup();
        assert_eq!(names.len(), BUILTIN.len(), "имена разные");
    }

    #[test]
    fn header_tools_and_version() {
        let text = "---\nname: ДЗ\ndescription: как ставить ДЗ\nversion: 3\ntools:\n  - task.create\n  - files.read\n---\n# Как\n- утром\n";
        let parsed = head(text).unwrap();
        assert_eq!(parsed.tools, ["task.create", "files.read"]);
        assert_eq!(parsed.version, Some(3));
        assert!(bump_version(text).contains("version: 4\n"));
        assert!(bump_version(text).ends_with("- утром\n"));
        let err = head("---\nname: А\ndescription: б\ntools: [shell.run]\n---\n").unwrap_err();
        assert!(err.contains("не даёт новых"), "{err}");
        assert!(head("---\nname: А\n---\n").is_err());
    }

    #[test]
    fn words_that_changed() {
        assert_eq!(
            changed_words(
                "4. Сделать — утром в день урока.",
                "4. Сделать — вечером накануне урока."
            ),
            ("утром в день".to_owned(), "вечером накануне".to_owned())
        );
        assert_eq!(
            changed_words("утром", "утром и днём"),
            ("утром".to_owned(), "утром и днём".to_owned())
        );
    }

    #[test]
    fn repeated_shape() {
        assert_eq!(
            shape("Создал дело «Упр. 145»: в «Русский», срок 23.10"),
            shape("Создал дело «Упр. 12 «б»»: в «Русский», срок 30.10")
        );
        assert!(is_work("task.create") && !is_work("memory.add"));
    }
}
