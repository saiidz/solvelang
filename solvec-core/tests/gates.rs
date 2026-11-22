//! Signed-gate format tests: the canonical payload a signature covers
//! and the pure precheck refusal matrix. Cryptographic verification
//! itself crosses the host interface and is covered where the native
//! host implements it.

use std::collections::BTreeMap;

use solvec_core::evaluator::{
    DenyAllHost, GateBook, GateDeclaration, GateSignatureRecord, RuntimeError, RuntimeErrorKind,
    RuntimeHost, gate_canonical_payload, gate_codes, precheck_gate,
};

const WORKFLOW_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const OTHER_WORKFLOW_SHA: &str = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const EVIDENCE_SHA: &str = "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const OTHER_EVIDENCE_SHA: &str = "dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

fn record() -> GateSignatureRecord {
    GateSignatureRecord {
        gate: "release".to_string(),
        workflow_sha256: WORKFLOW_SHA.to_string(),
        evidence_sha256: EVIDENCE_SHA.to_string(),
        signer: "release-key".to_string(),
        not_before: None,
        not_after: None,
        signature: "c2ln".to_string(),
    }
}

fn declaration() -> GateDeclaration {
    GateDeclaration {
        name: "release".to_string(),
        evidence: "release/evidence.json".to_string(),
        signers: Vec::new(),
    }
}

fn book() -> GateBook {
    let mut evidence = BTreeMap::new();
    evidence.insert("release".to_string(), EVIDENCE_SHA.to_string());
    GateBook {
        workflow_sha256: WORKFLOW_SHA.to_string(),
        signatures: vec![record()],
        evidence_sha256: evidence,
        now_unix_seconds: None,
    }
}

#[test]
fn canonical_payload_is_the_exact_signed_bytes() {
    let payload = gate_canonical_payload(&record());
    let expected = format!(
        "solvelang-gate-signature-v1\nworkflow-sha256:{WORKFLOW_SHA}\ngate:release\nevidence-sha256:{EVIDENCE_SHA}\nsigner:release-key\nnot-before:-\nnot-after:-\n"
    );
    assert_eq!(
        String::from_utf8(payload).expect("payload is utf8"),
        expected
    );
}

#[test]
fn canonical_payload_renders_validity_window() {
    let mut signed = record();
    signed.not_before = Some(1_700_000_000);
    signed.not_after = Some(1_800_000_000);
    let payload = gate_canonical_payload(&signed);
    let text = String::from_utf8(payload).expect("payload is utf8");
    assert!(text.ends_with("not-before:1700000000\nnot-after:1800000000\n"));
}

#[test]
fn precheck_passes_and_hands_the_host_the_canonical_check() {
    let check = precheck_gate(&book(), &declaration()).expect("precheck passes");
    assert_eq!(check.gate, "release");
    assert_eq!(check.signer, "release-key");
    assert_eq!(check.signature, "c2ln");
    assert_eq!(check.payload, gate_canonical_payload(&record()));
}

#[test]
fn precheck_refuses_unsigned_gate() {
    let mut unsigned = book();
    unsigned.signatures.clear();
    let refusal = precheck_gate(&unsigned, &declaration()).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::UNSIGNED);
}

#[test]
fn precheck_refuses_signer_outside_the_declared_list() {
    let mut declared = declaration();
    declared.signers = vec!["other-key".to_string()];
    let refusal = precheck_gate(&book(), &declared).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::SIGNER_NOT_ALLOWED);

    let mut declared = declaration();
    declared.signers = vec!["release-key".to_string()];
    assert!(precheck_gate(&book(), &declared).is_ok());
}

#[test]
fn precheck_refuses_workflow_that_changed_after_signing() {
    let mut changed = book();
    changed.workflow_sha256 = OTHER_WORKFLOW_SHA.to_string();
    let refusal = precheck_gate(&changed, &declaration()).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::WORKFLOW_MISMATCH);
}

#[test]
fn precheck_refuses_when_evidence_cannot_be_read() {
    let mut missing = book();
    missing.evidence_sha256.clear();
    let refusal = precheck_gate(&missing, &declaration()).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::EVIDENCE_UNAVAILABLE);
}

#[test]
fn precheck_refuses_evidence_that_changed_after_signing() {
    let mut changed = book();
    changed
        .evidence_sha256
        .insert("release".to_string(), OTHER_EVIDENCE_SHA.to_string());
    let refusal = precheck_gate(&changed, &declaration()).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::EVIDENCE_MISMATCH);
}

#[test]
fn precheck_refuses_windowed_signature_without_a_clock() {
    let mut windowed = book();
    windowed.signatures[0].not_after = Some(1_800_000_000);
    let refusal = precheck_gate(&windowed, &declaration()).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::CLOCK_UNAVAILABLE);
}

#[test]
fn precheck_refuses_before_and_after_the_validity_window() {
    let mut windowed = book();
    windowed.signatures[0].not_before = Some(2_000);
    windowed.signatures[0].not_after = Some(3_000);

    windowed.now_unix_seconds = Some(1_999);
    let refusal = precheck_gate(&windowed, &declaration()).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::NOT_YET_VALID);

    windowed.now_unix_seconds = Some(3_001);
    let refusal = precheck_gate(&windowed, &declaration()).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::EXPIRED);

    // The window bounds are inclusive.
    windowed.now_unix_seconds = Some(2_000);
    assert!(precheck_gate(&windowed, &declaration()).is_ok());
    windowed.now_unix_seconds = Some(3_000);
    assert!(precheck_gate(&windowed, &declaration()).is_ok());
}

#[test]
fn precheck_reports_the_earliest_failure_in_refusal_order() {
    // Both unsigned-evidence and workflow drift are present; the
    // workflow binding is checked before evidence.
    let mut drifted = book();
    drifted.workflow_sha256 = OTHER_WORKFLOW_SHA.to_string();
    drifted.evidence_sha256.clear();
    let refusal = precheck_gate(&drifted, &declaration()).expect_err("must refuse");
    assert_eq!(refusal.code, gate_codes::WORKFLOW_MISMATCH);
}

#[test]
fn default_host_verification_fails_closed() {
    let check = precheck_gate(&book(), &declaration()).expect("precheck passes");
    let refusal = DenyAllHost
        .verify_gate(&check)
        .expect_err("the deny-all host must refuse every gate");
    assert_eq!(refusal.code, gate_codes::VERIFICATION_UNAVAILABLE);
}

#[test]
fn gate_refusal_errors_carry_their_code() {
    let error = RuntimeError::gate_refusal(gate_codes::EXPIRED, "gate 'release' signature expired");
    assert_eq!(error.kind(), RuntimeErrorKind::CapabilityDenied);
    assert_eq!(error.gate_code(), Some(gate_codes::EXPIRED));
    assert_eq!(error.message(), "gate 'release' signature expired");

    let plain = RuntimeError::new("ordinary failure");
    assert_eq!(plain.gate_code(), None);
}
