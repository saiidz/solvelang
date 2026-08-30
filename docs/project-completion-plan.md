# SolveLang project completion plan

_Canonical repository-completion checklist. Reconciled 2026-08-29 against `main` at `a4058bc95898a9c08d507db9472522c5d58a7d3a`._

This plan records repository-safe work only. It does not authorize a deployment, an AWS/IAM/KMS/DNS/Cloudflare mutation, a customer/Admin mutation, email, live Stripe activity, a charge/refund, provider execution, or any audit remediation.

## Source of truth and current queue

- Live GitHub state wins over this document, historical handoffs, and old PR bodies.
- Current open PR queue: [#723](https://github.com/saiidz/solvelang/pull/723) only.
- #723 is blocked, not mergeable for integration: its latest exact-head Trusted Mac run `32904450867` was cancelled after waiting on the self-hosted runner. Hosted CI and Rust/RustSec passed, but neither replaces the required Mac result.
- Do not retrigger #723 or create a successor until one SolveLang self-hosted Mac slot is demonstrably free. Then create one current-main `agent/mac-*` successor, preserve the reviewed workflow behavior, and require fresh exact-head Hosted CI, Rust/RustSec, Trusted Mac, and clean reviews before merging. The cancelled #723 can be closed only after that successor is verified.

## Completed foundations — do not recreate

- Repository Audit / Solve Graph: bounded, static, parse-only analysis; graph search, paths, alternatives, impact, affected validations, MCP surfaces, browser presentation, and local static adapters. Repository mutation/remediation remains disabled.
- Server Audit: bounded, redacted, read-only evidence/reporting and relationship/posture work. Linux collector assumptions are not cross-platform support; remediation remains disabled.
- Language/DX: Rust lexer/parser/AST/interpreter/CLI; conservative `check`/`lint`; formatter; loop control; pure collection helpers; source diagnostics; narrow non-executing LSP and opt-in VS Code support.
- Production foundation: API/accounts/password authentication/Admin/TOTP infrastructure have separate live-state evidence. Billing, paid priority, provider execution, and general managed workflow execution remain off.

See [active buildout handoff](active-buildout-handoff.md), [roadmap](../ROADMAP.md), [current production status](current-production-status-2026-08-20.md), and the historical [safe-buildout snapshot](full-safe-buildout-completion-2026-08-20.md) for source-specific detail.

## Remaining repository-safe milestones

Each milestone must be a focused PR with a problem statement, scope, safety impact, changed tests, exact validation, compatibility notes, and applicable documentation.

### A. Truth, release, and validation contract

- [ ] Reconcile README, ROADMAP, SPEC, strategy, handoff, public maturity/status copy, and Issues #157/#113 with live GitHub and production evidence.
- [ ] Mark historical reports as historical instead of overwriting their evidence.
- [ ] Document the release contract: versioning, CLI/API compatibility, changelog, release checklist, supported-platform matrix, reproducible artifact/checksum/provenance process, and upgrade notes.
- [ ] Create `docs/project-completion-report.md` only when every unchecked repository item below is complete or explicitly blocked by an owner/external decision.

### B. Language contract and modules

- [ ] Replace the placeholder `SPEC.md` with an implementation-backed, versioned language specification covering lexical grammar, values, precedence, control flow, functions, imports, builtins, diagnostics, hardened execution, JSON behavior, and compatibility rules.
- [ ] Add fixture-based conformance coverage for every specified behavior. Do not specify unsupported strong typing, concurrency, remote packages, or hosted execution.
- [x] ADR 0001 defines module identity, local paths, explicit export/import namespaces, manifests, deterministic resolution, cycles, duplicate/shadowing rules, legacy-include migration, provenance, diagnostics, hardened-mode/symlink confinement, and the no-network registry boundary.
- [ ] Implement the smallest complete local module system and conservative static module/import validation against [ADR 0001](adr/0001-local-modules-and-packages.md). Remote fetching remains out of scope.

### C. Shared Rust core and browser parity

- [ ] Extract a dependency-minimal `solvec-core` with lexer/parser/AST/formatter/conservative semantics/pure evaluation/diagnostics and no host capability.
- [ ] Move filesystem/import, environment, network, AI, process, and capability-policy behavior behind host adapters; keep CLI wiring separate.
- [ ] Add a deny-all `solvec-wasm` wrapper and shared native/WASM conformance corpus for the overlapping safe language subset.
- [ ] Preserve browser denial of filesystem, environment, network, tools, agents, process execution, and hidden mutation.

### D. CLI and editor contract

- [ ] Pin public CLI help, exit codes, stdout/stderr, JSON envelope/schema, `version`, and command behavior with fixture-based regression tests.
- [ ] Improve LSP only through non-executing, deterministic editing features: incremental sync, module-aware indexing, cross-file diagnostics/definition/references, safe rename, cancellation/debouncing, and stale-document protection.
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
| Rust | `cargo audit`, `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test` in `solvec/` |
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

The repository side is complete only when the truth/release contract, language specification/conformance, local modules, pure-core/WASM parity, CLI/editor guarantees, safe product/operations hardening, current-main security review, public documentation, and required exact-head CI are complete; there are no unresolved P0/P1 engineering findings or blocking review threads; and the only remaining work is listed above as an explicit owner/external gate.
