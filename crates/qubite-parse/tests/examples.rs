//! Общие примеры фраз (`fixtures/examples.json`) и «золотой» набор (`fixtures/golden.json`):
//! их же проверяет web (`packages/ui/src/parse.test.ts`), чтобы разбор совпадал везде.

use qubite_parse::{LocalNow, parse};
use serde_json::{Value, json};

fn fixture(name: &str) -> Value {
    let path = format!("{}/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    serde_json::from_str(&std::fs::read_to_string(path).expect("файл примеров")).expect("JSON")
}

fn run(input: &str, now: &str) -> Value {
    let now = LocalNow::from_iso(now).expect("время в примере");
    serde_json::to_value(parse(input, now)).expect("в JSON")
}

#[test]
fn examples_parse_as_expected() {
    let file = fixture("examples.json");
    let default_now = file["now"].as_str().expect("now");
    let mut failures = vec![];
    for ex in file["examples"].as_array().expect("examples") {
        let input = ex["input"].as_str().expect("input");
        let now = ex["now"].as_str().unwrap_or(default_now);
        let got = run(input, now);
        let expect = &ex["expect"];
        if expect.is_null() {
            if !got.is_null() {
                failures.push(format!("«{input}»: ждали ничего, получили {got}"));
            }
            continue;
        }
        for (key, want) in expect.as_object().expect("expect") {
            if &got[key] != want {
                failures.push(format!(
                    "«{input}» {key}: ждали {want}, получили {}",
                    got[key]
                ));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn golden_matches() {
    let corpus = fixture("corpus.json");
    let mut cases = vec![];
    for now in corpus["now"].as_array().expect("now") {
        let now = now.as_str().expect("now");
        for input in corpus["inputs"].as_array().expect("inputs") {
            let input = input.as_str().expect("input");
            cases.push(json!({ "now": now, "input": input, "output": run(input, now) }));
        }
    }
    let golden = Value::Array(cases);
    let path = format!("{}/fixtures/golden.json", env!("CARGO_MANIFEST_DIR"));
    if std::env::var("QUBITE_PARSE_GOLDEN").as_deref() == Ok("update") {
        // по строке на фразу: файл меньше, а разница в git — понятнее
        let lines: Vec<String> = golden
            .as_array()
            .expect("массив")
            .iter()
            .map(|case| serde_json::to_string(case).expect("JSON"))
            .collect();
        let text = format!("[\n{}\n]\n", lines.join(",\n"));
        std::fs::write(&path, text).expect("запись golden.json");
        return;
    }
    let saved = fixture("golden.json");
    assert!(
        saved == golden,
        "разбор изменился: проверь и обнови golden.json (QUBITE_PARSE_GOLDEN=update)"
    );
}
