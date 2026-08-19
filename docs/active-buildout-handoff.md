# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, Trusted Mac and Trusted Windows workflow/job metadata, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-13.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

At the start of this truth sync, `main` is `3190fda7b97c112f702d9c8742873e877979092a`, the safe merge of #314 after #311/#312/#313.

The safe non-production queue was drained to zero before this documentation branch was created. Protected production-sensitive/preparation PRs #161, #164, and #169 do not count toward the safe-queue threshold because they are intentionally gated.

Recent integration milestones:

- #229 — RustSec `h2` advisory remediation; `h2` is on the fixed 0.4.16 line and Rust/RustSec CI remains mandatory.
- #230/#232/#235 — Trusted Mac/Windows status mirroring and non-cancelling Trusted Mac concurrency foundations.
- #288 — deterministic Python import relationships / Repository Audit blast-radius reuse.
- #290 — bounded dependency-consistency evidence.
- #291 — direct test/documentation mapping evidence.
- #298 — conservative dead-code evidence.
- #299 — bounded configuration-reference evidence.
- #300 — bounded GitHub Actions workflow-path evidence.
- #301 — bounded Repository Audit evidence composition.
- #307 — bounded Server Audit listener-consistency evidence rebuilt on current history.
- #309 — redacts certificate identities from baseline TLS findings and evidence.
- #308 — Admin Gateway generated-role IAM scope correction merged in repository code only; it did not live-apply IAM or deploy anything.
- #311 — bounded changed-path mapping to affected tests/workflows.
- #312 — durable read-only Admin Gateway preflight CloudFormation read scope merged in repository code only.
- #313 — composed affected-validation evidence into the Repository Audit analysis pipeline.
- #314 — published optional affected-validation evidence in canonical reports. Baseline `1.0.0` reports retain the historical strict schema; graph/intelligence `1.1.0` and affected-validation `1.2.0` reports use the separate strict intelligence schema. The merge is analyze-only and does not enable repository mutation or production actions.

The #288 → #290 → #291 → #298 → #299 → #300 → #301 Repository Audit train is merged. Do not recreate those scopes. The older superseded predecessors remain historical only.

Repository Audit now includes bounded ingestion/inventory, deterministic Solve Graph reuse, JavaScript/TypeScript and Python import/reference evidence, dependency consistency, direct test/documentation mapping, conservative dead-code candidates, configuration/workflow-path relationships, impact/blast-radius analysis, changed-path affected-test/workflow mapping, secret redaction, evidence completeness, deterministic IDs/order, canonical report contracts, and browser-local reporting. Construction remains analyze-only and non-executing.

Server Audit includes the bounded snapshot/schema parser, fixed collector surface, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, permission/ownership/privacy/consistency hardening, deterministic redacted JSON/HTML findings, and no remediation executor.

## Current safe work

This documentation branch exists only to synchronize durable repository truth after #314. After it merges, resume safe engineering from the order below; do not recreate already-merged Repository Audit train work.

Current safe engineering order:

1. Repository Audit: architecture/security path summaries, remaining framework/deployment relationships not already represented by bounded config/workflow evidence, canonical/browser evidence quality, MCP/Codex integration, local visual explorer quality, and deterministic cross-platform tests.
2. Solve Graph: richer language/reference adapters, query/path/impact quality, architecture/security summaries, and affected-test/workflow intelligence.
3. Server Audit: read-only package/service/port/process/scheduled-job relationship quality, disk/log/cache/backup posture, domain/TLS/public-file consistency, version evidence without unsupported CVE claims, redaction, deterministic IDs, and cross-platform tests.
4. Language/runtime/DX: formatter/linter, semantic/type checks, `for` loops, module/package design, richer diagnostics, editor support, and deterministic cross-platform tests.
5. Safe Admin repository preparation only; never live-apply IAM/deploy/publish without the exact production approvals.
6. Dormant customer-priority preparation only while queue/customer/provider gates remain OFF.
7. TOTP preparation only while production TOTP remains OFF.
8. Billing readiness only while production billing remains OFF and no real Stripe activity is authorized.
9. Security/account hardening, rollback, least privilege, operations, launch readiness, and truth-document maintenance.

## Protected production-sensitive preparation

These PRs remain intentionally unmerged:

- #161 — account/CRM rollback preservation. Exact merge gate: `APPROVE PR #161 MERGE`.
- #164 — validation-only production customer-priority preflight. Exact merge gate: `APPROVE PR #164 MERGE`.
- #169 — dormant production customer-priority foundation rollout preparation. Exact merge gate: `APPROVE PR #169 MERGE`.

Their last recorded heads before this sync were:

- #161 — `324db30b271bc453a3c524848e0d0af9e926a5a8`
- #164 — `7d69cf82f57009ed53d24ed347e788d596120215`
- #169 — `203bf2102b3d0cadd511118ef31c52f0b1b828f9`

They were green on their existing hosted validation at that checkpoint. Because `main` has advanced since their last replay, refresh them on the settled post-truth-sync main before treating them as current; never merge them without their exact owner approval phrases.

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

The exact next live infrastructure gate remains:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

Repository-only corrections through #308/#312 do not authorize or prove live IAM application, failed-stack cleanup/recovery, deployment retry, private ingress/DNS/Zero Trust configuration, Admin publication, or canaries. Those remain separately controlled production actions and require explicit authorization at execution time.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. The hosted mirror publishes exact-head `trusted-mac-ci` only after completion. Never infer success from a missing/queued/unobserved result, modify runner registration/services, weaken the branch restriction, or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Its hosted mirror publishes `trusted-windows-ci` only after completion. Use it when materially useful for Windows/cross-platform behavior; never interrupt a busy runner or treat it as a substitute for an explicit Trusted Mac gate.

## Safe queue policy

When more than six safe non-production PRs are open, drain the existing queue before starting unrelated feature work. Refresh stale branches, retarget dependency stacks, fix CI/review findings, close verified superseded predecessors, and merge only exact-head green, mergeable, review-clean, non-production work. Protected #161/#164/#169 are excluded from this threshold because their open state is intentional.

When the safe queue is six or fewer, new safe work may proceed only after live repository state is reconciled and merged scopes are checked to avoid duplication.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
