# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-20

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation state when relevant, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub and live production evidence always win over hashes recorded here.

## Current repository checkpoint

At this refresh, `main` is `e3a08978376afbc04cd5f784fd2b76d66696d47d`, the merge of safe PR #464. The safe non-production PR queue is **zero**.

The previously protected repository-preparation PRs #161/#164/#169 are merged repository-history facts only. Those merges do **not** authorize deployment, IAM/KMS changes, queue/provider/customer-priority activation, billing, email, charges/refunds, source execution, or production customer/CRM mutation.

### Recent selected-node / impact train

The following work is merged and must not be recreated:

- #455 — deterministic bounded dependent-impact explanations in the Solve Graph core;
- #456 — additive read-only MCP impact-explanation tool;
- #457 — bounded local Repository Audit impact-explanation panel;
- #458 — integrity-checked impact query-product composition;
- #459 — selected-node impact preparation in the local visual explorer;
- #460 — top-level Repository Audit query-index wiring for selected-node impact;
- #461 — fail-safe stale-selection guard and deterministic interaction coverage so a previous-scan node cannot invoke impact traversal with an unavailable root;
- #462 — selected-node affected-test/workflow adapter over the existing bounded affected-validation mapper;
- #463 — browser presentation panel for affected tests and explicit repository workflow-path references, including separate partial/truncation truth;
- #464 — deterministic selected-node intelligence product composing impact and affected-validation evidence while preserving independent bounds and network/write-disabled state.

All of #455–#464 are repository-only/analyze-only. Exact-head required Hosted CI and Rust/RustSec were green before their merges. No Trusted Mac/Windows requirement was introduced by these ordinary branches.

### Earlier safe milestones that must not be recreated

- #288 → #290 → #291 → #298 → #299 → #300 → #301 — deterministic Python imports plus Repository Audit dependency consistency, coverage mapping, conservative dead-code candidates, configuration/workflow relationships, and bounded report integration;
- #311/#313/#314 — affected-test/workflow intelligence and report composition;
- #317/#319/#322/#327/#332 — architecture/security-boundary analysis, artifact composition, bounded presentation, and browser export;
- #329/#335 — deterministic ranked Solve Graph node search and MCP exposure;
- #333 — bounded local TypeScript `extends` and project-reference relationships;
- #337/#348/#349 — bounded visual-explorer model, presentation model, and browser panel;
- #340 — bounded Server Audit scheduled-job relationships from sanitized summaries only;
- #341 — conservative repository-local PHP `require`/`include` relationships for explicit static local literals only;
- #350→#356 — bounded deployment-path evidence/artifact/presentation/browser integration;
- #358→#364 — bounded Angular/Nest framework-path evidence/artifact/presentation/browser integration;
- #365→#371 — bounded Angular target `options.tsConfig` evidence/artifact/presentation/browser integration;
- #372/#373 — bounded deterministic Solve Graph shortest paths and read-only MCP exposure;
- #432/#436/#439/#441/#442/#443 — shortest-path verifier/product/query-product/browser train; #437/#438/#440 are superseded history and must not be revived;
- #445/#446/#447/#448 — deterministic shortest-path explanations across core/browser/MCP, including `solvelang_graph_explain_shortest_path`;
- #450→#453 — deterministic alternative-path explanations across MCP/core/Repository Audit browser, including `solvelang_graph_explain_alternative_paths`.

Older foundational work includes deterministic ingestion/graph integrity, JavaScript/TypeScript and Python relationships, Server Audit privacy/consistency/process/package/certificate evidence, Trusted Mac/Windows controls, RustSec remediation, account/API/Admin foundations, and production deployment serialization hardening. Do not rebuild merged generations merely because historical issue comments mention predecessor PR numbers.

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
- dedicated production TOTP KMS rollout: **not performed in the verified Admin work**;
- subscription billing: **disabled**;
- paid customer priority: **disabled**;
- queue/customer/provider activation: **not established by repository merges**;
- real charge authorization: **none**;
- general managed hosted SolveLang workflow execution: **not live**;
- Repository Audit write/remediation mode: **disabled**;
- Server Audit mutation/remediation mode: **disabled**.

Repository merges do not change those live-state facts by themselves. Production facts carried forward in the status record were not silently re-audited by unrelated repository work.

## Repository Audit state

Repository Audit is an active bounded read-only product surface. Merged capabilities include deterministic repository ingestion/inventory and Solve Graph composition; JavaScript/TypeScript, Python, conservative local PHP, local TypeScript-config, Angular/Nest framework, Angular target-config, package/configuration/workflow/deployment relationships; dependency consistency; direct test/documentation mapping; conservative dead-code evidence; changed-path affected-test/workflow mapping; architecture/security-boundary analysis; bounded visual-explorer/browser presentation; ranked, shortest-path, alternative-path, and dependent-impact query/product flows; deterministic shortest/alternative/impact explanations; read-only MCP query/explanation exposure; integrity-covered artifacts; explicit partial/truncation truth; deterministic IDs/order; redaction; and strict report contracts.

The newest selected-node contracts now allow one canonical explorer selection to be validated against both bounded dependent-impact evidence and bounded affected-test/workflow evidence. The composition product is merged through #464, and the affected-validation presentation panel is merged through #463.

Current safe priorities:

1. wire the merged #464 selected-node intelligence product into the local visual explorer using the merged #463 panel, with race-safe stale-selection handling and no exported-schema change;
2. keep affected-test/workflow mappings conservative: structural mapping is not behavioral coverage proof, and incomplete graph/workflow evidence must remain visibly partial;
3. improve MCP/Codex read-only integration over merged graph/query/explanation contracts;
4. continue only conservative framework/deployment/reference adapters where static repository evidence is explicit and non-executing;
5. improve local visual-explorer ergonomics while preserving bounded-search and presentation-truncation truth;
6. keep deterministic cross-platform validation current.

Repository Audit write/remediation mode remains disabled.

## Solve Graph state

Solve Graph remains deterministic and analyze-only. Current merged query/reference work includes JavaScript/TypeScript imports/references, Python local imports, explicit local PHP literal include/require relationships, local TypeScript/Angular configuration references, ranked node search, bounded dependency/dependent traversal, bounded shortest/alternative paths, deterministic shortest/alternative/impact explanations, integrity-covered path/query products, selected-node impact composition, affected-validation mapping, architecture/security summaries, and read-only MCP query/explanation exposure.

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
2. Wire the selected-node intelligence product (#464) into the local Repository Audit explorer with the affected-validation panel (#463), preserving stale-selection/race safety and explicit bounded truth.
3. Keep durable roadmap/handoff/production truth aligned with live repository state.
4. Continue Repository Audit impact/path explanation quality, MCP/Codex integration, conservative remaining relationships, visual-explorer ergonomics, and cross-platform tests.
5. Continue Solve Graph conservative language/reference adapters and bounded query/path/impact quality.
6. Continue Server Audit read-only relationship/posture quality and deterministic reporting/tests.
7. Continue language/runtime/DX work: formatter/linter, semantic/type checks, control-flow/module/package design, diagnostics, editor support, and deterministic tests.
8. Keep security/account hardening, rollback preservation, least privilege, launch readiness, and operations current.
9. Keep TOTP, customer-priority activation, billing, provider execution, email, and charge/refund work dormant behind fresh production approvals.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, rotate credentials, publish/alter the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or bypass fresh owner/protected approvals for live actions.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
