//! Главная (HOME-001): сводка от AI, что агент разложил, что пришло в
//! тишину, погода, курсы, новости и настройки виджетов.
//!
//! Дела на сегодня, Входящие и ближайшие сроки экран берёт из своих данных
//! (синхронизация), сюда за ними не ходит. Погода, курсы и новости — из
//! открытых источников без ключей через сервер, с кэшем (`qubite-home`).
//! Сводка — только с грантом на агента; без него Главная живёт без неё.

use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
};
use qubite_agent::{Who, digest};
use qubite_home::{Place, Topic, cache::Got, settings};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

use crate::{
    AppState,
    auth::{ApiError, ApiErrorBody, Authenticated},
    notices::NoticeItem,
};

fn home_error(error: qubite_home::Error) -> ApiError {
    match error {
        qubite_home::Error::Invalid(message) => {
            ApiError::new(StatusCode::BAD_REQUEST, "invalid", message)
        }
        qubite_home::Error::NotFound(message) => {
            ApiError::new(StatusCode::NOT_FOUND, "not_found", message)
        }
        qubite_home::Error::Upstream(message) => {
            tracing::warn!(%message, "Главная: источник недоступен");
            ApiError::new(
                StatusCode::BAD_GATEWAY,
                "upstream",
                "Источник сейчас не отвечает — попробуйте позже",
            )
        }
        qubite_home::Error::Db(error) => {
            tracing::error!(%error, "Главная: ошибка базы");
            ApiError::internal()
        }
    }
}

fn internal(error: impl std::fmt::Display) -> ApiError {
    tracing::error!(%error, "Главная: внутренняя ошибка");
    ApiError::internal()
}

async fn load_settings(state: &AppState, account: Uuid) -> Result<qubite_home::Settings, ApiError> {
    let mut conn = state.db.pool().acquire().await.map_err(internal)?;
    settings::load(&mut conn, account).await.map_err(home_error)
}

// ---------------------------------------------------------------- настройки

/// Город погоды.
#[derive(Debug, Serialize, Deserialize, ToSchema)]
pub struct HomePlace {
    /// «Челябинск».
    name: String,
    /// «Челябинская область, Россия».
    region: String,
    latitude: f64,
    longitude: f64,
}

impl From<Place> for HomePlace {
    fn from(place: Place) -> Self {
        Self {
            name: place.name,
            region: place.region,
            latitude: place.latitude,
            longitude: place.longitude,
        }
    }
}

/// Настройки виджетов Главной.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeSettings {
    place: HomePlace,
    /// До 8 кодов валют в порядке показа: `USD`, `EUR`, `CNY`, `PHP`.
    currencies: Vec<String>,
    /// Идентификаторы выбранных монет CoinGecko.
    coins: Vec<String>,
    /// Каталог доступных тем.
    available_topics: Vec<HomeTopic>,
    /// Темы новостей: `ai` — ИИ и технологии, `code` — программирование,
    /// `study` — олимпиады и учёба, `contests` — соревнования. Пусто — без новостей.
    topics: Vec<String>,
}

impl From<qubite_home::Settings> for HomeSettings {
    fn from(settings: qubite_home::Settings) -> Self {
        Self {
            place: settings.place().into(),
            topics: settings
                .topics
                .iter()
                .map(|topic| topic.as_str().to_owned())
                .collect(),
            currencies: settings.currencies,
            coins: settings.coins,
            available_topics: Topic::ALL
                .into_iter()
                .map(|topic| HomeTopic {
                    id: topic.as_str().into(),
                    title: topic.title().into(),
                })
                .collect(),
        }
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeTopic {
    id: String,
    title: String,
}

/// Настройки виджетов и каталог тем.
#[utoipa::path(get, path = "/api/v1/home/settings", tag = "home",
    responses(
        (status = 200, description = "Настройки", body = HomeSettings),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn get_settings(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<HomeSettings>, ApiError> {
    Ok(Json(
        load_settings(&state, session.0.account_id).await?.into(),
    ))
}

/// Изменение настроек: только то, что меняется.
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct HomeSettingsChange {
    /// Город из поиска (`/api/v1/home/places`).
    place: Option<HomePlace>,
    /// До 8 кодов валют.
    currencies: Option<Vec<String>>,
    /// До 6 идентификаторов CoinGecko.
    coins: Option<Vec<String>>,
    topics: Option<Vec<String>>,
}

/// Изменить город, валюты или темы новостей.
#[utoipa::path(patch, path = "/api/v1/home/settings", tag = "home",
    request_body = HomeSettingsChange,
    responses(
        (status = 200, description = "Сохранено", body = HomeSettings),
        (status = 400, description = "Неверные значения", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn change_settings(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<HomeSettingsChange>,
) -> Result<Json<HomeSettings>, ApiError> {
    let change = settings::Change {
        place: body.place.map(|place| Place {
            name: place.name,
            region: place.region,
            latitude: place.latitude,
            longitude: place.longitude,
        }),
        currencies: body.currencies,
        coins: body.coins,
        topics: body.topics,
    };
    let mut conn = state.db.pool().acquire().await.map_err(internal)?;
    let saved = settings::save(&mut conn, session.0.account_id, &change)
        .await
        .map_err(home_error)?;
    Ok(Json(saved.into()))
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct PlacesQuery {
    /// Название города (от 2 букв).
    q: String,
}

/// Найденные города.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomePlaces {
    items: Vec<HomePlace>,
}

/// Найти город по названию (для настройки погоды).
#[utoipa::path(get, path = "/api/v1/home/places", tag = "home", params(PlacesQuery),
    responses(
        (status = 200, description = "До 5 городов", body = HomePlaces),
        (status = 400, description = "Слишком длинный запрос", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 502, description = "Поиск городов сейчас не отвечает", body = ApiErrorBody),
    ))]
pub async fn places(
    State(state): State<AppState>,
    _session: Authenticated,
    Query(query): Query<PlacesQuery>,
) -> Result<Json<HomePlaces>, ApiError> {
    let found = state
        .home
        .search_places(&query.q)
        .await
        .map_err(home_error)?;
    Ok(Json(HomePlaces {
        items: found.into_iter().map(HomePlace::from).collect(),
    }))
}

/// Координаты из браузера (геолокация).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(deny_unknown_fields)]
pub struct LocateRequest {
    latitude: f64,
    longitude: f64,
}

/// «Определить по геолокации»: найти город по координатам браузера и
/// поставить его в настройку. Координаты не сохраняются — только город и
/// его точка из справочника (D-328).
#[utoipa::path(post, path = "/api/v1/home/locate", tag = "home",
    request_body = LocateRequest,
    responses(
        (status = 200, description = "Город найден и сохранён", body = HomeSettings),
        (status = 400, description = "Неверные координаты", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 404, description = "По этому месту город не нашёлся", body = ApiErrorBody),
        (status = 502, description = "Поиск сейчас не отвечает", body = ApiErrorBody),
    ))]
pub async fn locate(
    State(state): State<AppState>,
    session: Authenticated,
    Json(body): Json<LocateRequest>,
) -> Result<Json<HomeSettings>, ApiError> {
    let place = state
        .home
        .locate(body.latitude, body.longitude)
        .await
        .map_err(home_error)?;
    let mut conn = state.db.pool().acquire().await.map_err(internal)?;
    let saved = settings::save(
        &mut conn,
        session.0.account_id,
        &settings::Change {
            place: Some(place),
            ..settings::Change::default()
        },
    )
    .await
    .map_err(home_error)?;
    Ok(Json(saved.into()))
}

// ---------------------------------------------------------------- обзор

/// Куда ведёт пункт сводки.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeDigestLink {
    /// `task`, `project`, `inbox`, `action` (запись ленты агента) или `url` (статья).
    #[serde(rename = "type")]
    kind: String,
    id: Option<Uuid>,
    /// Название дела, проекта, мысли или записи ленты.
    title: Option<String>,
    /// Статья — только `https://`.
    url: Option<String>,
}

/// Пункт сводки от AI.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeDigestItem {
    /// `important` — важное, `noticed` — что агент заметил, `question` —
    /// вопрос агента, `news` — новость, `tip` — что AI считает нужным.
    kind: String,
    text: String,
    link: HomeDigestLink,
}

/// Сводка от AI на сегодня.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeDigest {
    id: Uuid,
    /// Строка ленты агента: там видно «почему» и можно откатить.
    action_id: Uuid,
    #[serde(with = "time::serde::rfc3339")]
    created_at: OffsetDateTime,
    items: Vec<HomeDigestItem>,
}

impl From<digest::Digest> for HomeDigest {
    fn from(digest: digest::Digest) -> Self {
        Self {
            id: digest.id,
            action_id: digest.action_id,
            created_at: digest.created_at,
            items: digest
                .items
                .into_iter()
                .map(|item| {
                    let kind = serde_json::to_value(item.kind)
                        .ok()
                        .and_then(|value| value.as_str().map(str::to_owned))
                        .unwrap_or_default();
                    let link = match item.link {
                        digest::Link::Task { id, title } => ("task", Some(id), Some(title), None),
                        digest::Link::Project { id, title } => {
                            ("project", Some(id), Some(title), None)
                        }
                        digest::Link::Inbox { id, title } => ("inbox", Some(id), Some(title), None),
                        digest::Link::Action { id, title } => {
                            ("action", Some(id), Some(title), None)
                        }
                        digest::Link::Url { url } => ("url", None, None, Some(url)),
                    };
                    HomeDigestItem {
                        kind,
                        text: item.text,
                        link: HomeDigestLink {
                            kind: link.0.into(),
                            id: link.1,
                            title: link.2,
                            url: link.3,
                        },
                    }
                })
                .collect(),
        }
    }
}

/// Что агент разложил из Входящих.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeFiled {
    /// Строка ленты агента.
    action_id: Uuid,
    /// «Разложил мысль «…» → дело «…»».
    summary: String,
    reason: Option<String>,
    /// Что получилось (дело или проект).
    object_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339")]
    at: OffsetDateTime,
}

/// Главная: то, что знает только сервер.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeOverview {
    settings: HomeSettings,
    /// Агент включён (есть грант): тогда есть место для сводки.
    agent: bool,
    /// Сводка от AI на сегодня; нет — агент её ещё не написал или его нет.
    digest: Option<HomeDigest>,
    /// Что агент разложил из Входящих за сутки.
    filed: Vec<HomeFiled>,
    /// Не прочитанное, что пришло в тишину (ночью, на уроке): утренняя сводка (D-319).
    held: Vec<NoticeItem>,
}

/// Главная: настройки, сводка от AI, что агент разложил и что пришло в тишину.
#[utoipa::path(get, path = "/api/v1/home", tag = "home",
    responses(
        (status = 200, description = "Главная", body = HomeOverview),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
    ))]
pub async fn overview(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<HomeOverview>, ApiError> {
    let account = session.0.account_id;
    let pool = state.db.pool();
    let who = Who::owner(account, Some(session.0.id));
    let settings = load_settings(&state, account).await?;

    let (agent, digest, filed) = match digest::today(pool, &who).await {
        Ok(digest) => {
            let filed = digest::recent_filed(pool, &who, 5)
                .await
                .map_err(internal)?;
            (true, digest, filed)
        }
        Err(qubite_agent::Error::Denied(_)) => (false, None, Vec::new()),
        Err(error) => return Err(internal(error)),
    };

    let held = {
        let mut conn = pool.acquire().await.map_err(internal)?;
        let (notices, _) = qubite_notify::notice::list(&mut conn, account, 50)
            .await
            .map_err(internal)?;
        notices
            .into_iter()
            .filter(|notice| notice.held && notice.read_at.is_none())
            .take(5)
            .map(NoticeItem::from)
            .collect()
    };

    Ok(Json(HomeOverview {
        settings: settings.into(),
        agent,
        digest: digest.map(HomeDigest::from),
        filed: filed
            .into_iter()
            .map(|action| HomeFiled {
                action_id: action.id,
                object_id: action
                    .changes
                    .iter()
                    .find(|change| change.created)
                    .map(|change| change.object_id),
                summary: action.summary,
                reason: action.reason,
                at: action.at,
            })
            .collect(),
        held,
    }))
}

// ---------------------------------------------------------------- погода, курсы, новости

/// Когда получено и не устарело ли.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeFreshness {
    #[serde(with = "time::serde::rfc3339")]
    fetched_at: OffsetDateTime,
    /// Источник сейчас не ответил — показано последнее известное.
    stale: bool,
}

fn freshness<T>(got: &Got<T>) -> HomeFreshness {
    HomeFreshness {
        fetched_at: got.fetched_at,
        stale: got.stale,
    }
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeWeatherNow {
    /// °C.
    temperature: f64,
    feels_like: Option<f64>,
    /// Код погоды WMO.
    code: u8,
    /// «небольшой дождь».
    text: String,
    /// Ветер, м/с.
    wind: Option<f64>,
    is_day: bool,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeWeatherDay {
    /// `ГГГГ-ММ-ДД`.
    date: String,
    code: u8,
    text: String,
    max: f64,
    min: f64,
    /// Вероятность осадков, %.
    precipitation: Option<u8>,
}

/// Погода в городе из настройки (Open-Meteo).
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeWeather {
    place: String,
    now: HomeWeatherNow,
    /// Сегодня и два следующих дня.
    days: Vec<HomeWeatherDay>,
    #[serde(flatten)]
    freshness: HomeFreshness,
}

/// Погода (кэш на сервере — 30 минут).
#[utoipa::path(get, path = "/api/v1/home/weather", tag = "home",
    responses(
        (status = 200, description = "Погода", body = HomeWeather),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 502, description = "Источник погоды не отвечает", body = ApiErrorBody),
    ))]
pub async fn weather(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<HomeWeather>, ApiError> {
    let settings = load_settings(&state, session.0.account_id).await?;
    let got = state.home.weather(&settings).await.map_err(home_error)?;
    let freshness = freshness(&got);
    let weather = got.value;
    Ok(Json(HomeWeather {
        place: weather.place,
        now: HomeWeatherNow {
            temperature: weather.now.temperature,
            feels_like: weather.now.feels_like,
            code: weather.now.code,
            text: weather.now.text,
            wind: weather.now.wind,
            is_day: weather.now.is_day,
        },
        days: weather
            .days
            .into_iter()
            .map(|day| HomeWeatherDay {
                date: day.date,
                code: day.code,
                text: day.text,
                max: day.max,
                min: day.min,
                precipitation: day.precipitation,
            })
            .collect(),
        freshness,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeRate {
    /// `USD`.
    code: String,
    /// «Доллар США».
    name: String,
    /// За сколько единиц курс (у иены — 100).
    nominal: u32,
    /// Рублей за `nominal` единиц.
    value: f64,
    /// Изменение к прошлому дню ЦБ.
    change: Option<f64>,
    /// `cbr` или `er-api`.
    source: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeCurrency {
    code: String,
    name: String,
}

/// Курсы ЦБ РФ и запасного источника на день.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeRates {
    /// День курса, `ГГГГ-ММ-ДД`.
    date: String,
    /// Валюты из настройки, в её порядке.
    items: Vec<HomeRate>,
    /// Валюты ЦБ и запасного источника (для настройки).
    available: Vec<HomeCurrency>,
    #[serde(flatten)]
    freshness: HomeFreshness,
}

/// Курсы (кэш на сервере — час).
#[utoipa::path(get, path = "/api/v1/home/rates", tag = "home",
    responses(
        (status = 200, description = "Курсы", body = HomeRates),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 502, description = "ЦБ не отвечает", body = ApiErrorBody),
    ))]
pub async fn rates(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<HomeRates>, ApiError> {
    let settings = load_settings(&state, session.0.account_id).await?;
    let got = state
        .home
        .rates(&settings.currencies)
        .await
        .map_err(home_error)?;
    let freshness = freshness(&got);
    let rates = got.value;
    Ok(Json(HomeRates {
        date: rates.date,
        items: rates
            .items
            .into_iter()
            .map(|rate| HomeRate {
                code: rate.code,
                name: rate.name,
                nominal: rate.nominal,
                value: rate.value,
                change: rate.change,
                source: rate.source,
            })
            .collect(),
        available: rates
            .available
            .into_iter()
            .map(|(code, name)| HomeCurrency { code, name })
            .collect(),
        freshness,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeCoin {
    id: String,
    symbol: String,
    name: String,
    usd: f64,
    rub: f64,
    change_24h: Option<f64>,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeCoins {
    items: Vec<HomeCoin>,
    #[serde(flatten)]
    freshness: HomeFreshness,
}

/// Выбранные монеты (CoinGecko, кэш 5 минут).
#[utoipa::path(get, path = "/api/v1/home/coins", tag = "home",
    responses(
        (status = 200, description = "Монеты", body = HomeCoins),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 502, description = "Источник монет не отвечает", body = ApiErrorBody),
    ))]
pub async fn coins(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<HomeCoins>, ApiError> {
    let settings = load_settings(&state, session.0.account_id).await?;
    let got = state
        .home
        .coins(&settings.coins)
        .await
        .map_err(home_error)?;
    let freshness = freshness(&got);
    Ok(Json(HomeCoins {
        items: got
            .value
            .into_iter()
            .map(|coin| HomeCoin {
                id: coin.id,
                symbol: coin.symbol,
                name: coin.name,
                usd: coin.usd,
                rub: coin.rub,
                change_24h: coin.change_24h,
            })
            .collect(),
        freshness,
    }))
}

#[derive(Debug, Deserialize, IntoParams)]
pub struct CoinsQuery {
    /// Название или тикер монеты: от 2 до 50 знаков.
    q: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeCoinMatch {
    id: String,
    symbol: String,
    name: String,
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeCoinSearch {
    items: Vec<HomeCoinMatch>,
    #[serde(flatten)]
    freshness: HomeFreshness,
}

/// Поиск монет: до 10 результатов, кэш на час.
#[utoipa::path(get, path = "/api/v1/home/coins/search", tag = "home",
    params(CoinsQuery),
    responses(
        (status = 200, description = "Найденные монеты", body = HomeCoinSearch),
        (status = 400, description = "Нужно от 2 до 50 знаков", body = ApiErrorBody),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 502, description = "Поиск монет не отвечает", body = ApiErrorBody),
    ))]
pub async fn search_coins(
    State(state): State<AppState>,
    _session: Authenticated,
    Query(query): Query<CoinsQuery>,
) -> Result<Json<HomeCoinSearch>, ApiError> {
    let got = state
        .home
        .search_coins(&query.q)
        .await
        .map_err(home_error)?;
    let freshness = freshness(&got);
    Ok(Json(HomeCoinSearch {
        items: got
            .value
            .into_iter()
            .map(|coin| HomeCoinMatch {
                id: coin.id,
                symbol: coin.symbol,
                name: coin.name,
            })
            .collect(),
        freshness,
    }))
}

#[derive(Debug, Serialize, ToSchema)]
pub struct HomeNewsItem {
    /// `ai`, `code`, `study`, `contests`.
    topic: String,
    /// «ИИ и технологии».
    topic_title: String,
    title: String,
    /// Только `https://`.
    url: String,
    #[serde(with = "time::serde::rfc3339::option")]
    published: Option<OffsetDateTime>,
    /// «Хабр» или «Codeforces».
    source: String,
}

/// Новости по темам из настройки.
#[derive(Debug, Serialize, ToSchema)]
pub struct HomeNews {
    items: Vec<HomeNewsItem>,
    #[serde(flatten)]
    freshness: HomeFreshness,
}

/// Новости по темам: ИИ и технологии, программирование, олимпиады и учёба
/// (RSS Хабра, кэш на сервере — час).
#[utoipa::path(get, path = "/api/v1/home/news", tag = "home",
    responses(
        (status = 200, description = "Новости (пусто — темы выключены)", body = HomeNews),
        (status = 401, description = "Нужно войти", body = ApiErrorBody),
        (status = 502, description = "Ленты не отвечают", body = ApiErrorBody),
    ))]
pub async fn news(
    State(state): State<AppState>,
    session: Authenticated,
) -> Result<Json<HomeNews>, ApiError> {
    let settings = load_settings(&state, session.0.account_id).await?;
    let got = state
        .home
        .news(&settings.topics)
        .await
        .map_err(home_error)?;
    let freshness = freshness(&got);
    Ok(Json(HomeNews {
        items: got
            .value
            .into_iter()
            .map(|item| HomeNewsItem {
                topic: item.topic.as_str().into(),
                topic_title: Topic::title(item.topic).into(),
                title: item.title,
                url: item.url,
                published: item.published,
                source: item.source,
            })
            .collect(),
        freshness,
    }))
}

// ---------------------------------------------------------------- команда

/// Команды Главной (`qubite home …`).
#[derive(Debug, clap::Subcommand)]
pub enum HomeCommand {
    /// Сводка от AI на Главную без AI: агент пишет пример сводки инструментом
    /// `home.digest.write` по твоим делам, Входящим и ленте. Чтобы посмотреть
    /// Главную со сводкой и откатить её в «Агенте».
    DigestDemo {
        /// Чья Главная; по умолчанию — owner платформы.
        #[arg(long)]
        email: Option<String>,
    },
}

/// Выполнить команду Главной; возвращает текст для терминала.
pub async fn run(db: &qubite_db::Database, command: HomeCommand) -> anyhow::Result<String> {
    let pool = db.pool();
    match command {
        HomeCommand::DigestDemo { email } => {
            let account = match email {
                Some(email) => {
                    let id: Option<Uuid> = sqlx::query_scalar(
                        "SELECT id FROM accounts WHERE lower(email) = lower($1)",
                    )
                    .bind(email.trim())
                    .fetch_optional(pool)
                    .await?;
                    id.ok_or_else(|| anyhow::anyhow!("нет аккаунта {email}"))?
                }
                None => {
                    qubite_auth::owner::current(pool)
                        .await?
                        .ok_or_else(|| anyhow::anyhow!("owner ещё не создан: qubite owner create"))?
                        .id
                }
            };
            digest_demo(pool, account).await
        }
    }
}

async fn digest_demo(pool: &sqlx::PgPool, account: Uuid) -> anyhow::Result<String> {
    use qubite_agent::{Trigger, call, finish_run, start_run};
    use serde_json::json;

    let run = start_run(pool, account, Trigger::Morning)
        .await
        .map_err(|error| anyhow::anyhow!("агент недоступен: {error}"))?;
    let agent = Who::agent(&run);
    let read = async |tool: &str, args: serde_json::Value| {
        call(pool, &agent, tool, args, None, None)
            .await
            .map_err(|error| anyhow::anyhow!("{tool}: {error}"))
    };

    let mut items = Vec::new();
    // Ближайшее не сделанное дело — «важное на сегодня».
    if let qubite_agent::Outcome::Read(serde_json::Value::Array(tasks)) =
        read("task.search", json!({"limit": 200})).await?
    {
        let open = tasks.iter().find(|task| {
            task["fields"]["status"].as_str() != Some("done")
                && task["fields"]["due_date"].is_string()
        });
        if let Some(task) = open.or_else(|| tasks.first()) {
            items.push(json!({
                "kind": "important",
                "text": format!("Не забыть: «{}»", task["title"].as_str().unwrap_or("дело")),
                "task_id": task["id"],
            }));
        }
    }
    // Последняя запись ленты — «что я заметил».
    let page = qubite_agent::timeline::list(pool, account, qubite_agent::Feed::All, None, 1)
        .await
        .map_err(|error| anyhow::anyhow!("лента: {error}"))?;
    if let Some(action) = page.items.first() {
        items.push(json!({
            "kind": "noticed",
            "text": format!("Недавно я сделал: {}", action.summary),
            "action_id": action.id,
        }));
    }
    items.push(json!({
        "kind": "news",
        "text": "Пример новости: как устроены языковые модели (ссылка на Хабр)",
        "url": "https://habr.com/ru/hubs/artificial_intelligence/articles/",
    }));
    let written = call(
        pool,
        &agent,
        digest::TOOL,
        json!({ "items": items }),
        Some("пример сводки без AI (qubite home digest-demo)"),
        None,
    )
    .await
    .map_err(|error| anyhow::anyhow!("{}: {error}", digest::TOOL))?;
    finish_run(pool, &run, true).await?;
    let n = written.action().map_or(0, |_| items.len());
    Ok(format!(
        "Готово: сводка от AI на Главной, пунктов: {n}. Откройте Qubite → «Главная».\n\
         Откатить её можно в «Агенте» — строка «Написал сводку на Главную».\n\
         Нет дел и ленты — запустите сначала `qubite agent demo`."
    ))
}
