//! Выбранные монеты и поиск CoinGecko без ключа; все запросы пакетные.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::{Error, Result, Sources, cache::Got, fetch_json, settings::check_coins};

#[derive(Debug, Clone, Serialize)]
pub struct Coin {
    pub id: String,
    pub symbol: String,
    pub name: String,
    pub usd: f64,
    pub rub: f64,
    pub change_24h: Option<f64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
pub struct CoinMatch {
    pub id: String,
    pub symbol: String,
    pub name: String,
}

#[derive(Deserialize)]
struct Price {
    usd: f64,
    rub: f64,
    usd_24h_change: Option<f64>,
}

#[derive(Deserialize)]
struct Search {
    coins: Vec<CoinMatch>,
}

fn valid_match(coin: &CoinMatch) -> bool {
    check_coins(std::slice::from_ref(&coin.id)).is_ok()
        && !coin.symbol.trim().is_empty()
        && !coin.name.trim().is_empty()
}

impl Sources {
    /// Цены и имена одним пакетом на весь выбранный список (кэш 5 минут).
    pub async fn coins(&self, ids: &[String]) -> Result<Got<Vec<Coin>>> {
        let ids = check_coins(ids)?;
        if ids.is_empty() {
            return Ok(Got {
                value: Vec::new(),
                fetched_at: time::OffsetDateTime::now_utc(),
                stale: false,
            });
        }
        let key = ids.join(",");
        self.coins
            .get(&key, || async {
                let prices: BTreeMap<String, Price> = fetch_json(
                    self.http
                        .get(format!("{}/api/v3/simple/price", self.urls.coins))
                        .query(&[
                            ("ids", key.as_str()),
                            ("vs_currencies", "usd,rub"),
                            ("include_24hr_change", "true"),
                        ]),
                )
                .await?;
                let names: Vec<CoinMatch> = fetch_json(
                    self.http
                        .get(format!("{}/api/v3/coins/markets", self.urls.coins))
                        .query(&[("vs_currency", "usd"), ("ids", key.as_str())]),
                )
                .await?;
                let mut out = Vec::new();
                for id in &ids {
                    let Some(price) = prices.get(id) else {
                        // Неизвестный CoinGecko id не ломает остальные монеты.
                        continue;
                    };
                    let name = names
                        .iter()
                        .find(|coin| &coin.id == id && valid_match(coin))
                        .ok_or_else(|| Error::Upstream("CoinGecko: нет названия монеты".into()))?;
                    if !price.usd.is_finite()
                        || !price.rub.is_finite()
                        || price.usd < 0.0
                        || price.rub < 0.0
                        || price.usd_24h_change.is_some_and(|v| !v.is_finite())
                    {
                        return Err(Error::Upstream("CoinGecko: неверная цена монеты".into()));
                    }
                    out.push(Coin {
                        id: id.clone(),
                        symbol: name.symbol.clone(),
                        name: name.name.clone(),
                        usd: price.usd,
                        rub: price.rub,
                        change_24h: price.usd_24h_change,
                    });
                }
                Ok(out)
            })
            .await
    }

    /// До десяти результатов; кэш поиска — час.
    pub async fn search_coins(&self, query: &str) -> Result<Got<Vec<CoinMatch>>> {
        let query = query.trim();
        if !(2..=50).contains(&query.chars().count()) {
            return Err(Error::Invalid(
                "для поиска монеты нужно от 2 до 50 знаков".into(),
            ));
        }
        self.coin_search
            .get(query, || async {
                let search: Search = fetch_json(
                    self.http
                        .get(format!("{}/api/v3/search", self.urls.coins))
                        .query(&[("query", query)]),
                )
                .await?;
                let mut seen = std::collections::HashSet::new();
                Ok(search
                    .coins
                    .into_iter()
                    .filter(valid_match)
                    .filter(|coin| seen.insert(coin.id.clone()))
                    .take(10)
                    .collect())
            })
            .await
    }
}
