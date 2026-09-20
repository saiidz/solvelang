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

- Pinned public help/version aliases and added a version-1 hardened JSON envelope/schema. Invalid-argument usage goes to stderr; failures use documented status categories 2–6. See [CLI migration notes](docs/cli-contract.md); all nonzero statuses remain failures.
- Added and hardened deterministic `check`, `lint`, and `fmt` tooling alongside `run`, `validate`, `tokens`, and `ast`.
- Added loop-control and pure collection helpers while preserving hardened-mode denial of host-capability calls.
- Hardened workflow/runtime reuse so prior module/entry state cannot leak into a later execution epoch.
- Preserved source-located diagnostics and graph/preflight validation before user-visible evaluation.
- Replaced the historical TypeScript `/run` execution fallback with the reviewed browser WASM handoff: a pinned, same-origin, hash-verified qualification package loaded through the shared bounded adapter with visible fail-closed behavior. Native `solvec` remains canonical, and this browser path does not enable managed execution.

### Editor tooling

- Added parser-backed local LSP diagnostics, symbols, definition, hover, highlights, completion, semantic tokens, and formatting for opened documents.
- Added explicit-module syntax awareness to the local editor model.
- Added bounded cross-file definition, hover, and namespace completion for explicit modules already open in the LSP document cache, including private-export, URI/path, UTF-16, and lexical-shadow fail-closed behavior.

### Repository and audit products

- Expanded Repository Audit / Solve Graph bounded static analysis, deterministic query/explanation surfaces, affected-validation evidence, MCP integration, and local browser presentation while keeping repository mutation/remediation disabled.
- Expanded Server Audit bounded read-only evidence, relationship, posture, redacted report, and coverage analysis while keeping server mutation/remediation disabled.

### Solve Context / Codex / Claude

Repository source has advanced substantially beyond the last published MCP v0.2.0 line:

- added deterministic `solvelang_context_plan`, `solvelang_context_pack` and `solvelang_context_retrieve` with exact source/excerpt provenance and stale-source rejection;
- added Claude ↔ Codex handoff creation/validation without automatic instruction-file mutation;
- added correctness-first structured JSON/log/diff compaction and exact expansion;
- added changed-path priority and bounded one-hop evidence from an integrity-validated supplied Solve Graph;
- added pinned SolveLang real-source regression fixtures and independently pinned Chalk/node-fetch source subsets;
- added six-category synthetic context-evaluation coverage, including GitHub issue triage and cross-agent handoff fixtures;
- added a strict offline real-agent record/report contract that keeps provider-reported, local-tokenizer, estimated, unavailable and synthetic evidence distinct;
- require all six fixture categories, both Claude and Codex, both handoff directions, provider-reported tokens, measured latency, measured selection precision/recall, measured zero safe-mode cache-hot mutation and no quality regression before benchmark evidence can be complete;
- hardened pair comparability in #920 so baseline and Solve Context arms must share the same fixture/provider/model/agent/record class, outcome-evaluation basis and required-evidence denominator.

No public token-savings percentage or claim of superiority over another context product is established by these repository tests. Real Claude/Codex provider usage, task success, cache behavior and end-to-end latency remain separate measurements.

### MCP distribution truth

- The latest published GitHub MCP Server release remains **v0.2.0 (2026-07-20)**.
- Current repository source contains substantial post-v0.2.0 MCP/Solve Context changes.
- `npm pack`/clean-consumer/plugin-roundtrip CI proves repository release readiness only; it does not mean current-main behavior is already distributed through the v0.2.0 package pin.
- A future versioned MCP/plugin release is required before current-main Solve Context capabilities can be described as publicly distributed.

### Connected support

- Added repository-qualified native IMAP/SMTP support for the existing SolveLang mailbox while retaining Gmail as an optional provider.
- Added tenant/mailbox/secret binding, verified transport contracts, durable event/action/cursor state, safe new-message cutover/recovery, account controls and synthetic integration/concurrency/security coverage.
- Added repository-qualified worker/schedule failure monitoring, unknown-outcome/message-age evidence and state-preserving disable/recovery procedures.
- Deployment, provider credentials, live inbox/task/reply canaries and stop/recovery proof remain separate protected activation gates.

### Account and production foundation

- Repository and separately approved rollout history established customer-account/API/Admin and authenticator-app TOTP infrastructure foundations.
- Production evidence records API access, customer username/email + password accounts, private Admin and TOTP infrastructure as live.
- Subscription billing, paid customer priority/provider execution, support-provider activation, the first live PostHog canary and general managed hosted SolveLang workflow execution remain separately gated and must not be inferred from this changelog.

### Project governance and projection

- Active project tracking is now #898 (Solve Context), #896 (connected support), #833 (PostHog canary) and #113 (production launch); #820 is historical/closed.
- Near-term engineering priority is real Solve Context evidence plus versioned distribution, followed by repository-rule enforcement and separately gated product activation.
- Projections in repository docs are priority direction only; they are not delivery-date promises or unsupported completion percentages.

### Known limitations

- SolveLang remains pre-1.0 and has no 1.0 stability guarantee.
- Browser `/run` is a bounded audited WASM preview, not a managed/server execution surface; native `solvec` remains canonical, and cross-host byte reproducibility is not claimed.
- Remote language packages, registries, dependency installation, and general managed execution are not part of the current local language contract.
- Current CLI release evidence covers Linux x86_64 only. macOS ARM64 and Windows x64 native release support are not established by the repository release gates.
- Current-main Solve Context is not yet represented by a new published MCP version after v0.2.0.
- There is no complete published real-agent Solve Context performance benchmark.
