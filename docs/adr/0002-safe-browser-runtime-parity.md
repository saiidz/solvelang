# ADR 0002: Safe browser/runtime parity through a pure WASM core

**Status:** Accepted for staged investigation and implementation; no browser or
runtime behavior changes in this ADR.  
**Date:** 2026-08-20

## Context

The Rust CLI is the canonical SolveLang runtime. Its source tree is currently a
binary crate, and its CLI/runtime modules combine pure language work with host
operations: filesystem loading and imports, environment reads, blocking HTTP,
AI-provider configuration, process exit, and CLI argument handling. Its
dependency set includes native-oriented blocking `reqwest`.

The public `/run/` page is intentionally different. It uses a small
TypeScript browser runner that supports only documented `let`, text/number,
`print`, comments, and simple equality `if` blocks. It makes no server call and
rejects unsupported syntax. This avoids exposing host capabilities in the
browser, but duplicated parsing/evaluation can drift from the Rust semantics.

### Current extraction blocker

The repository now exposes a shared `solvec` library for native editor tooling,
but that library is not a browser-safe core: it publicly includes `ai`, keeps
the blocking native `reqwest` dependency, and exposes `ast_runtime`, which
contains filesystem, environment, HTTP, and AI host adapters. Compiling that
crate to WASM would therefore carry host-capable code across the intended
boundary even if a browser wrapper chose a deny-all policy at runtime.

The next implementation prerequisite is a separate dependency-minimal pure
core crate (or equivalent feature split) containing only the deterministic
language subset, with the native adapters left outside its dependency graph.
Until that split exists, shared source fixtures can describe parity but cannot
prove a safe canonical WASM artifact.

Compiling the existing `solvec` binary wholesale to WebAssembly would therefore
be neither a safe parity path nor a small packaging change: the binary has no
browser-targeted library boundary, and its host adapters are not valid browser
dependencies.

## Decision

Preserve the browser preview as a clearly labeled subset until a pure Rust core
can be extracted and proven compatible. Do not add another JavaScript
interpreter, and do not compile or shim native capability code into the browser.

### Target boundary

A future `solvec-core` library may contain only deterministic, in-memory
language behavior:

- lexer, parser, AST, diagnostics, formatter, values, semantic checks, and
  pure-expression/runtime evaluation;
- explicit source text and optional already-parsed input values supplied by the
  caller; and
- no filesystem, network, environment, clock, process, provider, shell,
  plugin, package-resolution, or browser-global access.

Native CLI concerns remain outside that core in host adapters: argument
parsing, entry/import loading, source-root validation, JSON-file admission,
environment/provider configuration, HTTP/file builtins, and stdout/stderr.
The extraction must preserve current CLI behavior and diagnostics before a WASM
wrapper is introduced.

### Browser/WASM contract

The browser wrapper may expose one versioned, pure entry point such as
`runPure(source, input?)`. It must:

- construct an immutable deny-all capability policy;
- reject every capability-bearing builtin, `ask`, agent/tool declaration, and
  unknown call before evaluation, including unreachable code;
- accept source and input only as bounded in-memory data;
- return typed, deterministic output and source-located diagnostics without
  leaking browser-local paths or host details; and
- use no WASI, `fetch`, WebSocket, storage, workers, dynamic code evaluation,
  environment bridge, or JavaScript callback that can perform side effects.

The browser UI remains local-only. Moving pure Rust logic to WASM must not turn
the `/run/` route into hosted execution, authorize imports from user paths, or
relax any existing hardened capability restriction.

### Import and resource boundaries

The first browser core must not accept filesystem imports. Browser callers may
run one in-memory source string only. Local multi-file import parity is deferred
until the module/package design has an explicit bounded virtual-source graph
contract. A browser must never resolve a local path, package, URL, or registry
specifier on its own.

Before enabling a WASM preview, define explicit limits for source bytes, input
bytes, AST/node count, output bytes, recursion/depth, and loop work. Limit
failures must be deterministic and visible to the user. The browser process is
not an operating-system sandbox; the preview must continue to avoid all
side-effect APIs by construction.

### Compatibility and rollout

1. Maintain the current TypeScript preview and its explicit subset disclosure.
2. Add shared, source-based fixtures for the overlap between the preview and
   canonical Rust behavior. Compare success/failure category and typed output,
   not implementation details or byte-for-byte human error copy.
3. Extract and test the pure Rust core behind the existing native CLI. Native
   tests and command behavior must remain green.
4. Build a separate WASM artifact from that core with reproducible toolchain,
   artifact-size budget, integrity metadata, and no host-capability imports.
5. Run the same pure fixtures in browser-targeted tests before switching the
   `/run/` UI. Keep a visible fallback/error state if the artifact cannot load.
6. Only then decide whether the browser preview should grow beyond its current
   subset. Full managed execution remains a separate, owner-controlled product
   decision.

## Consequences

This avoids semantic drift without misrepresenting a browser preview as a
server-hosted or unrestricted Rust runtime. It also makes capability denial an
architectural property of the browser artifact rather than a promise in UI
copy.

The tradeoff is a staged refactor: the current binary crate cannot be reused as
a safe browser artifact unchanged. Browser parity initially covers pure,
single-source execution only; HTTP, file, environment, AI, agents, imports,
and managed execution remain outside the browser contract.

## Implementation evidence required

Any implementation PR must provide:

1. native regression evidence showing the CLI preserves existing semantics;
2. shared positive and negative fixtures for every browser-supported construct;
3. browser tests proving denied calls fail before output, including unreachable
   branches and function bodies;
4. a static artifact/import audit proving no WASI, network, storage, dynamic
   evaluation, or host-capability bridge is present;
5. deterministic resource-limit tests; and
6. visible `/run/` copy that continues to distinguish preview, canonical local
   Rust execution, and unavailable managed execution.
