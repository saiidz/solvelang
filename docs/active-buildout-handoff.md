# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing SolveLang without duplicating merged work or treating repository state as production state.  
**Repository:** `saiidz/solvelang`  
**Captured:** 2026-08-18

Before acting, re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, trusted self-hosted job metadata, `.github/workflows`, `ROADMAP.md`, and `docs/current-production-status-2026-08-13.md`. A merged feature or green workflow is never evidence that a production feature is enabled.

## Current main

At this sync `main` is `016d59214fe7676b23c932a7c842ac22e55bde5f`.

Recently merged safe read-only work:

- #223 — Repository Audit evidence-completeness contract: complete/partial/unavailable/truncated truth.
- #226 — evidence completeness composed into deterministic product JSON/HTML reporting.
- #227 — bounded Server Audit process relationship findings for point-in-time zombie observations, missing parent PIDs, and listener/process-name mismatches, with explicit churn/visibility limitations and no remediation execution.

Repository Audit already includes bounded inventory, archive/GitHub acquisition boundaries, Solve Graph reuse, redacted secret analysis, impact/blast-radius intelligence, canonical evidence export, printable HTML, and browser-local reporting. Server Audit already includes strict bounded snapshot parsing/schema alignment, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security evidence, temporal/inventory/process analysis, explicit coverage gaps, bounded public-file marker checks, deterministic/redacted JSON/HTML reports, and browser-local evidence presentation.

Admin Gateway rollout machinery is merged through #168 and deterministic private Admin console publication preparation through #172. Those merges do not authorize live rollout.

## Authoritative production truth

Until a newer live audit exists, `docs/current-production-status-2026-08-13.md` is authoritative:

- API access: **enabled**;
- customer accounts/password authentication: **enabled**;
- ordinary password login sends email: **no**;
- authenticator-app TOTP: **disabled**;
- dedicated production TOTP KMS key: **not created**;
- subscription billing: **disabled**;
- billing webhook path: **disabled by feature boundary**;
- paid customer priority: **disabled**;
- real charge authorization: **none**.

## Admin gate

All currently known safe repository preparation for the immediate Admin Gateway step is complete. The next action is a live IAM mutation and remains separately controlled:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Later gateway deployment, private HTTPS/DNS/Zero-Trust ingress, Admin publication, and login/session canaries remain separate production gates. Never publish the Admin UI on the public customer origin as a shortcut.

## Protected production-sensitive PRs

Keep these open, tested, and review-clean, but do not merge them without the exact owner phrase. Their last green heads were based on the pre-#227 main and must be replayed safely before any eventual approved merge:

- #161 `agent/preserve-crm-through-totp-rollout` — `7b7aee6c6d06864a9973eb6d86fb94deb905918d`; CI/API Access/Rust green. Gate: `APPROVE PR #161 MERGE`.
- #164 `agent/customer-priority-production-preflight` — `414cf42d4d75d3c4fb1cbe672e378fec7b1b3669`; CI/API Access/Customer Priority Production CI/Rust green. Gate: `APPROVE PR #164 MERGE`.
- #169 `agent/customer-priority-queue-foundation-rollout` — `58a7ef1ece2b0821cbb8ce9a613b8151f5b433b0`; CI/API Access/Foundation Rollout CI/Rust green. Gate: `APPROVE PR #169 MERGE`.

Queue/customer/provider launch gates and billing remain OFF. A protected PR merge would still not authorize workflow dispatch, live IAM, provider activation, email, charges, or production-data mutation.

## Trusted Mac policy

`.github/workflows/trusted-mac-ci.yml` is push-only for trusted `agent/mac-*` branches, read-only for repository permissions, and targets `[self-hosted, macOS, ARM64]`.

Runner inventory is not directly available through the current connector. The connector can read PR-triggered workflow runs but does not expose enough push-run inventory to prove an exact-head Trusted Mac success. Never infer success from an unobserved/queued job, interrupt another job, change runner registration/services, weaken branch restrictions, or route untrusted code to the Mac.

No dedicated Windows-targeted repository workflow was found in the latest reconciliation. Use Windows only if an already-configured repository workflow targets it and job metadata shows it is available; never invent routing to bypass queueing.

## Active Solve Graph / Repository Audit successors

These branches were replayed without force onto `016d59214fe7676b23c932a7c842ac22e55bde5f`; fresh hosted validation was triggered. Require exact-head hosted CI/Rust **and** verifiably green Trusted Mac before merging any of them:

- #224 `agent/mac-solve-graph-python-imports-v3` — `37f71034f025299e32af7604d70d1e73b6eac632`; deterministic bounded lexical `.py`/`.pyi` import relationships and Repository Audit impact reuse.
- #206 `agent/mac-repository-audit-dependency-consistency-v2` — `81ac0da72985cfef66cc2c8e2de402cc5959979d`.
- #207 `agent/mac-repository-audit-coverage-map-v2` — `fcfe38ba4f11abcfd14020440eb165fc4ee318d7`.
- #208 `agent/mac-repository-audit-dead-code-candidates-v2` — `6c285512a8135f1f7dc408c835178306a5a67b49`.
- #209 `agent/mac-repository-audit-config-references-v2` — `223f69a0b8eaa5ee44fbaa17db54d3a308277042`.
- #210 `agent/mac-repository-audit-workflow-path-evidence-v2` — `860afbfa92a6e4b70a366ce3ac0b4891ef0862af`.

All graph/audit construction remains deterministic, bounded, analyze-only, and non-executing. Do not run repository code, hooks, package managers, or networked repository logic to construct evidence.

After these land, continue deterministic product/browser composition, framework/deployment/config relationships, affected-tests/workflows reasoning, architecture/security path summaries, MCP/Codex integration quality, local visual explorer improvements, bounded/redacted evidence, stable IDs, and cross-platform tests.

## Active Server Audit hardening

These trusted-Mac branches were also replayed without force onto current main; fresh hosted validation was triggered and Trusted Mac is still required:

- #211 `agent/mac-server-audit-command-surface-contract-v2` — `9e2d2f25ba1a46ea7b98e93d930185bbc2e0c2d8`; pins the reviewed read-only collector executable surface.
- #225 `agent/mac-server-audit-snapshot-invariants-v3` — `f19085fde3fc991f7f7ce7da04ad946678ed622a`; rejects impossible memory/filesystem capacity snapshots while preserving newer process/public-file parser work.
- #212 is closed unmerged as superseded by #225 so stale parser history cannot overwrite newer Server Audit work.

Continue Server Audit only with constrained allowlisted read-only collection, bounded/redacted evidence, deterministic findings/reports, and tests. No remote mutation or remediation execution.

## Language/runtime, customer priority, TOTP, billing, security

Imported-file source provenance is already merged. Safe language/DX work may continue on formatter/linter, semantic/type checks, `for` loops, module/package design, richer diagnostics, editor support, deterministic tests, and cross-platform compatibility.

Customer priority may continue only as dormant build preparation: source integrity, retries/leases/DLQs, observability, validation-only preflight, entitlement/account enforcement, and safe browser/API readiness. Do not enable queue/customer/provider gates, call real providers, or consume production credits.

TOTP preparation may continue only as non-live IAM/KMS/preflight/deployment validation code, rollback/state-preservation logic, canary planning, and tests. Do not create live KMS resources or enable TOTP.

Billing preparation may continue on webhook replay/idempotency, checkout ownership, subscription lifecycle, upgrades/downgrades/cancellation, payment-method management, failure recovery, refunds policy/tests, and preflight. Do not use live Stripe keys, create charges/refunds, or enable billing.

Security/account hardening, least privilege, rollback, launch-readiness, operations, stale issue/PR cleanup, and truth documentation remain valid independent safe work.

## Safe build order

1. Finish exact-head hosted + Trusted Mac validation for #224 and merge only when all gates are verifiably green and review-clean.
2. Validate/reconcile #206-#210 in dependency order; merge only with exact-head hosted + Trusted Mac success.
3. Validate/reconcile #211/#225; merge only with exact-head Trusted Mac success.
4. Continue Repository Audit / Solve Graph deterministic read-only intelligence and report/browser composition.
5. Continue Server Audit read-only evidence/report quality.
6. Continue language/runtime/DX work.
7. Keep Admin live actions gated.
8. Replay but do not merge #161/#164/#169 until exact owner approval.
9. Continue dormant customer-priority, TOTP, billing, security, and operations readiness while production gates remain OFF.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings/CI, rerun hosted CI, close/supersede duplicates with evidence, merge non-production PRs only after exact-head green + mergeable + review-clean validation, and keep truth docs current.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use Stripe live, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or queued/unverifiable trusted-runner validation blocks one track, record it and continue another safe engineering task instead of idling.
