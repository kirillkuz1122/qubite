//! Город для погоды: поиск по названию (Open-Meteo) и «определить по
//! геолокации» (OpenStreetMap Nominatim). Координаты человека в базу не
//! попадают и не кэшируются: по ним находится город, а храним мы город и его
//! координаты из справочника (D-328).

use serde::{Deserialize, Serialize};

use crate::{Error, Result, Sources, fetch_json};

/// Город.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Place {
    /// «Челябинск».
    pub name: String,
    /// «Челябинская область, Россия».
    pub region: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Deserialize)]
struct Search {
    #[serde(default)]
    results: Vec<Found>,
}

#[derive(Deserialize)]
struct Found {
    name: String,
    latitude: f64,
    longitude: f64,
    admin1: Option<String>,
    country: Option<String>,
}

#[derive(Deserialize)]
struct Reverse {
    name: Option<String>,
    lat: Option<String>,
    lon: Option<String>,
    #[serde(default)]
    address: Address,
}

#[derive(Deserialize, Default)]
struct Address {
    city: Option<String>,
    town: Option<String>,
    village: Option<String>,
    municipality: Option<String>,
    state: Option<String>,
    country: Option<String>,
}

fn region(parts: [Option<&str>; 2]) -> String {
    parts
        .into_iter()
        .flatten()
        .map(str::trim)
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join(", ")
}

/// Проверить координаты (браузер и справочник).
pub fn check_point(latitude: f64, longitude: f64) -> Result<()> {
    if !(latitude.is_finite()
        && longitude.is_finite()
        && (-90.0..=90.0).contains(&latitude)
        && (-180.0..=180.0).contains(&longitude))
    {
        return Err(Error::Invalid("неверные координаты".into()));
    }
    Ok(())
}

/// Примерное расстояние в градусах (чтобы выбрать ближайший из найденных).
fn distance(a: (f64, f64), b: (f64, f64)) -> f64 {
    let dlat = a.0 - b.0;
    let dlon = (a.1 - b.1) * a.0.to_radians().cos();
    dlat.hypot(dlon)
}

impl Sources {
    /// Города по названию (до 5), кэш — сутки на запрос.
    pub async fn search_places(&self, query: &str) -> Result<Vec<Place>> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Ok(Vec::new());
        }
        if query.chars().count() > 100 {
            return Err(Error::Invalid("слишком длинное название".into()));
        }
        let key = query.to_lowercase();
        let url = format!("{}/v1/search", self.urls.geocoding);
        let request = self.http.get(url).query(&[
            ("name", query),
            ("count", "5"),
            ("language", "ru"),
            ("format", "json"),
        ]);
        let got = self
            .places
            .get(&key, || async move {
                let found: Search = fetch_json(request).await?;
                Ok(found
                    .results
                    .into_iter()
                    .filter(|found| check_point(found.latitude, found.longitude).is_ok())
                    .map(|found| Place {
                        region: region([found.admin1.as_deref(), found.country.as_deref()]),
                        name: found.name,
                        latitude: found.latitude,
                        longitude: found.longitude,
                    })
                    .collect())
            })
            .await?;
        Ok(got.value)
    }

    /// Город по координатам браузера. Сами координаты не сохраняются и не
    /// кэшируются: по ним ищется название, а точка берётся у найденного города.
    pub async fn locate(&self, latitude: f64, longitude: f64) -> Result<Place> {
        check_point(latitude, longitude)?;
        let url = format!("{}/reverse", self.urls.reverse);
        let parsed = reqwest::Url::parse(&url)
            .map_err(|_| Error::Upstream("неверный адрес Nominatim".into()))?;
        qubite_net::one_per_second(&parsed).await;
        let request = self.http.get(url).query(&[
            ("lat", format!("{latitude:.4}")),
            ("lon", format!("{longitude:.4}")),
            ("format", "jsonv2".into()),
            ("zoom", "10".into()),
            ("accept-language", "ru".into()),
        ]);
        let found: Reverse = fetch_json(request).await?;
        let address = &found.address;
        let name = [
            &address.city,
            &address.town,
            &address.village,
            &address.municipality,
            &found.name,
        ]
        .into_iter()
        .flatten()
        .map(|name| name.trim())
        .find(|name| !name.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| Error::NotFound("не нашли город по этому месту".into()))?;

        // Точка города — из справочника погоды (ближайший с таким названием).
        let here = (latitude, longitude);
        if let Ok(places) = self.search_places(&name).await
            && let Some(place) = places
                .into_iter()
                .filter(|place| distance(here, (place.latitude, place.longitude)) < 1.0)
                .min_by(|a, b| {
                    distance(here, (a.latitude, a.longitude))
                        .total_cmp(&distance(here, (b.latitude, b.longitude)))
                })
        {
            return Ok(place);
        }
        let point = found
            .lat
            .as_deref()
            .zip(found.lon.as_deref())
            .and_then(|(lat, lon)| Some((lat.parse::<f64>().ok()?, lon.parse::<f64>().ok()?)))
            .filter(|(lat, lon)| check_point(*lat, *lon).is_ok())
            .ok_or_else(|| Error::Upstream("город без координат".into()))?;
        Ok(Place {
            name,
            region: region([address.state.as_deref(), address.country.as_deref()]),
            latitude: point.0,
            longitude: point.1,
        })
    }
}
