use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

use solvec_core::ast::{ExportedDeclaration, Expr, ExprKind, SourceLocation, Stmt};
use solvec_core::evaluator::{
    Capability, DenyAllHost, EvaluationLimits, Evaluator, ExportKind, HostError, HostRequest,
    ModuleNode, ModuleProgram, RuntimeErrorKind, RuntimeHost,
};
use solvec_core::{lexer, parser::Parser, value::Value};

fn parse(source: &str) -> Vec<solvec_core::ast::Stmt> {
    Parser::new(lexer::lex(source))
        .parse()
        .expect("source parses")
}

fn module(
    identity: &str,
    source: &str,
    dependencies: &[&str],
    exports: &[(&str, ExportKind)],
) -> ModuleNode {
    ModuleNode {
        identity: identity.to_string(),
        source: source.to_string(),
        statements: parse(source),
        dependencies: dependencies
            .iter()
            .map(|dependency| (*dependency).to_string())
            .collect(),
        exports: exports
            .iter()
            .map(|(name, kind)| ((*name).to_string(), *kind))
            .collect(),
    }
}

fn program(entry: &str, order: &[&str], nodes: Vec<ModuleNode>) -> ModuleProgram {
    ModuleProgram {
        entry: entry.to_string(),
        modules: nodes
            .into_iter()
            .map(|node| (node.identity.clone(), node))
            .collect(),
        order: order
            .iter()
            .map(|identity| (*identity).to_string())
            .collect(),
    }
}

fn test_expr(kind: ExprKind) -> Expr {
    Expr::new(kind, SourceLocation::new(1, 1))
}

fn test_print(value: i32) -> Stmt {
    Stmt::Print {
        value: test_expr(ExprKind::Number(value)),
        location: SourceLocation::new(1, 1),
    }
}

fn unreachable_block(statements: Vec<Stmt>) -> Stmt {
    Stmt::If {
        condition: test_expr(ExprKind::Bool(false)),
        then_branch: statements,
        else_branch: Vec::new(),
        location: SourceLocation::new(1, 1),
    }
}

fn deeply_nested_unreachable_statement(depth: usize) -> Stmt {
    (0..depth).fold(test_print(99), |statement, _| {
        unreachable_block(vec![statement])
    })
}

fn deeply_nested_expression(depth: usize) -> Expr {
    (0..depth).fold(test_expr(ExprKind::Number(99)), |expression, _| {
        test_expr(ExprKind::Array(vec![expression]))
    })
}

struct CapturingDenyHost {
    outputs: Rc<RefCell<Vec<Value>>>,
}

impl RuntimeHost for CapturingDenyHost {
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

#[test]
fn pure_values_control_flow_helpers_and_owned_output_are_deterministic() {
    let source = r#"
let data = { name: "Ada", numbers: [1, 2, 3] }
fn summarize(item) {
    let total = 0
    for number in item.numbers {
        if number == 2 { continue }
        total = total + number
    }
    return [item.name, total, length(item.numbers), contains(item.numbers, 2), get(item, "missing", "fallback")]
}

print(summarize(data))
print(json_stringify(json_parse("{\"ok\":true}")))
"#;
    let callback_values = Rc::new(RefCell::new(Vec::new()));
    let mut evaluator = Evaluator::with_input(
        CapturingDenyHost {
            outputs: Rc::clone(&callback_values),
        },
        source,
        "entry.solve",
        Some(Value::Object(BTreeMap::from([(
            "untouched".to_string(),
            Value::Bool(true),
        )]))),
    );
    evaluator
        .run(&parse(source))
        .expect("pure execution succeeds");

    let expected = vec![
        Value::Array(vec![
            Value::Text("Ada".to_string()),
            Value::Number(4),
            Value::Number(3),
            Value::Bool(true),
            Value::Text("fallback".to_string()),
        ]),
        Value::Text("{\"ok\":true}".to_string()),
    ];
    assert_eq!(evaluator.outputs(), expected.as_slice());
    assert_eq!(*callback_values.borrow(), expected);
}

#[test]
fn pure_collection_and_text_helpers_preserve_the_native_success_corpus() {
    let source = r#"
let owners = ["Ari", "Bea"]
let ticket = { status: "open", count: 2 }
print(length(owners))
print(length("hé"))
print(length(ticket))
print(is_empty(""))
print(is_empty(owners))
print(is_empty({}))
print(contains(owners, "Bea"))
print(contains("SolveLang", "Lang"))
print(contains(ticket, "status"))
print(get(owners, 1))
print(get(ticket, "missing", "fallback"))
print(get(owners, 8, "fallback"))
print(keys(ticket))
print(values(ticket))
print(entries(ticket))
"#;
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run(&parse(source))
        .expect("pure helper corpus succeeds");

    assert_eq!(
        evaluator.outputs(),
        &[
            Value::Number(2),
            Value::Number(2),
            Value::Number(2),
            Value::Bool(true),
            Value::Bool(false),
            Value::Bool(true),
            Value::Bool(true),
            Value::Bool(true),
            Value::Bool(true),
            Value::Text("Bea".to_string()),
            Value::Text("fallback".to_string()),
            Value::Text("fallback".to_string()),
            Value::Array(vec![
                Value::Text("count".to_string()),
                Value::Text("status".to_string()),
            ]),
            Value::Array(vec![Value::Number(2), Value::Text("open".to_string())]),
            Value::Array(vec![
                Value::Array(vec![Value::Text("count".to_string()), Value::Number(2)]),
                Value::Array(vec![
                    Value::Text("status".to_string()),
                    Value::Text("open".to_string()),
                ]),
            ]),
        ]
    );
}

#[test]
fn arithmetic_comparisons_and_nested_loop_control_match_runtime_semantics() {
    let source = r#"
let total = 0
let outer = 0
while outer < 3 {
    outer = outer + 1
    for number in [1, 2, 3, 4] {
        if number == 2 { continue }
        if number > 3 { break }
        total = total + number * outer
    }
}
fn classify(value) {
    if value >= 20 and value <= 30 { return "in-range" }
    return "other"
}
print(total)
print(10 - 2 * 3)
print(12 / 3)
print(classify(total))
print(not false)
print("solve" .. "lang")
"#;
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run(&parse(source))
        .expect("deterministic control flow succeeds");

    assert_eq!(
        evaluator.outputs(),
        &[
            Value::Number(24),
            Value::Number(4),
            Value::Number(4),
            Value::Text("in-range".to_string()),
            Value::Bool(true),
            Value::Text("solvelang".to_string()),
        ]
    );
}

#[test]
fn pure_helpers_report_typed_failures_without_partial_output() {
    for (source, expected) in [
        (
            "print(length(1))\n",
            "length expects a text, array, or object",
        ),
        (
            "print(contains(\"abc\", 1))\n",
            "contains expects a text search value",
        ),
        (
            "print(get([1], \"zero\"))\n",
            "get expects a number index for an array",
        ),
        ("print(keys([]))\n", "keys expects an object value"),
        ("print(values(true))\n", "values expects an object value"),
        ("print(entries(\"x\"))\n", "entries expects an object value"),
        ("print(json_parse(1))\n", "json_parse expects a text value"),
        (
            "print(1 + \"x\")\n",
            "operator '+' requires number operands",
        ),
    ] {
        let mut evaluator = Evaluator::new(DenyAllHost);
        let error = evaluator
            .run(&parse(source))
            .expect_err("invalid pure operation fails");
        assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
        assert!(
            error.message().contains(expected),
            "expected {expected:?}, got {:?}",
            error.message()
        );
        assert!(evaluator.outputs().is_empty());
    }
}

#[test]
fn injected_input_is_read_only_and_errors_retain_source_provenance() {
    let source = "print(\"must not print\")\ninput = 2\n";
    let mut evaluator = Evaluator::with_input(
        DenyAllHost,
        source,
        "workflow.solve",
        Some(Value::Number(1)),
    );

    let error = evaluator
        .run(&parse(source))
        .expect_err("input is immutable");

    assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
    assert_eq!(error.source_name(), Some("workflow.solve"));
    assert_eq!(error.location().map(|location| location.line), Some(2));
    assert!(
        error
            .message()
            .contains("injected input value is read-only")
    );
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn injected_input_is_available_to_the_first_plain_run() {
    let source = "print(input)\n";
    let mut evaluator =
        Evaluator::with_input(DenyAllHost, source, "input.solve", Some(Value::Number(7)));

    evaluator
        .run(&parse(source))
        .expect("injected input is seeded before a plain run");

    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
}

#[test]
fn configured_loop_and_global_step_limits_fail_deterministically() {
    let mut loop_limited = Evaluator::new(DenyAllHost).with_limits(EvaluationLimits {
        max_loop_iterations: 2,
        max_steps: 1_000,
        max_call_depth: 32,
        max_value_bytes: 16_777_216,
    });
    let loop_error = loop_limited
        .run(&parse("let n = 0\nwhile true { n = n + 1 }\n"))
        .expect_err("loop limit is enforced");
    assert_eq!(loop_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(
        loop_error
            .message()
            .contains("loop stopped after 2 iterations")
    );

    let mut step_limited = Evaluator::new(DenyAllHost).with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 16,
        max_call_depth: 32,
        max_value_bytes: 16_777_216,
    });
    let step_error = step_limited
        .run(&parse("let n = 0\nwhile n < 100 { n = n + 1 }\n"))
        .expect_err("global step limit is enforced");
    assert_eq!(step_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(
        step_error
            .message()
            .contains("evaluation stopped after 16 steps")
    );
    assert!(step_limited.outputs().is_empty());
}

#[test]
fn recursive_calls_stop_at_the_configured_depth() {
    let source = "fn recurse() { return recurse() }\nprint(recurse())\n";
    let mut evaluator = Evaluator::new(DenyAllHost).with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 10_000,
        max_call_depth: 8,
        max_value_bytes: 16_777_216,
    });

    let error = evaluator
        .run(&parse(source))
        .expect_err("call depth is bounded");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(error.message().contains("call depth exceeded 8"));
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn plain_preflight_bounds_oversized_and_deep_unreachable_ast_before_prior_output_changes() {
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial plain run succeeds");

    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 16,
        max_call_depth: 64,
        max_value_bytes: 16_777_216,
    });
    let oversized = vec![unreachable_block((0..64).map(test_print).collect())];
    let work_error = evaluator
        .run(&oversized)
        .expect_err("unreachable syntax still consumes bounded preflight work");
    assert_eq!(work_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);

    evaluator.set_source_context("if false { ... }\n", "deep.solve");
    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 4,
        max_value_bytes: 16_777_216,
    });
    let depth_error = evaluator
        .run(&[deeply_nested_unreachable_statement(12)])
        .expect_err("deep unreachable syntax is rejected before recursive descent");
    assert_eq!(depth_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(depth_error.source_name(), Some("deep.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);

    evaluator.set_source_context("print([[[...]]])\n", "deep-expression.solve");
    let expression_error = evaluator
        .run(&[Stmt::Print {
            value: deeply_nested_expression(12),
            location: SourceLocation::new(1, 1),
        }])
        .expect_err("deep expressions are rejected before recursive descent");
    assert_eq!(expression_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(
        expression_error.source_name(),
        Some("deep-expression.solve")
    );
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
}

#[test]
fn preflight_charges_function_scope_snapshots_before_cloning_them() {
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial plain run succeeds");
    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 32,
        max_call_depth: 64,
        max_value_bytes: 16_777_216,
    });
    let functions = (0..20)
        .map(|index| Stmt::Function {
            name: format!("function_{index}"),
            params: Vec::new(),
            body: Vec::new(),
            location: SourceLocation::new(index + 1, 1),
        })
        .collect::<Vec<_>>();

    let error = evaluator
        .run(&functions)
        .expect_err("scope-clone work is bounded before allocation");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);

    let first = (0..20)
        .map(|index| format!("fn retained_{index}() {{}}"))
        .collect::<Vec<_>>()
        .join("\n");
    let mut reused = Evaluator::with_input(DenyAllHost, &first, "first.solve", None);
    reused
        .run(&parse(&first))
        .expect("initial functions fit the default budget");
    reused.set_source_context("print(8)\n", "second.solve");
    reused.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 4,
        max_call_depth: 64,
        max_value_bytes: 16_777_216,
    });
    let reuse_error = reused
        .run(&parse("print(8)\n"))
        .expect_err("retained function snapshots are charged before cloning");
    assert_eq!(reuse_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(reused.outputs().is_empty());
}

#[test]
fn value_and_literal_limits_fail_before_new_output_or_delivery() {
    let delivered = Rc::new(RefCell::new(Vec::new()));
    let mut evaluator = Evaluator::new(CapturingDenyHost {
        outputs: Rc::clone(&delivered),
    });
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial plain run succeeds");
    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 16,
        max_value_bytes: 8,
    });
    evaluator.set_source_context("print(\"oversized\")\n", "literal.solve");

    let literal_error = evaluator
        .run(&parse("print(\"oversized\")\n"))
        .expect_err("oversized literals fail in preflight");
    assert_eq!(literal_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(literal_error.source_name(), Some("literal.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
    assert_eq!(*delivered.borrow(), vec![Value::Number(7)]);

    evaluator.set_input(Some(Value::Text("far too large".to_string())));
    evaluator.set_source_context("print(8)\n", "input.solve");
    let input_error = evaluator
        .run(&parse("print(8)\n"))
        .expect_err("oversized input fails before evaluation");
    assert_eq!(input_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(input_error.source_name(), Some("input.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
    assert_eq!(*delivered.borrow(), vec![Value::Number(7)]);

    evaluator.set_input(None);
    evaluator.set_source_context("print({ oversized_key: 1 })\n", "object.solve");
    let object_error = evaluator
        .run(&parse("print({ oversized_key: 1 })\n"))
        .expect_err("object key bytes fail before object allocation");
    assert_eq!(object_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(object_error.source_name(), Some("object.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
    assert_eq!(*delivered.borrow(), vec![Value::Number(7)]);
}

#[test]
fn helper_results_deep_inputs_and_cumulative_output_are_bounded() {
    let compact_input = Value::Object(BTreeMap::from([
        ("a".to_string(), Value::Number(1)),
        ("b".to_string(), Value::Number(2)),
        ("c".to_string(), Value::Number(3)),
        ("d".to_string(), Value::Number(4)),
    ]));
    let source = "print(entries(input))\n";
    let mut helper_limited =
        Evaluator::with_input(DenyAllHost, source, "helper.solve", Some(compact_input))
            .with_limits(EvaluationLimits {
                max_loop_iterations: 100,
                max_steps: 1_000,
                max_call_depth: 16,
                max_value_bytes: 12,
            });
    let helper_error = helper_limited
        .run(&parse(source))
        .expect_err("helper amplification is bounded");
    assert_eq!(helper_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(helper_limited.outputs().is_empty());

    let deep_input = (0..6).fold(Value::Number(1), |value, _| Value::Array(vec![value]));
    let mut depth_limited = Evaluator::with_input(
        DenyAllHost,
        "print(1)\n",
        "deep-input.solve",
        Some(deep_input),
    )
    .with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 4,
        max_value_bytes: 1_000,
    });
    let depth_error = depth_limited
        .run(&parse("print(1)\n"))
        .expect_err("deep input is rejected before output");
    assert_eq!(depth_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(depth_limited.outputs().is_empty());

    let delivered = Rc::new(RefCell::new(Vec::new()));
    let mut output_limited = Evaluator::new(CapturingDenyHost {
        outputs: Rc::clone(&delivered),
    })
    .with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 16,
        max_value_bytes: 3,
    });
    let output_error = output_limited
        .run(&parse("print(1)\nprint(2)\nprint(3)\nprint(4)\n"))
        .expect_err("aggregate output is bounded");
    assert_eq!(output_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(
        output_limited.outputs(),
        &[Value::Number(1), Value::Number(2), Value::Number(3)]
    );
    assert_eq!(
        *delivered.borrow(),
        vec![Value::Number(1), Value::Number(2), Value::Number(3)]
    );
}

#[test]
fn retained_values_remain_bounded_across_incremental_runs() {
    let first = "let a = input\n";
    let mut evaluator = Evaluator::with_input(
        DenyAllHost,
        first,
        "first.solve",
        Some(Value::Text("1234".to_string())),
    )
    .with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 16,
        max_value_bytes: 20,
    });
    evaluator
        .run(&parse(first))
        .expect("first retained alias fits the aggregate state budget");
    evaluator.set_source_context("let b = input\n", "second.solve");
    evaluator
        .run(&parse("let b = input\n"))
        .expect("second retained alias still fits");
    evaluator.set_source_context("let c = input\nprint(9)\n", "third.solve");

    let error = evaluator
        .run(&parse("let c = input\nprint(9)\n"))
        .expect_err("retained state cannot grow past the byte budget");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(error.source_name(), Some("third.solve"));
    assert!(evaluator.outputs().is_empty());

    let source = "let kept = \"12345678\"\n";
    let mut aggregate = Evaluator::with_input(DenyAllHost, source, "state.solve", None)
        .with_limits(EvaluationLimits {
            max_loop_iterations: 100,
            max_steps: 1_000,
            max_call_depth: 16,
            max_value_bytes: 20,
        });
    aggregate
        .run(&parse(source))
        .expect("initial retained state fits");
    aggregate.set_input(Some(Value::Text("123456789".to_string())));
    aggregate.set_source_context("", "empty.solve");
    let combined_error = aggregate
        .run(&[])
        .expect_err("new input is checked with retained state before an empty run");
    assert_eq!(combined_error.kind(), RuntimeErrorKind::LimitExceeded);

    aggregate.set_input(None);
    aggregate.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 16,
        max_value_bytes: 10,
    });
    let lowered_error = aggregate
        .run(&[])
        .expect_err("lowered limits validate already-retained state");
    assert_eq!(lowered_error.kind(), RuntimeErrorKind::LimitExceeded);
}

#[test]
fn module_preflight_bounds_graph_work_and_deep_ast_before_epoch_reset() {
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial plain run succeeds");

    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 8,
        max_call_depth: 64,
        max_value_bytes: 16_777_216,
    });
    let identities = (0..24)
        .map(|index| format!("module-{index}.solve"))
        .collect::<Vec<_>>();
    let oversized = ModuleProgram {
        entry: identities.last().expect("non-empty graph").clone(),
        modules: identities
            .iter()
            .map(|identity| {
                (
                    identity.clone(),
                    ModuleNode {
                        identity: identity.clone(),
                        source: String::new(),
                        statements: Vec::new(),
                        dependencies: Vec::new(),
                        exports: BTreeMap::new(),
                    },
                )
            })
            .collect(),
        order: identities,
    };
    let work_error = evaluator
        .run_modules(&oversized)
        .expect_err("module graph traversal consumes bounded preflight work");
    assert_eq!(work_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);

    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 4,
        max_value_bytes: 16_777_216,
    });
    let state_identity = "deep-state.solve".to_string();
    let entry_identity = "deep-module.solve".to_string();
    let deep_value = deeply_nested_expression(12);
    let deep = ModuleProgram {
        entry: entry_identity.clone(),
        modules: BTreeMap::from([
            (
                state_identity.clone(),
                ModuleNode {
                    identity: state_identity.clone(),
                    source: "export let value = [[[...]]]\n".to_string(),
                    statements: vec![Stmt::Export {
                        declaration: ExportedDeclaration::Let {
                            name: "value".to_string(),
                            value: deep_value,
                            location: SourceLocation::new(1, 1),
                        },
                        location: SourceLocation::new(1, 1),
                    }],
                    dependencies: Vec::new(),
                    exports: BTreeMap::from([("value".to_string(), ExportKind::Let)]),
                },
            ),
            (
                entry_identity.clone(),
                module(
                    &entry_identity,
                    "import { value } from \"deep-state.solve\"\n",
                    &[&state_identity],
                    &[],
                ),
            ),
        ]),
        order: vec![state_identity, entry_identity],
    };
    let depth_error = evaluator
        .run_modules(&deep)
        .expect_err("deep module syntax is rejected before recursive descent");
    assert_eq!(depth_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(depth_error.source_name(), Some("deep-state.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
}

#[test]
fn oversized_module_initializer_fails_before_epoch_reset_or_delivery() {
    let delivered = Rc::new(RefCell::new(Vec::new()));
    let mut evaluator = Evaluator::new(CapturingDenyHost {
        outputs: Rc::clone(&delivered),
    });
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial plain run succeeds");
    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 16,
        max_value_bytes: 3,
    });
    let state_source = "export let value = [1, 2, 3, 4]\n";
    let entry_source = "import { value } from \"state.solve\"\n";
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let)],
            ),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );

    let error = evaluator
        .run_modules(&modules)
        .expect_err("composite initializer is rejected before reset");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(error.source_name(), Some("state.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
    assert_eq!(*delivered.borrow(), vec![Value::Number(7)]);
}

#[test]
fn module_input_and_dependency_state_are_bounded_before_epoch_reset() {
    let delivered = Rc::new(RefCell::new(Vec::new()));
    let mut evaluator = Evaluator::new(CapturingDenyHost {
        outputs: Rc::clone(&delivered),
    });
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial plain run succeeds");
    evaluator.set_input(Some(Value::Text("1234".to_string())));
    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 16,
        max_value_bytes: 11,
    });
    let state_source = "export let x = \"1234\"\n";
    let entry_source = "import { x } from \"state.solve\"\n";
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module("state.solve", state_source, &[], &[("x", ExportKind::Let)]),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );

    let error = evaluator
        .run_modules(&modules)
        .expect_err("input and staged module state share one retained budget");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(error.source_name(), Some("entry.solve"));
    assert_eq!(
        error.source_line(),
        Some("import { x } from \"state.solve\"")
    );
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
    assert_eq!(*delivered.borrow(), vec![Value::Number(7)]);
}

#[test]
fn cumulative_module_state_limit_uses_the_crossing_module_provenance() {
    let first_name = "a".repeat(55);
    let second_name = "b".repeat(55);
    let first_source = format!("export let {first_name} = 1\n");
    let second_source = format!("export let {second_name} = 1\n");
    let entry_source = "import \"first.solve\" as first\nimport \"second.solve\" as second\n";
    let modules = program(
        "entry.solve",
        &["first.solve", "second.solve", "entry.solve"],
        vec![
            module(
                "first.solve",
                &first_source,
                &[],
                &[(first_name.as_str(), ExportKind::Let)],
            ),
            module(
                "second.solve",
                &second_source,
                &[],
                &[(second_name.as_str(), ExportKind::Let)],
            ),
            module(
                "entry.solve",
                entry_source,
                &["first.solve", "second.solve"],
                &[],
            ),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost).with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 10_000,
        max_call_depth: 32,
        max_value_bytes: 100,
    });

    let error = evaluator
        .run_modules(&modules)
        .expect_err("the second individually valid module crosses the aggregate limit");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert_eq!(error.source_name(), Some("second.solve"));
    assert_eq!(error.source_line(), Some(second_source.trim_end()));
    assert!(evaluator.outputs().is_empty());
}

#[derive(Default)]
struct RecordingHost {
    authorized: RefCell<Vec<Capability>>,
    denied: Vec<Capability>,
    requests: Vec<HostRequest>,
    outputs: Vec<Value>,
}

struct FailingOutputHost;

impl RuntimeHost for FailingOutputHost {
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

    fn emit_output(&mut self, _value: &Value) -> Result<(), HostError> {
        Err(HostError::failed(
            Capability::Output,
            "output adapter failed",
        ))
    }
}

#[test]
fn failed_output_delivery_does_not_append_evaluator_output() {
    let mut evaluator = Evaluator::new(FailingOutputHost);

    let error = evaluator
        .run(&parse("print(1)\n"))
        .expect_err("output adapter failure is surfaced");

    assert_eq!(error.kind(), RuntimeErrorKind::Host);
    assert_eq!(error.capability(), Some(&Capability::Output));
    assert!(evaluator.outputs().is_empty());
}

impl RuntimeHost for RecordingHost {
    fn authorize(&self, capability: &Capability) -> Result<(), HostError> {
        self.authorized.borrow_mut().push(capability.clone());
        if self.denied.contains(capability) {
            Err(HostError::denied(
                capability.clone(),
                "capability denied by mutable test policy",
            ))
        } else {
            Ok(())
        }
    }

    fn invoke(
        &mut self,
        request: HostRequest,
        _max_response_bytes: usize,
    ) -> Result<Value, HostError> {
        let value = match &request {
            HostRequest::Environment { name } => Value::Text(format!("env:{name}")),
            _ => Value::Bool(true),
        };
        self.requests.push(request);
        Ok(value)
    }

    fn emit_output(&mut self, value: &Value) -> Result<(), HostError> {
        self.outputs.push(value.clone());
        Ok(())
    }
}

#[test]
fn composite_work_limit_stops_before_a_later_host_request() {
    let source = format!("{}\nprint(env(\"MODE\"))\n", vec!["input"; 80].join("\n"));
    let mut evaluator = Evaluator::with_input(
        RecordingHost::default(),
        &source,
        "aggregate.solve",
        Some(Value::Text("1234".to_string())),
    )
    .with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 16,
        max_value_bytes: 21,
    });

    let error = evaluator
        .run(&parse(&source))
        .expect_err("aggregate value work is bounded before later invocation");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn function_arity_fails_before_argument_host_requests() {
    let source = "fn one(value) { return value }\nprint(one(env(\"A\"), env(\"B\")))\n";
    let mut evaluator = Evaluator::new(RecordingHost::default());

    let error = evaluator
        .run(&parse(source))
        .expect_err("arity is checked before evaluating arguments");

    assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
    assert!(
        error
            .message()
            .contains("expects 1 arguments but received 2")
    );
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn oversized_host_values_fail_before_output_delivery() {
    let mut evaluator = Evaluator::new(RecordingHost::default()).with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 16,
        max_value_bytes: 8,
    });

    let error = evaluator
        .run(&parse("print(env(\"MODE\"))\n"))
        .expect_err("host-returned values share the evaluator value budget");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(evaluator.outputs().is_empty());
    assert!(matches!(
        evaluator.host().requests.as_slice(),
        [HostRequest::Environment { .. }]
    ));
}

#[test]
fn runtime_host_is_preflighted_then_receives_typed_requests() {
    let source = "print(env(\"MODE\"))\n";
    let mut evaluator = Evaluator::new(RecordingHost::default());

    evaluator
        .run(&parse(source))
        .expect("host permits requests");

    assert_eq!(evaluator.outputs(), &[Value::Text("env:MODE".to_string())]);
    assert_eq!(
        evaluator.host().authorized.borrow().as_slice(),
        &[Capability::Environment, Capability::Environment,]
    );
    assert!(matches!(
        evaluator.host().requests.as_slice(),
        [HostRequest::Environment { .. }]
    ));
}

#[test]
fn unknown_calls_fail_closed_even_when_the_host_allows_capabilities() {
    let source = "print(\"must not print\")\nunsupported_call()\n";
    let mut evaluator = Evaluator::new(RecordingHost::default());

    let error = evaluator
        .run(&parse(source))
        .expect_err("unknown calls are rejected during evaluator preflight");

    assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
    assert!(
        error
            .message()
            .contains("unknown function 'unsupported_call'")
    );
    assert!(error.capability().is_none());
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.host().outputs.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn retained_agent_metadata_is_aggregate_bounded_and_atomic() {
    let first = "agent Keeper { instruction \"keep\" }\n";
    let crossing = format!(
        "print(\"must not print\")\nagent Next {{ instruction \"{}\" }}\n",
        "x".repeat(110)
    );
    let mut evaluator = Evaluator::with_input(RecordingHost::default(), first, "first.solve", None)
        .with_limits(EvaluationLimits {
            max_loop_iterations: 100,
            max_steps: 10_000,
            max_call_depth: 32,
            max_value_bytes: 128,
        });
    evaluator
        .run(&parse(first))
        .expect("the first bounded agent definition is retained");
    evaluator.set_source_context(&crossing, "crossing.solve");

    let error = evaluator
        .run(&parse(&crossing))
        .expect_err("aggregate agent metadata cannot cross the retained-state limit");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(error.message().contains("retained values exceeded"));
    assert_eq!(error.source_name(), Some("crossing.solve"));
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.host().outputs.is_empty());
    assert!(evaluator.outputs().is_empty());

    let reuse = "ask Keeper(\"still available\")\n";
    evaluator.set_source_context(reuse, "reuse.solve");
    evaluator
        .run(&parse(reuse))
        .expect("the prior agent remains usable after the rejected replacement");
    assert_eq!(evaluator.host().requests.len(), 1);
    assert_eq!(evaluator.outputs(), &[Value::Bool(true)]);
}

#[test]
fn agent_metadata_clone_work_is_bounded_before_output() {
    let source = format!(
        "print(\"must not print\")\nagent Large {{ instruction \"{}\" }}\n",
        "x".repeat(1_000)
    );
    let mut evaluator = Evaluator::new(RecordingHost::default()).with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 16,
        max_call_depth: 32,
        max_value_bytes: 16_777_216,
    });

    let error = evaluator
        .run(&parse(&source))
        .expect_err("agent metadata clone work is charged before allocation");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.host().outputs.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn repeated_agent_redefinition_consumes_runtime_value_work() {
    let source = format!(
        r#"
let count = 0
while count < 100 {{
    agent Keeper {{ instruction "{}" }}
    count = count + 1
}}
"#,
        "x".repeat(100)
    );
    let mut evaluator = Evaluator::new(RecordingHost::default()).with_limits(EvaluationLimits {
        max_loop_iterations: 1_000,
        max_steps: 10_000,
        max_call_depth: 32,
        max_value_bytes: 512,
    });

    let error = evaluator
        .run(&parse(&source))
        .expect_err("each agent metadata clone consumes the per-run value-work budget");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(error.message().contains("value work exceeded"));
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.host().outputs.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn repeated_function_redefinition_consumes_runtime_value_work() {
    let source = format!(
        r#"
let count = 0
while count < 100 {{
    fn retained() {{ return "{}" }}
    count = count + 1
}}
"#,
        "x".repeat(2_000)
    );
    let mut evaluator = Evaluator::new(DenyAllHost).with_limits(EvaluationLimits {
        max_loop_iterations: 1_000,
        max_steps: 10_000,
        max_call_depth: 32,
        max_value_bytes: 5_000,
    });

    let error = evaluator
        .run(&parse(&source))
        .expect_err("each function AST clone consumes the per-run value-work budget");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(error.message().contains("value work exceeded"));
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn retained_function_snapshots_are_aggregate_bounded_and_atomic() {
    let first = format!("fn first() {{ return \"{}\" }}\n", "a".repeat(1_500));
    let second = format!("fn second() {{ return \"{}\" }}\n", "b".repeat(1_500));
    let mut evaluator = Evaluator::new(DenyAllHost).with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 10_000,
        max_call_depth: 32,
        max_value_bytes: 2_500,
    });
    evaluator.set_source_context(&first, "first.solve");
    evaluator
        .run(&parse(&first))
        .expect("the first retained function fits");

    evaluator.set_source_context(&second, "second.solve");
    let error = evaluator
        .run(&parse(&second))
        .expect_err("retained function AST snapshots share one aggregate limit");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(error.message().contains("retained values exceeded"));
    assert!(evaluator.outputs().is_empty());

    evaluator.set_source_context("first()\n", "reuse.solve");
    evaluator
        .run(&parse("first()\n"))
        .expect("the prior function remains available after the rejected addition");
}

#[test]
fn agent_registry_persistence_after_function_failure_is_legacy_compatible() {
    let failing = r#"
fn configure() {
    agent Keeper { instruction "keep" }
    return 1 / 0
}
configure()
"#;
    let mut evaluator = Evaluator::new(RecordingHost::default());

    evaluator
        .run(&parse(failing))
        .expect_err("the function fails after registering the agent");
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.outputs().is_empty());

    let reuse = "ask Keeper(\"still available\")\n";
    evaluator.set_source_context(reuse, "reuse.solve");
    evaluator
        .run(&parse(reuse))
        .expect("agent registry configuration remains global across function rollback");
    assert_eq!(evaluator.host().requests.len(), 1);
    assert_eq!(evaluator.outputs(), &[Value::Bool(true)]);
}

#[test]
fn deny_all_preflight_rejects_every_capability_before_output_or_invoke() {
    for (source, expected) in [
        (
            "print(\"must not print\")\nif false { http_get(\"https://example.invalid\") }\n",
            Capability::Network,
        ),
        (
            "fn hidden() { read_file(\"secret\") }\nprint(\"must not print\")\n",
            Capability::FileRead,
        ),
        (
            "while false { write_file(\"out\", \"data\") }\n",
            Capability::FileWrite,
        ),
        ("fn hidden() { env(\"TOKEN\") }\n", Capability::Environment),
        (
            "agent Helper { instruction \"help\" }\n",
            Capability::Provider,
        ),
        ("ask Missing(\"help\")\n", Capability::Provider),
        (
            "fn shell() { return 1 }\n",
            Capability::UnknownCall("shell".to_string()),
        ),
    ] {
        let mut evaluator = Evaluator::new(DenyAllHost);
        let error = evaluator
            .run(&parse(source))
            .expect_err("deny-all preflight rejects capability");
        assert_eq!(error.kind(), RuntimeErrorKind::CapabilityDenied);
        assert_eq!(error.capability(), Some(&expected));
        assert!(evaluator.outputs().is_empty());
    }
}

#[test]
fn default_evaluator_uses_the_deny_all_host() {
    let mut evaluator = Evaluator::default();

    let error = evaluator
        .run(&parse("http_get(\"https://example.invalid\")\n"))
        .expect_err("the default core host denies network access");

    assert_eq!(error.kind(), RuntimeErrorKind::CapabilityDenied);
    assert_eq!(error.capability(), Some(&Capability::Network));
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn preflight_rejects_calls_before_declaration_without_resetting_prior_state() {
    let mut evaluator = Evaluator::with_input(
        DenyAllHost,
        "print(1)\n",
        "first.solve",
        Some(Value::Text("preserved".to_string())),
    );
    evaluator
        .run(&parse("print(1)\n"))
        .expect("initial run succeeds");
    assert_eq!(evaluator.outputs(), &[Value::Number(1)]);

    let denied = "print(\"must not replace prior output\")\nlater()\nfn later() { return 1 }\n";
    evaluator.set_source_context(denied, "denied.solve");
    let error = evaluator
        .run(&parse(denied))
        .expect_err("forward call is rejected during sequential preflight");

    assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
    assert!(error.message().contains("unknown function 'later'"));
    assert!(error.capability().is_none());
    assert_eq!(error.source_name(), Some("denied.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(1)]);
}

#[test]
fn plain_runs_preserve_variables_functions_and_outputs_across_reuse() {
    let first = "let value = 4\nfn read() { return value }\nprint(value)\n";
    let second = "print(value + 1)\nprint(read())\n";
    let mut evaluator = Evaluator::with_input(DenyAllHost, first, "first.solve", None);

    evaluator
        .run(&parse(first))
        .expect("first incremental run succeeds");
    evaluator.set_source_context(second, "second.solve");
    evaluator
        .run(&parse(second))
        .expect("second incremental run reuses plain runtime state");

    assert_eq!(
        evaluator.outputs(),
        &[Value::Number(4), Value::Number(5), Value::Number(4)]
    );
}

#[test]
fn unresolved_legacy_includes_fail_preflight_before_emitting_output() {
    let first = "print(7)\n";
    let invalid = "print(8)\nimport \"unresolved.solve\"\n";
    let mut evaluator = Evaluator::with_input(DenyAllHost, first, "first.solve", None);
    evaluator.run(&parse(first)).expect("first run succeeds");
    evaluator.set_source_context(invalid, "invalid.solve");

    evaluator
        .run(&parse(invalid))
        .expect_err("unresolved include is rejected during preflight");

    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
}

#[test]
fn plain_function_errors_keep_definition_provenance_across_reuse() {
    let definition = "fn fail() {\n    return 1 / 0\n}\n";
    let invocation = "fail()\n";
    let mut evaluator = Evaluator::with_input(DenyAllHost, definition, "first.solve", None);
    evaluator
        .run(&parse(definition))
        .expect("function definition succeeds");
    evaluator.set_source_context(invocation, "second.solve");

    let error = evaluator
        .run(&parse(invocation))
        .expect_err("function invocation fails");

    assert_eq!(error.source_name(), Some("first.solve"));
    assert_eq!(error.location().map(|location| location.line), Some(2));
    assert_eq!(error.source_line(), Some("    return 1 / 0"));
}

#[test]
fn retained_functions_are_repreflighted_after_host_policy_tightens() {
    let definition = "fn hidden() { return env(\"TOKEN\") }\n";
    let invocation = "print(\"must not print\")\nhidden()\n";
    let mut evaluator =
        Evaluator::with_input(RecordingHost::default(), definition, "first.solve", None);
    evaluator
        .run(&parse(definition))
        .expect("definition is accepted by the initial host policy");
    evaluator.host_mut().denied.push(Capability::Environment);
    evaluator.set_source_context(invocation, "second.solve");

    let error = evaluator
        .run(&parse(invocation))
        .expect_err("retained capability is checked against the current host policy");

    assert_eq!(error.kind(), RuntimeErrorKind::CapabilityDenied);
    assert_eq!(error.capability(), Some(&Capability::Environment));
    assert_eq!(error.source_name(), Some("first.solve"));
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.host().outputs.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn retained_function_repreflight_order_is_deterministic() {
    let environment = ("a.solve", "fn a_environment() { return env(\"TOKEN\") }\n");
    let network = (
        "z.solve",
        "fn z_network() { return http_get(\"https://example.invalid\") }\n",
    );

    for order in [[network, environment], [environment, network]] {
        let mut evaluator = Evaluator::new(RecordingHost::default());
        for (source_name, source) in order {
            evaluator.set_source_context(source, source_name);
            evaluator
                .run(&parse(source))
                .expect("permissive policy retains the function");
        }
        evaluator.host_mut().denied = vec![Capability::Network, Capability::Environment];
        evaluator.set_source_context("print(\"must not print\")\n", "current.solve");

        let error = evaluator
            .run(&parse("print(\"must not print\")\n"))
            .expect_err("stable function-name order selects the same denial");

        assert_eq!(error.kind(), RuntimeErrorKind::CapabilityDenied);
        assert_eq!(error.capability(), Some(&Capability::Environment));
        assert_eq!(error.source_name(), Some("a.solve"));
        assert!(evaluator.host().requests.is_empty());
        assert!(evaluator.host().outputs.is_empty());
        assert!(evaluator.outputs().is_empty());
    }
}

#[test]
fn retained_function_parameters_cannot_shadow_newly_injected_input() {
    let definition = "fn echo(input) { return input }\n";
    let invocation = "print(\"must not print\")\n";
    let mut evaluator = Evaluator::with_input(DenyAllHost, definition, "first.solve", None);
    evaluator
        .run(&parse(definition))
        .expect("definition without injected input succeeds");
    evaluator.set_input(Some(Value::Number(7)));
    evaluator.set_source_context(invocation, "second.solve");

    let error = evaluator
        .run(&parse(invocation))
        .expect_err("retained function is incompatible with injected input");

    assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
    assert!(
        error
            .message()
            .contains("injected input value is read-only")
    );
    assert_eq!(error.source_name(), Some("first.solve"));
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn retained_dependency_functions_keep_their_defining_scope_and_input_rules() {
    let library_source = r#"
fn increment(value) { return value + 1 }
export fn apply(input) { return increment(input) }
"#;
    let entry_source = r#"
import { apply } from "library.solve"
print(apply(4))
"#;
    let modules = program(
        "entry.solve",
        &["library.solve", "entry.solve"],
        vec![
            module(
                "library.solve",
                library_source,
                &[],
                &[("apply", ExportKind::Function)],
            ),
            module("entry.solve", entry_source, &["library.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::with_input(
        DenyAllHost,
        entry_source,
        "entry.solve",
        Some(Value::Number(9)),
    );

    evaluator
        .run_modules(&modules)
        .expect("dependency input parameters and private helpers are valid");
    evaluator.set_source_context("", "next.solve");
    evaluator
        .run(&[])
        .expect("an empty later run preserves the dependency definition context");

    assert_eq!(evaluator.outputs(), &[Value::Number(5)]);
}

#[test]
fn retained_dependency_and_entry_functions_keep_module_call_context() {
    let base_source = "export fn add(left, right) { return left + right }\n";
    let library_source = r#"
import "base.solve" as base
export fn increment(value) { return base.add(value, 1) }
"#;
    let entry_source = r#"
import { increment } from "library.solve"
import "base.solve" as base
fn entry_increment(value) { return base.add(value, 1) }
print(increment(4))
print(entry_increment(5))
"#;
    let modules = program(
        "entry.solve",
        &["base.solve", "library.solve", "entry.solve"],
        vec![
            module(
                "base.solve",
                base_source,
                &[],
                &[("add", ExportKind::Function)],
            ),
            module(
                "library.solve",
                library_source,
                &["base.solve"],
                &[("increment", ExportKind::Function)],
            ),
            module(
                "entry.solve",
                entry_source,
                &["library.solve", "base.solve"],
                &[],
            ),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run_modules(&modules)
        .expect("module functions execute in their defining contexts");
    evaluator.set_source_context("", "next.solve");
    evaluator
        .run(&[])
        .expect("retained module calls remain valid during later preflight");

    assert_eq!(evaluator.outputs(), &[Value::Number(5), Value::Number(6)]);

    let direct_module_call = "print(base.add(6, 1))\n";
    evaluator.set_source_context(direct_module_call, "plain.solve");
    let error = evaluator
        .run(&parse(direct_module_call))
        .expect_err("module context is retained for definitions, not new plain statements");
    assert!(
        error
            .message()
            .contains("module loading is unavailable in the pure evaluator")
    );
    assert_eq!(evaluator.outputs(), &[Value::Number(5), Value::Number(6)]);
}

#[test]
fn retained_module_private_helpers_are_repreflighted_after_policy_tightens() {
    let library_source = r#"
fn hidden() { return env("TOKEN") }
export fn exposed() { return hidden() }
"#;
    let entry_source = "import \"library.solve\" as library\n";
    let modules = program(
        "entry.solve",
        &["library.solve", "entry.solve"],
        vec![
            module(
                "library.solve",
                library_source,
                &[],
                &[("exposed", ExportKind::Function)],
            ),
            module("entry.solve", entry_source, &["library.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(RecordingHost::default());
    evaluator
        .run_modules(&modules)
        .expect("the initial host policy permits the retained helper");
    evaluator.host_mut().denied.push(Capability::Environment);
    evaluator.set_source_context("print(\"must not print\")\n", "next.solve");

    let error = evaluator
        .run(&parse("print(\"must not print\")\n"))
        .expect_err("a hidden retained helper is checked against the current host policy");

    assert_eq!(error.kind(), RuntimeErrorKind::CapabilityDenied);
    assert_eq!(error.capability(), Some(&Capability::Environment));
    assert_eq!(error.source_name(), Some("library.solve"));
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.host().outputs.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn retained_module_preflight_metadata_is_bounded_before_plain_output() {
    let mut library_source = (0..20)
        .map(|index| format!("fn private_helper_with_long_name_{index}() {{ return {index} }}"))
        .collect::<Vec<_>>()
        .join("\n");
    library_source.push_str("\nexport fn exposed() { return private_helper_with_long_name_0() }\n");
    let entry_source = "import \"library_with_long_identity.solve\" as library\n";
    let modules = program(
        "entry.solve",
        &["library_with_long_identity.solve", "entry.solve"],
        vec![
            module(
                "library_with_long_identity.solve",
                &library_source,
                &[],
                &[("exposed", ExportKind::Function)],
            ),
            module(
                "entry.solve",
                entry_source,
                &["library_with_long_identity.solve"],
                &[],
            ),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run_modules(&modules)
        .expect("the module catalog fits the initial budget");
    evaluator.set_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 8,
        max_call_depth: 32,
        max_value_bytes: 16_777_216,
    });
    let later = "print(\"must not print\")\n";
    evaluator.set_source_context(later, "next.solve");

    let error = evaluator
        .run(&parse(later))
        .expect_err("retained catalog metadata is charged before collection and cloning");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn plain_function_snapshot_limit_fails_before_host_effects() {
    let definition = format!(
        "let payload = \"{}\"\nfn hidden() {{ return env(\"TOKEN\") }}\n",
        "x".repeat(1_400)
    );
    let invocation = "hidden()\n";
    let mut evaluator =
        Evaluator::with_input(RecordingHost::default(), &definition, "first.solve", None)
            .with_limits(EvaluationLimits {
                max_loop_iterations: 100,
                max_steps: 10_000,
                max_call_depth: 32,
                max_value_bytes: 2_000,
            });
    evaluator
        .run(&parse(&definition))
        .expect("initial retained state fits the configured limit");
    evaluator.set_source_context(invocation, "second.solve");

    let error = evaluator
        .run(&parse(invocation))
        .expect_err("transaction snapshot is bounded before function effects");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(error.message().contains("retained values exceeded"));
    assert_eq!(error.source_name(), Some("second.solve"));
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.host().outputs.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn module_preflight_scans_every_node_before_initialization_or_output() {
    let entry_source = "import \"hidden.solve\" as hidden\nprint(\"must not print\")\n";
    let hidden_source = "export fn unused() { http_post(\"https://example.invalid\", \"{}\") }\n";
    let modules = program(
        "entry.solve",
        &["hidden.solve", "entry.solve"],
        vec![
            module(
                "hidden.solve",
                hidden_source,
                &[],
                &[("unused", ExportKind::Function)],
            ),
            module("entry.solve", entry_source, &["hidden.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    let error = evaluator
        .run_modules(&modules)
        .expect_err("module capability is rejected before initialization");

    assert_eq!(error.kind(), RuntimeErrorKind::CapabilityDenied);
    assert_eq!(error.capability(), Some(&Capability::Network));
    assert_eq!(error.source_name(), Some("hidden.solve"));
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn module_entry_legacy_include_fails_before_reset_or_output() {
    let entry_source = "print(8)\nimport \"unresolved.solve\"\n";
    let modules = program(
        "entry.solve",
        &["entry.solve"],
        vec![module("entry.solve", entry_source, &[], &[])],
    );
    let delivered = Rc::new(RefCell::new(Vec::new()));
    let mut evaluator = Evaluator::new(CapturingDenyHost {
        outputs: Rc::clone(&delivered),
    });
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial run succeeds");

    evaluator
        .run_modules(&modules)
        .expect_err("entry include is rejected during module preflight");

    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
    assert_eq!(*delivered.borrow(), vec![Value::Number(7)]);
}

#[test]
fn invalid_module_declarations_fail_before_resetting_prior_epoch_output() {
    for (invalid_source, exports) in [
        (
            "print(\"must not execute at module top level\")\n",
            Vec::new(),
        ),
        (
            "export let value = length([1])\n",
            vec![("value", ExportKind::Let)],
        ),
    ] {
        let mut evaluator = Evaluator::new(DenyAllHost);
        evaluator
            .run(&parse("print(7)\n"))
            .expect("initial epoch succeeds");
        assert_eq!(evaluator.outputs(), &[Value::Number(7)]);

        let modules = program(
            "entry.solve",
            &["invalid.solve", "entry.solve"],
            vec![
                module("invalid.solve", invalid_source, &[], &exports),
                module(
                    "entry.solve",
                    "import \"invalid.solve\" as invalid\n",
                    &["invalid.solve"],
                    &[],
                ),
            ],
        );
        evaluator
            .run_modules(&modules)
            .expect_err("invalid module declaration is rejected during preflight");

        assert_eq!(
            evaluator.outputs(),
            &[Value::Number(7)],
            "module preflight failure must not reset the prior evaluator epoch"
        );
    }
}

#[test]
fn malformed_module_topology_fails_before_resetting_prior_epoch_output() {
    let a_source = "import \"b.solve\" as b\nexport let value = 1\n";
    let b_source = "export let value = 2\n";
    let entry_source = "import \"a.solve\" as a\n";
    let malformed = program(
        "entry.solve",
        &["a.solve", "b.solve", "entry.solve"],
        vec![
            module(
                "a.solve",
                a_source,
                &["b.solve"],
                &[("value", ExportKind::Let)],
            ),
            module("b.solve", b_source, &[], &[("value", ExportKind::Let)]),
            module("entry.solve", entry_source, &["a.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial epoch succeeds");

    let error = evaluator
        .run_modules(&malformed)
        .expect_err("forward dependency is rejected before reset");

    assert!(error.message().contains("must precede"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
}

#[test]
fn malformed_module_export_metadata_fails_before_resetting_prior_epoch_output() {
    let state_source = "export let value = 2\n";
    let entry_source = "import { value } from \"state.solve\"\n";
    let malformed = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Function)],
            ),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run(&parse("print(7)\n"))
        .expect("initial epoch succeeds");

    let error = evaluator
        .run_modules(&malformed)
        .expect_err("inconsistent export metadata is rejected before reset");

    assert!(error.message().contains("export metadata"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
}

#[test]
fn graph_aware_preflight_rejects_invalid_import_calls_before_output() {
    let state_source = "export let value = 4\nexport fn read() { return value }\n";
    for (entry_source, expected) in [
        (
            "import { value } from \"state.solve\"\nprint(\"must not print\")\nvalue()\n",
            "unknown function 'value'",
        ),
        (
            "import \"state.solve\" as state\nprint(\"must not print\")\nstate.value()\n",
            "does not export function 'value'",
        ),
        (
            "import \"state.solve\" as state\nprint(\"must not print\")\nstate.missing()\n",
            "does not export function 'missing'",
        ),
        (
            "import { missing } from \"state.solve\"\nprint(\"must not print\")\n",
            "does not export 'missing'",
        ),
    ] {
        let modules = program(
            "entry.solve",
            &["state.solve", "entry.solve"],
            vec![
                module(
                    "state.solve",
                    state_source,
                    &[],
                    &[("value", ExportKind::Let), ("read", ExportKind::Function)],
                ),
                module("entry.solve", entry_source, &["state.solve"], &[]),
            ],
        );
        let mut evaluator = Evaluator::new(DenyAllHost);

        let error = evaluator
            .run_modules(&modules)
            .expect_err("invalid import call fails in graph preflight");

        assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
        assert!(
            error.message().contains(expected),
            "expected {expected:?}, got {:?}",
            error.message()
        );
        assert_eq!(error.source_name(), Some("entry.solve"));
        assert!(evaluator.outputs().is_empty());
    }
}

#[test]
fn module_preflight_resolves_imports_before_validating_earlier_functions() {
    let math_source = "export let value = 4\nexport fn add(left, right) { return left + right }\n";
    let entry_source = r#"
fn named() { return add(value, 1) }
fn namespaced() { return math.add(2, 3) }
import { value, add } from "math.solve"
import "math.solve" as math
print(named())
print(namespaced())
"#;
    let modules = program(
        "entry.solve",
        &["math.solve", "entry.solve"],
        vec![
            module(
                "math.solve",
                math_source,
                &[],
                &[("value", ExportKind::Let), ("add", ExportKind::Function)],
            ),
            module(
                "entry.solve",
                entry_source,
                &["math.solve", "math.solve"],
                &[],
            ),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run_modules(&modules)
        .expect("functions may reference imports declared later in the module");

    assert_eq!(evaluator.outputs(), &[Value::Number(5), Value::Number(5)]);
}

#[test]
fn later_imports_are_read_only_during_preflight_of_earlier_functions() {
    let state_source = "export let value = 4\n";
    let entry_source = r#"
fn mutate() { value = 9 }
import { value } from "state.solve"
print("must not print")
"#;
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let)],
            ),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    let error = evaluator
        .run_modules(&modules)
        .expect_err("later imported binding is read-only in earlier function");

    assert!(
        error
            .message()
            .contains("imported binding 'value' is read-only")
    );
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn top_level_for_scope_can_shadow_an_import_without_mutating_it() {
    let state_source = "export let value = 4\n";
    let entry_source = r#"
import { value } from "state.solve"
for item in [1] {
    let value = item + 8
    print(value)
}
print(value)
"#;
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let)],
            ),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run_modules(&modules)
        .expect("loop-local binding shadows the imported value");

    assert_eq!(evaluator.outputs(), &[Value::Number(9), Value::Number(4)]);
}

#[test]
fn nested_blocks_inside_top_level_loops_do_not_leak_import_shadows() {
    let state_source = "export fn run() { return 4 }\n";
    for nested_block in [
        "if true { let run = 9 print(run) }",
        "while false { let run = 9 }",
    ] {
        let entry_source = format!(
            "import {{ run }} from \"state.solve\"\nfor item in [1] {{\n    {nested_block}\n    print(run())\n}}\n"
        );
        let modules = program(
            "entry.solve",
            &["state.solve", "entry.solve"],
            vec![
                module(
                    "state.solve",
                    state_source,
                    &[],
                    &[("run", ExportKind::Function)],
                ),
                module("entry.solve", &entry_source, &["state.solve"], &[]),
            ],
        );
        let mut evaluator = Evaluator::new(DenyAllHost);

        evaluator
            .run_modules(&modules)
            .expect("nested loop block keeps its own lexical lifetime");

        let expected = if nested_block.starts_with("if") {
            vec![Value::Number(9), Value::Number(4)]
        } else {
            vec![Value::Number(4)]
        };
        assert_eq!(evaluator.outputs(), expected.as_slice());
    }
}

#[test]
fn imported_assignments_fail_before_prior_output() {
    let state_source = "export let value = 4\n";
    let entry_source =
        "import { value } from \"state.solve\"\nprint(\"must not print\")\nvalue = 8\n";
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let)],
            ),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    let error = evaluator
        .run_modules(&modules)
        .expect_err("import assignment is rejected in preflight");

    assert!(
        error
            .message()
            .contains("imported binding 'value' is read-only")
    );
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn diamond_modules_initialize_once_and_share_live_exports() {
    let state_source = r#"
export let value = 0
export fn bump() { value = value + 1 return value }
"#;
    let a_source =
        "import { bump } from \"state.solve\"\nexport fn bump_shared() { return bump() }\n";
    let b_source =
        "import \"state.solve\" as state\nexport fn bump_shared() { return state.bump() }\n";
    let entry_source = r#"
import "a.solve" as a
import "b.solve" as b
import "state.solve" as state
import { value, bump } from "state.solve"
print(a.bump_shared())
print(b.bump_shared())
print(value)
print(state.value)
print(bump())
"#;
    let modules = program(
        "entry.solve",
        &["state.solve", "a.solve", "b.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let), ("bump", ExportKind::Function)],
            ),
            module(
                "a.solve",
                a_source,
                &["state.solve"],
                &[("bump_shared", ExportKind::Function)],
            ),
            module(
                "b.solve",
                b_source,
                &["state.solve"],
                &[("bump_shared", ExportKind::Function)],
            ),
            module(
                "entry.solve",
                entry_source,
                &["a.solve", "b.solve", "state.solve", "state.solve"],
                &[],
            ),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run_modules(&modules)
        .expect("diamond module graph succeeds");

    assert_eq!(
        evaluator.outputs(),
        &[
            Value::Number(1),
            Value::Number(2),
            Value::Number(2),
            Value::Number(2),
            Value::Number(3),
        ]
    );
}

#[test]
fn nested_same_module_calls_share_live_state() {
    let counter_source = r#"
export let count = 1
fn first() { count = count + 2 }
fn second() { count = count + 3 }
export fn run() { first() second() return count }
"#;
    let entry_source =
        "import \"counter.solve\" as counter\nprint(counter.run())\nprint(counter.count)\n";
    let modules = program(
        "entry.solve",
        &["counter.solve", "entry.solve"],
        vec![
            module(
                "counter.solve",
                counter_source,
                &[],
                &[("count", ExportKind::Let), ("run", ExportKind::Function)],
            ),
            module("entry.solve", entry_source, &["counter.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run_modules(&modules)
        .expect("nested same-module calls commit one live state");

    assert_eq!(evaluator.outputs(), &[Value::Number(6), Value::Number(6)]);
}

#[test]
fn cross_module_calls_commit_only_their_defining_module_state() {
    let a_source = "export let count = 0\nexport fn bump() { count = count + 1 return count }\n";
    let b_source = r#"
import "a.solve" as a
export let count = 100
export fn bump_both() { let remote = a.bump() count = count + 10 return [remote, count] }
"#;
    let entry_source = r#"
import "a.solve" as a
import "b.solve" as b
print(b.bump_both())
print(a.count)
print(b.count)
"#;
    let modules = program(
        "entry.solve",
        &["a.solve", "b.solve", "entry.solve"],
        vec![
            module(
                "a.solve",
                a_source,
                &[],
                &[("count", ExportKind::Let), ("bump", ExportKind::Function)],
            ),
            module(
                "b.solve",
                b_source,
                &["a.solve"],
                &[
                    ("count", ExportKind::Let),
                    ("bump_both", ExportKind::Function),
                ],
            ),
            module("entry.solve", entry_source, &["a.solve", "b.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run_modules(&modules)
        .expect("cross-module calls remain isolated and commit independently");

    assert_eq!(
        evaluator.outputs(),
        &[
            Value::Array(vec![Value::Number(1), Value::Number(110)]),
            Value::Number(1),
            Value::Number(110),
        ]
    );
}

#[test]
fn nested_module_growth_is_rejected_before_host_effects() {
    let callee_value = "a".repeat(100);
    let caller_value = "b".repeat(50);
    let callee_source = format!(
        "export let value = \"\"\nexport fn grow() {{\n    value = \"{callee_value}\"\n    print(\"must not print\")\n    return env(\"MODE\")\n}}\n"
    );
    let caller_source = format!(
        "import \"callee.solve\" as callee\nexport let value = \"\"\nexport fn grow_both() {{\n    value = \"{caller_value}\"\n    return callee.grow()\n}}\n"
    );
    let entry_source = "import \"caller.solve\" as caller\nprint(caller.grow_both())\n";
    let modules = program(
        "entry.solve",
        &["callee.solve", "caller.solve", "entry.solve"],
        vec![
            module(
                "callee.solve",
                &callee_source,
                &[],
                &[("value", ExportKind::Let), ("grow", ExportKind::Function)],
            ),
            module(
                "caller.solve",
                &caller_source,
                &["callee.solve"],
                &[
                    ("value", ExportKind::Let),
                    ("grow_both", ExportKind::Function),
                ],
            ),
            module("entry.solve", entry_source, &["caller.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::with_input(
        RecordingHost::default(),
        entry_source,
        "entry.solve",
        Some(Value::Text("i".repeat(1_299))),
    )
    .with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 10_000,
        max_call_depth: 32,
        max_value_bytes: 2_000,
    });

    let error = evaluator
        .run_modules(&modules)
        .expect_err("suspended caller and callee state share one retained limit");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(error.message().contains("retained values exceeded"));
    assert_eq!(error.source_name(), Some("callee.solve"));
    assert_eq!(error.location().map(|location| location.line), Some(3));
    assert_eq!(
        error.source_line(),
        Some(format!("    value = \"{callee_value}\"").as_str())
    );
    assert!(evaluator.host().requests.is_empty());
    assert!(evaluator.host().outputs.is_empty());
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn reused_module_runs_start_fresh_and_preserve_injected_input() {
    let state_source = r#"
export let count = 0
export fn bump() { count = count + 1 return count }
"#;
    let entry_source = r#"
import { bump } from "state.solve"
let local = input.seed
print(local)
print(bump())
"#;
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("count", ExportKind::Let), ("bump", ExportKind::Function)],
            ),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::with_input(
        DenyAllHost,
        entry_source,
        "entry.solve",
        Some(Value::Object(BTreeMap::from([(
            "seed".to_string(),
            Value::Number(7),
        )]))),
    );

    evaluator
        .run_modules(&modules)
        .expect("first module epoch succeeds");
    assert_eq!(evaluator.outputs(), &[Value::Number(7), Value::Number(1)]);
    evaluator
        .run_modules(&modules)
        .expect("second module epoch succeeds");
    assert_eq!(evaluator.outputs(), &[Value::Number(7), Value::Number(1)]);
}

#[test]
fn injected_input_is_not_visible_inside_dependency_modules() {
    let state_source = "export fn read() { return input }\n";
    let entry_source = "import { read } from \"state.solve\"\nprint(read())\n";
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("read", ExportKind::Function)],
            ),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::with_input(
        DenyAllHost,
        entry_source,
        "entry.solve",
        Some(Value::Number(99)),
    );

    let error = evaluator
        .run_modules(&modules)
        .expect_err("dependency modules cannot observe entry input");

    assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
    assert!(error.message().contains("unknown variable 'input'"));
    assert_eq!(error.source_name(), Some("state.solve"));
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn dependency_module_input_binding_wins_over_entry_input() {
    let state_source = "export let input = 5\nexport fn read() { return input }\n";
    let entry_source = "import { read } from \"state.solve\"\nprint(read())\n";
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("input", ExportKind::Let), ("read", ExportKind::Function)],
            ),
            module("entry.solve", entry_source, &["state.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::with_input(
        DenyAllHost,
        entry_source,
        "entry.solve",
        Some(Value::Number(99)),
    );

    evaluator
        .run_modules(&modules)
        .expect("dependency-local input remains isolated");

    assert_eq!(evaluator.outputs(), &[Value::Number(5)]);
}

#[test]
fn entry_imports_and_loop_bindings_cannot_shadow_injected_input() {
    let state_source = "export let value = 5\n";
    let namespace_source = "import \"state.solve\" as input\n";
    let mut namespace_entry = module(
        "entry.solve",
        "import \"state.solve\" as state\n",
        &["state.solve"],
        &[],
    );
    let Stmt::ModuleImport { namespace, .. } = &mut namespace_entry.statements[0] else {
        panic!("expected namespace import")
    };
    *namespace = "input".to_string();
    namespace_entry.source = namespace_source.to_string();

    let named_source = "import { value as input } from \"state.solve\"\n";
    let mut named_entry = module(
        "entry.solve",
        "import { value as alias } from \"state.solve\"\n",
        &["state.solve"],
        &[],
    );
    let Stmt::NamedModuleImport { bindings, .. } = &mut named_entry.statements[0] else {
        panic!("expected named import")
    };
    bindings[0].local = "input".to_string();
    named_entry.source = named_source.to_string();

    let loop_source = "for input in [1] { print(input) }\n";
    let loop_entry = module("entry.solve", loop_source, &[], &[]);

    for entry in [namespace_entry, named_entry, loop_entry] {
        let entry_source = entry.source.clone();
        let has_dependency = !entry.dependencies.is_empty();
        let mut nodes = Vec::new();
        let mut order = Vec::new();
        if has_dependency {
            nodes.push(module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let)],
            ));
            order.push("state.solve");
        }
        nodes.push(entry);
        order.push("entry.solve");
        let modules = program("entry.solve", order.as_slice(), nodes);
        let mut evaluator = Evaluator::with_input(
            DenyAllHost,
            &entry_source,
            "entry.solve",
            Some(Value::Number(99)),
        );

        let error = evaluator
            .run_modules(&modules)
            .expect_err("entry input shadowing is rejected during preflight");

        assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
        assert!(
            error
                .message()
                .contains("injected input value is read-only")
        );
        assert_eq!(error.source_name(), Some("entry.solve"));
        assert!(evaluator.outputs().is_empty());
    }
}

#[test]
fn modules_share_live_exports_and_roll_back_failed_calls() {
    let counter_source = r#"
export let count = 0
export fn bump() { count = count + 1 return count }
export fn fail() { count = count + 10 return 1 / 0 }
"#;
    let entry_source = r#"
import "counter.solve" as counter
import { count as named_count, bump, fail } from "counter.solve"
print(bump())
print(named_count)
fail()
"#;
    let modules = program(
        "entry.solve",
        &["counter.solve", "entry.solve"],
        vec![
            module(
                "counter.solve",
                counter_source,
                &[],
                &[
                    ("count", ExportKind::Let),
                    ("bump", ExportKind::Function),
                    ("fail", ExportKind::Function),
                ],
            ),
            module(
                "entry.solve",
                entry_source,
                &["counter.solve", "counter.solve"],
                &[],
            ),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    let error = evaluator
        .run_modules(&modules)
        .expect_err("failed module call rolls its mutation back");

    assert!(error.message().contains("divide by zero"));
    assert_eq!(error.source_name(), Some("counter.solve"));
    assert_eq!(error.location().map(|location| location.line), Some(4));
    assert_eq!(
        error.source_line(),
        Some("export fn fail() { count = count + 10 return 1 / 0 }")
    );
    assert_eq!(evaluator.outputs(), &[Value::Number(1), Value::Number(1)]);

    let inspect_source = "import { count } from \"counter.solve\"\nprint(count)\n";
    let inspect = program(
        "inspect.solve",
        &["counter.solve", "inspect.solve"],
        vec![
            module(
                "counter.solve",
                counter_source,
                &[],
                &[
                    ("count", ExportKind::Let),
                    ("bump", ExportKind::Function),
                    ("fail", ExportKind::Function),
                ],
            ),
            module("inspect.solve", inspect_source, &["counter.solve"], &[]),
        ],
    );
    evaluator
        .run_modules(&inspect)
        .expect("a new module run starts a fresh epoch");
    assert_eq!(evaluator.outputs(), &[Value::Number(0)]);
}

#[test]
fn imported_bindings_are_read_only_but_lexical_shadows_are_isolated() {
    let state_source = r#"
export let value = 4
export fn read() { return value }
"#;
    let shadow_source = r#"
import { value, read } from "state.solve"
export fn local_shadow(value) { value = value + 1 return value }
export fn loop_shadow() { for value in [9] {} return value }
export fn call_read(read) { return read() }
"#;
    let entry_source = r#"
import { value } from "state.solve"
import { local_shadow, loop_shadow, call_read } from "shadow.solve"
print(local_shadow(10))
print(loop_shadow())
call_read(1)
value = 8
"#;
    let modules = program(
        "entry.solve",
        &["state.solve", "shadow.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let), ("read", ExportKind::Function)],
            ),
            module(
                "shadow.solve",
                shadow_source,
                &["state.solve"],
                &[
                    ("local_shadow", ExportKind::Function),
                    ("loop_shadow", ExportKind::Function),
                    ("call_read", ExportKind::Function),
                ],
            ),
            module(
                "entry.solve",
                entry_source,
                &["state.solve", "shadow.solve"],
                &[],
            ),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    let error = evaluator
        .run_modules(&modules)
        .expect_err("parameter shadow is not dynamically callable");

    assert!(
        error
            .message()
            .contains("lexical binding 'read' is not callable")
    );
    assert_eq!(error.source_name(), Some("shadow.solve"));
    assert!(evaluator.outputs().is_empty());
}

#[test]
fn module_function_parameters_and_loop_bindings_shadow_imports_lexically() {
    let state_source = "export let value = 4\n";
    let shadow_source = r#"
import { value } from "state.solve"
export fn local_shadow(value) { value = value + 1 return value }
export fn loop_shadow() { for value in [9] {} return value }
"#;
    let entry_source = r#"
import { local_shadow, loop_shadow } from "shadow.solve"
print(local_shadow(10))
print(loop_shadow())
"#;
    let modules = program(
        "entry.solve",
        &["state.solve", "shadow.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let)],
            ),
            module(
                "shadow.solve",
                shadow_source,
                &["state.solve"],
                &[
                    ("local_shadow", ExportKind::Function),
                    ("loop_shadow", ExportKind::Function),
                ],
            ),
            module("entry.solve", entry_source, &["shadow.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);

    evaluator
        .run_modules(&modules)
        .expect("lexical shadows execute without mutating imported values");

    assert_eq!(evaluator.outputs(), &[Value::Number(11), Value::Number(4)]);
}

#[test]
fn escaped_loop_control_is_rejected_before_plain_or_module_effects() {
    for keyword in ["break", "continue"] {
        let control = match keyword {
            "break" => Stmt::Break {
                location: SourceLocation::new(2, 16),
            },
            "continue" => Stmt::Continue {
                location: SourceLocation::new(2, 16),
            },
            _ => unreachable!(),
        };
        let invalid_statements = vec![
            test_print(99),
            Stmt::Function {
                name: "invalid".to_string(),
                params: Vec::new(),
                body: vec![control],
                location: SourceLocation::new(2, 1),
            },
        ];
        let mut plain = Evaluator::new(DenyAllHost);
        plain
            .run(&parse("print(7)\n"))
            .expect("the prior plain epoch succeeds");
        let invalid = format!("print(\"must not print\")\nfn invalid() {{ {keyword} }}\n");
        plain.set_source_context(&invalid, "invalid-plain.solve");

        let error = plain
            .run(&invalid_statements)
            .expect_err("loop control cannot escape a plain function body");

        assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
        assert!(
            error
                .message()
                .contains("loop control may only appear inside a loop")
        );
        assert_eq!(error.source_name(), Some("invalid-plain.solve"));
        assert_eq!(plain.outputs(), &[Value::Number(7)]);

        let mut module_evaluator = Evaluator::new(DenyAllHost);
        module_evaluator
            .run(&parse("print(7)\n"))
            .expect("the prior module epoch succeeds");
        let modules = program(
            "entry.solve",
            &["entry.solve"],
            vec![ModuleNode {
                identity: "entry.solve".to_string(),
                source: invalid,
                statements: invalid_statements,
                dependencies: Vec::new(),
                exports: BTreeMap::new(),
            }],
        );

        let error = module_evaluator
            .run_modules(&modules)
            .expect_err("loop control cannot escape a module function body");

        assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
        assert!(
            error
                .message()
                .contains("loop control may only appear inside a loop")
        );
        assert_eq!(error.source_name(), Some("entry.solve"));
        assert_eq!(module_evaluator.outputs(), &[Value::Number(7)]);
    }
}

#[test]
fn retained_input_import_conflict_is_atomic_and_preserves_the_import() {
    let state_source = "export let value = 5\n";
    let entry_source = "import { value as input } from \"state.solve\"\nprint(input)\n";
    let mut entry = module(
        "entry.solve",
        "import { value as alias } from \"state.solve\"\nprint(alias)\n",
        &["state.solve"],
        &[],
    );
    let Stmt::NamedModuleImport { bindings, .. } = &mut entry.statements[0] else {
        panic!("expected a named import")
    };
    bindings[0].local = "input".to_string();
    let Stmt::Print { value, .. } = &mut entry.statements[1] else {
        panic!("expected an import print")
    };
    value.kind = ExprKind::Variable("input".to_string());
    entry.source = entry_source.to_string();
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let)],
            ),
            entry,
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost);
    evaluator
        .run_modules(&modules)
        .expect("the entry import is retained after the module epoch");
    assert_eq!(evaluator.outputs(), &[Value::Number(5)]);

    evaluator.set_input(Some(Value::Number(99)));
    let later = "print(\"must not print\")\n";
    evaluator.set_source_context(later, "later.solve");
    let error = evaluator
        .run(&parse(later))
        .expect_err("injected input cannot replace a retained entry import");

    assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
    assert!(error.message().contains("retained entry import"));
    assert_eq!(error.source_name(), Some("later.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(5)]);

    evaluator.set_input(None);
    let reuse = "print(input)\n";
    evaluator.set_source_context(reuse, "reuse.solve");
    evaluator
        .run(&parse(reuse))
        .expect("the rejected input injection leaves the import available");
    assert_eq!(evaluator.outputs(), &[Value::Number(5), Value::Number(5)]);
}

#[test]
fn retained_entry_import_rules_are_repreflighted_before_plain_output() {
    let state_source = "export let value = 5\nexport fn read() { return value }\n";
    let entry_source = "import { value, read } from \"state.solve\"\n";
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let), ("read", ExportKind::Function)],
            ),
            module(
                "entry.solve",
                entry_source,
                &["state.solve"].as_slice(),
                &[],
            ),
        ],
    );

    for (later, expected) in [
        (
            "print(\"must not print\")\nvalue = 9\n",
            "imported binding 'value' is read-only",
        ),
        (
            "print(\"must not print\")\nfn read() { return 9 }\n",
            "imported binding 'read' is read-only",
        ),
        (
            "print(\"must not print\")\nfn invoke(read) { return read() }\n",
            "lexical binding 'read' is not callable",
        ),
    ] {
        let mut evaluator = Evaluator::new(DenyAllHost);
        evaluator
            .run_modules(&modules)
            .expect("the retained imports are initialized");
        evaluator.set_source_context(later, "later.solve");

        let error = evaluator
            .run(&parse(later))
            .expect_err("retained import rules apply to later plain runs");

        assert_eq!(error.kind(), RuntimeErrorKind::Evaluation);
        assert!(
            error.message().contains(expected),
            "expected {expected:?}, got {:?}",
            error.message()
        );
        assert_eq!(error.source_name(), Some("later.solve"));
        assert!(evaluator.outputs().is_empty());
    }
}

#[test]
fn staged_entry_import_failure_preserves_the_previous_epoch() {
    let alias = "a".repeat(4_000);
    let state_source = "export let value = 5\n";
    let entry_source = format!("import {{ value as {alias} }} from \"state.solve\"\n");
    let modules = program(
        "entry.solve",
        &["state.solve", "entry.solve"],
        vec![
            module(
                "state.solve",
                state_source,
                &[],
                &[("value", ExportKind::Let)],
            ),
            module("entry.solve", &entry_source, &["state.solve"], &[]),
        ],
    );
    let mut evaluator = Evaluator::new(DenyAllHost).with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 20_000,
        max_call_depth: 32,
        max_value_bytes: 128,
    });
    evaluator
        .run(&parse("print(7)\n"))
        .expect("the prior epoch succeeds");

    let error = evaluator
        .run_modules(&modules)
        .expect_err("entry import staging is bounded before epoch reset");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(error.message().contains("value work exceeded"));
    assert_eq!(error.source_name(), Some("entry.solve"));
    assert_eq!(evaluator.outputs(), &[Value::Number(7)]);
}

#[test]
fn json_helpers_bound_encoded_expansion_and_fragmented_structure() {
    let stringify_source = "print(json_stringify(input))\n";
    let mut stringify = Evaluator::with_input(
        DenyAllHost,
        stringify_source,
        "stringify.solve",
        Some(Value::Text("\0".repeat(100))),
    )
    .with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 1_000,
        max_call_depth: 32,
        max_value_bytes: 256,
    });

    let stringify_error = stringify
        .run(&parse(stringify_source))
        .expect_err("JSON escaping is bounded before allocating the result");
    assert_eq!(stringify_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(stringify.outputs().is_empty());

    let json = format!("[{}]", vec!["0"; 100].join(","));
    let parse_source = "print(json_parse(input))\n";
    let mut parse_evaluator = Evaluator::with_input(
        DenyAllHost,
        parse_source,
        "parse.solve",
        Some(Value::Text(json)),
    )
    .with_limits(EvaluationLimits {
        max_loop_iterations: 100,
        max_steps: 64,
        max_call_depth: 32,
        max_value_bytes: 1_000,
    });

    let parse_error = parse_evaluator
        .run(&parse(parse_source))
        .expect_err("fragmented JSON is bounded before serde allocation");
    assert_eq!(parse_error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(
        parse_error
            .message()
            .contains("JSON structure exceeded deterministic evaluation limits")
    );
    assert!(parse_evaluator.outputs().is_empty());
}

#[test]
fn streamed_output_budget_resets_between_incremental_runs() {
    let source = "print(\"12345678\")\n";
    let mut evaluator = Evaluator::new(RecordingHost::default())
        .with_output_retention(false)
        .with_limits(EvaluationLimits {
            max_loop_iterations: 100,
            max_steps: 1_000,
            max_call_depth: 32,
            max_value_bytes: 10,
        });

    evaluator
        .run(&parse(source))
        .expect("the first streamed run fits");
    evaluator
        .run(&parse(source))
        .expect("the second run gets a fresh streaming output budget");

    assert!(evaluator.outputs().is_empty());
    assert_eq!(
        evaluator.host().outputs,
        vec![
            Value::Text("12345678".to_string()),
            Value::Text("12345678".to_string()),
        ]
    );
}

#[test]
fn for_loop_binding_size_is_bounded_before_body_output() {
    let binding = "item".repeat(100);
    let source = format!("for {binding} in [1] {{ print(\"must not print\") }}\n");
    let mut evaluator = Evaluator::new(DenyAllHost).with_limits(EvaluationLimits {
        max_loop_iterations: 10,
        max_steps: 1_000,
        max_call_depth: 32,
        max_value_bytes: 128,
    });

    let error = evaluator
        .run(&parse(&source))
        .expect_err("the loop binding cannot exceed the retained value limit");

    assert_eq!(error.kind(), RuntimeErrorKind::LimitExceeded);
    assert!(evaluator.outputs().is_empty());
}
