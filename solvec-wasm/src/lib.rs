#![forbid(unsafe_code)]
//! Browser-targeted, single-source SolveLang wrapper over the host-incapable core.
//!
//! The exported contract is deliberately deny-all and stateless. It accepts only
//! bounded in-memory source plus optional JSON input, performs no host I/O, and
//! is not wired into the public browser preview yet.

use serde_json::{Value as JsonValue, json};
use solvec_core::evaluator::{
    Capability, DenyAllHost, EvaluationLimits, Evaluator, RuntimeError, RuntimeErrorKind,
};
use solvec_core::{lexer, parser::Parser, value::Value};

#[cfg(target_arch = "wasm32")]
use wasm_bindgen::prelude::wasm_bindgen;

pub const MAX_SOURCE_BYTES: usize = 1_048_576;
pub const MAX_INPUT_BYTES: usize = 1_048_576;
pub const MAX_VALUE_BYTES: usize = 1_048_576;
pub const MAX_LOOP_ITERATIONS: usize = 10_000;
pub const MAX_STEPS: usize = 1_000_000;
pub const MAX_CALL_DEPTH: usize = 256;
pub const MAX_SOURCE_TOKENS: usize = 1024;
pub const MAX_SYNTAX_DEPTH: usize = 64;

const CONTRACT: &str = "solvelang.run_pure";
const CONTRACT_VERSION: u8 = 1;
const SOURCE_NAME: &str = "<browser>";

fn source_admitted(tokens: &[lexer::LocatedToken]) -> bool {
    if tokens.len() > MAX_SOURCE_TOKENS {
        return false;
    }
    let mut stack = Vec::new();
    let mut needs_primary = true;
    for (index, located) in tokens.iter().enumerate() {
        match located.token {
            lexer::Token::LeftParen | lexer::Token::LeftBrace | lexer::Token::LeftBracket => {
                stack.push(match located.token {
                    lexer::Token::LeftParen => b'(',
                    lexer::Token::LeftBrace => b'{',
                    _ => b'[',
                });
                if stack.len() > MAX_SYNTAX_DEPTH {
                    return false;
                }
                needs_primary = true;
            }
            lexer::Token::RightParen => {
                // A ')' presented while the recursive-descent parser still needs
                // a primary expression is consumed by Parser::primary as an
                // invalid token; it does not unwind the surrounding grouped
                // expression. Keep that frame charged against the depth budget.
                // The only immediate-empty parenthesis accepted by the grammar
                // is an identifier call/parameter list such as f().
                let empty_call_or_parameters = needs_primary
                    && index >= 2
                    && matches!(&tokens[index - 1].token, lexer::Token::LeftParen)
                    && matches!(&tokens[index - 2].token, lexer::Token::Identifier(_));
                if stack.last() == Some(&b'(') && (!needs_primary || empty_call_or_parameters) {
                    stack.pop();
                }
                needs_primary = false;
            }
            lexer::Token::RightBrace | lexer::Token::RightBracket => {
                let opening = match located.token {
                    lexer::Token::RightBrace => b'{',
                    _ => b'[',
                };
                if stack.last() == Some(&opening) {
                    stack.pop();
                }
                needs_primary = false;
            }
            lexer::Token::Plus
            | lexer::Token::Minus
            | lexer::Token::Star
            | lexer::Token::Slash
            | lexer::Token::Join
            | lexer::Token::EqualEqual
            | lexer::Token::BangEqual
            | lexer::Token::Greater
            | lexer::Token::Less
            | lexer::Token::GreaterEqual
            | lexer::Token::LessEqual
            | lexer::Token::And
            | lexer::Token::Or
            | lexer::Token::Equal
            | lexer::Token::Comma
            | lexer::Token::Colon
            | lexer::Token::Not
            | lexer::Token::Newline => {
                needs_primary = true;
            }
            lexer::Token::Eof => {}
            _ => {
                needs_primary = false;
            }
        }
    }
    true
}

#[test]
fn parser_admission_rejects_deep_and_high_cardinality_source_before_output() {
    for source in [
        format!("print({}1{})", "(".repeat(5000), ")".repeat(5000)),
        format!("print({}1{})", "(".repeat(65), ")".repeat(65)),
        format!("print({}true)", "not ".repeat(2000)),
        "let x = 1\n".repeat(1000),
        format!(
            "print({}{}1",
            "(".repeat(63),
            format!("{}{}", "] +".repeat(63), "(".repeat(63)).repeat(4)
        ),
        format!("print({}{}1", "(".repeat(63), ") + (".repeat(300)),
    ] {
        assert!(!source_admitted(&lexer::lex(&source)));
        let result: JsonValue = serde_json::from_str(&run_pure_v1(&source, "")).unwrap();
        assert_eq!(result["ok"], false);
        assert_eq!(result["error"]["kind"], "limit_exceeded");
        assert_eq!(result["outputs"], json!([]));
    }

    let nearby_valid = format!("print({})", vec!["(1)"; 100].join(" + "));
    assert!(source_admitted(&lexer::lex(&nearby_valid)));
    let result: JsonValue = serde_json::from_str(&run_pure_v1(&nearby_valid, "")).unwrap();
    assert_eq!(result["ok"], true);
    assert_eq!(result["outputs"], json!([100]));
    assert!(source_admitted(&lexer::lex("missing()")));
}

/// Execute one bounded, in-memory SolveLang source string with an immutable
/// deny-all host policy.
///
/// `input_json` is optional at the ABI boundary: an empty string means no
/// injected input. A non-empty value must be valid JSON representable by the
/// canonical SolveLang [`Value`] contract.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn run_pure_v1(source: &str, input_json: &str) -> String {
    if source.len() > MAX_SOURCE_BYTES {
        return error_response(
            "limit_exceeded",
            format!("source exceeded {MAX_SOURCE_BYTES} bytes"),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
        );
    }

    let input = match parse_input(input_json) {
        Ok(input) => input,
        Err(response) => return response,
    };

    let tokens = lexer::lex(source);
    if !source_admitted(&tokens) {
        return error_response(
            "limit_exceeded",
            format!(
                "source exceeded {MAX_SOURCE_TOKENS} tokens or syntax depth {MAX_SYNTAX_DEPTH}"
            ),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
        );
    }
    let statements = match Parser::new(tokens).parse() {
        Ok(statements) => statements,
        Err(diagnostics) => {
            let first = diagnostics.first();
            let diagnostic_values = diagnostics
                .iter()
                .map(|diagnostic| {
                    json!({
                        "line": diagnostic.line,
                        "column": diagnostic.column,
                        "message": diagnostic.message,
                        "hint": diagnostic.hint,
                    })
                })
                .collect();
            return error_response(
                "parse",
                first
                    .map(|diagnostic| diagnostic.message.clone())
                    .unwrap_or_else(|| "source could not be parsed".to_string()),
                first.map(|diagnostic| diagnostic.line),
                first.map(|diagnostic| diagnostic.column),
                first.map(|diagnostic| diagnostic.hint.clone()),
                None,
                JsonValue::Null,
                diagnostic_values,
            );
        }
    };

    let limits = EvaluationLimits {
        max_loop_iterations: MAX_LOOP_ITERATIONS,
        max_steps: MAX_STEPS,
        max_call_depth: MAX_CALL_DEPTH,
        max_value_bytes: MAX_VALUE_BYTES,
    };
    let mut evaluator =
        Evaluator::with_input(DenyAllHost, source, SOURCE_NAME, input).with_limits(limits);

    match evaluator.run(&statements) {
        Ok(()) => success_response(evaluator.outputs()),
        Err(error) => runtime_error_response(evaluator.outputs(), &error),
    }
}

fn parse_input(input_json: &str) -> Result<Option<Value>, String> {
    if input_json.is_empty() {
        return Ok(None);
    }
    if input_json.len() > MAX_INPUT_BYTES {
        return Err(error_response(
            "limit_exceeded",
            format!("input exceeded {MAX_INPUT_BYTES} bytes"),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
        ));
    }

    let json_value = serde_json::from_str(input_json).map_err(|error| {
        error_response(
            "input",
            format!("invalid JSON input: {error}"),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
        )
    })?;
    let input = Value::from_json(json_value).map_err(|message| {
        error_response(
            "input",
            message,
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
        )
    })?;
    Ok(Some(input))
}

fn success_response(outputs: &[Value]) -> String {
    json!({
        "contract": CONTRACT,
        "version": CONTRACT_VERSION,
        "ok": true,
        "outputs": output_values(outputs),
        "error": JsonValue::Null,
    })
    .to_string()
}

fn runtime_error_response(outputs: &[Value], error: &RuntimeError) -> String {
    error_response_with_outputs(
        runtime_error_kind(error.kind()),
        error.message().to_string(),
        error.location().map(|location| location.line),
        error.location().map(|location| location.column),
        error.hint().map(str::to_string),
        error.source_line().map(str::to_string),
        capability_json(error.capability()),
        Vec::new(),
        outputs,
    )
}

#[allow(clippy::too_many_arguments)]
fn error_response(
    kind: &str,
    message: String,
    line: Option<usize>,
    column: Option<usize>,
    hint: Option<String>,
    source_line: Option<String>,
    capability: JsonValue,
    diagnostics: Vec<JsonValue>,
) -> String {
    error_response_with_outputs(
        kind,
        message,
        line,
        column,
        hint,
        source_line,
        capability,
        diagnostics,
        &[],
    )
}

#[allow(clippy::too_many_arguments)]
fn error_response_with_outputs(
    kind: &str,
    message: String,
    line: Option<usize>,
    column: Option<usize>,
    hint: Option<String>,
    source_line: Option<String>,
    capability: JsonValue,
    diagnostics: Vec<JsonValue>,
    outputs: &[Value],
) -> String {
    json!({
        "contract": CONTRACT,
        "version": CONTRACT_VERSION,
        "ok": false,
        "outputs": output_values(outputs),
        "error": {
            "kind": kind,
            "message": message,
            "line": line,
            "column": column,
            "hint": hint,
            "source_line": source_line,
            "capability": capability,
            "diagnostics": diagnostics,
        },
    })
    .to_string()
}

fn output_values(outputs: &[Value]) -> Vec<JsonValue> {
    outputs.iter().map(Value::to_json).collect()
}

fn runtime_error_kind(kind: RuntimeErrorKind) -> &'static str {
    match kind {
        RuntimeErrorKind::Evaluation => "evaluation",
        RuntimeErrorKind::CapabilityDenied => "capability_denied",
        RuntimeErrorKind::LimitExceeded => "limit_exceeded",
        RuntimeErrorKind::Host => "host",
    }
}

fn capability_json(capability: Option<&Capability>) -> JsonValue {
    match capability {
        None => JsonValue::Null,
        Some(Capability::Output) => json!({ "kind": "output" }),
        Some(Capability::Network) => json!({ "kind": "network" }),
        Some(Capability::FileRead) => json!({ "kind": "file_read" }),
        Some(Capability::FileWrite) => json!({ "kind": "file_write" }),
        Some(Capability::Environment) => json!({ "kind": "environment" }),
        Some(Capability::Provider) => json!({ "kind": "provider" }),
        Some(Capability::UnknownCall(name)) => json!({
            "kind": "unknown_call",
            "name": name,
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::{MAX_SOURCE_BYTES, run_pure_v1};
    use serde_json::{Value as JsonValue, json};

    fn decode(source: &str, input: &str) -> JsonValue {
        serde_json::from_str(&run_pure_v1(source, input)).expect("wrapper returns valid JSON")
    }

    #[test]
    fn pure_success_is_typed_and_deterministic() {
        let source = "print([1, \"ok\", true])\n";
        let first = run_pure_v1(source, "");
        let second = run_pure_v1(source, "");
        let response: JsonValue = serde_json::from_str(&first).expect("valid JSON response");

        assert_eq!(first, second);
        assert_eq!(response["contract"], "solvelang.run_pure");
        assert_eq!(response["version"], 1);
        assert_eq!(response["ok"], true);
        assert_eq!(response["outputs"], json!([[1, "ok", true]]));
        assert!(response["error"].is_null());
    }

    #[test]
    fn bounded_json_input_uses_the_canonical_value_contract() {
        let response = decode("print(input.name)\n", r#"{"name":"Ada"}"#);

        assert_eq!(response["ok"], true);
        assert_eq!(response["outputs"], json!(["Ada"]));
    }

    #[test]
    fn capability_preflight_denies_before_prior_output() {
        let response = decode(
            "print(\"must not print\")\nprint(http_get(\"https://example.com\"))\n",
            "",
        );

        assert_eq!(response["ok"], false);
        assert_eq!(response["outputs"], json!([]));
        assert_eq!(response["error"]["kind"], "capability_denied");
        assert_eq!(response["error"]["capability"]["kind"], "network");
    }

    #[test]
    fn unreachable_capability_is_still_denied_before_output() {
        let response = decode(
            "if false { print(http_get(\"https://example.com\")) }\nprint(\"safe\")\n",
            "",
        );

        assert_eq!(response["ok"], false);
        assert_eq!(response["outputs"], json!([]));
        assert_eq!(response["error"]["kind"], "capability_denied");
        assert_eq!(response["error"]["capability"]["kind"], "network");
    }

    #[test]
    fn agent_declaration_is_denied_without_provider_authority() {
        let response = decode(
            "agent Helper {\n  instruction \"Answer briefly.\"\n  tool docs\n}\nprint(\"must not print\")\n",
            "",
        );

        assert_eq!(response["ok"], false);
        assert_eq!(response["outputs"], json!([]));
        assert_eq!(response["error"]["kind"], "capability_denied");
        assert_eq!(response["error"]["capability"]["kind"], "provider");
    }

    #[test]
    fn unresolved_call_is_denied_before_output() {
        let response = decode("print(\"must not print\")\nmissing()\n", "");

        assert_eq!(response["ok"], false);
        assert_eq!(response["outputs"], json!([]));
        assert_eq!(response["error"]["kind"], "capability_denied");
        assert_eq!(response["error"]["capability"]["kind"], "unknown_call");
        assert_eq!(response["error"]["capability"]["name"], "missing");
    }

    #[test]
    fn parse_errors_return_source_locations_without_host_paths() {
        let response = decode("let =\n", "");

        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["kind"], "parse");
        assert!(response["error"]["line"].as_u64().is_some());
        assert!(response["error"]["column"].as_u64().is_some());
        assert!(response["error"]["diagnostics"].as_array().is_some());
        assert!(!response.to_string().contains("<browser>"));
    }

    #[test]
    fn pure_runtime_errors_preserve_typed_failure_category() {
        let response = decode("print(1 / 0)\n", "");

        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["kind"], "evaluation");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|message| !message.is_empty())
        );
        assert_eq!(response["error"]["line"], 1);
        assert_eq!(response["error"]["source_line"], "print(1 / 0)");
    }

    #[test]
    fn oversized_source_fails_before_lexing_or_evaluation() {
        let source = "x".repeat(MAX_SOURCE_BYTES + 1);
        let response = decode(&source, "");

        assert_eq!(response["ok"], false);
        assert_eq!(response["outputs"], json!([]));
        assert_eq!(response["error"]["kind"], "limit_exceeded");
        assert_eq!(
            response["error"]["message"],
            format!("source exceeded {MAX_SOURCE_BYTES} bytes")
        );
    }

    #[test]
    fn invalid_or_out_of_range_json_input_fails_before_evaluation() {
        let invalid = decode("print(1)\n", "{");
        let out_of_range = decode("print(1)\n", "2147483648");

        assert_eq!(invalid["error"]["kind"], "input");
        assert_eq!(invalid["outputs"], json!([]));
        assert_eq!(out_of_range["error"]["kind"], "input");
        assert_eq!(out_of_range["outputs"], json!([]));
    }
}
