use serde_json::Value;
use std::{fs, path::PathBuf, process::Command};

fn fixture_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/conformance")
}

fn required_str<'a>(value: &'a Value, key: &str, case: &str) -> &'a str {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("conformance case '{case}' is missing string field '{key}'"))
}

fn string_list(value: &Value, key: &str) -> Vec<&str> {
    value
        .get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .map(|item| {
                    item.as_str()
                        .unwrap_or_else(|| panic!("'{key}' entries must be strings"))
                })
                .collect()
        })
        .unwrap_or_default()
}

#[test]
fn spec_0_1_fixture_conformance() {
    let root = fixture_root();
    let manifest_text = fs::read_to_string(root.join("manifest.json"))
        .expect("failed to read SolveLang conformance manifest");
    let manifest: Value =
        serde_json::from_str(&manifest_text).expect("invalid SolveLang conformance manifest");
    assert_eq!(manifest["schema_version"].as_str(), Some("0.1"));

    let cases = manifest["cases"]
        .as_array()
        .expect("conformance manifest cases must be an array");
    assert!(!cases.is_empty(), "conformance manifest must not be empty");

    for case in cases {
        let name = required_str(case, "name", "<unknown>");
        let directory = root.join(required_str(case, "directory", name));
        let entry = directory.join(required_str(case, "entry", name));
        let canonical_directory = fs::canonicalize(&directory)
            .unwrap_or_else(|error| panic!("case '{name}' directory is invalid: {error}"));
        let canonical_entry = fs::canonicalize(&entry)
            .unwrap_or_else(|error| panic!("case '{name}' entry is invalid: {error}"));
        assert!(
            canonical_entry.starts_with(&canonical_directory),
            "case '{name}' entry escaped its fixture directory"
        );

        let entry_text = canonical_entry.to_string_lossy();
        let directory_text = canonical_directory.to_string_lossy();
        let args = case["args"]
            .as_array()
            .unwrap_or_else(|| panic!("case '{name}' args must be an array"))
            .iter()
            .map(|arg| {
                arg.as_str()
                    .unwrap_or_else(|| panic!("case '{name}' args must be strings"))
                    .replace("{entry}", &entry_text)
                    .replace("{case}", &directory_text)
            })
            .collect::<Vec<_>>();

        let output = Command::new(env!("CARGO_BIN_EXE_solvec"))
            .current_dir(&canonical_directory)
            .args(&args)
            .output()
            .unwrap_or_else(|error| panic!("case '{name}' failed to launch solvec: {error}"));
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let expected_success = case["success"]
            .as_bool()
            .unwrap_or_else(|| panic!("case '{name}' success must be boolean"));

        assert_eq!(
            output.status.success(),
            expected_success,
            "case '{name}' exit mismatch\nstdout={stdout:?}\nstderr={stderr:?}"
        );

        if let Some(expected) = case.get("stdout").and_then(Value::as_str) {
            assert_eq!(stdout, expected, "case '{name}' stdout mismatch");
        }
        if let Some(expected) = case.get("stderr").and_then(Value::as_str) {
            assert_eq!(stderr, expected, "case '{name}' stderr mismatch");
        }
        if let Some(expected) = case.get("stdout_newlines").and_then(Value::as_u64) {
            assert_eq!(
                stdout.matches('\n').count() as u64,
                expected,
                "case '{name}' stdout document count mismatch: {stdout:?}"
            );
        }
        for needle in string_list(case, "stdout_contains") {
            assert!(
                stdout.contains(needle),
                "case '{name}' stdout did not contain {needle:?}: {stdout:?}"
            );
        }
        for needle in string_list(case, "stderr_contains") {
            assert!(
                stderr.contains(needle),
                "case '{name}' stderr did not contain {needle:?}: {stderr:?}"
            );
        }
        for needle in string_list(case, "stdout_not_contains") {
            assert!(
                !stdout.contains(needle),
                "case '{name}' stdout leaked forbidden text {needle:?}: {stdout:?}"
            );
        }
        for needle in string_list(case, "stderr_not_contains") {
            assert!(
                !stderr.contains(needle),
                "case '{name}' stderr leaked forbidden text {needle:?}: {stderr:?}"
            );
        }
    }
}
