# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.  
**Captured:** 2026-08-20

Before every build/integration run, re-read current `main`, open/closed PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation state when relevant, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub and verified live production evidence always win over hashes recorded here.

## Current repository checkpoint

At this refresh, `main` before this documentation-only PR is `e9de9d5c7538d4f2bd2ee1bc7b0cbfcd3468b57f`, the merge of safe Server Audit public-file report-composition PR #584. The safe non-production PR queue is **zero**. This documentation sync is intentionally repository-only and does not change the authoritative production record.

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
- #512/#518/#521/#526/#529 — parser-backed local `solvelsp` go-to-definition, hover, document highlights, completion, and semantic tokens. They operate only on didOpen-cached documents; incremental sync, workspace indexing, execution, and network access remain unsupported.
- #513/#519 — bounded read-only MCP entrypoint and unreachable-from-known-entrypoint candidates. Both explicitly report structural candidates rather than runtime reachability claims.
- #514/#522 — impact artifacts now bind their graph/edge scope into canonical integrity verification; tampering fails rather than being presented as evidence.
- #515/#516 — opt-in VS Code `.solve` registration, syntax support, and explicitly disabled-by-default local `solvelsp`/saved-document formatter launch. It bundles no executable and never invokes `solvec run`.
- #517/#520/#523/#525/#527/#543 — deterministic pure object/collection helpers: `keys`, `values`, `entries`, and `is_empty`; all are semantic- and hardened-preflight-recognized without widening capability gates.
- #530/#534/#542 — bounded local Solve Graph unreached-candidate presentation, preservation of source/traversal/presentation partiality, and accessible node-kind filtering.
- #531 — restore-drill documentation/contract gate that records a UTC recovery point and aborts unsafe same-target, active-route, alias, or traffic-switch drills. It performs no restore or routing action.
- #533 — deterministic root-relative imported `.solve` cycle chains while imports remain compatibility includes, not a package registry or export system.
- #535/#539 — deterministic bounded Node workspace metadata and snapshot evidence, including manifest-text and skipped-evidence bounds with absent/partial/complete truth.
- #536 — bounded local structural cycle presentation; it does not claim a cycle is defective.
- #537 — browser/WASM parity ADR records the pure-core extraction prerequisite; the existing shared library still exposes host adapters and is not a safe WASM boundary.
- #538 — provider-neutral monitoring-readiness contract for future auth, billing, and priority signals. It creates no provider/resource/credential configuration and authorizes no deployment.
- #541 — public CLI truth sync for the implemented `fmt` and `lint` commands.
- #544 — receipt-time retention for delayed Stripe subscription-event replay records; subscription billing remains disabled and no live Stripe action occurred.
- #545 — nested imported `.solve` `check` diagnostics retain root-relative provenance and never leak an absolute source root.
- #546 — test-backed operations logging contract that allows only sanitized codes and allowlisted correlation fields; raw request/response bodies and caught exception messages/stacks are prohibited. It does not change live logging configuration.
- #548 — parser-gated `textDocument/formatting` for didOpen-cached documents using the canonical formatter. It returns no edit for unchanged text and has no execution, workspace, or incremental-sync capability.
- #549/#552/#556/#557 — bounded static Cargo, Go, .NET, and Maven evidence adapters. They parse explicit local manifest/project/POM facts under 1 MiB and 1,000-result bounds; preserve unresolved/outside-scan truth; and do not execute source/build tools, resolve registries, use a network, or write.
- #550 — fail-closed suspected API-key exposure incident contract: no plaintext key storage or investigation use, no emergency pepper rotation, and an owner-recorded revoke/suspend/handoff decision.
- #551/#555 — conservative lint warns after an `if` only when both explicit branches terminate; language-reference text now describes that structural rule without evaluating conditions.
- #553/#554 — owner-recorded evidence/reconciliation before re-enabling an emergency-disabled billing path, plus sanitized restore-drill evidence requirements. Neither permits a live billing action, restore, or routing/configuration change.
- #562→#574 — bounded static Docker Compose service/image evidence, snapshot/artifact/presentation/browser surfaces, explicit `depends_on` relationship evidence, relationship artifact/presentation/browser intelligence, quoted static service keys, and a bounded dependency panel. Compose evaluation, interpolation/anchors/profiles, image resolution, container starts, network access, and writes remain disabled.
- #577 — restricted root-confined writes reject an existing symbolic-link final component so an allowed-root path cannot overwrite an outside target.
- #578 — top-level Repository Audit product wiring for the already-merged Docker Compose relationship evidence/artifact/presentation: same-snapshot analysis, integrity-covered download, browser intelligence, dependency panel, and dedicated relationship-evidence download without changing historical canonical report schemas.
- #575/#576 — bounded Server Audit backup/log consistency analysis and standard redacted findings for contradictory duplicate evidence, using structural array-index sources only.
- #579 — canonical Server Audit report composition for #575/#576. The first head failed deterministic Studio tests (`3 !== 2`) and Codex raised a P1 because the new stage overlapped legacy artifact findings. The final exact head `7f1283fad81ecd0d9187f4ff7b47b231840ef3f0` deduplicates only identical category/title/structural-source evidence while preserving distinct legacy backup-by-path evidence; exact-head Hosted CI and Rust/RustSec passed and the review thread was resolved before merge.
- #580 — repository-only roadmap/handoff synchronization through #579; no production state changed.
- #581 — bounded certificate-expiry fallback findings from supplied `notAfter` timestamps when `daysRemaining` is absent. No endpoint validation or network access is performed.
- #582 — public-file marker references now fail closed when `rootIndex` does not resolve to an available root record. A Codex sparse-array finding was fixed and regression-tested before exact-head Hosted CI/Rust green merge.
- #583 — public-file fixed-marker coverage/contradiction analysis now ignores unavailable or sparse roots instead of inventing coverage or contradiction claims; #582 remains authoritative for the invalid-reference condition.
- #584 — public-file coverage/integrity is composed into canonical JSON/HTML reports with structural/redacted evidence. The first Hosted run exposed a legacy sparse-root crash in baseline permission analysis; that queue blocker was fixed, a direct baseline regression was added, the Codex P1 was resolved, and exact-head Hosted CI/Rust passed before merge.

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
- #498/#500/#502/#503/#504/#506/#507/#508/#510/#511 — latest billing-readiness, public availability truth, MCP, LSP, Solve Graph validation/impact, review-fix, and Server Audit queue-drain work described above;
- #562→#584 — latest Docker Compose Repository Audit, root-confined write hardening, Server Audit backup/log report composition, certificate-expiry fallback, and fail-closed public-file evidence/report integration.

Do not recreate merged generations merely because historical issues, branches, or earlier handoff text mention predecessor PR numbers.

## Repository Audit / Solve Graph state

Repository Audit and Solve Graph remain deterministic, bounded, local/analyze-only surfaces. Merged capabilities include repository ingestion/inventory; JavaScript/TypeScript, Python, conservative local PHP, TypeScript config, Angular/Nest, deployment/config, Node workspace, and static Docker Compose relationships; dependency consistency; conservative dead-code evidence; test/documentation and workflow mapping; architecture/security-boundary summaries; ranked, shortest-path, alternative-path and dependent-impact queries; deterministic path/impact explanations; selected-node affected-validation intelligence; integrity-covered artifacts; local browser exploration; redaction; explicit complete/partial/truncation truth; read-only MCP query/explanation surfaces; affected-validation candidates; hotspot candidates; and the bounded impact artifact/product bundle merged through #511.

Repository source is not executed to improve graph coverage. Static adapters now include local Cargo, Go, .NET, Maven, and conservative Docker Compose evidence; Gradle remains excluded because accurate build-script handling requires evaluation. The local explorer also presents bounded unreached candidates and node-kind filtering; MCP adds entrypoint/unreachable candidates, affected validations, cycles, hotspots, and security summaries. Prefer conservative parser/config evidence and explicit unknown/partial states over guessed relationships. Repository Audit write/remediation mode remains disabled.

## Server Audit state

Server Audit remains read-only and non-remediating. Merged capabilities include a fixed allowlisted collector surface, bounded snapshot/schema parsing, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, deterministic findings, redaction, JSON/HTML reporting, process/listener/package/certificate/permission/inventory consistency checks, bounded scheduled-job relationships, filesystem→log/backup relationship evidence, service→process→listener structural attribution, stale-log candidates, local web-server/conventional HTTP(S)-listener consistency evidence, backup/log consistency findings composed into canonical reports through #575/#576/#579 without exact-overlap double-counting, certificate-expiry fallback through #581, and fail-closed public-file root-reference/fixed-marker coverage findings composed into canonical reports through #582/#583/#584.

Continue package/service/port/process/scheduled-job relationship quality, log/cache/backup posture, domain/TLS/public-file evidence, ownership/permission/version findings, deterministic evidence, and cross-platform tests. Do not add remote mutation/remediation execution.

## Language/runtime and DX state

The Rust language/runtime includes lexer/parser/AST/runtime values and control flow, functions, arrays/objects, relative `.solve` imports, source locations/structured diagnostics, conservative semantic checking, merged `break`/`continue` loop control, pure collection helpers (`length`, `contains`, `get`, `keys`, `values`, `entries`, `is_empty`), deterministic formatter/linter commands, and a shared language library. Root-restricted writes now reject a symlink final component (#577). The `solvelsp` surface is intentionally local and stdio-only: initialize/shutdown, full-document didOpen parser diagnostics, document symbols, go-to-definition, hover, document highlights, completion, and semantic tokens. Incremental edits, workspace access, execution, and network access remain unsupported. The opt-in VS Code package only registers syntax/commands and defaults its executable launch settings to false.

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
4. Continue Server Audit read-only relationship/posture/report quality and deterministic cross-platform tests, especially cache/backup/log and domain/TLS/public-file evidence.
5. Continue language/runtime/DX with conservative semantic/type checks, formatter/linter/module/package work, diagnostics, and editor support; keep LSP behavior local and non-executing.
6. Keep security/account hardening, rollback preservation, least privilege, launch readiness, and operations current.
7. Keep TOTP, customer-priority activation, billing activation, provider execution, email, and charge/refund work dormant behind fresh production approvals.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, rotate credentials, publish/alter the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or bypass fresh owner/protected approvals for live actions.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.