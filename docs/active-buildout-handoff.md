# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout without duplicating merged work or treating repository state as production state.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17  

Before acting, always re-read current `main`, open PR heads, exact-head CI/checks, review threads, trusted self-hosted job metadata, open issues, `ROADMAP.md`, and `docs/current-production-status-2026-08-13.md`.

## Current repository baseline

- `main` at this sync: `1385d1e711e3ed5cc6665ea8b621bec9b1790937`.
- PR #204 is merged: Server Audit now emits bounded informational coverage-gap findings for structurally absent snapshot sections, treats explicit empty inventories as collected evidence, composes the evidence into deterministic JSON/HTML reports, and does not penalize posture score for missing coverage.
- PR #203 is merged: Server Audit inventory-consistency findings are composed into canonical deterministic reports.
- PR #201 is merged: Server Audit has deterministic bounded consistency checks for conflicting duplicate package, service, filesystem, and web-root evidence.
- PRs #198/#199 are merged: Server Audit has bounded timestamp/certificate/log temporal-consistency findings and deterministic report composition.
- PR #202 was closed unmerged because its handoff snapshot became stale after newer Server Audit work landed; this file is its fresh replacement from current `main`.
- Repository Audit already contains bounded inventory, Solve Graph reuse, redacted secret analysis, canonical evidence export, printable HTML, and browser-local evidence surfaces.
- Admin Gateway rollout machinery is merged through PR #168 and deterministic private Admin console publication preparation is merged through PR #172. No live rollout is implied by those merges.

## Last separately verified production truth

Until a newer live audit is performed, retain `docs/current-production-status-2026-08-13.md` as authoritative production truth:

- API access: **enabled**;
- customer accounts/password authentication: **enabled**;
- ordinary password login sends email: **no**;
- authenticator-app TOTP production feature: **disabled**;
- dedicated production TOTP KMS key: **not created**;
- subscription billing: **disabled**;
- billing webhook: **disabled**;
- paid customer priority: **disabled**;
- real charge authorization: **none**.

Merged code, green CI, or rollout workflows are not evidence that a production feature is enabled.

## Admin console / private gateway

All currently known safe repository preparation for the immediate Admin Gateway step is complete. The next action is a live IAM change and remains separately controlled:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Later production gates remain separate for gateway deployment, private HTTPS/DNS/Zero-Trust ingress, static Admin console publication, and login/session canary. Never publish the Admin UI on the public customer origin as a shortcut.

## Protected production-sensitive PRs

These PRs must not be merged by unattended build automation even when mergeable and green. Because `main` has advanced since their last replay, refresh/rebuild them on current `main` without overwriting newer work before any owner-approved merge.

### PR #161 — preserve Admin CRM through auth rollbacks

- Branch: `agent/preserve-crm-through-totp-rollout`
- Last reconciled head: `00391a5305de3b83edb2fbd80bcbcf40db1e0476`
- Gate: `APPROVE PR #161 MERGE`

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`
- Last reconciled head: `c528ad496f52200bf84e47fa84abe510f71ccf55`
- Queue/customer/provider launch gates and billing must remain OFF.
- Gate: `APPROVE PR #164 MERGE`

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`
- Last reconciled head: `0b97431e796e68d50c471fab0b0e4a399f6946ce`
- Queue/customer/provider launch gates and billing must remain OFF.
- Gate: `APPROVE PR #169 MERGE`

Merging any of these would still not authorize workflow dispatch, live IAM application, queue/provider activation, billing, email, charges, or production-data mutation.

## Active Solve Graph / Repository Audit work

### PR #188 — deterministic Python import relationships

- Branch: `agent/mac-solve-graph-python-imports`
- Exact head last reconciled: `b553db72f22cba9fd40dd9e5b4c368e90853c95a`
- Hosted CI/Rust are green.
- Trusted Mac validation remains pending/queued on `[self-hosted, macOS, ARM64]`.
- Do not merge until exact-head Trusted Mac validation actually completes successfully and the PR remains mergeable/review-clean.

The following safe Repository Audit PRs were opened from earlier `main` snapshots and must be refreshed/rebuilt against current `main` before merge. Re-run exact-head hosted and Trusted Mac checks after refresh where the branch uses the trusted Mac workflow:

- #193 `agent/mac-repository-audit-dependency-consistency` — last head `10c4e5daf90562c40198f46f206b65a4336147db`.
- #194 `agent/mac-repository-audit-coverage-map` — last head `aa211a374188292ee7f2fefdb0f909bd2fe6554c`.
- #195 `agent/mac-repository-audit-dead-code-candidates` — last head `06abfb09700b68955146297fa80792cff1f60571`.
- #196 `agent/mac-repository-audit-config-references` — last head `383b982ae5e4a0119a2cff1a4bcbe65bc642e5d3`.
- #197 `agent/mac-repository-audit-workflow-path-evidence` — last head `6bcb9d9aaeb185d4fc9d4c55f4e3aea709b43e60`.

Continue Repository Audit read-only-first after reconciling those branches: dependency consistency, conservative dead-code candidates, direct test/documentation/workflow evidence, framework/deployment/config relationships, deterministic IDs, bounded evidence, redaction, canonical evidence, browser/report composition, and cross-platform tests. Do not execute repository code to construct audit evidence.

## Trusted Mac runner path

`.github/workflows/trusted-mac-ci.yml` is merged on `main` and is intentionally limited to trusted pushes on `agent/mac-*`. It targets `[self-hosted, macOS, ARM64]` with read-only repository permissions.

Runner inventory is not directly available through the current connector. Infer only from GitHub Actions run/job metadata. A queued job means only that GitHub has not assigned it yet; do not guess why, interrupt another job, modify runner registration/services, weaken trusted-branch restrictions, or redirect untrusted PR code to the self-hosted Mac.

No existing Windows-targeted self-hosted workflow was found during the 2026-08-17 reconciliation. Do not invent Windows routing merely to bypass Mac queueing.

## Server Audit current state

Server Audit is a substantial local/read-only product, not a roadmap stub. Current `main` includes deterministic snapshot parsing, posture analysis, temporal consistency, inventory consistency, coverage-gap evidence, canonical JSON/HTML reports, and browser-local reporting.

Two older trusted-Mac hardening PRs remain open from earlier base snapshots and must be refreshed before merge:

- #190 `agent/mac-server-audit-command-surface-contract` — last head `2a5a103d2a8f3ea171f7047d4a06d7b0156745c8`.
- #191 `agent/mac-server-audit-snapshot-invariants` — last head `2524b18e9f11231d9de9989c3dd3237eaa3f95a5`.

Continue Server Audit with constrained read-only evidence only: reviewed collector command surface, OS/package/service/port/process/scheduled-job inventory, disk/log/cache/backup posture, web roots/domains/SSL/public-file checks, ownership/permission/version findings, bounded/redacted evidence, deterministic reports, and tests. No remote mutation or remediation execution.

## Language/runtime, customer priority, TOTP, billing, and hardening

Imported-file source provenance is already merged. Safe independent work may continue on formatter/linter, semantic/type checks, module/package design, diagnostics, editor support, deterministic tests, and cross-platform compatibility.

Customer-priority queue/provider/executor work may continue only as dormant build preparation: source integrity, retries/leases/DLQs, observability, preflight, entitlement enforcement, and safe browser/API readiness. Keep queue/customer/provider launch gates OFF and do not call real providers or consume production credits.

TOTP preparation may continue only as non-live validation/rollback/state-preservation code and tests. Do not create live KMS resources or enable TOTP.

Billing preparation may continue on webhook replay/idempotency, subscription lifecycle, checkout ownership, upgrades/downgrades/cancellation, payment-method management, failure recovery, refunds policy/tests, and preflight. Do not use live Stripe keys, create charges/refunds, or enable production billing.

Security/account hardening, least privilege, rollback, launch-readiness, stale issue/PR cleanup, and truth documentation remain valid independent safe work.

## Safe build order from this snapshot

1. Merge #188 only after exact-head Trusted Mac validation passes; otherwise continue independent safe work.
2. Refresh/rebuild #193-#197 on current `main` in dependency-safe order, rerun exact-head checks, and merge only non-production/review-clean work.
3. Refresh/rebuild #190/#191 before considering merge, preserving the newer merged Server Audit temporal/inventory/coverage work.
4. Continue Repository Audit and Solve Graph deterministic read-only intelligence.
5. Continue Server Audit read-only evidence and report quality.
6. Continue language/runtime/DX work.
7. Keep Admin live actions gated.
8. Keep #161/#164/#169 current and tested but unmerged until their exact owner approvals.
9. Continue dormant customer-priority, TOTP, and billing readiness while all production gates remain OFF.

## Safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, merge non-production PRs only after exact-head green + mergeable + review-clean validation, close/supersede stale duplicates with evidence, and keep truth docs current.

Do not automatically apply live AWS/IAM/KMS changes, deploy production, configure DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use Stripe live, charge/refund, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly production-sensitive work without its exact approval phrase.

If a production gate or queued trusted-runner validation blocks one track, record it and continue another safe engineering task instead of idling.
