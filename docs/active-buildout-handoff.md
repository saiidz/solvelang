# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-19

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust, Trusted Mac/Windows state, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub state always wins over hashes recorded here.

## Current repository checkpoint

Immediately before this truth-sync branch was opened, `main` was `66cbea3d70423fb810d35c8ac09724aef58ec93f`, the safe merge of #344. The safe non-production PR queue was zero. Protected #161, #164, and #169 are intentionally excluded from that threshold and remain unmerged.

Recent integration milestones that must not be recreated:

- #229 — RustSec `h2` advisory remediation; Rust/RustSec CI remains mandatory.
- #230/#232/#235 — Trusted Mac/Windows status mirroring and non-cancelling self-hosted concurrency foundations.
- #288 → #290 → #291 → #298 → #299 → #300 → #301 — deterministic Python imports, dependency consistency, direct test/documentation mapping, conservative dead-code evidence, configuration references, workflow-path evidence, and Repository Audit evidence composition.
- #311/#313/#314 — bounded changed-path affected-test/workflow mapping, pipeline composition, and canonical affected-validation evidence.
- #317/#319/#322/#332 — bounded architecture/security-boundary path analysis, pipeline composition, integrity-covered standalone evidence, and browser/export presentation.
- #329/#335 — deterministic ranked Solve Graph node search in the core and MCP surfaces.
- #333 — repository-local TypeScript `extends` / project-reference evidence.
- #337 — bounded local Repository Audit visual-explorer model.
- #307/#309/#340 — current-history Server Audit listener consistency, certificate-identity redaction hardening, and bounded scheduled-job relationships.
- #308/#312 — repository-only Admin Gateway IAM/preflight corrections.
- #321 — repository preparation for the separately gated static Admin UI publication.
- #341 — conservative repository-local PHP `require`/`include` relationships. The first Hosted CI attempt caught a false truncation fixture; the corrected exact head `7528425d36340069a20ead4ae183d6e29924febd` passed Hosted CI and Rust/RustSec before merge. #343 was later closed unmerged after all three changed-file blobs were verified byte-identical to merged `main`.
- #344 — current production truth record, rebuilt on the post-#341 `main` after #339/#342 became stale. The merged document blob is `f3caf2dd43b954f32adf8dc48c9db6158886bf4a`.

## Repository Audit / Solve Graph state

Repository Audit is an active bounded read-only product surface. Merged capabilities include repository ingestion/inventory, deterministic Solve Graph reuse, JavaScript/TypeScript/Python imports plus conservative repository-local PHP imports, dependency consistency, direct test/documentation mapping, conservative dead-code candidates, configuration/workflow-path/TypeScript project-reference relationships, impact/blast-radius analysis, changed-path affected-test/workflow mapping, architecture/security-boundary path summaries, a standalone integrity-covered architecture-path artifact, browser/export presentation, secret redaction, evidence-completeness truth, deterministic IDs/order, canonical report contracts, ranked Solve Graph search, MCP ranked search, and local visual-explorer modeling.

Current safe priorities:

1. remaining bounded framework/deployment relationships not already represented by config/workflow evidence;
2. richer query/path/impact and evidence quality;
3. MCP/Codex integration quality;
4. local visual explorer improvements;
5. additional deterministic language/reference adapters where bounded and non-executing;
6. cross-platform validation where material.

Repository Audit and Solve Graph remain analyze-only. Repository write/remediation mode is not enabled.

## Server Audit state

Server Audit includes a strict bounded snapshot/schema parser, fixed read-only collector surface, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, permission/ownership/privacy/consistency hardening, listener and scheduled-job relationships, deterministic redacted JSON/HTML findings, and no remediation executor.

Continue read-only relationship/posture quality, version evidence without unsupported CVE claims, bounded redaction, deterministic IDs, and cross-platform parser/report validation. Do not add remote mutation/remediation execution.

## Protected production-sensitive preparation

Keep these PRs refreshed, tested, mergeable, and review-clean, but never auto-merge them:

- #161 — account/CRM rollback preservation. Current observed head before this handoff update: `702de785745be15c018a059b2df1825e0ef0e00d`. Exact merge gate: `APPROVE PR #161 MERGE`.
- #164 — validation-only production customer-priority preflight. Current observed head: `4fcebf8ea548d88c569aa4d7aae0c791418763aa`. Exact merge gate: `APPROVE PR #164 MERGE`.
- #169 — dormant production customer-priority foundation rollout preparation. Current observed head: `9906692da661cff28f9024175488d2dedb71b605`. Exact merge gate: `APPROVE PR #169 MERGE`.

All three observed heads were green on their own Hosted validation at their last run, including Rust/RustSec and their feature-specific workflows. They are behind the current `main`; previous green results do not prove a future refreshed head. Refresh them non-destructively only after the safe queue settles, rerun the required Hosted checks, and still never merge them without the exact approval phrases.

## Authoritative production truth

`docs/current-production-status-2026-08-19.md` is the newest production-facing record. It distinguishes facts re-verified during the separately approved 2026-08-19 Admin work from TOTP/KMS facts explicitly carried forward from the older record.

Current recorded production state includes:

- API access: **enabled**;
- customer accounts: **enabled**;
- Admin CRM backend: **enabled**;
- password authentication: **enabled**;
- ordinary password login sends email: **no**;
- private Admin Gateway: **deployed**;
- `admin.solve-lang.com`: **live behind Cloudflare Access/private ingress**;
- static Admin UI: **published through the separately approved publication stage**;
- authenticator-app TOTP rollout: **not completed**;
- dedicated production TOTP KMS rollout: **not performed as part of the 2026-08-19 Admin work**;
- subscription billing: **disabled**;
- production billing webhook path: **disabled by feature boundary**;
- paid customer priority: **disabled**;
- real charge authorization: **none**;
- general managed hosted SolveLang workflow execution: **not live**.

The successful protected Admin Gateway redeployment recorded by that document is GitHub Actions run `32217385656` on commit `04fddd0ee95b5624d640be9e7a354f75977a4502`. This handoff does not reinterpret those completed production stages as ongoing authorization.

## Admin production boundary

The private Admin Gateway, Cloudflare Access/private ingress, static Admin UI publication, and Admin password rotation were completed through separately approved production stages before this handoff sync. Prior approval phrases are historical evidence and are not reusable standing authorization.

Future IAM/KMS changes, gateway redeployments, DNS/Access/private-ingress changes, Admin publication updates, credential rotations, production canaries with mutation potential, or other live production changes require fresh explicit owner authorization scoped to the exact action. Repository-only preparation may continue without implying live approval.

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
2. Drain any safe PR queue before starting unrelated work whenever the queue threshold requires it.
3. Keep protected #161/#164/#169 current and review-clean without merging them absent exact owner approval.
4. Continue Repository Audit remaining framework/deployment relationships, query/evidence quality, MCP/Codex integration, visual explorer quality, and cross-platform tests.
5. Continue Solve Graph bounded language/reference adapters, query/path/impact quality, affected-test/workflow intelligence, and architecture/security summaries.
6. Continue Server Audit read-only relationship/posture quality and deterministic cross-platform tests.
7. Continue language/runtime/DX work: formatter/linter, semantic/type checks, `for` loops, module/package design, diagnostics, editor support, and deterministic tests.
8. Continue safe Admin repository preparation only; every future live production action requires fresh explicit approval.
9. Continue dormant customer-priority, TOTP, and billing readiness only while their production feature gates remain OFF.
10. Keep security/account hardening, rollback, least privilege, launch readiness, operations, and truth documentation current.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress/Zero Trust, publish or update the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or merge explicitly protected production-sensitive work without its exact approval phrase.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.