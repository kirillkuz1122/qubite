//! Выход сервера в интернет через прокси (ENG-001, D-515). Из России часть
//! сервисов закрыта (ElevenLabs отвечает редиректом), а VPN владельца даёт
//! локальный прокси (Hiddify, порт mixed — `http://127.0.0.1:12334`).
//!
//! Один общий `QUBITE_PROXY` для внешних запросов сервера (ElevenLabs, OpenRouter,
//! ChatGPT, Telegram); у сервиса может быть свой — `QUBITE_<СЕРВИС>_PROXY`
//! (например `QUBITE_ELEVENLABS_PROXY`). Без них — системные `HTTPS_PROXY` /
//! `ALL_PROXY`. Локальные адреса и `NO_PROXY` — всегда напрямую.
//! Прокси — `http://`, `socks5://` или `socks5h://` (логин и пароль — в адресе).

use std::{io, net::IpAddr, time::Duration};

use base64::Engine;
pub use reqwest::Url;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

/// Общая очередь публичных картографических API: не чаще одного запроса
/// в секунду на хост во всём процессе (включая разные экземпляры клиентов).
/// Храним только имя хоста и время следующего запроса, без URL и координат.
pub async fn one_per_second(url: &Url) {
    use std::{
        collections::HashMap,
        sync::{Arc, Mutex, OnceLock},
    };
    use tokio::{
        sync::Mutex as AsyncMutex,
        time::{Instant, sleep_until},
    };

    type Hosts = Mutex<HashMap<String, Arc<AsyncMutex<Instant>>>>;
    static HOSTS: OnceLock<Hosts> = OnceLock::new();
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let queue = {
        let mut hosts = HOSTS
            .get_or_init(Hosts::default)
            .lock()
            .expect("очереди хостов");
        hosts
            .entry(host)
            .or_insert_with(|| Arc::new(AsyncMutex::new(Instant::now())))
            .clone()
    };
    let mut next = queue.lock().await;
    sleep_until(*next).await;
    *next = Instant::now() + Duration::from_secs(1);
}

/// Общий прокси для всех внешних запросов сервера.
pub const PROXY_VAR: &str = "QUBITE_PROXY";

/// Прокси из настроек Qubite: свой у сервиса, иначе общий. Пусто — `None`.
pub fn configured(service: Option<&str>) -> Option<String> {
    configured_with(service, |name| std::env::var(name).ok())
}

/// То же с подставным окружением (для тестов).
pub fn configured_with(
    service: Option<&str>,
    get: impl Fn(&str) -> Option<String>,
) -> Option<String> {
    let own = service.map(|s| format!("QUBITE_{}_PROXY", s.to_ascii_uppercase()));
    own.iter()
        .map(String::as_str)
        .chain([PROXY_VAR])
        .find_map(|name| filled(get(name)))
}

fn filled(value: Option<String>) -> Option<String> {
    value.map(|v| v.trim().to_owned()).filter(|v| !v.is_empty())
}

fn env(name: &str) -> Option<String> {
    filled(std::env::var(name).ok())
}

/// HTTP-клиент для внешних запросов: с этим прокси (локальное и `NO_PROXY` —
/// напрямую); без него reqwest сам берёт системные `HTTPS_PROXY` / `ALL_PROXY`.
pub fn client(proxy: Option<&str>) -> Result<reqwest::ClientBuilder, String> {
    let builder = reqwest::Client::builder();
    let Some(proxy) = proxy else {
        return Ok(builder);
    };
    let proxy = reqwest::Proxy::all(proxy)
        .map_err(|error| format!("прокси «{}» не разобран: {error}", hide(proxy)))?
        .no_proxy(reqwest::NoProxy::from_string(&bypass_list(
            env("NO_PROXY").or_else(|| env("no_proxy")),
        )));
    Ok(builder.proxy(proxy))
}

fn bypass_list(no_proxy: Option<String>) -> String {
    let mut list = String::from("localhost,127.0.0.1,::1");
    if let Some(more) = no_proxy {
        list.push(',');
        list.push_str(&more);
    }
    list
}

/// Прокси для соединения с `host` мимо reqwest (WebSocket — у него своего
/// прокси нет): заданный в Qubite, иначе системный; локальное и `NO_PROXY` —
/// напрямую.
pub fn for_host(host: &str, configured: Option<&str>) -> Result<Option<Url>, String> {
    for_host_with(host, configured, |name| std::env::var(name).ok())
}

/// То же с подставным окружением (для тестов).
pub fn for_host_with(
    host: &str,
    configured: Option<&str>,
    get: impl Fn(&str) -> Option<String>,
) -> Result<Option<Url>, String> {
    let no_proxy = filled(get("NO_PROXY")).or_else(|| filled(get("no_proxy")));
    if bypassed(host, &bypass_list(no_proxy)) {
        return Ok(None);
    }
    let raw = configured.map(str::to_owned).or_else(|| {
        ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"]
            .into_iter()
            .find_map(|name| filled(get(name)))
    });
    let Some(raw) = raw else {
        return Ok(None);
    };
    let url = Url::parse(&raw)
        .map_err(|error| format!("прокси «{}» не разобран: {error}", hide(&raw)))?;
    match url.scheme() {
        "http" | "socks5" | "socks5h" if url.host_str().is_some() => Ok(Some(url)),
        _ => Err(format!(
            "прокси «{}»: нужен адрес http://, socks5:// или socks5h:// с хостом",
            hide(&raw)
        )),
    }
}

/// Хост — в списке «напрямую» (`localhost`, домены с поддоменами, IP, сети CIDR, `*`).
fn bypassed(host: &str, list: &str) -> bool {
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_ascii_lowercase();
    let ip: Option<IpAddr> = host.parse().ok();
    if ip.is_some_and(|ip| ip.is_loopback()) {
        return true;
    }
    list.split(',')
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .any(|entry| {
            let entry = entry.to_ascii_lowercase();
            if entry == "*" {
                return true;
            }
            if let (Some(ip), Some((net, bits))) = (ip, entry.split_once('/')) {
                return in_network(ip, net, bits);
            }
            let domain = entry.trim_start_matches('.');
            host == domain || host.ends_with(&format!(".{domain}"))
        })
}

fn in_network(ip: IpAddr, net: &str, bits: &str) -> bool {
    let (Ok(net), Ok(bits)) = (net.parse::<IpAddr>(), bits.parse::<u32>()) else {
        return false;
    };
    match (ip, net) {
        (IpAddr::V4(ip), IpAddr::V4(net)) if bits <= 32 => {
            let mask = u32::MAX.checked_shl(32 - bits).unwrap_or(0);
            u32::from(ip) & mask == u32::from(net) & mask
        }
        (IpAddr::V6(ip), IpAddr::V6(net)) if bits <= 128 => {
            let mask = u128::MAX.checked_shl(128 - bits).unwrap_or(0);
            u128::from(ip) & mask == u128::from(net) & mask
        }
        _ => false,
    }
}

/// Адрес прокси без логина и пароля — для сообщений и журнала.
pub fn hide(proxy: &str) -> String {
    match Url::parse(proxy) {
        Ok(mut url) => {
            let _ = url.set_username("");
            let _ = url.set_password(None);
            url.to_string().trim_end_matches('/').to_owned()
        }
        Err(_) => "(не адрес)".into(),
    }
}

/// TCP-соединение с `host:port` через прокси: HTTP CONNECT или SOCKS5.
pub async fn tunnel(
    proxy: &Url,
    host: &str,
    port: u16,
    timeout: Duration,
) -> io::Result<TcpStream> {
    tokio::time::timeout(timeout, async {
        let socks = proxy.scheme().starts_with("socks5");
        let proxy_host = proxy
            .host_str()
            .ok_or_else(|| invalid("в адресе прокси нет хоста"))?
            .trim_start_matches('[')
            .trim_end_matches(']');
        let proxy_port = proxy
            .port_or_known_default()
            .unwrap_or(if socks { 1080 } else { 8080 });
        let mut stream = TcpStream::connect((proxy_host, proxy_port)).await?;
        let user = decode(proxy.username());
        let password = decode(proxy.password().unwrap_or_default());
        if socks {
            socks5(&mut stream, host, port, &user, &password).await?;
        } else {
            connect(&mut stream, host, port, &user, &password).await?;
        }
        Ok(stream)
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "прокси не ответил вовремя"))?
}

async fn connect(
    stream: &mut TcpStream,
    host: &str,
    port: u16,
    user: &str,
    password: &str,
) -> io::Result<()> {
    let mut request = format!("CONNECT {host}:{port} HTTP/1.1\r\nHost: {host}:{port}\r\n");
    if !user.is_empty() {
        let token = base64::engine::general_purpose::STANDARD.encode(format!("{user}:{password}"));
        request.push_str(&format!("Proxy-Authorization: Basic {token}\r\n"));
    }
    request.push_str("\r\n");
    stream.write_all(request.as_bytes()).await?;
    // Ответ прокси — до пустой строки; дальше поток принадлежит серверу.
    let mut head = Vec::new();
    while !head.ends_with(b"\r\n\r\n") {
        if head.len() > 8 * 1024 {
            return Err(invalid("прокси прислал слишком длинный ответ"));
        }
        let mut byte = [0u8; 1];
        if stream.read(&mut byte).await? == 0 {
            return Err(invalid("прокси закрыл соединение"));
        }
        head.push(byte[0]);
    }
    let line = String::from_utf8_lossy(&head);
    let status = line.split_whitespace().nth(1).unwrap_or_default();
    if status == "200" {
        Ok(())
    } else {
        Err(io::Error::new(
            io::ErrorKind::ConnectionRefused,
            format!(
                "прокси не пустил: {}",
                line.lines().next().unwrap_or_default()
            ),
        ))
    }
}

async fn socks5(
    stream: &mut TcpStream,
    host: &str,
    port: u16,
    user: &str,
    password: &str,
) -> io::Result<()> {
    let with_login = !user.is_empty();
    let hello: &[u8] = if with_login {
        &[5, 2, 0, 2]
    } else {
        &[5, 1, 0]
    };
    stream.write_all(hello).await?;
    let mut reply = [0u8; 2];
    stream.read_exact(&mut reply).await?;
    match reply {
        [5, 0] => {}
        [5, 2] if with_login => {
            let (u, p) = (user.as_bytes(), password.as_bytes());
            if u.len() > 255 || p.len() > 255 {
                return Err(invalid("логин или пароль прокси длиннее 255 байт"));
            }
            let mut auth = vec![1, u.len() as u8];
            auth.extend_from_slice(u);
            auth.push(p.len() as u8);
            auth.extend_from_slice(p);
            stream.write_all(&auth).await?;
            let mut ok = [0u8; 2];
            stream.read_exact(&mut ok).await?;
            if ok[1] != 0 {
                return Err(refused("SOCKS5: неверный логин или пароль прокси"));
            }
        }
        _ => return Err(refused("SOCKS5: прокси не принял способ входа")),
    }
    let name = host.trim_start_matches('[').trim_end_matches(']');
    let mut request = vec![5, 1, 0];
    match name.parse::<IpAddr>() {
        Ok(IpAddr::V4(v4)) => {
            request.push(1);
            request.extend_from_slice(&v4.octets());
        }
        Ok(IpAddr::V6(v6)) => {
            request.push(4);
            request.extend_from_slice(&v6.octets());
        }
        Err(_) => {
            if name.len() > 255 {
                return Err(invalid("SOCKS5: имя хоста длиннее 255 байт"));
            }
            request.push(3);
            request.push(name.len() as u8);
            request.extend_from_slice(name.as_bytes());
        }
    }
    request.extend_from_slice(&port.to_be_bytes());
    stream.write_all(&request).await?;
    let mut head = [0u8; 4];
    stream.read_exact(&mut head).await?;
    if head[1] != 0 {
        return Err(refused(&format!(
            "SOCKS5: прокси не соединил (код {})",
            head[1]
        )));
    }
    let rest = match head[3] {
        1 => 4 + 2,
        4 => 16 + 2,
        3 => {
            let mut len = [0u8; 1];
            stream.read_exact(&mut len).await?;
            usize::from(len[0]) + 2
        }
        _ => return Err(invalid("SOCKS5: непонятный ответ прокси")),
    };
    let mut skip = vec![0u8; rest];
    stream.read_exact(&mut skip).await?;
    Ok(())
}

/// %XX в логине и пароле из адреса прокси.
fn decode(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%'
            && let (Some(Some(hi)), Some(Some(lo))) = (
                bytes.get(i + 1).map(|b| hex(*b)),
                bytes.get(i + 2).map(|b| hex(*b)),
            )
        {
            out.push((hi * 16 + lo) as u8);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn invalid(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, message.to_owned())
}

fn refused(message: &str) -> io::Error {
    io::Error::new(io::ErrorKind::ConnectionRefused, message.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(pairs: &[(&str, &str)]) -> impl Fn(&str) -> Option<String> {
        let pairs: Vec<(String, String)> = pairs
            .iter()
            .map(|(k, v)| ((*k).into(), (*v).into()))
            .collect();
        move |name| {
            pairs
                .iter()
                .find(|(k, _)| k == name)
                .map(|(_, v)| v.clone())
        }
    }

    #[test]
    fn own_proxy_beats_common_and_empty_is_none() {
        let get = vars(&[
            ("QUBITE_PROXY", "http://127.0.0.1:12334"),
            ("QUBITE_ELEVENLABS_PROXY", "socks5://127.0.0.1:1080"),
            ("QUBITE_TELEGRAM_PROXY", "  "),
        ]);
        assert_eq!(
            configured_with(Some("elevenlabs"), &get).as_deref(),
            Some("socks5://127.0.0.1:1080")
        );
        assert_eq!(
            configured_with(Some("telegram"), &get).as_deref(),
            Some("http://127.0.0.1:12334")
        );
        assert_eq!(configured_with(None, vars(&[])), None);
    }

    #[test]
    fn websocket_proxy_falls_back_to_system_and_skips_local() {
        let get = vars(&[
            ("HTTPS_PROXY", "http://10.0.0.1:3128"),
            ("NO_PROXY", ".internal,192.168.0.0/16"),
        ]);
        let host = |h: &str, own: Option<&str>| {
            for_host_with(h, own, &get).unwrap().map(|u| u.to_string())
        };
        assert_eq!(
            host("api.elevenlabs.io", None).as_deref(),
            Some("http://10.0.0.1:3128/")
        );
        assert_eq!(
            host("api.elevenlabs.io", Some("http://127.0.0.1:12334")).as_deref(),
            Some("http://127.0.0.1:12334/")
        );
        for local in [
            "localhost",
            "127.0.0.1",
            "[::1]",
            "db.internal",
            "192.168.1.5",
        ] {
            assert_eq!(host(local, Some("http://127.0.0.1:12334")), None, "{local}");
        }
        assert!(for_host_with("api.elevenlabs.io", Some("https://x:1"), vars(&[])).is_err());
    }

    #[test]
    fn password_is_hidden_and_decoded() {
        assert_eq!(
            hide("http://me:s%40cret@127.0.0.1:12334"),
            "http://127.0.0.1:12334"
        );
        assert_eq!(decode("s%40cret"), "s@cret");
    }
}

#[cfg(test)]
mod rate_tests {
    use super::*;
    use tokio::time::Instant;

    #[tokio::test]
    async fn different_hosts_have_independent_queues() {
        // URL — только ключи очереди: никаких сетевых запросов в этом тесте.
        let first = Url::parse("https://rate-first.invalid").unwrap();
        let second = Url::parse("https://rate-second.invalid").unwrap();
        one_per_second(&first).await;
        let began = Instant::now();
        let (first_wait, second_wait) = tokio::join!(
            async {
                one_per_second(&first).await;
                began.elapsed()
            },
            async {
                one_per_second(&second).await;
                began.elapsed()
            }
        );
        assert!(first_wait >= Duration::from_secs(1));
        assert!(second_wait < Duration::from_millis(500));
    }
}
