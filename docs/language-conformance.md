# SolveLang 0.1 language conformance

The canonical fixture corpus lives under `solvec/tests/fixtures/conformance/` and is executed by `solvec/tests/conformance.rs` against the built `solvec` binary. Fixtures are static repository evidence: the harness does not fetch dependencies, call a registry, use production credentials, or authorize host capabilities.

The initial 0.1 corpus deliberately covers every major compatibility section of `SPEC.md` with executable cases while retaining the deeper parser/runtime/CLI unit and integration tests for individual edge cases.

| Spec boundary | Fixture evidence |
| --- | --- |
| UTF-8 source, comments, contextual module words, text escapes | `lexical-contextual` |
| arithmetic, arrays, objects, boolean operators, falsey behavior, functions, `if`, `while`, `for`, `break`, `continue` | `values-control-flow` |
| pure hardened builtins including collection helpers and JSON helpers | `pure-builtins` |
| namespace imports, named imports, explicit exports, private module scope | `explicit-modules` |
| lexical import shadowing and post-initializer activation | `module-shadow` |
| legacy quoted include compatibility | `legacy-include` |
| missing/private export rejection | `module-missing-export` |
| deterministic explicit-module cycle rejection | `module-cycle` |
| explicit-module top-level purity boundary | `module-side-effect` |
| explicit-module path confinement | `module-path-boundary` |
| hardened preflight and atomic JSON failure | `hardened-json-capability` |
| typed JSON input and one-document JSON output | `json-input` |
| source-located runtime failure | `runtime-error` |
| signed 32-bit source-literal boundary | `invalid-source` |

Conformance is cumulative. A future specification change must update or add a fixture and keep the relevant lower-level regression tests. A fixture pass does not imply browser/WASM parity, remote package support, managed execution, production activation, provider access, static typing, or concurrency.
