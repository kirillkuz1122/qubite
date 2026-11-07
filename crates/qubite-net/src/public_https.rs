//! Адреса, введённые человеком: только публичный HTTPS без редиректов.
//! DNS проверяется перед каждым новым клиентом и закрепляется в его resolver.

use std::{net::IpAddr, net::SocketAddr, time::Duration};

use crate::Url;

pub const MAX_URL_BYTES: usize = 2048;

/// Только синтаксис и буквальные адреса; DNS — в `client`.
pub fn parse(raw: &str) -> Result<Url, String> {
    let bad = || "Нужен публичный адрес https без логина, параметров и фрагмента".to_owned();
    if raw.len() > MAX_URL_BYTES || raw.bytes().any(|b| b.is_ascii_control() || b == b' ') {
        return Err(bad());
    }
    let url = Url::parse(raw).map_err(|_| bad())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return Err(bad());
    }
    let host = url.host_str().ok_or_else(bad)?;
    let host = host
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.');
    if host.eq_ignore_ascii_case("localhost")
        || host.to_ascii_lowercase().ends_with(".localhost")
        || host.to_ascii_lowercase().ends_with(".local")
        || host.parse::<IpAddr>().is_ok_and(|ip| !public_ip(ip))
    {
        return Err(bad());
    }
    Ok(url)
}

fn public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => {
            let [a, b, c, _] = ip.octets();
            !matches!(a, 0 | 10 | 127 | 224..=255)
                && !(a == 100 && (64..=127).contains(&b))
                && !(a == 169 && b == 254)
                && !(a == 172 && (16..=31).contains(&b))
                && !(a == 192 && (b == 168 || (b == 0 && (c == 0 || c == 2))))
                && !(a == 192 && b == 88 && c == 99)
                && !(a == 198 && (b == 18 || b == 19 || (b == 51 && c == 100)))
                && !(a == 203 && b == 0 && c == 113)
        }
        IpAddr::V6(ip) => {
            // Только global unicast. Не допускаем mapped IPv4, NAT64,
            // Teredo, 6to4 и прочие переходы с вложенным частным IPv4.
            let s = ip.segments();
            s[0] & 0xe000 == 0x2000
                && !(s[0] == 0x2001 && (s[1] < 0x0200 || s[1] == 0x0db8))
                && s[0] != 0x2002
                && !(s[0] == 0x3fff && s[1] < 0x1000)
        }
    }
}

fn checked_addresses(addresses: Vec<SocketAddr>) -> Result<Vec<SocketAddr>, String> {
    if addresses.is_empty() || addresses.iter().any(|a| !public_ip(a.ip())) {
        return Err("Адрес сервиса ведёт в локальную или служебную сеть".into());
    }
    Ok(addresses)
}

/// Для недоверенного адреса прокси отключён намеренно: иначе DNS выполняет
/// прокси и закрепить проверенные IP средствами reqwest нельзя. Обычные
/// клиенты `qubite_net::client` продолжают работать через настроенный прокси.
pub async fn client(url: &Url) -> Result<reqwest::ClientBuilder, String> {
    let url = parse(url.as_str())?;
    let host = url.host_str().ok_or("В адресе нет хоста")?;
    let name = host.trim_start_matches('[').trim_end_matches(']');
    let port = url.port_or_known_default().ok_or("В адресе нет порта")?;
    let addresses = if let Ok(ip) = name.parse::<IpAddr>() {
        vec![SocketAddr::new(ip, port)]
    } else {
        tokio::time::timeout(Duration::from_secs(5), tokio::net::lookup_host((name, port)))
            .await
            .map_err(|_| "Не удалось проверить адрес сервиса вовремя")?
            .map_err(|_| "Не удалось найти адрес сервиса")?
            .collect()
    };
    let addresses = checked_addresses(addresses)?;
    Ok(crate::client(None)?
        .no_proxy()
        .resolve_to_addrs(name, &addresses)
        .redirect(reqwest::redirect::Policy::none()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_non_public_urls_and_unbounded_input() {
        for raw in [
            "http://api.openai.com/v1",
            "https://localhost/v1",
            "https://x.localhost./v1",
            "https://127.1/v1",
            "https://2130706433/v1",
            "https://10.0.0.1/v1",
            "https://172.16.0.1/v1",
            "https://192.168.1.1/v1",
            "https://169.254.169.254/",
            "https://100.64.0.1/",
            "https://[::1]/",
            "https://[::ffff:127.0.0.1]/",
            "https://[fc00::1]/",
            "https://[fe80::1]/",
            "https://[64:ff9b::a00:1]/",
            "https://user:secret@example.com/",
            "https://example.com/?key=secret",
            "https://example.com/#secret",
            "https://example.com/\n",
        ] {
            assert!(parse(raw).is_err(), "{raw}");
        }
        assert!(parse(&format!("https://example.com/{}", "a".repeat(MAX_URL_BYTES))).is_err());
        assert!(parse("https://api.openai.com/v1").is_ok());
        assert!(parse("https://8.8.8.8/v1").is_ok());
    }

    #[test]
    fn rejects_private_dns_answers_including_mixed_answers() {
        let public = "8.8.8.8:443".parse().unwrap();
        for private in [
            "127.0.0.1:443",
            "10.0.0.1:443",
            "[::1]:443",
            "[::ffff:10.0.0.1]:443",
        ] {
            assert!(checked_addresses(vec![public, private.parse().unwrap()]).is_err());
        }
        assert!(checked_addresses(vec![]).is_err());
        assert!(checked_addresses(vec![public]).is_ok());
    }
}
