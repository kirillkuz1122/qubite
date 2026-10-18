//! Оба провайдера CAPTCHA против поддельных локальных серверов проверки.

use std::sync::{Arc, Mutex};

use axum::{Router, body::Bytes, extract::State, http::HeaderMap, routing::post};
use qubite_captcha::{Captcha, CaptchaConfig, Error, Keys, Provider};

type Seen = Arc<Mutex<Vec<(String, String)>>>;

/// Поддельный провайдер: запоминает тип и тело запроса, отвечает `reply`.
async fn fake(reply: &'static str, status: u16) -> (String, Seen) {
    let seen: Seen = Arc::default();
    let app = Router::new()
        .route(
            "/verify",
            post(
                move |State(seen): State<Seen>, headers: HeaderMap, body: Bytes| async move {
                    let kind = headers["content-type"].to_str().unwrap().to_owned();
                    seen.lock()
                        .unwrap()
                        .push((kind, String::from_utf8(body.to_vec()).unwrap()));
                    (
                        axum::http::StatusCode::from_u16(status).unwrap(),
                        [("content-type", "application/json")],
                        reply,
                    )
                },
            ),
        )
        .with_state(seen.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}/verify"), seen)
}

fn keys() -> Option<Keys> {
    Keys::from_parts(Some("site-key".into()), Some("secret-key".into()))
}

#[tokio::test]
async fn turnstile_sends_json_and_reads_success() {
    let (url, seen) = fake(r#"{"success":true,"error-codes":[]}"#, 200).await;
    let captcha = Captcha::new(CaptchaConfig {
        turnstile: keys(),
        turnstile_url: url,
        ..CaptchaConfig::default()
    });
    assert_eq!(captcha.site_key(Provider::Turnstile), Some("site-key"));
    assert!(
        captcha
            .verify(Provider::Turnstile, "token-1", "203.0.113.5")
            .await
            .unwrap()
    );
    let (kind, body) = seen.lock().unwrap()[0].clone();
    assert_eq!(kind, "application/json");
    let body: serde_json::Value = serde_json::from_str(&body).unwrap();
    assert_eq!(body["secret"], "secret-key");
    assert_eq!(body["response"], "token-1");
    assert_eq!(body["remoteip"], "203.0.113.5");

    // Пустой токен даже не отправляется.
    assert!(!captcha.verify(Provider::Turnstile, "  ", "").await.unwrap());
    assert_eq!(seen.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn turnstile_says_no() {
    let (url, _) = fake(
        r#"{"success":false,"error-codes":["invalid-input-response"]}"#,
        200,
    )
    .await;
    let captcha = Captcha::new(CaptchaConfig {
        turnstile: keys(),
        turnstile_url: url,
        ..CaptchaConfig::default()
    });
    assert!(
        !captcha
            .verify(Provider::Turnstile, "bot", "")
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn smartcaptcha_sends_form_and_reads_status() {
    let (url, seen) = fake(r#"{"status":"ok","message":""}"#, 200).await;
    let captcha = Captcha::new(CaptchaConfig {
        smartcaptcha: keys(),
        smartcaptcha_url: url,
        ..CaptchaConfig::default()
    });
    assert!(
        captcha
            .verify(Provider::SmartCaptcha, "токен&x", "198.51.100.7")
            .await
            .unwrap()
    );
    let (kind, body) = seen.lock().unwrap()[0].clone();
    assert_eq!(kind, "application/x-www-form-urlencoded");
    let pairs: Vec<(String, String)> = form_urlencoded::parse(body.as_bytes())
        .map(|(k, v)| (k.into_owned(), v.into_owned()))
        .collect();
    assert!(pairs.contains(&("secret".into(), "secret-key".into())));
    assert!(pairs.contains(&("token".into(), "токен&x".into())));
    assert!(pairs.contains(&("ip".into(), "198.51.100.7".into())));

    let (url, _) = fake(r#"{"status":"failed","message":"Token invalid"}"#, 200).await;
    let captcha = Captcha::new(CaptchaConfig {
        smartcaptcha: keys(),
        smartcaptcha_url: url,
        ..CaptchaConfig::default()
    });
    assert!(
        !captcha
            .verify(Provider::SmartCaptcha, "bot", "")
            .await
            .unwrap()
    );
}

#[tokio::test]
async fn broken_or_missing_provider_is_an_error_not_a_pass() {
    let (url, _) = fake("upstream error", 502).await;
    let captcha = Captcha::new(CaptchaConfig {
        turnstile: keys(),
        turnstile_url: url,
        ..CaptchaConfig::default()
    });
    assert!(matches!(
        captcha.verify(Provider::Turnstile, "t", "").await,
        Err(Error::Unavailable(_))
    ));
    // Провайдер без ключей.
    assert!(matches!(
        captcha.verify(Provider::SmartCaptcha, "t", "").await,
        Err(Error::NotConfigured(Provider::SmartCaptcha))
    ));
    assert_eq!(captcha.site_key(Provider::SmartCaptcha), None);
    // Никто не слушает.
    let captcha = Captcha::new(CaptchaConfig {
        turnstile: keys(),
        turnstile_url: "http://127.0.0.1:1/verify".into(),
        ..CaptchaConfig::default()
    });
    assert!(matches!(
        captcha.verify(Provider::Turnstile, "t", "").await,
        Err(Error::Unavailable(_))
    ));
    assert_eq!(
        "Yandex".parse::<Provider>().unwrap(),
        Provider::SmartCaptcha
    );
    assert!("recaptcha".parse::<Provider>().is_err());
}
