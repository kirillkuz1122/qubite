use super::*;
use qubite_testkit::fake_http::{Action, FakeHttp};

#[tokio::test]
async fn expired_place_and_route_entries_are_reloaded() {
    let fake = FakeHttp::start(
        [
            Action::Respond(200, r#"[{"lat":"55","lon":"61"}]"#.into()),
            Action::Respond(200, r#"{"code":"Ok","routes":[{"duration":60,"distance":1,"geometry":{"type":"LineString","coordinates":[[61,55],[62,56]]}}]}"#.into()),
        ],
        Action::Respond(500, "{}".into()),
    )
    .await;
    let api = OsrmNominatim::new(Settings {
        enabled: true,
        osrm_url: fake.root_url(),
        nominatim_url: fake.root_url(),
    });
    let from = Point {
        lat: 55.0,
        lon: 61.0,
    };
    let to = Point {
        lat: 56.0,
        lon: 62.0,
    };
    api.places.0.lock().await.insert(
        "музей".into(),
        Entry {
            until: Instant::now() - Duration::from_secs(1),
            value: None,
        },
    );
    api.routes.0.lock().await.insert(
        format!("{:?}:{:?}", from.rounded(), to.rounded()),
        Entry {
            until: Instant::now() - Duration::from_secs(1),
            value: Route {
                seconds: 1.0,
                meters: 0.0,
                geometry: vec![],
            },
        },
    );
    assert!(api.geocode("Музей").await.unwrap().is_some());
    assert_eq!(api.route(from, to).await.unwrap().seconds, 60.0);
    assert_eq!(fake.received().len(), 2);
    let entries = api.places.0.lock().await;
    let remaining = entries["музей"].until - Instant::now();
    assert!(remaining > Duration::from_secs(23 * 60 * 60));
    assert!(remaining <= TTL);
}
