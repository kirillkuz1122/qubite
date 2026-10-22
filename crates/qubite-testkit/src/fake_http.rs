//! Поддельный HTTP-сервер для тестов адаптеров провайдеров (OpenRouter):
//! отвечает записанными ответами, может оборвать соединение или зависнуть.
//! В интернет тесты не ходят.

use std::{
    collections::VecDeque,
    net::SocketAddr,
    sync::{Arc, Mutex},
};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};

/// Ответ, который тест вычисляет по запросу (например, нужен `nonce`).
pub type Responder = Arc<dyn Fn(&Received) -> (u16, String) + Send + Sync>;

/// Что сделать с очередным запросом.
#[derive(Clone)]
pub enum Action {
    /// Ответ вычисляет тест.
    With(Responder),
    /// Ответить статусом и JSON.
    Respond(u16, String),
    /// Ответить статусом, своими заголовками и телом (звук, редирект, HTML).
    Reply(u16, Vec<(&'static str, String)>, String),
    /// Прочитать запрос и закрыть соединение без ответа (обрыв после отправки).
    Close,
    /// Прочитать запрос и молчать.
    Hang,
}

impl std::fmt::Debug for Action {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::With(_) => f.write_str("With(..)"),
            Self::Respond(status, _) => write!(f, "Respond({status})"),
            Self::Reply(status, _, _) => write!(f, "Reply({status})"),
            Self::Close => f.write_str("Close"),
            Self::Hang => f.write_str("Hang"),
        }
    }
}

/// Принятый запрос.
#[derive(Debug, Clone)]
pub struct Received {
    /// `POST /api/v1/chat/completions`.
    pub line: String,
    /// Заголовки, имена строчными.
    pub headers: Vec<(String, String)>,
    pub body: String,
    /// Тело как есть (для двоичных запросов, например Web Push).
    pub raw: Vec<u8>,
}

impl Received {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .iter()
            .find(|(n, _)| n == name)
            .map(|(_, v)| v.as_str())
    }
}

struct Shared {
    script: Mutex<VecDeque<Action>>,
    fallback: Action,
    received: Mutex<Vec<Received>>,
}

/// Сервер живёт, пока жив этот объект (задача останавливается при drop).
pub struct FakeHttp {
    addr: SocketAddr,
    shared: Arc<Shared>,
    task: tokio::task::JoinHandle<()>,
}

impl FakeHttp {
    /// Сервер на свободном порту 127.0.0.1: сначала шаги `script`, потом всегда `fallback`.
    pub async fn start(script: impl IntoIterator<Item = Action>, fallback: Action) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.expect("порт");
        let addr = listener.local_addr().expect("адрес");
        let shared = Arc::new(Shared {
            script: Mutex::new(script.into_iter().collect()),
            fallback,
            received: Mutex::new(Vec::new()),
        });
        let state = shared.clone();
        let task = tokio::spawn(async move {
            loop {
                let Ok((stream, _)) = listener.accept().await else {
                    return;
                };
                let state = state.clone();
                tokio::spawn(async move { serve(stream, &state).await });
            }
        });
        Self { addr, shared, task }
    }

    /// Адрес вида `http://127.0.0.1:PORT`.
    pub fn root_url(&self) -> String {
        format!("http://{}", self.addr)
    }

    /// Адрес вида `http://127.0.0.1:PORT/api/v1`.
    pub fn base_url(&self) -> String {
        format!("http://{}/api/v1", self.addr)
    }

    /// Все принятые запросы по порядку.
    pub fn received(&self) -> Vec<Received> {
        self.shared.received.lock().expect("журнал").clone()
    }
}

impl Drop for FakeHttp {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// Адрес, на котором точно никто не слушает (порт заняли и освободили).
pub async fn closed_port_url() -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.expect("порт");
    let addr = listener.local_addr().expect("адрес");
    drop(listener);
    format!("http://{addr}/api/v1")
}

async fn serve(mut stream: TcpStream, state: &Shared) {
    let mut buf = Vec::new();
    let mut chunk = [0_u8; 4096];
    let (head_end, length) = loop {
        let Ok(n) = stream.read(&mut chunk).await else {
            return;
        };
        if n == 0 {
            return;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(end) = find(&buf, b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..end]).to_lowercase();
            let length = head
                .lines()
                .find_map(|l| l.strip_prefix("content-length:"))
                .and_then(|v| v.trim().parse::<usize>().ok())
                .unwrap_or(0);
            break (end + 4, length);
        }
    };
    while buf.len() < head_end + length {
        let Ok(n) = stream.read(&mut chunk).await else {
            return;
        };
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
    }
    let head = String::from_utf8_lossy(&buf[..head_end - 4]).into_owned();
    let mut lines = head.lines();
    let line = lines.next().unwrap_or_default().to_owned();
    let headers = lines
        .filter_map(|l| l.split_once(':'))
        .map(|(n, v)| (n.trim().to_lowercase(), v.trim().to_owned()))
        .collect();
    let body = String::from_utf8_lossy(&buf[head_end..]).into_owned();
    state.received.lock().expect("журнал").push(Received {
        line,
        headers,
        body,
        raw: buf[head_end..].to_vec(),
    });

    let action = state
        .script
        .lock()
        .expect("сценарий")
        .pop_front()
        .unwrap_or_else(|| state.fallback.clone());
    let action = match action {
        Action::With(respond) => {
            let request = state.received.lock().expect("журнал").last().cloned();
            let (status, body) = respond(&request.expect("запрос записан"));
            Action::Respond(status, body)
        }
        other => other,
    };
    match action {
        Action::With(_) => unreachable!("вычислено выше"),
        Action::Respond(status, body) => {
            let response = format!(
                "HTTP/1.1 {status} X\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
        }
        Action::Reply(status, headers, body) => {
            let mut response = format!("HTTP/1.1 {status} X\r\n");
            for (name, value) in headers {
                response.push_str(&format!("{name}: {value}\r\n"));
            }
            response.push_str(&format!(
                "content-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            ));
            let _ = stream.write_all(response.as_bytes()).await;
            let _ = stream.shutdown().await;
        }
        Action::Close => drop(stream),
        Action::Hang => {
            std::future::pending::<()>().await;
        }
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}
