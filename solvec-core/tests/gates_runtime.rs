//! Phase 4 (signed gates), stack B: evaluator execution semantics.
//!
//! These tests prove the runtime seam end to end at the core level:
//! a gate that verifies lets execution continue; every failure mode
//! refuses with its distinct code and halts the run, so statements
//! after the gate never execute. The test host verifies against the
//! canonical payload exactly the way a cryptographic host does; the
//! real Ed25519 verification is proven end to end by the CLI tests in
//! the solvec crate (stack C), because solvec-core's dependency
//! boundary keeps cryptography in the host.

use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use solvec_core::ast::Stmt;
use solvec_core::evaluator::{
    Capability, DenyAllHost, Evaluator, ExportKind, GateBook, GateCheck, GateRefusal,
    GateSignatureRecord, HostError, HostRequest, ModuleNode, ModuleProgram, RuntimeHost,
    collect_gate_declarations, gate_canonical_payload, gate_codes,
};
use solvec_core::{lexer, parser::Parser, semantic, value::Value};

const GATED: &str = r#"
print("before")
gate release {
    evidence "evidence/report.json"
    signer release_key
}
print("after")
"#;

fn parse(source: &str) -> Vec<Stmt> {
    Parser::new(lexer::lex(source))
        .parse()
        .expect("source parses")
}

fn record(gate: &str, signer: &str) -> GateSignatureRecord {
    GateSignatureRecord {
        gate: gate.to_string(),
        workflow_sha256: "wf".to_string(),
        evidence_sha256: "ev".to_string(),
        signer: signer.to_string(),
        not_before: None,
        not_after: None,
        signature: "test-signature".to_string(),
    }
}

fn book(signatures: Vec<GateSignatureRecord>) -> GateBook {
    GateBook {
        workflow_sha256: "wf".to_string(),
        signatures,
        // The host records the digest of each gate's evidence keyed by
        // gate name (the declaration's path is what it read to get it).
        evidence_sha256: BTreeMap::from([("release".to_string(), "ev".to_string())]),
        now_unix_seconds: None,
    }
}

fn expected_payload(gate: &str, signer: &str) -> Vec<u8> {
    gate_canonical_payload(&record(gate, signer))
}

/// A host that verifies a gate exactly the way the native host does:
/// the check's canonical payload must match what the signer signed,
/// and the presented signature must be the expected one.
struct GateHost {
    outputs: Rc<RefCell<Vec<Value>>>,
    expected_payload: Vec<u8>,
}

impl RuntimeHost for GateHost {
    fn authorize(&self, capability: &Capability) -> Result<(), HostError> {
        DenyAllHost.authorize(capability)
    }

    fn invoke(
        &mut self,
        request: HostRequest,
        max_response_bytes: usize,
    ) -> Result<Value, HostError> {
        DenyAllHost.invoke(request, max_response_bytes)
    }

    fn verify_gate(&self, check: &GateCheck) -> Result<(), GateRefusal> {
        if check.payload == self.expected_payload && check.signature == "test-signature" {
            Ok(())
        } else {
            Err(GateRefusal::new(
                gate_codes::SIGNATURE_INVALID,
                "test host: payload or signature does not match the signed gate",
            ))
        }
    }

    fn emit_output(&mut self, value: &Value) -> Result<(), HostError> {
        self.outputs.borrow_mut().push(value.clone());
        Ok(())
    }
}

/// A capturing host that does NOT implement gate verification, so the
/// trait's deny-by-default applies.
struct PlainHost {
    outputs: Rc<RefCell<Vec<Value>>>,
}

impl RuntimeHost for PlainHost {
    fn authorize(&self, capability: &Capability) -> Result<(), HostError> {
        DenyAllHost.authorize(capability)
    }

    fn invoke(
        &mut self,
        request: HostRequest,
        max_response_bytes: usize,
    ) -> Result<Value, HostError> {
        DenyAllHost.invoke(request, max_response_bytes)
    }

    fn emit_output(&mut self, value: &Value) -> Result<(), HostError> {
        self.outputs.borrow_mut().push(value.clone());
        Ok(())
    }
}

fn gate_host() -> (GateHost, Rc<RefCell<Vec<Value>>>) {
    let outputs = Rc::new(RefCell::new(Vec::new()));
    (
        GateHost {
            outputs: Rc::clone(&outputs),
            expected_payload: expected_payload("release", "release_key"),
        },
        outputs,
    )
}

fn text(value: &str) -> Value {
    Value::Text(value.to_string())
}

#[test]
fn valid_gate_passes_and_execution_continues() {
    let (host, outputs) = gate_host();
    let mut evaluator = Evaluator::with_input(host, GATED, "entry.solve", None)
        .with_gates(book(vec![record("release", "release_key")]));
    evaluator
        .run(&parse(GATED))
        .expect("a validly signed gate passes");
    assert_eq!(*outputs.borrow(), vec![text("before"), text("after")]);
}

#[test]
fn missing_signature_refuses_and_halts_the_run() {
    let (host, outputs) = gate_host();
    let mut evaluator =
        Evaluator::with_input(host, GATED, "entry.solve", None).with_gates(book(Vec::new()));
    let error = evaluator
        .run(&parse(GATED))
        .expect_err("an unsigned gate refuses");
    assert_eq!(error.gate_code(), Some(gate_codes::UNSIGNED));
    assert_eq!(*outputs.borrow(), vec![text("before")]);
}

#[test]
fn gate_without_a_gate_book_refuses_unconfigured() {
    let (host, outputs) = gate_host();
    let mut evaluator = Evaluator::with_input(host, GATED, "entry.solve", None);
    let error = evaluator
        .run(&parse(GATED))
        .expect_err("a gate with no gate book refuses");
    assert_eq!(error.gate_code(), Some(gate_codes::UNCONFIGURED));
    assert_eq!(*outputs.borrow(), vec![text("before")]);
}

#[test]
fn host_without_verification_refuses_every_gate() {
    let outputs = Rc::new(RefCell::new(Vec::new()));
    let host = PlainHost {
        outputs: Rc::clone(&outputs),
    };
    let mut evaluator = Evaluator::with_input(host, GATED, "entry.solve", None)
        .with_gates(book(vec![record("release", "release_key")]));
    let error = evaluator
        .run(&parse(GATED))
        .expect_err("a host that cannot verify refuses the gate");
    assert_eq!(
        error.gate_code(),
        Some(gate_codes::VERIFICATION_UNAVAILABLE)
    );
    assert_eq!(*outputs.borrow(), vec![text("before")]);
}

#[test]
fn host_rejection_refuses_with_the_signature_code() {
    let outputs = Rc::new(RefCell::new(Vec::new()));
    let host = GateHost {
        outputs: Rc::clone(&outputs),
        // The signer signed a different gate's payload: replay fails.
        expected_payload: expected_payload("other_gate", "release_key"),
    };
    let mut evaluator = Evaluator::with_input(host, GATED, "entry.solve", None)
        .with_gates(book(vec![record("release", "release_key")]));
    let error = evaluator
        .run(&parse(GATED))
        .expect_err("a signature over another gate's payload refuses");
    assert_eq!(error.gate_code(), Some(gate_codes::SIGNATURE_INVALID));
    assert_eq!(*outputs.borrow(), vec![text("before")]);
}

#[test]
fn signer_outside_the_declared_list_refuses() {
    let (host, outputs) = gate_host();
    let mut evaluator = Evaluator::with_input(host, GATED, "entry.solve", None)
        .with_gates(book(vec![record("release", "other_key")]));
    let error = evaluator
        .run(&parse(GATED))
        .expect_err("a signer the gate did not declare refuses");
    assert_eq!(error.gate_code(), Some(gate_codes::SIGNER_NOT_ALLOWED));
    assert_eq!(*outputs.borrow(), vec![text("before")]);
}

#[test]
fn expired_signature_refuses_at_the_gate() {
    let (host, outputs) = gate_host();
    let mut expired = record("release", "release_key");
    expired.not_after = Some(100);
    let mut gate_book = book(vec![expired]);
    gate_book.now_unix_seconds = Some(200);
    let mut evaluator =
        Evaluator::with_input(host, GATED, "entry.solve", None).with_gates(gate_book);
    let error = evaluator
        .run(&parse(GATED))
        .expect_err("an expired signature refuses");
    assert_eq!(error.gate_code(), Some(gate_codes::EXPIRED));
    assert_eq!(*outputs.borrow(), vec![text("before")]);
}

#[test]
fn unreadable_evidence_refuses_at_the_gate() {
    let (host, outputs) = gate_host();
    let mut gate_book = book(vec![record("release", "release_key")]);
    gate_book.evidence_sha256.clear();
    let mut evaluator =
        Evaluator::with_input(host, GATED, "entry.solve", None).with_gates(gate_book);
    let error = evaluator
        .run(&parse(GATED))
        .expect_err("evidence the host could not read refuses");
    assert_eq!(error.gate_code(), Some(gate_codes::EVIDENCE_UNAVAILABLE));
    assert_eq!(*outputs.borrow(), vec![text("before")]);
}

#[test]
fn gate_inside_a_function_refuses_when_called_without_a_signature() {
    // Bypass attempt, core level: hiding the gate inside a function
    // does not skip it — execution still reaches the seam.
    let source = r#"
fn guarded() {
    gate release {
        evidence "evidence/report.json"
    }
    print("inside")
}
print("start")
guarded()
print("end")
"#;
    let (host, outputs) = gate_host();
    let mut evaluator =
        Evaluator::with_input(host, source, "entry.solve", None).with_gates(book(Vec::new()));
    let error = evaluator
        .run(&parse(source))
        .expect_err("a gate inside a called function still refuses");
    assert_eq!(error.gate_code(), Some(gate_codes::UNSIGNED));
    assert_eq!(*outputs.borrow(), vec![text("start")]);
}

#[test]
fn gate_inside_a_function_passes_when_signed_and_called() {
    let source = r#"
fn guarded() {
    gate release {
        evidence "evidence/report.json"
        signer release_key
    }
    print("inside")
}
guarded()
print("end")
"#;
    let (host, outputs) = gate_host();
    let mut evaluator = Evaluator::with_input(host, source, "entry.solve", None)
        .with_gates(book(vec![record("release", "release_key")]));
    evaluator
        .run(&parse(source))
        .expect("a signed gate inside a called function passes");
    assert_eq!(*outputs.borrow(), vec![text("inside"), text("end")]);
}

#[test]
fn unreached_gate_does_not_block_the_run() {
    // A gate that execution never reaches is inert: declaration alone
    // is not a refusal. (Reaching it unconfigured would refuse.)
    let source = r#"
fn guarded() {
    gate release {
        evidence "evidence/report.json"
    }
    print("inside")
}
print("only")
"#;
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run(&parse(source))
        .expect("an unreached gate does not block the run");
    assert_eq!(evaluator.outputs(), &[text("only")]);
}

#[test]
fn gate_reached_inside_a_module_refuses_module_context() {
    let library = r#"
export fn guarded() {
    gate release {
        evidence "evidence/report.json"
    }
    print("inside")
}
"#;
    let entry = r#"
import { guarded } from "library.solve"
guarded()
"#;
    let modules = ModuleProgram {
        entry: "entry.solve".to_string(),
        modules: BTreeMap::from([
            (
                "library.solve".to_string(),
                ModuleNode {
                    identity: "library.solve".to_string(),
                    source: library.to_string(),
                    statements: parse(library),
                    dependencies: Vec::new(),
                    exports: BTreeMap::from([("guarded".to_string(), ExportKind::Function)]),
                },
            ),
            (
                "entry.solve".to_string(),
                ModuleNode {
                    identity: "entry.solve".to_string(),
                    source: entry.to_string(),
                    statements: parse(entry),
                    dependencies: vec!["library.solve".to_string()],
                    exports: BTreeMap::new(),
                },
            ),
        ]),
        order: vec!["library.solve".to_string(), "entry.solve".to_string()],
    };
    let mut evaluator =
        Evaluator::new(DenyAllHost).with_gates(book(vec![record("release", "release_key")]));
    let error = evaluator
        .run_modules(&modules)
        .expect_err("a gate executed inside a module refuses in v1");
    assert_eq!(error.gate_code(), Some(gate_codes::MODULE_CONTEXT));
}

#[test]
fn collect_gate_declarations_finds_top_level_and_nested_gates() {
    let source = r#"
gate first {
    evidence "a.json"
}
fn holder() {
    gate second {
        evidence "b.json"
        signer release_key
    }
}
if true {
    gate third {
        evidence "c.json"
    }
}
"#;
    let declarations = collect_gate_declarations(&parse(source));
    let names: Vec<&str> = declarations.iter().map(|gate| gate.name.as_str()).collect();
    assert_eq!(names, vec!["first", "second", "third"]);
    assert_eq!(declarations[1].signers, vec!["release_key".to_string()]);
    assert_eq!(declarations[0].evidence, "a.json");
}

#[test]
fn duplicate_gate_names_are_a_semantic_error() {
    let source = r#"
gate release {
    evidence "a.json"
}
gate release {
    evidence "b.json"
}
"#;
    let diagnostics =
        semantic::check(&parse(source)).expect_err("duplicate gate names are rejected");
    assert!(
        diagnostics.iter().any(|diagnostic| diagnostic
            .message
            .contains("duplicate gate declaration 'release'")),
        "expected a duplicate gate diagnostic, got {diagnostics:?}"
    );
}

#[test]
fn gate_without_evidence_is_a_parse_error() {
    let source = r#"
gate release {
    signer release_key
}
"#;
    assert!(
        Parser::new(lexer::lex(source)).parse().is_err(),
        "a gate with no evidence entry must not parse"
    );
}

#[test]
fn workflow_without_gates_runs_exactly_as_before() {
    let source = "let total = 1 + 2\nprint(total)\n";
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run(&parse(source))
        .expect("ungated workflows are unaffected");
    assert_eq!(evaluator.outputs(), &[Value::Number(3)]);
}
