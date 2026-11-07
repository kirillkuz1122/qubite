//! Личный ключ распознавания: доступ только к своей записи и с Write inbox.

use std::{sync::Arc, time::Duration};

use axum::{Json, extract::State, http::StatusCode};
use qubite_ai::{
    VoiceProvider,
    openai_voice::{self, OpenAiVoice},
    voice::SttCall,
};
use qubite_kernel::Secret;
use qubite_policy::Write;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    modules::authorize,
};

/// Сам ключ никогда не сериализуется и не попадает в Debug.
#[derive(Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct VoiceKeyInput {
    #[schema(min_length = 16, max_length = 4096, write_only)]
    api_key: String,
    #[schema(max_length = 2048)]
    base_url: Option<String>,
    #[schema(max_length = 256)]
    model: Option<String>,
}

/// Только безопасные сведения; без настройки все поля кроме configured — null.
#[derive(Serialize, ToSchema)]
pub struct VoiceKey {
    configured: bool,
    base_url: Option<String>,
    model: Option<String>,
    last4: Option<String>,
}

fn invalid(message: impl Into<String>) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "invalid", message)
}

fn db_error(_: sqlx::Error) -> ApiError {
    // Ошибки ограничений PostgreSQL могут содержать целую строку с секретом.
    tracing::error!("Личный ключ распознавания: ошибка базы");
    ApiError::internal()
}

fn secrets(state: &AppState) -> Result<&qubite_ai::secret::SecretBox, ApiError> {
    state.ai_panel.secrets.as_deref().ok_or_else(|| {
        ApiError::new(
            StatusCode::CONFLICT,
            "secret_key_not_set",
            "Сервер пока не настроен для безопасного хранения ключей",
        )
    })
}

fn key_parts(input: &VoiceKeyInput) -> Result<(&str, String, &str), ApiError> {
    let key = input.api_key.trim();
    if !(16..=4096).contains(&key.len()) || !key.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(invalid("Ключ API: от 16 до 4096 символов без пробелов"));
    }
    let model = input.model.as_deref().unwrap_or(openai_voice::DEFAULT_MODEL);
    if model.is_empty() || model.len() > 256 || !model.bytes().all(|b| b.is_ascii_graphic()) {
        return Err(invalid("Модель: от 1 до 256 символов без пробелов"));
    }
    let url = qubite_net::public_https::parse(
        input.base_url.as_deref().unwrap_or(openai_voice::DEFAULT_BASE_URL),
    )
    .map_err(invalid)?;
    let base = url.as_str().trim_end_matches('/').to_owned();
    Ok((key, base, model))
}

#[utoipa::path(get, path = "/api/v1/voice/key", tag = "inbox",
    responses(
        (status = 200, description = "Сведения о ключе без самого ключа", body = VoiceKey),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет права записи", body = ApiErrorBody),
    ))]
pub async fn get_key(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<VoiceKey>, ApiError> {
    let proof = authorize::<Write>(&state, &session, qubite_inbox::MODULE).await?;
    let row: Option<(String, String, String)> = sqlx::query_as(
        "SELECT base_url, model, key_last4 FROM voice_keys WHERE account_id = $1",
    )
    .bind(proof.account_id())
    .fetch_optional(state.db.pool())
    .await
    .map_err(db_error)?;
    Ok(Json(match row {
        Some((base, model, hint)) => VoiceKey {
            configured: true,
            base_url: Some(base),
            model: Some(model),
            last4: Some(hint),
        },
        None => VoiceKey {
            configured: false,
            base_url: None,
            model: None,
            last4: None,
        },
    }))
}

#[utoipa::path(put, path = "/api/v1/voice/key", tag = "inbox", request_body = VoiceKeyInput,
    responses(
        (status = 200, description = "Ключ зашифрован и сохранён", body = VoiceKey),
        (status = 400, description = "Неверный ключ, модель или адрес", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет права записи", body = ApiErrorBody),
        (status = 409, description = "Хранение секретов не настроено", body = ApiErrorBody),
    ))]
pub async fn set_key(
    State(state): State<AppState>,
    session: Authenticated,
    input: Result<Json<VoiceKeyInput>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<VoiceKey>, ApiError> {
    let proof = authorize::<Write>(&state, &session, qubite_inbox::MODULE).await?;
    let Json(input) =
        input.map_err(|_| invalid("Неверные данные ключа или слишком большой запрос"))?;
    let (key, base, model) = key_parts(&input)?;
    let secret = secrets(&state)?;
    let url = qubite_net::public_https::parse(&base).map_err(invalid)?;
    // Проверка DNS без отправки ключа или пробного платного запроса.
    let _ = qubite_net::public_https::client(&url).await.map_err(invalid)?;
    let sealed = secret.seal(openai_voice::KEY_PURPOSE, key);
    let hint = key[key.len() - 4..].to_owned();
    sqlx::query(
        "INSERT INTO voice_keys (account_id, base_url, model, key_sealed, key_last4) \
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (account_id) DO UPDATE SET \
         base_url = EXCLUDED.base_url, model = EXCLUDED.model, key_sealed = EXCLUDED.key_sealed, \
         key_last4 = EXCLUDED.key_last4, updated_at = now()",
    )
    .bind(proof.account_id())
    .bind(&base)
    .bind(model)
    .bind(sealed)
    .bind(&hint)
    .execute(state.db.pool())
    .await
    .map_err(db_error)?;
    Ok(Json(VoiceKey {
        configured: true,
        base_url: Some(base),
        model: Some(model.to_owned()),
        last4: Some(hint),
    }))
}

#[utoipa::path(delete, path = "/api/v1/voice/key", tag = "inbox",
    responses(
        (status = 204, description = "Ключ удалён"),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 403, description = "Нет права записи", body = ApiErrorBody),
    ))]
pub async fn delete_key(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<StatusCode, ApiError> {
    let proof = authorize::<Write>(&state, &session, qubite_inbox::MODULE).await?;
    sqlx::query("DELETE FROM voice_keys WHERE account_id = $1")
        .bind(proof.account_id())
        .execute(state.db.pool())
        .await
        .map_err(db_error)?;
    Ok(StatusCode::NO_CONTENT)
}

/// Вызывается после проверки Write, сохранения blob и блокировки ID записи.
/// UseAi и лимиты платформы здесь не нужны: ключ и расходы принадлежат человеку.
pub(crate) async fn transcribe(
    state: &AppState,
    owner: Uuid,
    audio: Vec<u8>,
    mime: &str,
) -> Result<String, String> {
    let result = tokio::time::timeout(Duration::from_secs(15), async {
        let row: Option<(String, String, String)> = sqlx::query_as(
            "SELECT base_url, model, key_sealed FROM voice_keys WHERE account_id = $1",
        )
        .bind(owner)
        .fetch_optional(state.db.pool())
        .await
        .map_err(|_| "Не удалось прочитать настройку распознавания".to_owned())?;
        let (base, model, sealed) = row.ok_or_else(|| {
            "Распознавание со своим ключом: добавьте ключ в настройках".to_owned()
        })?;
        let key = secrets(state)
            .map_err(|_| "Сервер пока не настроен для хранения ключей".to_owned())?
            .open(openai_voice::KEY_PURPOSE, &sealed)
            .map_err(|_| {
                "Не удалось прочитать ключ. Сохраните его в настройках ещё раз".to_owned()
            })?;
        let provider = provider(state, &base, Secret::new(key)).await?;
        let heard = provider
            .transcribe(&SttCall {
                external_id: model,
                audio,
                mime: mime.to_owned(),
                language: None,
                account_id: owner,
            })
            .await
            .map_err(|_| {
                "Не удалось распознать речь вашим сервисом. Проверьте ключ, адрес, модель и баланс"
                    .to_owned()
            })?;
        if heard.text.trim().is_empty() || heard.text.chars().count() > qubite_inbox::MAX_BODY_CHARS {
            return Err("Сервис не вернул подходящий текст".into());
        }
        Ok(heard.text)
    })
    .await;
    result
        .unwrap_or_else(|_| Err("Сервис распознавания не ответил за 15 секунд".into()))
        .map_err(|reason| format!("{reason}. Аудиозапись сохранена"))
}

async fn provider(state: &AppState, base: &str, key: Secret) -> Result<Arc<dyn VoiceProvider>, String> {
    #[cfg(test)]
    if let Some(provider) = &state.own_key_voice {
        return Ok(provider.clone());
    }
    let _ = state;
    Ok(Arc::new(OpenAiVoice::new(base, key).await?))
}

#[cfg(test)]
mod tests;
