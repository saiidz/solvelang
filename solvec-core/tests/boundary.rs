use std::fs;

const PURE_SOURCES: &[(&str, &str)] = &[
    ("ast", include_str!("../../solvec/src/ast.rs")),
    ("diagnostics", include_str!("../../solvec/src/diagnostics.rs")),
    ("formatter", include_str!("../../solvec/src/formatter.rs")),
    ("lexer", include_str!("../../solvec/src/lexer.rs")),
    ("lint", include_str!("../../solvec/src/lint.rs")),
    ("parser", include_str!("../../solvec/src/parser.rs")),
    ("semantic", include_str!("../../solvec/src/semantic.rs")),
    ("value", include_str!("../../solvec/src/value.rs")),
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
fn core_crate_does_not_export_host_capable_native_modules() {
    let lib = include_str!("../src/lib.rs");
    for forbidden in ["pub mod ai", "pub mod ast_runtime", "pub mod module_resolver"] {
        assert!(
            !lib.contains(forbidden),
            "solvec-core unexpectedly exports {forbidden:?}"
        );
    }
}
