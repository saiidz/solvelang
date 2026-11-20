//! Conformance tests for the shipped signed-gate example
//! (`examples/gated_release.solve`): the example must be
//! formatter-clean, must run green once a throwaway key signs it in
//! a temp directory, and must refuse when unsigned or when its
//! evidence is tampered with. Keys are generated per test and never
//! leave the temp directory.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

fn solvec(args: &[&str], cwd: &Path) -> Output {
    Command::new(env!("CARGO_BIN_EXE_solvec"))
        .args(args)
        .current_dir(cwd)
        .output()
        .expect("solvec binary runs")
}

fn examples_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../examples")
}

fn temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "solvec_gates_example_{name}_{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).expect("temp dir created");
    dir
}

fn stdout(output: &Output) -> String {
    String::from_utf8_lossy(&output.stdout).into_owned()
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

/// Copies the shipped example and its evidence into a temp dir,
/// generates a throwaway key, registers it, and signs the gate.
fn signed_example_dir(name: &str) -> PathBuf {
    let dir = temp_dir(name);
    fs::copy(
        examples_dir().join("gated_release.solve"),
        dir.join("gated_release.solve"),
    )
    .expect("example copied");
    fs::copy(
        examples_dir().join("sample_input.json"),
        dir.join("sample_input.json"),
    )
    .expect("evidence copied");

    let keygen = solvec(
        &[
            "keygen",
            "--id",
            "release_key",
            "--out",
            "release_key.key.json",
        ],
        &dir,
    );
    assert_eq!(keygen.status.code(), Some(0), "keygen: {}", stderr(&keygen));
    let private = solvec::gate_tooling::load_private_key(&dir.join("release_key.key.json"))
        .expect("private key loads");
    let registry = serde_json::json!({
        "format": "solvelang.key-registry",
        "version": 1,
        "keys": [{
            "id": "release_key",
            "algorithm": "ed25519",
            "public_key": solvec::gate_tooling::base64_encode(
                &private.1.verifying_key().to_bytes()
            ),
            "status": "active"
        }]
    });
    fs::write(
        dir.join("solve-keys.json"),
        serde_json::to_string_pretty(&registry).expect("registry serializes"),
    )
    .expect("registry written");

    let sign = solvec(
        &[
            "sign",
            "gated_release.solve",
            "--gate",
            "release",
            "--key",
            "release_key.key.json",
        ],
        &dir,
    );
    assert_eq!(sign.status.code(), Some(0), "sign: {}", stderr(&sign));
    dir
}

#[test]
fn shipped_example_is_formatter_clean() {
    let example = examples_dir().join("gated_release.solve");
    let output = Command::new(env!("CARGO_BIN_EXE_solvec"))
        .args(["fmt", "--check", example.to_str().expect("utf8 path")])
        .output()
        .expect("solvec binary runs");
    assert_eq!(
        output.status.code(),
        Some(0),
        "the shipped example must survive solvec fmt unchanged: {}",
        stderr(&output)
    );
}

#[test]
fn shipped_example_runs_once_signed() {
    let dir = signed_example_dir("signed");
    let run = solvec(&["run", "gated_release.solve"], &dir);
    assert_eq!(run.status.code(), Some(0), "run: {}", stderr(&run));
    let out = stdout(&run);
    assert!(out.contains("Preparing release"), "pre-gate output: {out}");
    assert!(
        out.contains("Gate passed: release approved"),
        "post-gate output proves the gate passed: {out}"
    );
}

#[test]
fn shipped_example_refuses_when_unsigned() {
    let dir = temp_dir("unsigned");
    fs::copy(
        examples_dir().join("gated_release.solve"),
        dir.join("gated_release.solve"),
    )
    .expect("example copied");
    fs::copy(
        examples_dir().join("sample_input.json"),
        dir.join("sample_input.json"),
    )
    .expect("evidence copied");
    let run = solvec(&["run", "gated_release.solve"], &dir);
    assert_eq!(run.status.code(), Some(7));
    assert!(
        stderr(&run).contains("gate_unsigned"),
        "refusal code recorded: {}",
        stderr(&run)
    );
    assert!(
        !stdout(&run).contains("Gate passed"),
        "nothing past the gate may run"
    );
}

#[test]
fn shipped_example_refuses_tampered_evidence() {
    let dir = signed_example_dir("tampered");
    fs::write(dir.join("sample_input.json"), "{\"tampered\":true}\n").expect("evidence tampered");
    let run = solvec(&["run", "gated_release.solve"], &dir);
    assert_eq!(run.status.code(), Some(7));
    assert!(
        stderr(&run).contains("gate_evidence_mismatch"),
        "refusal code recorded: {}",
        stderr(&run)
    );
    assert!(
        !stdout(&run).contains("Gate passed"),
        "nothing past the gate may run"
    );
}
