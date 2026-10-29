//! Главная через настоящий HTTP-сервер (HOME-001): настройки виджетов,
//! погода, курсы и новости с поддельных источников (в интернет тест не
//! ходит), кэш и «устарело», геолокация без хранения координат, сводка от
//! AI и что пришло в тишину.

mod common;

use std::{net::SocketAddr, sync::Arc};

use common::{Browser, EMAIL, PASSWORD};
use qubite_auth::{Passwords, accounts::NewAccount};
use qubite_db::Database;
use qubite_home::{Sources, Urls};
use qubite_server::{AppState, auth::AuthSettings, home::HomeCommand};
use qubite_testkit::{
    TestDb,
    fake_http::{Action, FakeHttp, Received},
};
use serde_json::{Value, json};

const FORECAST: &str = r#"{"current":{"temperature_2m":-3.24,"apparent_temperature":-7.9,"weather_code":71,"wind_speed_10m":5.1,"is_day":1},
"daily":{"time":["2026-10-20","2026-10-21","2026-10-22"],"weather_code":[71,3,0],
"temperature_2m_max":[-1.0,2.0,4.5],"temperature_2m_min":[-6.0,-4.0,-2.0],"precipitation_probability_max":[70,20,0]}}"#;

const CBR_TODAY: &str = r#"<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="21.10.2026" name="Foreign Currency Market">
<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>x</Name><Value>81,5000</Value></Valute>
<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>x</Name><Value>94,2500</Value></Valute>
<Valute ID="R01375"><NumCode>156</NumCode><CharCode>CNY</CharCode><Nominal>1</Nominal><Name>x</Name><Value>11,3000</Value></Valute>
<Valute ID="R01335"><NumCode>398</NumCode><CharCode>KZT</CharCode><Nominal>100</Nominal><Name>x</Name><Value>16,8000</Value></Valute>
</ValCurs>"#;

const CBR_BEFORE: &str = r#"<?xml version="1.0" encoding="windows-1251"?><ValCurs Date="18.10.2026" name="Foreign Currency Market">
<Valute ID="R01235"><NumCode>840</NumCode><CharCode>USD</CharCode><Nominal>1</Nominal><Name>x</Name><Value>81,0000</Value></Valute>
<Valute ID="R01239"><NumCode>978</NumCode><CharCode>EUR</CharCode><Nominal>1</Nominal><Name>x</Name><Value>95,0000</Value></Valute>
</ValCurs>"#;

fn rss(title: &str, n: usize) -> String {
    let items: String = (0..n)
        .map(|i| {
            format!(
                "<item><title><![CDATA[{title} {i}]]></title>\
                 <link>https://habr.com/ru/articles/{i}/?utm_source=rss</link>\
                 <pubDate>Tue, 20 Oct 2026 0{i}:00:00 GMT</pubDate></item>"
            )
        })
        .collect();
    format!(
        "<?xml version=\"1.0\"?><rss version=\"2.0\"><channel><title>Хабр</title>{items}</channel></rss>"
    )
}

/// Поддельные источники: отвечают по адресу запроса.
async fn sources() -> FakeHttp {
    let respond = Arc::new(|req: &Received| -> (u16, String) {
        let line = &req.line;
        if line.contains("/v1/forecast") {
            (200, FORECAST.into())
        } else if line.contains("/v1/search") {
            if line.contains("name=%D0%95%D0%BA") || line.contains("name=Ек") {
                (
                    200,
                    r#"{"results":[{"name":"Екатеринбург","latitude":56.8519,"longitude":60.6122,"admin1":"Свердловская область","country":"Россия"}]}"#
                        .into(),
                )
            } else {
                (200, "{}".into())
            }
        } else if line.contains("/reverse") {
            (
                200,
                r#"{"lat":"56.84","lon":"60.60","name":"Екатеринбург","address":{"city":"Екатеринбург","state":"Свердловская область","country":"Россия"}}"#
                    .into(),
            )
        } else if line.contains("/scripts/XML_daily.asp") {
            if line.contains("date_req") {
                (200, CBR_BEFORE.into())
            } else {
                (200, CBR_TODAY.into())
            }
        } else if line.contains("/v6/latest/USD") {
            (200, r#"{"rates":{"USD":1,"PHP":50}}"#.into())
        } else if line.contains("/api/v3/simple/price") {
            (200, r#"{"bitcoin":{"usd":70000,"rub":5705000,"usd_24h_change":-2.5},"the-open-network":{"usd":2,"rub":163,"usd_24h_change":null}}"#.into())
        } else if line.contains("/api/v3/coins/markets") {
            (200, r#"[{"id":"bitcoin","symbol":"btc","name":"Bitcoin"},{"id":"the-open-network","symbol":"gram","name":"Toncoin"}]"#.into())
        } else if line.contains("/api/v3/search") {
            (200, r#"{"coins":[{"id":"the-open-network","symbol":"GRAM","name":"Toncoin"}]}"#.into())
        } else if line.contains("/api/contest.list") {
            (200, r#"{"status":"OK","result":[{"id":1234,"name":"Round","phase":"BEFORE","startTimeSeconds":1800000000}]}"#.into())
        } else if line.contains("/rss/ai") {
            (200, rss("ИИ", 5))
        } else if line.contains("/rss/code") {
            (200, rss("Код", 2))
        } else if line.contains("/rss/study") {
            (500, "oops".into())
        } else {
            (404, "{}".into())
        }
    });
    FakeHttp::start([], Action::With(respond)).await
}

async fn spawn(db: Database, fake: &FakeHttp) -> (SocketAddr, Arc<Sources>) {
    let sources = Arc::new(Sources::new(Urls::local(&fake.root_url())));
    let mut state = AppState::with_auth(db, AuthSettings::default());
    state.home = sources.clone();
    let app = qubite_server::router(state).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (address, sources)
}

async fn setup() -> (TestDb, Database, FakeHttp, SocketAddr, Arc<Sources>) {
    let (test_db, db) = TestDb::migrated().await;
    qubite_auth::owner::create(db.pool(), &Passwords::default(), EMAIL, "Кирилл", PASSWORD)
        .await
        .unwrap();
    let fake = sources().await;
    let (address, sources) = spawn(db.clone(), &fake).await;
    (test_db, db, fake, address, sources)
}

fn count(fake: &FakeHttp, part: &str) -> usize {
    fake.received()
        .iter()
        .filter(|req| req.line.contains(part))
        .count()
}

#[tokio::test]
async fn widgets_settings_cache_and_geolocation() {
    let (test_db, db, fake, address, sources) = setup().await;
    let mut me = common::logged_in(address).await;

    // Гость ничего не видит.
    let mut guest = Browser::default();
    for path in ["/api/v1/home", "/api/v1/home/weather", "/api/v1/home/rates"] {
        assert_eq!(guest.get(address, path).await.status, 401, "{path}");
    }

    // По умолчанию — Челябинск, доллар, евро, юань, все темы.
    let reply = me.get(address, "/api/v1/home").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let settings = &reply.body["settings"];
    assert_eq!(settings["place"]["name"], "Челябинск");
    assert_eq!(settings["currencies"], json!(["USD", "EUR", "CNY"]));
    assert_eq!(settings["topics"], json!(["ai", "code", "study", "contests"]));
    assert_eq!(settings["coins"], json!(["bitcoin", "the-open-network"]));
    assert_eq!(reply.body["agent"], true, "у owner агент есть");
    assert!(reply.body["digest"].is_null());

    // Погода: сервер спросил Open-Meteo по точке Челябинска.
    let reply = me.get(address, "/api/v1/home/weather").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["place"], "Челябинск");
    assert_eq!(reply.body["now"]["temperature"], -3.2);
    assert_eq!(reply.body["now"]["text"], "небольшой снег");
    assert_eq!(reply.body["days"].as_array().unwrap().len(), 3);
    assert_eq!(reply.body["stale"], false);
    let asked = fake
        .received()
        .into_iter()
        .find(|req| req.line.contains("/v1/forecast"))
        .unwrap();
    assert!(asked.line.contains("latitude=55.1540"), "{}", asked.line);

    // Второй раз — из кэша, без запроса.
    me.get(address, "/api/v1/home/weather").await;
    assert_eq!(count(&fake, "/v1/forecast"), 1);

    // Курсы: в порядке настройки, с изменением к прошлому дню ЦБ.
    let reply = me.get(address, "/api/v1/home/rates").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["date"], "2026-10-21");
    let items = reply.body["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert_eq!(items[0]["code"], "USD");
    assert_eq!(items[0]["name"], "Доллар США");
    assert_eq!(items[0]["value"], 81.5);
    assert_eq!(items[0]["change"], 0.5);
    assert_eq!(items[1]["change"], -0.75);
    assert!(items[2]["change"].is_null(), "юаня вчера не было");
    assert!(
        reply.body["available"]
            .as_array()
            .unwrap()
            .iter()
            .any(|c| c["code"] == "KZT")
    );

    // Новости: по 3 на тему, свежие сверху; лента «учёбы» лежит — остальные есть.
    let reply = me.get(address, "/api/v1/home/news").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let news = reply.body["items"].as_array().unwrap();
    assert_eq!(news.len(), 6, "{news:#?}");
    assert_eq!(news[0]["topic"], "ai");
    assert_eq!(news[0]["topic_title"], "ИИ и технологии");
    assert_eq!(news[0]["title"], "ИИ 4");
    assert_eq!(news[0]["url"], "https://habr.com/ru/articles/4/");
    assert_eq!(news[3]["topic"], "code");
    assert_eq!(
        reply.body["stale"], false,
        "лента не ответила — тема без неё, а не «устарело»"
    );

    // Настройка: валюты (с проверкой), темы, город из поиска.
    let reply = me
        .patch_json(
            address,
            "/api/v1/home/settings",
            json!({"currencies": ["kzt", "USD"]}),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["currencies"], json!(["KZT", "USD"]));
    let reply = me.get(address, "/api/v1/home/rates").await;
    let items = reply.body["items"].as_array().unwrap();
    assert_eq!(items[0]["code"], "KZT");
    assert_eq!(items[0]["nominal"], 100);
    for bad in [
        json!({"currencies": ["US"]}),
        json!({"topics": ["sport"]}),
        json!({"place": {"name": "", "region": "", "latitude": 1.0, "longitude": 1.0}}),
        json!({"place": {"name": "Нигде", "region": "", "latitude": 100.0, "longitude": 1.0}}),
        json!({"unknown": true}),
    ] {
        let reply = me
            .patch_json(address, "/api/v1/home/settings", bad.clone())
            .await;
        assert!(
            reply.status == 400 || reply.status == 422,
            "{bad}: {:?}",
            reply.status
        );
    }
    let reply = me
        .patch_json(address, "/api/v1/home/settings", json!({"topics": []}))
        .await;
    assert_eq!(reply.body["topics"], json!([]));
    let reply = me.get(address, "/api/v1/home/news").await;
    assert!(reply.body["items"].as_array().unwrap().is_empty());

    let reply = me.get(address, "/api/v1/home/places?q=Ек").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let place = reply.body["items"][0].clone();
    assert_eq!(place["name"], "Екатеринбург");
    assert_eq!(place["region"], "Свердловская область, Россия");
    let reply = me
        .patch_json(address, "/api/v1/home/settings", json!({ "place": place }))
        .await;
    assert_eq!(reply.body["place"]["name"], "Екатеринбург");
    let reply = me.get(address, "/api/v1/home/weather").await;
    assert_eq!(reply.body["place"], "Екатеринбург");
    assert_eq!(
        count(&fake, "/v1/forecast"),
        2,
        "новый город — новый запрос"
    );

    // Геолокация: город по координатам; хранится точка города, а не человека.
    let reply = me
        .post_json(
            address,
            "/api/v1/home/locate",
            json!({"latitude": 56.80123, "longitude": 60.55555}),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["place"]["name"], "Екатеринбург");
    let stored: (f64, f64) =
        sqlx::query_as("SELECT latitude, longitude FROM home_settings LIMIT 1")
            .fetch_one(db.pool())
            .await
            .unwrap();
    assert_eq!(stored, (56.8519, 60.6122));
    let reply = me
        .post_json(
            address,
            "/api/v1/home/locate",
            json!({"latitude": 956.0, "longitude": 0.0}),
        )
        .await;
    assert_eq!(reply.status, 400);

    // Источник лёг: свежего нет — отдаём последнее известное с пометкой.
    drop(fake);
    sources.expire_cache();
    let reply = me.get(address, "/api/v1/home/weather").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["stale"], true);
    // Чего не было в кэше — честная ошибка.
    let reply = me.get(address, "/api/v1/home/places?q=Москва").await;
    assert_eq!(reply.status, 502, "{:?}", reply.body);
    assert_eq!(reply.body["error"], "upstream");

    test_db.drop_db().await;
}

#[tokio::test]
async fn digest_filed_and_held_without_ai() {
    let (test_db, db, _fake, address, _sources) = setup().await;
    let mut me = common::logged_in(address).await;

    // Пример ленты и сводки без AI.
    qubite_server::agent::run(
        &db,
        qubite_server::agent::AgentCommand::Demo { email: None },
    )
    .await
    .unwrap();
    let said = qubite_server::home::run(&db, HomeCommand::DigestDemo { email: None })
        .await
        .unwrap();
    assert!(said.starts_with("Готово"), "{said}");

    // Пришло в тишину и не прочитано — в утренней сводке.
    let owner: uuid::Uuid = sqlx::query_scalar("SELECT id FROM accounts WHERE email = $1")
        .bind(EMAIL)
        .fetch_one(db.pool())
        .await
        .unwrap();
    sqlx::query(
        "INSERT INTO notifications (id, account_id, kind, origin, title, held) \
         VALUES ($1, $2, 'agent', 'agent', 'Есть 30 минут на упр. 145?', true), \
                ($3, $2, 'reminder', 'owner', 'Не в тишину', false)",
    )
    .bind(uuid::Uuid::now_v7())
    .bind(owner)
    .bind(uuid::Uuid::now_v7())
    .execute(db.pool())
    .await
    .unwrap();

    let reply = me.get(address, "/api/v1/home").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let digest = &reply.body["digest"];
    let items = digest["items"].as_array().unwrap();
    assert_eq!(items.len(), 3, "{items:#?}");
    assert_eq!(items[0]["kind"], "important");
    assert_eq!(items[0]["link"]["type"], "task");
    assert!(items[0]["link"]["id"].is_string());
    assert_eq!(items[1]["link"]["type"], "action");
    assert_eq!(items[2]["kind"], "news");
    assert_eq!(items[2]["link"]["type"], "url");

    let filed = reply.body["filed"].as_array().unwrap();
    assert_eq!(filed.len(), 1, "{filed:#?}");
    assert!(
        filed[0]["summary"]
            .as_str()
            .unwrap()
            .starts_with("Разложил мысль «упр. 145 по русскому»")
    );
    assert!(filed[0]["object_id"].is_string());

    let held = reply.body["held"].as_array().unwrap();
    assert_eq!(held.len(), 1);
    assert_eq!(held[0]["title"], "Есть 30 минут на упр. 145?");

    // Сводка — строка ленты: откатил — пропала с Главной.
    let action = digest["action_id"].as_str().unwrap().to_owned();
    let reply = me
        .post_json(
            address,
            &format!("/api/v1/agent/actions/{action}/revert"),
            json!({"force": false}),
        )
        .await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    let reply = me.get(address, "/api/v1/home").await;
    assert!(reply.body["digest"].is_null());

    // Без гранта на агента — Главная без сводки и без «разложил».
    qubite_auth::accounts::create(
        db.pool(),
        &Passwords::default(),
        NewAccount {
            email: "student@qubite.ru",
            display_name: "",
            password: "пароль ученика",
            email_verified: true,
        },
        None,
    )
    .await
    .unwrap();
    let mut student = Browser::default();
    student
        .login(address, "student@qubite.ru", "пароль ученика")
        .await;
    let reply = student.get(address, "/api/v1/home").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["agent"], false);
    assert!(reply.body["digest"].is_null());
    assert_eq!(reply.body["filed"], Value::Array(Vec::new()));
    let reply = student.get(address, "/api/v1/home/weather").await;
    assert_eq!(reply.status, 200, "погода есть и без агента");

    test_db.drop_db().await;
}

#[tokio::test]
async fn selectable_currencies_coins_catalog_and_settings() {
    let (test_db, db, fake, address, sources) = setup().await;
    let mut guest = Browser::default();
    for path in ["/api/v1/home/settings", "/api/v1/home/coins", "/api/v1/home/coins/search?q=ton"] {
        assert_eq!(guest.get(address, path).await.status, 401, "{path}");
    }
    let mut me = common::logged_in(address).await;
    let reply = me.get(address, "/api/v1/home/settings").await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["coins"], json!(["bitcoin", "the-open-network"]));
    assert_eq!(reply.body["available_topics"], json!([
        {"id":"ai","title":"ИИ и технологии"},
        {"id":"code","title":"Программирование"},
        {"id":"study","title":"Олимпиады и учёба"},
        {"id":"contests","title":"Соревнования по программированию"},
    ]));
    let reply = me.patch_json(address, "/api/v1/home/settings", json!({
        "currencies": ["php", "USD"],
        "coins": ["the-open-network", "bitcoin", "bitcoin"],
        "topics": ["contests"],
    })).await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["coins"], json!(["the-open-network", "bitcoin"]));
    let reply = me.get(address, "/api/v1/home/settings").await;
    assert_eq!(reply.body["currencies"], json!(["PHP", "USD"]));
    assert_eq!(reply.body["coins"], json!(["the-open-network", "bitcoin"]));
    assert_eq!(reply.body["topics"], json!(["contests"]));
    let stored: Vec<String> = sqlx::query_scalar("SELECT coins FROM home_settings LIMIT 1")
        .fetch_one(db.pool()).await.unwrap();
    assert_eq!(stored, ["the-open-network", "bitcoin"]);
    let reply = me.get(address, "/api/v1/home/rates").await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["items"][0]["source"], "er-api");
    assert_eq!(reply.body["items"][0]["value"], 1.63);
    assert_eq!(reply.body["items"][1]["source"], "cbr");
    let reply = me.get(address, "/api/v1/home/coins").await;
    assert_eq!(reply.status, 200, "{:?}", reply.body);
    assert_eq!(reply.body["items"][0]["id"], "the-open-network");
    assert_eq!(reply.body["items"][0]["name"], "Toncoin");
    assert_eq!(reply.body["items"][0]["symbol"], "gram");
    assert_eq!(reply.body["items"][0]["usd"], 2.0);
    assert_eq!(reply.body["items"][0]["rub"], 163.0);
    assert!(reply.body["items"][0]["change_24h"].is_null());
    assert_eq!(reply.body["items"][1]["change_24h"], -2.5);
    assert_eq!(reply.body["stale"], false);
    assert!(reply.body["fetched_at"].is_string());
    let reply = me.get(address, "/api/v1/home/coins/search?q=ton").await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["items"][0]["id"], "the-open-network");
    let reply = me.get(address, "/api/v1/home/news").await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["items"][0]["source"], "Codeforces");
    assert_eq!(reply.body["items"][0]["url"], "https://codeforces.com/contests/1234");
    assert_eq!(reply.body["items"][0]["topic_title"], "Соревнования по программированию");

    for bad in [
        json!({"coins":["Bitcoin"]}), json!({"coins":["../bitcoin"]}),
        json!({"coins":["coin_id"]}), json!({"coins":[""]}),
        json!({"coins":["x".repeat(65)]}),
        json!({"coins":["a","b","c","d","e","f","g"]}),
        json!({"currencies":["USD","EUR","CNY","PHP","JPY","GBP","KZT","AED","THB"]}),
    ] {
        let reply = me.patch_json(address, "/api/v1/home/settings", bad.clone()).await;
        assert_eq!(reply.status, 400, "{bad}: {:?}", reply.body);
        assert_eq!(reply.body["error"], "invalid");
    }
    for path in ["/api/v1/home/coins/search?q=x", "/api/v1/home/coins/search?q="] {
        assert_eq!(me.get(address, path).await.status, 400);
    }
    // Новая граница допустима; пустой PATCH не теряет монеты.
    let reply = me.patch_json(address, "/api/v1/home/settings", json!({
        "currencies":["USD","EUR","CNY","PHP","JPY","GBP","KZT","AED"],
        "coins":["a","b","c","d","e","f"],
    })).await;
    assert_eq!(reply.status, 200);
    let reply = me.patch_json(address, "/api/v1/home/settings", json!({})).await;
    assert_eq!(reply.body["coins"], json!(["a","b","c","d","e","f"]));
    assert!(sqlx::query("UPDATE home_settings SET coins = ARRAY['a','b','c','d','e','f','g']")
        .execute(db.pool()).await.is_err());
    assert!(sqlx::query("UPDATE home_settings SET currencies = ARRAY['USD','EUR','CNY','PHP','JPY','GBP','KZT','AED','THB']")
        .execute(db.pool()).await.is_err());
    // Тема из будущей версии базы спокойно пропускается при чтении.
    sqlx::query("UPDATE home_settings SET topics = ARRAY['future','contests']")
        .execute(db.pool()).await.unwrap();
    let reply = me.get(address, "/api/v1/home/settings").await;
    assert_eq!(reply.body["topics"], json!(["contests"]));
    me.patch_json(address, "/api/v1/home/settings", json!({"coins":["the-open-network","bitcoin"], "currencies":["PHP","USD"]})).await;
    drop(fake);
    sources.expire_cache();
    for path in ["/api/v1/home/coins", "/api/v1/home/coins/search?q=ton", "/api/v1/home/news", "/api/v1/home/rates"] {
        let reply = me.get(address, path).await;
        assert_eq!(reply.status, 200, "{path}: {:?}", reply.body);
        assert_eq!(reply.body["stale"], true, "{path}");
    }
    let reply = me.get(address, "/api/v1/home/coins/search?q=uncached").await;
    assert_eq!(reply.status, 502);
    assert_eq!(reply.body["error"], "upstream");
    me.patch_json(address, "/api/v1/home/settings", json!({"coins":["uncached"]})).await;
    assert_eq!(me.get(address, "/api/v1/home/coins").await.status, 502);
    let reply = me.patch_json(address, "/api/v1/home/settings", json!({"coins":[]})).await;
    assert_eq!(reply.status, 200);
    let reply = me.get(address, "/api/v1/home/coins").await;
    assert_eq!(reply.status, 200);
    assert_eq!(reply.body["items"], json!([]));
    test_db.drop_db().await;
}
