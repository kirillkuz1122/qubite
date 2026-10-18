//! Транспорты почты на настоящих локальных серверах: поддельный Resend (HTTP)
//! и поддельный SMTP-сервер. Во внешний мир ничего не уходит.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use axum::{Json, Router, extract::State, http::HeaderMap, http::StatusCode, routing::post};
use qubite_kernel::Secret;
use qubite_mail::{Email, MailConfig, Mailer, Mode, templates};
use serde_json::Value;
use tokio::{
    io::{AsyncBufReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
};

fn letter(to: &str) -> Email {
    templates::verify_email(
        "Кирилл",
        "482915",
        "https://auth.qubiteapp.ru/verify-email?token=t",
        "24 часа",
    )
    .to(to)
}

#[tokio::test]
async fn mock_collects_letters() {
    let (mailer, outbox) = Mailer::mock();
    assert_eq!(mailer.mode(), Mode::Mock);
    mailer.send(&letter("Friend@Example.ru")).await.unwrap();
    let got = outbox
        .wait_for("friend@example.ru", 1, Duration::from_secs(1))
        .await;
    assert_eq!(got.len(), 1);
    assert!(got[0].text.contains("482915"));
    // Перевод строки в адресе — попытка подставить свой заголовок.
    let bad = mailer.send(&letter("a@b.ru\r\nBcc: evil@x.ru")).await;
    assert!(bad.is_err());
    assert_eq!(outbox.all().len(), 1);
}

type Captured = Arc<Mutex<Vec<(HeaderMap, Value)>>>;

async fn fake_resend(status: StatusCode) -> (String, Captured) {
    let captured: Captured = Arc::default();
    let app = Router::new()
        .route(
            "/emails",
            post(
                |State((captured, status)): State<(Captured, StatusCode)>,
                 headers: HeaderMap,
                 Json(body): Json<Value>| async move {
                    captured.lock().unwrap().push((headers, body));
                    (status, Json(serde_json::json!({ "id": "re_123" })))
                },
            ),
        )
        .with_state((captured.clone(), status));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (format!("http://{address}/emails"), captured)
}

#[tokio::test]
async fn resend_sends_json_with_key() {
    let (url, captured) = fake_resend(StatusCode::OK).await;
    let mailer = Mailer::new(&MailConfig {
        mode: Mode::Resend,
        resend_api_key: Some(Secret::new("re_test_key")),
        resend_api_url: url,
        reply_to: Some("support@qubiteapp.ru".into()),
        ..MailConfig::default()
    })
    .unwrap();
    mailer.send(&letter("friend@example.ru")).await.unwrap();

    let calls = captured.lock().unwrap().clone();
    assert_eq!(calls.len(), 1);
    let (headers, body) = &calls[0];
    assert_eq!(headers["authorization"], "Bearer re_test_key");
    assert_eq!(body["from"], "Qubite <no-reply@qubiteapp.ru>");
    assert_eq!(body["to"], serde_json::json!(["friend@example.ru"]));
    assert_eq!(body["reply_to"], "support@qubiteapp.ru");
    assert_eq!(body["subject"], "Подтвердите почту в Qubite");
    assert!(body["html"].as_str().unwrap().contains("482915"));
    assert!(body["text"].as_str().unwrap().contains("482915"));
}

#[tokio::test]
async fn resend_error_is_reported() {
    let (url, _) = fake_resend(StatusCode::UNPROCESSABLE_ENTITY).await;
    let mailer = Mailer::new(&MailConfig {
        mode: Mode::Resend,
        resend_api_key: Some(Secret::new("re_test_key")),
        resend_api_url: url,
        ..MailConfig::default()
    })
    .unwrap();
    let error = mailer.send(&letter("friend@example.ru")).await.unwrap_err();
    assert!(error.to_string().contains("422"), "{error}");
}

#[test]
fn real_modes_need_keys() {
    let resend = Mailer::new(&MailConfig {
        mode: Mode::Resend,
        ..MailConfig::default()
    });
    assert!(resend.is_err());
    let smtp = Mailer::new(&MailConfig {
        mode: Mode::Smtp,
        ..MailConfig::default()
    });
    assert!(smtp.is_err());
    assert!("pigeon".parse::<Mode>().is_err());
    assert_eq!("SMTP".parse::<Mode>().unwrap(), Mode::Smtp);
}

/// Самый простой SMTP-сервер: принимает одно письмо и запоминает разговор.
async fn fake_smtp() -> (u16, tokio::task::JoinHandle<Vec<String>>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (read, mut write) = stream.into_split();
        let mut lines = BufReader::new(read).lines();
        let mut log = Vec::new();
        write.write_all(b"220 fake ESMTP\r\n").await.unwrap();
        let mut in_data = false;
        while let Some(line) = lines.next_line().await.unwrap() {
            log.push(line.clone());
            if in_data {
                if line == "." {
                    in_data = false;
                    write.write_all(b"250 queued\r\n").await.unwrap();
                }
                continue;
            }
            let upper = line.to_ascii_uppercase();
            let reply: &[u8] = if upper.starts_with("EHLO") {
                b"250-fake\r\n250 AUTH PLAIN LOGIN\r\n"
            } else if upper.starts_with("AUTH") {
                b"235 ok\r\n"
            } else if upper.starts_with("DATA") {
                in_data = true;
                b"354 go\r\n"
            } else if upper.starts_with("QUIT") {
                write.write_all(b"221 bye\r\n").await.unwrap();
                break;
            } else {
                b"250 ok\r\n"
            };
            write.write_all(reply).await.unwrap();
        }
        log
    });
    (port, task)
}

#[tokio::test]
async fn smtp_delivers_multipart_letter() {
    let (port, server) = fake_smtp().await;
    let mailer = Mailer::new(&MailConfig {
        mode: Mode::Smtp,
        smtp_url: Some(Secret::new(format!("smtp://robot:secret@127.0.0.1:{port}"))),
        ..MailConfig::default()
    })
    .unwrap();
    mailer.send(&letter("friend@example.ru")).await.unwrap();
    drop(mailer);
    let log = tokio::time::timeout(Duration::from_secs(5), server)
        .await
        .unwrap()
        .unwrap();
    let all = log.join("\n");
    assert!(log.iter().any(|l| l.starts_with("AUTH")), "{all}");
    assert!(all.contains("MAIL FROM:<no-reply@qubiteapp.ru>"), "{all}");
    assert!(all.contains("RCPT TO:<friend@example.ru>"), "{all}");
    assert!(all.contains("multipart/alternative"), "{all}");
    assert!(all.contains("text/html"), "{all}");
}
