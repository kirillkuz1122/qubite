//! Общие помощники HTTP-тестов: сервер на свободном порту, owner, «браузер».
//!
//! Cookie обрабатываем вручную: у них флаг `Secure`, а тестовый сервер
//! работает по http, поэтому готовое хранилище cookie их бы не отправило.
#![allow(dead_code)]

use std::net::SocketAddr;

use qubite_auth::Passwords;
use qubite_db::Database;
use qubite_server::{AppState, auth::AuthSettings};
use qubite_testkit::TestDb;
use reqwest::{Method, StatusCode};
use serde_json::{Value, json};

pub const EMAIL: &str = "kirill@qubite.ru";
pub const PASSWORD: &str = "правильный пароль";

pub async fn spawn(db: Database, settings: AuthSettings) -> SocketAddr {
    spawn_with(db, settings, axum::Router::new()).await
}

/// Сервер с дополнительными маршрутами (проверочные «модули»).
pub async fn spawn_with(
    db: Database,
    settings: AuthSettings,
    extra: axum::Router<AppState>,
) -> SocketAddr {
    let app = qubite_server::router_with(AppState::with_auth(db, settings), extra)
        .into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    address
}

/// База с миграциями, owner и запущенный сервер.
pub async fn setup(settings: AuthSettings) -> (TestDb, Database, SocketAddr) {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let address = spawn(db.clone(), settings).await;
    (test_db, db, address)
}

/// Браузер: помнит две cookie Qubite.
#[derive(Clone, Default)]
pub struct Browser {
    pub session: Option<String>,
    pub csrf: Option<String>,
}

pub struct Reply {
    pub status: StatusCode,
    pub headers: reqwest::header::HeaderMap,
    pub body: Value,
}

impl Reply {
    pub fn set_cookies(&self) -> Vec<String> {
        self.headers
            .get_all("set-cookie")
            .iter()
            .map(|value| value.to_str().unwrap().to_owned())
            .collect()
    }
}

impl Browser {
    pub async fn send(
        &mut self,
        address: SocketAddr,
        method: Method,
        path: &str,
        body: Option<Value>,
        with_csrf: bool,
    ) -> Reply {
        let client = reqwest::Client::new();
        let mut request = client.request(method, format!("http://{address}{path}"));
        let mut cookies = Vec::new();
        if let Some(session) = &self.session {
            cookies.push(format!("qubite_session={session}"));
        }
        if let Some(csrf) = &self.csrf {
            cookies.push(format!("qubite_csrf={csrf}"));
            if with_csrf {
                request = request.header("x-csrf-token", csrf);
            }
        }
        if !cookies.is_empty() {
            request = request.header("cookie", cookies.join("; "));
        }
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.unwrap();
        let status = response.status();
        let headers = response.headers().clone();
        let body = response.json::<Value>().await.unwrap_or(Value::Null);
        let reply = Reply {
            status,
            headers,
            body,
        };
        for cookie in reply.set_cookies() {
            let (pair, _) = cookie.split_once(';').unwrap();
            let (name, value) = pair.split_once('=').unwrap();
            let value = (!value.is_empty()).then(|| value.to_owned());
            match name {
                "qubite_session" => self.session = value,
                "qubite_csrf" => self.csrf = value,
                _ => {}
            }
        }
        reply
    }

    pub async fn login(&mut self, address: SocketAddr, email: &str, password: &str) -> Reply {
        self.send(
            address,
            Method::POST,
            "/api/auth/login",
            Some(json!({ "email": email, "password": password })),
            false,
        )
        .await
    }

    pub async fn get(&mut self, address: SocketAddr, path: &str) -> Reply {
        self.send(address, Method::GET, path, None, false).await
    }

    pub async fn post(&mut self, address: SocketAddr, path: &str) -> Reply {
        self.send(address, Method::POST, path, None, true).await
    }

    pub async fn delete(&mut self, address: SocketAddr, path: &str) -> Reply {
        self.send(address, Method::DELETE, path, None, true).await
    }
}

pub async fn logged_in(address: SocketAddr) -> Browser {
    let mut browser = Browser::default();
    let reply = browser.login(address, EMAIL, PASSWORD).await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    browser
}

/// Выполнить запрос с JSON-телом и CSRF-токеном.
impl Browser {
    pub async fn put_json(&mut self, address: SocketAddr, path: &str, body: Value) -> Reply {
        self.send(address, Method::PUT, path, Some(body), true)
            .await
    }

    pub async fn patch_json(&mut self, address: SocketAddr, path: &str, body: Value) -> Reply {
        self.send(address, Method::PATCH, path, Some(body), true)
            .await
    }

    pub async fn post_json(&mut self, address: SocketAddr, path: &str, body: Value) -> Reply {
        self.send(address, Method::POST, path, Some(body), true)
            .await
    }
}
