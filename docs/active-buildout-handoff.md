# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-18

Before every build/integration run, re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, Trusted Mac and Trusted Windows workflow/job metadata, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-13.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

At this sync, `main` is `4c267dfff45d9ee57af6f244154db888256178d0`, the safe non-production merge of #276.

Recent safe merges relevant to the active train:

- #229 — lockfile-only RustSec `h2` advisory remediation; `h2` is on the fixed 0.4.16 line and Rust/RustSec CI remains mandatory.
- #230 — hosted mirror for exact-head Trusted Mac results.
- #232 — push-only Trusted Windows validation for owner-controlled `agent/windows-*` branches plus hosted exact-head status mirroring.
- #235 — Trusted Mac concurrency uses `cancel-in-progress: false`, so newer pushes do not cancel running self-hosted validation.
- #260 — bounded Server Audit web-server/service/package cross-section relationship evidence.
- #264 — bounded public-file marker coverage/conflict evidence.
- #265 — bounded structural/redacted stale/zero-byte backup posture evidence.
- #276 — bounded package-version evidence that reports only missing/non-specific version posture and explicitly does not claim CVE/vulnerability knowledge.

Repository Audit already has bounded acquisition/inventory, deterministic Solve Graph reuse, redacted secret analysis, evidence completeness, impact/blast-radius intelligence, canonical evidence export, printable HTML, and browser-local reporting. Server Audit already has a strict bounded snapshot/schema parser, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, temporal/inventory/process/artifact analysis, explicit coverage gaps, bounded public-file marker checks, deterministic/redacted JSON/HTML reporting, and no remediation executor.

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

- #161 — gate: `APPROVE PR #161 MERGE`.
- #164 — gate: `APPROVE PR #164 MERGE`.
- #169 — gate: `APPROVE PR #169 MERGE`.

Their currently observed branches predate this checkpoint and should be replayed non-destructively when useful. Their merge approvals would still not authorize workflow dispatch, live IAM/KMS, provider activation, email, charges/refunds, or production-data mutation.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, has read-only repository permissions, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. The hosted mirror publishes exact-head `trusted-mac-ci` commit status only after completion. Never infer success from a missing/queued/unobserved status, modify runner registration/services, weaken the branch restriction, or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, has read-only repository permissions, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Its hosted mirror publishes `trusted-windows-ci` only after completion. Use it for material Windows/cross-platform validation when available; never interrupt a busy runner or treat it as a substitute for an explicit Trusted Mac gate.

## Active highest-priority safe merge train

Live PR refs and workflow/check results are authoritative.

1. **#277 — deterministic Python import relationships / Repository Audit blast-radius reuse.** Head `14ed1f5569607312bc039a0c2c4cbdde3663c46c`, exactly one commit over this checkpoint. It preserves the reviewed four-file #266 implementation on current `main`; #266 is closed unmerged as superseded. Hosted CI/Rust were still running at this sync, and exact-head `trusted-mac-ci=success` had not yet been published. Merge only after exact-head hosted CI, Rust, Trusted Mac, mergeability, and review-thread checks are all green/clean.
2. **Repository Audit successors #267-#271 and composition #275 are stale stacked work.** They still depend on the closed #266-era stack. Do not merge them out of order or pretend their old validation applies to #277. Rebuild/retarget successors after #277 lands, preserving each reviewed scope without force-pushing or overwriting newer main work.
3. **Server Audit Windows train:** #251/#252, #272/#273/#274 remain safe read-only/test-only work, but their current heads predate #276 or are stacked on older predecessors. #274 had exact-head hosted CI/Rust green before #276 advanced `main`; no exact-head `trusted-windows-ci=success` is claimed here. Refresh/rebuild on current `main` before merge and require the existing Trusted Windows result where the branch contract calls for it.
4. **Server Audit Trusted Mac train:** #253 and #254 remain test/parser hardening that explicitly require exact-head Trusted Mac in addition to hosted CI/Rust. Their current heads predate this checkpoint; rebuild rather than overwriting newer main changes.
5. **New independent Server Audit stages** may continue while self-hosted lanes are queued only when they are bounded, deterministic, redacted, read-only/analyze-only, and do not collide with an active report-composition file surface.

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
