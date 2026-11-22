//! Phase 4 (signed gates), stack C: end-to-end CLI proof.
//!
//! Every test drives the real `solvec` binary in a temp directory:
//! keygen → register → sign → run. The happy path passes the gate and
//! executes past it; every tamper, replay, forgery, and removal
//! attempt refuses with exit status 7 and its distinct gate code, and
//! the statement after the gate never runs. Test keys are generated
//! fresh inside each test's temp directory and never leave it.

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

const GATED: &str = r#"print("before")
gate release {
    evidence "evidence.json"
    signer release_key
}
print("after")
"#;

const TWO_GATES: &str = r#"gate release {
    evidence "evidence.json"
    signer release_key
}
gate publish {
    evidence "evidence.json"
    signer release_key
}
print("done")
"#;

struct Fixture {
    dir: PathBuf,
    workflow: PathBuf,
}

impl Fixture {
    fn new(test: &str, source: &str) -> Self {
        let mut dir = std::env::temp_dir();
        dir.push(format!("solvec_gates_{test}_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create fixture dir");
        fs::write(dir.join("evidence.json"), "{\"ok\": true}\n").expect("write evidence");
        let workflow = dir.join("release.solve");
        fs::write(&workflow, source).expect("write workflow");
        Fixture { dir, workflow }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.dir.join(name)
    }

    fn workflow_str(&self) -> String {
        self.workflow.to_string_lossy().to_string()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

fn solvec(args: &[&str]) -> (i32, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_solvec"))
        .args(args)
        .output()
        .expect("failed to run solvec");
    (
        output.status.code().unwrap_or(-1),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

fn keygen(fixture: &Fixture, id: &str) -> PathBuf {
    let key_file = fixture.path(&format!("{id}.key.json"));
    let (code, stdout, stderr) =
        solvec(&["keygen", "--id", id, "--out", key_file.to_str().unwrap()]);
    assert_eq!(code, 0, "keygen failed: {stderr}");
    assert!(stdout.contains(id), "keygen output names the key: {stdout}");
    key_file
}

/// Register a generated key in the fixture's default registry,
/// exactly as an operator would from the keygen output.
fn register(fixture: &Fixture, key_file: &Path, id: &str) {
    let (_, signing) =
        solvec::gate_tooling::load_private_key(key_file).expect("generated key loads");
    let public_key = solvec::gate_tooling::base64_encode(&signing.verifying_key().to_bytes());
    let registry = serde_json::json!({
        "format": "solvelang.key-registry",
        "version": 1,
        "keys": [{
            "id": id,
            "algorithm": "ed25519",
            "public_key": public_key,
            "status": "active",
        }],
    });
    fs::write(
        fixture.path("solve-keys.json"),
        serde_json::to_string_pretty(&registry).unwrap(),
    )
    .expect("write registry");
}

fn sign(fixture: &Fixture, gate: &str, key_file: &Path, extra: &[&str]) -> (i32, String, String) {
    let workflow = fixture.workflow_str();
    let mut args = vec![
        "sign",
        workflow.as_str(),
        "--gate",
        gate,
        "--key",
        key_file.to_str().unwrap(),
    ];
    args.extend_from_slice(extra);
    solvec(&args)
}

fn run(fixture: &Fixture) -> (i32, String, String) {
    let workflow = fixture.workflow_str();
    solvec(&["run", workflow.as_str()])
}

fn signed_fixture(test: &str) -> (Fixture, PathBuf) {
    let fixture = Fixture::new(test, GATED);
    let key_file = keygen(&fixture, "release_key");
    register(&fixture, &key_file, "release_key");
    let (code, _, stderr) = sign(&fixture, "release", &key_file, &[]);
    assert_eq!(code, 0, "sign failed: {stderr}");
    (fixture, key_file)
}

fn assert_refused(result: (i32, String, String), code: &str, after_marker: &str) {
    let (exit, stdout, stderr) = result;
    assert_eq!(
        exit, 7,
        "expected gate refusal exit 7, got {exit}: {stderr}"
    );
    assert!(
        stderr.contains(code),
        "expected refusal code {code} in stderr: {stderr}"
    );
    assert!(
        !stdout.contains(after_marker),
        "execution must not pass the gate; stdout: {stdout}"
    );
}

#[test]
fn signed_gate_passes_and_the_workflow_proceeds() {
    let (fixture, _) = signed_fixture("happy");
    let (code, stdout, stderr) = run(&fixture);
    assert_eq!(code, 0, "signed run failed: {stderr}");
    assert!(stdout.contains("before"), "stdout: {stdout}");
    assert!(stdout.contains("after"), "stdout: {stdout}");
}

#[test]
fn unsigned_gate_refuses() {
    let fixture = Fixture::new("unsigned", GATED);
    let key_file = keygen(&fixture, "release_key");
    register(&fixture, &key_file, "release_key");
    assert_refused(run(&fixture), "gate_unsigned", "after");
}

#[test]
fn signer_who_is_not_registered_refuses() {
    // The signatures artifact names release_key, but the registry the
    // run actually uses does not contain that key.
    let (fixture, _) = signed_fixture("unregistered");
    let other = keygen(&fixture, "other_key");
    register(&fixture, &other, "other_key");
    assert_refused(run(&fixture), "gate_unknown_signer", "after");
}

#[test]
fn forged_signature_refuses() {
    // Bypass attempt: keep the registered signer id but replace the
    // signature bytes with a forgery.
    let (fixture, _) = signed_fixture("forged");
    let signatures_path = fixture.path("release.solve.signatures.json");
    let mut artifact: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&signatures_path).unwrap()).unwrap();
    artifact["signatures"][0]["signature"] =
        serde_json::Value::String(solvec::gate_tooling::base64_encode(&[7u8; 64]));
    fs::write(
        &signatures_path,
        serde_json::to_string_pretty(&artifact).unwrap(),
    )
    .unwrap();
    assert_refused(run(&fixture), "gate_signature_invalid", "after");
}

#[test]
fn tampered_evidence_refuses() {
    let (fixture, _) = signed_fixture("evidence_tamper");
    fs::write(fixture.path("evidence.json"), "{\"ok\": false}\n").unwrap();
    assert_refused(run(&fixture), "gate_evidence_mismatch", "after");
}

#[test]
fn tampered_workflow_refuses() {
    let (fixture, _) = signed_fixture("workflow_tamper");
    let mut source = fs::read_to_string(&fixture.workflow).unwrap();
    source.push_str("\nprint(\"sneaky\")\n");
    fs::write(&fixture.workflow, source).unwrap();
    let (exit, stdout, stderr) = run(&fixture);
    assert_eq!(exit, 7, "expected refusal, got {exit}: {stderr}");
    assert!(
        stderr.contains("gate_workflow_mismatch"),
        "stderr: {stderr}"
    );
    assert!(!stdout.contains("sneaky"), "stdout: {stdout}");
    assert!(!stdout.contains("after"), "stdout: {stdout}");
}

#[test]
fn signature_replayed_from_another_gate_refuses() {
    // Bypass attempt: copy the release gate's signature record onto
    // the publish gate. The canonical payload binds the gate name, so
    // the replayed signature cannot verify.
    let fixture = Fixture::new("replay", TWO_GATES);
    let key_file = keygen(&fixture, "release_key");
    register(&fixture, &key_file, "release_key");
    let (code, _, stderr) = sign(&fixture, "release", &key_file, &[]);
    assert_eq!(code, 0, "sign failed: {stderr}");

    let signatures_path = fixture.path("release.solve.signatures.json");
    let mut artifact: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&signatures_path).unwrap()).unwrap();
    let mut replayed = artifact["signatures"][0].clone();
    replayed["gate"] = serde_json::Value::String("publish".to_string());
    artifact["signatures"]
        .as_array_mut()
        .unwrap()
        .push(replayed);
    fs::write(
        &signatures_path,
        serde_json::to_string_pretty(&artifact).unwrap(),
    )
    .unwrap();

    assert_refused(run(&fixture), "gate_signature_invalid", "done");
}

#[test]
fn expired_signature_refuses() {
    let fixture = Fixture::new("expired", GATED);
    let key_file = keygen(&fixture, "release_key");
    register(&fixture, &key_file, "release_key");
    let (code, _, stderr) = sign(&fixture, "release", &key_file, &["--not-after", "100"]);
    assert_eq!(code, 0, "sign failed: {stderr}");
    assert_refused(run(&fixture), "gate_expired", "after");
}

#[test]
fn not_yet_valid_signature_refuses() {
    let fixture = Fixture::new("not_yet", GATED);
    let key_file = keygen(&fixture, "release_key");
    register(&fixture, &key_file, "release_key");
    let (code, _, stderr) = sign(
        &fixture,
        "release",
        &key_file,
        &["--not-before", "4102444800"],
    );
    assert_eq!(code, 0, "sign failed: {stderr}");
    assert_refused(run(&fixture), "gate_not_yet_valid", "after");
}

#[test]
fn revoked_signer_refuses() {
    let (fixture, _) = signed_fixture("revoked");
    let registry_path = fixture.path("solve-keys.json");
    let mut registry: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&registry_path).unwrap()).unwrap();
    registry["keys"][0]["status"] = serde_json::Value::String("revoked".to_string());
    fs::write(
        &registry_path,
        serde_json::to_string_pretty(&registry).unwrap(),
    )
    .unwrap();
    assert_refused(run(&fixture), "gate_signer_revoked", "after");
}

#[test]
fn removed_gate_refuses_before_anything_executes() {
    // Bypass attempt: delete the gate declaration from the workflow
    // and keep the signatures artifact. The run refuses up front —
    // even the first print never executes.
    let (fixture, _) = signed_fixture("removed");
    fs::write(&fixture.workflow, "print(\"unguarded\")\n").unwrap();
    let (exit, stdout, stderr) = run(&fixture);
    assert_eq!(exit, 7, "expected refusal, got {exit}: {stderr}");
    assert!(stderr.contains("gate_removed"), "stderr: {stderr}");
    assert!(!stdout.contains("unguarded"), "stdout: {stdout}");
}

#[test]
fn missing_evidence_file_refuses() {
    let (fixture, _) = signed_fixture("evidence_missing");
    fs::remove_file(fixture.path("evidence.json")).unwrap();
    assert_refused(run(&fixture), "gate_evidence_unavailable", "after");
}

#[test]
fn sign_with_a_key_the_gate_does_not_declare_fails() {
    let fixture = Fixture::new("wrong_signer", GATED);
    let release = keygen(&fixture, "release_key");
    register(&fixture, &release, "release_key");
    let other = keygen(&fixture, "other_key");
    // Register the other key too, so the only problem is the gate's
    // declared signer list.
    let (_, signing) = solvec::gate_tooling::load_private_key(&other).expect("generated key loads");
    let public_key = solvec::gate_tooling::base64_encode(&signing.verifying_key().to_bytes());
    let registry_path = fixture.path("solve-keys.json");
    let mut registry: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&registry_path).unwrap()).unwrap();
    registry["keys"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({
            "id": "other_key",
            "algorithm": "ed25519",
            "public_key": public_key,
            "status": "active",
        }));
    fs::write(
        &registry_path,
        serde_json::to_string_pretty(&registry).unwrap(),
    )
    .unwrap();

    let (code, _, stderr) = sign(&fixture, "release", &other, &[]);
    assert_ne!(code, 0, "signing with an undeclared signer must fail");
    assert!(stderr.contains("release_key"), "stderr: {stderr}");
}

#[test]
fn sign_with_an_unregistered_key_fails() {
    let fixture = Fixture::new("sign_unregistered", GATED);
    let key_file = keygen(&fixture, "release_key");
    // No registry file at all: the key cannot be registered, so the
    // signer tool refuses before producing anything.
    let (code, _, stderr) = sign(&fixture, "release", &key_file, &[]);
    assert_ne!(code, 0, "signing with an unregistered key must fail");
    assert!(!stderr.is_empty());
    assert!(!fixture.path("release.solve.signatures.json").exists());
}

#[test]
fn workflow_without_gates_runs_as_before() {
    let fixture = Fixture::new("ungated", "print(\"plain\")\n");
    let (code, stdout, stderr) = run(&fixture);
    assert_eq!(code, 0, "ungated run failed: {stderr}");
    assert!(stdout.contains("plain"), "stdout: {stdout}");
}
