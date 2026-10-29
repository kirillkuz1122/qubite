//! Все источники — локальные подделки; обращения в интернет исключены.

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use qubite_home::{Error, Sources, Topic, Urls};
use qubite_testkit::fake_http::{Action, FakeHttp, Received};
use serde_json::json;

const CBR: &str = r#"<ValCurs Date="21.10.2026">
<Valute><CharCode>USD</CharCode><Nominal>1</Nominal><Value>81,5</Value></Valute>
<Valute><CharCode>EUR</CharCode><Nominal>1</Nominal><Value>94,25</Value></Valute>
</ValCurs>"#;
const FX: &str = r#"{"result":"success","rates":{"USD":1,"EUR":0.9,"PHP":50}}"#;
const PRICES: &str = r#"{"bitcoin":{"usd":70000,"rub":5705000,"usd_24h_change":-2.5},"the-open-network":{"usd":2,"rub":163,"usd_24h_change":null}}"#;
const MARKETS: &str = r#"[{"id":"the-open-network","symbol":"gram","name":"Toncoin"},{"id":"bitcoin","symbol":"btc","name":"Bitcoin"}]"#;

fn count(fake: &FakeHttp, path: &str) -> usize {
    fake.received()
        .iter()
        .filter(|r| r.line.contains(path))
        .count()
}

#[tokio::test]
async fn fallback_rates_preserve_cbr_priority_order_and_cache() {
    let down = Arc::new(AtomicBool::new(false));
    let failing = down.clone();
    let fake = FakeHttp::start(
        [],
        Action::With(Arc::new(move |req: &Received| {
            if req.line.contains("/scripts/XML_daily.asp") {
                (200, CBR.into())
            } else if failing.load(Ordering::SeqCst) {
                (503, "источник лёг".into())
            } else if req.line.contains("/v6/latest/USD") {
                (200, FX.into())
            } else {
                (404, "{}".into())
            }
        })),
    )
    .await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    let codes = ["PHP".into(), "EUR".into(), "USD".into()];
    let got = sources.rates(&codes).await.unwrap();
    assert!(!got.stale);
    let php = &got.value.items[0];
    assert_eq!(php.code, "PHP");
    assert_eq!(php.name, "Philippine Peso");
    assert_eq!(php.source, "er-api");
    assert_eq!(php.nominal, 1);
    assert_eq!(php.value, 1.63);
    assert_eq!(php.change, None);
    assert_eq!(got.value.items[1].code, "EUR");
    assert_eq!(got.value.items[1].source, "cbr");
    assert_eq!(got.value.items[1].value, 94.25);
    assert_eq!(got.value.items[2].code, "USD");
    assert!(
        got.value
            .available
            .iter()
            .any(|(code, name)| code == "PHP" && name == "Philippine Peso")
    );
    assert_eq!(
        got.value
            .available
            .iter()
            .filter(|(code, _)| code == "EUR")
            .count(),
        1
    );
    sources.rates(&codes).await.unwrap();
    assert_eq!(count(&fake, "/v6/latest/USD"), 1);
    down.store(true, Ordering::SeqCst);
    sources.expire_cache();
    let stale = sources.rates(&codes).await.unwrap();
    assert!(stale.stale);
    assert_eq!(stale.value.items[0].value, php.value);
    // ЦБ при этом ответил заново, поэтому время получения не раньше прежнего.
    assert!(stale.fetched_at >= got.fetched_at);
}

#[tokio::test]
async fn unavailable_or_broken_fallback_does_not_hide_cbr() {
    for (status, body) in [
        (503, "{}"),
        (200, "not json"),
        (200, r#"{"rates":{}}"#),
        (200, r#"{"rates":{"USD":1,"PHP":0}}"#),
        (200, r#"{"rates":{"USD":1,"PHP":-50}}"#),
    ] {
        let fake = FakeHttp::start(
            [],
            Action::With(Arc::new(move |req: &Received| {
                if req.line.contains("/scripts/XML_daily.asp") {
                    (200, CBR.into())
                } else {
                    (status, body.into())
                }
            })),
        )
        .await;
        let sources = Sources::new(Urls::local(&fake.root_url()));
        let got = sources.rates(&["USD".into(), "PHP".into()]).await.unwrap();
        assert_eq!(got.value.items.len(), 1);
        assert_eq!(got.value.items[0].source, "cbr");
        assert!(!got.stale);
        assert!(matches!(
            sources.rates(&["PHP".into()]).await,
            Err(Error::Upstream(_))
        ));
    }
}

#[tokio::test]
async fn coins_are_batched_ordered_cached_and_stale_if_either_request_fails() {
    // Проверяем отказ цены и отказ справочника отдельно.
    for failing_path in ["/simple/price", "/coins/markets"] {
        let down = Arc::new(AtomicBool::new(false));
        let failing = down.clone();
        let fake = FakeHttp::start(
            [],
            Action::With(Arc::new(move |req: &Received| {
                if failing.load(Ordering::SeqCst) && req.line.contains(failing_path) {
                    (503, "{}".into())
                } else if req.line.contains("/api/v3/simple/price") {
                    (200, PRICES.into())
                } else if req.line.contains("/api/v3/coins/markets") {
                    (200, MARKETS.into())
                } else {
                    (404, "{}".into())
                }
            })),
        )
        .await;
        let sources = Sources::new(Urls::local(&fake.root_url()));
        let ids = [
            "the-open-network".into(),
            "bitcoin".into(),
            "bitcoin".into(),
        ];
        let got = sources.coins(&ids).await.unwrap();
        assert!(!got.stale);
        assert_eq!(got.value.len(), 2);
        assert_eq!(got.value[0].id, "the-open-network");
        assert_eq!(got.value[0].symbol, "gram");
        assert_eq!(got.value[0].name, "Toncoin");
        assert_eq!(got.value[0].usd, 2.0);
        assert_eq!(got.value[0].rub, 163.0);
        assert_eq!(got.value[0].change_24h, None);
        assert_eq!(got.value[1].change_24h, Some(-2.5));
        sources.coins(&ids).await.unwrap();
        assert_eq!(count(&fake, "/simple/price"), 1);
        assert_eq!(count(&fake, "/coins/markets"), 1);
        let requests = fake.received();
        assert!(requests[0].line.contains("ids=the-open-network%2Cbitcoin"));
        assert!(requests[0].line.contains("vs_currencies=usd%2Crub"));
        assert!(requests[0].line.contains("include_24hr_change=true"));
        assert!(requests[1].line.contains("vs_currency=usd"));
        down.store(true, Ordering::SeqCst);
        sources.expire_cache();
        let stale = sources.coins(&ids).await.unwrap();
        assert!(stale.stale);
        assert_eq!(stale.value[1].usd, got.value[1].usd);
        assert_eq!(stale.fetched_at, got.fetched_at);
        assert!(matches!(
            sources.coins(&["unknown".into()]).await,
            Err(Error::Upstream(_))
        ));
    }
}

#[tokio::test]
async fn coin_search_limits_results_encodes_query_and_keeps_stale() {
    let body = json!({"coins": (0..15).map(|i| json!({"id": format!("coin-{i}"), "symbol": "c", "name": format!("Coin {i}")})).collect::<Vec<_>>()}).to_string();
    let fake = FakeHttp::start([], Action::Respond(200, body)).await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    for query in ["", "x", &"я".repeat(51)] {
        assert!(matches!(
            sources.search_coins(query).await,
            Err(Error::Invalid(_))
        ));
    }
    assert!(fake.received().is_empty());
    let got = sources.search_coins("  bit & ton  ").await.unwrap();
    assert_eq!(got.value.len(), 10);
    assert_eq!(got.value[0].id, "coin-0");
    assert!(!got.stale);
    sources.search_coins("bit & ton").await.unwrap();
    assert_eq!(fake.received().len(), 1);
    assert!(fake.received()[0].line.contains("query=bit+%26+ton"));
    // Границы считаются в символах, а не байтах.
    sources.search_coins("яя").await.unwrap();
    sources.search_coins(&"я".repeat(50)).await.unwrap();
    drop(fake);
    sources.expire_cache();
    let stale = sources.search_coins("bit & ton").await.unwrap();
    assert!(stale.stale);
    assert_eq!(stale.fetched_at, got.fetched_at);
    assert_eq!(stale.value.len(), 10);
    assert!(matches!(
        sources.search_coins("never cached").await,
        Err(Error::Upstream(_))
    ));
}

#[tokio::test]
async fn empty_selection_and_invalid_coins_never_call_source() {
    let fake = FakeHttp::start([], Action::Respond(500, "{}".into())).await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    assert!(sources.coins(&[]).await.unwrap().value.is_empty());
    for id in ["", "Bitcoin", "a_b", "a/b", "монета", " x", &"x".repeat(65)] {
        assert!(matches!(
            sources.coins(&[id.into()]).await,
            Err(Error::Invalid(_))
        ));
    }
    let ids: Vec<_> = (0..7).map(|i| format!("coin-{i}")).collect();
    assert!(matches!(sources.coins(&ids).await, Err(Error::Invalid(_))));
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn malformed_coin_payloads_are_upstream_errors() {
    for (prices, markets) in [
        ("broken", MARKETS),
        (r#"{"bitcoin":{"usd":-1,"rub":10}}"#, MARKETS),
        (PRICES, "[]"),
        (PRICES, "{}"),
    ] {
        let fake = FakeHttp::start(
            [],
            Action::With(Arc::new(move |req: &Received| {
                (
                    200,
                    if req.line.contains("/simple/price") {
                        prices
                    } else {
                        markets
                    }
                    .into(),
                )
            })),
        )
        .await;
        let sources = Sources::new(Urls::local(&fake.root_url()));
        assert!(matches!(
            sources.coins(&["bitcoin".into()]).await,
            Err(Error::Upstream(_))
        ));
    }
    for body in ["broken", "{}", r#"{"coins":null}"#] {
        let fake = FakeHttp::start([], Action::Respond(200, body.into())).await;
        let sources = Sources::new(Urls::local(&fake.root_url()));
        assert!(matches!(
            sources.search_coins("bitcoin").await,
            Err(Error::Upstream(_))
        ));
    }
}

#[tokio::test]
async fn codeforces_is_sorted_by_start_filtered_capped_and_cached() {
    let mut contests: Vec<_> = (1..=8).rev().map(|id| json!({
        "id": id, "name": format!("Round {id}"), "phase": "BEFORE", "startTimeSeconds": 1800000000 + id
    })).collect();
    contests
        .push(json!({"id": 99, "name": "Finished", "phase": "FINISHED", "startTimeSeconds": 1}));
    contests.push(json!({"id": 98, "name": "Running", "phase": "CODING", "startTimeSeconds": 2}));
    let body = json!({"status":"OK", "result": contests}).to_string();
    let fake = FakeHttp::start([], Action::Respond(200, body)).await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    let got = sources.news(&[Topic::Contests]).await.unwrap();
    assert_eq!(got.value.len(), 5);
    assert_eq!(got.value[0].url, "https://codeforces.com/contests/1");
    assert_eq!(got.value[0].title, "Round 1");
    assert_eq!(got.value[0].source, "Codeforces");
    assert_eq!(got.value[0].published.unwrap().unix_timestamp(), 1800000001);
    assert_eq!(got.value[4].title, "Round 5");
    assert!(!got.stale);
    sources.news(&[Topic::Contests]).await.unwrap();
    assert_eq!(fake.received().len(), 1);
    assert!(
        fake.received()[0]
            .line
            .contains("/api/contest.list?gym=false")
    );
    drop(fake);
    sources.expire_cache();
    let stale = sources.news(&[Topic::Contests]).await.unwrap();
    assert!(stale.stale);
    assert_eq!(stale.value.len(), 5);
    assert_eq!(stale.fetched_at, got.fetched_at);
}

#[tokio::test]
async fn codeforces_empty_and_broken_responses_are_distinct() {
    let fake = FakeHttp::start(
        [],
        Action::Respond(200, r#"{"status":"OK","result":[]}"#.into()),
    )
    .await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    assert!(
        sources
            .news(&[Topic::Contests])
            .await
            .unwrap()
            .value
            .is_empty()
    );
    drop(fake);
    sources.expire_cache();
    let stale = sources.news(&[Topic::Contests]).await.unwrap();
    assert!(stale.stale);
    assert!(stale.value.is_empty());
    for body in [
        "not json",
        "{}",
        r#"{"status":"FAILED","result":[]}"#,
        r#"{"status":"OK","result":[{"id":1,"name":"x","phase":"BEFORE","startTimeSeconds":9223372036854775807}]}"#,
    ] {
        let fake = FakeHttp::start([], Action::Respond(200, body.into())).await;
        let sources = Sources::new(Urls::local(&fake.root_url()));
        assert!(
            matches!(
                sources.news(&[Topic::Contests]).await,
                Err(Error::Upstream(_))
            ),
            "{body}"
        );
    }
}

#[tokio::test]
async fn codeforces_contest_without_start_time_is_skipped_not_fatal() {
    let body = r#"{"status":"OK","result":[
        {"id":1,"name":"No time","phase":"BEFORE"},
        {"id":2,"name":"Has time","phase":"BEFORE","startTimeSeconds":1800000000}]}"#;
    let fake = FakeHttp::start([], Action::Respond(200, body.into())).await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    let got = sources.news(&[Topic::Contests]).await.unwrap();
    assert_eq!(got.value.len(), 1);
    assert_eq!(got.value[0].title, "Has time");
}

#[tokio::test]
async fn tiny_fallback_currency_gets_a_nominal_instead_of_zero() {
    let fake = FakeHttp::start(
        [],
        Action::With(Arc::new(|req: &Received| {
            if req.line.contains("/scripts/XML_daily.asp") {
                (200, CBR.into())
            } else {
                (200, r#"{"rates":{"USD":1.0,"IRR":1791801.0}}"#.into())
            }
        })),
    )
    .await;
    let sources = Sources::new(Urls::local(&fake.root_url()));
    let got = sources.rates(&["IRR".into()]).await.unwrap();
    let irr = &got.value.items[0];
    assert!(irr.nominal > 1, "{irr:?}");
    assert!(irr.value >= 1.0 && irr.value < 10.0, "{irr:?}");
}
