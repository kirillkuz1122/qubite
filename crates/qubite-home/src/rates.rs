//! Курсы ЦБ РФ (без ключа): официальный курс на день и изменение к
//! прошлому дню. Ответ ЦБ — XML в windows-1251; нужные части (коды,
//! номиналы, числа) — латиница и цифры, поэтому кириллица не нужна:
//! названия валют — свои.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use time::{Date, Duration, Month};

use crate::{
    Error, Result, Sources, cache::Got, fetch_bytes, fetch_json, settings::check_currencies,
};

/// Валюты, которые знает Qubite по-русски (остальные — по коду).
const NAMES: &[(&str, &str)] = &[
    ("USD", "Доллар США"),
    ("EUR", "Евро"),
    ("CNY", "Китайский юань"),
    ("GBP", "Фунт стерлингов"),
    ("JPY", "Японская иена"),
    ("CHF", "Швейцарский франк"),
    ("KZT", "Казахстанский тенге"),
    ("BYN", "Белорусский рубль"),
    ("TRY", "Турецкая лира"),
    ("AED", "Дирхам ОАЭ"),
    ("INR", "Индийская рупия"),
    ("UZS", "Узбекский сум"),
    ("AMD", "Армянский драм"),
    ("GEL", "Грузинский лари"),
    ("KGS", "Киргизский сом"),
    ("THB", "Тайский бат"),
    ("HKD", "Гонконгский доллар"),
    ("CAD", "Канадский доллар"),
    ("AUD", "Австралийский доллар"),
    ("SGD", "Сингапурский доллар"),
];

pub fn name_of(code: &str) -> String {
    NAMES
        .iter()
        .find(|(known, _)| *known == code)
        .map_or_else(|| code.to_owned(), |(_, name)| (*name).to_owned())
}

/// Курс одной валюты.
#[derive(Debug, Clone, Serialize)]
pub struct Rate {
    pub code: String,
    pub name: String,
    /// За сколько единиц курс (у иены и тенге — 100).
    pub nominal: u32,
    /// Рублей за `nominal` единиц.
    pub value: f64,
    /// Изменение к прошлому дню ЦБ, рублей за `nominal`.
    pub change: Option<f64>,
    /// `cbr` или `er-api`.
    pub source: String,
}

/// Курсы на день.
#[derive(Debug, Clone, Serialize)]
pub struct Rates {
    /// День, на который установлен курс (`ГГГГ-ММ-ДД`).
    pub date: String,
    /// Валюты из настройки, в её порядке (неизвестные источникам — пропущены).
    pub items: Vec<Rate>,
    /// Валюты ЦБ и запасного источника (для настройки): код и название.
    pub available: Vec<(String, String)>,
}

/// Курсы дня: код, номинал, рублей за номинал.
pub type Values = Vec<(String, u32, f64)>;

/// Таблица ЦБ на день (кэшируется целиком).
#[derive(Debug, Clone)]
pub struct Table {
    pub date: Date,
    /// Код → (номинал, рублей за номинал).
    pub values: Values,
    pub previous: Option<Values>,
}

fn tag<'a>(block: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let close = format!("</{name}>");
    let start = block.find(&open)? + open.len();
    let end = block[start..].find(&close)? + start;
    Some(block[start..end].trim())
}

fn parse_date(text: &str) -> Option<Date> {
    let mut parts = text.split('.');
    let day: u8 = parts.next()?.parse().ok()?;
    let month: u8 = parts.next()?.parse().ok()?;
    let year: i32 = parts.next()?.parse().ok()?;
    Date::from_calendar_date(year, Month::try_from(month).ok()?, day).ok()
}

/// Разобрать `XML_daily.asp`: день и курсы.
pub fn parse(bytes: &[u8]) -> Result<(Date, Values)> {
    // Кириллица в windows-1251 станет «�» — она и не нужна.
    let text = String::from_utf8_lossy(bytes);
    let head = text
        .find("<ValCurs")
        .ok_or_else(|| Error::Upstream("ЦБ: нет ValCurs".into()))?;
    let date = text[head..]
        .split_once("Date=\"")
        .and_then(|(_, rest)| rest.split_once('"'))
        .and_then(|(date, _)| parse_date(date))
        .ok_or_else(|| Error::Upstream("ЦБ: нет даты".into()))?;
    let mut values = Vec::new();
    for block in text[head..].split("<Valute").skip(1) {
        let Some(code) = tag(block, "CharCode") else {
            continue;
        };
        if code.len() != 3 || !code.bytes().all(|b| b.is_ascii_uppercase()) {
            continue;
        }
        let nominal = tag(block, "Nominal").and_then(|n| n.parse::<u32>().ok());
        let value = tag(block, "Value").and_then(|v| v.replace(',', ".").parse::<f64>().ok());
        if let (Some(nominal), Some(value)) = (nominal, value)
            && nominal > 0
            && value.is_finite()
            && value > 0.0
        {
            values.push((code.to_owned(), nominal, value));
        }
    }
    if values.is_empty() {
        return Err(Error::Upstream("ЦБ: пустой список курсов".into()));
    }
    Ok((date, values))
}

/// Сколько ждать запасной каталог, когда все курсы уже есть у ЦБ.
const FX_CATALOG_WAIT: std::time::Duration = std::time::Duration::from_secs(2);

fn round4(value: f64) -> f64 {
    (value * 10_000.0).round() / 10_000.0
}

impl Table {
    /// Курсы выбранных валют в их порядке.
    pub fn pick(&self, codes: &[String]) -> Rates {
        let find = |list: &[(String, u32, f64)], code: &str| {
            list.iter()
                .find(|(known, _, _)| known == code)
                .map(|(_, nominal, value)| (*nominal, *value))
        };
        let items = codes
            .iter()
            .filter_map(|code| {
                let (nominal, value) = find(&self.values, code)?;
                let change = self
                    .previous
                    .as_deref()
                    .and_then(|previous| find(previous, code))
                    .filter(|(old_nominal, _)| *old_nominal == nominal)
                    .map(|(_, old)| round4(value - old));
                Some(Rate {
                    code: code.clone(),
                    name: name_of(code),
                    nominal,
                    value: round4(value),
                    change,
                    source: "cbr".into(),
                })
            })
            .collect();
        let mut available: Vec<(String, String)> = self
            .values
            .iter()
            .map(|(code, _, _)| (code.clone(), name_of(code)))
            .collect();
        // Сначала те, что знаем по-русски (в порядке списка), потом остальные по коду.
        available.sort_by_key(|(code, _)| {
            (
                NAMES
                    .iter()
                    .position(|(known, _)| known == code)
                    .unwrap_or(usize::MAX),
                code.clone(),
            )
        });
        Rates {
            date: crate::format_date(self.date),
            items,
            available,
        }
    }
}

/// Таблица запасного источника: единиц валюты за один USD.
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct FxTable {
    rates: BTreeMap<String, f64>,
}

// Названия ISO-валют для каталога запасного источника. Источник отдаёт только коды.
fn english_name(code: &str) -> String {
    const NAMES: &str = "AED=United Arab Emirates Dirham
AFN=Afghan Afghani
ALL=Albanian Lek
AMD=Armenian Dram
ANG=Netherlands Antillean Guilder
AOA=Angolan Kwanza
ARS=Argentine Peso
AUD=Australian Dollar
AWG=Aruban Florin
AZN=Azerbaijani Manat
BAM=Bosnia and Herzegovina Convertible Mark
BBD=Barbados Dollar
BDT=Bangladeshi Taka
BGN=Bulgarian Lev
BHD=Bahraini Dinar
BIF=Burundian Franc
BMD=Bermudian Dollar
BND=Brunei Dollar
BOB=Bolivian Boliviano
BRL=Brazilian Real
BSD=Bahamian Dollar
BTN=Bhutanese Ngultrum
BWP=Botswana Pula
BYN=Belarusian Ruble
BZD=Belize Dollar
CAD=Canadian Dollar
CDF=Congolese Franc
CHF=Swiss Franc
CLP=Chilean Peso
CNY=Chinese Renminbi
COP=Colombian Peso
CRC=Costa Rican Colon
CUP=Cuban Peso
CVE=Cape Verdean Escudo
CZK=Czech Koruna
DJF=Djiboutian Franc
DKK=Danish Krone
DOP=Dominican Peso
DZD=Algerian Dinar
EGP=Egyptian Pound
ERN=Eritrean Nakfa
ETB=Ethiopian Birr
EUR=Euro
FJD=Fiji Dollar
FKP=Falkland Islands Pound
FOK=Faroese Krona
GBP=Pound Sterling
GEL=Georgian Lari
GGP=Guernsey Pound
GHS=Ghanaian Cedi
GIP=Gibraltar Pound
GMD=Gambian Dalasi
GNF=Guinean Franc
GTQ=Guatemalan Quetzal
GYD=Guyanese Dollar
HKD=Hong Kong Dollar
HNL=Honduran Lempira
HRK=Croatian Kuna
HTG=Haitian Gourde
HUF=Hungarian Forint
IDR=Indonesian Rupiah
ILS=Israeli New Shekel
IMP=Manx Pound
INR=Indian Rupee
IQD=Iraqi Dinar
IRR=Iranian Rial
ISK=Icelandic Krona
JEP=Jersey Pound
JMD=Jamaican Dollar
JOD=Jordanian Dinar
JPY=Japanese Yen
KES=Kenyan Shilling
KGS=Kyrgyzstani Som
KHR=Cambodian Riel
KID=Kiribati Dollar
KMF=Comorian Franc
KRW=South Korean Won
KWD=Kuwaiti Dinar
KYD=Cayman Islands Dollar
KZT=Kazakhstani Tenge
LAK=Lao Kip
LBP=Lebanese Pound
LKR=Sri Lanka Rupee
LRD=Liberian Dollar
LSL=Lesotho Loti
LYD=Libyan Dinar
MAD=Moroccan Dirham
MDL=Moldovan Leu
MGA=Malagasy Ariary
MKD=Macedonian Denar
MMK=Burmese Kyat
MNT=Mongolian Tugrik
MOP=Macanese Pataca
MRU=Mauritanian Ouguiya
MUR=Mauritian Rupee
MVR=Maldivian Rufiyaa
MWK=Malawian Kwacha
MXN=Mexican Peso
MYR=Malaysian Ringgit
MZN=Mozambican Metical
NAD=Namibian Dollar
NGN=Nigerian Naira
NIO=Nicaraguan Cordoba
NOK=Norwegian Krone
NPR=Nepalese Rupee
NZD=New Zealand Dollar
OMR=Omani Rial
PAB=Panamanian Balboa
PEN=Peruvian Sol
PGK=Papua New Guinean Kina
PHP=Philippine Peso
PKR=Pakistani Rupee
PLN=Polish Zloty
PYG=Paraguayan Guarani
QAR=Qatari Riyal
RON=Romanian Leu
RSD=Serbian Dinar
RUB=Russian Ruble
RWF=Rwandan Franc
SAR=Saudi Riyal
SBD=Solomon Islands Dollar
SCR=Seychellois Rupee
SDG=Sudanese Pound
SEK=Swedish Krona
SGD=Singapore Dollar
SHP=Saint Helena Pound
SLE=Sierra Leonean Leone
SLL=Sierra Leonean Leone
SOS=Somali Shilling
SRD=Surinamese Dollar
SSP=South Sudanese Pound
STN=Sao Tome and Principe Dobra
SYP=Syrian Pound
SZL=Eswatini Lilangeni
THB=Thai Baht
TJS=Tajikistani Somoni
TMT=Turkmenistan Manat
TND=Tunisian Dinar
TOP=Tongan Paanga
TRY=Turkish Lira
TTD=Trinidad and Tobago Dollar
TVD=Tuvaluan Dollar
TWD=New Taiwan Dollar
TZS=Tanzanian Shilling
UAH=Ukrainian Hryvnia
UGX=Ugandan Shilling
USD=United States Dollar
UYU=Uruguayan Peso
UZS=Uzbekistani Som
VES=Venezuelan Bolivar
VND=Vietnamese Dong
VUV=Vanuatu Vatu
WST=Samoan Tala
XAF=Central African CFA Franc
XCD=East Caribbean Dollar
XCG=Caribbean Guilder
XDR=Special Drawing Rights
XOF=West African CFA Franc
XPF=CFP Franc
YER=Yemeni Rial
ZAR=South African Rand
ZMW=Zambian Kwacha
ZWL=Zimbabwean Dollar
ZWG=Zimbabwe Gold";
    NAMES
        .lines()
        .filter_map(|line| line.split_once('='))
        .find(|(known, _)| *known == code)
        .map_or_else(|| code.to_owned(), |(_, name)| name.to_owned())
}

impl Sources {
    async fn rates_on(&self, day: Option<Date>) -> Result<(Date, Values)> {
        let url = format!("{}/scripts/XML_daily.asp", self.urls.rates);
        let mut request = self.http.get(url);
        if let Some(day) = day {
            request = request.query(&[(
                "date_req",
                format!(
                    "{:02}/{:02}/{}",
                    day.day(),
                    u8::from(day.month()),
                    day.year()
                ),
            )]);
        }
        parse(&fetch_bytes(request).await?)
    }

    /// Курсы выбранных валют (кэш — час).
    pub async fn rates(&self, codes: &[String]) -> Result<Got<Rates>> {
        let codes = check_currencies(codes)?;
        let got = self
            .rates
            .get("cbr", || async {
                let (date, values) = self.rates_on(None).await?;
                // Прошлый день ЦБ: курс, действовавший накануне. Не ответил — без стрелок.
                let previous = match date.checked_sub(Duration::days(1)) {
                    Some(day) => self
                        .rates_on(Some(day))
                        .await
                        .ok()
                        .filter(|(old, _)| *old < date)
                        .map(|(_, values)| values),
                    None => None,
                };
                Ok(Table {
                    date,
                    values,
                    previous,
                })
            })
            .await?;
        let mut rates = got.value.pick(&codes);
        let mut fetched_at = got.fetched_at;
        let mut stale = got.stale;
        // Каталог запасного источника дополняет ЦБ даже при обычном выборе валют.
        // Его недоступность не мешает вернуть уже полученные курсы ЦБ.
        // Все выбранные валюты уже есть у ЦБ — запасной источник нужен только для
        // каталога, поэтому ждём его недолго и зависший не задерживает выдачу.
        let missing = codes
            .iter()
            .any(|code| !rates.items.iter().any(|rate| &rate.code == code));
        let fx = self.fx.get("usd", || async {
            let table: FxTable =
                fetch_json(self.http.get(format!("{}/v6/latest/USD", self.urls.fx))).await?;
            if table.rates.is_empty()
                || table.rates.get("USD") != Some(&1.0)
                || table.rates.iter().any(|(code, value)| {
                    code.len() != 3
                        || !code.bytes().all(|b| b.is_ascii_uppercase())
                        || !value.is_finite()
                        || *value <= 0.0
                })
            {
                return Err(Error::Upstream(
                    "запасной источник: неверные курсы валют".into(),
                ));
            }
            Ok(table)
        });
        let fx = if missing {
            fx.await
        } else {
            tokio::time::timeout(FX_CATALOG_WAIT, fx)
                .await
                .unwrap_or_else(|_| Err(Error::Upstream("запасной источник не ответил".into())))
        };
        match fx {
            Ok(fx) => {
                for code in fx.value.rates.keys() {
                    if !rates.available.iter().any(|(known, _)| known == code) {
                        rates.available.push((code.clone(), english_name(code)));
                    }
                }
                let usd = got
                    .value
                    .values
                    .iter()
                    .find(|(code, _, _)| code == "USD")
                    .map(|(_, nominal, value)| value / f64::from(*nominal));
                for code in &codes {
                    if rates.items.iter().any(|rate| &rate.code == code) {
                        continue;
                    }
                    if let (Some(usd), Some(units)) = (usd, fx.value.rates.get(code)) {
                        let mut value = usd / units;
                        if !value.is_finite() || value <= 0.0 {
                            return Err(Error::Upstream(
                                "запасной источник: неверный курс в рублях".into(),
                            ));
                        }
                        // Мелкая валюта (риал, донг): курс за 1 ед. округлился бы в ноль,
                        // поэтому, как у ЦБ для иены, берём номинал 10, 100, … единиц.
                        let mut nominal = 1_u32;
                        while value < 1.0 && nominal < 1_000_000_000 {
                            value *= 10.0;
                            nominal *= 10;
                        }
                        rates.items.push(Rate {
                            code: code.clone(),
                            name: english_name(code),
                            nominal,
                            value: round4(value),
                            change: None,
                            source: "er-api".into(),
                        });
                        stale |= fx.stale;
                        fetched_at = fetched_at.min(fx.fetched_at);
                    }
                }
                rates
                    .items
                    .sort_by_key(|rate| codes.iter().position(|code| code == &rate.code));
            }
            Err(error) if !codes.is_empty() && rates.items.is_empty() => return Err(error),
            Err(_) => {}
        }
        Ok(Got {
            value: rates,
            fetched_at,
            stale,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="windows-1251"?>
<ValCurs Date="21.10.2026" name="Foreign Currency Market">
<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>?</Name><Value>81,2345</Value><VunitRate>81,2345</VunitRate></Valute>
<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>?</Name><Value>94,5</Value></Valute>
<Valute ID="R01375"><NumCode>156</NumCode><CharCode>CNY</CharCode><Nominal>1</Nominal><Name>?</Name><Value>11,3012</Value></Valute>
<Valute ID="R01820"><NumCode>392</NumCode><CharCode>JPY</CharCode><Nominal>100</Nominal><Name>?</Name><Value>54,1</Value></Valute>
</ValCurs>"#;

    #[test]
    fn parses_cbr_daily() {
        let (date, values) = parse(SAMPLE.as_bytes()).unwrap();
        assert_eq!(crate::format_date(date), "2026-10-21");
        assert_eq!(values.len(), 4);
        assert_eq!(values[0], ("USD".into(), 1, 81.2345));
        assert_eq!(values[3], ("JPY".into(), 100, 54.1));
    }

    #[test]
    fn picks_in_order_with_change() {
        let (date, values) = parse(SAMPLE.as_bytes()).unwrap();
        let table = Table {
            date,
            values,
            previous: Some(vec![("USD".into(), 1, 81.0), ("EUR".into(), 1, 95.0)]),
        };
        let rates = table.pick(&["CNY".into(), "USD".into(), "XXX".into(), "EUR".into()]);
        let codes: Vec<_> = rates.items.iter().map(|rate| rate.code.as_str()).collect();
        assert_eq!(codes, ["CNY", "USD", "EUR"]);
        assert_eq!(rates.items[0].change, None);
        assert_eq!(rates.items[1].change, Some(0.2345));
        assert_eq!(rates.items[2].change, Some(-0.5));
        assert_eq!(rates.items[1].name, "Доллар США");
        assert_eq!(rates.available[0].0, "USD");
    }

    #[test]
    fn garbage_is_an_upstream_error() {
        assert!(matches!(parse(b"<html>"), Err(Error::Upstream(_))));
    }
}
