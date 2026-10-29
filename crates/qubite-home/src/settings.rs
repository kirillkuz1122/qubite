//! Настройки виджетов Главной: город погоды, валюты, темы новостей.
//! Меняются прямо на Главной (шестерёнка у виджета). Нет строки в базе —
//! значения по умолчанию: Челябинск; доллар, евро, юань; все темы каталога (D-328, D-309).

use serde::{Deserialize, Serialize};
use sqlx::PgConnection;
use uuid::Uuid;

use crate::{Error, Place, Result, Topic, places::check_point};

/// Сколько валют можно выбрать.
pub const MAX_CURRENCIES: usize = 8;
pub const MAX_COINS: usize = 6;
const MAX_PLACE_CHARS: usize = 100;
const MAX_REGION_CHARS: usize = 200;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Settings {
    pub place_name: String,
    pub place_region: String,
    pub latitude: f64,
    pub longitude: f64,
    /// Коды валют в порядке показа.
    pub currencies: Vec<String>,
    /// Идентификаторы CoinGecko в порядке показа.
    pub coins: Vec<String>,
    /// Темы новостей; пусто — новостей нет.
    pub topics: Vec<Topic>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            place_name: "Челябинск".into(),
            place_region: "Челябинская область, Россия".into(),
            latitude: 55.1540,
            longitude: 61.4291,
            currencies: vec!["USD".into(), "EUR".into(), "CNY".into()],
            coins: vec!["bitcoin".into(), "the-open-network".into()],
            topics: Topic::ALL.to_vec(),
        }
    }
}

impl Settings {
    pub fn place(&self) -> Place {
        Place {
            name: self.place_name.clone(),
            region: self.place_region.clone(),
            latitude: self.latitude,
            longitude: self.longitude,
        }
    }
}

type Row = (
    String,
    String,
    f64,
    f64,
    Vec<String>,
    Vec<String>,
    Vec<String>,
);

pub async fn load(conn: &mut PgConnection, account: Uuid) -> Result<Settings> {
    let row: Option<Row> = sqlx::query_as(
        "SELECT place_name, place_region, latitude, longitude, currencies, topics, coins \
         FROM home_settings WHERE account_id = $1",
    )
    .bind(account)
    .fetch_optional(conn)
    .await?;
    let Some((place_name, place_region, latitude, longitude, currencies, topics, coins)) = row
    else {
        return Ok(Settings::default());
    };
    Ok(Settings {
        place_name,
        place_region,
        latitude,
        longitude,
        currencies,
        coins,
        // Тему, которую убрали из кода, просто не показываем.
        topics: topics
            .iter()
            .filter_map(|topic| Topic::parse(topic).ok())
            .collect(),
    })
}

/// Что меняется (остальное — как было).
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Change {
    pub place: Option<Place>,
    pub currencies: Option<Vec<String>>,
    pub coins: Option<Vec<String>>,
    pub topics: Option<Vec<String>>,
}

fn check_place(place: &Place) -> Result<Place> {
    let name = place.name.trim();
    if name.is_empty() || name.chars().count() > MAX_PLACE_CHARS {
        return Err(Error::Invalid("нужно название города".into()));
    }
    let region = place.region.trim();
    if region.chars().count() > MAX_REGION_CHARS {
        return Err(Error::Invalid("слишком длинное название области".into()));
    }
    check_point(place.latitude, place.longitude)?;
    Ok(Place {
        name: name.to_owned(),
        region: region.to_owned(),
        // Точка города из справочника, не человека: четырёх знаков хватит.
        latitude: (place.latitude * 10_000.0).round() / 10_000.0,
        longitude: (place.longitude * 10_000.0).round() / 10_000.0,
    })
}

pub(crate) fn check_currencies(codes: &[String]) -> Result<Vec<String>> {
    let mut out: Vec<String> = Vec::new();
    for code in codes {
        let code = code.trim().to_uppercase();
        if code.len() != 3 || !code.bytes().all(|b| b.is_ascii_uppercase()) {
            return Err(Error::Invalid(format!("неверный код валюты «{code}»")));
        }
        if !out.contains(&code) {
            out.push(code);
        }
    }
    if out.len() > MAX_CURRENCIES {
        return Err(Error::Invalid(format!(
            "валют — не больше {MAX_CURRENCIES}"
        )));
    }
    Ok(out)
}

/// Идентификаторы монет: тот же порядок и удаление дублей, что у валют.
pub(crate) fn check_coins(ids: &[String]) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for id in ids {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        {
            return Err(Error::Invalid(format!("неверный код монеты «{id}»")));
        }
        if !out.contains(id) {
            out.push(id.clone());
        }
    }
    if out.len() > MAX_COINS {
        return Err(Error::Invalid(format!("монет — не больше {MAX_COINS}")));
    }
    Ok(out)
}

pub async fn save(conn: &mut PgConnection, account: Uuid, change: &Change) -> Result<Settings> {
    let mut next = load(conn, account).await?;
    if let Some(place) = &change.place {
        let place = check_place(place)?;
        next.place_name = place.name;
        next.place_region = place.region;
        next.latitude = place.latitude;
        next.longitude = place.longitude;
    }
    if let Some(codes) = &change.currencies {
        next.currencies = check_currencies(codes)?;
    }
    if let Some(ids) = &change.coins {
        next.coins = check_coins(ids)?;
    }
    if let Some(topics) = &change.topics {
        let mut parsed: Vec<Topic> = Vec::new();
        for topic in topics {
            let topic = Topic::parse(topic)?;
            if !parsed.contains(&topic) {
                parsed.push(topic);
            }
        }
        next.topics = parsed;
    }
    let topics: Vec<&str> = next.topics.iter().map(|topic| topic.as_str()).collect();
    sqlx::query(
        "INSERT INTO home_settings (account_id, place_name, place_region, latitude, longitude, \
         currencies, topics, coins) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) \
         ON CONFLICT (account_id) DO UPDATE SET place_name = $2, place_region = $3, \
         latitude = $4, longitude = $5, currencies = $6, topics = $7, coins = $8, updated_at = now()",
    )
    .bind(account)
    .bind(&next.place_name)
    .bind(&next.place_region)
    .bind(next.latitude)
    .bind(next.longitude)
    .bind(&next.currencies)
    .bind(&topics)
    .bind(&next.coins)
    .execute(conn)
    .await?;
    Ok(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn currencies_are_checked_and_deduplicated() {
        assert_eq!(
            check_currencies(&["usd".into(), "EUR".into(), "USD".into()]).unwrap(),
            ["USD", "EUR"]
        );
        assert!(check_currencies(&["US".into()]).is_err());
        assert!(check_currencies(&["Д".into()]).is_err());
        let many: Vec<String> = [
            "AAA", "BBB", "CCC", "DDD", "EEE", "FFF", "GGG", "HHH", "III",
        ]
        .map(String::from)
        .to_vec();
        assert!(check_currencies(&many).is_err());
        assert_eq!(check_currencies(&many[..8]).unwrap().len(), 8);
    }

    #[test]
    fn coins_are_checked_deduplicated_and_limited() {
        assert_eq!(
            check_coins(&[
                "bitcoin".into(),
                "bitcoin".into(),
                "the-open-network".into()
            ])
            .unwrap(),
            ["bitcoin", "the-open-network"]
        );
        for id in [
            "",
            "BTC",
            "coin_id",
            "../bitcoin",
            "монета",
            " bitcoin",
            &"x".repeat(65),
        ] {
            assert!(check_coins(&[id.into()]).is_err(), "{id}");
        }
        assert!(check_coins(&["x".repeat(64)]).is_ok());
        let ids: Vec<_> = (0..7).map(|i| format!("coin-{i}")).collect();
        assert_eq!(check_coins(&ids[..6]).unwrap().len(), 6);
        assert!(check_coins(&ids).is_err());
        assert!(check_coins(&[]).unwrap().is_empty());
    }

    #[test]
    fn place_is_checked() {
        let place = Place {
            name: " Екатеринбург ".into(),
            region: "Свердловская область, Россия".into(),
            latitude: 56.838_011_23,
            longitude: 60.597_465_8,
        };
        let checked = check_place(&place).unwrap();
        assert_eq!(checked.name, "Екатеринбург");
        assert_eq!(checked.latitude, 56.838);
        assert!(
            check_place(&Place {
                latitude: 91.0,
                ..place.clone()
            })
            .is_err()
        );
        assert!(
            check_place(&Place {
                name: "  ".into(),
                ..place
            })
            .is_err()
        );
    }
}
