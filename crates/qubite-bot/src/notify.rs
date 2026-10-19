//! Уведомления владельцу: виды, тумблеры, очередь и отправка.
//!
//! Положить уведомление может любой процесс ([`enqueue`]); отправляет бот
//! ([`deliver`]) — в личный чат Telegram, привязанный к аккаунту owner.
//! Каждый вид владелец может выключить; выключенное не отправляется
//! (помечается «пропущено» — видно, что событие было).

use serde::Serialize;
use sqlx::{PgConnection, PgPool};

use crate::{Error, Result, telegram::TelegramApi};

macro_rules! kinds {
    ($($variant:ident = $id:literal, $title:literal;)+) => {
        /// Вид уведомления.
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
        #[serde(rename_all = "snake_case")]
        pub enum Kind { $($variant),+ }

        impl Kind {
            pub const ALL: &[Kind] = &[$(Kind::$variant),+];

            pub fn as_str(self) -> &'static str {
                match self { $(Kind::$variant => $id),+ }
            }

            /// Название для Owner Console.
            pub fn title(self) -> &'static str {
                match self { $(Kind::$variant => $title),+ }
            }
        }

        impl std::str::FromStr for Kind {
            type Err = Error;
            fn from_str(value: &str) -> Result<Self> {
                match value {
                    $($id => Ok(Kind::$variant),)+
                    _ => Err(Error::Invalid(format!("неизвестный вид уведомлений: {value}"))),
                }
            }
        }
    };
}

kinds! {
    NewDeviceLogin = "new_device_login", "Вход в аккаунт owner с нового устройства";
    PasswordChanged = "password_changed", "Смена или сброс пароля owner";
    SessionsRevoked = "sessions_revoked", "«Выйти везде» в аккаунте owner";
    TokenReuse = "token_reuse", "Повтор украденного токена приложения owner";
    LoginMethodChanged = "login_method_changed", "Привязка или отвязка входа через провайдера у owner";
    PlatformChanged = "platform_changed", "Изменены настройки платформы (регистрация, CAPTCHA, AI без лимита)";
    Registration = "registration", "Новая регистрация";
    InvitationAccepted = "invitation_accepted", "Принято приглашение";
    AiBudget80 = "ai_budget_80", "Расход AI достиг 80 % лимита";
    AiBudget100 = "ai_budget_100", "Расход AI достиг 100 % лимита";
    ServerDown = "server_down", "Сервер не отвечает (и снова заработал)";
    ServerErrors = "server_errors", "Ошибки сервера";
    BackupFailed = "backup_failed", "Бэкап не прошёл";
    DiskLow = "disk_low", "Кончается место на диске";
}

/// Положить уведомление в очередь. С тем же `dedup_key` — только один раз.
/// Возвращает `false`, если такое уже было.
pub async fn enqueue(
    conn: &mut PgConnection,
    kind: Kind,
    text: &str,
    dedup_key: Option<&str>,
) -> Result<bool> {
    let text: String = text.chars().take(3900).collect();
    let inserted = sqlx::query(
        "INSERT INTO owner_notifications (kind, text, dedup_key) VALUES ($1, $2, $3) \
         ON CONFLICT (dedup_key) DO NOTHING",
    )
    .bind(kind.as_str())
    .bind(if text.trim().is_empty() {
        kind.title().to_owned()
    } else {
        text
    })
    .bind(dedup_key)
    .execute(conn)
    .await?
    .rows_affected();
    Ok(inserted > 0)
}

/// Вид и включён ли он.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Setting {
    pub kind: Kind,
    pub title: &'static str,
    pub enabled: bool,
}

pub async fn settings(pool: &PgPool) -> Result<Vec<Setting>> {
    let off: Vec<String> =
        sqlx::query_scalar("SELECT kind FROM owner_notification_settings WHERE NOT enabled")
            .fetch_all(pool)
            .await?;
    Ok(Kind::ALL
        .iter()
        .map(|kind| Setting {
            kind: *kind,
            title: kind.title(),
            enabled: !off.iter().any(|id| id == kind.as_str()),
        })
        .collect())
}

pub async fn set_enabled(pool: &PgPool, kind: Kind, enabled: bool) -> Result<()> {
    sqlx::query(
        "INSERT INTO owner_notification_settings (kind, enabled) VALUES ($1, $2) \
         ON CONFLICT (kind) DO UPDATE SET enabled = $2, updated_at = now()",
    )
    .bind(kind.as_str())
    .bind(enabled)
    .execute(pool)
    .await?;
    Ok(())
}

/// Личный чат owner: его Telegram, привязанный в профиле (`oauth_identities`).
/// В личном чате ID чата совпадает с ID человека.
pub async fn owner_chat(pool: &PgPool) -> Result<Option<i64>> {
    let subject: Option<String> = sqlx::query_scalar(
        "SELECT i.subject FROM oauth_identities i JOIN platform_owner o ON o.account_id = i.account_id \
         WHERE i.provider = 'telegram'",
    )
    .fetch_optional(pool)
    .await?;
    Ok(subject.and_then(|id| id.parse().ok()))
}

const MAX_ATTEMPTS: i32 = 5;

/// Отправить накопившееся. Без привязанного Telegram у owner — ждут.
/// Возвращает, сколько отправлено.
pub async fn deliver(pool: &PgPool, api: &TelegramApi) -> Result<usize> {
    let Some(chat) = owner_chat(pool).await? else {
        return Ok(0);
    };
    let pending: Vec<(i64, String, String, bool)> = sqlx::query_as(
        "SELECT n.id, n.kind, n.text, coalesce(s.enabled, true) \
         FROM owner_notifications n LEFT JOIN owner_notification_settings s ON s.kind = n.kind \
         WHERE n.sent_at IS NULL AND n.attempts < $1 ORDER BY n.id LIMIT 50",
    )
    .bind(MAX_ATTEMPTS)
    .fetch_all(pool)
    .await?;
    let mut sent = 0;
    for (id, _kind, text, enabled) in pending {
        if !enabled {
            sqlx::query(
                "UPDATE owner_notifications SET sent_at = now(), skipped = true WHERE id = $1",
            )
            .bind(id)
            .execute(pool)
            .await?;
            continue;
        }
        match api.send(chat, &text).await {
            Ok(()) => {
                sqlx::query("UPDATE owner_notifications SET sent_at = now() WHERE id = $1")
                    .bind(id)
                    .execute(pool)
                    .await?;
                sent += 1;
            }
            Err(error) => {
                tracing::warn!(%error, "уведомление не отправлено");
                sqlx::query(
                    "UPDATE owner_notifications SET attempts = attempts + 1, last_error = $2 WHERE id = $1",
                )
                .bind(id)
                .bind(error.to_string())
                .execute(pool)
                .await?;
                // Telegram недоступен — остальные попробуем в следующий раз.
                break;
            }
        }
    }
    Ok(sent)
}
