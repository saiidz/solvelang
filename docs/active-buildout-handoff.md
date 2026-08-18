# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-18

Before every build run, re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, Trusted Mac and Trusted Windows workflow/job metadata, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-13.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

At this sync, `main` is `87ab6a42af3a72cdd36aff8c85d0b7da75610e58`.

Recent safe merges relevant to the active train:

- #223 / #226 — Repository Audit evidence-completeness contract and deterministic report composition.
- #227 — bounded Server Audit process relationship findings.
- #229 — lockfile-only RustSec h2 advisory remediation; current Rust audit is expected to remain clean before later merges.
- #230 — hosted mirror for exact-head Trusted Mac results.
- #231 / #233 — bounded Server Audit backup/log evidence consistency and deterministic/redacted report composition.
- #232 — push-only Trusted Windows validation for owner-controlled `agent/windows-*` branches plus a hosted exact-head status mirror.
- #235 — Trusted Mac concurrency now uses `cancel-in-progress: false`, so a newer push cannot cancel a running self-hosted Mac validation.

Repository Audit already has bounded inventory/acquisition, deterministic Solve Graph reuse, redacted secret analysis, evidence completeness, impact/blast-radius intelligence, canonical evidence export, printable HTML, and browser-local reporting. Server Audit already has a strict bounded snapshot/schema parser, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security evidence, temporal/inventory/process/artifact analysis, explicit coverage gaps, bounded public-file marker checks, and deterministic/redacted JSON/HTML reporting.

## Authoritative production truth

Until a newer live audit exists, `docs/current-production-status-2026-08-13.md` is authoritative:

- API access: **enabled**;
- customer accounts/password authentication: **enabled**;
- ordinary password login sends email: **no**;
- authenticator-app TOTP: **disabled**;
- dedicated production TOTP KMS key: **not created**;
- subscription billing: **disabled**;
- production billing webhook path: **disabled by feature boundary**;
- paid customer priority: **disabled**;
- real charge authorization: **none**.

A merged feature or green CI result is never evidence that a production-sensitive feature has been enabled.

## Immediate Admin boundary

Safe repository preparation for the immediate Admin Gateway step is complete through #168/#172. The next action is a live IAM mutation and is separately gated:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Gateway deployment, private HTTPS/DNS/Zero-Trust ingress, Admin publication, and login/session canaries remain separate production approvals. Never publish the Admin UI on the public customer origin as a shortcut.

## Protected production-sensitive PRs

Keep these open, tested, review-clean, and safely reconciled with current `main`, but never auto-merge them:

- #161 `agent/preserve-crm-through-totp-rollout` — current observed head `656881bc7b8f894297eef01644cb19a502239540`; gate: `APPROVE PR #161 MERGE`.
- #164 `agent/customer-priority-production-preflight` — current observed head `121d85beaecdf9d510ec56af37851cce68d5d42c`; gate: `APPROVE PR #164 MERGE`.
- #169 `agent/customer-priority-queue-foundation-rollout` — current observed head `9f1a0b92a9e9b128a8ae32d95b54e49aace6f003`; gate: `APPROVE PR #169 MERGE`.

Their merge approvals would still not authorize workflow dispatch, live IAM/KMS, provider activation, email, charges/refunds, or production-data mutation.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for `agent/mac-*`, has read-only repository permissions, targets `[self-hosted, macOS, ARM64]`, and after #235 does not cancel a running validation. The hosted mirror publishes exact-head `trusted-mac-ci` commit status. Never infer success from a queued/unobserved run, modify runner registration/services, weaken the branch restriction, or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, has read-only repository permissions, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Its hosted mirror publishes `trusted-windows-ci` only after completion. Use it for material cross-platform validation when available; never interrupt a busy runner or treat it as a substitute for an explicit Trusted Mac gate.

## Active highest-priority safe train

1. **#224 — Python import relationships / Repository Audit blast-radius reuse.** Current observed head `6834cee73d491815d7444071e76934e2d19314c2`; GitHub-hosted CI/Rust are green. Its exact-head Trusted Mac run is queued/retried and must finish green before merge. Because `main` advanced for CI-safety work, re-check mergeability and exact-head ancestry immediately before any merge.
2. **#206-#210 — Repository Audit successors.** Reconcile in dependency order after #224 so none overwrite newer graph work. Require exact-head hosted CI/Rust and the repository-declared Trusted Mac requirement before merge.
3. **#211 / #225 — Server Audit trusted-Mac hardening.** #211 pins the collector executable surface; #225 preserves newer parser work while rejecting impossible memory/filesystem snapshots. Reconcile on the then-current main and require the declared Mac gate.
4. **#234 — bounded Server Audit web-root permission findings.** This read-only stage reports world-writable roots as strong integrity-risk evidence, group-writable roots conservatively as review candidates, redacts path/owner values from findings, and caps output deterministically. It uses an `agent/windows-*` branch for cross-platform validation and should not jump ahead of #224 if doing so would unnecessarily stale the graph merge train.

All Repository Audit/Solve Graph construction remains deterministic, bounded, analyze-only, and non-executing. All Server Audit work remains constrained/read-only with redacted evidence and no remediation execution.

## Next safe engineering backlog

After the active merge train, continue in this order while re-evaluating live state every run:

1. Repository Audit dependency consistency, conservative dead-code evidence, direct test/documentation mapping, framework/deployment/config relationships, deterministic IDs, canonical/browser evidence, and cross-platform tests.
2. Solve Graph richer language adapters, query/path/impact quality, affected-tests/workflows mapping, architecture/security path summaries, MCP/Codex integration quality, and local visual explorer improvements.
3. Server Audit read-only ownership/permission/version findings, package/service/port/process/scheduled-job relationships, disk/log/cache/backup posture, web roots/domains/SSL/public-file evidence, bounded JSON/HTML report quality, and cross-platform tests.
4. Language/runtime/DX: formatter/linter, semantic/type checks, `for` loops, module/package design, richer diagnostics, editor support, and deterministic cross-platform tests.
5. Dormant customer-priority foundations only while queue/customer/provider gates remain OFF: source integrity, retries/leases/DLQs, observability, validation-only preflight, account/entitlement enforcement, and safe browser/API readiness.
6. TOTP preparation only while production TOTP remains OFF: non-live IAM/KMS/preflight/deployment validation code, rollback/state preservation, canary planning, and tests.
7. Billing preparation only while production billing remains OFF: webhook replay/idempotency, checkout ownership, subscription lifecycle, upgrades/downgrades/cancellation, payment-method management, failure recovery, refunds policy/tests, and validation-only preflight.
8. Security/account hardening, least privilege, launch readiness, rollback, operations, and stale issue/PR cleanup remain independent safe work.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use Stripe live, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or queued self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
