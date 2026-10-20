//! Сообщения боту → Входящие. Пишет только привязанный человек с правом
//! записи во Входящие; остальным бот вежливо отказывает и ничего не хранит.

use std::{collections::HashSet, time::Duration};

use qubite_inbox::{ITEM_TYPE, MODULE};
use qubite_oauth::{Identity, Provider};
use qubite_objects::{BlobStore, files, objects};
use qubite_policy::{ModuleId, Subject, Write};
use qubite_sync::{OpKind, OpResult, Operation};
use qubite_sync_server::{Registry, Rules};
use serde_json::json;
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    Error, Result,
    telegram::{FileRef, Message, TelegramApi, Update},
};

/// Bot API отдаёт ботам файлы не больше 20 МБ.
pub const MAX_FILE_BYTES: i64 = 20 * 1024 * 1024;

pub const UNKNOWN_SENDER: &str =
    "Это личный бот Qubite. Чтобы присылать мысли, привяжите Telegram в профиле Qubite.";
pub const SAVED: &str = "✓ Во Входящих";

/// Что бот сделал с обновлением.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// Не сообщение человека в личном чате — молча пропущено.
    Ignored,
    /// Неизвестный отправитель или нет права — отказ, ничего не сохранено.
    Rejected,
    /// Telegram привязан к аккаунту по коду из профиля.
    Linked(Uuid),
    /// Сохранено во Входящие (ID элемента).
    Saved(Uuid),
    /// Это сообщение уже было сохранено (Telegram прислал его повторно).
    Duplicate(Uuid),
    /// Выполнена команда owner (`/tech`).
    Command,
    /// Сообщение агенту (AGT-001): ответит `qubite serve` (ID сообщения).
    Agent(Uuid),
}

// ---------------------------------------------------------------- привязка кодом

/// Код для ссылки `t.me/<бот>?start=<код>` из профиля: одноразовый.
pub async fn create_link_code(pool: &PgPool, account_id: Uuid, ttl: Duration) -> Result<String> {
    // Telegram разрешает в start только [A-Za-z0-9_-] до 64 символов.
    let code = qubite_auth::random_token();
    sqlx::query(
        "INSERT INTO telegram_link_codes (code_hash, account_id, expires_at) \
         VALUES ($1, $2, now() + $3::float8 * interval '1 second')",
    )
    .bind(qubite_auth::token_hash(&code))
    .bind(account_id)
    .bind(ttl.as_secs_f64())
    .execute(pool)
    .await?;
    Ok(code)
}

async fn redeem(pool: &PgPool, code: &str, user: &crate::telegram::User) -> Result<Uuid> {
    let account: Option<Uuid> = sqlx::query_scalar(
        "UPDATE telegram_link_codes SET used_at = now() \
         WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING account_id",
    )
    .bind(qubite_auth::token_hash(code))
    .fetch_optional(pool)
    .await?;
    let account =
        account.ok_or_else(|| Error::Invalid("код устарел или уже использован".into()))?;
    qubite_oauth::link(
        pool,
        account,
        None,
        Provider::Telegram,
        &Identity {
            subject: user.id.to_string(),
            email: None,
            display_name: user.first_name.clone(),
        },
    )
    .await?;
    Ok(account)
}

/// Аккаунт, к которому привязан этот Telegram.
pub async fn account_of(pool: &PgPool, telegram_id: i64) -> Result<Option<Uuid>> {
    Ok(sqlx::query_scalar(
        "SELECT i.account_id FROM oauth_identities i JOIN accounts a ON a.id = i.account_id \
         WHERE i.provider = 'telegram' AND i.subject = $1 AND a.status = 'active'",
    )
    .bind(telegram_id.to_string())
    .fetch_optional(pool)
    .await?)
}

// ---------------------------------------------------------------- сообщения

/// Один и тот же ID для одного и того же сообщения: повтор от Telegram не
/// создаёт дубль.
fn stable_id(salt: &str, chat: i64, message: i64) -> Uuid {
    let digest = Sha256::digest(format!("qubite.telegram.{salt}:{chat}:{message}").as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    uuid::Builder::from_custom_bytes(bytes).into_uuid()
}

fn attached(message: &Message) -> Option<(&FileRef, &'static str, String)> {
    if let Some(voice) = &message.voice {
        return Some((voice, "voice", "Голосовое сообщение".into()));
    }
    if let Some(audio) = &message.audio {
        return Some((audio, "voice", "Аудио".into()));
    }
    let named = |file: &FileRef, fallback: &str| {
        file.file_name
            .clone()
            .unwrap_or_else(|| fallback.to_owned())
    };
    if let Some(document) = &message.document {
        return Some((document, "file", named(document, "Файл")));
    }
    if let Some(video) = &message.video {
        return Some((video, "file", named(video, "Видео")));
    }
    message
        .photo
        .iter()
        .max_by_key(|photo| photo.file_size.unwrap_or_default())
        .map(|photo| (photo, "file", "Фото".to_owned()))
}

fn single_url(text: &str) -> Option<String> {
    let text = text.trim();
    let ok = (text.starts_with("https://") || text.starts_with("http://"))
        && !text.chars().any(char::is_whitespace)
        && text.len() <= 2000;
    ok.then(|| text.to_owned())
}

/// Обработать одно обновление Telegram.
pub async fn handle(
    pool: &PgPool,
    api: &TelegramApi,
    blobs: &BlobStore,
    update: &Update,
) -> Result<Outcome> {
    let Some(message) = &update.message else {
        return Ok(Outcome::Ignored);
    };
    let Some(from) = &message.from else {
        return Ok(Outcome::Ignored);
    };
    // Только личный чат с человеком: группы и каналы бот не читает.
    if message.chat.kind != "private" || from.is_bot {
        return Ok(Outcome::Ignored);
    }
    let chat = message.chat.id;
    let text = message
        .text
        .clone()
        .or_else(|| message.caption.clone())
        .unwrap_or_default();

    if let Some(code) = text
        .strip_prefix("/start ")
        .map(str::trim)
        .filter(|c| !c.is_empty())
    {
        return match redeem(pool, code, from).await {
            Ok(account) => {
                api.send(chat, "Telegram привязан к Qubite. Присылайте мысли, ссылки, файлы и голосовые — всё попадёт во Входящие.")
                    .await?;
                Ok(Outcome::Linked(account))
            }
            Err(error) => {
                let reply = match &error {
                    Error::OAuth(qubite_oauth::Error::Taken) => {
                        "Этот Telegram уже привязан к другому аккаунту Qubite."
                    }
                    Error::OAuth(qubite_oauth::Error::AlreadyLinked) => {
                        "К аккаунту уже привязан другой Telegram — сначала отвяжите его в профиле."
                    }
                    _ => {
                        "Код привязки устарел или уже использован. Получите новый в профиле Qubite."
                    }
                };
                api.send(chat, reply).await?;
                Ok(Outcome::Rejected)
            }
        };
    }

    let Some(account) = account_of(pool, from.id).await? else {
        tracing::info!(
            telegram_id = from.id,
            "бот: сообщение от неизвестного отправителя отклонено"
        );
        api.send(chat, UNKNOWN_SENDER).await?;
        return Ok(Outcome::Rejected);
    };
    // Права проверяются при каждом сообщении: отзыв гранта действует сразу.
    let module = ModuleId::new(MODULE).map_err(|error| Error::Invalid(error.to_string()))?;
    if let Err(error) =
        qubite_policy::decide::<Write>(pool, &Subject::account(account, None), &module).await
    {
        let reply = match error {
            qubite_policy::Error::Denied(qubite_policy::DenyReason::PlatformMaintenance) => {
                "Qubite сейчас обновляется — сохранить не получилось. Пришлите, пожалуйста, чуть позже."
            }
            _ => "Нет доступа к Входящим. Его выдаёт владелец Qubite.",
        };
        api.send(chat, reply).await?;
        return Ok(Outcome::Rejected);
    }
    if text.trim() == "/start" {
        api.send(chat, "Готово: присылайте мысли — они попадут во Входящие.")
            .await?;
        return Ok(Outcome::Ignored);
    }

    let file = attached(message);
    if text.trim().is_empty() && file.is_none() {
        api.send(
            chat,
            "Такое пока не сохраняю: пришлите текст, ссылку, файл или голосовое.",
        )
        .await?;
        return Ok(Outcome::Ignored);
    }
    let object_id = stable_id("object", chat, message.message_id);
    {
        let mut conn = pool.acquire().await?;
        if objects::get_any(&mut conn, object_id).await?.is_some() {
            return Ok(Outcome::Duplicate(object_id));
        }
    }
    let url = single_url(&text);
    let body = if text.trim().is_empty() {
        file.as_ref()
            .map(|(_, _, name)| name.clone())
            .unwrap_or_default()
    } else {
        text.clone()
    };
    let mut fields = json!({
        "body": body,
        "source": "telegram",
        "captured_at_ms": message.date.saturating_mul(1000),
    });
    if let Some(url) = &url {
        fields["url"] = json!(url);
    }
    if let Some((_, kind, _)) = &file {
        fields["kind"] = json!(kind);
    }
    let op = Operation {
        op_id: stable_id("op", chat, message.message_id),
        object_id,
        base_revision: None,
        kind: OpKind::Create {
            object_type: ITEM_TYPE.into(),
            title: qubite_inbox::title_from(&body),
            fields: Some(fields),
        },
    };
    let rules = Rules {
        registry: Registry::default().with(qubite_inbox::InboxFields),
        strict: true,
        writable: Some(HashSet::from([MODULE.to_owned()])),
        readable: None,
    };
    match qubite_sync_server::apply_one(pool, account, account, &op, &rules).await? {
        OpResult::Applied { .. } => {}
        other => {
            tracing::warn!(?other, "бот: элемент Входящих не создан");
            api.send(chat, "Не получилось сохранить — попробуйте ещё раз.")
                .await?;
            return Ok(Outcome::Rejected);
        }
    }

    let mut reply = SAVED.to_owned();
    if let Some((file, _, name)) = file {
        match save_file(pool, api, blobs, object_id, account, file, &name).await {
            Ok(()) => {}
            Err(error) => {
                tracing::warn!(%error, "бот: файл не сохранён");
                reply =
                    "✓ Во Входящих, но файл не скачался (Telegram отдаёт ботам файлы до 20 МБ)."
                        .into();
            }
        }
    }
    api.send(chat, &reply).await?;
    Ok(Outcome::Saved(object_id))
}

async fn save_file(
    pool: &PgPool,
    api: &TelegramApi,
    blobs: &BlobStore,
    object_id: Uuid,
    account: Uuid,
    file: &FileRef,
    name: &str,
) -> Result<()> {
    if file.file_size.unwrap_or_default() > MAX_FILE_BYTES {
        return Err(Error::Invalid("файл больше 20 МБ".into()));
    }
    let bytes = api.download(&file.file_id).await?;
    let mime = file
        .mime_type
        .clone()
        .unwrap_or_else(|| "application/octet-stream".into());
    let mut conn = pool.acquire().await?;
    let blob = blobs.put(&mut conn, bytes.as_slice(), &mime).await?;
    let name: String = name.chars().take(200).collect();
    files::attach(&mut conn, object_id, &blob, &name, account).await?;
    Ok(())
}
