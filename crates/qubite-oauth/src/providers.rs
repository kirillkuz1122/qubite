//! Разговор с провайдерами: адрес входа с PKCE, обмен кода на токен, кто это.

use std::collections::BTreeMap;

use base64::Engine;
use hmac::{Hmac, KeyInit, Mac};
use serde::Deserialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::{Error, Provider, RedirectProvider, Result, TelegramLogin};

/// Кто вошёл, по словам провайдера.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    /// ID у провайдера — по нему и только по нему находим аккаунт.
    pub subject: String,
    /// Почта, если провайдер её дал. Для входа **не используется** (D-060).
    pub email: Option<String>,
    pub display_name: String,
}

/// `code_challenge` для PKCE S256 (RFC 7636).
pub(crate) fn challenge(verifier: &str) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()))
}

pub(crate) fn authorize_url(
    config: &RedirectProvider,
    redirect_uri: &str,
    state: &str,
    verifier: &str,
) -> Result<String> {
    let mut url = reqwest::Url::parse(&config.authorize_url)
        .map_err(|error| Error::Invalid(format!("адрес провайдера: {error}")))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &config.client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", state)
        .append_pair("code_challenge", &challenge(verifier))
        .append_pair("code_challenge_method", "S256")
        .append_pair("scope", &config.scope);
    Ok(url.into())
}

fn provider_error(error: impl std::fmt::Display) -> Error {
    Error::Provider(error.to_string())
}

#[derive(Deserialize)]
struct TokenReply {
    access_token: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

/// Строка или число из JSON как строка (ID у VK и Яндекса).
fn text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) if !text.is_empty() => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

fn field(value: &Value, key: &str) -> Option<String> {
    value.get(key).and_then(text)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn exchange(
    http: &reqwest::Client,
    provider: Provider,
    config: &RedirectProvider,
    redirect_uri: &str,
    code: &str,
    verifier: &str,
    state: &str,
    device_id: Option<&str>,
) -> Result<Identity> {
    let mut form = vec![
        ("grant_type", "authorization_code"),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("client_id", config.client_id.as_str()),
        ("code_verifier", verifier),
    ];
    if !config.client_secret.is_empty() {
        form.push(("client_secret", config.client_secret.as_str()));
    }
    if provider == Provider::Vk {
        form.push(("state", state));
        form.push((
            "device_id",
            device_id.ok_or_else(|| Error::Provider("VK не прислал device_id".into()))?,
        ));
    }
    let reply: TokenReply = http
        .post(&config.token_url)
        .form(&form)
        .send()
        .await
        .map_err(provider_error)?
        .json()
        .await
        .map_err(provider_error)?;
    let token = match reply {
        TokenReply {
            access_token: Some(token),
            ..
        } => token,
        TokenReply {
            error,
            error_description,
            ..
        } => {
            return Err(Error::Provider(format!(
                "{} {}",
                error.unwrap_or_default(),
                error_description.unwrap_or_default()
            )));
        }
    };

    let info: Value = match provider {
        Provider::Yandex => http
            .get(&config.userinfo_url)
            .query(&[("format", "json")])
            .header("authorization", format!("OAuth {token}")),
        Provider::Google => http.get(&config.userinfo_url).bearer_auth(&token),
        Provider::Vk => http.post(&config.userinfo_url).form(&[
            ("client_id", config.client_id.as_str()),
            ("access_token", token.as_str()),
        ]),
        Provider::Telegram => return Err(Error::UnknownProvider),
    }
    .send()
    .await
    .map_err(provider_error)?
    .error_for_status()
    .map_err(provider_error)?
    .json()
    .await
    .map_err(provider_error)?;

    let identity = match provider {
        Provider::Yandex => Identity {
            subject: field(&info, "id").unwrap_or_default(),
            email: field(&info, "default_email"),
            display_name: field(&info, "display_name")
                .or_else(|| field(&info, "real_name"))
                .unwrap_or_default(),
        },
        Provider::Google => Identity {
            subject: field(&info, "sub").unwrap_or_default(),
            // Почту Google берём, только если он её подтвердил.
            email: field(&info, "email")
                .filter(|_| info.get("email_verified").and_then(Value::as_bool) == Some(true)),
            display_name: field(&info, "name").unwrap_or_default(),
        },
        Provider::Vk => {
            let user = info.get("user").cloned().unwrap_or(Value::Null);
            Identity {
                subject: field(&user, "user_id").unwrap_or_default(),
                // Почту от VK ID считаем подтверждённой (владелец, D-283): VK сам
                // проверяет её. Отметки «подтверждена», как у Google, VK не присылает.
                email: field(&user, "email"),
                display_name: [field(&user, "first_name"), field(&user, "last_name")]
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>()
                    .join(" "),
            }
        }
        Provider::Telegram => return Err(Error::UnknownProvider),
    };
    if identity.subject.is_empty() || identity.subject.len() > 255 {
        return Err(Error::Provider("провайдер не сообщил ID".into()));
    }
    Ok(identity)
}

/// Проверка данных виджета входа Telegram
/// (<https://core.telegram.org/widgets/login#checking-authorization>):
/// ключ — SHA-256 токена бота, подпись — HMAC-SHA256 строки `key=value`,
/// отсортированной по ключу, через `\n`. Возвращает и отпечаток данных для
/// защиты от повтора.
pub(crate) fn verify_telegram(
    config: &TelegramLogin,
    data: &BTreeMap<String, String>,
) -> Result<(Identity, Vec<u8>)> {
    let hash = data
        .get("hash")
        .ok_or_else(|| Error::Invalid("нет подписи".into()))?;
    let check: Vec<String> = data
        .iter()
        .filter(|(key, _)| key.as_str() != "hash")
        .map(|(key, value)| format!("{key}={value}"))
        .collect();
    let check = check.join("\n");
    let secret = Sha256::digest(config.bot_token.as_bytes());
    let mut mac = <Hmac<Sha256> as KeyInit>::new_from_slice(&secret)
        .map_err(|_| Error::Invalid("ключ".into()))?;
    mac.update(check.as_bytes());
    let expected = hex::decode(hash).map_err(|_| Error::Invalid("подпись".into()))?;
    mac.verify_slice(&expected)
        .map_err(|_| Error::Invalid("подпись Telegram не сходится".into()))?;

    let auth_date: i64 = data
        .get("auth_date")
        .and_then(|value| value.parse().ok())
        .ok_or_else(|| Error::Invalid("нет auth_date".into()))?;
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let max_age = i64::try_from(config.max_age.as_secs()).unwrap_or(i64::MAX);
    if auth_date > now + 60 || now - auth_date > max_age {
        return Err(Error::Invalid(
            "данные Telegram устарели — войдите заново".into(),
        ));
    }
    let subject = data
        .get("id")
        .filter(|id| !id.is_empty() && id.len() <= 255 && id.chars().all(|c| c.is_ascii_digit()))
        .ok_or_else(|| Error::Invalid("нет id".into()))?
        .clone();
    let display_name = [data.get("first_name"), data.get("last_name")]
        .into_iter()
        .flatten()
        .cloned()
        .collect::<Vec<_>>()
        .join(" ");
    Ok((
        Identity {
            subject,
            email: None,
            display_name,
        },
        Sha256::digest(check.as_bytes()).to_vec(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pkce_matches_rfc_7636_example() {
        assert_eq!(
            challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
            "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
        );
    }

    pub(crate) fn sign(token: &str, data: &mut BTreeMap<String, String>) {
        let check = data
            .iter()
            .map(|(key, value)| format!("{key}={value}"))
            .collect::<Vec<_>>()
            .join("\n");
        let mut mac =
            <Hmac<Sha256> as KeyInit>::new_from_slice(&Sha256::digest(token.as_bytes())).unwrap();
        mac.update(check.as_bytes());
        data.insert("hash".into(), hex::encode(mac.finalize().into_bytes()));
    }

    #[test]
    fn telegram_signature_freshness_and_tampering() {
        let config = TelegramLogin {
            enabled: true,
            bot_name: "qubite_bot".into(),
            bot_token: "123:секрет".into(),
            ..TelegramLogin::default()
        };
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let mut data = BTreeMap::from([
            ("id".to_owned(), "4242".to_owned()),
            ("first_name".to_owned(), "Кирилл".to_owned()),
            ("auth_date".to_owned(), now.to_string()),
        ]);
        sign(&config.bot_token, &mut data);
        let (identity, _) = verify_telegram(&config, &data).unwrap();
        assert_eq!(identity.subject, "4242");
        assert_eq!(identity.display_name, "Кирилл");

        let mut forged = data.clone();
        forged.insert("id".into(), "1".into());
        assert!(verify_telegram(&config, &forged).is_err(), "подмена id");

        let other_bot = TelegramLogin {
            bot_token: "999:другой".into(),
            ..config.clone()
        };
        assert!(verify_telegram(&other_bot, &data).is_err(), "чужой бот");

        let mut old = BTreeMap::from([
            ("id".to_owned(), "4242".to_owned()),
            ("auth_date".to_owned(), (now - 3600).to_string()),
        ]);
        sign(&config.bot_token, &mut old);
        assert!(verify_telegram(&config, &old).is_err(), "старые данные");
    }
}
