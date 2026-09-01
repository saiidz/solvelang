use std::{
    fs,
    path::{Path, PathBuf},
};

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

#[test]
fn pure_core_source_set_has_no_host_capability_adapters() {
    let forbidden = [
        "reqwest",
        "std::fs",
        "std::env",
        "std::io",
        "std::net",
        "std::process",
        "std::os",
        "std::thread",
        "std::time",
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

    for (path, source) in core_rust_sources() {
        let compact = source
            .chars()
            .filter(|character| !character.is_whitespace())
            .collect::<String>();
        for token in forbidden {
            assert!(
                !compact.contains(token),
                "pure core source {} unexpectedly contains host-capability token {token:?}",
                path.display()
            );
        }
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
        manifest_table_entries(&manifest, "package").contains(&"publish = false"),
        "solvec-core must remain non-publishable"
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
    let exported_modules = lib
        .lines()
        .filter_map(|line| line.trim().strip_prefix("pub mod "))
        .filter_map(|module| module.strip_suffix(';'))
        .collect::<Vec<_>>();

    assert_eq!(
        exported_modules,
        [
            "ast",
            "diagnostics",
            "formatter",
            "lexer",
            "lint",
            "parser",
            "semantic",
            "value"
        ],
        "solvec-core must export only the reviewed pure source modules"
    );
    assert!(
        lib.contains("#![forbid(unsafe_code)]"),
        "solvec-core must forbid unsafe code"
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
