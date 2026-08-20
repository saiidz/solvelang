# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.

**Captured:** 2026-08-20

Before every build/integration run, reconcile current `main`, all open PRs, recent closed/merged/superseded PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation when applicable, active branches, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub state and newer verified production evidence always win over hashes recorded here.

## Current repository checkpoint

At this refresh, `main` before this documentation-only PR is `448d825bccf9e8b7035f568432cbf6aca39aeeab`, the merge of safe Server Audit log-evidence coverage PR #591.

The safe non-production open-PR queue is **zero**. No production-sensitive PR is currently an open integration blocker. Historical PRs #161/#164/#169 are merged repository-state facts only; their former approval gates are not standing authorization for any live production action.

The historical Repository Audit Python-import/dependency train #288 → #290 → #291 → #298 → #299 → #300 → #301 is merged and must not be recreated.

## Latest queue-drain checkpoint

The latest safe Server Audit train is fully merged:

- #581 — bounded certificate-expiry fallback derives expiry posture from supplied `notAfter` only when `daysRemaining` is absent; no endpoint connection or network validation.
- #582 — public-file evidence fails closed when `rootIndex` does not resolve to an available root record.
- #583 — public-file coverage/contradiction analysis ignores unavailable or sparse root slots instead of inventing evidence.
- #584 — public-file coverage/integrity is composed into canonical JSON/HTML reports with structural/redacted evidence; Hosted CI exposed and the branch fixed a legacy sparse-root crash before merge.
- #585 — synchronized roadmap/handoff truth through #584.
- #586 — closed unmerged after Hosted CI proved the proposed certificate-conflict scope already existed more precisely in the merged certificate-consistency stage.
- #587 — bounded missing certificate-expiry coverage for supplied certificate records lacking both `notAfter` and `daysRemaining`; certificate names remain withheld.
- #588 — bounded backup-posture findings composed into canonical JSON/HTML reports. The first Hosted run exposed duplicate 72-hour stale-backup reporting; the legacy duplicate was removed before exact-head green merge.
- #589 — bounded missing backup freshness evidence (`ageHours`) with structural array-index evidence only; backup names/paths remain withheld.
- #590 — bounded missing backup `sizeBytes` evidence. A Codex truthfulness finding required the canonical limitation and its regression test to describe both freshness and size uncertainty before exact-head green merge.
- #591 — bounded log evidence coverage for explicit empty log inventory and per-record missing `modifiedAt` / `sizeBytes`; raw log paths remain withheld and invalid/future timestamps stay delegated to the existing temporal-integrity stage.

All ordinary branches in this train used GitHub-hosted validation. No Trusted Mac or Trusted Windows result was required or substituted, and no runner registration, service, labels, or routing changed.

## Major merged work that must not be recreated

The following generations are merged repository history. Historical issues, branches, or old handoff text are not instructions to rebuild them:

- #288 → #290 → #291 → #298 → #299 → #300 → #301 — deterministic Python imports plus Repository Audit dependency consistency, direct test/documentation mapping, conservative dead-code candidates, configuration/workflow relationships, and bounded report integration.
- #311/#313/#314 — affected-test/workflow intelligence and report composition.
- #317/#319/#322/#327/#332 — architecture/security-boundary analysis, integrity-covered artifacts, bounded presentation, and browser export.
- #329/#335 — deterministic ranked Solve Graph node search and MCP exposure.
- #333 — bounded local TypeScript `extends` and project-reference relationships.
- #337/#348/#349 — bounded visual-explorer model, presentation model, and browser panel.
- #340 — bounded Server Audit scheduled-job relationships from sanitized summaries only.
- #341 — conservative repository-local PHP `require`/`include` relationships for explicit static local literals only.
- #350→#356 — bounded deployment-path evidence/artifact/presentation/browser integration.
- #358→#364 — bounded Angular/Nest framework-path evidence/artifact/presentation/browser integration.
- #365→#371 — bounded Angular target `options.tsConfig` evidence/artifact/presentation/browser integration.
- #372/#373 — bounded deterministic Solve Graph shortest paths and read-only MCP exposure.
- #432/#436/#439/#441/#442/#443 — shortest-path verifier/product/query-product/browser train; #437/#438/#440 are superseded history.
- #445/#446/#447/#448 — deterministic shortest-path explanations across core/browser/MCP.
- #450→#453 — deterministic alternative-path explanations across MCP/core/Repository Audit browser.
- #455/#456 — deterministic bounded dependent-impact explanations and read-only MCP exposure.
- #457→#472 — selected-node impact/affected-validation browser intelligence, cancellation-safe request state, stale-selection protection, workflow-evidence identity, and deterministic interaction coverage.
- #480/#481 — Repository Audit reusable-workflow references and redacted Server Audit large-log evidence.
- #482 — SolveLang `break` / `continue` loop control.
- #484 — sanitized incident-record gate/QA contract.
- #485 — conservative `solvec check` semantic analysis, including compatibility with merged loop-control statements.
- #486/#487/#488/#489/#490/#491/#492/#493/#495/#496/#497 — graph hotspot, MCP workspace-boundary hardening, formatter/linter/runtime helpers, Server Audit relationship/log evidence, affected-validation MCP, local-module/browser-runtime ADRs, and shared language-library work.
- #498/#500/#508/#544 — billing-readiness correctness work only; production billing remains disabled.
- #502/#503/#504/#506/#510/#512/#518/#521/#526/#529/#548 — bounded MCP/LSP/editor surfaces and review fixes. LSP remains local, didOpen-cached, non-executing, and without workspace/network access.
- #513/#519 — bounded structural entrypoint and unreachable-from-known-entrypoint candidates; no runtime-reachability claim.
- #514/#522 — impact artifacts bind graph/edge scope into integrity verification.
- #515/#516 — opt-in VS Code support with executable launch disabled by default.
- #517/#520/#523/#525/#527/#543 — deterministic pure object/collection helpers including `keys`, `values`, `entries`, and `is_empty` without widening capability gates.
- #530/#534/#542 — bounded unreached-candidate presentation, partiality preservation, and node-kind filtering in the local explorer.
- #531/#538/#546/#550/#553/#554 — repository-only operational/readiness contracts; none authorize live provider, billing, credential, restore, routing, or production mutation.
- #533/#545 — deterministic imported `.solve` cycle/provenance hardening while imports remain compatibility includes rather than package/module semantics.
- #535/#539 — bounded Node workspace metadata/snapshot evidence.
- #537 — browser/WASM parity ADR; pure-core extraction is still required before browser runtime work.
- #549/#552/#556/#557 — bounded static Cargo, Go, .NET, and Maven evidence adapters. They parse explicit local files only, preserve unresolved/outside-scan truth, and never evaluate build tools or resolve registries.
- #562→#578 — bounded static Docker Compose service/image and `depends_on` evidence, snapshot/artifact/presentation/browser surfaces, quoted static service keys, dependency panel, and top-level product wiring. Compose evaluation, interpolation/anchors/profiles, image resolution, container starts, network access, and writes remain disabled.
- #575/#576/#579 — bounded backup/log consistency evidence/findings and canonical report composition with exact-overlap deduplication.
- #577 — root-confined writes reject an existing symbolic-link final component so an allowed-root path cannot redirect an overwrite outside the root.
- #581→#591 — latest bounded Server Audit certificate/public-file/backup/log coverage and report-truth hardening described above.

## Repository Audit / Solve Graph state

Repository Audit and Solve Graph remain deterministic, bounded, local/analyze-only surfaces. Merged capabilities include repository ingestion/inventory; JavaScript/TypeScript, Python, conservative local PHP, TypeScript config, Angular/Nest, deployment/config, Node workspace, static Cargo/Go/.NET/Maven, and static Docker Compose evidence; dependency consistency; conservative dead-code evidence; test/documentation/workflow mapping; architecture/security-boundary summaries; ranked, shortest-path, alternative-path, dependent-impact, entrypoint, unreachable-candidate, cycle, hotspot, affected-validation, and security-summary queries; deterministic path/impact explanations; integrity-covered artifacts; local browser exploration; redaction; explicit complete/partial/truncation truth; and additive read-only MCP query/explanation surfaces.

Repository source is not executed to improve graph coverage. Gradle remains deferred because faithful build-script handling requires evaluation. Prefer conservative parser/config evidence and explicit unknown/partial states over guessed relationships. Repository Audit write/remediation mode remains disabled.

## Server Audit state

Server Audit remains read-only and non-remediating. Merged capabilities include a fixed allowlisted collector surface; bounded snapshot/schema parsing; OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence; deterministic findings; redaction; JSON/HTML reporting; process/listener/package/certificate/permission/inventory consistency checks; scheduled-job and service→process→listener structural relationships; stale/large-log evidence; local web-server/conventional HTTP(S)-listener consistency; backup/log contradiction findings; certificate-expiry fallback and coverage; fail-closed public-file reference/coverage integrity; backup posture plus freshness/size coverage; and log inventory/metadata coverage.

Continue package/service/port/process/scheduled-job relationship quality, cache/log/backup posture, domain/TLS/public-file evidence, ownership/permission/version findings, deterministic evidence, and cross-platform parser/report tests. Do not add remote mutation/remediation execution.

## Language/runtime and DX state

The Rust language/runtime includes lexer/parser/AST/runtime values and control flow, functions, arrays/objects, relative `.solve` compatibility imports, source locations/structured diagnostics, conservative semantic checking, `break`/`continue`, deterministic formatter/linter commands, and pure collection/object helpers. Root-restricted writes reject an existing symbolic-link final component.

The `solvelsp` surface is intentionally local and stdio-only with didOpen-cached diagnostics/symbols/definition/hover/highlights/completion/semantic tokens/formatting. Incremental sync, workspace indexing/access, repository execution, and network access remain unsupported. The opt-in VS Code package bundles no executable and defaults executable launch settings to false.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and uses `cancel-in-progress: false`. Missing, queued, or unobserved status is not success. Never modify runner registration/services or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and uses `cancel-in-progress: false`. Use it when materially useful for Windows/cross-platform behavior. Never interrupt a busy runner or treat Windows as a substitute for an explicit Trusted Mac requirement.

## Authoritative production truth

`docs/current-production-status-2026-08-19.md` remains authoritative unless newer verified production evidence explicitly supersedes it.

Current boundaries include:

- API access and customer accounts/password authentication: **enabled**;
- Admin CRM backend/private Admin Gateway/static Admin UI behind Cloudflare Access: **live from separately approved production work**;
- authenticator-app TOTP rollout: **disabled / incomplete**;
- dedicated production TOTP KMS rollout: **not performed in the verified Admin work**;
- subscription billing: **disabled**;
- production billing webhook path: **disabled by feature boundary**;
- paid customer priority: **disabled**;
- queue/customer/provider activation: **not established by repository merges**;
- real charge authorization: **none**;
- general managed hosted SolveLang workflow execution: **not live**;
- Repository Audit write/remediation mode: **disabled**;
- Server Audit mutation/remediation mode: **disabled**.

Repository merges do not change those live-state facts by themselves.

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
