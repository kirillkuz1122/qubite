//! «Агент хочет знать» (AGENT §8): вопросы агента человеку.
//!
//! Вопрос — объект ядра `agent.question` (текст — заголовок), поэтому «спросил»
//! и «ответил» — строки ленты с откатом. Агент спрашивает сам, когда для
//! задачи не хватает данных (например, расписания, D-322), и не чаще раза в
//! неделю на один и тот же вопрос — это проверяет сервер, а не модель.

use qubite_objects::Object;
use qubite_sync_server::{BoxFuture, FieldsError, TypeFields};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sqlx::PgConnection;
use time::OffsetDateTime;
use uuid::Uuid;

/// Тип объекта «вопрос агента».
pub const QUESTION_TYPE: &str = "agent.question";
/// Один и тот же вопрос — не чаще раза в неделю.
pub const ASK_AGAIN_DAYS: i64 = 7;
/// Открытых вопросов сразу — не больше (остальное агент копит в памяти).
pub const MAX_OPEN: i64 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Open,
    Answered,
    Dropped,
}

impl Status {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Open => "open",
            Self::Answered => "answered",
            Self::Dropped => "dropped",
        }
    }
}

/// Вопрос, как его видит человек.
#[derive(Debug, Clone, Serialize)]
pub struct Question {
    pub id: Uuid,
    pub text: String,
    pub project_id: Option<Uuid>,
    pub why: String,
    pub options: Vec<String>,
    pub status: Status,
    pub answer: String,
    #[serde(with = "time::serde::rfc3339")]
    pub asked_at: OffsetDateTime,
}

#[derive(sqlx::FromRow)]
struct Row {
    id: Uuid,
    title: String,
    project_id: Option<Uuid>,
    why: String,
    options: Value,
    status: String,
    answer: String,
    created_at: OffsetDateTime,
}

fn convert(row: Row) -> Question {
    Question {
        id: row.id,
        text: row.title,
        project_id: row.project_id,
        why: row.why,
        options: serde_json::from_value(row.options).unwrap_or_default(),
        status: match row.status.as_str() {
            "answered" => Status::Answered,
            "dropped" => Status::Dropped,
            _ => Status::Open,
        },
        answer: row.answer,
        asked_at: row.created_at,
    }
}

const SELECT: &str = "SELECT o.id, o.title, q.project_id, q.why, q.options, q.status, q.answer, \
     o.created_at FROM agent_questions q JOIN objects o ON o.id = q.object_id";

/// Открытые вопросы человека, старые сверху.
pub async fn open(conn: &mut PgConnection, account: Uuid) -> sqlx::Result<Vec<Question>> {
    let rows: Vec<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE q.account_id = $1 AND q.status = 'open' AND o.deleted_at IS NULL \
         ORDER BY o.created_at"
    )))
    .bind(account)
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().map(convert).collect())
}

/// Свой вопрос.
pub async fn get(
    conn: &mut PgConnection,
    account: Uuid,
    id: Uuid,
) -> sqlx::Result<Option<Question>> {
    let rows: Vec<Row> = sqlx::query_as(sqlx::AssertSqlSafe(format!(
        "{SELECT} WHERE q.account_id = $1 AND o.id = $2 AND o.deleted_at IS NULL"
    )))
    .bind(account)
    .bind(id)
    .fetch_all(conn)
    .await?;
    Ok(rows.into_iter().next().map(convert))
}

fn normalize(text: &str) -> String {
    text.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// Можно ли задать этот вопрос сейчас: тот же вопрос не открыт и не
/// задавался последние 7 дней; открытых не больше 10. Ошибка — почему нельзя.
pub async fn may_ask(
    conn: &mut PgConnection,
    account: Uuid,
    text: &str,
) -> sqlx::Result<Result<(), String>> {
    let recent: Vec<(String, String, OffsetDateTime)> = sqlx::query_as(
        "SELECT o.title, q.status, o.created_at FROM agent_questions q \
         JOIN objects o ON o.id = q.object_id \
         WHERE q.account_id = $1 AND o.deleted_at IS NULL \
           AND (q.status = 'open' OR o.created_at > now() - make_interval(days => $2::int))",
    )
    .bind(account)
    .bind(i32::try_from(ASK_AGAIN_DAYS).unwrap_or(7))
    .fetch_all(&mut *conn)
    .await?;
    let wanted = normalize(text);
    if let Some((title, status, _)) = recent.iter().find(|(title, ..)| normalize(title) == wanted) {
        return Ok(Err(if status == "open" {
            format!("этот вопрос уже ждёт ответа: «{title}»")
        } else {
            "этот вопрос уже задавали на этой неделе — не чаще раза в неделю".to_owned()
        }));
    }
    let open = recent
        .iter()
        .filter(|(_, status, _)| status == "open")
        .count();
    if i64::try_from(open).unwrap_or(i64::MAX) >= MAX_OPEN {
        return Ok(Err(format!(
            "уже {open} открытых вопросов — дождись ответов или закрой ненужные"
        )));
    }
    Ok(Ok(()))
}

fn bad(message: impl Into<String>) -> FieldsError {
    FieldsError::Invalid(message.into())
}

#[derive(Deserialize, Default)]
#[serde(deny_unknown_fields)]
struct CreateFields {
    project_id: Option<Uuid>,
    #[serde(default)]
    why: String,
    #[serde(default)]
    options: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PatchFields {
    status: Option<Status>,
    answer: Option<String>,
}

fn check_options(options: &[String]) -> Result<Vec<String>, FieldsError> {
    if options.len() > 6 {
        return Err(bad("вариантов ответа — не больше 6"));
    }
    options
        .iter()
        .map(|option| {
            let option = option.trim();
            if option.is_empty() || option.chars().count() > 60 {
                Err(bad("вариант ответа — от 1 до 60 знаков"))
            } else {
                Ok(option.to_owned())
            }
        })
        .collect()
}

/// Обработчик полей `agent.question`.
pub struct QuestionFieldsHandler;

impl TypeFields for QuestionFieldsHandler {
    fn object_type(&self) -> &'static str {
        QUESTION_TYPE
    }

    fn create<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: Option<&'a Value>,
    ) -> BoxFuture<'a, Result<(), FieldsError>> {
        Box::pin(async move {
            let fields: CreateFields = match fields {
                Some(value) => serde_json::from_value(value.clone())
                    .map_err(|error| bad(format!("поля вопроса: {error}")))?,
                None => CreateFields::default(),
            };
            let text = object.title.trim();
            if text.is_empty() || text.chars().count() > 300 {
                return Err(bad("вопрос — от 1 до 300 знаков"));
            }
            let why = fields.why.trim();
            if why.chars().count() > 300 {
                return Err(bad("«зачем» — до 300 знаков"));
            }
            let options = check_options(&fields.options)?;
            if let Some(project) = fields.project_id {
                let own: Option<Uuid> = sqlx::query_scalar(
                    "SELECT id FROM objects WHERE id = $1 AND owner_id = $2 \
                     AND type = 'planner.project'",
                )
                .bind(project)
                .bind(object.owner_id)
                .fetch_optional(&mut *conn)
                .await?;
                if own.is_none() {
                    return Err(bad("нет такого проекта"));
                }
            }
            sqlx::query(
                "INSERT INTO agent_questions (object_id, account_id, project_id, why, options) \
                 VALUES ($1, $2, $3, $4, $5)",
            )
            .bind(object.id)
            .bind(object.owner_id)
            .bind(fields.project_id)
            .bind(why)
            .bind(json!(options))
            .execute(conn)
            .await?;
            Ok(())
        })
    }

    fn patch<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object: &'a Object,
        fields: &'a Value,
    ) -> BoxFuture<'a, Result<Vec<String>, FieldsError>> {
        Box::pin(async move {
            let fields: PatchFields = serde_json::from_value(fields.clone())
                .map_err(|error| bad(format!("поля вопроса: {error}")))?;
            let (status, answer): (String, String) =
                sqlx::query_as("SELECT status, answer FROM agent_questions WHERE object_id = $1")
                    .bind(object.id)
                    .fetch_one(&mut *conn)
                    .await?;
            let status = fields.status.map_or(status, |s| s.as_str().to_owned());
            let answer = fields.answer.map_or(answer, |a| a.trim().to_owned());
            if answer.chars().count() > 2000 {
                return Err(bad("ответ — до 2000 знаков"));
            }
            if status == "answered" && answer.is_empty() {
                return Err(bad("нужен ответ"));
            }
            sqlx::query(
                "UPDATE agent_questions SET status = $2, answer = $3, \
                 answered_at = CASE WHEN $2 = 'answered' THEN coalesce(answered_at, now()) END \
                 WHERE object_id = $1",
            )
            .bind(object.id)
            .bind(&status)
            .bind(&answer)
            .execute(conn)
            .await?;
            Ok(vec!["status".to_owned(), "answer".to_owned()])
        })
    }

    fn read<'a>(
        &'a self,
        conn: &'a mut PgConnection,
        object_id: Uuid,
    ) -> BoxFuture<'a, Result<Option<Value>, FieldsError>> {
        Box::pin(async move {
            let row: Option<(Option<Uuid>, String, Value, String, String)> = sqlx::query_as(
                "SELECT project_id, why, options, status, answer FROM agent_questions \
                 WHERE object_id = $1",
            )
            .bind(object_id)
            .fetch_optional(conn)
            .await?;
            Ok(row.map(|(project_id, why, options, status, answer)| {
                json!({
                    "project_id": project_id,
                    "why": why,
                    "options": options,
                    "status": status,
                    "answer": answer,
                })
            }))
        })
    }
}
