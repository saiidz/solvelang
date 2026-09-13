# SolveLang project completion plan

_Canonical repository-completion checklist. Reconciled 2026-09-13 against `main` at `5e5f17775aec0ab026b92b45397b19eec330e561` (merge of #885). Live GitHub state always wins if this checkpoint becomes stale._

This plan records repository-safe work only. It does not authorize a deployment, AWS/IAM/KMS/DNS/Cloudflare mutation, customer/Admin mutation, email, live Stripe activity, charge/refund, live provider execution, credential activation, production source execution, release publication, or audit remediation.

## Source of truth and current queue

- Live GitHub state wins over this document, historical handoffs, and old PR bodies.
- Current `main`: `5e5f17775aec0ab026b92b45397b19eec330e561`, the merge of #885.
- Open pull requests at this checkpoint: **0**.
- Open issues at this checkpoint: **#113, #820, #833**.
- #820 is the master completion mission. #833 is the separately owner-gated first live PostHog canary. #113 tracks production launch readiness and must not be treated as a repository-merge authorization surface.
- Production/account/Admin/TOTP facts are tracked separately from repository completion. Subscription billing, paid priority, queue/provider processing, general managed hosted execution, real charges, live provider credentials, and public release publication remain off/unproven unless separately authorized and verified.

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
- #883–#885 reconcile release-facing browser/WASM truth: the bounded preview is qualified as its own browser surface, is not a native `solvec` release target, and does not establish managed/server execution.
- The browser runtime remains capability-denied and does not establish managed hosted execution, deployment, provider, filesystem, storage, environment, or production authority.

### Release-candidate machinery

- #762/#764 establish the non-publishable Linux x86_64 release-candidate path with exact-source identity, pinned read-only workflow actions, locked Rust validation, deterministic archive naming/bytes, SHA-256 evidence, provenance, two-build byte comparison, and extracted-binary smoke validation.
- #804 hardens candidate regeneration and archive extraction: destinations cannot be destructively reused, archives are inspected before extraction, and unsafe entry types/paths/extras are rejected.
- #881 adds the annotated-tag regeneration gate and read-only non-publishing tagged regeneration workflow.
- #882 binds the packaged CLI's `solvec version` output to provenance/version identity and adds hostile version-mismatch verification.
- #883 reconciles changelog/root-draft release truth; #884 reconciles README release truth and makes release-facing truth-document changes trigger Release Candidate CI; #885 fixes the pre-tag-vs-tagged evidence contract and current Browser/WASM platform statement.
- Current repository release-artifact evidence is **Linux x86_64 only**. macOS ARM64 and Windows x64 must not be claimed as released CLI artifacts without exact-platform evidence on the selected release commit.
- Existing GitHub `v0.1.0`/`v0.2.0` releases are historical MCP Server releases and are not evidence of a completed modern cross-platform SolveLang CLI/runtime release.

### Codex and Claude integration proof

- #864 packages one canonical local SolveLang plugin bundle for Codex and Claude around the pinned read-only MCP server without granting repository-write or production authority.
- #865 adds a separate authenticated, raw-JSON-only, read-only Streamable HTTP MCP boundary for cloud/server-side clients; it is repository capability only and is not a public deployment.
- #871 packs/installs the current MCP package in a clean consumer and proves a real stdio initialize/list-tools/tool-call roundtrip against the shared Codex/Claude plugin contract. Marketplace publication/external client installation remains separate distribution evidence.

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
- Solve Runners remains a separate deferred product/security/commercial boundary and must not be folded into Repository Audit, Self-Driving, or release-platform authority.

### Solve Self-Driving

The repository-safe Self-Driving train has advanced beyond the earlier observe-only checkpoint:

- #780/#782/#784/#786/#788 build bounded Solve Inbox, Setup planning, provider-neutral Context, AI/Cost Scouts, and Experience/Incident/Rollout Scouts.
- #790/#793/#795/#797/#799 build the offline PostHog adapter, provider connection policy, exact aggregate query contract, fixture-only transport simulation, and canonical Observe Run composition.
- #806/#808 define and implement disabled-by-default injected fixture coordination with no real credential/network implementation.
- #810/#812/#815/#817 add least-privilege read-only provider policy, deterministic PostHog GET planning, injected GET-only transport, and sanitized Observe composition.
- #823/#826/#829/#832 add bounded PostHog error/feature-flag sanitizers, corrected first-page request contracts, and reviewed sanitizer composition.
- #834/#838/#846/#848 establish the owner-gated one-request PostHog canary contract, atomic single-use claims, lifecycle/finalization, and bounded streaming transport without live activation.
- #836/#840/#842/#844 add deterministic Suggest plans, non-applied patch previews, validation-evidence binding, and no-write PR authorization preflight.
- #850–#860 add cryptographically bound single-use PR-write claims, exact execution plans/finalization, deterministic patch materialization, an allowlisted bounded GitHub REST transport/evidence chain, and the concrete one-shot injected PR-write adapter. The path has no auto-merge or protected-base write authority.
- #861–#863 add a disabled-by-default GitHub App installation runtime gate, bounded installation-token mint boundary, and isolated private-key signer/lease boundary. Real private-key storage/signing implementation and live activation remain separate.
- #866/#868–#870 harden the PostHog canary runtime gate and add activation-bound kill-switch/credential-source plus lifecycle-operator boundaries. #833 remains open because current project/key-scope verification, a concrete reviewed external implementation, and fresh owner authorization are still required before a real canary.

Self-Driving now has repository code for bounded injected provider and GitHub-write execution boundaries, but it still has **no authorized live PostHog project/key activation, no approved production secret-store/private-key backend, no general live provider polling, no automatic PR creation service, no auto-merge authority, no rollout/production mutation, and no Solve Runner provisioning authority**.

### Billing, recovery, security, and launch controls

- #872 proves signed billing webhook replay converges through the delivery ledger without direct customer-confirmation side effects; ambiguous SES-success/final-ledger-update remains explicitly at-least-once rather than falsely exactly-once.
- #873 proves authenticated checkout ownership cannot be overridden by caller-supplied account/email/customer IDs.
- #874 proves newer active subscription recovery wins over delayed older past-due events.
- #875 adds a read-only production data-protection verifier for durable account/subscription/API-key/auth/TOTP/webhook-replay tables and requires ACTIVE/SSE/PITR/restorable-window evidence; it does not perform a restore.
- #879 makes internal/admin subscription checkout and provisioning fail closed when subscription billing is disabled.
- #867 adds general privacy/legal pages and reduces browser tracking without enabling billing/provider execution.
- `docs/security-review-2026-09-13.md` records the current-main review slice that found the inline JSON-LD script-termination risk; #877 fixes it and wires the hostile regression into enforced SEO CI.
- #876/#878/#880 reconcile launch checkpoints and contributor onboarding while preserving all live provider, billing, production, publication, and Solve Runner/Solblend gates.

## Remaining repository-safe milestones

Each milestone must use focused diffs, exact-head validation, review-thread resolution, mergeability, deterministic/bounded behavior, and explicit authority boundaries.

### A. Truth, release, and completion contract

- [ ] Finish synchronizing `ROADMAP.md`, `docs/active-buildout-handoff.md`, the canonical completion plan, and Issue #113 with current `main`. README/changelog/release-contract truth is current through #885; do not rewrite historical evidence as if it were current.
- [x] Keep historical reports historical rather than silently overwriting evidence.
- [x] Define the release contract and changelog boundary.
- [x] Pin canonical CLI version/help/output/status/JSON contracts through #766/#803.
- [x] Harden the non-publishable Linux release-candidate regeneration/extraction path through #762/#764/#804.
- [x] Implement the remaining repository-side final-release regeneration controls through #881/#882 and reconcile their contract through #883–#885. Public version selection, annotated-tag creation for the chosen release, GitHub Release creation, and asset/package publication remain explicit owner gates.
- [ ] Add exact-platform release evidence before claiming supported macOS ARM64 or Windows x64 CLI artifacts. Linux x86_64 is the only current repository artifact target; Mac site CI or Oracle runner availability alone is not a release-support claim.
- [ ] Create `docs/project-completion-report.md` only when every remaining repository-safe item is complete or explicitly blocked by an owner/external decision.

### B. Browser/runtime parity

- [x] Pure-core extraction and host separation.
- [x] Deny-all WASM wrapper and shared conformance/resource limits.
- [x] Compiled-artifact capability/unknown-call denial and static import/resource audit.
- [x] Audited package/real-browser loader qualification.
- [x] `/run` canonical WASM integration through #830.
- [x] Keep release-facing Browser/WASM claims bounded to the qualified browser preview and separate from native CLI/managed-execution claims through #883–#885.
- Future browser-runtime changes must continue to pass the artifact audit/pin/conformance gates; this is a maintenance rule, not an unfinished launch feature.

### C. CLI and editor contract

- [x] Pin CLI help, version aliases, exit/status categories, stdout/stderr behavior, and JSON v1 envelope/schema through #803.
- [x] Open-document cross-file module definition/hover/completion through #753.
- [x] Versioned bounded full-text LSP synchronization/stale-version rejection through #805.
- Additional non-executing editor features such as workspace indexing, cross-file references/rename, cancellation/debouncing, or deterministic request identity are future product work and are not required for the current repository-completion gate unless a release claim depends on them.
- Editor-triggered execution, network, tools, agents, dependency installation, and source mutation remain opt-in/disabled by default unless separately designed and reviewed.

### D. Solve Self-Driving repository-safe completion

- [x] Observe mode, Context, Scouts, Inbox, sanitized PostHog read pipeline, bounded sanitizers, and injected transport contracts.
- [x] Suggest-mode review artifacts through suggestion plans, non-applied patch previews, and validation-evidence binding.
- [x] No-write PR authorization preflight through #844.
- [x] Implement the disabled-by-default bounded PR-write execution/credential boundary through #850–#863 with exact reviewed patch identity, branch/base protection, least privilege, one bounded GitHub write sequence, no protected-base write, no auto-merge, and no production/rollout authority. Live credential/backend activation remains separate.
- [x] Implement repository-side isolated PostHog credential, kill-switch, runtime-auth, and lifecycle boundaries through #866/#868–#870 without activating a provider.
- [ ] Reconcile remaining Self-Driving roadmap/handoff wording to the #870 authority ladder and make the two live activation boundaries explicit: PostHog canary (#833) and any future real GitHub PR-write canary/service.
- [ ] Keep #833 open until live-canary prerequisites and a fresh owner authorization are separately verified. Repository preparation alone must never close the live activation gate.

### E. Product safety, security, and operations

- [ ] Close only material static/read-only gaps in Repository Audit/Solve Graph and Server Audit; preserve bounds, redaction, stable IDs, partiality, no source execution, no dependency installation, and no mutation. Do not create work merely to extend already-bounded products.
- [ ] Finish only the remaining repository/test-compatible account/Admin/billing/operations gaps after #872–#875/#879: verify current monitoring/incident/disable-path truth, queue/priority failure handling that is actually in launch scope, and any still-missing sanitized rollback/recovery evidence. Do not equate repository tests with live billing or a production restore drill.
- [x] Site dependency advisories were refreshed through #824 with a clean npm audit for that dependency tree at merge time. This is not a substitute for a final current-main whole-repository security pass.
- [ ] Perform a final fresh security review after the last repository code change. Preserve `docs/security-review-2026-09-13.md` as the earlier review slice and fix any newly validated material finding through a separate PR before completion.
- [ ] Complete only decision checklists for legal/customer-facing commitments where owner or counsel input is required; do not invent commitments.

## Required validation matrix

Run applicable narrow checks first, then the relevant full suite on the exact PR head:

| Surface | Required repository validation |
| --- | --- |
| Rust | `cargo audit`, `cargo fmt --check`, `cargo clippy -- -D warnings`, `cargo test`, and release build in `solvec/` when Rust runtime/CLI contracts are affected |
| WASM/browser runtime | existing artifact-security workflow, pinned build/toolchain/integrity checks, shared conformance/limits, and real-browser qualification where the runtime package/pin changes |
| Site/Studio | `npm ci`, `npm run test:studio`, `npm run lint`, `npm run build`, `npm run verify:i18n-export` in `site/` |
| API | locked install, `npm test`, `sam validate --lint`, and `sam build` in the affected service |
| MCP | locked install, `npm test`, `npm run test:plugin-roundtrip`, and `npm run test:packed` in `packages/mcp-server/` where the plugin/package contract is affected |
| Release truth/artifacts | Release Candidate CI on the exact head; tagged regeneration remains non-publishing until a separately authorized selected tag exists |
| Cross-platform | Exact platform evidence only where the changed/release contract claims that platform; Trusted Mac, Windows, Linux, and Oracle coverage never substitute for one another |

Hosted CI, Rust/RustSec, reviews, mergeability, and any contract-specific lane must be fresh for the exact proposed head. Queued, missing, skipped, cancelled, stale, or unobserved checks are not success.

## Explicit owner/external gates

The following are not automatically authorized by repository completion or green CI:

- production deployment or AWS/IAM/KMS/CloudFormation/DNS/Cloudflare/Admin changes;
- TOTP account enrollment/login/backup-code canary or infrastructure change;
- live Stripe configuration, webhook activation, charge, refund, billing enablement, or production provider credentials;
- queue/customer-priority/provider processing activation or production customer-source execution;
- live PostHog project/key activation or the first real canary request (#833), including its concrete secret/lifecycle backend and current project/key-scope verification;
- live GitHub App private-key/installation credential backend activation or a real automated PR-write service/canary;
- production customer/CRM mutation, email send, credential rotation, or audit remediation;
- public version selection/tag creation, GitHub Release creation, asset/package publication, or other release publication unless separately authorized;
- Solve Runner/Solblend provisioning, registration, pricing, OS rollout, or service authority;
- final legal/business decisions for terms, privacy, cancellation/refunds, invoices/receipts, support, and retention.

## Completion gate

The repository side is complete only when current truth/release machinery, implementation-backed language specification/conformance, browser/WASM parity, CLI/editor guarantees required by current claims, the intended Self-Driving repository authority ladder, safe product/operations hardening, a final current-main security review, public documentation, and required exact-head CI are complete; there are no unresolved P0/P1 engineering findings or blocking review threads; and every remaining item is explicitly recorded as an owner/external/live-activation gate. Repository completion does not itself authorize production deployment, provider activation, billing, release publication, or Solve Runner/Solblend actions.
