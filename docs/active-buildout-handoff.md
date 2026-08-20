# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-20

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation state when relevant, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub and verified live production evidence always win over hashes recorded here.

## Current repository checkpoint

At this refresh, `main` before this documentation-only PR is `19115da27cd93443d4186117b5233dce4f2c7ed2`, the merge of safe API availability-copy PR #508. The safe non-production PR queue is **one**: this documentation-sync PR #509.

The historical #288→#301 Repository Audit dependency train is merged and must not be recreated. PRs #161/#164/#169 are also merged repository-history facts only; their historical merge approvals are not standing authorization for deployment or live activation.

## Latest queue-drain checkpoint

The 2026-08-20 queue drain reconciled safe branches prepared across several fast-moving `main` generations. The following merged scopes are current repository facts and must not be recreated:

- #486 — bounded read-only MCP graph hotspot candidates with explicit candidate/traversal truncation truth; no runtime-criticality claim.
- #487 — MCP workspace-file symlink escape hardening. Shared file-backed tools reject symlink traversal and canonicalize root/target boundaries before reads.
- #488 — deterministic token-oriented `solvec fmt` / `solvec fmt --check`, preserving comments and source string spelling rather than reconstructing formatting from the AST.
- #489 — pure `length`, `contains`, and safe `get` helpers for text/arrays/objects, allowed in hardened execution without changing I/O/network/environment capability gates.
- #490 — bounded Server Audit service→process→listener structural attribution with ambiguity/unresolved evidence preserved and no application-ownership or public-reachability inference.
- #491 — bounded stale-log activity candidates from supplied sanitized log timestamps and snapshot time, with paths withheld and no rotation/service-health/workload inference.
- #492 — conservative read-only `solvec lint` with source-located unreachable-statement and known capability-bearing-call warnings.
- #493 — bounded read-only MCP affected-validation candidates for structural `test`/`workflow`/`job` evidence, with traversal and presentation bounds kept distinct.
- #495 — local module/package foundation ADR describing canonical identity, explicit exports, cycle handling, hardened constraints, and deferred registry/version solving.
- #496 — browser/WASM runtime parity ADR defining a pure-Rust/deny-all capability boundary, parity fixtures, import/capability audits, and resource limits before browser execution work.
- #497 — shared canonical `solvec` language-library extraction used by the CLI and later editor tooling; no transport or execution capability was added by that extraction.
- #498 — dynamic subscription payment-method readiness fix. It removes the hard-coded SetupIntent payment-method type while preserving the server-owned customer/metadata/off-session contract. Billing remains OFF and no live Stripe action was performed.
- #500 — stale subscription normalization fix. Payment-method normalization now follows the accepted lifecycle projection event order rather than stale active/trialing events. Billing remains OFF.
- #501 — closed unmerged only after current-main successor #503 preserved the reviewed LSP implementation.
- #503 — minimal stdio language diagnostics server merged. It supports bounded `Content-Length` framing, `initialize`, `shutdown`, and full-document `textDocument/didOpen` parser diagnostics. Incremental edits, workspace access, repository execution, and network access remain unsupported.
- #502 — bounded read-only MCP graph security summary merged. Temporary duplicate/successor #505 was closed unmerged after the merged scope was verified.
- #499 — closed unmerged only after current-main successor #504 preserved the reviewed affected-validation explorer scope.
- #504 — bounded affected test/workflow/job candidates merged into the Solve Graph explorer. A post-merge review found that a directly selected `test`, `workflow`, or `job` was incorrectly filtered from the depth-zero candidate set.
- #506 — the #504 review finding was fixed and merged exact-head green. The adapter now retains matching depth-zero validation roots and has deterministic regression coverage.
- #494 — closed unmerged after current-main successor #507 was created. #507 preserved the reviewed web-listener finding/test blobs while reapplying only intended docs/report wiring on top of newer Server Audit report stages.
- #507 — bounded Server Audit web-listener consistency evidence merged. It compares supplied local web-server evidence with conventional local TCP HTTP(S) listener evidence, performs no network scan, and does not infer application ownership or public reachability.
- #510 — parser-backed `textDocument/documentSymbol` support for documents opened through the minimal stdio LSP. Full-document diagnostics remain supported; incremental edits, workspace access, execution, and editor packaging remain unsupported.
- #511 — bounded analyze-only Solve Graph impact artifact/download/product bundle with canonical digest verification and no network or write capability.
- #508 — public API pricing now labels subscription plans as preview-only/unavailable while recurring billing is disabled, removes purchase-implying CTA wording, and records that cancellation/refund/invoice/support terms must exist before launch. No live Stripe action, billing activation, or production deployment occurred.

All ordinary branches in this drain used GitHub-hosted CI/Rust/RustSec. No Trusted Mac or Trusted Windows result was required or substituted, and no runner registration, service, labels, or routing changed.

## Major merged work that must not be recreated

- #288 → #290 → #291 → #298 → #299 → #300 → #301 — deterministic Python imports plus Repository Audit dependency consistency, direct test/documentation mapping, conservative dead-code candidates, configuration/workflow relationships, and bounded report integration;
- #311/#313/#314 — affected-test/workflow intelligence and report composition;
- #317/#319/#322/#327/#332 — architecture/security-boundary analysis, integrity-covered artifacts, bounded presentation, and browser export;
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
- #445/#446/#447/#448 — deterministic shortest-path explanations across core/browser/MCP;
- #450→#453 — deterministic alternative-path explanations across MCP/core/Repository Audit browser;
- #455/#456 — deterministic bounded dependent-impact explanations and read-only MCP exposure;
- #457→#472 — selected-node impact/affected-validation browser intelligence, cancellation-safe request state, stale-selection protection, workflow-evidence identity, and deterministic interaction coverage;
- #480/#481 — Repository Audit reusable-workflow references and redacted Server Audit large-log evidence;
- #482 — SolveLang `break`/`continue` loop control;
- #484 — sanitized incident-record gate/QA contract;
- #485 — conservative `solvec check` semantic analysis, including compatibility with merged loop-control statements;
- #486/#487/#488/#489/#490/#491/#492/#493/#495/#496/#497 — hotspot, workspace-boundary, formatter/linter/runtime-helper, Server Audit relationship/log, affected-validation MCP, module/browser-runtime ADR, and shared-language-library work described above;
- #498/#500/#502/#503/#504/#506/#507/#508/#510/#511 — latest billing-readiness, public availability truth, MCP, LSP, Solve Graph validation/impact, review-fix, and Server Audit queue-drain work described above.

Do not recreate merged generations merely because historical issues, branches, or earlier handoff text mention predecessor PR numbers.

## Repository Audit / Solve Graph state

Repository Audit and Solve Graph remain deterministic, bounded, local/analyze-only surfaces. Merged capabilities include repository ingestion/inventory; JavaScript/TypeScript, Python, conservative local PHP, TypeScript config, Angular/Nest and deployment/config relationships; dependency consistency; conservative dead-code evidence; test/documentation and workflow mapping; architecture/security-boundary summaries; ranked, shortest-path, alternative-path and dependent-impact queries; deterministic path/impact explanations; selected-node affected-validation intelligence; integrity-covered artifacts; local browser exploration; redaction; explicit complete/partial/truncation truth; read-only MCP query/explanation surfaces; affected-validation candidates; hotspot candidates; and the bounded impact artifact/product bundle merged through #511.

Repository source is not executed to improve graph coverage. Prefer conservative parser/config evidence and explicit unknown/partial states over guessed relationships. Repository Audit write/remediation mode remains disabled.

## Server Audit state

Server Audit remains read-only and non-remediating. Merged capabilities include a fixed allowlisted collector surface, bounded snapshot/schema parsing, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, deterministic findings, redaction, JSON/HTML reporting, process/listener/package/certificate/permission/inventory consistency checks, bounded scheduled-job relationships, filesystem→log/backup relationship evidence, service→process→listener structural attribution, stale-log candidates, and local web-server/conventional HTTP(S)-listener consistency evidence through #507.

Continue package/service/port/process/scheduled-job relationship quality, log/cache/backup posture, domain/TLS/public-file evidence, ownership/permission/version findings, deterministic evidence, and cross-platform tests. Do not add remote mutation/remediation execution.

## Language/runtime and DX state

The Rust language/runtime includes lexer/parser/AST/runtime values and control flow, functions, arrays/objects, relative `.solve` imports, source locations/structured diagnostics, conservative semantic checking, merged `break`/`continue` loop control, pure collection helpers, deterministic formatter/linter commands, and a shared language library. The `solvelsp` surface is intentionally local and stdio-only: initialize/shutdown, full-document didOpen parser diagnostics, and parser-backed document symbols. Incremental edits, workspace access, execution, network access, and editor packaging remain unsupported.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and does not cancel a running validation. Missing/queued/unobserved status is not success. Never modify runner registration/services or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and does not cancel running validation. Use it when materially useful for Windows/cross-platform behavior. Never interrupt a busy runner or treat Windows as a substitute for an explicit Trusted Mac gate.

## Authoritative production truth

`docs/current-production-status-2026-08-19.md` remains the authoritative production-facing record unless newer verified production evidence explicitly supersedes it.

Current boundaries include:

- API access and customer accounts/password authentication: **enabled**;
- Admin CRM backend/private Admin Gateway/static Admin UI behind Cloudflare Access: **live from separately approved production work**;
- authenticator-app TOTP rollout: **disabled / incomplete**;
- dedicated production TOTP KMS rollout: **not performed in the verified Admin work**;
- subscription billing: **disabled**;
- paid customer priority: **disabled**;
- queue/customer/provider activation: **not established by repository merges**;
- real charge authorization: **none**;
- general managed hosted SolveLang workflow execution: **not live**;
- Repository Audit write/remediation mode: **disabled**;
- Server Audit mutation/remediation mode: **disabled**.

Repository merges such as #498/#500/#508 do not change those live-state facts by themselves.

## Safe queue and integration policy

When more than six safe non-production PRs are open, drain the existing queue before starting unrelated feature work. Refresh stale branches, retarget dependency stacks, fix CI/review findings, close verified superseded predecessors, and merge only exact-head green, mergeable, review-clean non-production work.

When the safe queue is six or fewer, new safe work may proceed only after live repository state is reconciled and merged scopes are checked to avoid duplication.

## Current safe engineering order

1. Keep Hosted CI/Rust/RustSec blockers clear and drain any safe queue first.
2. Keep `ROADMAP.md`, this handoff, Issue #157 integration truth, and production truth aligned with live repository state.
3. Continue Repository Audit/Solve Graph bounded query/path/impact, affected-validation, MCP/Codex, visual-explorer, artifact verification, and conservative reference quality.
4. Continue Server Audit read-only relationship/posture/report quality and deterministic cross-platform tests.
5. Continue language/runtime/DX with conservative semantic/type checks, formatter/linter/module/package work, diagnostics, and editor support; keep LSP behavior local and non-executing.
6. Keep security/account hardening, rollback preservation, least privilege, launch readiness, and operations current.
7. Keep TOTP, customer-priority activation, billing activation, provider execution, email, and charge/refund work dormant behind fresh production approvals.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, rotate credentials, publish/alter the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or bypass fresh owner/protected approvals for live actions.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
