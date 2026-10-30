//! Только локальный FakeHttp, без публичных картографических API.
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use qubite_route::{
    Error, MAX_GEOMETRY, OsrmNominatim, Point, RouteProvider, Settings, USER_AGENT,
};
use qubite_testkit::fake_http::{Action, FakeHttp};
use serde_json::json;

fn provider(fake: &FakeHttp) -> OsrmNominatim {
    OsrmNominatim::new(Settings {
        enabled: true,
        osrm_url: fake.root_url(),
        nominatim_url: fake.root_url(),
    })
}

fn start() -> Point {
    Point {
        lat: 55.123456,
        lon: 61.234567,
    }
}

fn end() -> Point {
    Point {
        lat: 55.5,
        lon: 61.5,
    }
}

fn directions() -> String {
    json!({"code":"Ok", "routes":[{
        "duration":61.1, "distance":1234.5,
        "geometry":{"type":"LineString", "coordinates":[[61.235,55.123],[61.5,55.5]]}
    }]})
    .to_string()
}

#[tokio::test]
async fn parses_geocode_and_route_and_caches_rounded_points() {
    let fake = FakeHttp::start(
        [
            Action::Respond(200, r#"[{"lat":"55.5","lon":"61.5"}]"#.into()),
            Action::Respond(200, directions()),
        ],
        Action::Respond(500, "{}".into()),
    )
    .await;
    let api = provider(&fake);
    let to = api.geocode("  Музей & парк  ").await.unwrap().unwrap();
    assert!(to == end());
    assert!(api.geocode("музей & парк").await.unwrap().unwrap() == to);
    let route = api.route(start(), to).await.unwrap();
    assert_eq!(route.seconds, 61.1);
    assert_eq!(route.meters, 1234.5);
    assert!(
        route.geometry[0]
            == Point {
                lat: 55.123,
                lon: 61.235,
            }
    );
    api.route(
        Point {
            lat: 55.12349,
            lon: 61.23451,
        },
        to,
    )
    .await
    .unwrap();
    let requests = fake.received();
    assert_eq!(requests.len(), 2);
    assert_eq!(requests[0].header("user-agent"), Some(USER_AGENT));
    assert!(requests[0].line.contains("/search?"));
    assert!(requests[0].line.contains("format=jsonv2"));
    assert!(requests[0].line.contains("%26"));
    assert!(
        requests[1]
            .line
            .contains("/route/v1/driving/61.235,55.123;61.5,55.5?")
    );
    assert!(requests[1].line.contains("geometries=geojson"));
    assert!(!requests[1].line.contains("55.123456"));
}

#[tokio::test]
async fn concurrent_misses_are_loaded_once_and_geometry_is_bounded() {
    let coordinates: Vec<_> = (0..1001)
        .map(|n| vec![61.0 + f64::from(n) / 10000.0, 55.0])
        .collect();
    let body = json!({"code":"Ok","routes":[{"duration":60,"distance":1,
        "geometry":{"type":"LineString","coordinates":coordinates}}]})
    .to_string();
    let fake = FakeHttp::start([], Action::Respond(200, body)).await;
    let api = provider(&fake);
    let (first, second) = tokio::join!(api.route(start(), end()), api.route(start(), end()));
    let first = first.unwrap();
    assert_eq!(first.geometry.len(), MAX_GEOMETRY);
    assert_eq!(second.unwrap().geometry.len(), MAX_GEOMETRY);
    assert!(
        first.geometry[0]
            == Point {
                lat: 55.0,
                lon: 61.0,
            }
    );
    assert!(
        first.geometry[MAX_GEOMETRY - 1]
            == Point {
                lat: 55.0,
                lon: 61.1,
            }
    );
    assert_eq!(fake.received().len(), 1);
}

#[tokio::test]
async fn queue_is_shared_between_instances_and_geocode_and_route() {
    let arrivals = Arc::new(Mutex::new(Vec::new()));
    let times = arrivals.clone();
    let fake = FakeHttp::start(
        [],
        Action::With(Arc::new(move |request| {
            times.lock().unwrap().push(Instant::now());
            let body = if request.line.contains("/search?") {
                "[]".into()
            } else {
                directions()
            };
            (200, body)
        })),
    )
    .await;
    let first = provider(&fake);
    let second = provider(&fake);
    let third = provider(&fake);
    let (a, b, c) = tokio::join!(
        first.geocode("Музей"),
        second.route(start(), end()),
        third.geocode("Парк")
    );
    assert!(a.unwrap().is_none());
    b.unwrap();
    assert!(c.unwrap().is_none());
    let times = arrivals.lock().unwrap();
    assert_eq!(times.len(), 3);
    for pair in times.windows(2) {
        // Небольшой допуск на планировщик и доставку по loopback.
        assert!(pair[1].duration_since(pair[0]) >= Duration::from_millis(950));
    }
}

#[tokio::test]
async fn empty_results_are_cached_but_errors_are_not() {
    let fake = FakeHttp::start(
        [
            Action::Respond(200, "[]".into()),
            Action::Respond(429, "{}".into()),
            Action::Respond(200, r#"[{"lat":"55.5","lon":"61.5"}]"#.into()),
        ],
        Action::Respond(500, "{}".into()),
    )
    .await;
    let api = provider(&fake);
    assert!(api.geocode("Нет места").await.unwrap().is_none());
    assert!(api.geocode("Нет места").await.unwrap().is_none());
    assert!(matches!(
        api.geocode("Музей").await,
        Err(Error::Unavailable)
    ));
    assert!(api.geocode("Музей").await.unwrap().is_some());
    assert_eq!(fake.received().len(), 3);
}

#[tokio::test]
async fn bad_replies_and_network_failures_are_safe() {
    for action in [
        Action::Respond(503, "55.123456 61.234567".into()),
        Action::Respond(200, "not json".into()),
        Action::Respond(200, r#"{"code":"NoRoute","routes":[]}"#.into()),
        Action::Respond(200, r#"{"code":"Ok","routes":[]}"#.into()),
        Action::Respond(200, r#"{"code":"Ok","routes":[{"duration":-1,"distance":1,"geometry":{"type":"LineString","coordinates":[[0,0],[1,1]]}}]}"#.into()),
        Action::Respond(200, r#"{"code":"Ok","routes":[{"duration":1,"distance":1,"geometry":{"type":"LineString","coordinates":[[0,91],[1,1]]}}]}"#.into()),
        Action::Close,
        Action::Hang,
    ] {
        let fake = FakeHttp::start([], action).await;
        let error = provider(&fake).route(start(), end()).await.err().unwrap();
        assert_eq!(error, Error::Unavailable);
        assert!(!format!("{error:?} {error}").contains("55.123456"));
    }
}

#[tokio::test]
async fn disabled_and_invalid_inputs_never_call_provider() {
    let fake = FakeHttp::start([], Action::Respond(500, "{}".into())).await;
    let api = OsrmNominatim::new(Settings {
        enabled: false,
        osrm_url: fake.root_url(),
        nominatim_url: fake.root_url(),
    });
    assert!(matches!(
        api.route(start(), end()).await,
        Err(Error::Unavailable)
    ));
    assert!(matches!(
        api.geocode("Музей").await,
        Err(Error::Unavailable)
    ));
    let api = provider(&fake);
    assert!(matches!(
        api.route(
            Point {
                lat: f64::NAN,
                lon: 0.0,
            },
            end()
        )
        .await,
        Err(Error::Invalid)
    ));
    assert!(matches!(api.geocode("").await, Err(Error::Invalid)));
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn malformed_geocoding_and_redirects_are_rejected() {
    for body in [
        r#"[{"lat":"bad","lon":"61"}]"#,
        r#"[{"lat":"91","lon":"61"}]"#,
        r#"[{"lat":"55"}]"#,
    ] {
        let fake = FakeHttp::start([], Action::Respond(200, body.into())).await;
        assert!(matches!(
            provider(&fake).geocode("Музей").await,
            Err(Error::Unavailable)
        ));
    }
    let target = FakeHttp::start([], Action::Respond(200, directions())).await;
    let fake = FakeHttp::start(
        [Action::Reply(
            302,
            vec![("location", format!("{}/never-follow", target.root_url()))],
            String::new(),
        )],
        Action::Respond(200, directions()),
    )
    .await;
    assert!(matches!(
        provider(&fake).route(start(), end()).await,
        Err(Error::Unavailable)
    ));
    assert_eq!(fake.received().len(), 1);
    assert!(target.received().is_empty());
}
