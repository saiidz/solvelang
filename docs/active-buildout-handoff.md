# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust, Trusted Mac/Windows status, open issues, active branch heads, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-13.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

At this sync, `main` is `3190fda7b97c112f702d9c8742873e877979092a`, the safe merge of #314 after #311 and #313.

The previous safe non-production queue is drained. Protected production-sensitive PRs #161, #164, and #169 remain open but do not count toward the safe-queue threshold because they are intentionally gated. This documentation sync may itself appear as the only safe PR until merged.

Recent integration milestones:

- #229 — RustSec `h2` advisory remediation; `h2` is on the fixed 0.4.16 line and Rust/RustSec CI remains mandatory.
- #230/#232/#235 — Trusted Mac/Windows status mirroring plus non-cancelling Trusted Mac concurrency foundations.
- #288 — deterministic Python import relationships / Repository Audit blast-radius reuse.
- #290 — bounded dependency-consistency evidence.
- #291 — direct test/documentation mapping evidence.
- #298 — conservative dead-code evidence.
- #299 — bounded configuration-reference evidence.
- #300 — bounded GitHub Actions workflow-path evidence.
- #301 — bounded Repository Audit evidence composition.
- #307 — bounded Server Audit listener-consistency evidence rebuilt on current history.
- #309 — certificate-identity redaction hardening for baseline TLS findings and evidence.
- #308/#312 — Admin Gateway generated-role IAM/preflight repository-scope corrections. These repository merges are **not** evidence of live IAM application, failed-stack recovery, deployment, DNS/private ingress changes, Admin publication, or canaries.
- #311 — bounded affected-test/workflow mapping for changed repository paths.
- #313 — composition of affected-validation evidence into Repository Audit analysis truth.
- #314 — canonical affected-validation report evidence, integrity binding, explicit bounded-stage truncation reasons, and a separate strict `1.1.0`/`1.2.0` intelligence-report schema while preserving the historical `1.0.0` schema unchanged.

Do not recreate the #288 → #290 → #291 → #298 → #299 → #300 → #301 train or the #311 → #313 → #314 affected-validation train. Both are merged.

Repository Audit now includes bounded ingestion/inventory, deterministic Solve Graph reuse, Python/JavaScript import/reference evidence, dependency consistency, direct test/documentation mapping, conservative dead-code candidates, configuration/workflow-path relationships, impact/blast-radius analysis, affected tests/workflows, secret redaction, evidence completeness, deterministic IDs/order, versioned canonical JSON evidence, integrity binding, and browser-local reporting. Construction remains analyze-only and non-executing.

Server Audit includes the bounded snapshot/schema parser, fixed collector surface, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, permission/ownership/privacy/consistency hardening, deterministic redacted JSON/HTML findings, and no remediation executor.

## Current protected PRs

The protected branches were refreshed non-destructively onto `3190fda7b97c112f702d9c8742873e877979092a` after #314 merged. They remain unmerged regardless of CI state:

- #161 — `agent/preserve-crm-through-totp-rollout`, head `382378f68f5fd897b3235d5f1a201408777378a1`. Exact merge gate: `APPROVE PR #161 MERGE`.
- #164 — `agent/customer-priority-production-preflight`, head `d04a1609ca4b7a7e8104284189a3d6334e7f7c02`. Exact merge gate: `APPROVE PR #164 MERGE`.
- #169 — `agent/customer-priority-queue-foundation-rollout`, head `774fb9b2e84acb9bc95826d3641d23d7d541f322`. Exact merge gate: `APPROVE PR #169 MERGE`.

Fresh Hosted validation is expected after each protected refresh. Green checks do not authorize merging or production execution.

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

Repository IAM/preflight fixes through #308/#312 do not authorize or prove live IAM application, failed-stack cleanup/recovery, gateway deployment, private ingress/DNS/Zero Trust configuration, Admin publication, or canaries. Those remain separately controlled production actions.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. The hosted mirror publishes exact-head `trusted-mac-ci` only after completion. Never infer success from a missing/queued/unobserved result, modify runner registration/services, weaken the branch restriction, or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Its hosted mirror publishes exact-head `trusted-windows-ci` only after completion. Use it when materially useful for Windows/cross-platform behavior; never interrupt a busy runner or treat it as a substitute for an explicit Trusted Mac gate.

## Safe engineering order

The queue is below the drain threshold, so new safe non-production work may proceed after reconciling live state. Prefer small deterministic stages that can be reviewed and merged independently.

1. Repository Audit: architecture/security path summaries, richer query/evidence quality, canonical/browser evidence parity, MCP/Codex integration, local visual explorer quality, and cross-platform validation.
2. Solve Graph: richer language/reference adapters, query/path/impact quality, deterministic architecture/security summaries, and affected-test/workflow intelligence.
3. Server Audit: read-only package/service/port/process/scheduled-job relationship quality, disk/log/cache/backup posture, domain/TLS/public-file consistency, version evidence without unsupported CVE claims, redaction, deterministic IDs, and cross-platform tests.
4. Language/runtime/DX: formatter/linter, semantic/type checks, `for` loops, module/package design, richer diagnostics, editor support, and deterministic cross-platform tests.
5. Safe Admin repository preparation only; never live-apply IAM/deploy/publish without exact production approvals.
6. Dormant customer-priority preparation only while queue/customer/provider gates remain OFF.
7. TOTP preparation only while production TOTP remains OFF.
8. Billing readiness only while production billing remains OFF and no real Stripe activity is authorized.
9. Security/account hardening, rollback, least privilege, operations, launch readiness, and truth-document maintenance.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, publish the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
