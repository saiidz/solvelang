# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing the SolveLang buildout without duplicating merged work or treating repository state as production state.  
**Repository:** `saiidz/solvelang`  
**Repository state captured:** 2026-08-18

Before acting, re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, trusted self-hosted job metadata, `.github/workflows`, `ROADMAP.md`, and `docs/current-production-status-2026-08-13.md`. Never infer production state from merged code or green CI.

## Current repository baseline

- `main` at this sync: `016d59214fe7676b23c932a7c842ac22e55bde5f`.
- PR #223 is merged: Repository Audit has a bounded evidence-completeness contract that distinguishes complete, partial, unavailable, and truncated intelligence instead of overstating scan coverage.
- PR #226 is merged: evidence completeness is composed into deterministic product JSON/HTML reporting.
- PR #227 is merged: Server Audit now adds bounded, point-in-time process relationship findings for zombie observations, missing parent PIDs, and listener/process-name mismatches, with explicit process-churn/visibility limitations and no remediation execution.
- Repository Audit already includes bounded deterministic inventory, archive/GitHub acquisition boundaries, Solve Graph reuse, redacted secret analysis, impact/blast-radius intelligence, canonical evidence export, printable HTML, and browser-local reporting.
- Server Audit is a substantial local/read-only product with strict snapshot parsing/schema alignment, deterministic temporal/inventory/process analysis, coverage-gap truth, bounded public-file marker checks, deterministic/redacted JSON/HTML reports, and browser-local evidence presentation.
- Admin Gateway rollout machinery is merged through #168 and deterministic private Admin console publication preparation is merged through #172. No live rollout is implied by those merges.

## Authoritative production truth

Until a newer live audit is performed, `docs/current-production-status-2026-08-13.md` remains the production-state source of truth:

- API access: **enabled**;
- customer accounts/password authentication: **enabled**;
- ordinary password login sends email: **no**;
- authenticator-app TOTP: **disabled**;
- dedicated production TOTP KMS key: **not created**;
- subscription billing: **disabled**;
- production billing webhook path: **disabled by feature boundary**;
- paid customer priority: **disabled**;
- real charge authorization: **none**.

Merged code, green CI, rollout workflows, or deployable artifacts are not evidence that a production feature is enabled.

## Admin console / private gateway

All known safe repository preparation for the immediate Admin Gateway step is complete. The next action is a live IAM mutation and remains separately controlled:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Later production gates remain separate for gateway deployment, private HTTPS/DNS/Zero-Trust ingress, static Admin console publication, and login/session canaries. Never publish the Admin UI on the public customer origin as a shortcut.

## Protected production-sensitive PRs

These PRs must remain unmerged during unattended build automation even when mergeable and green. Refresh/test them on current `main` without replacing newer history or changing production gates.

- **#161** `agent/preserve-crm-through-totp-rollout` — observed head before the #227 main advance: `7b7aee6c6d06864a9973eb6d86fb94deb905918d`; hosted CI/API Access CI/Rust green. Gate: `APPROVE PR #161 MERGE`.
- **#164** `agent/customer-priority-production-preflight` — observed head before the #227 main advance: `414cf42d4d75d3c4fb1cbe672e378fec7b1b3669`; hosted CI/API Access CI/Customer Priority Production CI/Rust green. Gate: `APPROVE PR #164 MERGE`.
- **#169** `agent/customer-priority-queue-foundation-rollout` — observed head before the #227 main advance: `58a7ef1ece2b0821cbb8ce9a613b8151f5b433b0`; hosted CI/API Access CI/Foundation Rollout CI/Rust green. Gate: `APPROVE PR #169 MERGE`.

The #227 merge advanced `main`; replay these protected branches safely before treating those heads as current. Merging them would still not authorize workflow dispatch, live IAM application, queue/provider activation, billing, email, charges, or production-data mutation.

## Active Solve Graph / Repository Audit work

### #224 — deterministic Python import relationships

- Branch: `agent/mac-solve-graph-python-imports-v3`.
- Observed head before the #227 main advance: `1ff9643e687b76fc88edc822f06b3bb06b12370d`.
- Successor to closed/unmerged #213 and earlier #188.
- Adds bounded lexical `.py`/`.pyi` import extraction without executing repository code, resolves only repository-local modules/packages, composes Python relationships with the JavaScript/TypeScript graph, and reuses the graph in Repository Audit impact analysis.
- Hosted CI/Rust were green and the PR review-thread clean before the latest main advance.
- Refresh on current `main` and require exact-head hosted CI/Rust plus verifiably green Trusted Mac before merge.

### Repository Audit successor PRs

Observed heads before the #227 main advance:

- #206 `agent/mac-repository-audit-dependency-consistency-v2` — `4715a67ba0e6be60232920b2e182155ac1919e61`.
- #207 `agent/mac-repository-audit-coverage-map-v2` — `3f1c06bbecd83547b43b75efe86851166c75b3f1`.
- #208 `agent/mac-repository-audit-dead-code-candidates-v2` — `6c6b2099f23702ae29ca4a696fc2d3a8a5292518`.
- #209 `agent/mac-repository-audit-config-references-v2` — `6dbb90d18391016f5d7024e2213cf508f5043e60`.
- #210 `agent/mac-repository-audit-workflow-path-evidence-v2` — `d91c2dd8a3272c59a07b30d21b8581eb3ec1a1a9`.

All are analyze-only. The #227 main advance does not overlap their intended files, but each must still be replayed/refreshed without losing newer main changes. Require exact-head hosted CI/Rust and the existing Trusted Mac gate before merging any `agent/mac-*` branch.

After those land, continue Repository Audit/Solve Graph with deterministic report/browser composition, richer framework/deployment/config relationships, affected-tests/workflows reasoning, architecture/security path summaries, MCP/Codex integration quality, local visual explorer improvements, bounded/redacted evidence, stable IDs, and cross-platform tests.

## Trusted Mac and Windows runner policy

`.github/workflows/trusted-mac-ci.yml` is merged on `main`, push-only for trusted `agent/mac-*` branches, read-only for repository permissions, and targets `[self-hosted, macOS, ARM64]`.

Runner inventory is not directly available through the current connector. Infer state only from GitHub Actions run/job metadata. Do not guess that a queued or unobserved job passed, interrupt another job, modify runner registration/services, weaken branch restrictions, or redirect untrusted PR code to the self-hosted Mac.

No dedicated Windows-targeted repository workflow was identified in the latest reconciliation. Use an existing Windows self-hosted workflow only if repository metadata already targets it and the job is idle/available. Do not invent Windows routing merely to bypass queueing.

## Server Audit current state

Current `main` includes:

- strict bounded snapshot parser and aligned JSON schema;
- deterministic OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security evidence handling;
- temporal consistency and duplicate/inventory consistency analysis;
- bounded point-in-time process relationship findings with explicit churn/visibility caveats;
- explicit coverage-gap / `not collected` truth;
- bounded existence-only sensitive public-file marker checks with no content reads;
- deterministic/redacted JSON and self-contained HTML reports;
- browser-local reporting that preserves absent-vs-empty inventory meaning.

Trusted-Mac hardening successors observed before the #227 main advance:

- #211 `agent/mac-server-audit-command-surface-contract-v2` — `3b3272b2f4260ab088167b00fee3737eea8c0398`; hosted CI/Rust green; Trusted Mac required.
- #225 `agent/mac-server-audit-snapshot-invariants-v3` — `4b6e1a12a026d3f02e5106a8d4aa5add89c7ccb9`; hosted CI/Rust green; Trusted Mac required.
- #212 is closed unmerged as superseded by #225 so stale parser history cannot overwrite newer Server Audit work.

Replay #211/#225 on current main before merge validation. Continue Server Audit only with constrained read-only evidence; no remote mutation or remediation execution.

## Language/runtime and DX

Imported-file source provenance is already merged. Safe independent work may continue on formatter/linter, semantic/type checks, `for` loops, module/package design, richer diagnostics, editor support, deterministic tests, and cross-platform compatibility. Preserve current language compatibility unless a deliberate versioned change is made.

## Customer priority, TOTP, billing, and hardening

Customer-priority work may continue only as dormant build preparation: source integrity, retries/leases/DLQs, observability, validation-only preflight, entitlement/account enforcement, and browser/API readiness. Keep queue/customer/provider launch gates OFF, do not call real providers, and do not consume production credits.

TOTP preparation may continue only as non-live IAM/KMS/preflight/deployment validation code, rollback/state-preservation logic, canary planning, and tests. Do not create live KMS resources or enable production TOTP.

Billing preparation may continue on webhook replay/idempotency, checkout ownership, subscription lifecycle, upgrades/downgrades/cancellation, payment-method management, failure recovery, refunds policy/tests, and preflight. Do not use live Stripe keys, create charges/refunds, or enable production billing.

Security/account hardening, least privilege, rollback, launch-readiness, operations, stale issue/PR cleanup, and truth documentation remain valid independent safe work.

## Safe build order from this snapshot

1. Refresh #224 on current main; merge it only after exact-head hosted + Trusted Mac validation is verifiably green.
2. Refresh #206-#210 and merge non-production successors in dependency order only after exact-head hosted + Trusted Mac validation.
3. Refresh #211/#225 and merge only after exact-head Trusted Mac validation passes.
4. Continue Repository Audit / Solve Graph deterministic read-only intelligence and report/browser composition.
5. Continue Server Audit read-only evidence/report quality.
6. Continue language/runtime/DX work.
7. Keep Admin live actions gated.
8. Refresh but do not merge #161/#164/#169 until exact owner approval.
9. Continue dormant customer-priority, TOTP, billing, security, and operations readiness while production gates remain OFF.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, rerun hosted CI, close/supersede duplicates with evidence, merge non-production PRs only after exact-head green + mergeable + review-clean validation, and keep truth docs current.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use Stripe live, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or queued/unverifiable trusted-runner validation blocks one track, record it and continue another safe engineering task instead of idling.
