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

fn core_package_contract_is_approved(manifest: &str) -> bool {
    manifest_table_entries(manifest, "package")
        == [
            "name = \"solvec-core\"",
            "version = \"0.1.0\"",
            "edition = \"2024\"",
            "publish = false",
        ]
}

fn public_module_names(source: &str) -> Vec<&str> {
    let tokens = source.split_whitespace().collect::<Vec<_>>();
    tokens
        .windows(3)
        .filter(|tokens| tokens[0] == "pub" && tokens[1] == "mod")
        .map(|tokens| {
            tokens[2].trim_end_matches(|character: char| {
                !character.is_ascii_alphanumeric() && character != '_'
            })
        })
        .collect()
}

#[test]
fn inline_public_modules_are_included_in_the_export_inventory() {
    assert_eq!(public_module_names("pub mod ai {}"), ["ai"]);
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
        "print!(",
        "println!(",
        "eprint!(",
        "eprintln!(",
        "dbg!(",
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
    let exported_modules = public_module_names(&lib);

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
