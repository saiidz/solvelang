# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust, Trusted Mac/Windows state, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-13.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

The safe non-production queue was drained to zero before this truth-sync branch was opened. Protected production-sensitive/preparation PRs #161, #164, and #169 are intentionally excluded from that threshold and remain unmerged.

Immediately before this truth sync, `main` was `31f03c77e2272b4a64f57c3b0f4b5ae336b25158`, the safe merge of #322. This document intentionally avoids treating its own eventual merge SHA as durable truth; re-read `main` at the next run.

Recent integration milestones that must not be recreated:

- #229 — RustSec `h2` advisory remediation; Rust/RustSec CI remains mandatory.
- #230/#232/#235 — Trusted Mac/Windows status mirroring and non-cancelling Trusted Mac concurrency foundations.
- #288 → #290 → #291 → #298 → #299 → #300 → #301 — deterministic Python imports, dependency consistency, direct test/documentation mapping, conservative dead-code evidence, configuration references, workflow-path evidence, and Repository Audit evidence composition.
- #311/#313/#314 — bounded changed-path affected-test/workflow mapping, pipeline composition, and canonical affected-validation evidence.
- #317/#319 — bounded deterministic architecture/security-boundary path summaries and pipeline composition.
- #322 — standalone deterministic integrity-covered architecture-path evidence artifact. #320 was closed unmerged only after #322 was verified on newer `main` with the same reviewed two-file scope.
- #307/#309 — current-history Server Audit listener consistency and certificate-identity redaction hardening.
- #308/#312 — repository-only Admin Gateway IAM/preflight corrections; these did not live-apply IAM or deploy anything.
- #321 — repository-only preparation for separately gated static Admin UI publication. It did not publish the Admin UI or prove a live Cloudflare/AWS/DNS/Access change.

## Repository Audit state

Repository Audit is an active bounded read-only product surface. Merged capabilities include repository ingestion/inventory, deterministic Solve Graph reuse, JavaScript/TypeScript and Python import/reference evidence, dependency consistency, direct test/documentation mapping, conservative dead-code candidates, configuration/workflow-path relationships, impact/blast-radius analysis, changed-path affected-test/workflow mapping, architecture/security-boundary path summaries, a standalone integrity-covered architecture-path evidence artifact, secret redaction, evidence-completeness truth, deterministic IDs/order, canonical report contracts, and browser-local reporting.

Current safe Repository Audit priorities:

1. browser/canonical ergonomics for the merged architecture/security-path evidence without breaking historical strict report schemas;
2. remaining bounded framework/deployment relationships;
3. richer query/path/impact and evidence quality;
4. MCP/Codex integration quality;
5. local visual explorer improvements;
6. deterministic cross-platform validation.

Repository Audit construction remains analyze-only and non-executing. Write/remediation mode is not enabled.

## Server Audit state

Server Audit includes a strict bounded snapshot/schema parser, fixed read-only collector surface, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, permission/ownership/privacy/consistency hardening, deterministic redacted JSON/HTML findings, and no remediation executor.

Continue read-only relationship/posture quality, version evidence without unsupported CVE claims, bounded redaction, deterministic IDs, and cross-platform parser/report validation. Do not add remote mutation/remediation execution.

## Protected production-sensitive preparation

Keep these PRs refreshed, tested, mergeable, and review-clean, but never auto-merge them:

- #161 — account/CRM rollback preservation. Exact merge gate: `APPROVE PR #161 MERGE`.
- #164 — validation-only production customer-priority preflight. Exact merge gate: `APPROVE PR #164 MERGE`.
- #169 — dormant production customer-priority foundation rollout preparation. Exact merge gate: `APPROVE PR #169 MERGE`.

Do not rely on hashes recorded in older handoffs for these PRs. Re-read the live PR heads each run. After `main` advances, replay them non-destructively on settled current history and rerun their required Hosted CI; a previous green run does not prove a refreshed head is green. Their open state never authorizes deployment or activation.

## Authoritative production truth

Until a newer live audit exists, `docs/current-production-status-2026-08-13.md` remains authoritative:

- API access: **enabled**;
- customer accounts/password authentication: **enabled**;
- ordinary password login sends email: **no**;
- authenticator-app TOTP: **disabled**;
- dedicated production TOTP KMS key: **not created**;
- subscription billing: **disabled**;
- production billing webhook path: **disabled by feature boundary**;
- paid customer priority: **disabled**;
- real charge authorization: **none**.

A repository merge or green CI result is never evidence that a production-sensitive feature has been enabled or a production rollout has completed.

## Admin production boundary

Repository preparation and live production actions are separate. Two distinct approval gates are currently visible:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

`APPROVE ADMIN STATIC UI PRODUCTION PUBLICATION`

Neither phrase authorizes the other step. They also do not authorize later CloudFormation recovery/retry, gateway deployment, private ingress/DNS/Zero Trust configuration, or canaries unless those actions receive their own explicit authorization.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. The hosted mirror publishes exact-head `trusted-mac-ci` only after completion. Missing/queued/unobserved status is not success. Never modify runner registration/services or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Use it when materially useful for Windows/cross-platform behavior. Never interrupt a busy runner or treat Windows as a substitute for an explicit Trusted Mac gate.

## Safe queue policy

When more than six safe non-production PRs are open, drain the existing queue before starting unrelated feature work. Refresh stale branches, retarget dependency stacks, fix CI/review findings, close verified superseded predecessors, and merge only exact-head green, mergeable, review-clean, non-production work. Protected #161/#164/#169 are excluded because their open state is intentional.

When the safe queue is six or fewer, new safe work may proceed only after live repository state is reconciled and merged scopes are checked to avoid duplication.

## Current safe engineering order

1. Keep shared Hosted CI/Rust/RustSec blockers clear.
2. Continue Repository Audit browser/canonical architecture-evidence ergonomics, framework/deployment relationships, query/evidence quality, MCP/Codex integration, visual explorer quality, and cross-platform tests.
3. Continue Solve Graph richer language/reference adapters, query/path/impact quality, affected-test/workflow intelligence, and architecture/security summaries.
4. Continue Server Audit read-only relationship/posture quality and deterministic cross-platform tests.
5. Continue language/runtime/DX work: formatter/linter, semantic/type checks, `for` loops, module/package design, diagnostics, editor support, and deterministic tests.
6. Finish safe Admin repository preparation only; keep live infrastructure/publication gates closed.
7. Keep protected #161/#164/#169 refreshed but unmerged absent exact owner approval.
8. Continue dormant customer-priority, TOTP, and billing readiness only while their production feature gates remain OFF.
9. Keep security/account hardening, rollback, least privilege, launch readiness, operations, and truth documentation current.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
