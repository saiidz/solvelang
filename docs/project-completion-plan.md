# SolveLang project completion plan

_Canonical repository-completion checklist. Reconciled 2026-09-01 against `main` at `7938c1a2d39c5cda3a9afdef64ea65f95bb3ed43`; live GitHub state always wins if this checkpoint becomes stale._

This plan records repository-safe work only. It does not authorize a deployment, an AWS/IAM/KMS/DNS/Cloudflare mutation, a customer/Admin mutation, email, live Stripe activity, a charge/refund, provider execution, or any audit remediation.

## Source of truth and current queue

- Live GitHub state wins over this document, historical handoffs, and old PR bodies.
- #751 is merged and established the explicit-local-module runtime hardening baseline on `main`.
- #753 is merged and adds bounded opened-document cross-file explicit-module definition, hover, and namespace completion with fail-closed private-export/path/shadowing behavior.
- #723 remains stale/review-blocked Trusted Mac restoration and must not merge. Do not retrigger it or create a Mac successor until the one allocated SolveLang self-hosted Mac slot is demonstrably free.
- Production/account/Admin/TOTP facts are tracked separately from repository completion; a merge never acts as production authorization.

## Completed foundations — do not recreate

- Repository Audit / Solve Graph: bounded, static, parse-only analysis; graph search, paths, alternatives, impact, affected validations, MCP surfaces, browser presentation, and local static adapters. Repository mutation/remediation remains disabled.
- Server Audit: bounded, redacted, read-only evidence/reporting and relationship/posture work. Linux collector assumptions are not cross-platform support; remediation remains disabled.
- Language/DX: Rust lexer/parser/AST/interpreter/CLI; conservative `check`/`lint`; formatter; loop control; pure collection helpers; source diagnostics; narrow non-executing LSP and opt-in VS Code support, including bounded cross-file navigation among already-open explicit-module documents through #753.
- Explicit local modules: accepted syntax contract, parser/AST support, deterministic graph resolution, export-surface validation, frozen entry/module source identity, namespace/named imports, live exported values, transactional runtime behavior, exactly-once deterministic initialization, lexical-shadow isolation, cross-workflow state isolation, provenance, and hardened preflight are merged through #746–#751. Legacy include imports remain a separate compatibility mechanism. Remote packages/registries and manifest-based dependency resolution are not implemented.
- Production foundation: API/accounts/password authentication/Admin/TOTP infrastructure have separate live-state evidence. Billing, paid priority, provider execution, queue processing, and general managed workflow execution remain off unless separately authorized and proven live.

See [active buildout handoff](active-buildout-handoff.md), [roadmap](../ROADMAP.md), [current production status](current-production-status-2026-08-20.md), and the historical [safe-buildout snapshot](full-safe-buildout-completion-2026-08-20.md) for source-specific detail.

## Remaining repository-safe milestones

Each milestone must be a focused PR with a problem statement, scope, safety impact, changed tests, exact validation, compatibility notes, and applicable documentation.

### A. Truth, release, and validation contract

- [ ] Reconcile README, ROADMAP, SPEC, strategy, handoff, public maturity/status copy, and Issues #157/#113 with live GitHub and production evidence.
- [x] Mark historical reports as historical instead of silently overwriting their evidence; historical snapshots remain distinct from current truth records.
- [x] Define the release contract for versioning, compatibility surfaces, supported-platform truth, release-candidate gating, checksums/provenance, upgrade notes, rollback/yanking, and the separation between repository releases and production activation in `docs/release-contract.md`.
- [x] Add `CHANGELOG.md` with an explicit Unreleased section and production-boundary disclaimer.
- [ ] Implement and validate the release machinery that satisfies the written contract: version command/metadata, reproducible artifact workflow, SHA-256 checksum/provenance output, release-candidate dry run, and exact-platform evidence.
- [ ] Create `docs/project-completion-report.md` only when every unchecked repository item below is complete or explicitly blocked by an owner/external decision.

### B. Language contract and modules

- [ ] Reconcile `SPEC.md` with the now-implemented explicit local-module syntax/runtime. The current draft still describes only legacy flattened includes in several sections and must be corrected before a versioned release.
- [ ] Add fixture-based conformance coverage for every specified behavior. Do not specify unsupported strong typing, concurrency, remote packages, or hosted execution.
- [x] ADR 0001 defines module identity, local paths, explicit export/import namespaces, deterministic resolution, cycles, duplicate/shadowing rules, legacy-include migration, provenance, diagnostics, hardened-mode/symlink confinement, and the no-network registry boundary.
- [x] Implement the smallest explicit local-module runtime required by the accepted syntax/runtime contract: deterministic local graph, exports, namespace/named imports, fail-before-evaluation validation, transactional initialization/state, provenance, and hardened preflight are merged through #746–#751.
- [ ] Decide and implement only the remaining **local package metadata** subset if still desired before 1.0 (bounded inert manifest/package metadata). Bare specifiers, registry resolution, remote fetching, dependency installation, and semver solving remain separate future architecture decisions and are not prerequisites for the current explicit local-module language subset.

### C. Shared Rust core and browser parity

- [ ] Extract a dependency-minimal `solvec-core` with lexer/parser/AST/formatter/conservative semantics/pure evaluation/diagnostics and no host capability.
- [ ] Move filesystem/import loading, environment, network, AI, process, and capability-policy host behavior outside the pure core; keep native CLI wiring separate and behavior-compatible.
- [ ] Add a deny-all `solvec-wasm` wrapper and shared native/WASM conformance corpus for the overlapping safe single-source language subset.
- [ ] Add deterministic source/input/AST/output/work limits and browser tests proving capability-bearing and unknown calls fail before any output, including unreachable code.
- [ ] Audit the WASM artifact/import table so no WASI, network, storage, dynamic-evaluation, provider, filesystem, or side-effect callback bridge is present before replacing the smaller browser preview.

### D. CLI and editor contract

- [ ] Pin public CLI help, exit-code categories, stdout/stderr behavior, JSON envelope/schema, canonical `version` behavior, and command/flag compatibility with fixture-based regression tests.
- [x] Bounded opened-document cross-file module definition/hover/completion with private-export, URI/path, UTF-16, and lexical-shadow correctness is merged through #753.
- [ ] Add later non-executing LSP slices only where evidence justifies them: incremental full-text sync/stale-document protection, bounded workspace/module indexing, cross-file diagnostics/references, safe rename, cancellation/debouncing, and deterministic request identity.
- [ ] Keep editor-triggered execution, network, tools, agents, and source mutation opt-in and disabled by default.

### E. Product safety and operations

- [ ] Close only material static/read-only gaps in Repository Audit/Solve Graph and Server Audit; preserve bounds, redaction, stable IDs, partiality, no source execution, no dependency installation, and no mutation.
- [ ] Finish repository/test-compatible account, Admin, billing, dormant-priority, and operations hardening: session/recovery abuse controls, scopes/revocation/audit trail, webhook ordering/idempotency, entitlement/ledger integrity, queue leases/retries/DLQ/disable controls, restoration/rollback/runbook evidence, and incident/monitoring truth.
- [ ] Run a fresh current-main security review and publish sanitized evidence in `docs/security/current-main-security-review.md`; fix validated findings through separate PRs.
- [ ] Complete only decision checklists for legal/customer-facing commitments where owner or counsel input is required; do not invent commitments.

## Required validation matrix

Run the applicable narrow checks first, then the relevant full suite on the PR head:

| Surface | Required repository validation |
| --- | --- |
| Rust | `cargo audit`, `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, and release build in `solvec/` when the Rust runtime/CLI contract is affected |
| Site/Studio | `npm ci`, `npm run test:studio`, `npm run lint`, `npm run build`, `npm run verify:i18n-export` in `site/` |
| API | locked install, `npm test`, `sam validate --lint`, and `sam build` in the affected service |
| MCP | locked install, `npm test`, and `npm run test:packed` in `packages/mcp-server/` |
| Cross-platform | Trusted Mac or Windows only where the changed contract requires it; neither substitutes for the other |

Hosted CI, Rust/RustSec, reviews, and mergeability must be fresh for the exact proposed head. Queued, missing, skipped, cancelled, stale, or unobserved checks are not success.

## Explicit owner/external gates

The following are not repository-completion work and remain `OWNER APPROVAL REQUIRED` when their repository preparation is complete:

- production deployment or AWS/IAM/KMS/CloudFormation/DNS/Cloudflare/Admin changes;
- TOTP account enrollment/login/backup-code canary or infrastructure change;
- live Stripe configuration, webhook activation, charge, refund, billing enablement, or production provider credentials;
- queue/customer-priority/provider processing activation or production customer-source execution;
- production customer/CRM mutation, email send, credential rotation, or audit remediation;
- final legal/business decisions for terms, privacy, cancellation/refunds, invoices/receipts, support, and retention.

## Completion gate

The repository side is complete only when the truth/release contract and machinery, current implementation-backed language specification/conformance, chosen local package scope, pure-core/WASM parity, CLI/editor guarantees, safe product/operations hardening, current-main security review, public documentation, and required exact-head CI are complete; there are no unresolved P0/P1 engineering findings or blocking review threads; and the only remaining work is listed above as an explicit owner/external gate.
