//! OSRM (driving) + Nominatim. Без ключей и без записи координат в журнал.
//! Кэш только в памяти на сутки; ключ маршрута — округлённые до 0.001° точки.
//! Один экземпляр на сервер, общая очередь по хосту — в qubite-net.

use std::{collections::HashMap, future::Future, pin::Pin, time::Duration};

use reqwest::{Client, Url};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use tokio::{sync::Mutex, time::Instant};

const TTL: Duration = Duration::from_secs(24 * 60 * 60);
const TIMEOUT: Duration = Duration::from_secs(8);
const MAX_CACHE: usize = 4096;
pub const MAX_GEOMETRY: usize = 200;
pub const USER_AGENT: &str = "Qubite/2.0 (+https://qubiteapp.online)";

// Намеренно без Debug: исходную точку нельзя случайно записать в лог.
#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Point {
    pub lat: f64,
    pub lon: f64,
}

impl Point {
    pub fn valid(self) -> bool {
        self.lat.is_finite()
            && self.lon.is_finite()
            && (-90.0..=90.0).contains(&self.lat)
            && (-180.0..=180.0).contains(&self.lon)
    }

    fn rounded(self) -> (i32, i32) {
        (
            (self.lat * 1000.0).round() as i32,
            (self.lon * 1000.0).round() as i32,
        )
    }
}

#[derive(Clone)]
pub struct Route {
    pub seconds: f64,
    pub meters: f64,
    pub geometry: Vec<Point>,
}

/// Никогда не содержит reqwest::Error (он включает URL с координатами).
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("неверное место или координаты")]
    Invalid,
    #[error("сервис маршрутов недоступен")]
    Unavailable,
}

pub type Result<T> = std::result::Result<T, Error>;
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

pub trait RouteProvider: Send + Sync {
    fn geocode<'a>(&'a self, text: &'a str) -> BoxFuture<'a, Option<Point>>;
    fn route(&self, from: Point, to: Point) -> BoxFuture<'_, Route>;
}

#[derive(Clone)]
pub struct Settings {
    pub enabled: bool,
    pub osrm_url: String,
    pub nominatim_url: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            enabled: true,
            osrm_url: "https://router.project-osrm.org".into(),
            nominatim_url: "https://nominatim.openstreetmap.org".into(),
        }
    }
}

impl Settings {
    pub fn from_env() -> Self {
        let mut settings = Self::default();
        if let Ok(value) = std::env::var("QUBITE_ROUTE_ENABLED") {
            settings.enabled = matches!(
                value.to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            );
        }
        if let Ok(value) = std::env::var("QUBITE_ROUTE_OSRM_URL") {
            settings.osrm_url = value;
        }
        if let Ok(value) = std::env::var("QUBITE_ROUTE_NOMINATIM_URL") {
            settings.nominatim_url = value;
        }
        settings
    }
}

struct Entry<T> {
    until: Instant,
    value: T,
}

/// Держим mutex во время загрузки: одновременные одинаковые запросы не
/// расходуют лимит повторно. Количество записей ограничено, старые удаляются.
struct Cache<T>(Mutex<HashMap<String, Entry<T>>>);

impl<T> Default for Cache<T> {
    fn default() -> Self {
        Self(Mutex::new(HashMap::new()))
    }
}

fn prune<T>(entries: &mut HashMap<String, Entry<T>>) {
    entries.retain(|_, entry| entry.until > Instant::now());
    if entries.len() >= MAX_CACHE {
        entries.clear();
    }
}

pub struct OsrmNominatim {
    settings: Settings,
    http: Option<Client>,
    places: Cache<Option<Point>>,
    routes: Cache<Route>,
}

impl OsrmNominatim {
    pub fn new(settings: Settings) -> Self {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let http = qubite_net::client(qubite_net::configured(Some("ROUTE")).as_deref())
            .ok()
            .and_then(|builder| {
                builder
                    .user_agent(USER_AGENT)
                    .timeout(TIMEOUT)
                    .redirect(reqwest::redirect::Policy::none())
                    .build()
                    .ok()
            });
        Self {
            settings,
            http,
            places: Cache::default(),
            routes: Cache::default(),
        }
    }

    pub fn disabled() -> Self {
        Self::new(Settings {
            enabled: false,
            ..Settings::default()
        })
    }

    async fn fetch<T: DeserializeOwned>(&self, url: Url) -> Result<T> {
        if !self.settings.enabled {
            return Err(Error::Unavailable);
        }
        let http = self.http.as_ref().ok_or(Error::Unavailable)?;
        // Не логируем ни URL, ни тело ответа, ни ошибку reqwest.
        qubite_net::one_per_second(&url).await;
        let response = http.get(url).send().await.map_err(|_| Error::Unavailable)?;
        if !response.status().is_success() {
            return Err(Error::Unavailable);
        }
        response.json().await.map_err(|_| Error::Unavailable)
    }

    async fn find(&self, text: &str) -> Result<Option<Point>> {
        if !self.settings.enabled {
            return Err(Error::Unavailable);
        }
        let text = text.trim();
        if text.is_empty() || text.chars().count() > 1000 {
            return Err(Error::Invalid);
        }
        let key = text.to_lowercase();
        let mut entries = self.places.0.lock().await;
        if let Some(entry) = entries
            .get(&key)
            .filter(|entry| entry.until > Instant::now())
        {
            return Ok(entry.value);
        }
        let mut url = endpoint(&self.settings.nominatim_url, "search")?;
        url.query_pairs_mut()
            .extend_pairs([("q", text), ("format", "jsonv2"), ("limit", "1")]);
        let found: Vec<Geocoded> = self.fetch(url).await?;
        let point = found
            .first()
            .map(|found| {
                let point = Point {
                    lat: found.lat.parse().map_err(|_| Error::Unavailable)?,
                    lon: found.lon.parse().map_err(|_| Error::Unavailable)?,
                };
                if !point.valid() {
                    return Err(Error::Unavailable);
                }
                Ok(point)
            })
            .transpose()?;
        prune(&mut entries);
        entries.insert(
            key,
            Entry {
                until: Instant::now() + TTL,
                value: point,
            },
        );
        Ok(point)
    }

    async fn directions(&self, from: Point, to: Point) -> Result<Route> {
        if !self.settings.enabled {
            return Err(Error::Unavailable);
        }
        if !from.valid() || !to.valid() {
            return Err(Error::Invalid);
        }
        let key = format!("{:?}:{:?}", from.rounded(), to.rounded());
        let mut entries = self.routes.0.lock().await;
        if let Some(entry) = entries
            .get(&key)
            .filter(|entry| entry.until > Instant::now())
        {
            return Ok(entry.value.clone());
        }
        // Запрос и геометрия используют те же округлённые точки, что и ключ:
        // кэш не удерживает точное исходное положение человека.
        let (lat1, lon1) = from.rounded();
        let (lat2, lon2) = to.rounded();
        let coordinates = format!(
            "{},{};{},{}",
            f64::from(lon1) / 1000.0,
            f64::from(lat1) / 1000.0,
            f64::from(lon2) / 1000.0,
            f64::from(lat2) / 1000.0
        );
        let mut url = endpoint(
            &self.settings.osrm_url,
            &format!("route/v1/driving/{coordinates}"),
        )?;
        url.query_pairs_mut().extend_pairs([
            ("overview", "simplified"),
            ("geometries", "geojson"),
            ("steps", "false"),
        ]);
        let response: OsrmResponse = self.fetch(url).await?;
        if response.code != "Ok" {
            return Err(Error::Unavailable);
        }
        let route = response
            .routes
            .into_iter()
            .next()
            .ok_or(Error::Unavailable)?;
        if !route.duration.is_finite()
            || route.duration < 0.0
            || !route.distance.is_finite()
            || route.distance < 0.0
            || route.geometry.kind != "LineString"
            || route.geometry.coordinates.len() < 2
        {
            return Err(Error::Unavailable);
        }
        let points: Vec<Point> = route
            .geometry
            .coordinates
            .into_iter()
            .map(|[lon, lat]| Point { lat, lon })
            .collect();
        if points.iter().any(|point| !point.valid()) {
            return Err(Error::Unavailable);
        }
        let geometry = if points.len() <= MAX_GEOMETRY {
            points
        } else {
            // Равномерное прореживание сохраняет начало и конец.
            (0..MAX_GEOMETRY)
                .map(|i| points[i * (points.len() - 1) / (MAX_GEOMETRY - 1)])
                .collect()
        };
        let route = Route {
            seconds: route.duration,
            meters: route.distance,
            geometry,
        };
        prune(&mut entries);
        entries.insert(
            key,
            Entry {
                until: Instant::now() + TTL,
                value: route.clone(),
            },
        );
        Ok(route)
    }
}

impl RouteProvider for OsrmNominatim {
    fn geocode<'a>(&'a self, text: &'a str) -> BoxFuture<'a, Option<Point>> {
        Box::pin(self.find(text))
    }

    fn route(&self, from: Point, to: Point) -> BoxFuture<'_, Route> {
        Box::pin(self.directions(from, to))
    }
}

fn endpoint(base: &str, path: &str) -> Result<Url> {
    let url = Url::parse(&format!("{}/{path}", base.trim_end_matches('/')))
        .map_err(|_| Error::Unavailable)?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(Error::Unavailable);
    }
    Ok(url)
}

#[derive(Deserialize)]
struct Geocoded {
    lat: String,
    lon: String,
}

#[derive(Deserialize)]
struct OsrmResponse {
    code: String,
    #[serde(default)]
    routes: Vec<OsrmRoute>,
}

#[derive(Deserialize)]
struct OsrmRoute {
    duration: f64,
    distance: f64,
    geometry: Geometry,
}

#[derive(Deserialize)]
struct Geometry {
    #[serde(rename = "type")]
    kind: String,
    coordinates: Vec<[f64; 2]>,
}

#[cfg(test)]
mod tests;
