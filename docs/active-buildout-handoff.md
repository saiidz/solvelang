# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout without duplicating merged work or treating repository state as production state.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-18  

Before acting, always re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, trusted self-hosted job metadata, `.github/workflows`, `ROADMAP.md`, and `docs/current-production-status-2026-08-13.md`. Never infer production state from merged code or green CI.

## Current repository baseline

- `main` at this sync: `67fa81daa42255e788b22c79f47a2d1fe00134ff`.
- PR #223 is merged: Repository Audit now has a bounded evidence-completeness contract that distinguishes complete, partial, unavailable, and truncated intelligence instead of overstating scan coverage.
- PR #226 is merged: that evidence-completeness state is composed into deterministic product JSON/HTML reporting.
- Earlier Repository Audit work already includes bounded deterministic inventory, archive/GitHub acquisition boundaries, Solve Graph reuse, redacted secret analysis, impact/blast-radius intelligence, canonical evidence export, printable HTML, and browser-local reporting.
- Server Audit is already a substantial local/read-only product with strict snapshot parsing/schema alignment, deterministic temporal/inventory consistency analysis, bounded process inventory, coverage-gap truth, bounded public-file marker checks, canonical/redacted JSON/HTML reporting, and browser-local evidence presentation.
- Admin Gateway rollout machinery is merged through #168 and deterministic private Admin console publication preparation is merged through #172. No live rollout is implied by those merges.

## Authoritative production truth

Until a newer live audit is performed, `docs/current-production-status-2026-08-13.md` remains the production-state source of truth:

- API access: **enabled**;
- customer accounts/password authentication: **enabled**;
- ordinary password login sends email: **no**;
- authenticator-app TOTP production feature: **disabled**;
- dedicated production TOTP KMS key: **not created**;
- subscription billing: **disabled**;
- production billing webhook path: **disabled by feature boundary**;
- paid customer priority: **disabled**;
- real charge authorization: **none**.

Merged code, green CI, rollout workflows, or deployable artifacts are not evidence that a production feature is enabled.

## Admin console / private gateway

All currently known safe repository preparation for the immediate Admin Gateway step is complete. The next action is a live IAM mutation and remains separately controlled:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Later production gates remain separate for gateway deployment, private HTTPS/DNS/Zero-Trust ingress, static Admin console publication, and login/session canaries. Never publish the Admin UI on the public customer origin as a shortcut.

## Protected production-sensitive PRs

These PRs must remain unmerged during unattended build automation even when mergeable and green. Keep them refreshed/tested on current `main` without replacing newer history or changing production gates.

### PR #161 — preserve Admin CRM through auth rollbacks

- Branch: `agent/preserve-crm-through-totp-rollout`
- Exact head at this sync: `7b7aee6c6d06864a9973eb6d86fb94deb905918d`.
- Hosted CI, API Access CI, and Rust are green on that head.
- Gate: `APPROVE PR #161 MERGE`.
- Purpose: preserve `AdminCrmEnabled` through shared production auth rollback while billing remains OFF.

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`
- Exact head at this sync: `414cf42d4d75d3c4fb1cbe672e378fec7b1b3669`.
- Hosted CI, API Access CI, Customer Priority Production CI, and Rust are green on that head.
- Gate: `APPROVE PR #164 MERGE`.
- Queue/customer/provider launch gates and billing must remain OFF.

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`
- Exact head at this sync: `58a7ef1ece2b0821cbb8ce9a613b8151f5b433b0`.
- Hosted CI, API Access CI, Customer Priority Foundation Rollout CI, and Rust are green on that head.
- Gate: `APPROVE PR #169 MERGE`.
- Queue/customer/provider launch gates and billing must remain OFF.

Merging any of these would still not authorize workflow dispatch, live IAM application, queue/provider activation, billing, email, charges, or production-data mutation.

## Active Solve Graph / Repository Audit work

### PR #224 — deterministic Python import relationships

- Branch: `agent/mac-solve-graph-python-imports-v3`.
- Exact head at this sync: `1ff9643e687b76fc88edc822f06b3bb06b12370d`.
- Successor to closed/unmerged #213 and earlier #188.
- Adds bounded lexical `.py`/`.pyi` import extraction without executing repository code, resolves only repository-local modules/packages, composes Python relationships with the existing JavaScript/TypeScript graph, and reuses the graph in Repository Audit impact analysis.
- Exact-head GitHub-hosted CI and Rust are green and the PR is mergeable/review-thread clean.
- Do not merge until exact-head Trusted Mac validation is verifiably green. The current connector does not expose enough push-run inventory to infer a passing Mac run, so lack of evidence must remain a gate rather than be treated as success.

### Repository Audit successor PRs

The current analyze-only successors were refreshed onto `67fa81d…` without force-pushing newer history:

- #206 `agent/mac-repository-audit-dependency-consistency-v2` — head `4715a67ba0e6be60232920b2e182155ac1919e61`; bounded dependency consistency; hosted CI/Rust green.
- #207 `agent/mac-repository-audit-coverage-map-v2` — head `3f1c06bbecd83547b43b75efe86851166c75b3f1`; direct test/documentation coverage evidence.
- #208 `agent/mac-repository-audit-dead-code-candidates-v2` — head `6c6b2099f23702ae29ca4a696fc2d3a8a5292518`; conservative dead-code candidates.
- #209 `agent/mac-repository-audit-config-references-v2` — head `6dbb90d18391016f5d7024e2213cf508f5043e60`; bounded configuration-reference evidence.
- #210 `agent/mac-repository-audit-workflow-path-evidence-v2` — head `d91c2dd8a3272c59a07b30d21b8581eb3ec1a1a9`; bounded workflow-path evidence.

All remain analyze-only. Do not execute repository code, package managers, hooks, workflows, or networked repository logic to construct evidence. Require exact-head hosted CI/Rust plus the existing Trusted Mac gate before merging any `agent/mac-*` branch. If `main` advances, refresh/rebuild without losing newer main changes.

After those land, continue Repository Audit/Solve Graph with deterministic report/browser composition, richer framework/deployment/config relationships, affected-tests/workflows reasoning, architecture/security path summaries, MCP/Codex integration quality, local visual explorer improvements, bounded/redacted evidence, stable IDs, and cross-platform tests.

## Trusted Mac and Windows runner policy

`.github/workflows/trusted-mac-ci.yml` is merged on `main`, push-only for trusted `agent/mac-*` branches, read-only for repository permissions, and targets `[self-hosted, macOS, ARM64]`.

Runner inventory is not directly available through the current connector. Infer state only from GitHub Actions run/job metadata. Do not guess that a queued or unobserved job passed, interrupt another job, modify runner registration/services, weaken branch restrictions, or redirect untrusted PR code to the self-hosted Mac.

Current repository workflow metadata exposes the Trusted Mac workflow and normal GitHub-hosted workflows; no dedicated Windows-targeted repository workflow was identified in this reconciliation. Use an existing Windows self-hosted workflow only if repository metadata already targets it and the job is idle/available. Do not invent Windows routing merely to bypass queueing.

## Server Audit current state

Current `main` includes:

- strict bounded snapshot parser and aligned JSON schema;
- deterministic OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security evidence handling;
- temporal consistency and duplicate/inventory consistency analysis;
- explicit coverage-gap / `not collected` truth;
- bounded existence-only sensitive public-file marker checks with no content reads;
- deterministic/redacted canonical JSON and self-contained HTML reports;
- browser-local reporting that preserves absent-vs-empty inventory meaning.

Current hardening successors:

- #211 `agent/mac-server-audit-command-surface-contract-v2` — head `3b3272b2f4260ab088167b00fee3737eea8c0398`; pins the reviewed read-only collector executable surface; hosted CI/Rust green; Trusted Mac still required.
- #225 `agent/mac-server-audit-snapshot-invariants-v3` — head `4b6e1a12a026d3f02e5106a8d4aa5add89c7ccb9`; rejects impossible memory/filesystem capacity snapshots while preserving newer process/public-file parser work; hosted CI/Rust green; Trusted Mac still required.
- #212 is closed unmerged as superseded by #225 so stale parser history cannot overwrite newer Server Audit work.
- #227 `agent/server-audit-process-health-v1` — head `bca53c70ebc7c29dd176460f3868cdfd3decf6b3` at this sync; adds bounded point-in-time zombie, missing-parent, and listener/process evidence with explicit process-churn limitations. GitHub-hosted CI is green; the separate Rust/RustSec workflow was still running at capture time. It is not production-sensitive and may merge only after exact-head checks finish green and review state remains clean.

Continue Server Audit only with constrained read-only evidence: reviewed command allowlists, OS/package/service/port/process/scheduled-job posture, disk/log/cache/backup posture, web roots/domains/SSL/public-file checks, ownership/permission/version findings, bounded/redacted evidence, deterministic reports, and tests. No remote mutation or remediation execution.

## Language/runtime and DX

Imported-file source provenance is already merged. Safe independent work may continue on formatter/linter, semantic/type checks, `for` loops, module/package design, richer diagnostics, editor support, deterministic tests, and cross-platform compatibility. Preserve current language compatibility unless a deliberate versioned change is made.

## Customer priority, TOTP, billing, and hardening

Customer-priority work may continue only as dormant build preparation: source integrity, retries/leases/DLQs, observability, validation-only preflight, entitlement/account enforcement, and browser/API readiness. Keep queue/customer/provider launch gates OFF, do not call real providers, and do not consume production credits.

TOTP preparation may continue only as non-live IAM/KMS/preflight/deployment validation code, rollback/state-preservation logic, canary planning, and tests. Do not create live KMS resources or enable production TOTP.

Billing preparation may continue on webhook replay/idempotency, checkout ownership, subscription lifecycle, upgrades/downgrades/cancellation, payment-method management, failure recovery, refunds policy/tests, and preflight. Do not use live Stripe keys, create charges/refunds, or enable production billing.

Security/account hardening, least privilege, rollback, launch-readiness, operations, stale issue/PR cleanup, and truth documentation remain valid independent safe work.

## Safe build order from this snapshot

1. Merge #227 only if its remaining exact-head Rust/RustSec validation finishes green and review state remains clean; otherwise fix it before advancing.
2. Merge #224 first among Trusted-Mac-gated graph work only after exact-head Trusted Mac is verifiably green.
3. Reconcile #206-#210 after any `main` advancement and merge non-production successors in dependency order only after exact-head hosted + Trusted Mac validation.
4. Reconcile #211/#225 after any `main` advancement and merge only after exact-head Trusted Mac validation passes.
5. Continue Repository Audit / Solve Graph deterministic read-only intelligence and report/browser composition.
6. Continue Server Audit read-only evidence/report quality.
7. Continue language/runtime/DX work.
8. Keep Admin live actions gated.
9. Keep #161/#164/#169 refreshed/tested but unmerged until exact owner approval.
10. Continue dormant customer-priority, TOTP, billing, security, and operations readiness while production gates remain OFF.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, rerun hosted CI, close/supersede duplicates with evidence, merge non-production PRs only after exact-head green + mergeable + review-clean validation, and keep truth docs current.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use Stripe live, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or queued/unverifiable trusted-runner validation blocks one track, record it and continue another safe engineering task instead of idling.
