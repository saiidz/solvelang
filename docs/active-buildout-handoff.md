# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation state when relevant, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub and live production evidence always win over hashes recorded here.

## Current repository checkpoint

Immediately before this handoff branch was created, `main` was `66cbea3d70423fb810d35c8ac09724aef58ec93f`, the merge of #344. This document intentionally does not treat its own eventual merge SHA as durable truth; re-read `main` on the next run.

The safe non-production feature/documentation queue was drained before this final handoff. Protected production-sensitive preparation PRs #161, #164, and #169 are intentionally excluded from that threshold and remain unmerged absent their exact owner approval phrases.

Recent safe milestones that must not be recreated:

- #327 — deterministic bounded Repository Audit architecture/security-path presentation model with explicit partial/truncation notices.
- #329 — deterministic ranked Solve Graph local node search with explicit reasons, kind filters, and bounded truncation truth.
- #332 — browser exposure/download of integrity-covered architecture-path evidence while preserving strict canonical report schemas.
- #333 — bounded local TypeScript `extends` and project-reference configuration relationships.
- #335 — read-only MCP `solvelang_graph_search_nodes` ranked Solve Graph search with safe summaries and packed-runtime coverage.
- #337 — bounded Repository Audit visual-explorer model with semantic-node prioritization, safe node summaries, selected-endpoint edges, and hidden-count truth.
- #340 — bounded Server Audit scheduled-job relationships from already-sanitized command summaries using exact service/process-name tokens only; no command execution.
- #341 — conservative PHP local `require`/`include` Solve Graph relationships for explicit static `./` and `../` literal paths only; no PHP/source execution.
- #344 — newest production truth record, `docs/current-production-status-2026-08-19.md`, after the separately approved Admin private-ingress/static-publication/password-rotation work.

Older foundational milestones remain in history, including Repository Audit deterministic ingestion/graph/dependency/test/documentation/dead-code/config/workflow/affected-validation/architecture evidence, Server Audit privacy/consistency/process/package/certificate evidence, Solve Graph JavaScript/TypeScript and Python references, Trusted Mac/Windows controls, and production deployment serialization hardening. Do not rebuild already-merged generations merely because old handoffs mention predecessor PR numbers.

## Authoritative production truth

`docs/current-production-status-2026-08-19.md` is now the newest production-facing status record for facts it explicitly re-verifies. It supersedes the 2026-08-13 record for those facts.

Current verified production boundaries include:

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
- general managed hosted SolveLang workflow execution: **not live**.

The Admin canary performed no suspend/reactivate/terminate/profile/note/task mutation. The Admin UI contains real production mutation controls, but their presence does not authorize automated use.

TOTP/KMS facts that were not independently re-audited by the Admin deployment remain explicitly labeled as carried forward in the production-status record. Do not upgrade carried-forward truth into a fresh live verification claim.

## Repository Audit state

Repository Audit remains an active bounded read-only product surface. Merged capabilities now include:

- deterministic repository ingestion/inventory and Solve Graph composition;
- JavaScript/TypeScript, Python, and conservative local PHP relationship evidence;
- dependency consistency;
- direct test/documentation mapping;
- conservative dead-code evidence;
- package/workflow/TypeScript configuration references;
- workflow-path and changed-path affected-validation evidence;
- impact/blast-radius analysis;
- architecture/security-boundary path analysis, integrity-covered artifacts, browser presentation, and bounded visual-explorer modeling;
- secret redaction, evidence completeness/truncation truth, deterministic IDs/order, canonical report contracts, and browser-local reporting.

Current safe priorities after this checkpoint:

1. integrate the bounded visual-explorer model into the browser without weakening evidence/truncation truth;
2. continue conservative framework/deployment relationship adapters only where static evidence is explicit;
3. improve ranked query/path/impact ergonomics and evidence quality;
4. continue MCP/Codex read-only integration quality;
5. continue deterministic cross-platform validation.

Repository Audit construction remains analyze-only and non-executing. Write/remediation mode is not enabled.

## Solve Graph state

Solve Graph remains deterministic and analyze-only. Current merged query/reference work includes JavaScript/TypeScript imports/references, Python local import relationships, explicit local PHP literal include/require relationships, ranked node search, bounded dependency/dependent traversal, impact analysis, architecture/security summaries, and MCP exposure for safe local queries.

Do not execute repository source to improve graph coverage. Prefer conservative parser/config evidence and explicit partial/unknown states over guessed relationships.

## Server Audit state

Server Audit remains read-only and non-remediating. Merged capabilities include bounded snapshot parsing, inventory/posture findings, process/listener relationships, package-version evidence without unsupported CVE claims, privacy/certificate hardening, and deterministic scheduled-job relationships from sanitized summaries.

Continue read-only relationship/posture quality, evidence completeness, deterministic redaction/IDs, browser presentation, and cross-platform tests. Do not add remote mutation/remediation execution.

## Protected production-sensitive preparation

Keep these PRs refreshed, tested, mergeable, and review-clean, but never auto-merge them:

- #161 — account/CRM rollback preservation. Exact merge gate: `APPROVE PR #161 MERGE`.
- #164 — validation-only production customer-priority preflight. Exact merge gate: `APPROVE PR #164 MERGE`.
- #169 — dormant production customer-priority foundation rollout preparation. Exact merge gate: `APPROVE PR #169 MERGE`.

Do not rely on hashes recorded in older handoffs for these PRs. Re-read the live PR heads every run. Refreshing/replaying them on current `main` is repository-only preparation and is not deployment authorization. A green or merged preparation PR never authorizes later IAM, CloudFormation, queue/provider, customer-priority, billing, email, charge, or customer/CRM mutation.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. Missing/queued/unobserved status is not success. Never modify runner registration/services or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Use it when materially useful for Windows/cross-platform behavior. Never interrupt a busy runner or treat Windows as a substitute for an explicit Trusted Mac gate.

## Safe queue policy

When more than six safe non-production PRs are open, drain the existing queue before starting unrelated feature work. Refresh stale branches, retarget dependency stacks, fix CI/review findings, close verified superseded predecessors, and merge only exact-head green, mergeable, review-clean, non-production work. Protected #161/#164/#169 are excluded because their open state is intentional.

When the safe queue is six or fewer, new safe work may proceed only after live repository state is reconciled and merged scopes are checked to avoid duplication.

## Current safe engineering order

1. Keep shared Hosted CI/Rust/RustSec blockers clear.
2. Continue Repository Audit visual explorer/browser integration, explicit framework/deployment relationships, query/evidence quality, MCP integration, and cross-platform tests.
3. Continue Solve Graph conservative language/reference adapters and query/path/impact quality.
4. Continue Server Audit read-only relationship/posture quality and deterministic reporting/tests.
5. Continue language/runtime/DX work: formatter/linter, semantic/type checks, control-flow/module/package design, diagnostics, editor support, and deterministic tests.
6. Keep security/account hardening, rollback preservation, least privilege, launch readiness, operations, and production-truth documentation current.
7. Keep protected #161/#164/#169 refreshed but unmerged absent exact owner approval.
8. Keep TOTP, customer-priority activation, billing, and provider/charge work dormant behind their production gates.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, rotate credentials, publish/alter the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
