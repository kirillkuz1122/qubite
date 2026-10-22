//! Туннель через прокси (HTTP CONNECT и SOCKS5) на поддельных прокси: прокси
//! запоминает, куда просили, и соединяет с эхо-сервером.

use std::{
    sync::{Arc, Mutex},
    time::Duration,
};

use qubite_net::{Url, tunnel};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt, copy_bidirectional},
    net::{TcpListener, TcpStream},
};

async fn echo() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            tokio::spawn(async move {
                let (mut r, mut w) = socket.split();
                let _ = tokio::io::copy(&mut r, &mut w).await;
            });
        }
    });
    port
}

/// HTTP-прокси: читает CONNECT, отвечает 200 и соединяет с эхо.
async fn http_proxy(target: u16, seen: Arc<Mutex<Vec<String>>>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut head = Vec::new();
                while !head.ends_with(b"\r\n\r\n") {
                    let mut b = [0u8; 1];
                    socket.read_exact(&mut b).await.unwrap();
                    head.push(b[0]);
                }
                seen.lock()
                    .unwrap()
                    .push(String::from_utf8_lossy(&head).into_owned());
                socket
                    .write_all(b"HTTP/1.1 200 Connection established\r\n\r\n")
                    .await
                    .unwrap();
                let mut upstream = TcpStream::connect(("127.0.0.1", target)).await.unwrap();
                let _ = copy_bidirectional(&mut socket, &mut upstream).await;
            });
        }
    });
    port
}

/// SOCKS5 с логином: проверяет вход, запоминает хост и порт, соединяет с эхо.
async fn socks_proxy(target: u16, seen: Arc<Mutex<Vec<String>>>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        while let Ok((mut s, _)) = listener.accept().await {
            let seen = seen.clone();
            tokio::spawn(async move {
                let mut hello = [0u8; 4];
                s.read_exact(&mut hello).await.unwrap();
                assert_eq!(hello, [5, 2, 0, 2], "предлагает вход по логину");
                s.write_all(&[5, 2]).await.unwrap();
                let mut ver = [0u8; 2];
                s.read_exact(&mut ver).await.unwrap();
                let mut user = vec![0u8; usize::from(ver[1])];
                s.read_exact(&mut user).await.unwrap();
                let mut plen = [0u8; 1];
                s.read_exact(&mut plen).await.unwrap();
                let mut pass = vec![0u8; usize::from(plen[0])];
                s.read_exact(&mut pass).await.unwrap();
                s.write_all(&[1, 0]).await.unwrap();
                let mut req = [0u8; 5];
                s.read_exact(&mut req).await.unwrap();
                assert_eq!(&req[..4], &[5, 1, 0, 3], "имя хоста — прокси, не мы");
                let mut name = vec![0u8; usize::from(req[4])];
                s.read_exact(&mut name).await.unwrap();
                let mut port = [0u8; 2];
                s.read_exact(&mut port).await.unwrap();
                seen.lock().unwrap().push(format!(
                    "{}:{} {}:{}",
                    String::from_utf8_lossy(&user),
                    String::from_utf8_lossy(&pass),
                    String::from_utf8_lossy(&name),
                    u16::from_be_bytes(port)
                ));
                s.write_all(&[5, 0, 0, 1, 0, 0, 0, 0, 0, 0]).await.unwrap();
                let mut upstream = TcpStream::connect(("127.0.0.1", target)).await.unwrap();
                let _ = copy_bidirectional(&mut s, &mut upstream).await;
            });
        }
    });
    port
}

async fn round_trip(mut stream: TcpStream) {
    stream.write_all(b"hello").await.unwrap();
    let mut back = [0u8; 5];
    stream.read_exact(&mut back).await.unwrap();
    assert_eq!(&back, b"hello");
}

#[tokio::test]
async fn http_connect_tunnel_reaches_the_host_with_basic_auth() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let proxy = http_proxy(echo().await, seen.clone()).await;
    let url = Url::parse(&format!("http://me:s%40cret@127.0.0.1:{proxy}")).unwrap();
    let stream = tunnel(&url, "api.elevenlabs.io", 443, Duration::from_secs(5))
        .await
        .unwrap();
    round_trip(stream).await;
    let head = seen.lock().unwrap()[0].clone();
    assert!(
        head.starts_with("CONNECT api.elevenlabs.io:443 HTTP/1.1\r\n"),
        "{head}"
    );
    // me:s@cret
    assert!(
        head.contains("Proxy-Authorization: Basic bWU6c0BjcmV0\r\n"),
        "{head}"
    );
}

#[tokio::test]
async fn socks5_tunnel_sends_host_name_and_login() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let proxy = socks_proxy(echo().await, seen.clone()).await;
    let url = Url::parse(&format!("socks5h://me:pw@127.0.0.1:{proxy}")).unwrap();
    let stream = tunnel(&url, "api.elevenlabs.io", 443, Duration::from_secs(5))
        .await
        .unwrap();
    round_trip(stream).await;
    assert_eq!(seen.lock().unwrap()[0], "me:pw api.elevenlabs.io:443");
}

#[tokio::test]
async fn proxy_refusal_is_an_error() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        let (mut s, _) = listener.accept().await.unwrap();
        let mut buf = [0u8; 256];
        let _ = s.read(&mut buf).await;
        s.write_all(b"HTTP/1.1 407 Proxy Authentication Required\r\n\r\n")
            .await
            .unwrap();
    });
    let url = Url::parse(&format!("http://127.0.0.1:{port}")).unwrap();
    let error = tunnel(&url, "api.elevenlabs.io", 443, Duration::from_secs(5))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("407"), "{error}");
}
