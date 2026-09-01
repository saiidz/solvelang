use std::fs;

const PURE_SOURCES: &[(&str, &str)] = &[
    ("ast", include_str!("../src/ast.rs")),
    ("diagnostics", include_str!("../src/diagnostics.rs")),
    ("formatter", include_str!("../src/formatter.rs")),
    ("lexer", include_str!("../src/lexer.rs")),
    ("lint", include_str!("../src/lint.rs")),
    ("parser", include_str!("../src/parser.rs")),
    ("semantic", include_str!("../src/semantic.rs")),
    ("value", include_str!("../src/value.rs")),
];

#[test]
fn pure_core_source_set_has_no_host_capability_adapters() {
    let forbidden = [
        "reqwest",
        "std::fs",
        "std::env",
        "std::net",
        "std::process",
        "crate::ai",
        "crate::ast_runtime",
        "crate::module_resolver",
    ];

    for (name, source) in PURE_SOURCES {
        for token in forbidden {
            assert!(
                !source.contains(token),
                "pure core module {name} unexpectedly contains host-capability token {token:?}"
            );
        }
    }
}

#[test]
fn core_manifest_has_only_the_expected_runtime_dependency() {
    let manifest = fs::read_to_string(format!("{}/Cargo.toml", env!("CARGO_MANIFEST_DIR")))
        .expect("read solvec-core Cargo.toml");
    assert!(manifest.contains("serde_json = \"1\""));
    for forbidden in ["reqwest", "tokio", "wasmtime", "wasi", "openai"] {
        assert!(
            !manifest.contains(forbidden),
            "solvec-core manifest contains forbidden dependency marker {forbidden:?}"
        );
    }
}

#[test]
fn native_host_sources_are_not_owned_by_core() {
    for forbidden in ["ai.rs", "ast_runtime.rs", "module_resolver.rs"] {
        assert!(
            !std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src")
                .join(forbidden)
                .exists(),
            "solvec-core unexpectedly owns native host source {forbidden}"
        );
    }
}
