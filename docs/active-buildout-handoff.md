# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation state when relevant, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub and live production evidence always win over hashes recorded here.

## Current repository checkpoint

Immediately before this handoff refresh branch was created, `main` was `925f38b4d9d2e46fa3ef1d4ee40a58f49806f1a8`, the merge of PR #448. The safe non-production PR queue was **zero**.

The previously protected repository-preparation PRs are merged in repository history:

- #161 — account/CRM rollback preservation, merged as `fdc68a0b7aea9aecb1d6921e3c258df3d53c74f9`;
- #164 — validation-only production customer-priority preflight, merged as `16d04e32f7b1be18bf7f887a320bfcc716d32c13`;
- #169 — dormant production customer-priority foundation rollout preparation, merged as `27b143d1a7b547e9337b1b1b1a0a3055c82ab93c`.

Those repository merges do **not** authorize deployment, IAM/KMS changes, queue/provider/customer-priority activation, billing, email, charges/refunds, source execution, or production customer/CRM mutation. Production feature state remains governed by the production-status record and fresh owner approvals for live actions.

Recent safe milestones that must not be recreated include:

- #288 → #290 → #291 → #298 → #299 → #300 → #301 — deterministic Python imports plus Repository Audit dependency consistency, coverage mapping, conservative dead-code candidates, configuration/workflow relationships, and bounded report integration;
- #311/#313/#314 — affected-test/workflow intelligence and report composition;
- #317/#319/#322/#327/#332 — architecture/security-boundary path analysis, pipeline/artifact composition, bounded presentation, and browser export;
- #329/#335 — deterministic ranked Solve Graph node search and MCP exposure;
- #333 — bounded local TypeScript `extends` and project-reference relationships;
- #337/#348/#349 — bounded visual-explorer model, presentation model, and browser panel;
- #340 — bounded Server Audit scheduled-job relationships from sanitized summaries only;
- #341 — conservative repository-local PHP `require`/`include` relationships for explicit static local literals only;
- #350→#356 — bounded deployment-path evidence/artifact/presentation/browser integration;
- #358→#364 — bounded Angular/Nest framework-path evidence/artifact/presentation/browser integration;
- #365→#371 — bounded Angular target `options.tsConfig` evidence/artifact/presentation/browser integration;
- #372 — bounded deterministic Solve Graph shortest-path query;
- #373 — read-only MCP exposure for bounded Solve Graph shortest paths;
- #432/#436/#439/#441/#442/#443 — bounded shortest-path product bundle verification, browser visualization/export, query-product composition, and the final one-file product explorer. #437/#438/#440 are closed superseded predecessors and must not be revived;
- #445/#446/#447/#448 — deterministic shortest-path explanation quality across core, Repository Audit/browser, and MCP contracts, culminating in additive read-only MCP tool `solvelang_graph_explain_shortest_path` with packed-consumer validation. Complete-vs-partial truth is preserved, and the explanation path does not execute repository code or gain network/write capability.

Older foundational work remains in history, including deterministic ingestion, graph integrity, JavaScript/TypeScript and Python relationships, Server Audit privacy/consistency/process/package/certificate evidence, Trusted Mac/Windows controls, RustSec remediation, account/API/Admin foundations, and production deployment serialization hardening. Do not rebuild merged generations merely because older handoffs mention predecessor PR numbers.

## Authoritative production truth

`docs/current-production-status-2026-08-19.md` remains the newest production-facing status record for facts it explicitly re-verifies.

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
- authenticator-app TOTP: **disabled / rollout incomplete**;
- subscription billing: **disabled**;
- paid customer priority: **disabled**;
- real charge authorization: **none**;
- general managed hosted SolveLang workflow execution: **not live**;
- Repository Audit write/remediation mode: **disabled**;
- Server Audit mutation/remediation mode: **disabled**.

The #161/#164/#169 repository merges do not change those live-state facts by themselves. TOTP/KMS facts carried forward in the production-status record were not independently re-audited by the Admin deployment.

## Repository Audit state

Repository Audit is an active bounded read-only product surface. Merged capabilities include deterministic repository ingestion/inventory and Solve Graph composition; JavaScript/TypeScript, Python, conservative local PHP, local TypeScript-config, Angular/Nest framework, Angular target-config, package/configuration/workflow/deployment relationships; dependency consistency; direct test/documentation mapping; conservative dead-code evidence; changed-path affected-test/workflow mapping; architecture/security-boundary path analysis; bounded visual-explorer/browser presentation; deterministic ranked search and shortest-path query/product/browser flows; deterministic shortest-path explanations; read-only MCP shortest-path and explanation exposure; integrity-covered artifacts; explicit partial/truncation truth; deterministic IDs/order; redaction; and strict report contracts.

Current safe priorities:

1. improve impact and alternative-path evidence explanations without weakening deterministic bounds or complete-vs-partial truth;
2. improve MCP/Codex read-only integration over merged graph/query/explanation contracts;
3. continue only conservative framework/deployment/reference adapters where static repository evidence is explicit and non-executing;
4. improve local visual-explorer ergonomics while preserving partial/truncation truth;
5. keep deterministic cross-platform validation current.

Repository Audit write/remediation mode remains disabled.

## Solve Graph state

Solve Graph remains deterministic and analyze-only. Current merged query/reference work includes JavaScript/TypeScript imports/references, Python local imports, explicit local PHP literal include/require relationships, local TypeScript/Angular configuration references, ranked node search, bounded dependency/dependent traversal, bounded shortest-path queries, deterministic shortest-path explanation composition, integrity-covered shortest-path product composition, impact analysis, architecture/security summaries, affected-validation mapping, and read-only MCP shortest-path/explanation exposure.

Do not execute repository source to improve graph coverage. Prefer conservative parser/config evidence and explicit partial/unknown states over guessed relationships.

## Server Audit state

Server Audit remains read-only and non-remediating. Merged capabilities include a fixed allowlisted collector surface, bounded snapshot/schema parser, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, deterministic findings, redaction, JSON/HTML reporting, process/listener/package/certificate/permission/inventory consistency checks, and bounded scheduled-job relationships.

Continue read-only package/service/port/process/scheduled-job relationship quality, log/cache/backup posture, domain/TLS/public-file evidence, ownership/permission/version findings, deterministic evidence, and cross-platform tests. Do not add remote mutation/remediation execution.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. Missing/queued/unobserved status is not success. Never modify runner registration/services or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Use it when materially useful for Windows/cross-platform behavior. Never interrupt a busy runner or treat Windows as a substitute for an explicit Trusted Mac gate.

## Safe queue policy

When more than six safe non-production PRs are open, drain the existing queue before starting unrelated feature work. Refresh stale branches, retarget dependency stacks, fix CI/review findings, close verified superseded predecessors, and merge only exact-head green, mergeable, review-clean non-production work.

When the safe queue is six or fewer, new safe work may proceed only after live repository state is reconciled and merged scopes are checked to avoid duplication.

## Current safe engineering order

1. Keep shared Hosted CI/Rust/RustSec blockers clear and drain any safe open PR queue first.
2. Keep durable roadmap/handoff/production truth aligned with live repository state.
3. Continue Repository Audit impact/alternative-path explanation quality, MCP/Codex integration, conservative remaining relationships, visual-explorer ergonomics, and cross-platform tests.
4. Continue Solve Graph conservative language/reference adapters and bounded query/path/impact explanation quality.
5. Continue Server Audit read-only relationship/posture quality and deterministic reporting/tests.
6. Continue language/runtime/DX work: formatter/linter, semantic/type checks, control-flow/module/package design, diagnostics, editor support, and deterministic tests.
7. Keep security/account hardening, rollback preservation, least privilege, launch readiness, and operations current.
8. Keep TOTP, customer-priority activation, billing, provider execution, email, and charge/refund work dormant behind fresh production approvals.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, rotate credentials, publish/alter the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or bypass fresh owner/protected approvals for live actions.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.