use std::collections::BTreeSet;

use serde_json::{Map, Value as JsonValue};
use solvec_wasm::run_pure_v1;

const FIXTURES: &str = include_str!("../../conformance/browser-preview-v1.json");
const FIXTURE_SCHEMA: &str = "solvelang.browser-preview-conformance";
const FIXTURE_VERSION: u64 = 1;
const CONTRACT: &str = "solvelang.run_pure";
const CONTRACT_VERSION: u64 = 1;

#[test]
fn browser_preview_v1_fixtures_match_the_canonical_pure_wrapper() {
    let manifest: JsonValue =
        serde_json::from_str(FIXTURES).expect("fixture manifest is valid JSON");
    let cases = validate_manifest(&manifest);

    for case in cases {
        let object = case
            .as_object()
            .expect("validated fixture case is an object");
        let id = object["id"].as_str().expect("validated case id is text");
        let source = object["source"]
            .as_str()
            .expect("validated case source is text");
        let expected = object["expect"]
            .as_object()
            .expect("validated expectation is an object");
        let outcome = expected["outcome"]
            .as_str()
            .expect("validated outcome is text");

        let response: JsonValue = serde_json::from_str(&run_pure_v1(source, ""))
            .unwrap_or_else(|error| panic!("{id}: wrapper returned invalid JSON: {error}"));
        assert_eq!(response["contract"], CONTRACT, "{id}: contract drifted");
        assert_eq!(
            response["version"], CONTRACT_VERSION,
            "{id}: contract version drifted"
        );

        match outcome {
            "success" => {
                assert_eq!(response["ok"], true, "{id}: expected success: {response}");
                assert_eq!(
                    response["outputs"], expected["outputs"],
                    "{id}: typed output drifted"
                );
                assert!(
                    response["error"].is_null(),
                    "{id}: success carried an error"
                );
            }
            "failure" => {
                assert_eq!(response["ok"], false, "{id}: expected failure: {response}");
                assert_eq!(
                    response["error"]["kind"], expected["canonical_error"],
                    "{id}: canonical failure category drifted"
                );
                assert!(
                    response["error"]["message"]
                        .as_str()
                        .is_some_and(|message| !message.is_empty()),
                    "{id}: failure must include a non-empty diagnostic"
                );
            }
            other => panic!("{id}: unsupported validated outcome {other:?}"),
        }
    }
}

fn validate_manifest(manifest: &JsonValue) -> &[JsonValue] {
    let object = manifest
        .as_object()
        .expect("fixture manifest must be a JSON object");
    assert_exact_keys(object, &["schema", "version", "cases"], "manifest");
    assert_eq!(
        object["schema"].as_str(),
        Some(FIXTURE_SCHEMA),
        "fixture schema must be explicitly versioned"
    );
    assert_eq!(
        object["version"].as_u64(),
        Some(FIXTURE_VERSION),
        "fixture version drift must fail closed"
    );

    let cases = object["cases"]
        .as_array()
        .expect("fixture cases must be an array");
    assert!(!cases.is_empty(), "fixture manifest must not be empty");

    let mut ids = BTreeSet::new();
    for case in cases {
        let case_object = case.as_object().expect("fixture case must be an object");
        assert_exact_keys(case_object, &["id", "source", "expect"], "case");
        let id = case_object["id"]
            .as_str()
            .filter(|id| !id.is_empty())
            .expect("fixture id must be non-empty text");
        assert!(ids.insert(id), "duplicate fixture id {id:?}");
        case_object["source"]
            .as_str()
            .expect("fixture source must be text");

        let expected = case_object["expect"]
            .as_object()
            .expect("fixture expectation must be an object");
        match expected.get("outcome").and_then(JsonValue::as_str) {
            Some("success") => {
                assert_exact_keys(expected, &["outcome", "outputs"], id);
                let outputs = expected["outputs"]
                    .as_array()
                    .expect("successful fixture outputs must be an array");
                for value in outputs {
                    assert!(
                        value.is_string() || value.as_i64().is_some(),
                        "{id}: preview-v1 outputs are restricted to text or integers"
                    );
                }
            }
            Some("failure") => {
                assert_exact_keys(expected, &["outcome", "canonical_error"], id);
                let category = expected["canonical_error"]
                    .as_str()
                    .expect("failed fixture canonical_error must be text");
                assert!(
                    matches!(category, "parse" | "evaluation"),
                    "{id}: preview-v1 failure category must stay inside the overlap contract"
                );
            }
            _ => panic!("{id}: outcome must be success or failure"),
        }
    }

    cases
}

fn assert_exact_keys(object: &Map<String, JsonValue>, expected: &[&str], context: &str) {
    let actual = object.keys().map(String::as_str).collect::<BTreeSet<_>>();
    let expected = expected.iter().copied().collect::<BTreeSet<_>>();
    assert_eq!(actual, expected, "{context}: fixture keys drifted");
}
