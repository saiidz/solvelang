use std::fs;
use std::process::Command;

const AI_ENV_KEYS: [&str; 3] = [
    "SOLVELANG_AI_PROVIDER",
    "OPENAI_API_KEY",
    "SOLVELANG_AI_MODEL",
];

fn write_temp_solve_file(name: &str, content: &str) -> String {
    let mut path = std::env::temp_dir();
    path.push(name);
    fs::write(&path, content).expect("failed to write temp SolveLang file");
    path.to_string_lossy().to_string()
}

fn run_solvec(args: &[&str]) -> String {
    let mut command = Command::new(env!("CARGO_BIN_EXE_solvec"));
    command.args(args);
    force_local_ai_mode(&mut command);
    let output = command.output().expect("failed to run solvec");

    assert!(
        output.status.success(),
        "solvec failed with stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    String::from_utf8_lossy(&output.stdout).to_string()
}

fn run_solvec_error(args: &[&str]) -> String {
    let mut command = Command::new(env!("CARGO_BIN_EXE_solvec"));
    command.args(args);
    force_local_ai_mode(&mut command);
    let output = command.output().expect("failed to run solvec");

    assert!(
        !output.status.success(),
        "solvec unexpectedly succeeded with stdout: {}",
        String::from_utf8_lossy(&output.stdout)
    );

    String::from_utf8_lossy(&output.stderr).to_string()
}

fn run_solvec_with_status(args: &[&str]) -> (bool, String, String) {
    let mut command = Command::new(env!("CARGO_BIN_EXE_solvec"));
    command.args(args);
    force_local_ai_mode(&mut command);
    let output = command.output().expect("failed to run solvec");

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
    force_local_ai_mode(&mut command);

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

fn force_local_ai_mode(command: &mut Command) {
    for name in AI_ENV_KEYS {
        command.env_remove(name);
    }

    command.env("SOLVELANG_AI_PROVIDER", "local");
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
fn legacy_command_still_runs_old_runtime() {
    let file = write_temp_solve_file("solvelang_cli_legacy.solve", "print(\"Hello\")\n");
    let output = run_solvec(&["legacy", &file]);

    assert!(output.contains("Hello"));
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
