//! Все запросы — только к поддельному HTTP-серверу на loopback. Обход
//! публичного HTTPS — конструирование приватных полей только в cfg(test).
use super::*;
use tokio::{io::{AsyncReadExt, AsyncWriteExt}, net::TcpListener};

const TEST_KEY: &str = "test-only-key-12345678";

async fn fake(response: Vec<u8>) -> (OpenAiVoice, tokio::task::JoinHandle<String>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut bytes = Vec::new();
        loop {
            let mut part = [0; 4096];
            let n = stream.read(&mut part).await.unwrap();
            assert!(n > 0, "запрос должен прийти целиком");
            bytes.extend_from_slice(&part[..n]);
            if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                let head = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                let length: usize = head.lines().find_map(|line|
                    line.strip_prefix("content-length: ").and_then(|s| s.parse().ok())
                ).unwrap();
                if bytes.len() >= end + 4 + length { break; }
            }
        }
        // Клиент имеет право закрыть ответ сразу при превышении размера.
        let _ = stream.write_all(&response).await;
        String::from_utf8(bytes).unwrap()
    });
    let _ = rustls::crypto::ring::default_provider().install_default();
    let provider = OpenAiVoice {
        client: reqwest::Client::builder().no_proxy()
            .redirect(reqwest::redirect::Policy::none()).timeout(TIMEOUT).build().unwrap(),
        endpoint: format!("http://{address}/v1/audio/transcriptions"),
        api_key: Secret::new(TEST_KEY),
    };
    (provider, server)
}

fn response(status: &str, body: &str) -> Vec<u8> {
    format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).into_bytes()
}

fn call(language: Option<&str>) -> SttCall {
    SttCall {
        external_id: "whisper-1".into(), audio: b"fake audio".to_vec(),
        mime: "audio/mp4".into(), language: language.map(str::to_owned), account_id: uuid::Uuid::new_v4(),
    }
}

#[tokio::test]
async fn sends_multipart_and_authorization_without_key_in_url() {
    let (provider, server) = fake(response("200 OK", r#"{"text":"Купить хлеб"}"#)).await;
    let heard = provider.transcribe(&call(Some("ru"))).await.unwrap();
    assert_eq!(heard.text, "Купить хлеб");
    let request = server.await.unwrap();
    assert_eq!(request.lines().next().unwrap(), "POST /v1/audio/transcriptions HTTP/1.1");
    assert!(request.contains(&format!("authorization: Bearer {TEST_KEY}\r\n")));
    for expected in [
        "name=\"file\"; filename=\"speech.m4a\"", "Content-Type: audio/mp4",
        "name=\"model\"\r\n\r\nwhisper-1", "name=\"response_format\"\r\n\r\njson",
        "name=\"language\"\r\n\r\nru", "fake audio",
    ] {
        assert!(request.contains(expected), "{expected}");
    }
    let (_, body) = request.split_once("\r\n\r\n").unwrap();
    assert!(!body.contains(TEST_KEY));
}

#[tokio::test]
async fn refuses_errors_without_echoing_service_secrets_and_omits_unset_language() {
    for status in ["401 Unauthorized", "429 Too Many Requests", "500 Internal Server Error"] {
        let (provider, server) = fake(response(status, TEST_KEY)).await;
        let error = provider.transcribe(&call(None)).await.unwrap_err();
        assert!(!format!("{error:?}").contains(TEST_KEY));
        assert!(!server.await.unwrap().contains("name=\"language\""));
    }
    let (provider, server) = fake(
        b"HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:1/private\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec()
    ).await;
    assert!(matches!(provider.transcribe(&call(None)).await, Err(ProviderError::Refused(_))));
    server.await.unwrap();
}

#[tokio::test]
async fn rejects_bad_json_reflected_keys_and_large_responses() {
    for body in ["not json".to_owned(), format!(r#"{{"text":"{TEST_KEY}"}}"#)] {
        let (provider, server) = fake(response("200 OK", &body)).await;
        assert!(provider.transcribe(&call(None)).await.is_err());
        server.await.unwrap();
    }
    let (provider, server) = fake(response("200 OK", &"x".repeat(MAX_RESPONSE_BYTES + 1))).await;
    assert!(provider.transcribe(&call(None)).await.is_err());
    server.await.unwrap();
    // Без Content-Length размер тоже ограничен по фактически прочитанным байтам.
    let body = "x".repeat(MAX_RESPONSE_BYTES + 1);
    let chunked = format!(
        "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n{:x}\r\n{body}\r\n0\r\n\r\n", body.len()
    );
    let (provider, server) = fake(chunked.into_bytes()).await;
    assert!(provider.transcribe(&call(None)).await.is_err());
    server.await.unwrap();
}
