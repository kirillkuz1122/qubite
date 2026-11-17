//! «Предложить подузлы» для mind map (DOC-006, D-1008): один короткий вызов AI-шлюза.
//! Права, бюджет, защита от зацикливания и цена — в шлюзе; текст карты — только данные.

use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
};
use qubite_ai::{AiRequest, Untrusted};
use qubite_planner::folder::DOCS_MODULE;
use qubite_policy::{UseAi, Write};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::authorize,
};

/// Задача шлюза: модель выбирает owner в консоли AI, иначе — модель по умолчанию.
pub const TASK: &str = "docs.mindmap";
/// Сколько предложений возвращается.
pub const MAX_SUGGESTIONS: usize = 8;
const MAX_PATH: usize = 12;
const MAX_EXISTING: usize = 50;
const MAX_TEXT: usize = 300;
const MAX_SUGGESTION: usize = 80;

/// Инструкция — только из кода; путь и подузлы идут данными (`untrusted`).
const PROMPT: &str = "Ты помогаешь строить mind map для учёбы. В данных: путь от центральной темы \
к выбранной ветке (последняя строка — сама ветка) и подузлы, которые у неё уже есть. Предложи до \
восьми новых коротких подузлов для этой ветки: каждый с новой строки, без нумерации, маркеров и \
пояснений, не длиннее шести слов. Пиши на языке ветки. Если подузлы — коллокации со словом \
центральной темы и в них стоит «~», ставь «~» вместо этого слова так же. Не повторяй имеющиеся.";

/// Ветка, для которой нужны подузлы.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct SuggestRequest {
    /// ID действия: повтор с тем же ID не выполняется и не списывается второй раз.
    request_id: Uuid,
    /// Подписи от центра до ветки, 1–12 строк до 300 знаков.
    path: Vec<String>,
    /// Подписи подузлов, которые уже есть, до 50.
    #[serde(default)]
    existing: Vec<String>,
}

/// Предложенные подузлы и цена вызова.
#[derive(Debug, Serialize, ToSchema)]
pub struct SuggestResponse {
    suggestions: Vec<String>,
    /// Стоимость вызова, микродоллары.
    cost_usd_micros: i64,
}

fn invalid(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "invalid", message)
}

/// Строки ответа → подузлы: без маркеров и нумерации, без повторов, до 8 штук по 80 знаков.
pub fn parse(text: &str, existing: &[String]) -> Vec<String> {
    let mut seen: Vec<String> = existing.iter().map(|s| s.trim().to_lowercase()).collect();
    let mut out = Vec::new();
    for line in text.lines() {
        let mut item = line.trim();
        item = item
            .trim_start_matches(['-', '*', '•', '–', '—'])
            .trim_start();
        let digits = item.chars().take_while(char::is_ascii_digit).count();
        if digits > 0 && item[digits..].starts_with(['.', ')']) {
            item = item[digits + 1..].trim_start();
        }
        let item = item.trim_matches(['"', '«', '»', '`']).trim();
        if item.is_empty() || item.chars().count() > MAX_SUGGESTION {
            continue;
        }
        let key = item.to_lowercase();
        if seen.contains(&key) {
            continue;
        }
        seen.push(key);
        out.push(item.to_owned());
        if out.len() == MAX_SUGGESTIONS {
            break;
        }
    }
    out
}

/// Предложить подузлы ветки mind map через AI-шлюз.
#[utoipa::path(post, path = "/api/v1/docs/mindmap/suggest", tag = "docs", request_body = SuggestRequest,
    responses(
        (status = 200, description = "Предложения (могут быть пустыми)", body = SuggestResponse),
        (status = 400, description = "Неверный путь или подузлы", body = ApiErrorBody),
        (status = 403, description = "Нет права писать в Docs или пользоваться AI", body = ApiErrorBody),
        (status = 409, description = "Бюджет AI исчерпан, повтор или нет модели", body = ApiErrorBody),
    ))]
pub async fn suggest(
    State(state): State<AppState>,
    session: Authenticated,
    request: Result<Json<SuggestRequest>, JsonRejection>,
) -> Result<Json<SuggestResponse>, ApiError> {
    authorize::<Write>(&state, &session, DOCS_MODULE).await?;
    let auth = authorize::<UseAi>(&state, &session, DOCS_MODULE).await?;
    let Json(request) = request.map_err(|_| invalid("Нужны request_id, path и existing"))?;
    let clean = |items: &[String]| -> Vec<String> {
        items
            .iter()
            .map(|s| s.split_whitespace().collect::<Vec<_>>().join(" "))
            .collect()
    };
    let path = clean(&request.path);
    let existing = clean(&request.existing);
    if path.is_empty() || path.len() > MAX_PATH || path.last().is_some_and(String::is_empty) {
        return Err(invalid("Путь — от 1 до 12 подписей, ветка не пустая"));
    }
    if existing.len() > MAX_EXISTING {
        return Err(invalid("Подузлов — не больше 50"));
    }
    if path
        .iter()
        .chain(&existing)
        .any(|s| s.chars().count() > MAX_TEXT)
    {
        return Err(invalid("Подпись — не длиннее 300 знаков"));
    }
    let data = format!(
        "Путь:\n{}\n\nУже есть:\n{}",
        path.join("\n"),
        if existing.is_empty() {
            "—".to_owned()
        } else {
            existing.join("\n")
        }
    );
    let model = state.ai.model_for(TASK).await?;
    let reply = state
        .ai
        .complete(
            &auth,
            AiRequest {
                request_id: format!("docs.mindmap:{}", request.request_id),
                model,
                prompt: PROMPT.to_owned(),
                untrusted: vec![Untrusted::new("docs.mindmap", data)],
                input_tokens: 600,
                max_output_tokens: 200,
                job_id: None,
            },
        )
        .await?;
    Ok(Json(SuggestResponse {
        suggestions: parse(&reply.text, &existing),
        cost_usd_micros: reply.cost_usd,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_strips_markers_numbers_and_repeats() {
        let text = "1. useful ~\n- valuable ~\n* Useful ~\n«reliable ~»\n\n2) background ~\nвот ещё очень длинная строка, которая точно длиннее восьмидесяти знаков и не нужна в узле карты";
        let got = parse(text, &["background ~".to_owned()]);
        assert_eq!(got, ["useful ~", "valuable ~", "reliable ~"]);
    }

    #[test]
    fn parse_keeps_at_most_eight() {
        let text = (0..20)
            .map(|i| format!("w{i}"))
            .collect::<Vec<_>>()
            .join("\n");
        assert_eq!(parse(&text, &[]).len(), MAX_SUGGESTIONS);
    }
}
