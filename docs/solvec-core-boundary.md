# `solvec-core` pure boundary

`solvec-core` is the first staged extraction toward the accepted browser/WASM architecture in ADR 0002. It is an internal, non-publishable Rust crate whose dependency graph intentionally excludes native host-capability adapters.

This stage shares the existing reviewed source files for AST, lexer, parser, diagnostics, formatter, lint, conservative semantics, and values. The files remain physically under `solvec/src/` temporarily so native behavior cannot drift while the boundary is established. The core crate compiles those modules directly and tests the boundary independently.

Explicitly excluded from `solvec-core`:

- `ai` and provider configuration/calls;
- `ast_runtime`, which still mixes pure evaluation with file/environment/HTTP/provider host adapters;
- `module_resolver`, which performs filesystem-backed module discovery and confinement;
- CLI argument/process/stdout/stderr behavior;
- entry/import filesystem loading;
- browser globals, WASI, network, storage, shell, process, clock, package registry, or remote source behavior.

The crate currently has one runtime dependency, `serde_json`, because the canonical in-memory `Value` conversion contract already uses it. Boundary tests fail if the selected pure source modules gain obvious filesystem/environment/network/process/native-runtime adapter references or if the core manifest gains host-oriented dependencies.

This is **not yet** the final extraction and does not make the browser preview canonical. Next stages must move the shared source ownership into the core, make native `solvec` depend on/re-export it without behavior changes, split pure evaluation from `ast_runtime`, and only then add a deny-all WASM wrapper plus shared native/WASM conformance and static import auditing.

No production, managed execution, package registry, filesystem import, network, provider, or source-mutation authority is created by this crate.
