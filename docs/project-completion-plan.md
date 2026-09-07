# SolveLang project completion plan

_Canonical repository-completion checklist. Reconciled 2026-09-06 against `main` at `2f4e119b623f64829b11a59c1eeabb6da4e6f646` (merge of #848). Live GitHub state always wins if this checkpoint becomes stale._

This plan records repository-safe work only. It does not authorize a deployment, AWS/IAM/KMS/DNS/Cloudflare mutation, customer/Admin mutation, email, live Stripe activity, charge/refund, live provider execution, credential activation, production source execution, or audit remediation.

## Source of truth and current queue

- Live GitHub state wins over this document, historical handoffs, and old PR bodies.
- Current `main`: `2f4e119b623f64829b11a59c1eeabb6da4e6f646`, the merge of #848.
- Open pull requests at this checkpoint: **0**.
- Open issues at this checkpoint: **#113, #820, #833**.
- #820 is the master completion mission. #833 is the separately owner-gated first live PostHog canary. #113 tracks production launch readiness and must not be treated as a repository-merge authorization surface.
- Production/account/Admin/TOTP facts are tracked separately from repository completion. Subscription billing, paid priority, queue/provider processing, general managed hosted execution, and real charges remain off unless separately authorized and proven live.

## Completed foundations — do not recreate

### Language, modules, CLI, and editor

- #746–#751 implement the explicit local-module contract: syntax, bounded local graph resolution, export-surface validation, namespace/named imports, deterministic initialization, transactional state, provenance, lexical-shadow isolation, and hardened preflight.
- #756 reconciles `SPEC.md`; #758/#759 provide focused and manifest-driven 0.1 conformance evidence.
- ADR 0004 deliberately keeps package manifests, bare package resolution, dependency installation, registries, remote source resolution, lock solving, and semver dependency selection out of the 0.1 line.
- #766 implements canonical CLI version behavior.
- #803 pins public CLI help/version aliases, output streams, status categories, and the versioned JSON v1 envelope/schema.
- #753 provides bounded cross-file definition/hover/completion among already-open explicit-module documents.
- #805 adds versioned `didOpen`/full-text `didChange`/`didClose`, monotonic-version enforcement, bounded open-document state, source/token/depth admission, and bounded stdio framing. It does not claim workspace crawling/indexing, rename, or editor-triggered execution.

### Shared Rust core and browser/WASM runtime

- #771/#773 establish the host-incapable `solvec-core` ownership/evaluation boundary and keep filesystem, environment, HTTP/provider, process, CLI, and filesystem-backed loading outside the pure core.
- #775 adds the deny-all `solvec-wasm` wrapper.
- #777 adds shared native/preview/compiled-WASM conformance plus deterministic resource-limit evidence.
- #801 adds the pinned artifact-security audit and compiled-artifact negative cases.
- #819 packages the audited artifact evidence; #827 qualifies the client-only audited loader in real Chrome with exact-source/integrity checks.
- #830 wires `/run` to the reviewed canonical WASM package with visible fail-closed loading and no TypeScript/native/server fallback.
- The browser runtime remains capability-denied and does not establish managed hosted execution, deployment, provider, filesystem, storage, environment, or production authority.

### Release-candidate machinery

- #762/#764 establish the non-publishable Linux x86_64 release-candidate path with exact-source identity, pinned read-only workflow actions, locked Rust validation, deterministic archive naming/bytes, SHA-256 evidence, provenance, two-build byte comparison, and extracted-binary smoke validation.
- #804 hardens candidate regeneration and archive extraction: destinations cannot be destructively reused, archives are inspected before extraction, and unsafe entry types/paths/extras are rejected.
- Existing GitHub `v0.1.0`/`v0.2.0` releases are historical MCP Server releases and are not evidence of a completed modern cross-platform SolveLang CLI/runtime release.

### Repository Audit / Solve Graph

- Repository Audit and Solve Graph are bounded, static/read-only products with graph search, shortest/alternative paths, dependent impact, affected validations, architecture/security summaries, MCP surfaces, browser presentation, local static ecosystem adapters, deterministic IDs, partiality/truncation truth, and no repository-source execution or mutation.
- Continue only material evidence/quality gaps; do not recreate merged trains.

### Server Audit

- Server Audit is a bounded, redacted, read-only evidence/reporting product with relationship/posture analysis and deterministic bounded findings.
- Linux collector assumptions are not a cross-platform support claim. Remote remediation remains disabled.

### CI and trusted runner lanes

- #755 restores the owner-gated single-slot Trusted Mac ARM64 lane on `solve-mac-1` with pinned actions, exact-head verification, read-only permissions, per-ref non-cancelling concurrency, and substantive validation.
- #778/#791 establish Oracle Linux ARM64 smoke/trusted validation as supplemental coverage. Oracle never substitutes for required Mac evidence.
- Trusted Windows remains a separate platform lane where the changed contract requires Windows evidence.
- Solve Runners remains a separate deferred product/security/commercial boundary and must not be folded into Repository Audit or Self-Driving authority.

### Solve Self-Driving

The repository-safe Self-Driving train has advanced materially beyond the September 4 observe-only checkpoint:

- #780/#782/#784/#786/#788 build bounded Solve Inbox, Setup planning, provider-neutral Context, AI/Cost Scouts, and Experience/Incident/Rollout Scouts.
- #790/#793/#795/#797/#799 build the offline PostHog adapter, provider connection policy, exact aggregate query contract, fixture-only transport simulation, and canonical Observe Run composition.
- #806/#808 define and implement disabled-by-default injected fixture coordination with no real credential/network implementation.
- #810/#812/#815/#817 add least-privilege read-only provider policy, deterministic PostHog GET planning, injected GET-only transport, and sanitized Observe composition.
- #823/#826/#829/#832 add bounded PostHog error/feature-flag sanitizers, corrected first-page request contracts, and reviewed sanitizer composition.
- #834 defines the owner-gated one-request live-canary contract without activation.
- #836 adds deterministic review-only Suggest plans.
- #840 adds bounded non-applied patch previews.
- #842 binds patch previews to caller-supplied validation evidence and computes review readiness without executing validation itself.
- #844 adds no-write PR authorization preflight: exact repo/base/head/policy evidence and planned branch/commit/PR permissions are represented, but GitHub writes are not executed.
- #838 adds atomic single-use canary approval claims.
- #846 adds canary evidence lifecycle/finalization rules.
- #848 adds the claim-bound streaming PostHog canary transport with fixed first-page GET, 262144-byte/1024-chunk ceilings, total deadline enforcement, one auth attempt, one transport call, no redirect/retry/refresh/pagination follow-up, and error-body minimization.

Self-Driving still has **no live PostHog project/key activation, no built-in credential resolver/secret-store client, no general live provider polling, no repository write executor, no automatic PR creation, no merge authority, no rollout mutation, no production mutation, and no Solve Runner provisioning authority**.

## Remaining repository-safe milestones

Each milestone must use focused diffs, exact-head validation, review-thread resolution, mergeability, deterministic/bounded behavior, and explicit authority boundaries.

### A. Truth, release, and completion contract

- [ ] Finish synchronizing README, ROADMAP, active handoff, public maturity/status copy, and Issue #113 with the current #848 baseline. This plan is the first 2026-09-06 reconciliation slice.
- [x] Keep historical reports historical rather than silently overwriting evidence.
- [x] Define the release contract and changelog boundary.
- [x] Pin canonical CLI version/help/output/status/JSON contracts through #766/#803.
- [x] Harden the non-publishable Linux release-candidate regeneration/extraction path through #762/#764/#804.
- [ ] Verify and implement only the remaining repository-side final-release regeneration/publication controls required by `docs/release-contract.md`. Actual publication remains an explicit owner gate.
- [ ] Add exact-platform release evidence before claiming supported macOS/Windows CLI artifacts. Mac site CI or Oracle runner availability alone is not a release-support claim.
- [ ] Create `docs/project-completion-report.md` only when every remaining repository-safe item is complete or explicitly blocked by an owner/external decision.

### B. Browser/runtime parity

- [x] Pure-core extraction and host separation.
- [x] Deny-all WASM wrapper and shared conformance/resource limits.
- [x] Compiled-artifact capability/unknown-call denial and static import/resource audit.
- [x] Audited package/real-browser loader qualification.
- [x] `/run` canonical WASM integration through #830.
- [ ] Preserve the artifact audit/pin/conformance gates on every future browser-runtime change; a new runtime change must not silently bypass them.

### C. CLI and editor contract

- [x] Pin CLI help, version aliases, exit/status categories, stdout/stderr behavior, and JSON v1 envelope/schema through #803.
- [x] Open-document cross-file module definition/hover/completion through #753.
- [x] Versioned bounded full-text LSP synchronization/stale-version rejection through #805.
- [ ] Add later non-executing editor slices only where justified: bounded workspace/module indexing, cross-file diagnostics/references, safe rename, cancellation/debouncing, and deterministic request identity.
- [ ] Keep editor-triggered execution, network, tools, agents, dependency installation, and source mutation opt-in and disabled by default.

### D. Solve Self-Driving repository-safe completion

- [x] Observe mode, Context, Scouts, Inbox, sanitized PostHog read pipeline, bounded sanitizers, and injected transport contracts.
- [x] Suggest-mode review artifacts through suggestion plans, non-applied patch previews, and validation-evidence binding.
- [x] No-write PR authorization preflight through #844.
- [ ] Design and implement the next **disabled-by-default, separately authorized PR write boundary** only if it can prove exact reviewed patch identity, branch/base protection, least privilege, one bounded GitHub write sequence, no direct protected-branch write, no auto-merge, no hidden credential material, and no production/rollout authority. Keep live activation separate from repository code.
- [ ] Reconcile the Self-Driving product/roadmap docs through #848 and make the remaining authority ladder explicit.
- [ ] Keep #833 open until live-canary prerequisites and a fresh owner authorization are separately verified. Repository preparation alone must never close the live activation gate.

### E. Product safety, security, and operations

- [ ] Close only material static/read-only gaps in Repository Audit/Solve Graph and Server Audit; preserve bounds, redaction, stable IDs, partiality, no source execution, no dependency installation, and no mutation.
- [ ] Finish repository/test-compatible account, Admin, billing, dormant-priority, and operations hardening: session/recovery abuse controls, scopes/revocation/audit trail, webhook ordering/idempotency, entitlement/ledger integrity, queue leases/retries/DLQ/disable controls, restoration/rollback/runbook evidence, and incident/monitoring truth.
- [x] Site dependency advisories were refreshed through #824 with a clean npm audit for that dependency tree at merge time. This is not a substitute for a current-main whole-repository security review.
- [ ] Run a fresh current-main security review and publish sanitized evidence in `docs/security/current-main-security-review.md`; fix validated findings through separate PRs.
- [ ] Complete only decision checklists for legal/customer-facing commitments where owner or counsel input is required; do not invent commitments.

## Required validation matrix

Run applicable narrow checks first, then the relevant full suite on the exact PR head:

| Surface | Required repository validation |
| --- | --- |
| Rust | `cargo audit`, `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, and release build in `solvec/` when Rust runtime/CLI contracts are affected |
| WASM/browser runtime | existing artifact-security workflow, pinned build/toolchain/integrity checks, shared conformance/limits, and real-browser qualification where the runtime package/pin changes |
| Site/Studio | `npm ci`, `npm run test:studio`, `npm run lint`, `npm run build`, `npm run verify:i18n-export` in `site/` |
| API | locked install, `npm test`, `sam validate --lint`, and `sam build` in the affected service |
| MCP | locked install, `npm test`, and `npm run test:packed` in `packages/mcp-server/` |
| Cross-platform | Trusted Mac or Windows only where the changed contract requires it; neither substitutes for the other |

Hosted CI, Rust/RustSec, reviews, mergeability, and any contract-specific lane must be fresh for the exact proposed head. Queued, missing, skipped, cancelled, stale, or unobserved checks are not success.

## Explicit owner/external gates

The following are not automatically authorized by repository completion or green CI:

- production deployment or AWS/IAM/KMS/CloudFormation/DNS/Cloudflare/Admin changes;
- TOTP account enrollment/login/backup-code canary or infrastructure change;
- live Stripe configuration, webhook activation, charge, refund, billing enablement, or production provider credentials;
- queue/customer-priority/provider processing activation or production customer-source execution;
- live PostHog project/key activation or the first real canary request (#833);
- production customer/CRM mutation, email send, credential rotation, or audit remediation;
- automatic repository merge/release publication unless separately authorized;
- Solve Runner provisioning/registration/pricing/OS rollout;
- final legal/business decisions for terms, privacy, cancellation/refunds, invoices/receipts, support, and retention.

## Completion gate

The repository side is complete only when current truth/release machinery, implementation-backed language specification/conformance, browser/WASM parity, CLI/editor guarantees, the intended Self-Driving repository authority ladder, safe product/operations hardening, current-main security review, public documentation, and required exact-head CI are complete; there are no unresolved P0/P1 engineering findings or blocking review threads; and every remaining item is explicitly recorded as an owner/external/live-activation gate.
