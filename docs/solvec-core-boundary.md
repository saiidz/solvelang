# `solvec-core` pure boundary

`solvec-core` is the host-incapable Rust language core required by ADR 0002. It owns the AST, lexer, parser, diagnostics, formatter, lint, conservative semantics, canonical in-memory values, and deterministic evaluator. The evaluator includes bounded control flow, pure helpers, source-located runtime failures, and transactional language/module value state for already-resolved in-memory module programs.

Agent declarations remain global registry configuration for native compatibility rather than module value state: a declaration completed before a later function failure persists, matching the pre-extraction runtime. Their names, instructions, tools, retained aggregate, preflight allocation work, and invocation clones are still deterministically bounded; provider invocation always remains behind the host capability interface.

Capability-bearing calls cross a typed host interface. The core default is deny-all and preflights the complete program before output, module initialization, or host invocation. Native `solvec` supplies the compatibility adapter and re-exports the pure language modules so existing public Rust paths remain compatible.

The evaluator treats output as a result sink rather than an ambient capability request: values are completely evaluated and bounded before `emit_output`, and hardened preflight still rejects any provably prohibited host request before the first output is delivered. Hosts can retain results, stream them, or reject delivery. Streamed output accounting resets for each incremental run; retained evaluator output remains part of the live value-state limit.

Deterministic resource accounting separates logical live values from structural snapshots. `max_value_bytes` limits live values and each result, value construction work is capped at sixteen times that budget per run, and syntax/source/module metadata have an independent 16 MiB minimum structural ceiling. `max_steps`, `max_loop_iterations`, and `max_call_depth` independently bound evaluation, loop execution, preflight work, syntax nesting, and value nesting. Host adapters receive the remaining response-byte allowance and must enforce it before fully buffering a response; the core validates the returned value again.

Explicitly excluded from `solvec-core` are provider/AI implementations, filesystem-backed module resolution/loading, environment access, HTTP clients, stdout, process/CLI behavior, package registries, browser globals, WASI, and source mutation.

The core currently has one runtime dependency, `serde_json`, because the canonical `Value` conversion contract uses it. Boundary tests reject obvious host-capability references and host-oriented dependencies in the core source set.

`solvec-wasm` is the first browser-targeted boundary over this core. It is a separate, non-publishable, stateless wrapper with a versioned single-source entry point, immutable `DenyAllHost`, bounded in-memory source and JSON input, deterministic typed JSON results, and a locked `wasm32-unknown-unknown` build. It has no native host adapter and is intentionally **not** wired into `/run/`.

Semantic conformance is shared through the strict, versioned `conformance/browser-preview-v1.json` manifest. That manifest is consumed by the Rust wrapper tests, by the unchanged TypeScript `/run/` preview for its deliberately narrow overlap, and by a generated Node binding that executes the actual release `.wasm` artifact. The harness compares typed outputs and stable failure categories rather than human diagnostic wording. Actual-WASM qualification also exercises the fixed source, input, value, step, call-depth, and loop budgets so limit behavior cannot be inferred from a native-only build.

The browser preview is therefore still not canonical and has not been expanded or switched to WASM. The remaining accepted ADR 0002 gate before any browser runtime replacement is a static WASM import/resource audit with browser-target host-surface evidence, artifact-size bounds, and integrity/reproducibility evidence.

No production, managed execution, package registry, filesystem import, network, provider, or source-mutation authority is created by either boundary crate or by the conformance harness.