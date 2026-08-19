# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, all open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust, Trusted Mac/Windows state, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-13.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

Immediately before this handoff refresh, `main` was `b524fa2eea04a5b32f6d70d81446b5caf9af16a6`, the safe merge of #335. The safe non-production PR queue was drained to **zero**. Protected production-sensitive/preparation PRs #161, #164, and #169 are intentionally excluded from that threshold and remain unmerged.

Recent integration milestones that must not be recreated:

- #229 — RustSec `h2` advisory remediation; Rust/RustSec CI remains mandatory.
- #230/#232/#235 — Trusted Mac/Windows status mirroring and non-cancelling self-hosted validation foundations.
- #288 → #290 → #291 → #298 → #299 → #300 → #301 — deterministic Python imports, dependency consistency, direct test/documentation mapping, conservative dead-code evidence, configuration references, workflow-path evidence, and Repository Audit evidence composition.
- #311/#313/#314 — bounded changed-path affected-test/workflow mapping, pipeline composition, and canonical affected-validation evidence.
- #317/#319/#322 — deterministic architecture/security-boundary path summaries, pipeline composition, and the standalone integrity-covered architecture-path evidence artifact.
- #329 — deterministic ranked Solve Graph node search foundation.
- #332 — browser presentation/export for the architecture/security-path evidence artifact. It merged only after exact-head Hosted CI and Rust/RustSec were green and review state was clean.
- #333 — repository-local TypeScript `extends` and project-reference evidence. #331 was closed unmerged only after #333 was rebuilt on newer `main` with the same reviewed two-file delta. Exact merged head: `91edffb9d859a4465eb9c04dc5010175e287a103`.
- #335 — deterministic ranked Solve Graph MCP/Codex node search. #334 was closed unmerged only after #335 existed on newer `main` with the same reviewed four-file / 280-addition scope. Exact merged head: `a36cc502634b991a37ea0c5426a6d9474cb6d721`; Hosted CI, MCP CI, and Rust/RustSec were all green before merge.
- #307/#309 — Server Audit listener consistency and certificate-identity redaction hardening.
- #308/#312 — repository-only Admin Gateway IAM/preflight corrections; these did not live-apply IAM or deploy anything.
- #321 — repository-only preparation for separately gated static Admin UI publication. It did not publish the Admin UI or prove a live Cloudflare/AWS/DNS/Access change.

Do not reopen or recreate verified predecessors #331/#334 or the already-merged trains above.

## Repository Audit and Solve Graph state

Repository Audit is an active bounded read-only product surface. Merged capabilities include repository ingestion/inventory, deterministic Solve Graph reuse, JavaScript/TypeScript and Python import/reference evidence, dependency consistency, direct test/documentation mapping, conservative dead-code candidates, package/configuration/workflow-path relationships, repository-local TypeScript config references, impact/blast-radius analysis, changed-path affected-test/workflow mapping, architecture/security-boundary path summaries, a standalone integrity-covered architecture-path artifact, browser-local architecture evidence presentation/export, secret redaction, evidence-completeness truth, deterministic IDs/order, canonical report contracts, and browser-local reporting.

Solve Graph now also has deterministic ranked node-search primitives plus a read-only MCP tool (`solvelang_graph_search_nodes`) for canonical integrity-valid analyze-only graph documents. Ranking is bounded, returns safe summaries/reasons, and keeps network/write capability false.

Current safe priorities:

1. remaining bounded framework/deployment relationships not already represented by configuration/workflow evidence;
2. richer Repository Audit query/path/impact and evidence quality;
3. continue MCP/Codex integration quality beyond ranked node search;
4. local visual explorer improvements;
5. richer deterministic language/reference adapters and architecture/security summaries;
6. deterministic cross-platform validation.

Repository Audit and Solve Graph construction remain analyze-only and non-executing. Repository write/remediation mode is not enabled.

## Server Audit state

Server Audit includes a strict bounded snapshot/schema parser, fixed read-only collector surface, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, permission/ownership/privacy/consistency hardening, deterministic redacted JSON/HTML findings, and no remediation executor.

Continue read-only relationship/posture quality, version evidence without unsupported CVE claims, bounded redaction, deterministic IDs, and cross-platform parser/report validation. Do not add remote mutation/remediation execution.

## Protected production-sensitive preparation

Keep these PRs refreshed, tested, mergeable, and review-clean, but never auto-merge them:

- #161 — account/CRM rollback preservation. Refreshed on `b524fa2eea04a5b32f6d70d81446b5caf9af16a6` at head `702de785745be15c018a059b2df1825e0ef0e00d`. Exact merge gate: `APPROVE PR #161 MERGE`.
- #164 — validation-only production customer-priority preflight. Refreshed on the same `main` at head `4fcebf8ea548d88c569aa4d7aae0c791418763aa`. Exact merge gate: `APPROVE PR #164 MERGE`.
- #169 — dormant production customer-priority foundation rollout preparation. Refreshed on the same `main` at head `9906692da661cff28f9024175488d2dedb71b605`. Exact merge gate: `APPROVE PR #169 MERGE`.

The refreshes were non-destructive current-history rebuilds: the protected file scopes did not overlap the changes added to `main` since their previous base. Fresh exact-head Hosted validation was triggered. A previous green run is never evidence for a newer protected head, and a green protected PR still must not merge without its exact owner approval phrase.

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

A repository merge or green CI result is never evidence that a production-sensitive feature has been enabled or that a production rollout completed.

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

A Windows validation branch was triggered for #333's exact merged head because TypeScript path handling has cross-platform value. Do not claim a Trusted Windows pass unless the exact-head `trusted-windows-ci` status is actually published.

## Safe queue policy

When more than six safe non-production PRs are open, drain the existing queue before starting unrelated feature work. Refresh stale branches, retarget dependency stacks, fix CI/review findings, close verified superseded predecessors, and merge only exact-head green, mergeable, review-clean, non-production work. Protected #161/#164/#169 are excluded because their open state is intentional.

When the safe queue is six or fewer, new safe work may proceed only after live repository state is reconciled and merged scopes are checked to avoid duplication.

## Current safe engineering order

1. Keep shared Hosted CI/Rust/RustSec blockers clear and drain any existing safe PR queue first.
2. Continue Repository Audit remaining framework/deployment evidence, query/evidence quality, MCP/Codex integration, visual explorer quality, and cross-platform tests.
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
