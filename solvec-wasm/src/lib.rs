#![forbid(unsafe_code)]
//! Browser-targeted, single-source SolveLang wrapper over the host-incapable core.
//!
//! The exported contract is deliberately deny-all and stateless. It accepts only
//! bounded in-memory source plus optional JSON input, performs no host I/O, and
//! powers the public browser preview at /run/.

use serde_json::{Value as JsonValue, json};
use solvec_core::evaluator::{
    Capability, DenyAllHost, EvaluationLimits, Evaluator, RuntimeError, RuntimeErrorKind,
};
use solvec_core::memory_modules::{ModuleError, resolve_memory_modules};
use solvec_core::{lexer, parser::Parser, value::Value};
use std::collections::BTreeMap;

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
/// Full multi-module path budgets (`run_full_v1`): each module may use up to
/// this many source tokens, and the whole submitted module map may use up to
/// [`MAX_FULL_TOTAL_TOKENS`] in total. These replace the pure path's
/// 1,024-token ceiling for multi-file programs while keeping every source
/// bounded and admitted before parsing.
pub const MAX_FULL_MODULE_TOKENS: usize = 16_384;
pub const MAX_FULL_TOTAL_TOKENS: usize = 32_768;
pub const MAX_FULL_MODULES: usize = 32;
pub const MAX_FULL_TOTAL_SOURCE_BYTES: usize = 4_194_304;
pub const MAX_FULL_REQUEST_BYTES: usize = 8_388_608;

const CONTRACT: &str = "solvelang.run_pure";
const FULL_CONTRACT: &str = "solvelang.run_full";
const CONTRACT_VERSION: u8 = 1;
const SOURCE_NAME: &str = "<browser>";

fn source_admitted(tokens: &[lexer::LocatedToken]) -> bool {
    source_admitted_within(tokens, MAX_SOURCE_TOKENS)
}

fn source_admitted_within(tokens: &[lexer::LocatedToken], max_tokens: usize) -> bool {
    if tokens.len() > max_tokens {
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

/// Execute a multi-file SolveLang program held entirely in memory.
///
/// The request is a JSON object:
///
/// ```json
/// {
///   "entry": "main.solve",
///   "files": { "main.solve": "...", "lib/math.solve": "..." },
///   "input": { "name": "Ada" }
/// }
/// ```
///
/// `entry` names the entry module inside `files`; every import resolves
/// against the same in-memory map via
/// [`resolve_memory_modules`], and the resolved [`ModuleProgram`] runs with
/// the same deny-all host policy as `run_pure_v1` — host capabilities stay
/// denied, including unreachable calls. `input` is optional; when present it
/// must be a JSON value representable by the canonical SolveLang [`Value`]
/// contract and is exposed to the entry module as `input`.
///
/// Budgets: at most [`MAX_FULL_MODULES`] modules, [`MAX_SOURCE_BYTES`] per
/// module, [`MAX_FULL_TOTAL_SOURCE_BYTES`] across the map,
/// [`MAX_FULL_MODULE_TOKENS`] tokens per module, and
/// [`MAX_FULL_TOTAL_TOKENS`] tokens across the map; steps, loop, call-depth,
/// syntax-depth, and value budgets match the pure path.
#[cfg_attr(target_arch = "wasm32", wasm_bindgen)]
pub fn run_full_v1(request_json: &str) -> String {
    if request_json.len() > MAX_FULL_REQUEST_BYTES {
        return full_error_response(
            "limit_exceeded",
            format!("request exceeded {MAX_FULL_REQUEST_BYTES} bytes"),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
            None,
        );
    }
    let request: JsonValue = match serde_json::from_str(request_json) {
        Ok(value) => value,
        Err(error) => {
            return full_error_response(
                "input",
                format!("invalid JSON request: {error}"),
                None,
                None,
                None,
                None,
                JsonValue::Null,
                Vec::new(),
                None,
            );
        }
    };
    let Some(object) = request.as_object() else {
        return full_error_response(
            "input",
            "request must be a JSON object".to_string(),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
            None,
        );
    };
    let Some(entry) = object.get("entry").and_then(JsonValue::as_str) else {
        return full_error_response(
            "input",
            "request entry must be a module identity string".to_string(),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
            None,
        );
    };
    let Some(files) = object.get("files").and_then(JsonValue::as_object) else {
        return full_error_response(
            "input",
            "request files must be an object mapping module identities to source text".to_string(),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
            None,
        );
    };
    if files.is_empty() {
        return full_error_response(
            "input",
            "request files must contain at least the entry module".to_string(),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
            None,
        );
    }
    if files.len() > MAX_FULL_MODULES {
        return full_error_response(
            "limit_exceeded",
            format!("module map exceeded {MAX_FULL_MODULES} modules"),
            None,
            None,
            None,
            None,
            JsonValue::Null,
            Vec::new(),
            None,
        );
    }
    let mut sources: BTreeMap<String, String> = BTreeMap::new();
    let mut total_source_bytes = 0usize;
    let mut total_tokens = 0usize;
    for (identity, source_value) in files {
        let Some(source) = source_value.as_str() else {
            return full_error_response(
                "input",
                format!("module '{identity}' source must be a string"),
                None,
                None,
                None,
                None,
                JsonValue::Null,
                Vec::new(),
                Some(identity.clone()),
            );
        };
        if source.len() > MAX_SOURCE_BYTES {
            return full_error_response(
                "limit_exceeded",
                format!("module '{identity}' exceeded {MAX_SOURCE_BYTES} bytes"),
                None,
                None,
                None,
                None,
                JsonValue::Null,
                Vec::new(),
                Some(identity.clone()),
            );
        }
        total_source_bytes += source.len();
        if total_source_bytes > MAX_FULL_TOTAL_SOURCE_BYTES {
            return full_error_response(
                "limit_exceeded",
                format!("module map exceeded {MAX_FULL_TOTAL_SOURCE_BYTES} total source bytes"),
                None,
                None,
                None,
                None,
                JsonValue::Null,
                Vec::new(),
                None,
            );
        }
        let tokens = lexer::lex(source);
        if !source_admitted_within(&tokens, MAX_FULL_MODULE_TOKENS) {
            return full_error_response(
                "limit_exceeded",
                format!(
                    "module '{identity}' exceeded {MAX_FULL_MODULE_TOKENS} tokens or syntax depth {MAX_SYNTAX_DEPTH}"
                ),
                None,
                None,
                None,
                None,
                JsonValue::Null,
                Vec::new(),
                Some(identity.clone()),
            );
        }
        total_tokens += tokens.len();
        if total_tokens > MAX_FULL_TOTAL_TOKENS {
            return full_error_response(
                "limit_exceeded",
                format!("module map exceeded {MAX_FULL_TOTAL_TOKENS} total tokens"),
                None,
                None,
                None,
                None,
                JsonValue::Null,
                Vec::new(),
                None,
            );
        }
        sources.insert(identity.clone(), source.to_string());
    }
    let input = match object.get("input") {
        None => None,
        Some(value) => match Value::from_json(value.clone()) {
            Ok(input) => Some(input),
            Err(message) => {
                return full_error_response(
                    "input",
                    message,
                    None,
                    None,
                    None,
                    None,
                    JsonValue::Null,
                    Vec::new(),
                    None,
                );
            }
        },
    };
    let program = match resolve_memory_modules(entry, &sources) {
        Ok(program) => program,
        Err(error) => return module_error_response(&error, &sources),
    };
    let entry_node = program
        .modules
        .get(&program.entry)
        .expect("resolved module program contains its entry");
    let limits = EvaluationLimits {
        max_loop_iterations: MAX_LOOP_ITERATIONS,
        max_steps: MAX_STEPS,
        max_call_depth: MAX_CALL_DEPTH,
        max_value_bytes: MAX_VALUE_BYTES,
    };
    let mut evaluator =
        Evaluator::with_input(DenyAllHost, &entry_node.source, &program.entry, input)
            .with_limits(limits);
    match evaluator.run_modules(&program) {
        Ok(()) => full_success_response(evaluator.outputs()),
        Err(error) => full_runtime_error_response(evaluator.outputs(), &error),
    }
}

fn module_error_response(error: &ModuleError, sources: &BTreeMap<String, String>) -> String {
    let source_line = sources.get(&error.source).and_then(|source| {
        source
            .lines()
            .nth(error.location.line.saturating_sub(1))
            .map(str::to_string)
    });
    let diagnostic = json!({
        "line": error.location.line,
        "column": error.location.column,
        "message": error.message,
        "module": error.source,
    });
    full_error_response(
        "module",
        error.message.clone(),
        Some(error.location.line),
        Some(error.location.column),
        None,
        source_line,
        JsonValue::Null,
        vec![diagnostic],
        Some(error.source.clone()),
    )
}

fn full_success_response(outputs: &[Value]) -> String {
    json!({
        "contract": FULL_CONTRACT,
        "version": CONTRACT_VERSION,
        "ok": true,
        "outputs": output_values(outputs),
        "error": JsonValue::Null,
    })
    .to_string()
}

fn full_runtime_error_response(outputs: &[Value], error: &RuntimeError) -> String {
    full_error_response_with_outputs(
        runtime_error_kind(error.kind()),
        error.message().to_string(),
        error.location().map(|location| location.line),
        error.location().map(|location| location.column),
        error.hint().map(str::to_string),
        error.source_line().map(str::to_string),
        capability_json(error.capability()),
        Vec::new(),
        outputs,
        None,
    )
}

#[allow(clippy::too_many_arguments)]
fn full_error_response(
    kind: &str,
    message: String,
    line: Option<usize>,
    column: Option<usize>,
    hint: Option<String>,
    source_line: Option<String>,
    capability: JsonValue,
    diagnostics: Vec<JsonValue>,
    module: Option<String>,
) -> String {
    full_error_response_with_outputs(
        kind,
        message,
        line,
        column,
        hint,
        source_line,
        capability,
        diagnostics,
        &[],
        module,
    )
}

#[allow(clippy::too_many_arguments)]
fn full_error_response_with_outputs(
    kind: &str,
    message: String,
    line: Option<usize>,
    column: Option<usize>,
    hint: Option<String>,
    source_line: Option<String>,
    capability: JsonValue,
    diagnostics: Vec<JsonValue>,
    outputs: &[Value],
    module: Option<String>,
) -> String {
    json!({
        "contract": FULL_CONTRACT,
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
            "module": module,
        },
    })
    .to_string()
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

#[cfg(test)]
mod full_tests {
    use super::{MAX_FULL_MODULE_TOKENS, MAX_FULL_TOTAL_TOKENS, run_full_v1};
    use serde_json::{Value as JsonValue, json};

    fn request(entry: &str, files: &[(&str, &str)], input: Option<JsonValue>) -> String {
        let mut map = serde_json::Map::new();
        for (identity, source) in files {
            map.insert(
                (*identity).to_string(),
                JsonValue::String((*source).to_string()),
            );
        }
        let mut request = json!({ "entry": entry, "files": map });
        if let Some(input) = input {
            request["input"] = input;
        }
        request.to_string()
    }

    fn decode(raw: &str) -> JsonValue {
        let response: JsonValue =
            serde_json::from_str(raw).expect("full wrapper returns valid JSON");
        assert_eq!(response["contract"], "solvelang.run_full");
        assert_eq!(response["version"], 1);
        response
    }

    #[test]
    fn full_program_runs_entry_with_named_and_whole_imports() {
        let response = decode(&run_full_v1(&request(
            "main.solve",
            &[
                (
                    "main.solve",
                    "import \"lib/math.solve\" as math\nimport { api_version as value } from \"lib/math.solve\"\nprint(math.add(20, 22))\nprint(value)\n",
                ),
                (
                    "lib/math.solve",
                    "export let api_version = 42\nexport fn add(left, right) { return left + right }\n",
                ),
            ],
            None,
        )));
        assert_eq!(response["ok"], true, "{response}");
        assert_eq!(response["outputs"], json!([42, 42]));
        assert!(response["error"].is_null());
    }

    #[test]
    fn full_program_resolves_relative_to_the_importer_directory() {
        let response = decode(&run_full_v1(&request(
            "app/main.solve",
            &[
                (
                    "app/main.solve",
                    "import { greet } from \"words.solve\"\nprint(greet(\"Ada\"))\n",
                ),
                (
                    "app/words.solve",
                    "export fn greet(name) { return \"hello \" .. name }\n",
                ),
            ],
            None,
        )));
        assert_eq!(response["ok"], true, "{response}");
        assert_eq!(response["outputs"], json!(["hello Ada"]));
    }

    #[test]
    fn full_input_value_reaches_the_entry_module() {
        let response = decode(&run_full_v1(&request(
            "main.solve",
            &[("main.solve", "print(input.name)\n")],
            Some(json!({ "name": "Ada" })),
        )));
        assert_eq!(response["ok"], true, "{response}");
        assert_eq!(response["outputs"], json!(["Ada"]));
    }

    #[test]
    fn full_missing_module_reports_the_importing_module() {
        let response = decode(&run_full_v1(&request(
            "main.solve",
            &[("main.solve", "import \"ghost.solve\" as ghost\n")],
            None,
        )));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["kind"], "module");
        assert_eq!(response["error"]["module"], "main.solve");
        assert!(
            response["error"]["message"].as_str().is_some_and(
                |message| message.contains("failed to resolve explicit module 'ghost.solve'")
            ),
            "{response}"
        );
        assert_eq!(response["error"]["diagnostics"][0]["module"], "main.solve");
    }

    #[test]
    fn full_missing_entry_is_a_module_error() {
        let response = decode(&run_full_v1(&request(
            "ghost.solve",
            &[("main.solve", "print(1)\n")],
            None,
        )));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["kind"], "module");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|message| message.contains("failed to resolve entry source")),
            "{response}"
        );
    }

    #[test]
    fn full_import_cycle_is_a_module_error() {
        let response = decode(&run_full_v1(&request(
            "a.solve",
            &[
                ("a.solve", "import \"b.solve\" as b\n"),
                ("b.solve", "import \"a.solve\" as a\n"),
            ],
            None,
        )));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["kind"], "module");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|message| message.contains("explicit module cycle detected")),
            "{response}"
        );
    }

    #[test]
    fn full_capability_use_inside_an_imported_module_is_denied() {
        let response = decode(&run_full_v1(&request(
            "main.solve",
            &[
                (
                    "main.solve",
                    "import { steal } from \"net.solve\"\nprint(\"must not print\")\nprint(steal())\n",
                ),
                (
                    "net.solve",
                    "export fn steal() { return http_get(\"https://example.com\") }\n",
                ),
            ],
            None,
        )));
        assert_eq!(response["ok"], false);
        assert_eq!(response["outputs"], json!([]));
        assert_eq!(response["error"]["kind"], "capability_denied");
        assert_eq!(response["error"]["capability"]["kind"], "network");
    }

    #[test]
    fn full_single_module_may_exceed_the_pure_token_cap() {
        // ~1,200 tokens of statements: beyond the pure path's 1,024-token
        // ceiling, admitted on the full path.
        let source = "print(1)\n".repeat(300);
        let response = decode(&run_full_v1(&request(
            "main.solve",
            &[("main.solve", &source)],
            None,
        )));
        assert_eq!(response["ok"], true, "{response}");
        assert_eq!(response["outputs"], json!(vec![1; 300]));
    }

    #[test]
    fn full_per_module_token_budget_is_enforced() {
        // 5 tokens per line * 3,500 lines = 17,500 tokens > 16,384.
        let source = "let x = 1\n".repeat(3_500);
        let response = decode(&run_full_v1(&request(
            "main.solve",
            &[("main.solve", &source)],
            None,
        )));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["kind"], "limit_exceeded");
        assert_eq!(response["error"]["module"], "main.solve");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|message| message.contains(&MAX_FULL_MODULE_TOKENS.to_string())),
            "{response}"
        );
    }

    #[test]
    fn full_total_token_budget_is_enforced_across_modules() {
        // ~12,000 tokens per module * 3 = ~36,000 > 32,768 total.
        let filler = "let x = 1\n".repeat(2_400);
        let response = decode(&run_full_v1(&request(
            "main.solve",
            &[
                ("main.solve", &filler),
                ("a.solve", &filler),
                ("b.solve", &filler),
            ],
            None,
        )));
        assert_eq!(response["ok"], false);
        assert_eq!(response["error"]["kind"], "limit_exceeded");
        assert!(
            response["error"]["message"]
                .as_str()
                .is_some_and(|message| message.contains(&MAX_FULL_TOTAL_TOKENS.to_string())),
            "{response}"
        );
    }

    #[test]
    fn full_malformed_requests_are_input_errors() {
        for raw in [
            "not json",
            "{}",
            "{\"entry\":\"main.solve\"}",
            "{\"entry\":7,\"files\":{}}",
            "{\"entry\":\"main.solve\",\"files\":{}}",
            "{\"entry\":\"main.solve\",\"files\":{\"main.solve\":7}}",
        ] {
            let response = decode(&run_full_v1(raw));
            assert_eq!(response["ok"], false, "{raw}");
            assert_eq!(response["error"]["kind"], "input", "{raw}: {response}");
            assert_eq!(response["outputs"], json!([]));
        }
    }

    #[test]
    fn full_responses_are_deterministic() {
        let raw = request(
            "main.solve",
            &[
                (
                    "main.solve",
                    "import { add } from \"math.solve\"\nprint(add(1, 2))\n",
                ),
                ("math.solve", "export fn add(a, b) { return a + b }\n"),
            ],
            None,
        );
        assert_eq!(run_full_v1(&raw), run_full_v1(&raw));
    }
}
