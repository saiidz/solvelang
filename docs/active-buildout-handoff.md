# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout without duplicating merged work or treating repository state as production state.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-17  

Before acting, always re-read current `main`, open PR heads, exact-head CI/checks, review threads, trusted self-hosted job metadata, open issues, `ROADMAP.md`, and `docs/current-production-status-2026-08-13.md`.

## Current repository baseline

- `main` at this sync: `f5c855d9d7cb4a1ac507633ce7a59c3bb9dc6329`.
- PR #205 is merged: the durable handoff was rebuilt after the latest Server Audit merges.
- PR #204 is merged: Server Audit emits bounded informational coverage-gap findings for structurally absent snapshot sections and composes them into deterministic reports.
- PR #203 is merged: Server Audit inventory-consistency findings are composed into canonical deterministic reports.
- PR #201 is merged: Server Audit has deterministic bounded consistency checks for conflicting duplicate package, service, filesystem, and web-root evidence.
- PRs #198/#199 are merged: Server Audit has bounded timestamp/certificate/log temporal-consistency findings and deterministic report composition.
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

These PRs must not be merged by unattended build automation even when mergeable and green. Current `main` has advanced beyond their last recorded base, so keep them refreshed/tested without merging until exact owner approval.

### PR #161 — preserve Admin CRM through auth rollbacks

- Branch: `agent/preserve-crm-through-totp-rollout`
- Last observed head: `00391a5305de3b83edb2fbd80bcbcf40db1e0476`
- Gate: `APPROVE PR #161 MERGE`

### PR #164 — validation-only customer-priority production preflight

- Branch: `agent/customer-priority-production-preflight`
- Last observed head: `c528ad496f52200bf84e47fa84abe510f71ccf55`
- Queue/customer/provider launch gates and billing must remain OFF.
- Gate: `APPROVE PR #164 MERGE`

### PR #169 — dormant customer-priority production foundation rollout preparation

- Branch: `agent/customer-priority-queue-foundation-rollout`
- Last observed head: `0b97431e796e68d50c471fab0b0e4a399f6946ce`
- Queue/customer/provider launch gates and billing must remain OFF.
- Gate: `APPROVE PR #169 MERGE`

Merging any of these would still not authorize workflow dispatch, live IAM application, queue/provider activation, billing, email, charges, or production-data mutation.

## Active Solve Graph / Repository Audit work

### PR #213 — deterministic Python import relationships

- Branch: `agent/mac-solve-graph-python-imports-v2`
- Exact head at this sync: `f0f7d0e3b5f8c9d7535cea99de2c69118fb3805c`.
- Rebuilt directly from current `main` as the successor to stale #188.
- Restores the same four-file Python import scope plus focused deterministic regression tests.
- #188 is closed unmerged as superseded.
- Hosted CI/Rust and Trusted Mac validation must pass on the exact head before merge.

### Repository Audit successor PRs

The earlier #193-#197 branches were superseded by current-main rebuilds:

- #206 `agent/mac-repository-audit-dependency-consistency-v2` — bounded dependency consistency; hosted CI/Rust green on head `a531e761bc918d93c4a409bfd23cb79d102a906b`.
- #207 `agent/mac-repository-audit-coverage-map-v2` — direct test/documentation coverage evidence; hosted CI/Rust green on head `c6debd7bee10cfd565daf7c03557ba42ce5e63e4`.
- #208 `agent/mac-repository-audit-dead-code-candidates-v2` — conservative dead-code candidates; hosted CI/Rust green on head `a5e4bd878ca35ab464dc87f6efed5fc9742153af`.
- #209 `agent/mac-repository-audit-config-references-v2` — bounded configuration-reference evidence; hosted CI/Rust green on head `a257d2647e31a52e64ff4baca3f543f886902be4`.
- #210 `agent/mac-repository-audit-workflow-path-evidence-v2` — bounded workflow path evidence; hosted CI/Rust green on head `8db71c6235200d3452c8c91044afd9e2271b297b`.

Do not treat hosted CI as a substitute for the existing Trusted Mac workflow on `agent/mac-*` branches. Merge only after the exact head is mergeable, review-clean, and all intended exact-head validation is green.

After these land, continue Repository Audit read-only-first: report/browser composition, framework/deployment/config relationships, deterministic IDs, bounded evidence, redaction, canonical evidence, affected-tests/workflows reasoning, architecture/security path summaries, and cross-platform tests. Do not execute repository code to construct audit evidence.

## Trusted Mac runner path

`.github/workflows/trusted-mac-ci.yml` is merged on `main` and is intentionally limited to trusted pushes on `agent/mac-*`. It targets `[self-hosted, macOS, ARM64]` with read-only repository permissions.

Runner inventory is not directly available through the current connector. Infer only from GitHub Actions run/job metadata. A queued job means only that GitHub has not assigned it yet; do not guess why, interrupt another job, modify runner registration/services, weaken trusted-branch restrictions, or redirect untrusted PR code to the self-hosted Mac.

No existing Windows-targeted self-hosted workflow has been found in repository workflow metadata during the current reconciliation. Do not invent Windows routing merely to bypass Mac queueing.

## Server Audit current state

Server Audit is a substantial local/read-only product, not a roadmap stub. Current `main` includes deterministic snapshot parsing, posture analysis, temporal consistency, inventory consistency, coverage-gap evidence, canonical JSON/HTML reports, and browser-local reporting.

The earlier #190/#191 trusted-Mac hardening PRs were superseded by current-main rebuilds:

- #211 `agent/mac-server-audit-command-surface-contract-v2` — pins the reviewed read-only collector executable surface; hosted CI/Rust green on head `fc68c2aa94aafd746740638aa98a40087fd23fdd`.
- #212 `agent/mac-server-audit-snapshot-invariants-v2` — rejects impossible memory/filesystem capacity snapshots; hosted CI/Rust green on head `9e2e96a99ecc95bfbbfadcdc6ee5ebd93d3d113a`.

Continue Server Audit with constrained read-only evidence only: reviewed collector command surface, OS/package/service/port/process/scheduled-job inventory, disk/log/cache/backup posture, web roots/domains/SSL/public-file checks, ownership/permission/version findings, bounded/redacted evidence, deterministic reports, and tests. No remote mutation or remediation execution.

## Language/runtime, customer priority, TOTP, billing, and hardening

Imported-file source provenance is already merged. Safe independent work may continue on formatter/linter, semantic/type checks, module/package design, diagnostics, editor support, deterministic tests, and cross-platform compatibility.

Customer-priority queue/provider/executor work may continue only as dormant build preparation: source integrity, retries/leases/DLQs, observability, preflight, entitlement enforcement, and safe browser/API readiness. Keep queue/customer/provider launch gates OFF and do not call real providers or consume production credits.

TOTP preparation may continue only as non-live validation/rollback/state-preservation code and tests. Do not create live KMS resources or enable TOTP.

Billing preparation may continue on webhook replay/idempotency, subscription lifecycle, checkout ownership, upgrades/downgrades/cancellation, payment-method management, failure recovery, refunds policy/tests, and preflight. Do not use live Stripe keys, create charges/refunds, or enable production billing.

Security/account hardening, least privilege, rollback, launch-readiness, stale issue/PR cleanup, and truth documentation remain valid independent safe work.

## Safe build order from this snapshot

1. Finish #213 exact-head hosted + Trusted Mac validation; merge it first if fully green/review-clean/mergeable.
2. Reconcile #206-#210 after any main advancement and merge non-production Repository Audit successors only after exact-head Trusted Mac validation passes.
3. Reconcile #211/#212 after any main advancement and merge them only after exact-head Trusted Mac validation passes.
4. Continue Repository Audit/Solve Graph deterministic read-only intelligence and product/report composition.
5. Continue Server Audit read-only evidence and report quality.
6. Continue language/runtime/DX work.
7. Keep Admin live actions gated.
8. Keep #161/#164/#169 current and tested but unmerged until their exact owner approvals.
9. Continue dormant customer-priority, TOTP, and billing readiness while all production gates remain OFF.

## Safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, merge non-production PRs only after exact-head green + mergeable + review-clean validation, close/supersede stale duplicates with evidence, and keep truth docs current.

Do not automatically apply live AWS/IAM/KMS changes, deploy production, configure DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use Stripe live, charge/refund, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly production-sensitive work without its exact approval phrase.

If a production gate or queued trusted-runner validation blocks one track, record it and continue another safe engineering task instead of idling.
