# SolveLang project completion plan

_Canonical repository-completion checklist. Reconciled 2026-09-01 against `main` at `e4dd69fc38ebfecfc50e539951675bc825b20bec`; live GitHub state always wins if this checkpoint becomes stale._

This plan records repository-safe work only. It does not authorize a deployment, an AWS/IAM/KMS/DNS/Cloudflare mutation, a customer/Admin mutation, email, live Stripe activity, a charge/refund, provider execution, or any audit remediation.

## Source of truth and current queue

- Live GitHub state wins over this document, historical handoffs, and old PR bodies.
- #751 is merged and established the explicit-local-module runtime hardening baseline on `main`.
- #753 is merged and adds bounded opened-document cross-file explicit-module definition, hover, and namespace completion with fail-closed private-export/path/shadowing behavior.
- #754 is merged and defines the repository release contract/changelog boundary.
- #756 is merged and reconciles `SPEC.md` with the implemented explicit local-module contract.
- #758 is merged and adds the first canonical `spec-0.1` explicit-module conformance fixture covering namespace calls, named aliasing, defining-module private scope, live exports, and post-initializer lexical-shadow activation.
- #759 is merged and adds the manifest-driven canonical 0.1 CLI conformance corpus plus `docs/language-conformance.md`, covering every major compatibility section of `SPEC.md` while retaining deeper parser/runtime/CLI edge-case regressions.
- #762 and #764 are merged and establish/harden the non-publishable Linux x86_64 release-candidate path: exact PR-head source identity, pinned read-only workflow actions, locked Rust validation, deterministic version/OS/arch archive packaging, SHA-256 evidence, provenance, double-package byte comparison, and extracted-binary smoke validation. They do **not** publish a tag/release or prove macOS/Windows support.
- ADR 0004 fixes the 0.1 package decision: no local package manifest, bare package resolver, dependency installer, registry, remote fetch, lockfile solver, or semver dependency selection will be added to the 0.1 release line. Any future package design requires a new ADR after the release/CLI and pure-core/WASM boundaries stabilize.
- #723 remains stale/review-blocked Trusted Mac history and must not merge.
- #755 is also stale against current `main`: its exact-head self-hosted Mac attempt was queued while `main` advanced. Do not merge or retrigger that stale head. After the queued attempt is terminal and the one allocated SolveLang Mac slot is demonstrably free, rebuild exactly once on then-current `main` and require fresh Hosted CI + Rust/RustSec + self-hosted Trusted Mac success before superseding #723.
- Production/account/Admin/TOTP facts are tracked separately from repository completion; a merge never acts as production authorization.

## Completed foundations — do not recreate

- Repository Audit / Solve Graph: bounded, static, parse-only analysis; graph search, paths, alternatives, impact, affected validations, MCP surfaces, browser presentation, and local static adapters. Repository mutation/remediation remains disabled.
- Server Audit: bounded, redacted, read-only evidence/reporting and relationship/posture work. Linux collector assumptions are not cross-platform support; remediation remains disabled.
- Language/DX: Rust lexer/parser/AST/interpreter/CLI; conservative `check`/`lint`; formatter; loop control; pure collection helpers; source diagnostics; narrow non-executing LSP and opt-in VS Code support, including bounded cross-file navigation among already-open explicit-module documents through #753.
- Explicit local modules: accepted syntax contract, parser/AST support, deterministic graph resolution, export-surface validation, frozen entry/module source identity, namespace/named imports, live exported values, transactional runtime behavior, exactly-once deterministic initialization, lexical-shadow isolation, cross-workflow state isolation, provenance, and hardened preflight are merged through #746–#751. `SPEC.md` reflects that implementation through #756; #758 adds focused explicit-module fixture evidence; and #759 adds the canonical manifest-driven 0.1 CLI conformance corpus mapped in `docs/language-conformance.md`. Legacy include imports remain a separate compatibility mechanism. ADR 0004 deliberately keeps package manifests, bare package resolution, registries, dependency installation, and remote packages out of 0.1.
- Production foundation: API/accounts/password authentication/Admin/TOTP infrastructure have separate live-state evidence. Billing, paid priority, provider execution, queue processing, and general managed workflow execution remain off unless separately authorized and proven live.

See [active buildout handoff](active-buildout-handoff.md), [roadmap](../ROADMAP.md), [current production status](current-production-status-2026-08-20.md), and the historical [safe-buildout snapshot](full-safe-buildout-completion-2026-08-20.md) for source-specific detail.

## Remaining repository-safe milestones

Each milestone must be a focused PR with a problem statement, scope, safety impact, changed tests, exact validation, compatibility notes, and applicable documentation.

### A. Truth, release, and validation contract

- [ ] Reconcile README, ROADMAP, strategy, handoff, public maturity/status copy, and Issues #157/#113 with live GitHub and production evidence. (`SPEC.md` was reconciled separately through #756; README received a current-truth pass in #760.)
- [x] Mark historical reports as historical instead of silently overwriting their evidence; historical snapshots remain distinct from current truth records.
- [x] Define the release contract for versioning, compatibility surfaces, supported-platform truth, release-candidate gating, checksums/provenance, upgrade notes, rollback/yanking, and the separation between repository releases and production activation in `docs/release-contract.md`.
- [x] Add `CHANGELOG.md` with an explicit Unreleased section and production-boundary disclaimer.
- [ ] Complete the remaining release machinery required by the written contract. #762/#764 complete the non-publishable Linux x86_64 release-candidate archive, SHA-256, provenance, exact-source, deterministic double-package, and smoke-validation path. Still pending: canonical CLI version behavior, final tagged-artifact regeneration/publication controls, and exact-platform evidence for every platform claimed by a release.
- [ ] Create `docs/project-completion-report.md` only when every unchecked repository item below is complete or explicitly blocked by an owner/external decision.

### B. Language contract and modules

- [x] Reconcile `SPEC.md` with the implemented explicit local-module syntax/runtime while keeping legacy flattened includes distinct and remote package/registry behavior explicitly unsupported. Merged through #756.
- [x] Complete fixture-based conformance coverage across the versioned 0.1 specification boundary. #758 establishes the focused explicit-module slice; #759 adds the canonical manifest-driven CLI corpus mapped to every major `SPEC.md` compatibility section in `docs/language-conformance.md`, while deeper edge cases remain pinned by lower-level regressions.
- [x] ADR 0001 defines module identity, local paths, explicit export/import namespaces, deterministic resolution, cycles, duplicate/shadowing rules, legacy-include migration, provenance, diagnostics, hardened-mode/symlink confinement, and the no-network registry boundary.
- [x] Implement the smallest explicit local-module runtime required by the accepted syntax/runtime contract: deterministic local graph, exports, namespace/named imports, fail-before-evaluation validation, transactional initialization/state, provenance, and hardened preflight are merged through #746–#751.
- [x] Decide the 0.1 local package scope. ADR 0004 deliberately defers local package metadata and keeps manifests, bare package specifiers, dependency installation, registries, remote source resolution, lockfile solving, and semver dependency selection out of the 0.1 release line. Any reconsideration requires a new ADR after release/CLI and pure-core/WASM boundaries stabilize.

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
