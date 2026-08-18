# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout without duplicating merged work or treating repository state as production state.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17  

Before acting, always re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, trusted self-hosted job metadata, `.github/workflows`, `ROADMAP.md`, and `docs/current-production-status-2026-08-13.md`. Never infer production state from merged code or green CI.

## Current repository baseline

- `main` at this sync: `1c89a1ee3e8fcdb58816572c85c42efcb7d9d0c9`.
- PR #220 is merged: Server Audit now performs bounded existence-only checks for four fixed sensitive public-file markers (`.env`, `.git/config`, `.npmrc`, Composer `auth.json`) under already-discovered candidate web roots. Marker contents are never read or emitted, and local presence is not represented as proof of HTTP reachability.
- PR #221 is merged: the Server Audit browser preserves `not collected` truth instead of rendering structurally absent inventory sections as misleading zero counts.
- Earlier Server Audit work on `main` already includes strict snapshot parsing/schema alignment, deterministic temporal/inventory consistency analysis, bounded process inventory, coverage-gap truth, canonical/redacted JSON/HTML reporting, and browser-local evidence presentation.
- Repository Audit already includes bounded deterministic inventory, archive/GitHub acquisition boundaries, Solve Graph reuse, redacted secret analysis, impact/blast-radius intelligence, canonical evidence export, printable HTML, and browser-local reporting.
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
- Gate: `APPROVE PR #161 MERGE`
- Purpose: preserve `AdminCrmEnabled` through shared production auth rollback while billing remains OFF.

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`
- Gate: `APPROVE PR #164 MERGE`
- Queue/customer/provider launch gates and billing must remain OFF.

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`
- Gate: `APPROVE PR #169 MERGE`
- Queue/customer/provider launch gates and billing must remain OFF.

Merging any of these would still not authorize workflow dispatch, live IAM application, queue/provider activation, billing, email, charges, or production-data mutation.

## Active Solve Graph / Repository Audit work

### PR #213 — deterministic Python import relationships

- Branch: `agent/mac-solve-graph-python-imports-v2`
- Last observed exact head at this sync: `080f6358fff124f30c11a5bf2a987ead5cee84f5`.
- Successor to closed/unmerged #188.
- Adds bounded lexical `.py`/`.pyi` import extraction without executing repository code, resolves only repository-local modules/packages, composes Python relationships with the existing JavaScript/TypeScript graph, and reuses the graph in Repository Audit impact analysis.
- Hosted PR CI and Rust are green on that observed head. Do not merge until the current exact head is mergeable, review-clean, and Trusted Mac validation is verifiably green.
- `main` advanced after the observed branch base; reconcile/rebuild safely before merge rather than force-overwriting newer work.

### Repository Audit successor PRs

Current read-only successors remain open and must be rechecked against current `main` before merge:

- #206 `agent/mac-repository-audit-dependency-consistency-v2` — bounded dependency consistency.
- #207 `agent/mac-repository-audit-coverage-map-v2` — direct test/documentation coverage evidence.
- #208 `agent/mac-repository-audit-dead-code-candidates-v2` — conservative dead-code candidates.
- #209 `agent/mac-repository-audit-config-references-v2` — bounded configuration-reference evidence.
- #210 `agent/mac-repository-audit-workflow-path-evidence-v2` — bounded workflow-path evidence.

All remain analyze-only. Do not execute repository code, package managers, hooks, workflows, or networked repository logic to construct evidence. If `main` advances, refresh/rebuild without losing newer main changes, rerun exact-head hosted CI/Rust, and require the existing Trusted Mac gate for `agent/mac-*` branches.

After those land, continue Repository Audit with deterministic report/browser composition, richer framework/deployment/config relationships, affected-tests/workflows reasoning, architecture/security path summaries, bounded/redacted evidence, stable IDs, and cross-platform tests.

## Trusted Mac and Windows runner policy

`.github/workflows/trusted-mac-ci.yml` is merged on `main`, push-only for trusted `agent/mac-*` branches, read-only for repository permissions, and targets `[self-hosted, macOS, ARM64]`.

Runner inventory is not directly available through the current connector. Infer state only from GitHub Actions run/job metadata. A queued job means GitHub has not assigned it yet; do not guess why, interrupt another job, modify runner registration/services, weaken branch restrictions, or redirect untrusted PR code to the self-hosted Mac.

Current repository workflow metadata exposes the Trusted Mac workflow and normal GitHub-hosted workflows; no dedicated Windows-targeted repository workflow was identified in the latest reconciliation. Use an existing Windows self-hosted workflow only if repository metadata already targets it and the job is idle/available. Do not invent Windows routing merely to bypass queueing.

## Server Audit current state

Server Audit is a substantial local/read-only product, not a roadmap stub. Current `main` includes:

- strict bounded snapshot parser and aligned JSON schema;
- deterministic OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security evidence handling;
- temporal consistency and duplicate/inventory consistency analysis;
- explicit coverage-gap / `not collected` truth;
- bounded existence-only sensitive public-file marker checks with no content reads;
- deterministic/redacted canonical JSON and self-contained HTML reports;
- browser-local reporting that preserves absent-vs-empty inventory meaning.

The trusted-Mac hardening successors remain open:

- #211 `agent/mac-server-audit-command-surface-contract-v2` — pins the reviewed read-only collector executable surface.
- #212 `agent/mac-server-audit-snapshot-invariants-v2` — rejects impossible memory/filesystem capacity snapshots.

Continue Server Audit only with constrained read-only evidence: reviewed command allowlists, OS/package/service/port/process/scheduled-job posture, disk/log/cache/backup posture, web roots/domains/SSL/public-file checks, ownership/permission/version findings, bounded/redacted evidence, deterministic reports, and tests. No remote mutation or remediation execution.

## Language/runtime and DX

Imported-file source provenance is already merged. Safe independent work may continue on formatter/linter, semantic/type checks, `for` loops, module/package design, richer diagnostics, editor support, deterministic tests, and cross-platform compatibility. Preserve current language compatibility unless a deliberate versioned change is made.

## Customer priority, TOTP, billing, and hardening

Customer-priority work may continue only as dormant build preparation: source integrity, retries/leases/DLQs, observability, validation-only preflight, entitlement/account enforcement, and browser/API readiness. Keep queue/customer/provider launch gates OFF, do not call real providers, and do not consume production credits.

TOTP preparation may continue only as non-live IAM/KMS/preflight/deployment validation code, rollback/state-preservation logic, canary planning, and tests. Do not create live KMS resources or enable production TOTP.

Billing preparation may continue on webhook replay/idempotency, checkout ownership, subscription lifecycle, upgrades/downgrades/cancellation, payment-method management, failure recovery, refunds policy/tests, and preflight. Do not use live Stripe keys, create charges/refunds, or enable production billing.

Security/account hardening, least privilege, rollback, launch-readiness, operations, stale issue/PR cleanup, and truth documentation remain valid independent safe work.

## Safe build order from this snapshot

1. Reconcile #213 with current `main`; finish exact-head hosted + Trusted Mac validation and merge only if fully green, mergeable, and review-clean.
2. Reconcile #206-#210 after any main advancement and merge non-production successors in dependency order only after exact-head validation.
3. Reconcile #211/#212 after any main advancement and merge only after exact-head Trusted Mac validation passes.
4. Continue Repository Audit / Solve Graph deterministic read-only intelligence and report/browser composition.
5. Continue Server Audit read-only evidence/report quality.
6. Continue language/runtime/DX work.
7. Keep Admin live actions gated.
8. Keep #161/#164/#169 refreshed/tested but unmerged until exact owner approval.
9. Continue dormant customer-priority, TOTP, billing, security, and operations readiness while production gates remain OFF.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, rerun hosted CI, close/supersede duplicates with evidence, merge non-production PRs only after exact-head green + mergeable + review-clean validation, and keep truth docs current.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use Stripe live, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or queued trusted-runner validation blocks one track, record it and continue another safe engineering task instead of idling.
