# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation state when relevant, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub and live production evidence always win over hashes recorded here.

## Current repository checkpoint

Immediately before this handoff branch was created, `main` was `37d210b2bddaa00fdc67565e24964cde7c66281b`, the merge of #356. This document intentionally does not treat its own eventual merge SHA as durable truth; re-read `main` on the next run.

The safe non-production PR queue was **zero** after #356 merged. Protected production-sensitive preparation PRs #161, #164, and #169 are excluded from that threshold and remain unmerged absent their exact owner approval phrases.

Recent safe milestones that must not be recreated include:

- #288 → #290 → #291 → #298 → #299 → #300 → #301 — deterministic Python imports plus Repository Audit dependency consistency, coverage mapping, conservative dead-code candidates, configuration/workflow relationships, and bounded report integration.
- #311/#313/#314 — affected-test/workflow intelligence and report composition.
- #317/#319/#322/#327/#332 — architecture/security-boundary path analysis, pipeline/artifact composition, bounded presentation, and browser export.
- #329/#335 — deterministic ranked Solve Graph node search and MCP exposure.
- #333 — bounded local TypeScript `extends` and project-reference relationships.
- #337/#348/#349 — bounded visual-explorer model, presentation model, and browser panel.
- #340 — bounded Server Audit scheduled-job relationships from sanitized summaries only.
- #341 — conservative repository-local PHP `require`/`include` relationships for explicit static local literals only.
- #344 — newest production truth record, `docs/current-production-status-2026-08-19.md`.
- #350/#351/#352/#353/#354 — bounded deployment-path evidence, integrity-covered artifact, analysis composition, presentation model, and browser panel.
- #355/#356 — deterministic browser-intelligence composition and product wiring. Repository Audit now renders the merged visual explorer and deployment-path panel and exposes the deployment-path evidence artifact from the product flow.

Older foundational work remains in history, including deterministic ingestion, graph integrity, JavaScript/TypeScript and Python relationships, Server Audit privacy/consistency/process/package/certificate evidence, Trusted Mac/Windows controls, RustSec remediation, account/API/Admin foundations, and production deployment serialization hardening. Do not rebuild merged generations merely because older handoffs mention predecessor PR numbers.

## Authoritative production truth

`docs/current-production-status-2026-08-19.md` is the newest production-facing status record for facts it explicitly re-verifies.

Current verified boundaries include:

- API access: **enabled**;
- customer accounts/password authentication: **enabled**;
- ordinary password login sends email: **no**;
- Admin CRM backend: **enabled**;
- private Admin origin: **live at `https://admin.solve-lang.com` behind Cloudflare Access**;
- private Admin Gateway: **live**;
- Admin static UI: **published behind Access**;
- production Admin password: **rotated and validated**;
- read-only Admin account lookup canary: **passed**;
- authenticator-app TOTP: **disabled**;
- subscription billing: **disabled**;
- paid customer priority: **disabled**;
- real charge authorization: **none**;
- general managed hosted SolveLang workflow execution: **not live**;
- Repository Audit write/remediation mode: **disabled**;
- Server Audit mutation/remediation mode: **disabled**.

TOTP/KMS facts carried forward in the production-status record were not independently re-audited by the Admin deployment. Do not upgrade carried-forward truth into a fresh live verification claim.

## Repository Audit state

Repository Audit is an active bounded read-only product surface. Merged capabilities include:

- deterministic repository ingestion/inventory and Solve Graph composition;
- JavaScript/TypeScript, Python, conservative local PHP, and local TypeScript-config relationship evidence;
- dependency consistency, direct test/documentation mapping, and conservative dead-code evidence;
- package/configuration/workflow/deployment path relationships;
- changed-path affected-test/workflow mapping and impact/blast-radius analysis;
- architecture/security-boundary path analysis with deterministic integrity-covered artifacts;
- bounded visual-explorer and deployment-path presentation models and product browser integration;
- deterministic ranked graph search and read-only MCP exposure;
- evidence-completeness/truncation truth, deterministic IDs/order, redaction, strict report contracts, and browser-local exports;
- no repository mutation or repository-code execution during analysis.

Current safe priorities:

1. continue only conservative framework/deployment relationship adapters where static repository evidence is explicit and non-executing;
2. improve query/path/impact quality and evidence explanations without weakening deterministic bounds;
3. improve MCP/Codex read-only integration quality over the merged graph/intelligence contracts;
4. improve local visual-explorer ergonomics while preserving partial/truncation truth;
5. keep deterministic cross-platform validation current.

Repository Audit write/remediation mode is not enabled.

## Solve Graph state

Solve Graph remains deterministic and analyze-only. Current merged query/reference work includes JavaScript/TypeScript imports/references, Python local imports, explicit local PHP literal include/require relationships, local TypeScript config references, ranked node search, bounded dependency/dependent traversal, impact analysis, architecture/security summaries, affected-validation mapping, and MCP exposure for safe local queries.

Do not execute repository source to improve graph coverage. Prefer conservative parser/config evidence and explicit partial/unknown states over guessed relationships.

## Server Audit state

Server Audit remains read-only and non-remediating. Merged capabilities include a fixed allowlisted collector surface, bounded snapshot/schema parser, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, deterministic findings, redaction, JSON/HTML reporting, process/listener/package/certificate/permission/inventory consistency checks, and bounded scheduled-job relationships.

Continue read-only package/service/port/process/scheduled-job relationship quality, log/cache/backup posture, domain/TLS/public-file evidence, ownership/permission/version findings, deterministic evidence, and cross-platform tests. Do not add remote mutation/remediation execution.

## Protected production-sensitive preparation

These PRs were non-destructively refreshed onto `37d210b2bddaa00fdc67565e24964cde7c66281b` after #356 merged. Their reviewed file scopes do not overlap the 29 commits that advanced `main` from their prior base, and the refreshes preserve those reviewed scopes while adding current-main ancestry.

- #161 — account/CRM rollback preservation; head `78f696461831109d3e910707d42bf91e772e6555`. Exact merge gate: `APPROVE PR #161 MERGE`.
- #164 — validation-only production customer-priority preflight; head `305a04577041d38397a918456fb04bb85fa8faff`. Exact merge gate: `APPROVE PR #164 MERGE`.
- #169 — dormant production customer-priority foundation rollout preparation; head `a8cf18935f0ea93c40fa3e959fe0bbb9dd03b298`. Exact merge gate: `APPROVE PR #169 MERGE`.

At handoff capture time all three are mergeable and review-thread clean; fresh exact-head Hosted validation is running after the refresh. Re-read live checks before making any later claim. Never auto-merge these PRs.

Refreshing/replaying protected branches is repository-only preparation and is not deployment authorization. A green or merged preparation PR never authorizes IAM, CloudFormation, queue/provider activation, customer-priority activation, billing, email, charges/refunds, or production customer/CRM mutation.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. Missing/queued/unobserved status is not success. Never modify runner registration/services or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Use it when materially useful for Windows/cross-platform behavior. Never interrupt a busy runner or treat Windows as a substitute for an explicit Trusted Mac gate.

No self-hosted Mac or Windows result was required or claimed for #356 or this documentation sync.

## Safe queue policy

When more than six safe non-production PRs are open, drain the existing queue before starting unrelated feature work. Refresh stale branches, retarget dependency stacks, fix CI/review findings, close verified superseded predecessors, and merge only exact-head green, mergeable, review-clean non-production work. Protected #161/#164/#169 are excluded because their open state is intentional.

When the safe queue is six or fewer, new safe work may proceed only after live repository state is reconciled and merged scopes are checked to avoid duplication.

## Current safe engineering order

1. Keep shared Hosted CI/Rust/RustSec blockers clear and drain any safe open PR queue first.
2. Continue Repository Audit conservative framework/deployment relationships, query/evidence quality, MCP/Codex integration, visual-explorer ergonomics, and cross-platform tests.
3. Continue Solve Graph conservative language/reference adapters and query/path/impact quality.
4. Continue Server Audit read-only relationship/posture quality and deterministic reporting/tests.
5. Continue language/runtime/DX work: formatter/linter, semantic/type checks, control-flow/module/package design, diagnostics, editor support, and deterministic tests.
6. Keep security/account hardening, rollback preservation, least privilege, launch readiness, operations, and production-truth documentation current.
7. Keep protected #161/#164/#169 refreshed but unmerged absent exact owner approval.
8. Keep TOTP, customer-priority activation, billing, provider execution, email, and charge/refund work dormant behind their production gates.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, rotate credentials, publish/alter the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
