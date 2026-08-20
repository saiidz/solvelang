use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn temporary_source_path() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "solvelang-hardened-object-helpers-{}-{nonce}.solve",
        std::process::id()
    ))
}

#[test]
fn hardened_cli_allows_pure_object_helpers() {
    let source_path = temporary_source_path();
    fs::write(
        &source_path,
        r#"let ticket = { status: "open", count: 2 }
print(length(keys(ticket)))
print(length(values(ticket)))
"#,
    )
    .expect("write SolveLang fixture");

    let output = Command::new(env!("CARGO_BIN_EXE_solvec"))
        .arg("run")
        .arg("--safe")
        .arg(&source_path)
        .output()
        .expect("run solvec --safe");
    let _ = fs::remove_file(&source_path);

    assert!(
        output.status.success(),
        "solvec --safe rejected pure object helpers: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = String::from_utf8(output.stdout).expect("utf-8 CLI output");
    assert_eq!(
        stdout.lines().filter(|line| line.trim() == "2").count(),
        2,
        "expected keys() and values() results to flow through hardened CLI preflight: {stdout}"
    );
}
