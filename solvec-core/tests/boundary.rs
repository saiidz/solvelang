use std::{
    fs,
    path::{Path, PathBuf},
};

const FORBIDDEN_HOST_TOKENS: &[&str] = &[
    "reqwest",
    "std::fs",
    "std::env",
    "std::io",
    "std::net",
    "std::process",
    "std::os",
    "std::thread",
    "std::time",
    "print!(",
    "println!(",
    "eprint!(",
    "eprintln!(",
    "dbg!(",
    "std::print",
    "std::eprint",
    "std::dbg",
    "usestd::{",
    "usestdas",
    "externcratestd",
    "#[path",
    "include!",
    "include_bytes!",
    "include_str!",
    "env!(",
    "option_env!(",
    "crate::ai",
    "crate::ast_runtime",
    "crate::module_resolver",
];

fn collect_rust_sources(directory: &Path, sources: &mut Vec<(PathBuf, String)>) {
    for entry in fs::read_dir(directory).expect("read solvec-core source directory") {
        let path = entry.expect("read solvec-core source entry").path();
        if path.is_dir() {
            collect_rust_sources(&path, sources);
        } else if path.extension().and_then(|extension| extension.to_str()) == Some("rs") {
            let source = fs::read_to_string(&path).expect("read solvec-core Rust source");
            sources.push((path, source));
        }
    }
}

fn core_rust_sources() -> Vec<(PathBuf, String)> {
    let mut sources = Vec::new();
    collect_rust_sources(
        &Path::new(env!("CARGO_MANIFEST_DIR")).join("src"),
        &mut sources,
    );
    sources.sort_by(|left, right| left.0.cmp(&right.0));
    sources
}

fn manifest_table_entries<'a>(manifest: &'a str, table: &str) -> Vec<&'a str> {
    let header = format!("[{table}]");
    let mut in_table = false;
    let mut entries = Vec::new();

    for line in manifest.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_table = line == header;
            continue;
        }
        if in_table && !line.is_empty() && !line.starts_with('#') {
            entries.push(line);
        }
    }

    entries
}

fn core_package_contract_is_approved(manifest: &str) -> bool {
    manifest_table_entries(manifest, "package")
        == [
            "name = \"solvec-core\"",
            "version = \"0.1.0\"",
            "edition = \"2024\"",
            "publish = false",
        ]
}

fn core_library_root_is_approved(source: &str) -> bool {
    let Some((public_surface, test_module)) = source.split_once("#[cfg(test)]") else {
        return false;
    };
    let root_items = public_surface
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with("//!"))
        .collect::<Vec<_>>();

    root_items
        == [
            "#![forbid(unsafe_code)]",
            "pub mod ast;",
            "pub mod diagnostics;",
            "pub mod formatter;",
            "pub mod lexer;",
            "pub mod lint;",
            "pub mod parser;",
            "pub mod semantic;",
            "pub mod value;",
        ]
        && !test_module.contains("pub")
}

fn forbidden_host_token(source: &str) -> Option<&'static str> {
    let compact = source
        .chars()
        .filter(|character| !character.is_whitespace())
        .collect::<String>();
    FORBIDDEN_HOST_TOKENS
        .iter()
        .copied()
        .find(|token| compact.contains(token))
}

#[test]
fn library_root_rejects_inline_aliased_or_obscured_host_modules() {
    let source = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("lib.rs"),
    )
    .expect("read solvec-core library root");

    assert!(core_library_root_is_approved(&source));
    for addition in [
        "pub mod ai {}",
        "pub use ast as ai;",
        "pub /* hidden */ mod ai;",
        "macro_rules! expose_ai { () => { pub mod ai {} } }",
    ] {
        let mutated = source.replacen("#[cfg(test)]", &format!("{addition}\n\n#[cfg(test)]"), 1);
        assert!(
            !core_library_root_is_approved(&mutated),
            "core library root accepted forbidden addition {addition:?}"
        );
    }
}

#[test]
fn custom_build_scripts_are_not_an_approved_package_contract() {
    let manifest = r#"[package]
name = "solvec-core"
version = "0.1.0"
edition = "2024"
publish = false
build = "scripts/custom.rs"

[dependencies]
serde_json = "1"
"#;

    assert!(!core_package_contract_is_approved(manifest));
}

#[test]
fn qualified_or_aliased_output_macros_are_rejected() {
    for source in [
        "fn emit() { std::println!(\"x\"); }",
        "use std::println as emit; fn run() { emit!(\"x\"); }",
        "use std::eprintln as emit; fn run() { emit!(\"x\"); }",
        "use std::dbg as emit; fn run() { emit!(1); }",
    ] {
        assert!(
            forbidden_host_token(source).is_some(),
            "core boundary accepted output-capable source {source:?}"
        );
    }
}

#[test]
fn pure_core_source_set_has_no_host_capability_adapters() {
    for (path, source) in core_rust_sources() {
        assert!(
            forbidden_host_token(&source).is_none(),
            "pure core source {} unexpectedly contains host-capability token {:?}",
            path.display(),
            forbidden_host_token(&source)
        );
    }
}

#[test]
fn core_manifest_has_only_the_expected_runtime_dependency() {
    let manifest = fs::read_to_string(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR")))
        .expect("read solvec-core Cargo.toml");
    let tables = manifest
        .lines()
        .map(str::trim)
        .filter(|line| line.starts_with('['))
        .collect::<Vec<_>>();
    assert_eq!(
        tables,
        ["[package]", "[dependencies]"],
        "solvec-core must not add alternate dependency or build-script tables"
    );
    assert_eq!(
        manifest_table_entries(&manifest, "dependencies"),
        ["serde_json = \"1\""],
        "solvec-core must keep an exact direct runtime dependency allowlist"
    );
    assert!(
        core_package_contract_is_approved(&manifest),
        "solvec-core package metadata must remain exact, non-publishable, and build-script-free"
    );
    assert!(
        !Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("build.rs")
            .exists(),
        "solvec-core must not gain an implicit Cargo build script"
    );
}

#[test]
fn native_host_sources_are_not_owned_by_core() {
    let lib = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("lib.rs"),
    )
    .expect("read solvec-core library root");
    assert!(
        core_library_root_is_approved(&lib),
        "solvec-core must retain its exact unsafe-free public module contract"
    );
    assert!(
        !lib.contains("#[path"),
        "solvec-core must not compile source through an external path"
    );

    for forbidden in ["ai.rs", "ast_runtime.rs", "module_resolver.rs"] {
        assert!(
            !Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join(forbidden)
                .exists(),
            "solvec-core unexpectedly owns native host source {forbidden}"
        );
    }
}

#[test]
fn release_candidate_ci_watches_core_sources() {
    let workflow = fs::read_to_string(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join(".github/workflows/release-candidate-ci.yml"),
    )
    .expect("read release candidate workflow");

    assert!(
        workflow.contains("- \"solvec-core/**\""),
        "Release Candidate CI must run when canonical solvec-core sources change"
    );
}
