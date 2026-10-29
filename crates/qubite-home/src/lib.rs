//! Главная Qubite (HOME-001): погода, курсы и новости для экрана «Главная».
//!
//! Всё — из открытых источников **без ключей**, через сервер (браузер в
//! чужие службы не ходит, D-298):
//!
//! - погода — Open-Meteo ([`weather`]), город ищется там же ([`places`]);
//!   «определить по геолокации» — обратный поиск OpenStreetMap (Nominatim),
//!   координаты человека не хранятся: только найденный город (D-328);
//! - курсы — ЦБ РФ и запасной источник ER-API ([`rates`]);
//! - выбранные монеты и поиск — CoinGecko ([`coins`]);
//! - новости по темам — RSS Хабра и соревнования Codeforces ([`news`]).
//!
//! Ответы держатся в памяти сервера ([`cache`]): погода — 30 минут, курсы и
//! RSS — час, монеты — 5 минут, Codeforces — 15 минут.
//! Источник не ответил — отдаём последнее известное с
//! пометкой «устарело». Настройки виджетов (город, валюты, монеты, темы) —
//! [`settings`]. Сводку от AI пишет агент (`qubite-agent`, `home.digest.write`).
//! Решения — D-340…D-349, D-700…D-705.

pub mod cache;
pub mod coins;
pub mod news;
pub mod places;
pub mod rates;
pub mod settings;
pub mod weather;

use std::time::Duration;

pub use coins::{Coin, CoinMatch};
pub use news::{NewsItem, Topic};
pub use places::Place;
pub use rates::{Rate, Rates};
pub use settings::Settings;
pub use weather::Weather;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("{0}")]
    Invalid(String),
    /// Источник не ответил или ответил непонятно.
    #[error("источник недоступен: {0}")]
    Upstream(String),
    /// Не нашли (город по координатам).
    #[error("{0}")]
    NotFound(String),
    #[error("ошибка базы данных: {0}")]
    Db(#[from] sqlx::Error),
}

pub type Result<T, E = Error> = std::result::Result<T, E>;

/// Адреса источников. В тестах всё смотрит на поддельный сервер.
#[derive(Debug, Clone)]
pub struct Urls {
    /// Прогноз Open-Meteo: `…/v1/forecast`.
    pub forecast: String,
    /// Поиск города Open-Meteo: `…/v1/search`.
    pub geocoding: String,
    /// Город по координатам (Nominatim): `…/reverse`.
    pub reverse: String,
    /// Курсы ЦБ: `…/scripts/XML_daily.asp`.
    pub rates: String,
    /// Запасной источник валют: `…/v6/latest/USD`.
    pub fx: String,
    /// CoinGecko: `…/api/v3/…`.
    pub coins: String,
    /// Codeforces: `…/api/contest.list`.
    pub contests: String,
    /// Ленты новостей по темам.
    pub feeds: Vec<(Topic, String)>,
}

impl Default for Urls {
    fn default() -> Self {
        Self {
            forecast: "https://api.open-meteo.com".into(),
            geocoding: "https://geocoding-api.open-meteo.com".into(),
            reverse: "https://nominatim.openstreetmap.org".into(),
            rates: "https://www.cbr.ru".into(),
            fx: "https://open.er-api.com".into(),
            coins: "https://api.coingecko.com".into(),
            contests: "https://codeforces.com".into(),
            feeds: news::default_feeds(),
        }
    }
}

impl Urls {
    /// Всё на одном сервере (поддельном в тестах): `root/v1/forecast`,
    /// `root/v1/search`, `root/reverse`, `root/scripts/XML_daily.asp`, `root/rss/<тема>`.
    pub fn local(root: &str) -> Self {
        let root = root.trim_end_matches('/');
        Self {
            forecast: root.into(),
            geocoding: root.into(),
            reverse: root.into(),
            rates: root.into(),
            fx: root.into(),
            coins: root.into(),
            contests: root.into(),
            feeds: Topic::ALL
                .iter()
                .filter(|topic| **topic != Topic::Contests)
                .map(|topic| (*topic, format!("{root}/rss/{}", topic.as_str())))
                .collect(),
        }
    }
}

/// Источники Главной: HTTP-клиент, адреса и кэш.
pub struct Sources {
    http: reqwest::Client,
    urls: Urls,
    weather: cache::Cache<Weather>,
    rates: cache::Cache<rates::Table>,
    fx: cache::Cache<rates::FxTable>,
    coins: cache::Cache<Vec<Coin>>,
    coin_search: cache::Cache<Vec<CoinMatch>>,
    contests: cache::Cache<Vec<NewsItem>>,
    news: cache::Cache<Vec<NewsItem>>,
    places: cache::Cache<Vec<Place>>,
}

impl Default for Sources {
    fn default() -> Self {
        Self::new(Urls::default())
    }
}

impl Sources {
    pub fn new(urls: Urls) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(8))
            // Nominatim требует понятное имя приложения.
            .user_agent(concat!(
                "qubite/",
                env!("CARGO_PKG_VERSION"),
                " (+https://github.com/kirillkuz1122/qubite)"
            ))
            .build()
            .expect("HTTP-клиент собирается с настройками по умолчанию");
        Self {
            http,
            urls,
            weather: cache::Cache::new(Duration::from_secs(30 * 60)),
            rates: cache::Cache::new(Duration::from_secs(60 * 60)),
            fx: cache::Cache::new(Duration::from_secs(60 * 60)),
            coins: cache::Cache::new(Duration::from_secs(5 * 60)),
            coin_search: cache::Cache::new(Duration::from_secs(60 * 60)),
            contests: cache::Cache::new(Duration::from_secs(15 * 60)),
            news: cache::Cache::new(Duration::from_secs(60 * 60)),
            places: cache::Cache::new(Duration::from_secs(24 * 60 * 60)),
        }
    }

    pub fn urls(&self) -> &Urls {
        &self.urls
    }

    /// Состарить весь кэш, будто прошло время (тест «источник лёг»).
    #[doc(hidden)]
    pub fn expire_cache(&self) {
        self.weather.expire();
        self.rates.expire();
        self.fx.expire();
        self.coins.expire();
        self.coin_search.expire();
        self.contests.expire();
        self.news.expire();
        self.places.expire();
    }
}

/// Скачать ответ; не 2xx — ошибка источника.
async fn fetch_bytes(request: reqwest::RequestBuilder) -> Result<Vec<u8>> {
    let response = request
        .send()
        .await
        .map_err(|error| Error::Upstream(error.without_url().to_string()))?;
    let status = response.status();
    if !status.is_success() {
        return Err(Error::Upstream(format!("ответ {status}")));
    }
    Ok(response
        .bytes()
        .await
        .map_err(|error| Error::Upstream(error.without_url().to_string()))?
        .to_vec())
}

async fn fetch_json<T: serde::de::DeserializeOwned>(request: reqwest::RequestBuilder) -> Result<T> {
    let bytes = fetch_bytes(request).await?;
    serde_json::from_slice(&bytes).map_err(|error| Error::Upstream(format!("не JSON: {error}")))
}

/// `ГГГГ-ММ-ДД`.
pub fn format_date(date: time::Date) -> String {
    format!(
        "{:04}-{:02}-{:02}",
        date.year(),
        u8::from(date.month()),
        date.day()
    )
}
