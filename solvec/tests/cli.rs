use std::fs;
use std::process::Command;

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
