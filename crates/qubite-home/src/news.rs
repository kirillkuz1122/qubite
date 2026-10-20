//! Новости по темам (D-309): ИИ и технологии, программирование, олимпиады и
//! учёба. Источник — RSS Хабра (без ключа, по-русски, ленты по хабам).
//! Разбор RSS 2.0 и Atom — свой, маленький: нужны только заголовок, ссылка и
//! дата.

use serde::Serialize;
use time::{
    OffsetDateTime,
    format_description::well_known::{Rfc2822, Rfc3339},
};

use crate::{Error, Result, Sources, cache::Got, fetch_bytes};

/// Сколько новостей на тему.
pub const PER_TOPIC: usize = 3;
const MAX_TITLE_CHARS: usize = 300;

/// Тема новостей.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Topic {
    /// ИИ и технологии.
    Ai,
    /// Программирование.
    Code,
    /// Олимпиады и учёба.
    Study,
}

impl Topic {
    pub const ALL: [Self; 3] = [Self::Ai, Self::Code, Self::Study];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ai => "ai",
            Self::Code => "code",
            Self::Study => "study",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Self::Ai => "ИИ и технологии",
            Self::Code => "Программирование",
            Self::Study => "Олимпиады и учёба",
        }
    }

    pub fn parse(text: &str) -> Result<Self> {
        Self::ALL
            .into_iter()
            .find(|topic| topic.as_str() == text)
            .ok_or_else(|| Error::Invalid(format!("неизвестная тема {text}")))
    }
}

/// Ленты по темам. У темы может быть несколько лент — новости смешиваются по дате.
pub fn default_feeds() -> Vec<(Topic, String)> {
    let hub = |slug: &str| format!("https://habr.com/ru/rss/hubs/{slug}/articles/?fl=ru");
    vec![
        (Topic::Ai, hub("artificial_intelligence")),
        (Topic::Code, hub("programming")),
        (Topic::Study, hub("sport_programming")),
        (Topic::Study, hub("study")),
    ]
}

/// Новость.
#[derive(Debug, Clone, Serialize)]
pub struct NewsItem {
    pub topic: Topic,
    pub title: String,
    /// Только `https://` (остальное отбрасываем).
    pub url: String,
    #[serde(with = "time::serde::rfc3339::option")]
    pub published: Option<OffsetDateTime>,
    /// «Хабр».
    pub source: String,
}

fn between<'a>(text: &'a str, open: &str, close: &str) -> Option<&'a str> {
    let start = text.find(open)? + open.len();
    let end = text[start..].find(close)? + start;
    Some(&text[start..end])
}

/// Содержимое тега `<name …>…</name>`: без атрибутов, CDATA и сущностей.
fn tag_text(block: &str, name: &str) -> Option<String> {
    let open = format!("<{name}");
    let mut from = 0;
    // `<title` не должен совпасть с `<titlex`.
    let start = loop {
        let at = block[from..].find(&open)? + from;
        let after = block[at + open.len()..].chars().next()?;
        if after == '>' || after.is_whitespace() {
            break at;
        }
        from = at + open.len();
    };
    let body_start = block[start..].find('>')? + start + 1;
    if block[..body_start].ends_with("/>") {
        return None;
    }
    let close = format!("</{name}>");
    let end = block[body_start..].find(&close)? + body_start;
    let raw = block[body_start..end].trim();
    let raw = raw
        .strip_prefix("<![CDATA[")
        .and_then(|rest| rest.strip_suffix("]]>"))
        .unwrap_or(raw);
    Some(unescape(raw.trim()))
}

fn unescape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        rest = &rest[at..];
        let Some(end) = rest.find(';').filter(|end| *end <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let ch = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            "nbsp" => Some(' '),
            "laquo" => Some('«'),
            "raquo" => Some('»'),
            "mdash" => Some('—'),
            "ndash" => Some('–'),
            _ => entity
                .strip_prefix("#x")
                .and_then(|hex| u32::from_str_radix(hex, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|dec| dec.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(ch) => {
                out.push(ch);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    // В заголовках бывают теги — убираем.
    let mut plain = String::with_capacity(out.len());
    let mut inside = false;
    for ch in out.chars() {
        match ch {
            '<' => inside = true,
            '>' if inside => inside = false,
            _ if !inside => plain.push(ch),
            _ => {}
        }
    }
    plain.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn clean_url(url: &str) -> Option<String> {
    let url = url.trim();
    if !url.starts_with("https://") || url.len() > 2000 || url.contains(char::is_whitespace) {
        return None;
    }
    // Метки рекламы не нужны.
    let url = match url.split_once('?') {
        Some((base, query)) if query.split('&').all(|part| part.starts_with("utm_")) => base,
        _ => url,
    };
    Some(url.to_owned())
}

fn parse_when(text: &str) -> Option<OffsetDateTime> {
    let text = text.trim();
    OffsetDateTime::parse(text, &Rfc2822)
        .or_else(|_| OffsetDateTime::parse(text, &Rfc3339))
        .ok()
}

/// Разобрать ленту RSS 2.0 или Atom.
pub fn parse(topic: Topic, source: &str, bytes: &[u8]) -> Result<Vec<NewsItem>> {
    let text = String::from_utf8_lossy(bytes);
    let (marker, close) = if text.contains("<item") {
        ("<item", "</item>")
    } else if text.contains("<entry") {
        ("<entry", "</entry>")
    } else if text.contains("<rss") || text.contains("<feed") {
        return Ok(Vec::new());
    } else {
        return Err(Error::Upstream("не лента новостей".into()));
    };
    let mut items = Vec::new();
    for chunk in text.split(marker).skip(1) {
        let block = chunk.split(close).next().unwrap_or(chunk);
        let Some(title) = tag_text(block, "title").filter(|title| !title.is_empty()) else {
            continue;
        };
        let link = tag_text(block, "link")
            .filter(|link| !link.is_empty())
            .or_else(|| {
                // Atom: <link href="…"/>
                between(block, "<link", ">")
                    .and_then(|attrs| between(attrs, "href=\"", "\""))
                    .map(unescape)
            });
        let Some(url) = link.as_deref().and_then(clean_url) else {
            continue;
        };
        let published = ["pubDate", "published", "updated", "dc:date"]
            .into_iter()
            .find_map(|name| tag_text(block, name).as_deref().and_then(parse_when));
        items.push(NewsItem {
            topic,
            title: title.chars().take(MAX_TITLE_CHARS).collect(),
            url,
            published,
            source: source.to_owned(),
        });
    }
    Ok(items)
}

fn source_of(url: &str) -> &'static str {
    if url.contains("habr.com") {
        "Хабр"
    } else {
        "лента"
    }
}

impl Sources {
    async fn feed(&self, topic: Topic, url: &str) -> Result<Got<Vec<NewsItem>>> {
        let request = self.http.get(url);
        let source = source_of(url);
        self.news
            .get(url, || async move {
                parse(topic, source, &fetch_bytes(request).await?)
            })
            .await
    }

    /// Новости выбранных тем: по [`PER_TOPIC`] свежих на тему, темы — в
    /// порядке настройки. Лента не ответила — тема без неё (остальные есть).
    pub async fn news(&self, topics: &[Topic]) -> Result<Got<Vec<NewsItem>>> {
        let mut out = Vec::new();
        let mut stale = false;
        let mut fetched_at = OffsetDateTime::now_utc();
        let mut failed = None;
        let mut any = false;
        for topic in topics {
            let mut items = Vec::new();
            for (feed_topic, url) in &self.urls.feeds {
                if feed_topic != topic {
                    continue;
                }
                match self.feed(*topic, url).await {
                    Ok(got) => {
                        any = true;
                        stale |= got.stale;
                        fetched_at = fetched_at.min(got.fetched_at);
                        items.extend(got.value);
                    }
                    // Лента не ответила и в кэше её нет — тема просто без неё.
                    Err(error) => failed = Some(error),
                }
            }
            items.sort_by_key(|item| std::cmp::Reverse(item.published));
            let mut seen = std::collections::HashSet::new();
            items.retain(|item| seen.insert(item.url.clone()));
            out.extend(items.into_iter().take(PER_TOPIC));
        }
        if !any && let Some(error) = failed {
            return Err(error);
        }
        Ok(Got {
            value: out,
            fetched_at,
            stale,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_rss_with_cdata_and_entities() {
        let rss = r#"<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Хабр</title><link>https://habr.com/</link>
<item><title><![CDATA[Новая модель &laquo;умеет&raquo; <b>всё</b>]]></title>
<link>https://habr.com/ru/articles/1/?utm_source=habrahabr&amp;utm_medium=rss</link>
<pubDate>Tue, 20 Oct 2026 07:30:00 GMT</pubDate></item>
<item><title>Без ссылки</title></item>
<item><title>Не https</title><link>http://example.com/x</link></item>
<item><title>Rust &amp; C++</title><link>https://habr.com/ru/articles/2/</link></item>
</channel></rss>"#;
        let items = parse(Topic::Ai, "Хабр", rss.as_bytes()).unwrap();
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].title, "Новая модель «умеет» всё");
        assert_eq!(items[0].url, "https://habr.com/ru/articles/1/");
        assert!(items[0].published.is_some());
        assert_eq!(items[1].title, "Rust & C++");
        assert!(items[1].published.is_none());
    }

    #[test]
    fn parses_atom() {
        let atom = r#"<feed xmlns="http://www.w3.org/2005/Atom"><title>x</title>
<entry><title type="html">Олимпиада по информатике</title><link rel="alternate" href="https://example.org/a"/>
<updated>2026-10-19T10:00:00Z</updated></entry></feed>"#;
        let items = parse(Topic::Study, "лента", atom.as_bytes()).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].url, "https://example.org/a");
        assert!(items[0].published.is_some());
    }

    #[test]
    fn not_a_feed_is_an_error() {
        assert!(parse(Topic::Ai, "x", b"<html><body>captcha</body></html>").is_err());
        assert!(
            parse(Topic::Ai, "x", b"<rss><channel></channel></rss>")
                .unwrap()
                .is_empty()
        );
    }
}
