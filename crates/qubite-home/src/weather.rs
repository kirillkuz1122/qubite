//! Погода от Open-Meteo (без ключа): сейчас и на три дня.

use serde::{Deserialize, Serialize};

use crate::{Result, Sources, cache::Got, fetch_json, settings::Settings};

/// Погода в городе.
#[derive(Debug, Clone, Serialize)]
pub struct Weather {
    /// Город, как в настройке.
    pub place: String,
    pub now: Now,
    /// Сегодня и два следующих дня.
    pub days: Vec<Day>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Now {
    /// °C.
    pub temperature: f64,
    /// Ощущается как, °C.
    pub feels_like: Option<f64>,
    /// Код погоды WMO.
    pub code: u8,
    /// «пасмурно».
    pub text: String,
    /// Ветер, м/с.
    pub wind: Option<f64>,
    pub is_day: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct Day {
    /// `ГГГГ-ММ-ДД` по часам города.
    pub date: String,
    pub code: u8,
    pub text: String,
    pub max: f64,
    pub min: f64,
    /// Вероятность осадков, %.
    pub precipitation: Option<u8>,
}

/// Код погоды WMO — словами.
pub fn describe(code: u8) -> &'static str {
    match code {
        0 => "ясно",
        1 => "почти ясно",
        2 => "переменная облачность",
        3 => "пасмурно",
        45 | 48 => "туман",
        51 | 53 | 55 => "морось",
        56 | 57 => "ледяная морось",
        61 => "небольшой дождь",
        63 => "дождь",
        65 => "сильный дождь",
        66 | 67 => "ледяной дождь",
        71 => "небольшой снег",
        73 => "снег",
        75 => "сильный снег",
        77 => "снежная крупа",
        80..=82 => "ливень",
        85 | 86 => "снегопад",
        95 => "гроза",
        96 | 99 => "гроза с градом",
        _ => "погода",
    }
}

#[derive(Deserialize)]
struct Answer {
    current: Current,
    daily: Option<Daily>,
}

#[derive(Deserialize)]
struct Current {
    temperature_2m: f64,
    apparent_temperature: Option<f64>,
    weather_code: Option<f64>,
    wind_speed_10m: Option<f64>,
    is_day: Option<f64>,
}

#[derive(Deserialize)]
struct Daily {
    time: Vec<String>,
    weather_code: Vec<Option<f64>>,
    temperature_2m_max: Vec<Option<f64>>,
    temperature_2m_min: Vec<Option<f64>>,
    #[serde(default)]
    precipitation_probability_max: Vec<Option<f64>>,
}

fn code_of(value: Option<f64>) -> u8 {
    // Коды WMO — целые 0…99.
    value
        .filter(|value| value.is_finite() && (0.0..=99.0).contains(value))
        .map_or(0, |value| value as u8)
}

fn round1(value: f64) -> f64 {
    (value * 10.0).round() / 10.0
}

fn parse(place: &str, answer: Answer) -> Weather {
    let code = code_of(answer.current.weather_code);
    let now = Now {
        temperature: round1(answer.current.temperature_2m),
        feels_like: answer.current.apparent_temperature.map(round1),
        code,
        text: describe(code).into(),
        wind: answer.current.wind_speed_10m.map(round1),
        is_day: answer.current.is_day.is_none_or(|value| value > 0.5),
    };
    let days = answer
        .daily
        .map(|daily| {
            daily
                .time
                .iter()
                .enumerate()
                .filter_map(|(i, date)| {
                    let max = daily.temperature_2m_max.get(i).copied().flatten()?;
                    let min = daily.temperature_2m_min.get(i).copied().flatten()?;
                    let code = code_of(daily.weather_code.get(i).copied().flatten());
                    Some(Day {
                        date: date.clone(),
                        code,
                        text: describe(code).into(),
                        max: round1(max),
                        min: round1(min),
                        precipitation: daily
                            .precipitation_probability_max
                            .get(i)
                            .copied()
                            .flatten()
                            .filter(|value| (0.0..=100.0).contains(value))
                            .map(|value| value.round() as u8),
                    })
                })
                .take(3)
                .collect()
        })
        .unwrap_or_default();
    Weather {
        place: place.to_owned(),
        now,
        days,
    }
}

impl Sources {
    /// Погода в городе из настроек (кэш — 30 минут на город).
    pub async fn weather(&self, settings: &Settings) -> Result<Got<Weather>> {
        // Город — точка с округлением до сотых: соседние настройки делят кэш.
        let key = format!(
            "{:.2},{:.2}|{}",
            settings.latitude, settings.longitude, settings.place_name
        );
        let url = format!("{}/v1/forecast", self.urls.forecast);
        let request = self.http.get(url).query(&[
            ("latitude", format!("{:.4}", settings.latitude)),
            ("longitude", format!("{:.4}", settings.longitude)),
            (
                "current",
                "temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day".into(),
            ),
            (
                "daily",
                "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max"
                    .into(),
            ),
            ("timezone", "auto".into()),
            ("forecast_days", "3".into()),
            ("wind_speed_unit", "ms".into()),
        ]);
        let place = settings.place_name.clone();
        self.weather
            .get(&key, || async move {
                let answer: Answer = fetch_json(request).await?;
                Ok(parse(&place, answer))
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_open_meteo_answer() {
        let answer: Answer = serde_json::from_str(
            r#"{"latitude":55.16,"longitude":61.43,
                "current":{"time":"2026-10-20T10:00","temperature_2m":4.26,"apparent_temperature":1.04,
                           "weather_code":61,"wind_speed_10m":3.94,"is_day":1},
                "daily":{"time":["2026-10-20","2026-10-21","2026-10-22"],
                         "weather_code":[61,3,null],"temperature_2m_max":[6.1,4.0,2.2],
                         "temperature_2m_min":[1.2,-0.5,null],"precipitation_probability_max":[80,10,null]}}"#,
        )
        .unwrap();
        let weather = parse("Челябинск", answer);
        assert_eq!(weather.now.temperature, 4.3);
        assert_eq!(weather.now.text, "небольшой дождь");
        assert_eq!(weather.now.wind, Some(3.9));
        assert_eq!(weather.days.len(), 2, "день без минимума пропущен");
        assert_eq!(weather.days[1].text, "пасмурно");
        assert_eq!(weather.days[0].precipitation, Some(80));
    }
}
