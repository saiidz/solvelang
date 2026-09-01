# `solvec-core` pure boundary

`solvec-core` is the host-incapable Rust language core required by ADR 0002. It now owns the AST, lexer, parser, diagnostics, formatter, lint, conservative semantics, and canonical in-memory value modules. Native `solvec` depends on the core and re-exports those modules so existing public Rust paths remain compatible.

Explicitly excluded from `solvec-core` are provider/AI code, the host-mixed evaluator in `ast_runtime`, filesystem-backed module resolution/loading, environment access, HTTP, process/CLI behavior, package registries, browser globals, WASI, and source mutation.

The core currently has one runtime dependency, `serde_json`, because the canonical `Value` conversion contract uses it. Boundary tests reject obvious host-capability references and host-oriented dependencies in the core source set.

This source-ownership move still does **not** make the browser preview canonical. The remaining accepted sequence is to split pure evaluation from host adapters, add a deny-all WASM wrapper, run shared native/WASM conformance with deterministic limits, and statically audit the WASM import/resource surface before browser replacement.

No production, managed execution, package registry, filesystem import, network, provider, or source-mutation authority is created by this crate.
