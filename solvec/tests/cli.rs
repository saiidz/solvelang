use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::process::Command;
use std::thread;
use std::time::Duration;

const ADVISORY_LABEL: &str = "NON-PRODUCTION ADVISORY ONLY";

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

fn parse_json_output(stdout: &str) -> serde_json::Value {
    assert_eq!(stdout.matches('\n').count(), 1, "stdout was: {stdout:?}");
    serde_json::from_str(stdout).unwrap_or_else(|error| {
        panic!("stdout was not one JSON document: {error}; stdout={stdout:?}")
    })
}

fn create_temp_workflow_dir(name: &str) -> std::path::PathBuf {
    let mut path = std::env::temp_dir();
    path.push(format!("{}_{}", name, std::process::id()));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).expect("failed to create temp workflow directory");
    path
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
fn safe_mode_executes_array_for_loops() {
    let file = write_temp_solve_file(
        "solvelang_cli_for_loop.solve",
        r#"
let values = [2, 3, 5]
let total = 0
for value in values {
    total = total + value
}
print(total)
"#,
    );

    let output = run_solvec(&["run", "--safe", &file]);

    assert!(output.starts_with(ADVISORY_LABEL));
    assert!(output.contains("10"));
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
fn fmt_writes_a_lossless_canonical_source_and_check_reports_drift() {
    let file = write_temp_solve_file(
        "solvelang_cli_fmt.solve",
        "// preserve this comment\r\nfn add(a,b){\r\nif a>=b{print(\"a\\\\b\\\\n\"..a)}else{print(b)}\r\n}\r\n",
    );

    let before = run_solvec_error(&["fmt", "--check", &file]);
    assert!(before.contains("is not formatted"));

    let output = run_solvec(&["fmt", &file]);
    assert!(output.contains("✓ SolveLang formatting passed"));
    let formatted = fs::read_to_string(&file).expect("formatted source should be readable");
    assert_eq!(
        formatted,
        "// preserve this comment\nfn add(a, b) {\n    if a >= b {\n        print(\"a\\\\b\\\\n\"..a)\n    } else {\n        print(b)\n    }\n}\n"
    );
    assert!(!formatted.contains('\r'));

    let check = run_solvec(&["fmt", "--check", &file]);
    assert!(check.contains("✓ SolveLang formatting check passed"));
    run_solvec(&["validate", &file]);
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
fn check_reports_source_located_semantic_errors_without_execution() {
    let file = write_temp_solve_file(
        "solvelang_cli_semantic_check.solve",
        "let name = \"Ada\"\nprint(name[false])\n",
    );

    let stderr = run_solvec_error(&["check", &file]);

    assert!(stderr.contains("SolveLang Error on line 2, column 12"));
    assert!(stderr.contains("index access requires an array or object"));
}

#[test]
fn check_is_read_only_and_does_not_select_runtime_policy() {
    let file = write_temp_solve_file(
        "solvelang_cli_semantic_no_execution.solve",
        "write_file(\"/definitely/not/written\", \"nope\")\n",
    );
    let (success, stdout, stderr) = run_solvec_with_env(
        &["check", &file],
        &[
            ("SOLVELANG_AI_PROVIDER", "openai"),
            ("OPENAI_API_KEY", "not-a-real-key"),
        ],
        &[],
    );

    assert!(success, "unexpected stderr: {}", stderr);
    assert!(stdout.contains("✓ SolveLang semantic check passed"));
}

#[test]
fn check_remaps_semantic_diagnostics_to_imported_source() {
    let directory = create_temp_workflow_dir("solvelang_semantic_import_provenance");
    let entry = directory.join("entry.solve");
    let imported = directory.join("shared.solve");
    fs::write(&entry, "import \"shared.solve\"\n").unwrap();
    fs::write(&imported, "print(missing)\n").unwrap();

    let stderr = run_solvec_error(&["check", entry.to_str().unwrap()]);

    assert!(stderr.contains("SolveLang Error on line 1, column 7 in shared.solve"));
    assert!(stderr.contains("unknown variable 'missing'"));
}

#[test]
fn lint_reports_source_located_warnings_without_execution() {
    let file = write_temp_solve_file(
        "solvelang_cli_lint_warnings.solve",
        r#"
let done = false
while done {
    print("never")
}
return 1
http_get("http://127.0.0.1:9")
"#,
    );

    let (success, stdout, stderr) = run_solvec_with_status(&["lint", &file]);

    assert!(success, "unexpected stderr: {stderr}");
    assert!(stderr.is_empty(), "unexpected stderr: {stderr}");
    assert!(stdout.contains("SolveLang Warning on line 7, column 1"));
    assert!(stdout.contains("unreachable statement"));
    assert!(stdout.contains("network-capable builtin 'http_get'"));
    assert!(stdout.contains("✓ SolveLang lint completed with 2 warnings"));
}

#[test]
fn lint_remaps_warnings_to_imported_source() {
    let directory = create_temp_workflow_dir("solvelang_lint_import_provenance");
    let entry = directory.join("entry.solve");
    let imported = directory.join("shared.solve");
    fs::write(&entry, "import \"shared.solve\"\n").unwrap();
    fs::write(&imported, "return 1\nprint(\"unreachable\")\n").unwrap();

    let output = run_solvec(&["lint", entry.to_str().unwrap()]);

    assert!(output.contains("SolveLang Warning on line 2, column 1 in shared.solve"));
    assert!(output.contains("unreachable statement"));
}

#[test]
fn imports_report_a_deterministic_root_relative_cycle_chain() {
    let root = create_temp_workflow_dir("solvelang_import_cycle_chain");
    let nested = root.join("nested");
    fs::create_dir_all(&nested).expect("failed to create nested workflow directory");
    let entry = root.join("entry.solve");
    let first = nested.join("first.solve");
    let second = nested.join("second.solve");
    fs::write(&entry, "import \"nested/first.solve\"\n").expect("failed to write entry");
    fs::write(&first, "import \"second.solve\"\n").expect("failed to write first import");
    fs::write(&second, "import \"first.solve\"\n").expect("failed to write second import");

    let stderr = run_solvec_error(&["validate", entry.to_str().unwrap()]);

    assert!(stderr.contains(
        "circular import detected: nested/first.solve -> nested/second.solve -> nested/first.solve"
    ));
    assert!(!stderr.contains(root.to_string_lossy().as_ref()));
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
fn hardened_mode_allows_pure_standard_library_helpers() {
    let file = write_temp_solve_file(
        "solvelang_cli_pure_standard_library.solve",
        r#"
let labels = ["new", "urgent"]
let ticket = { status: "open", labels: labels, count: 2 }
print(length(ticket.labels))
print(contains(labels, "urgent"))
print(get(ticket, "missing", "not-set"))
print(keys(ticket))
print(values(ticket))
print(entries(ticket))
"#,
    );

    let output = run_solvec(&["run", "--safe", &file]);
    assert!(output.contains(ADVISORY_LABEL));
    assert!(output.contains("2\ntrue\nnot-set\n[count, labels, status]\n[2, [new, urgent], open]\n[[count, 2], [labels, [new, urgent]], [status, open]]"));
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
fn hardened_modes_reject_capability_allow_flags_before_source_loading() {
    for args in [
        vec!["run", "--safe", "--allow-env", "missing.solve"],
        vec!["run", "--safe", "--allow-file-write", "missing.solve"],
        vec!["run", "--no-network", "--allow-file-read", "missing.solve"],
        vec!["run", "--no-network", "--allow-env", "missing.solve"],
        vec!["run", "--dry-run", "--allow-network", "missing.solve"],
        vec!["run", "--safe", "--allow-root", "/tmp", "missing.solve"],
    ] {
        let (success, stdout, stderr) = run_solvec_with_status(&args);
        assert!(!success, "unexpected stdout: {stdout}");
        assert!(
            stderr.contains("capability allow flags cannot be used in hardened mode"),
            "stderr was: {stderr}"
        );
        assert!(
            !stderr.contains("failed to resolve"),
            "stderr was: {stderr}"
        );
    }
}

#[test]
fn no_network_rejects_allow_network_before_source_loading() {
    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--no-network", "--allow-network", "missing.solve"]);

    assert!(!success, "unexpected stdout: {stdout}");
    assert!(stderr.contains("capability allow flags cannot be used in hardened mode"));
    assert!(!stderr.contains("failed to resolve"));
}

#[test]
fn allowed_roots_control_unhardened_file_reads_and_writes() {
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

    let output = run_solvec(&["run", "--allow-root", &root_arg, &file]);

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
    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--allow-root", &root_arg, &file]);

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(stderr.contains("outside allowed filesystem roots"));

    let traversal = write_temp_solve_file(
        "solvelang_cli_safe_traversal.solve",
        r#"print(read_file("../secret.txt"))"#,
    );
    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--allow-root", &root_arg, &traversal]);

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
    assert!(
        stderr.contains("agent declarations and tools are disabled by hardened execution policy")
    );
    assert!(!stderr.contains("OPENAI_API_KEY"));
}

#[test]
fn safe_mode_rejects_ask_without_reading_provider_environment() {
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
        &["run", "--safe", &file],
        &[
            ("SOLVELANG_AI_PROVIDER", "openai"),
            ("OPENAI_API_KEY", "not-a-real-key"),
        ],
        &[],
    );

    assert!(!success, "unexpected stdout: {}", stdout);
    assert!(
        stderr.contains("agent declarations and tools are disabled by hardened execution policy")
    );
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

#[test]
fn json_input_and_output_are_typed_deterministic_and_advisory_only() {
    let root = create_temp_workflow_dir("solvelang_json_contract");
    let workflow = root.join("workflow.solve");
    let input = root.join("input.json");
    fs::write(
        &workflow,
        r#"
print("classification prepared")
print({ readiness: input.readiness, count: input.count, active: input.active, delta: input.delta, items: input.items, nested: input.nested })
"#,
    )
    .expect("failed to write workflow");
    fs::write(
        &input,
        r#"{"readiness":"ready","count":7,"active":true,"delta":-4,"items":[1,"two",null],"nested":{"z":1,"a":2}}"#,
    )
    .expect("failed to write input");

    let workflow_arg = workflow.to_string_lossy().to_string();
    let input_arg = input.to_string_lossy().to_string();
    let args = [
        "run",
        "--input",
        input_arg.as_str(),
        "--json",
        "--safe",
        "--dry-run",
        "--no-network",
        workflow_arg.as_str(),
    ];
    let (first_success, first_stdout, first_stderr) = run_solvec_with_status(&args);
    let (second_success, second_stdout, second_stderr) = run_solvec_with_status(&args);

    assert!(first_success, "unexpected stderr: {first_stderr}");
    assert!(second_success, "unexpected stderr: {second_stderr}");
    assert!(first_stderr.is_empty());
    assert!(second_stderr.is_empty());
    assert_eq!(first_stdout, second_stdout);

    let output = parse_json_output(&first_stdout);
    assert_eq!(output["ok"], true);
    assert_eq!(output["advisory"], ADVISORY_LABEL);
    assert_eq!(output["advisory_only"], true);
    assert_eq!(output["dry_run"], true);
    assert_eq!(output["outputs"][0], "classification prepared");
    assert_eq!(output["outputs"][1]["count"], 7);
    assert_eq!(output["outputs"][1]["delta"], -4);
    assert_eq!(output["outputs"][1]["active"], true);
    assert_eq!(output["outputs"][1]["items"][2], serde_json::Value::Null);
    assert_eq!(
        output["outputs"][1]["nested"],
        serde_json::json!({"a": 2, "z": 1})
    );
}

#[test]
fn input_equals_form_is_supported() {
    let root = create_temp_workflow_dir("solvelang_json_input_equals");
    let workflow = root.join("workflow.solve");
    let input = root.join("input.json");
    fs::write(&workflow, "print(input.value)\n").expect("failed to write workflow");
    fs::write(&input, r#"{"value":"equals works"}"#).expect("failed to write input");

    let input_flag = format!("--input={}", input.display());
    let workflow_arg = workflow.to_string_lossy().to_string();
    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        &input_flag,
        "--json",
        "--safe",
        workflow_arg.as_str(),
    ]);

    assert!(success, "unexpected stderr: {stderr}");
    assert_eq!(parse_json_output(&stdout)["outputs"][0], "equals works");
}

#[test]
fn malformed_decimal_and_out_of_range_input_fail_before_imports() {
    let root = create_temp_workflow_dir("solvelang_json_invalid_input");
    let workflow = root.join("workflow.solve");
    fs::write(
        &workflow,
        "import \"missing-before-input-validation.solve\"\nprint(\"source-secret-marker\")\n",
    )
    .expect("failed to write workflow");
    let workflow_arg = workflow.to_string_lossy().to_string();

    for (name, body) in [
        ("malformed", "{not-json"),
        (
            "decimal",
            r#"{"count":1.5,"private":"fixture-secret-marker"}"#,
        ),
        (
            "out_of_range",
            r#"{"count":2147483648,"private":"fixture-secret-marker"}"#,
        ),
    ] {
        let input = root.join(format!("{name}.json"));
        fs::write(&input, body).expect("failed to write invalid input");
        let input_arg = input.to_string_lossy().to_string();
        let (success, stdout, stderr) = run_solvec_with_status(&[
            "run",
            "--json",
            "--safe",
            "--input",
            input_arg.as_str(),
            workflow_arg.as_str(),
        ]);

        assert!(!success, "invalid input unexpectedly succeeded: {name}");
        assert!(stderr.is_empty(), "stderr was: {stderr}");
        let error = parse_json_output(&stdout);
        assert_eq!(error["ok"], false);
        assert_eq!(error["advisory"], ADVISORY_LABEL);
        assert_eq!(error["errors"][0]["code"], "invalid_input");
        assert!(!stdout.contains("missing-before-input-validation"));
        assert!(!stdout.contains("fixture-secret-marker"));
        assert!(!stdout.contains("source-secret-marker"));
        assert!(!stdout.contains(root.to_string_lossy().as_ref()));
    }
}

#[test]
fn oversized_input_fails_closed_before_source_loading() {
    let root = create_temp_workflow_dir("solvelang_json_oversized_input");
    let workflow = root.join("missing-workflow.solve");
    let input = root.join("oversized.json");
    fs::write(&input, vec![b' '; 1_048_577]).expect("failed to write oversized input");

    let workflow_arg = workflow.to_string_lossy().to_string();
    let input_arg = input.to_string_lossy().to_string();
    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--json",
        "--safe",
        "--input",
        input_arg.as_str(),
        workflow_arg.as_str(),
    ]);

    assert!(!success);
    assert!(stderr.is_empty());
    let error = parse_json_output(&stdout);
    assert_eq!(error["errors"][0]["code"], "input_too_large");
    assert!(!stdout.contains("missing-workflow"));
}

#[test]
fn injected_input_is_read_only_and_cannot_be_shadowed() {
    let root = create_temp_workflow_dir("solvelang_json_read_only_input");
    let input = root.join("input.json");
    fs::write(&input, r#"{"value":1}"#).expect("failed to write input");
    let input_arg = input.to_string_lossy().to_string();

    for (name, source) in [
        ("let", "let input = 2\n"),
        ("assign", "input = 2\n"),
        ("parameter", "fn change(input) {\n return input\n}\n"),
    ] {
        let workflow = root.join(format!("{name}.solve"));
        fs::write(&workflow, source).expect("failed to write workflow");
        let workflow_arg = workflow.to_string_lossy().to_string();
        let (success, stdout, stderr) = run_solvec_with_status(&[
            "run",
            "--json",
            "--safe",
            "--dry-run",
            "--input",
            input_arg.as_str(),
            workflow_arg.as_str(),
        ]);

        assert!(!success, "input mutation unexpectedly succeeded: {name}");
        assert!(stderr.is_empty());
        let error = parse_json_output(&stdout);
        assert_eq!(error["errors"][0]["code"], "read_only_input");
    }
}

#[test]
fn json_runtime_failures_are_atomic_and_do_not_echo_source() {
    let root = create_temp_workflow_dir("solvelang_json_atomic_error");
    let workflow = root.join("workflow.solve");
    fs::write(
        &workflow,
        "print(\"partial-output-secret\")\nprint(10 / 0)\n",
    )
    .expect("failed to write workflow");
    let workflow_arg = workflow.to_string_lossy().to_string();

    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--json",
        "--safe",
        "--dry-run",
        workflow_arg.as_str(),
    ]);

    assert!(!success);
    assert!(stderr.is_empty());
    let error = parse_json_output(&stdout);
    assert_eq!(error["ok"], false);
    assert_eq!(error["errors"][0]["code"], "runtime_error");
    assert!(error.get("outputs").is_none());
    assert!(!stdout.contains("partial-output-secret"));
    assert!(!stdout.contains(root.to_string_lossy().as_ref()));
}

#[test]
fn hardened_json_arithmetic_overflow_is_an_atomic_runtime_error() {
    let root = create_temp_workflow_dir("solvelang_json_arithmetic_overflow");
    let input = root.join("input.json");
    fs::write(
        &input,
        r#"{"max":2147483647,"min":-2147483648,"minus_one":-1,"two":2}"#,
    )
    .expect("failed to write input");
    let input_arg = input.to_string_lossy().to_string();

    for (name, expression) in [
        ("add", "input.max + 1"),
        ("subtract", "input.min - 1"),
        ("multiply", "input.max * input.two"),
        ("divide", "input.min / input.minus_one"),
    ] {
        let workflow = root.join(format!("{name}.solve"));
        fs::write(
            &workflow,
            format!(
                "print(\"partial-output-secret\")\nprint({expression})\n// source-secret-marker\n"
            ),
        )
        .expect("failed to write workflow");
        let workflow_arg = workflow.to_string_lossy().to_string();

        let (success, stdout, stderr) = run_solvec_with_status(&[
            "run",
            "--json",
            "--safe",
            "--dry-run",
            "--no-network",
            "--input",
            input_arg.as_str(),
            workflow_arg.as_str(),
        ]);

        assert!(!success, "overflow unexpectedly succeeded: {name}");
        assert!(stderr.is_empty(), "stderr for {name} was: {stderr}");
        let error = parse_json_output(&stdout);
        assert_eq!(error["ok"], false);
        assert_eq!(error["errors"][0]["code"], "runtime_error");
        assert!(error.get("outputs").is_none());
        assert!(!stdout.contains("partial-output-secret"));
        assert!(!stdout.contains("source-secret-marker"));
        assert!(!stdout.contains("2147483647"));
        assert!(!stdout.contains("-2147483648"));
        assert!(!stdout.contains(root.to_string_lossy().as_ref()));
    }
}

#[test]
fn hardened_json_rejects_invalid_source_tokens_atomically() {
    let root = create_temp_workflow_dir("solvelang_json_invalid_tokens");

    for (name, invalid_source, private_fragment) in [
        (
            "integer_overflow",
            "print(\"partial-output-secret\")\nprint(2147483648)\n// source-secret-marker\n",
            "2147483648",
        ),
        (
            "long_integer_overflow",
            "print(\"partial-output-secret\")\nprint(999999999999999999999999999999999999)\n// source-secret-marker\n",
            "999999999999999999999999999999999999",
        ),
        (
            "unknown_character",
            "print(\"partial-output-secret\") @\n// source-secret-marker\n",
            "@",
        ),
    ] {
        let workflow = root.join(format!("{name}.solve"));
        fs::write(&workflow, invalid_source).expect("failed to write invalid workflow");
        let workflow_arg = workflow.to_string_lossy().to_string();

        let (success, stdout, stderr) = run_solvec_with_status(&[
            "run",
            "--json",
            "--safe",
            "--dry-run",
            "--no-network",
            workflow_arg.as_str(),
        ]);

        assert!(!success, "invalid source unexpectedly succeeded: {name}");
        assert!(stderr.is_empty(), "stderr for {name} was: {stderr}");
        let error = parse_json_output(&stdout);
        assert_eq!(error["ok"], false);
        assert_eq!(error["errors"][0]["code"], "invalid_workflow");
        assert!(error.get("outputs").is_none());
        assert!(!stdout.contains("partial-output-secret"));
        assert!(!stdout.contains("source-secret-marker"));
        assert!(!stdout.contains(private_fragment));
        assert!(!stdout.contains(root.to_string_lossy().as_ref()));
    }
}

#[test]
fn invalid_source_tokens_have_source_located_human_diagnostics() {
    let workflow = write_temp_solve_file(
        "solvelang_invalid_token_diagnostics.solve",
        "print(2147483648)\nprint(1) @\n",
    );

    let (success, stdout, stderr) = run_solvec_with_status(&["run", workflow.as_str()]);

    assert!(!success, "invalid source unexpectedly succeeded");
    assert!(stdout.is_empty(), "stdout was: {stdout}");
    assert!(stderr.contains("SolveLang Error on line 1, column 7"));
    assert!(stderr.contains("outside the signed 32-bit integer range"));
    assert!(stderr.contains("SolveLang Error on line 2, column 10"));
    assert!(stderr.contains("unknown character '@'"));
}

#[test]
fn json_mode_is_hardened_and_side_effect_free_without_extra_safety_flags() {
    let root = create_temp_workflow_dir("solvelang_json_implies_hardened");
    let marker = root.join("must-not-exist.txt");
    let workflow = root.join("workflow.solve");
    fs::write(
        &workflow,
        format!(
            "print(\"must-not-be-emitted\")\nif false {{\n write_file(\"{}\", \"created\")\n}}\n",
            marker.display()
        ),
    )
    .expect("failed to write workflow");
    let workflow_arg = workflow.to_string_lossy().to_string();

    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--json", workflow_arg.as_str()]);

    assert!(!success);
    assert!(stderr.is_empty(), "stderr was: {stderr}");
    assert!(!marker.exists());
    let error = parse_json_output(&stdout);
    assert_eq!(error["ok"], false);
    assert_eq!(error["advisory_only"], true);
    assert_eq!(error["errors"][0]["code"], "capability_denied");
    assert!(error.get("outputs").is_none());
    assert!(!stdout.contains("must-not-be-emitted"));
    assert!(!stdout.contains(root.to_string_lossy().as_ref()));
}

#[test]
fn json_mode_rejects_capability_allow_flags_before_source_loading() {
    for allow_flag in ["--allow-network", "--allow-file-write", "--allow-env"] {
        let (success, stdout, stderr) =
            run_solvec_with_status(&["run", "--json", allow_flag, "missing.solve"]);

        assert!(
            !success,
            "capability flag unexpectedly succeeded: {allow_flag}"
        );
        assert!(stderr.is_empty(), "stderr was: {stderr}");
        let error = parse_json_output(&stdout);
        assert_eq!(error["ok"], false);
        assert_eq!(error["errors"][0]["code"], "invalid_arguments");
        assert!(!stdout.contains("missing.solve"));
    }
}

#[test]
fn allow_root_rejects_option_like_values_without_swallowing_safety_flags() {
    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--json", "--allow-root", "--safe", "missing.solve"]);
    assert!(!success, "option-like root unexpectedly succeeded");
    assert!(stderr.is_empty(), "stderr was: {stderr}");
    let error = parse_json_output(&stdout);
    assert_eq!(error["errors"][0]["code"], "invalid_arguments");
    assert!(!stdout.contains("missing.solve"));

    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--allow-root", "--safe", "missing.solve"]);
    assert!(!success, "option-like root unexpectedly succeeded");
    assert!(stdout.contains("SolveLang Compiler"));
    assert!(stderr.contains("--allow-root requires a path"));
    assert!(!stderr.contains("failed to resolve"));
    assert!(!stderr.contains("invalid execution policy"));
}

#[test]
fn every_hardened_human_mode_starts_with_the_advisory_label() {
    let workflow = write_temp_solve_file(
        "solvelang_hardened_human_advisory.solve",
        "print(\"classification prepared\")\n",
    );

    for flag in ["--safe", "--dry-run", "--no-network"] {
        let (success, stdout, stderr) = run_solvec_with_status(&["run", flag, workflow.as_str()]);

        assert!(success, "{flag} failed with stderr: {stderr}");
        assert!(stderr.is_empty());
        assert_eq!(
            stdout.lines().collect::<Vec<_>>(),
            vec![ADVISORY_LABEL, "classification prepared"],
            "stdout for {flag} was: {stdout:?}"
        );
    }
}

#[test]
fn maximum_http_body_limit_is_rejected_before_source_loading() {
    let max = usize::MAX.to_string();
    let option = format!("--http-max-body-bytes={max}");
    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--json", option.as_str(), "missing.solve"]);

    assert!(!success, "overflowing HTTP limit unexpectedly succeeded");
    assert!(stderr.is_empty(), "stderr was: {stderr}");
    let error = parse_json_output(&stdout);
    assert_eq!(error["errors"][0]["code"], "invalid_arguments");
    assert!(!stdout.contains("missing.solve"));
    assert!(!stdout.contains(max.as_str()));
}

#[test]
fn exact_one_mib_input_is_accepted() {
    let root = create_temp_workflow_dir("solvelang_exact_input_limit");
    let input = root.join("input.json");
    let workflow = root.join("workflow.solve");
    let json = format!("\"{}\"", "a".repeat(1_048_576 - 2));
    assert_eq!(json.len(), 1_048_576);
    fs::write(&input, json).expect("failed to write exact-boundary input");
    fs::write(&workflow, "print(\"boundary accepted\")\n").expect("failed to write workflow");
    let input_arg = input.to_string_lossy().to_string();
    let workflow_arg = workflow.to_string_lossy().to_string();

    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--json",
        "--input",
        input_arg.as_str(),
        workflow_arg.as_str(),
    ]);

    assert!(success, "unexpected stderr: {stderr}");
    assert!(stderr.is_empty());
    assert_eq!(
        parse_json_output(&stdout)["outputs"][0],
        "boundary accepted"
    );
}

#[cfg(unix)]
#[test]
fn input_symlinks_fail_closed_without_path_disclosure() {
    use std::os::unix::fs::symlink;

    let root = create_temp_workflow_dir("solvelang_symlink_input");
    let target = root.join("target.json");
    let input = root.join("linked.json");
    let workflow = root.join("workflow.solve");
    fs::write(&target, r#"{"synthetic":true}"#).expect("failed to write target input");
    symlink(&target, &input).expect("failed to create input symlink");
    fs::write(&workflow, "print(\"must-not-run\")\n").expect("failed to write workflow");
    let input_arg = input.to_string_lossy().to_string();
    let workflow_arg = workflow.to_string_lossy().to_string();

    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--json",
        "--input",
        input_arg.as_str(),
        workflow_arg.as_str(),
    ]);

    assert!(!success);
    assert!(stderr.is_empty(), "stderr was: {stderr}");
    let error = parse_json_output(&stdout);
    assert_eq!(error["errors"][0]["code"], "invalid_input");
    assert!(!stdout.contains("must-not-run"));
    assert!(!stdout.contains(root.to_string_lossy().as_ref()));
}

#[test]
fn json_parser_failures_are_one_atomic_sanitized_document() {
    let root = create_temp_workflow_dir("solvelang_json_parser_error");
    let workflow = root.join("workflow.solve");
    fs::write(&workflow, "print(\"source-secret-marker\"\n").expect("failed to write workflow");
    let workflow_arg = workflow.to_string_lossy().to_string();

    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--json",
        "--safe",
        "--dry-run",
        workflow_arg.as_str(),
    ]);

    assert!(!success);
    assert!(stderr.is_empty());
    let error = parse_json_output(&stdout);
    assert_eq!(error["errors"][0]["code"], "invalid_workflow");
    assert!(!stdout.contains("source-secret-marker"));
    assert!(!stdout.contains(root.to_string_lossy().as_ref()));
}

#[test]
fn dry_run_preflights_unreachable_side_effects_before_any_output() {
    let root = create_temp_workflow_dir("solvelang_dry_run_preflight");
    let marker = root.join("must-not-exist.txt");
    let workflow = root.join("workflow.solve");
    fs::write(
        &workflow,
        format!(
            "print(\"must-not-be-emitted\")\nif false {{\n write_file(\"{}\", \"created\")\n}}\n",
            marker.display()
        ),
    )
    .expect("failed to write workflow");
    let workflow_arg = workflow.to_string_lossy().to_string();

    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--json", "--dry-run", workflow_arg.as_str()]);

    assert!(!success);
    assert!(stderr.is_empty());
    assert!(!marker.exists());
    let error = parse_json_output(&stdout);
    assert_eq!(error["errors"][0]["code"], "capability_denied");
    assert!(!stdout.contains("must-not-be-emitted"));
}

#[test]
fn hardened_preflight_rejects_unknown_mutation_tools_and_agent_tools() {
    let root = create_temp_workflow_dir("solvelang_hardened_unsafe_tools");

    for (name, source) in [
        ("call", "if false {\n shell_exec(\"no\")\n}\n"),
        (
            "agent",
            "if false {\n agent Mutator {\n  instruction \"do not run\"\n  tool stripeCharge\n }\n}\n",
        ),
    ] {
        let workflow = root.join(format!("{name}.solve"));
        fs::write(&workflow, source).expect("failed to write workflow");
        let workflow_arg = workflow.to_string_lossy().to_string();
        let (success, stdout, stderr) = run_solvec_with_status(&[
            "run",
            "--json",
            "--safe",
            "--dry-run",
            workflow_arg.as_str(),
        ]);

        assert!(!success, "unsafe workflow unexpectedly succeeded: {name}");
        assert!(stderr.is_empty());
        let error = parse_json_output(&stdout);
        assert_eq!(error["errors"][0]["code"], "capability_denied");
    }
}

#[test]
fn pure_dry_run_evaluates_without_side_effects() {
    let root = create_temp_workflow_dir("solvelang_pure_dry_run");
    let workflow = root.join("workflow.solve");
    fs::write(
        &workflow,
        "fn classify(count) {\n if count > 2 { return \"review\" } else { return \"nurture\" }\n}\nprint(classify(3))\n",
    )
    .expect("failed to write workflow");
    let workflow_arg = workflow.to_string_lossy().to_string();

    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--json",
        "--dry-run",
        "--no-network",
        workflow_arg.as_str(),
    ]);

    assert!(success, "unexpected stderr: {stderr}");
    let output = parse_json_output(&stdout);
    assert_eq!(output["outputs"], serde_json::json!(["review"]));
    assert_eq!(output["dry_run"], true);
}

#[test]
fn no_network_preflights_imported_network_calls_before_execution() {
    let root = create_temp_workflow_dir("solvelang_no_network_import");
    let workflow = root.join("workflow.solve");
    let imported = root.join("network.solve");
    fs::write(
        &workflow,
        "import \"network.solve\"\nprint(\"entry-output\")\n",
    )
    .expect("failed to write workflow");
    fs::write(
        &imported,
        "print(\"import-output\")\nif false {\n http_get(\"http://127.0.0.1:9/private?token=hidden\")\n}\n",
    )
    .expect("failed to write imported workflow");
    let workflow_arg = workflow.to_string_lossy().to_string();

    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--json", "--no-network", workflow_arg.as_str()]);

    assert!(!success);
    assert!(stderr.is_empty());
    let error = parse_json_output(&stdout);
    assert_eq!(error["errors"][0]["code"], "capability_denied");
    assert!(!stdout.contains("entry-output"));
    assert!(!stdout.contains("import-output"));
    assert!(!stdout.contains("token=hidden"));
}

#[test]
fn hardened_import_policy_allows_only_confined_relative_solve_files() {
    let root = create_temp_workflow_dir("solvelang_hardened_imports");
    let confined = root.join("confined");
    fs::create_dir_all(&confined).expect("failed to create confined directory");
    let input = confined.join("input.json");
    fs::write(&input, r#"{"value":"confined"}"#).expect("failed to write input");
    fs::write(confined.join("allowed.solve"), "print(input.value)\n")
        .expect("failed to write imported workflow");
    let entry = confined.join("entry.solve");
    fs::write(&entry, "import \"allowed.solve\"\n").expect("failed to write entry workflow");
    let entry_arg = entry.to_string_lossy().to_string();
    let input_arg = input.to_string_lossy().to_string();

    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--json",
        "--safe",
        "--input",
        input_arg.as_str(),
        entry_arg.as_str(),
    ]);
    assert!(success, "unexpected stderr: {stderr}");
    assert_eq!(parse_json_output(&stdout)["outputs"][0], "confined");

    let outside = root.join("outside.solve");
    fs::write(&outside, "print(\"outside-secret\")\n").expect("failed to write outside file");
    let cases = [
        ("parent", "import \"../outside.solve\"\n".to_string()),
        (
            "absolute",
            format!("import \"{}\"\n", outside.to_string_lossy()),
        ),
        ("extension", "import \"allowed.txt\"\n".to_string()),
    ];

    for (name, source) in cases {
        let workflow = confined.join(format!("{name}.solve"));
        fs::write(&workflow, source).expect("failed to write rejecting workflow");
        let workflow_arg = workflow.to_string_lossy().to_string();
        let (success, stdout, stderr) =
            run_solvec_with_status(&["run", "--json", "--safe", workflow_arg.as_str()]);
        assert!(!success, "unsafe import unexpectedly succeeded: {name}");
        assert!(stderr.is_empty());
        let error = parse_json_output(&stdout);
        assert_eq!(error["errors"][0]["code"], "import_denied");
        assert!(!stdout.contains("outside-secret"));
        assert!(!stdout.contains(root.to_string_lossy().as_ref()));
    }
}

#[cfg(unix)]
#[test]
fn hardened_import_policy_rejects_symlink_escape() {
    use std::os::unix::fs::symlink;

    let root = create_temp_workflow_dir("solvelang_hardened_symlink_import");
    let confined = root.join("confined");
    fs::create_dir_all(&confined).expect("failed to create confined directory");
    let outside = root.join("outside.solve");
    fs::write(&outside, "print(\"outside-secret\")\n").expect("failed to write outside file");
    symlink(&outside, confined.join("linked.solve")).expect("failed to create symlink");
    let entry = confined.join("entry.solve");
    fs::write(&entry, "import \"linked.solve\"\n").expect("failed to write entry");
    let entry_arg = entry.to_string_lossy().to_string();

    let (success, stdout, stderr) =
        run_solvec_with_status(&["run", "--json", "--safe", entry_arg.as_str()]);

    assert!(!success);
    assert!(stderr.is_empty());
    let error = parse_json_output(&stdout);
    assert_eq!(error["errors"][0]["code"], "import_denied");
    assert!(!stdout.contains("outside-secret"));
    assert!(!stdout.contains(root.to_string_lossy().as_ref()));
}

#[test]
fn duplicate_and_misplaced_input_flags_fail_closed_in_json_mode() {
    let root = create_temp_workflow_dir("solvelang_json_input_flags");
    let workflow = root.join("workflow.solve");
    let first = root.join("first.json");
    let second = root.join("second.json");
    fs::write(&workflow, "print(input.value)\n").expect("failed to write workflow");
    fs::write(&first, r#"{"value":1}"#).expect("failed to write input");
    fs::write(&second, r#"{"value":2}"#).expect("failed to write input");
    let workflow_arg = workflow.to_string_lossy().to_string();
    let first_arg = first.to_string_lossy().to_string();
    let second_arg = second.to_string_lossy().to_string();

    let cases = [
        vec![
            "run",
            "--json",
            "--input",
            first_arg.as_str(),
            "--input",
            second_arg.as_str(),
            workflow_arg.as_str(),
        ],
        vec![
            "validate",
            workflow_arg.as_str(),
            "--json",
            "--input",
            first_arg.as_str(),
        ],
    ];

    for args in cases {
        let (success, stdout, stderr) = run_solvec_with_status(&args);
        assert!(!success, "invalid flags unexpectedly succeeded");
        assert!(stderr.is_empty());
        let error = parse_json_output(&stdout);
        assert_eq!(error["ok"], false);
        assert_eq!(error["errors"][0]["code"], "invalid_arguments");
    }
}

#[test]
fn upcomingsounds_cli_contract_example_runs_with_every_hardened_flag() {
    let (success, stdout, stderr) = run_solvec_with_status(&[
        "run",
        "--input",
        "../examples/upcomingsounds/cli-contract-input.json",
        "--json",
        "--safe",
        "--dry-run",
        "--no-network",
        "../examples/upcomingsounds/cli-contract.solve",
    ]);

    assert!(success, "unexpected stderr: {stderr}");
    assert!(stderr.is_empty());
    let output = parse_json_output(&stdout);
    assert_eq!(output["advisory"], ADVISORY_LABEL);
    assert_eq!(output["outputs"][0]["decision"], "review");
    assert_eq!(output["outputs"][0]["owner"], "human-owner");
    assert_eq!(output["outputs"][0]["action_taken"], false);
}
