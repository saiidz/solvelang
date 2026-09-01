# Changelog

All notable user-visible SolveLang changes are recorded here. The project is pre-1.0; entries under **Unreleased** describe repository state that has not yet been published as a versioned release.

This changelog does not imply that separately gated production services are enabled. Production account/Admin/billing/priority/provider state is tracked by the authoritative production-status and rollout records.

## Unreleased

### Language and modules

- Added implementation-backed explicit local module syntax with `export let`, `export fn`, namespace imports, and named/aliased imports.
- Added deterministic local module graph resolution, canonical root-relative identities, cycle and missing-export validation, and fail-before-evaluation graph checks.
- Added live exported module values, exactly-once deterministic module initialization, transactional rollback behavior, lexical-shadow isolation, cross-module state boundaries, and imported runtime diagnostic provenance.
- Preserved legacy quoted include imports as a distinct compatibility mechanism rather than silently changing them into namespace modules.
- Hardened module resolution against absolute paths, parent traversal, backslash paths, non-`.solve` targets, and root/symlink escapes where the execution contract requires confinement.

### CLI and runtime safety

- Added and hardened deterministic `check`, `lint`, and `fmt` tooling alongside `run`, `validate`, `tokens`, and `ast`.
- Added loop-control and pure collection helpers while preserving hardened-mode denial of host-capability calls.
- Hardened workflow/runtime reuse so prior module/entry state cannot leak into a later execution epoch.
- Preserved source-located diagnostics and graph/preflight validation before user-visible evaluation.

### Editor tooling

- Added parser-backed local LSP diagnostics, symbols, definition, hover, highlights, completion, semantic tokens, and formatting for opened documents.
- Added explicit-module syntax awareness to the local editor model.
- Added bounded cross-file definition, hover, and namespace completion for explicit modules that are already open in the LSP document cache, including private-export, URI/path, UTF-16, and lexical-shadow fail-closed behavior through PR #753.

### Repository and audit products

- Expanded Repository Audit / Solve Graph bounded static analysis, deterministic query/explanation surfaces, MCP integration, and local browser presentation while keeping repository mutation/remediation disabled.
- Expanded Server Audit bounded read-only evidence, relationship, posture, redacted report, and coverage analysis while keeping server mutation/remediation disabled.

### Account and production foundation

- Repository and separately approved rollout history established customer-account/API/Admin and authenticator-app TOTP infrastructure foundations.
- Subscription billing, paid customer priority, provider execution, queue processing, and general managed hosted SolveLang workflow execution remain separately gated and must not be inferred from this changelog.

### Known limitations

- SolveLang remains early beta and has no 1.0 stability guarantee.
- Browser `/run` remains a deliberately smaller TypeScript preview; canonical browser/WASM parity is deferred until the pure Rust core and deny-all WASM boundary are implemented and validated.
- Remote packages, registries, dependency installation, and general managed execution are not part of the current local language contract.
- Trusted Mac restoration PR #723 remains blocked and is not release evidence until a current-main successor receives the required self-hosted Mac validation.
