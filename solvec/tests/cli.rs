use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::Command;
use std::thread;
use std::time::Duration;

fn write_temp_solve_file(name: &str, content: &str) -> String {
    let mut path = std::env::temp_dir();
    path.push(name);
    fs::write(&path, content).expect("failed to write temp SolveLang file");
    path.to_string_lossy().to_string()
}

fn run_solvec(args: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_solvec"))
        .args(args)
        .output()
        .expect("failed to run solvec");

    assert!(
        output.status.success(),
        "solvec failed with stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    String::from_utf8_lossy(&output.stdout).to_string()
}

fn run_solvec_error(args: &[&str]) -> String {
    let output = Command::new(env!("CARGO_BIN_EXE_solvec"))
        .args(args)
        .output()
        .expect("failed to run solvec");

    assert!(
        !output.status.success(),
        "solvec unexpectedly succeeded with stdout: {}",
        String::from_utf8_lossy(&output.stdout)
    );

    String::from_utf8_lossy(&output.stderr).to_string()
}

fn run_solvec_with_status(args: &[&str]) -> (bool, String, String) {
    let output = Command::new(env!("CARGO_BIN_EXE_solvec"))
        .args(args)
        .output()
        .expect("failed to run solvec");

    (
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

fn run_solvec_with_env(
    args: &[&str],
    envs: &[(&str, &str)],
    removed_envs: &[&str],
) -> (bool, String, String) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_solvec"));
    command.args(args);

    for name in removed_envs {
        command.env_remove(name);
    }

    for (name, value) in envs {
        command.env(name, value);
    }

    let output = command.output().expect("failed to run solvec");

    (
        output.status.success(),
        String::from_utf8_lossy(&output.stdout).to_string(),
        String::from_utf8_lossy(&output.stderr).to_string(),
    )
}

fn start_local_http_server(body: &'static str, delay_ms: u64) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").expect("failed to bind local test server");
    let address = listener.local_addr().expect("missing local address");

    thread::spawn(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buffer = [0_u8; 1024];
            let _ = stream.read(&mut buffer);

            if delay_ms > 0 {
                thread::sleep(Duration::from_millis(delay_ms));
            }

            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            );
            let _ = stream.write_all(response.as_bytes());
        }
    });

    format!("http://{}", address)
}

#[test]
fn run_executes_math_functions_arrays_loops_and_agents() {
    let file = write_temp_solve_file(
        "solvelang_cli_run.solve",
        r#"
let name = "Saiid"
let x = 10
let y = 5
let names = ["Saiid", "Mira"]

fn add(a, b) {
    return a + b
}

agent SupportBot {
    instruction "Answer clearly."
    tool searchDocs
}

print(add(x, y))
print("Hello, " .. name)
print(names[1])

let count = 1
while count <= 3 {
    print(count)
    let count = count + 1
}

ask SupportBot("Help")
"#,
    );

    let output = run_solvec(&["run", &file]);

    assert!(output.contains("15"));
    assert!(output.contains("Hello, Saiid"));
    assert!(output.contains("Mira"));
    assert!(output.contains("1\n2\n3"));
    assert!(output.contains("[SupportBot AI Agent]"));
}

#[test]
fn tokens_command_prints_lexer_tokens() {
    let file = write_temp_solve_file("solvelang_cli_tokens.solve", "let name = \"Saiid\"\n");
    let output = run_solvec(&["tokens", &file]);

    assert!(output.contains("Let"));
    assert!(output.contains("Identifier"));
    assert!(output.contains("Text"));
}

#[test]
fn ast_command_prints_parser_ast() {
    let file = write_temp_solve_file(
        "solvelang_cli_ast.solve",
        r#"
let names = ["Saiid", "Mira"]
print(names[0])
"#,
    );
    let output = run_solvec(&["ast", &file]);

    assert!(output.contains("Let"));
    assert!(output.contains("Print"));
    assert!(output.contains("Index"));
}

#[test]
fn legacy_command_and_flag_are_removed_from_public_cli() {
    let file = write_temp_solve_file("solvelang_cli_legacy_removed.solve", "print(\"Hello\")\n");

    let legacy_stderr = run_solvec_error(&["legacy", &file]);
    assert!(legacy_stderr.contains("legacy runtime has been removed"));

    let legacy_flag_stderr = run_solvec_error(&[&file, "--legacy"]);
    assert!(legacy_flag_stderr.contains("--legacy has been removed"));
}

#[test]
fn validate_succeeds_for_operator_workflow_examples() {
    for example in [
        "../examples/support_triage.solve",
        "../examples/lead_qualification.solve",
        "../examples/intake_to_task.solve",
        "../examples/ops_report.solve",
    ] {
        let output = run_solvec(&["validate", example]);

        assert!(output.contains("✓ SolveLang validation passed"));
        assert!(output.contains(&format!("file: {}", example)));
    }
}

#[test]
fn validate_reports_syntax_errors() {
    let file = write_temp_solve_file("solvelang_cli_validate_bad_syntax.solve", "let name\n");
    let stderr = run_solvec_error(&["validate", &file]);

    assert!(stderr.contains("SolveLang Error on line 1"));
    assert!(stderr.contains("Invalid variable declaration"));
    assert!(stderr.contains("let name = value"));
}

#[test]
fn validate_does_not_call_ai_provider() {
    let file = write_temp_solve_file(
        "solvelang_cli_validate_agent.solve",
        r#"
agent SupportBot {
    instruction "Answer clearly."
    tool searchDocs
}

ask SupportBot("Help")
"#,
    );
    let (success, stdout, stderr) = run_solvec_with_env(
        &["validate", &file],
        &[
            ("SOLVELANG_AI_PROVIDER", "openai"),
            ("OPENAI_API_KEY", "not-a-real-key"),
        ],
        &[],
    );

    assert!(success, "unexpected stderr: {}", stderr);
    assert!(stdout.contains("✓ SolveLang validation passed"));
    assert!(!stdout.contains("[SupportBot AI Agent]"));
    assert!(stderr.is_empty());
}

#[test]
fn validate_does_not_execute_file_or_http_side_effects() {
    let mut side_effect_path = std::env::temp_dir();
    side_effect_path.push(format!(
        "solvelang_validate_side_effect_{}.txt",
        std::process::id()
    ));
    let _ = fs::remove_file(&side_effect_path);

    let file = write_temp_solve_file(
        "solvelang_cli_validate_side_effects.solve",
        &format!(
            r#"
write_file("{}", "created by runtime")
let response = http_get("http://127.0.0.1:9")
print(response.status)
"#,
            side_effect_path.display()
        ),
    );
    let (success, stdout, stderr) = run_solvec_with_status(&["validate", &file]);

    assert!(success, "unexpected stderr: {}", stderr);
    assert!(stdout.contains("✓ SolveLang validation passed"));
    assert!(
        !side_effect_path.exists(),
        "validate should not run write_file"
    );
}

#[test]
fn validate_exits_nonzero_on_missing_file() {
    let (success, stdout, stderr) =
        run_solvec_with_status(&["validate", "../examples/does-not-exist.solve"]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("failed to resolve"));
}

#[test]
fn backwards_compatible_ast_flag_still_works() {
    let file = write_temp_solve_file("solvelang_cli_flag_ast.solve", "let x = 1\n");
    let output = run_solvec(&[&file, "--ast"]);

    assert!(output.contains("Let"));
}

#[test]
fn invalid_let_statement_reports_line_and_hint() {
    let file = write_temp_solve_file("solvelang_cli_bad_let.solve", "let name\n");
    let stderr = run_solvec_error(&["run", &file]);

    assert!(stderr.contains("SolveLang Error on line 1"));
    assert!(stderr.contains("Invalid variable declaration"));
    assert!(stderr.contains("let name = value"));
}

#[test]
fn unclosed_string_reports_line_and_hint() {
    let file = write_temp_solve_file("solvelang_cli_bad_string.solve", "print(\"Hello)\n");
    let stderr = run_solvec_error(&["run", &file]);

    assert!(stderr.contains("SolveLang Error on line 1"));
    assert!(stderr.contains("Unclosed string literal"));
    assert!(stderr.contains("closing double quote"));
}

#[test]
fn unclosed_block_reports_line_and_hint() {
    let file = write_temp_solve_file(
        "solvelang_cli_bad_block.solve",
        r#"
if true {
    print("yes")
"#,
    );
    let stderr = run_solvec_error(&["run", &file]);

    assert!(stderr.contains("Unclosed block"));
    assert!(stderr.contains("matching closing brace"));
}

#[test]
fn empty_print_expression_reports_parser_error() {
    let file = write_temp_solve_file("solvelang_cli_empty_print.solve", "print()\n");
    let stderr = run_solvec_error(&["run", &file]);

    assert!(stderr.contains("SolveLang Error on line 1, column 7"));
    assert!(stderr.contains("Expected expression"));
    assert!(stderr.contains("number, string, boolean, variable"));
}

#[test]
fn missing_call_paren_reports_parser_error() {
    let file = write_temp_solve_file(
        "solvelang_cli_missing_call_paren.solve",
        "print(add(1, 2)\n",
    );
    let stderr = run_solvec_error(&["run", &file]);

    assert!(stderr.contains("SolveLang Error"));
    assert!(stderr.contains("Invalid print statement: expected ')'"));
    assert!(stderr.contains("Close the print call"));
}

#[test]
fn reassignment_updates_existing_variable() {
    let file = write_temp_solve_file(
        "solvelang_cli_reassign.solve",
        r#"
let x = 0
x = x + 1
print(x)
"#,
    );

    let output = run_solvec(&["run", &file]);

    assert_eq!(output.trim(), "1");
}

#[test]
fn unknown_variable_exits_with_runtime_error() {
    let file = write_temp_solve_file("solvelang_cli_unknown_variable.solve", "print(missing)\n");
    let (success, stdout, stderr) = run_solvec_with_status(&["run", &file]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("unknown variable 'missing'"));
}

#[test]
fn unknown_function_exits_with_runtime_error() {
    let file = write_temp_solve_file("solvelang_cli_unknown_function.solve", "print(nope())\n");
    let (success, stdout, stderr) = run_solvec_with_status(&["run", &file]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("unknown function 'nope'"));
}

#[test]
fn divide_by_zero_exits_with_runtime_error() {
    let file = write_temp_solve_file("solvelang_cli_divide_by_zero.solve", "print(10 / 0)\n");
    let (success, stdout, stderr) = run_solvec_with_status(&["run", &file]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("divide by zero"));
}

#[test]
fn builtin_type_errors_exit_with_runtime_error() {
    let file = write_temp_solve_file("solvelang_cli_bad_builtin.solve", "print(json_parse(1))\n");
    let (success, stdout, stderr) = run_solvec_with_status(&["run", &file]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("json_parse expects a text value"));
}

#[test]
fn file_builtins_read_and_write_temp_files() {
    let mut path = std::env::temp_dir();
    path.push("solvelang_cli_file_builtin.txt");
    let file = write_temp_solve_file(
        "solvelang_cli_file_builtins.solve",
        &format!(
            r#"
write_file("{}", "hello file")
print(read_file("{}"))
"#,
            path.display(),
            path.display()
        ),
    );

    let output = run_solvec(&["run", &file]);

    assert_eq!(output.trim(), "hello file");
}

#[test]
fn http_get_uses_local_http_server_without_external_internet() {
    let url = start_local_http_server("local ok", 0);
    let file = write_temp_solve_file(
        "solvelang_cli_http_get_local.solve",
        &format!(
            r#"
let response = http_get("{}")
print(response.status)
print(response.body)
"#,
            url
        ),
    );

    let output = run_solvec(&["run", &file]);

    assert!(output.contains("200"));
    assert!(output.contains("local ok"));
}

#[test]
fn http_get_reports_network_errors_without_external_internet() {
    let file = write_temp_solve_file(
        "solvelang_cli_http_get_error.solve",
        r#"
print(http_get("http://127.0.0.1:9"))
"#,
    );
    let (success, stdout, stderr) = run_solvec_with_status(&["run", &file]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("http_get failed"));
}

#[test]
fn http_get_times_out_with_readable_runtime_error() {
    let url = start_local_http_server("too late", 500);
    let file = write_temp_solve_file(
        "solvelang_cli_http_timeout.solve",
        &format!(
            r#"
print(http_get("{}"))
"#,
            url
        ),
    );

    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--http-timeout-ms", "100", &file]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("http_get timed out"));
}

#[test]
fn http_get_rejects_oversized_response_body() {
    let url = start_local_http_server("this response is too large", 0);
    let file = write_temp_solve_file(
        "solvelang_cli_http_oversized.solve",
        &format!(
            r#"
print(http_get("{}"))
"#,
            url
        ),
    );

    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--http-max-body-bytes", "8", &file]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("http_get response body exceeded 8 bytes"));
}

#[test]
fn http_post_uses_local_http_server_without_external_internet() {
    let url = start_local_http_server("posted ok", 0);
    let file = write_temp_solve_file(
        "solvelang_cli_http_post_local.solve",
        &format!(
            r#"
let response = http_post("{}", "{{\"hello\":\"world\"}}")
print(response.status)
print(response.body)
"#,
            url
        ),
    );

    let output = run_solvec(&["run", &file]);

    assert!(output.contains("200"));
    assert!(output.contains("posted ok"));
}

#[test]
fn safe_mode_denies_network_file_and_env_builtins() {
    let file = write_temp_solve_file(
        "solvelang_cli_safe_denies_http.solve",
        r#"print(http_get("http://127.0.0.1:9"))"#,
    );
    let (_, _, stderr) = run_solvec_with_status(&["run", "--safe", &file]);
    assert!(stderr.contains("network access is disabled by execution policy"));

    let file = write_temp_solve_file(
        "solvelang_cli_safe_denies_read.solve",
        r#"print(read_file("/tmp/nope.txt"))"#,
    );
    let (_, _, stderr) = run_solvec_with_status(&["run", "--safe", &file]);
    assert!(stderr.contains("file read access is disabled by execution policy"));

    let file = write_temp_solve_file(
        "solvelang_cli_safe_denies_write.solve",
        r#"write_file("/tmp/nope.txt", "no")"#,
    );
    let (_, _, stderr) = run_solvec_with_status(&["run", "--safe", &file]);
    assert!(stderr.contains("file write access is disabled by execution policy"));

    let file = write_temp_solve_file(
        "solvelang_cli_safe_denies_env.solve",
        r#"print(env("SOLVELANG_TEST_SECRET"))"#,
    );
    let (_, _, stderr) = run_solvec_with_env(
        &["run", "--safe", &file],
        &[("SOLVELANG_TEST_SECRET", "secret")],
        &[],
    );
    assert!(stderr.contains("environment-variable access is disabled by execution policy"));
}

#[test]
fn safe_mode_flag_can_follow_filename() {
    let file = write_temp_solve_file(
        "solvelang_cli_safe_after_filename.solve",
        r#"print("safe ordering works")"#,
    );

    let output = run_solvec(&["run", &file, "--safe"]);

    assert!(output.contains("safe ordering works"));
}

#[test]
fn safe_mode_can_allow_env_explicitly() {
    let file = write_temp_solve_file(
        "solvelang_cli_safe_allows_env.solve",
        r#"print(env("SOLVELANG_SAFE_ALLOWED"))"#,
    );
    let (success, stdout, stderr) = run_solvec_with_env(
        &["run", "--safe", "--allow-env", &file],
        &[("SOLVELANG_SAFE_ALLOWED", "visible")],
        &[],
    );

    assert!(success, "unexpected stderr: {}", stderr);
    assert_eq!(stdout.trim(), "visible");
}

#[test]
fn safe_mode_can_allow_network_explicitly() {
    let url = start_local_http_server("safe network ok", 0);
    let file = write_temp_solve_file(
        "solvelang_cli_safe_allows_network.solve",
        &format!(
            r#"
let response = http_get("{}")
print(response.body)
"#,
            url
        ),
    );

    let output = run_solvec(&["run", "--safe", "--allow-network", &file]);

    assert!(output.contains("safe network ok"));
}

#[test]
fn allowed_roots_control_safe_file_reads_and_writes() {
    let mut root = std::env::temp_dir();
    root.push(format!("solvelang_allowed_root_{}", std::process::id()));
    fs::create_dir_all(&root).expect("failed to create allowed root");
    let root_arg = root.to_string_lossy().to_string();

    let input_path = root.join("input.txt");
    let output_path = root.join("output.txt");
    fs::write(&input_path, "allowed content").expect("failed to write input");

    let file = write_temp_solve_file(
        "solvelang_cli_safe_allowed_roots.solve",
        &format!(
            r#"
print(read_file("{}"))
write_file("{}", "created")
"#,
            input_path.display(),
            output_path.display()
        ),
    );

    let output = run_solvec(&[
        "run",
        "--safe",
        "--allow-file-read",
        "--allow-file-write",
        "--allow-root",
        &root_arg,
        &file,
    ]);

    assert!(output.contains("allowed content"));
    assert_eq!(
        fs::read_to_string(&output_path).expect("missing output file"),
        "created"
    );
}

#[test]
fn allowed_roots_reject_paths_outside_root_and_traversal() {
    let mut root = std::env::temp_dir();
    root.push(format!(
        "solvelang_allowed_root_reject_{}",
        std::process::id()
    ));
    fs::create_dir_all(&root).expect("failed to create allowed root");
    let root_arg = root.to_string_lossy().to_string();

    let mut outside = std::env::temp_dir();
    outside.push(format!("solvelang_outside_{}.txt", std::process::id()));
    fs::write(&outside, "outside").expect("failed to write outside file");

    let file = write_temp_solve_file(
        "solvelang_cli_safe_outside_root.solve",
        &format!(r#"print(read_file("{}"))"#, outside.display()),
    );
    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--safe",
        "--allow-file-read",
        "--allow-root",
        &root_arg,
        &file,
    ]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("outside allowed filesystem roots"));

    let traversal = write_temp_solve_file(
        "solvelang_cli_safe_traversal.solve",
        r#"print(read_file("../secret.txt"))"#,
    );
    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--safe",
        "--allow-file-read",
        "--allow-root",
        &root_arg,
        &traversal,
    ]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("path traversal is not allowed"));
}

#[test]
fn safe_mode_denies_ask_before_ai_provider_access() {
    let file = write_temp_solve_file(
        "solvelang_cli_safe_denies_ask.solve",
        r#"
agent SupportBot {
    instruction "Answer clearly."
}

ask SupportBot("Help")
"#,
    );
    let (success, stdout, stderr) = run_solvec_with_env(
        &["run", "--safe", &file],
        &[
            ("SOLVELANG_AI_PROVIDER", "openai"),
            ("OPENAI_API_KEY", "not-a-real-key"),
        ],
        &[],
    );

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("environment-variable access is disabled by execution policy"));
    assert!(!stderr.contains("OPENAI_API_KEY"));
}

#[test]
fn safe_mode_denies_openai_ask_when_network_is_not_allowed() {
    let file = write_temp_solve_file(
        "solvelang_cli_safe_denies_openai_network.solve",
        r#"
agent SupportBot {
    instruction "Answer clearly."
}

ask SupportBot("Help")
"#,
    );
    let (success, stdout, stderr) = run_solvec_with_env(
        &["run", "--safe", "--allow-env", &file],
        &[
            ("SOLVELANG_AI_PROVIDER", "openai"),
            ("OPENAI_API_KEY", "not-a-real-key"),
        ],
        &[],
    );

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("network access is disabled by execution policy"));
}

#[test]
fn runtime_errors_include_source_location_source_line_pointer_and_hint() {
    let file = write_temp_solve_file(
        "solvelang_cli_runtime_location.solve",
        "let items = [\"one\", \"two\"]\nprint(items[8])\n",
    );
    let stderr = run_solvec_error(&["run", &file]);

    assert!(stderr.contains("SolveLang Runtime Error on line 2, column 13"));
    assert!(stderr.contains("2 | print(items[8])"));
    assert!(stderr.contains("^"));
    assert!(stderr.contains("Array index 8 is out of bounds for an array of length 2."));
    assert!(stderr.contains("Hint: Use an index between 0 and 1."));
}

#[test]
fn invalid_arithmetic_and_ordered_comparisons_are_runtime_errors() {
    for (name, source, expected) in [
        (
            "bool_add",
            "print(true + 1)\n",
            "operator '+' requires number operands, got bool and number",
        ),
        (
            "text_subtract",
            "print(\"5\" - 2)\n",
            "operator '-' requires number operands, got text and number",
        ),
        (
            "array_multiply",
            "print([1] * 2)\n",
            "operator '*' requires number operands, got array and number",
        ),
        (
            "invalid_compare",
            "print(\"5\" > 2)\n",
            "operator '>' requires number operands, got text and number",
        ),
    ] {
        let file = write_temp_solve_file(&format!("solvelang_cli_{}.solve", name), source);
        let stderr = run_solvec_error(&["run", &file]);

        assert!(
            stderr.contains("SolveLang Runtime Error"),
            "{} produced stderr: {}",
            name,
            stderr
        );
        assert!(stderr.contains(expected), "stderr was: {}", stderr);
    }
}

#[test]
fn invalid_array_object_property_and_index_access_are_runtime_errors() {
    for (name, source, expected) in [
        (
            "negative_array_index",
            "let negative = 0 - 1\nprint([\"a\"][negative])\n",
            "Array index cannot be negative.",
        ),
        (
            "array_text_index",
            "print([\"a\"][\"zero\"])\n",
            "Array index must be a number, got text.",
        ),
        (
            "object_number_index",
            "print({ answer: 42 }[0])\n",
            "Object index must be text, got number.",
        ),
        (
            "property_on_number",
            "print(1.name)\n",
            "Property access requires an object, got number.",
        ),
        (
            "index_on_bool",
            "print(true[0])\n",
            "Index access requires an array or object, got bool.",
        ),
    ] {
        let file = write_temp_solve_file(&format!("solvelang_cli_{}.solve", name), source);
        let stderr = run_solvec_error(&["run", &file]);

        assert!(
            stderr.contains("SolveLang Runtime Error"),
            "{} produced stderr: {}",
            name,
            stderr
        );
        assert!(stderr.contains(expected), "stderr was: {}", stderr);
    }
}

#[test]
fn function_calls_require_the_declared_argument_count() {
    let file = write_temp_solve_file(
        "solvelang_cli_function_arity.solve",
        r#"
fn route(owner, queue) {
    print(owner .. queue)
}

route("support")
"#,
    );
    let stderr = run_solvec_error(&["run", &file]);

    assert!(stderr.contains("Function 'route' expects 2 arguments but received 1."));
    assert!(stderr.contains("SolveLang Runtime Error on line 6, column 1"));

    let file = write_temp_solve_file(
        "solvelang_cli_function_extra_arity.solve",
        "fn route(owner, queue) {\n    print(owner)\n}\nroute(\"support\", \"priority\", \"extra\")\n",
    );
    let stderr = run_solvec_error(&["run", &file]);
    assert!(stderr.contains("Function 'route' expects 2 arguments but received 3."));
}

#[test]
fn missing_object_properties_remain_null() {
    let file = write_temp_solve_file(
        "solvelang_cli_missing_property.solve",
        "let ticket = { owner: \"support\" }\nprint(ticket.missing)\n",
    );

    assert_eq!(run_solvec(&["run", &file]).trim(), "null");
}

#[test]
fn parser_recovery_reports_one_primary_error_per_malformed_statement() {
    let file = write_temp_solve_file(
        "solvelang_cli_parser_recovery.solve",
        "let first\nprint(\nlet second\nprint(\n",
    );
    let stderr = run_solvec_error(&["validate", &file]);

    assert_eq!(
        stderr.matches("Invalid variable declaration").count(),
        2,
        "stderr was: {}",
        stderr
    );
    assert_eq!(
        stderr.matches("Expected expression").count(),
        2,
        "stderr was: {}",
        stderr
    );
}

#[test]
fn golden_examples_have_deterministic_stdout() {
    for (example, expected) in [
        ("../examples/hello.solve", "Hello, SolveLang\n"),
        ("../examples/functions.solve", "5\nHello, Saiid\n"),
        ("../examples/arrays.solve", "Mira\nNova\n"),
        (
            "../examples/support_triage.solve",
            "Support triage\nCustomer: Acme Labs\nTopic: billing\nAction: escalate to founder today\nOwner: finance operations\n",
        ),
    ] {
        assert_eq!(
            run_solvec(&["run", example]),
            expected,
            "example: {}",
            example
        );
    }

    let (success, stdout, stderr) = run_solvec_with_env(
        &["run", "../examples/agent.solve"],
        &[("SOLVELANG_AI_PROVIDER", "local")],
        &["OPENAI_API_KEY"],
    );
    assert!(success, "unexpected stderr: {}", stderr);
    assert_eq!(
        stdout,
        "[Helper AI Agent]\nInstruction: Answer clearly and briefly using approved tools only.\nTools: docs\nUser: What can SolveLang run today?\nResponse: This is a local SolveLang agent prototype. Connect an AI provider later to generate live answers.\n"
    );
}

#[test]
fn local_ai_provider_keeps_placeholder_response() {
    let file = write_temp_solve_file(
        "solvelang_cli_agent_local.solve",
        r#"
agent SupportBot {
    instruction "Answer clearly using approved tools only."
    tool searchDocs
}

ask SupportBot("How can SolveLang help with automation?")
"#,
    );
    let (success, stdout, stderr) = run_solvec_with_env(
        &["run", &file],
        &[("SOLVELANG_AI_PROVIDER", "local")],
        &["OPENAI_API_KEY", "SOLVELANG_AI_MODEL"],
    );

    assert!(success, "unexpected stderr: {}", stderr);
    assert!(stdout.contains("[SupportBot AI Agent]"));
    assert!(stdout.contains("local SolveLang agent prototype"));
}

#[test]
fn openai_provider_without_api_key_returns_runtime_error() {
    let file = write_temp_solve_file(
        "solvelang_cli_agent_openai_missing_key.solve",
        r#"
agent SupportBot {
    instruction "Answer clearly."
    tool searchDocs
}

ask SupportBot("Help")
"#,
    );
    let (success, stdout, stderr) = run_solvec_with_env(
        &["run", &file],
        &[("SOLVELANG_AI_PROVIDER", "openai")],
        &["OPENAI_API_KEY"],
    );

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("OPENAI_API_KEY is required"));
}

#[test]
fn unknown_ai_provider_returns_runtime_error() {
    let file = write_temp_solve_file(
        "solvelang_cli_agent_unknown_provider.solve",
        r#"
agent SupportBot {
    instruction "Answer clearly."
}

ask SupportBot("Help")
"#,
    );
    let (success, stdout, stderr) = run_solvec_with_env(
        &["run", &file],
        &[("SOLVELANG_AI_PROVIDER", "mystery")],
        &["OPENAI_API_KEY"],
    );

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("SolveLang Runtime Error"));
    assert!(stderr.contains("unknown AI provider 'mystery'"));
}
