use std::process::{Command, Output};

fn cli(args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_solvec"))
        .args(args)
        .output()
        .unwrap()
}

#[test]
fn public_help_and_version_aliases_are_pinned() {
    for args in [vec![], vec!["help"], vec!["--help"], vec!["-h"]] {
        let output = cli(&args);
        assert_eq!(output.status.code(), Some(0));
        assert!(output.stderr.is_empty());
        assert_eq!(output.stdout, include_bytes!("fixtures/cli-help.txt"));
    }
    for alias in ["version", "--version", "-V"] {
        let output = cli(&[alias]);
        assert_eq!(output.status.code(), Some(0));
        assert!(output.stderr.is_empty());
        assert_eq!(
            output.stdout,
            format!("solvec {}\n", env!("CARGO_PKG_VERSION")).as_bytes()
        );
    }
}

#[test]
fn usage_errors_do_not_pollute_stdout() {
    for args in [
        vec!["help", "extra"],
        vec!["version", "extra"],
        vec!["run", "--unknown"],
    ] {
        let output = cli(&args);
        assert_eq!(output.status.code(), Some(2));
        assert!(output.stdout.is_empty());
        assert!(String::from_utf8_lossy(&output.stderr).contains("Usage:"));
    }
}

#[test]
fn json_success_and_error_envelopes_are_versioned_and_single_document() {
    for (args, exit, ok) in [
        (
            vec![
                "run",
                "--json",
                "tests/fixtures/conformance/pure-builtins/entry.solve",
            ],
            0,
            true,
        ),
        (vec!["run", "--json", "--unknown"], 2, false),
        (
            vec!["run", "--json", "tests/fixtures/absent.solve"],
            3,
            false,
        ),
        (
            vec![
                "run",
                "--json",
                "tests/fixtures/conformance/invalid-source/entry.solve",
            ],
            4,
            false,
        ),
        (
            vec![
                "run",
                "--json",
                "tests/fixtures/conformance/hardened-json-capability/entry.solve",
            ],
            5,
            false,
        ),
        (
            vec![
                "run",
                "--json",
                "tests/fixtures/conformance/runtime-error/entry.solve",
            ],
            6,
            false,
        ),
    ] {
        let output = cli(&args);
        assert_eq!(output.status.code(), Some(exit), "{args:?}");
        assert!(output.stderr.is_empty(), "{args:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        assert_eq!(text.lines().count(), 1);
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(value["schema"], "solvelang.cli-run");
        assert_eq!(value["version"], 1);
        assert_eq!(value["ok"], ok);
        assert_eq!(value["advisory_only"], true);
        let expected = if ok {
            vec![
                "advisory",
                "advisory_only",
                "dry_run",
                "ok",
                "outputs",
                "schema",
                "version",
            ]
        } else {
            vec![
                "advisory",
                "advisory_only",
                "errors",
                "ok",
                "schema",
                "version",
            ]
        };
        assert_eq!(
            value
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            expected
        );
    }
}
