# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-18

Before every build/integration run, re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, Trusted Mac and Trusted Windows workflow/job metadata, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-13.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

At this sync, `main` is `2bdc24835e08b9816b7100fd7a87c07b21c79c4e`, the merge of #244.

Recent safe merges relevant to the active train:

- #223 / #226 — Repository Audit evidence-completeness contract and deterministic report composition.
- #227 — bounded Server Audit process relationship findings.
- #229 — lockfile-only RustSec h2 advisory remediation; `h2` is at the fixed 0.4.16 line and cargo-audit remains mandatory.
- #230 — hosted mirror for exact-head Trusted Mac results.
- #231 / #233 — bounded Server Audit backup/log evidence consistency and deterministic/redacted report composition.
- #232 — push-only Trusted Windows validation for owner-controlled `agent/windows-*` branches plus hosted exact-head status mirroring.
- #235 — Trusted Mac concurrency uses `cancel-in-progress: false`, so newer pushes do not cancel running self-hosted validation.
- #236 — prior handoff refresh.
- #244 — bounded certificate-consistency evidence with certificate identities kept out of finding IDs.

Repository Audit already has bounded inventory/acquisition, deterministic Solve Graph reuse, redacted secret analysis, evidence completeness, impact/blast-radius intelligence, canonical evidence export, printable HTML, and browser-local reporting. Server Audit already has a strict bounded snapshot/schema parser, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, temporal/inventory/process/artifact analysis, explicit coverage gaps, bounded public-file marker checks, and deterministic/redacted JSON/HTML reporting.

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

- #161 `agent/preserve-crm-through-totp-rollout` — current observed head `1874d071fc47c1957fdcfdc57ea8af0cc884e043`; gate: `APPROVE PR #161 MERGE`.
- #164 `agent/customer-priority-production-preflight` — current observed head `62c71f475d14608b494b3c9077ec3f713b33c585`; gate: `APPROVE PR #164 MERGE`.
- #169 `agent/customer-priority-queue-foundation-rollout` — current observed head `b2007c4e0bbcfe20637e50ccc6ba23b21aca351a`; gate: `APPROVE PR #169 MERGE`.

Those heads currently predate `2bdc2483`; refresh them non-destructively when useful, but their approval gates remain mandatory. Their merge approvals would still not authorize workflow dispatch, live IAM/KMS, provider activation, email, charges/refunds, or production-data mutation.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for `agent/mac-*`, has read-only repository permissions, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. The hosted mirror publishes exact-head `trusted-mac-ci` commit status only after completion. Never infer success from a missing/queued/unobserved status, modify runner registration/services, weaken the branch restriction, or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, has read-only repository permissions, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Its hosted mirror publishes `trusted-windows-ci` only after completion. Use it for material cross-platform validation when available; never interrupt a busy runner or treat it as a substitute for an explicit Trusted Mac gate.

## Active highest-priority safe merge train

Live PR refs and workflow/check results are authoritative. The current dependency order is:

1. **#245 — Python import relationships / Repository Audit blast-radius reuse.** Head `186f7ca3cf410e782375f5188be8bb33fd7b3767`, based directly on current `main`. Hosted CI and Rust are green; merge only after exact-head `trusted-mac-ci=success`, mergeability, and review-thread checks remain clean. It supersedes #238.
2. **#246 → #247 → #248 → #249 → #250 — Repository Audit stacked successors.** They intentionally stack dependency consistency, coverage evidence, dead-code evidence, configuration references, then workflow-path evidence. Do not merge out of order. After each predecessor lands, retarget/reconcile the next PR to `main`, require fresh exact-head hosted CI/Rust and `trusted-mac-ci=success`, then merge with expected-head protection.
3. **#251 → #252 — Server Audit web-root permission and report composition.** #251 head `3d8ea96849c98e5e230339fc5fc40ea241d1a300` is directly on current `main`; hosted CI/Rust are green and exact-head `trusted-windows-ci=success` is still required. #252 intentionally depends on #251 and must be retargeted/revalidated after #251 lands. #251 supersedes #237; #252 supersedes #243.
4. **#253 — collector command-surface contract.** Head `e3f4e3779f2144aeca0835150490b56b3fe6a9a6`, one-file test-only rebuild on current `main`, superseding #211. Require hosted CI/Rust plus exact-head `trusted-mac-ci=success` before merge.
5. **#254 — snapshot resource invariants.** Head `b4de868e1c5072ec5cb02b4894c999137d756396`, two-file current-main rebuild, superseding stale #225. Require hosted CI/Rust plus exact-head `trusted-mac-ci=success` before merge. Close #225 only after #254 is fully validated as the successor.

Do not recreate #238-#242, #211, or #237; their current successors above preserve their intended scopes. Do not close #225 merely because #254 exists—close it only after the successor is fully validated.

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
