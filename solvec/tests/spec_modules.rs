use std::fs;
use std::process::Command;

const ADVISORY_LABEL: &str = "NON-PRODUCTION ADVISORY ONLY";

#[test]
fn spec_0_1_explicit_module_fixture_conforms() {
    let mut root = std::env::temp_dir();
    root.push(format!(
        "solvelang_spec_0_1_explicit_modules_{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).expect("failed to create explicit-module fixture directory");

    fs::write(
        root.join("entry.solve"),
        include_str!("fixtures/spec-0.1/modules/entry.solve"),
    )
    .expect("failed to write entry fixture");
    fs::write(
        root.join("math.solve"),
        include_str!("fixtures/spec-0.1/modules/math.solve"),
    )
    .expect("failed to write math fixture");
    fs::write(
        root.join("state.solve"),
        include_str!("fixtures/spec-0.1/modules/state.solve"),
    )
    .expect("failed to write state fixture");

    let entry = root.join("entry.solve");
    let output = Command::new(env!("CARGO_BIN_EXE_solvec"))
        .args(["run", "--safe", entry.to_string_lossy().as_ref()])
        .output()
        .expect("failed to run solvec explicit-module conformance fixture");

    assert!(
        output.status.success(),
        "solvec failed with stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stderr.is_empty());
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        format!("{ADVISORY_LABEL}\n15\n1\n2\n2\n4\n")
    );

    let _ = fs::remove_dir_all(root);
}
