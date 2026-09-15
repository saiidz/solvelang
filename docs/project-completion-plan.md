# SolveLang project completion plan

_Canonical repository-completion checklist. Reconciled 2026-09-15 from `main` immediately after PR #920 (`5d07787c77dbe297b9bb52ba350669d6f9561a5e`). Live GitHub state always wins if this checkpoint becomes stale._

This plan records repository-safe work. It does **not** authorize production deployment, infrastructure mutation, customer/Admin mutation, email/task actions, live Stripe/provider activity, credential activation, production source execution, restore drills, release/package publication or Solve Runners/Solblend work.

## Current queue

- Open project issues at this checkpoint: **#898, #896, #833 and #113**.
- #820 is closed; it is historical completion evidence, not the current master queue.
- Open pull requests at the checkpoint immediately after #920: **0**.
- Production/account/Admin/TOTP truth is tracked separately from repository completion.

## Completed foundations — do not recreate

### Language / CLI / editor

- Rust lexer/parser/AST/interpreter, explicit local modules, bounded module graph validation, structured diagnostics, deterministic checks/lint/format and hardened execution are implemented.
- CLI output/version/status contracts and bounded local LSP synchronization/cross-file open-document tooling are implemented.
- Package registries, remote module installation and a 1.0 stability contract remain outside the current language line.

### Core / browser / release machinery

- Host-incapable `solvec-core`, deny-all `solvec-wasm`, shared conformance/resource limits and the pinned audited `/run/` WASM handoff are implemented.
- Non-publishing release-candidate/tag-regeneration controls and source/version/provenance checks exist.
- Native artifact evidence remains **Linux x86_64 only**. macOS ARM64 and Windows x64 require exact-platform qualification before support claims.

### Repository Audit / Solve Graph / Server Audit

- Bounded deterministic read-only ingestion, relationships, graph queries/explanations, affected validations, security/architecture evidence and report surfaces are implemented.
- Server Audit remains bounded/redacted/read-only.
- Neither product grants source execution or automatic remediation authority.

### Self-Driving

- Observe/suggest, deterministic patch/validation evidence, bounded PR-write contracts and isolated provider/GitHub credential boundaries are implemented in repository code.
- Live provider credentials, signer backends, auto-merge and production rollout remain separate activation gates.

### Connected support

Repository qualification through #897/#903/#906/#908 includes native IMAP/SMTP plus optional Gmail, tenant/mailbox/secret binding, verified transport contracts, durable event/action/cursor state, safe pre-activation cutover/recovery, account/operator controls and monitoring/recovery preparation. Deployment/credentials/live task-reply proof remain open under #896.

### Solve Context

Repository implementation through #913–#920 includes:

- deterministic `solvelang_context_plan`, `solvelang_context_pack` and `solvelang_context_retrieve`;
- content-addressed source/excerpt identity and stale-source rejection;
- Claude ↔ Codex handoff creation/validation;
- lossless structured JSON/log/diff compaction and exact expansion;
- changed-path priority and bounded supplied-Solve-Graph one-hop evidence;
- pinned SolveLang real-source regression cases;
- independent pinned Chalk/node-fetch source subsets;
- six-category synthetic evaluation coverage;
- strict offline baseline-vs-Solve-Context measurement records/reports;
- completion gates for both agents, all six categories, both handoff directions, provider-reported tokens, measured latency, measured selection metrics, zero safe-mode cache-hot mutation and no quality regression;
- #920 pair-integrity checks requiring the same outcome basis and required-evidence denominator across baseline/context arms.

The remaining Solve Context proof is real-agent measurement, broader independent/blinded evaluation and versioned distribution. Repository byte reduction is **not** provider-token savings.

## Remaining repository-safe milestones

### A. Truth and governance

- [x] Reconcile `README.md`, `ROADMAP.md`, active handoff, completion plan, Solve Context docs and active GitHub issue wording with current repository state.
- [ ] Strengthen `main` rules so required current-head checks and intended review policy are enforced by GitHub rather than manual discipline only.
- [ ] Keep historical evidence documents historical instead of rewriting old deployment/security observations as current facts.
- [ ] Perform a fresh final security review after the last material repository code change before declaring repository-side completion.

### B. Solve Context evidence and distribution — #898

- [x] Deterministic pack/retrieve/handoff/compaction foundation.
- [x] Changed-path and supplied graph-aware selection.
- [x] First-party real-source and independent external-source regression suites.
- [x] Strict real-agent measurement record/report contract and pair comparability.
- [ ] Add broader independent/blinded repository fixtures without weakening evidence budgets.
- [ ] Run separately authorized real Claude and Codex baseline-vs-context tasks for all six categories and both handoff directions.
- [ ] Record provider-reported token usage, measured latency, selection precision/recall, task/evidence quality and required cache-hot mutation evidence.
- [ ] Keep `benchmarkEvidenceComplete`, public percentage and comparative claims fail-closed until the full acceptance matrix is satisfied.
- [ ] Select/qualify a future versioned MCP/plugin distribution containing current-main Solve Context; the published v0.2.0 line predates these changes.

### C. Connected support — #896

- [x] Repository implementation, synthetic provider/integration/security tests and monitoring/recovery preparation.
- [ ] Under separate exact-scope authorization, deploy the default-off foundation/monitoring and provision exact-scope mailbox/task credentials without exposing secrets in GitHub/chat.
- [ ] Run one bounded new-message canary and record actual task/reply provider outcome plus stop/recovery evidence before calling the integration live.

### D. PostHog canary — #833

- [x] Bounded request/approval/single-use/lifecycle/kill-switch repository contracts.
- [ ] Qualify the concrete external credential/lifecycle backend and current project/key scope.
- [ ] Perform only the separately owner-authorized bounded read-only canary; no repository merge implies live permission.

### E. Production launch — #113

- [x] API access, customer password accounts, private Admin and TOTP infrastructure have separately verified live evidence.
- [x] Billing replay/ownership/recovery and disabled-billing fail-closed controls exist in repository code.
- [x] Priority and billing monitoring contracts are repository-qualified.
- [ ] Before any activated billing/priority/support path, verify its deployed alarms/destination/recovery controls under separately approved scope.
- [ ] Validate live Stripe/provider configuration only under protected rollout authorization.
- [ ] Approve customer-facing Terms/Privacy/refund/cancellation/support commitments before real billing.
- [ ] Require explicit owner authorization for any charge/refund, customer TOTP canary, provider activation, support inbox canary, restore drill or production mutation.

### F. Release qualification

- [ ] Add exact-platform build/package/install evidence before claiming macOS ARM64 or Windows x64 native support.
- [ ] Select future CLI/MCP versions only through reviewed release boundaries.
- [ ] Do not confuse repository package metadata, `npm pack` smoke tests or GitHub runner availability with public release publication.

## Current distribution truth

The latest published GitHub MCP Server release is **v0.2.0 (2026-07-20)**. Current `main` contains substantial post-v0.2.0 MCP and Solve Context work. Until another version is separately selected and published:

- public `@solvelang/mcp-server@0.2.0` references describe the historical published line;
- current-main usage must be labeled as source/repository usage;
- clean packed-consumer CI proves release readiness only, not that npm/marketplace users receive current-main behavior.

## Required validation matrix

| Surface | Required repository validation |
| --- | --- |
| General | Exact-head applicable GitHub Actions lanes terminal success; clean blocking reviews/threads; mergeability/current-base check |
| Rust | RustSec/audit where configured, format, clippy, tests and release build for affected runtime/CLI work |
| WASM/browser | Artifact-security workflow, source/pin/integrity checks, conformance and browser checks where applicable |
| Site/Studio | Locked install, deterministic tests, lint, build, i18n/export and Chromium public-navigation smoke as configured |
| API | Locked install/tests plus SAM validation/build for affected service work |
| MCP/Solve Context | Locked install, package tests, synthetic evals, first-party/independent repository regressions, agent-record contract test, plugin packaging/roundtrip, packed-consumer smoke and dependency audit |
| Cross-platform | Exact required platform evidence only; Mac/Windows/Oracle/Linux lanes do not substitute for one another |

Queued, missing, cancelled, stale or unobserved checks are not green.

## Project projection

Projection means **priority direction, not a promised date or unsupported completion percentage**:

1. **P0:** finish Solve Context evidence integrity, broader independent evaluation and real-agent measurement.
2. **P0:** enforce required checks/reviews on `main` at the repository-rules level.
3. **P1:** qualify a versioned current-main MCP/plugin distribution after evidence remains green.
4. **P1:** activate connected support/PostHog only through their separate approval/provider gates.
5. **P1:** prepare billing/priority launch only after monitoring, recovery, legal/customer and live provider prerequisites are verified.
6. **P1/P2:** add exact macOS ARM64 and Windows x64 native release evidence before cross-platform support claims.
7. **Separate/deferred:** Solve Runners / Solblend provisioning, pricing and customer compute.

## Completion gate

Repository-side completion requires current public/internal truth, release machinery, implementation-backed language/browser/MCP claims, the intended Self-Driving authority ladder, product/operations hardening, a fresh current-main security review and exact-head CI to be complete with no unresolved P0/P1 engineering finding or blocking review thread. Anything remaining must be explicitly recorded as a live-provider, production, publication, owner/business/legal or other external gate.

Repository completion itself never authorizes those live gates.
