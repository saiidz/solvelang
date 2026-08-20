# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.

**Captured:** 2026-08-20

Before every build/integration run, reconcile current `main`, all open PRs, recent closed/merged/superseded PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation when applicable, active branches, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-19.md`. Live GitHub state and newer verified production evidence always win over hashes recorded here.

## Current repository checkpoint

At this refresh, `main` is `175afc8c4b70811202a14c265b3111ccc365e856`, the safe merge of Server Audit process-coverage report composition PR #600.

The safe non-production open-PR queue is **zero**. Historical PRs #161/#164/#169 are merged repository-state facts only; their former approval gates are not standing authorization for live production action.

The historical Repository Audit Python-import/dependency train #288 → #290 → #291 → #298 → #299 → #300 → #301 is merged and must not be recreated.

## Latest queue-drain checkpoint

The latest safe Server Audit train is fully merged:

- #581 — certificate-expiry fallback derives supplied expiry posture without endpoint/network validation.
- #582/#583/#584 — public-file root-reference and fixed-marker coverage fail closed for unavailable/sparse roots and compose into canonical JSON/HTML reports with structural/redacted evidence.
- #585 — synchronized roadmap/handoff truth through #584.
- #586 — closed unmerged after Hosted CI proved the proposed certificate-conflict scope duplicated the existing certificate-consistency stage.
- #587 — bounded missing certificate-expiry evidence for supplied certificate records lacking both `notAfter` and `daysRemaining`; certificate names remain withheld.
- #588 — backup-posture findings composed into canonical JSON/HTML reports; Hosted CI exposed duplicate 72-hour stale-backup reporting and the legacy duplicate was removed before merge.
- #589/#590 — bounded missing backup `ageHours` and `sizeBytes` evidence with structural array-index evidence only; backup names/paths remain withheld. #590 also corrected canonical limitation wording after review.
- #591 — bounded log coverage for explicit empty log inventory and per-record missing `modifiedAt` / `sizeBytes`; raw log paths remain withheld.
- #592 — documentation-only active-handoff sync through #591.
- #593 — bounded explicit-empty service inventory coverage. Reconciliation removed a proposed per-record `enabled` gap because the reviewed collector emits service name/state but not `enabled`, avoiding guaranteed false coverage noise.
- #594 — composes #593 into canonical Server Audit JSON/HTML reports with structural service evidence and an explicit limitation that empty inventory does not prove discovery completeness, boot enablement, runtime health, or collector authority.
- #595 — extends the package-version stage so explicit `packages: []` becomes bounded coverage evidence while absent `packages` remains generic coverage and concrete inventories remain unchanged. Canonical limitations preserve package-discovery/authority/vulnerability uncertainty; no advisory/CVE lookup occurs.
- #596 — documentation-only active-handoff sync through #595.
- #597 — bounded explicit-empty listening-socket coverage. Because the fixed read-only collector maps both empty `ss` output and command failure/unavailability to `[]`, an empty inventory is treated as unknown coverage rather than proof that the host has no listeners.
- #598 — composes #597 into canonical Server Audit JSON/HTML reports with structural listener evidence and a precise collector-authority/no-listener limitation.
- #599 — bounded explicit-empty process inventory coverage. Because the fixed read-only collector maps failed/unavailable `ps` execution or empty usable output to `[]`, an empty inventory is treated as unknown coverage rather than proof that the host has no processes.
- #600 — composes #599 into canonical Server Audit JSON/HTML reports with structural process evidence and an explicit process-collection limitation.

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
- #372/#373 and #432→#448 — bounded shortest paths, product/browser verification, deterministic explanations, and additive read-only MCP exposure.
- #450→#456 — deterministic alternative-path and dependent-impact explanations across core/browser/MCP.
- #457→#472 — selected-node impact/affected-validation browser intelligence, cancellation-safe request state, stale-selection protection, workflow-evidence identity, and deterministic interaction coverage.
- #480/#481 — Repository Audit reusable-workflow references and redacted Server Audit large-log evidence.
- #482/#485/#488/#492/#517/#520/#523/#525/#527/#543 — language loop control, conservative semantic checking, formatter/linter work, and deterministic pure collection/object helpers without widening capability gates.
- #498/#500/#508/#544 — billing-readiness correctness work only; production billing remains disabled.
- #502/#503/#504/#506/#510/#512/#518/#521/#526/#529/#548 — bounded MCP/LSP/editor surfaces and review fixes. LSP remains local, didOpen-cached, non-executing, and without workspace/network access.
- #513/#519/#530/#534/#542 — bounded entrypoint/unreached-candidate graph intelligence and local explorer filtering; these are structural candidates, not runtime reachability claims.
- #531/#538/#546/#550/#553/#554 — repository-only operational/readiness contracts; none authorize live provider, billing, credential, restore, routing, or production mutation.
- #533/#545 — deterministic imported `.solve` cycle/provenance hardening while imports remain compatibility includes rather than package/module semantics.
- #535/#539 — bounded Node workspace metadata/snapshot evidence.
- #537 — browser/WASM parity ADR; pure-core extraction is still required before browser runtime work.
- #549/#552/#556/#557 — bounded static Cargo, Go, .NET, and Maven evidence adapters. They parse explicit local files only and never evaluate build tools or resolve registries.
- #562→#578 — bounded static Docker Compose service/image and `depends_on` evidence, snapshot/artifact/presentation/browser surfaces, quoted static service keys, dependency panel, and top-level product wiring. Compose evaluation, interpolation/anchors/profiles, image resolution, container starts, network access, and writes remain disabled.
- #575/#576/#579 — bounded backup/log consistency evidence/findings and canonical report composition with exact-overlap deduplication.
- #577 — root-confined writes reject an existing symbolic-link final component.
- #581→#600 — latest bounded Server Audit certificate/public-file/backup/log/service/package/listener/process coverage and report-truth hardening described above.

## Repository Audit / Solve Graph state

Repository Audit and Solve Graph remain deterministic, bounded, local/analyze-only surfaces. Merged capabilities include repository ingestion/inventory; JavaScript/TypeScript, Python, conservative local PHP, TypeScript config, Angular/Nest, deployment/config, Node workspace, static Cargo/Go/.NET/Maven, and static Docker Compose evidence; dependency consistency; conservative dead-code evidence; test/documentation/workflow mapping; architecture/security-boundary summaries; ranked, shortest-path, alternative-path, dependent-impact, entrypoint, unreachable-candidate, cycle, hotspot, affected-validation, and security-summary queries; deterministic path/impact explanations; integrity-covered artifacts; local browser exploration; redaction; explicit complete/partial/truncation truth; and additive read-only MCP query/explanation surfaces.

Repository source is not executed to improve graph coverage. Gradle remains deferred because faithful build-script handling requires evaluation. Prefer conservative parser/config evidence and explicit unknown/partial states over guessed relationships. Repository Audit write/remediation mode remains disabled.

## Server Audit state

Server Audit remains read-only and non-remediating. Merged capabilities include a fixed allowlisted collector surface; bounded snapshot/schema parsing; OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence; deterministic findings; redaction; JSON/HTML reporting; process/listener/package/certificate/permission/inventory consistency checks; scheduled-job and service→process→listener structural relationships; stale/large-log evidence; local web-server/conventional HTTP(S)-listener consistency; backup/log contradiction findings; certificate-expiry fallback and coverage; fail-closed public-file reference/coverage integrity; backup posture plus freshness/size coverage; log inventory/metadata coverage; explicit empty-service/package/listener/process coverage; and canonical JSON/HTML composition for those coverage states.

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
4. Continue Server Audit read-only relationship/posture/report quality and deterministic cross-platform tests, especially package/service/port/process/scheduled-job relationships, cache/backup/log posture, and domain/TLS/public-file evidence.
5. Continue language/runtime/DX with conservative semantic/type checks, formatter/linter/module/package work, diagnostics, and editor support; keep LSP behavior local and non-executing.
6. Keep security/account hardening, rollback preservation, least privilege, launch readiness, and operations current.
7. Keep TOTP, customer-priority activation, billing activation, provider execution, email, and charge/refund work dormant behind fresh production approvals.

## Hard safety boundary

Safe automation may create/refresh isolated branches, implement code/tests/docs, create/update PRs, fix review findings or CI regressions, rerun safe CI, close/supersede duplicates with evidence, and merge non-production PRs only after exact-head required checks are green, mergeability is confirmed, and review threads are clean.

Do **not** automatically apply live AWS/IAM/KMS changes, deploy production, change DNS/private ingress, rotate credentials, publish/alter the production Admin UI, enable TOTP/customer priority/billing, use live Stripe/providers, create charges/refunds, send email, mutate production customer/CRM data, upload/execute customer source in production, or bypass fresh owner/protected approvals for live actions.

If a production gate or self-hosted validation blocks one track, record it and immediately continue another safe engineering task rather than idling.
