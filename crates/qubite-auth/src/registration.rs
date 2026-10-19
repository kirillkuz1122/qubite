//! Регистрация (AUTH-003).
//!
//! Режим выбирает owner (D-056): закрыта / по приглашениям (по умолчанию) /
//! открыта. При открытой регистрации без приглашения нужна CAPTCHA — её
//! проверяет HTTP-слой до вызова [`register`]. Новый аккаунт ждёт
//! подтверждения почты и до этого войти не может (D-058); письмо с кодом
//! уходит сразу.
//!
//! Если почта уже занята, ответ тот же, что и при успехе: владельцу почты
//! уходит обычное письмо (подтверждение или восстановление), приглашение не
//! тратится. Так по форме регистрации нельзя узнать, есть ли у человека аккаунт.

use qubite_mail::Mailer;
use sqlx::PgPool;
use uuid::Uuid;

use crate::{
    Error, Passwords, Result,
    accounts::{self, NewAccount},
    consent,
    email::{self, Purpose},
    invitations, normalize_email, password,
    platform::RegistrationMode,
    sessions::ClientInfo,
};
use qubite_objects::{NewAuditEntry, audit};

/// Форма регистрации.
#[derive(Debug, Clone)]
pub struct RegisterInput {
    pub email: String,
    pub password: String,
    pub display_name: String,
    /// Код приглашения (из ссылки или введённый вручную).
    pub invite: Option<String>,
    /// Версия документов, которые человек принял галочкой (D-230).
    pub consent_version: Option<String>,
    pub client: ClientInfo,
}

/// Что получилось. Наружу оба исхода выглядят одинаково.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// Аккаунт создан, письмо с кодом ушло.
    Created(Uuid),
    /// Почта уже занята — владельцу почты ушло обычное письмо.
    AlreadyExists,
}

/// Зарегистрировать аккаунт. CAPTCHA к этому моменту уже проверена.
pub async fn register(
    pool: &PgPool,
    passwords: &Passwords,
    mailer: &Mailer,
    codes: &email::EmailCodes,
    mode: RegistrationMode,
    input: RegisterInput,
) -> Result<Outcome> {
    let invite = input
        .invite
        .as_deref()
        .map(str::trim)
        .filter(|code| !code.is_empty());
    match mode {
        RegistrationMode::Closed => return Err(Error::RegistrationClosed),
        RegistrationMode::InviteOnly if invite.is_none() => return Err(Error::InviteRequired),
        _ => {}
    }
    let consent = consent::check(input.consent_version.as_deref())?;
    let email = normalize_email(&input.email)?;
    let display_name = input.display_name.trim();
    if display_name.chars().count() > 100 {
        return Err(Error::Invalid("имя длиннее 100 символов".into()));
    }
    password::validate(&input.password)?;
    // Argon2 — до транзакции: очередь на хеширование не держит соединение.
    let hash = passwords.hash(&input.password).await?;

    let mut tx = pool.begin().await?;
    let invitation = match invite {
        Some(code) => Some(invitations::lock_usable(&mut tx, code, &email).await?),
        None => None,
    };
    let existing: Option<String> =
        sqlx::query_scalar("SELECT status FROM accounts WHERE email = $1")
            .bind(&email)
            .fetch_optional(&mut *tx)
            .await?;
    if let Some(status) = existing {
        // Приглашение не тратим; человеку с этой почтой — обычное письмо.
        tx.rollback().await?;
        let purpose = match status.as_str() {
            "pending_email" => Some(Purpose::VerifyEmail),
            "active" => Some(Purpose::ResetPassword),
            _ => None,
        };
        if let Some(purpose) = purpose {
            email::request(pool, mailer, codes, purpose, &email, &input.client.ip).await?;
        }
        return Ok(Outcome::AlreadyExists);
    }

    let account = match accounts::insert(
        &mut tx,
        &NewAccount {
            email: &email,
            display_name,
            password: "",
            email_verified: false,
        },
        Some(&hash),
    )
    .await
    {
        Ok(account) => account,
        // Две регистрации одной почты одновременно: вторая — как «уже есть».
        Err(Error::EmailTaken) => {
            tx.rollback().await?;
            return Ok(Outcome::AlreadyExists);
        }
        Err(error) => return Err(error),
    };
    if let Some(invitation) = invitation {
        invitations::mark_used(&mut tx, invitation, account.id).await?;
    }
    consent::record(&mut tx, account.id, consent, "password", &input.client.ip).await?;
    audit::record(
        &mut tx,
        NewAuditEntry {
            actor_id: Some(account.id),
            action: "account.registered".into(),
            target_kind: "account".into(),
            target_id: Some(account.id.to_string()),
            after: Some(serde_json::json!({
                "email": email,
                "invitation": invitation,
                "mode": mode,
                "consent": consent,
                "ip": input.client.ip,
            })),
            ..NewAuditEntry::default()
        },
    )
    .await?;
    let letter = email::issue(
        &mut tx,
        codes,
        Purpose::VerifyEmail,
        account.id,
        &email,
        display_name,
        &input.client.ip,
    )
    .await?;
    tx.commit().await?;
    email::send_in_background(mailer.clone(), letter.to(&email), account.id);
    Ok(Outcome::Created(account.id))
}
