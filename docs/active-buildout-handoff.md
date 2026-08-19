# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, open/closed PRs, exact-head CI/checks, review threads, open issues, active branch heads, Trusted Mac and Trusted Windows workflow/job metadata, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-13.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

At this sync, `main` is `eb5e3c618c8547a017771f36e718769ad368bfdb`, the safe non-production merge of #309.

The previous safe queue has been drained. There are currently **zero open safe non-production PRs**. Open production-sensitive/preparation PRs are #161, #164, #169, and #308; they do not count toward the safe-queue threshold because they are intentionally gated.

Recent safe integration milestones:

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

The #288 → #290 → #291 → #298 → #299 → #300 → #301 Repository Audit train is merged. Do not recreate those scopes. The older superseded predecessors remain historical only.

Repository Audit now includes bounded ingestion/inventory, deterministic Solve Graph reuse, Python/JavaScript import/reference evidence, dependency consistency, direct test/documentation mapping, conservative dead-code candidates, configuration/workflow-path relationships, impact/blast-radius analysis, secret redaction, evidence completeness, deterministic IDs/order, canonical JSON/HTML evidence, and browser-local reporting. Construction remains analyze-only and non-executing.

Server Audit now includes the bounded snapshot/schema parser, fixed collector surface, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, permission/ownership/privacy/consistency hardening, deterministic redacted JSON/HTML findings, and no remediation executor.

## Current open PRs

### Protected production-sensitive preparation

- #161 — account/CRM rollback preservation. Exact merge gate: `APPROVE PR #161 MERGE`.
- #164 — validation-only production customer-priority preflight. Exact merge gate: `APPROVE PR #164 MERGE`.
- #169 — dormant production customer-priority foundation rollout preparation. Exact merge gate: `APPROVE PR #169 MERGE`.
- #308 — Admin Gateway generated-role IAM scope correction after a failed production rollout/rollback attempt. Current observed head at this sync is `cc545e4b7f2c121dc56639ea453fe695f45a9ebe`, based on current `main`, mergeable, review-thread clean, with fresh API Access/Admin Gateway/general CI/Rust still running. This PR changes production rollout IAM policy scope and therefore must not auto-merge. Require exact owner approval `APPROVE PR #308 MERGE` before repository merge. That merge approval would still not authorize live IAM application, stack cleanup/retry, gateway deployment, DNS/private ingress, Admin publication, or canaries.

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

A merged feature or green CI result is never evidence that a production-sensitive feature has been enabled.

## Admin production boundary

The previously recorded live infrastructure gate remains:

`APPROVE ADMIN GATEWAY DEPLOY-ROLE IAM SUPPLEMENT LIVE APPLY`

The production Admin rollout has since exposed a generated-role IAM scope defect, now represented by protected #308. Do not infer that the original live-apply approval phrase authorizes merging #308, applying the revised IAM supplement, recovering the failed stack, retrying deployment, configuring private ingress/DNS/Zero Trust, publishing the Admin UI, or running canaries. Each production action remains separately controlled.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. The hosted mirror publishes exact-head `trusted-mac-ci` only after completion. Never infer success from a missing/queued/unobserved result, modify runner registration/services, weaken the branch restriction, or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Its hosted mirror publishes `trusted-windows-ci` only after completion. Use it when materially useful for Windows/cross-platform behavior; never interrupt a busy runner or treat it as a substitute for an explicit Trusted Mac gate.

## Safe queue policy

The safe queue is currently below the queue-drain threshold. New safe non-production work may proceed, but every run must first reconcile live GitHub state and avoid recreating merged scopes. Prefer small deterministic stages that can be reviewed and merged independently.

Current safe engineering order:

1. Repository Audit: richer affected-tests/workflows mapping, framework/deployment/config relationships that are not already covered, architecture/security path summaries, canonical/browser evidence quality, MCP/Codex integration, local visual explorer quality, and cross-platform tests.
2. Solve Graph: richer language/reference adapters, query/path/impact quality, deterministic architecture/security summaries, and affected-test/workflow intelligence.
3. Server Audit: read-only package/service/port/process/scheduled-job relationship quality, disk/log/cache/backup posture, domain/TLS/public-file consistency, version evidence without unsupported CVE claims, redaction, deterministic IDs, and cross-platform tests.
4. Language/runtime/DX: formatter/linter, semantic/type checks, `for` loops, module/package design, richer diagnostics, editor support, and deterministic cross-platform tests.
5. Safe Admin repository preparation only; never live-apply IAM/deploy/publish without the exact production approvals.
6. Dormant customer-priority preparation only while queue/customer/provider gates remain OFF.
7. TOTP preparation only while production TOTP remains OFF.
8. Billing readiness only while production billing remains OFF and no real Stripe activity is authorized.
9. Security/account hardening, rollback, least privilege, operations, launch readiness, and truth-document maintenance.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
