# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.

**Captured:** 2026-08-20

Before every build/integration run, reconcile current `main`, all open PRs, recent closed/merged/superseded PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation when applicable, active branches, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-20.md`. Live GitHub state and newer verified production evidence always win over hashes recorded here.

## Current repository checkpoint

At this refresh, reviewed source `main` is `5596acfb7ecc1695b6fd684900b1fc38672fb2f8`, the safe merge of #662.

The safe non-production open-PR queue is **zero** at this checkpoint. The historical Repository Audit Python-import/dependency train #288 → #290 → #291 → #298 → #299 → #300 → #301 is merged and must not be recreated. Historical #161/#164/#169 are merged repository-state facts only; their former approval phrases are not standing authorization for live production actions.

Recent safe integration state:

- #643 composes listener-identity coverage into canonical Server Audit JSON/HTML reports with structural/redacted evidence and an explicit authority limitation.
- #644 defines a provider-neutral customer-priority executor boundary. It is not wired into the production worker handler and does not select or call a provider.
- #646 defines provider credential-reference isolation around a production-namespaced Secrets Manager ARN and injected reader, without adding a live SDK client, secret read, IAM/KMS authority, provider call, or worker wiring.
- #648 adds bounded filesystem mount-identity coverage with structural `filesystems[index].mount` evidence and deterministic truncation truth.
- #649 adds SolveLang-owned customer-priority report retention: deterministic server-owned report IDs, bounded plain-text report content, worker/account-bound validation, and public-field filtering. It does not wire provider execution or change production gates.
- #650 composes #648 filesystem-identity coverage into canonical Server Audit JSON/HTML reports and adds an explicit filesystem-identity authority limitation plus redaction regression coverage.
- #652 adds bounded scheduled-job source/command identity coverage using structural `scheduledJobs[index].source` / `.commandSummary` evidence with deterministic truncation truth.
- #653 composes #652 into canonical Server Audit JSON/HTML reports, adds an explicit scheduled-job identity authority limitation, and pins redaction regression coverage.
- #654 synchronizes this handoff through #653 after exact-head Hosted CI and Rust/RustSec validation.
- #655 adds bounded local TLS-certificate/port-443 listener consistency evidence without probing endpoints or adding network capability.
- #656 composes #655 into canonical JSON/HTML reports with structural/redacted evidence and an explicit TLS-listener authority limitation.
- #657 was closed unmerged as a verified duplicate because `main` already contains the stronger package-version findings stage and canonical report composition.
- #658 composes bounded duplicate-listener ownership consistency into canonical JSON/HTML with structural-only evidence and an explicit ownership/reachability limitation.
- #659 composes recognized web-server ↔ service/package relationship findings into canonical JSON/HTML with redaction regression coverage and an explicit authority limitation.
- #660 synchronizes this handoff through #659 after exact-head Hosted CI and Rust/RustSec validation.
- #661 adds bounded coverage for supplied filesystem records that omit `usagePercent`, with structural `filesystems[index].usagePercent` evidence and deterministic truncation truth. A P1 review posted immediately after merge correctly identified that canonical report composition was still missing.
- #662 fixes that #661 P1 by composing filesystem-capacity coverage into canonical Server Audit JSON/HTML reports, adding an explicit authority limitation and redaction regression coverage.

All ordinary branches above used exact-head GitHub-hosted CI and Rust/RustSec. Customer-priority repository changes also used the applicable API Access / Customer Priority CI lanes. No Trusted Mac or Trusted Windows result was required or substituted for #643/#644/#646/#648/#649/#650/#652/#653/#654/#655/#656/#658/#659/#660/#661/#662.

## Customer-priority production truth

A separately triggered production workflow run `32431853270` successfully deployed the durable customer-priority foundation in **dormant** mode.

That deployment does **not** authorize or establish live customer-priority execution. The preserved boundary is:

- durable queue/foundation resources: deployed;
- queue processing gate: OFF;
- customer-priority gate: OFF;
- provider-execution gate: OFF;
- production billing: OFF;
- customer source upload / job submission through the new provider path: not established;
- credit consumption through the new provider path: not established.

Repository merges #644/#646/#649 remain preparation only. They do not create or read live provider credentials, wire a provider into the production worker handler, call a provider, activate processing, expose customer priority, or enable billing.

## Major merged work that must not be recreated

### Repository Audit / Solve Graph

- #288 → #301 — deterministic Python imports plus dependency consistency, direct test/documentation mapping, conservative dead-code candidates, configuration/workflow relationships, and bounded report integration.
- #311/#313/#314 — affected-test/workflow intelligence and report composition.
- #317/#319/#322/#327/#332 — architecture/security-boundary analysis, integrity-covered artifacts, bounded presentation, and browser export.
- #329/#335 — deterministic ranked Solve Graph node search and MCP exposure.
- #333 — bounded local TypeScript `extends` and project-reference relationships.
- #337/#348/#349 — bounded visual-explorer model, presentation model, and browser panel.
- #341 — conservative repository-local PHP literal `require`/`include` relationships.
- #350→#371 — deployment-path, Angular/Nest framework-path, and Angular target-config evidence/artifact/presentation/browser integration.
- #372/#373 and #432→#448 — bounded shortest paths, product/browser verification, deterministic explanations, and additive read-only MCP exposure.
- #450→#456 — deterministic alternative-path and dependent-impact explanations across core/browser/MCP.
- #457→#472 — selected-node impact/affected-validation browser intelligence, cancellation-safe request state, stale-selection protection, workflow-evidence identity, and deterministic interaction coverage.
- #480 — bounded GitHub reusable-workflow reference evidence.
- #513/#519/#530/#534/#542 — bounded entrypoint/unreached-candidate graph intelligence and local explorer filtering; these are structural candidates, not runtime reachability claims.
- #535/#539 — bounded Node workspace metadata/snapshot evidence.
- #549/#552/#556/#557 — bounded static Cargo, Go, .NET, and Maven evidence adapters. They parse explicit local files only and never evaluate build tools or resolve registries.
- #562→#578 — bounded static Docker Compose service/image and `depends_on` evidence, snapshot/artifact/presentation/browser surfaces, quoted static service keys, dependency panel, and top-level product wiring. Compose evaluation, interpolation/anchors/profiles, image resolution, container starts, network access, and writes remain disabled.

### Server Audit

Server Audit remains read-only and non-remediating. Merged capabilities include a fixed allowlisted collector surface; bounded snapshot/schema parsing; OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence; deterministic findings; redaction; JSON/HTML reporting; process/listener/package/certificate/permission/inventory consistency checks; bounded service→process, service→process→listener, and scheduled-job→service/process structural relationships; relationship ambiguity/unresolved/truncation/partial-fanout findings and canonical report coverage; stale/large-log evidence; local web-server/conventional HTTP(S)-listener consistency; backup/log contradiction findings; certificate-expiry fallback and coverage; fail-closed public-file reference/coverage integrity; backup posture plus freshness/size coverage; log inventory/metadata coverage; explicit empty-service/package/listener/process/scheduled-job/filesystem/web coverage; blank certificate/web/service/process/package/listener/filesystem/scheduled-job identity coverage; missing filesystem `usagePercent` coverage; canonical JSON/HTML composition for those coverage states; conservative handling of unavailable security posture probes; conservative systemd service-state classification; local TLS-certificate/port-443 consistency; duplicate-listener ownership consistency; and recognized web-server ↔ service/package relationship findings with canonical report composition.

Key recent trains that must not be recreated:

- #575/#576/#579 — backup/log consistency evidence, findings, and canonical report composition with exact-overlap deduplication.
- #581→#615 — certificate/public-file/backup/log/service/package/listener/process/scheduled-job/filesystem/web coverage, security-probe truth, normal systemd state truth, and canonical report regression coverage.
- #617→#628 — bounded/redacted service→process→listener, service→process, and scheduled-job→service/process relationship findings/report composition plus relationship construction/index/fanout hardening.
- #630→#637 — certificate/web/service/process/package identity coverage and canonical report composition.
- #641/#643 — listener identity coverage and report composition.
- #648/#650 — filesystem identity coverage and report composition.
- #652/#653 — scheduled-job source/command identity coverage and canonical report composition.
- #655/#656 — local TLS-certificate/port-443 listener consistency and canonical report composition.
- #658 — duplicate-listener ownership consistency canonical report composition.
- #659 — recognized web-server/service/package relationship canonical report composition.
- #661/#662 — filesystem `usagePercent` coverage and canonical report composition, including the post-merge P1 correction.

Automatic remote remediation execution remains out of scope.

### Language/runtime and DX

- #482/#485/#488/#492 — loop control, conservative semantic checking, formatter/linter work.
- #517/#520/#523/#525/#527/#543 — deterministic pure collection/object helpers while hardened execution continues to deny capability-bearing builtins.
- #503/#510/#512/#518/#521/#526/#529 — local stdio-only LSP diagnostics/symbols/definition/hover/highlights/completion/semantic tokens/formatting.
- #515/#516 — opt-in VS Code package with executable launch disabled by default.
- #577 — root-confined writes reject an existing symbolic-link final component.
- #537 — browser/WASM parity ADR; pure-core extraction is still required before browser runtime work.

## Current safe engineering order

Re-evaluate live state before every run. When the safe non-production PR queue exceeds six, drain it before unrelated feature work.

With the queue at zero, the strongest safe continuations are:

1. keep `ROADMAP.md`, this handoff, Issue #157, and production truth synchronized;
2. continue bounded Repository Audit / Solve Graph reference, path, impact, affected-validation, MCP/Codex, and visual-explorer quality without executing repository source;
3. continue Server Audit read-only relationship/posture hardening: package/service/port/process/scheduled-job relationships, cache/log/backup consistency, domain/TLS/public-file evidence, ownership/permission/version truth, deterministic redaction, and cross-platform report tests;
4. continue language/runtime and DX through conservative semantics, diagnostics, package/module design, pure-core extraction, and non-executing editor support;
5. continue dormant customer-priority engineering only while queue/customer/provider gates remain OFF: source integrity, leases/retries/DLQ/observability, account/entitlement enforcement, report retention, credential boundaries, preflight validation, and safe browser/API readiness;
6. continue TOTP account-enrollment/login/backup-code preparation without repeating already-live infrastructure rollout or mutating accounts absent explicit approval;
7. continue billing readiness while production billing stays OFF and no real Stripe activity is authorized.

## Self-hosted validation policy

### Trusted Mac

`.github/workflows/trusted-mac-ci.yml` is push-only for owner-controlled `agent/mac-*`, read-only, targets `[self-hosted, macOS, ARM64]`, and uses `cancel-in-progress: false`. Missing, queued, or unobserved status is not success. Never modify runner registration/services or substitute Windows for a required Mac result.

### Trusted Windows

`.github/workflows/trusted-windows-ci.yml` is push-only for owner-controlled `agent/windows-*`, read-only, uses no repository secrets, targets `[self-hosted, Windows, X64]`, and uses `cancel-in-progress: false`. Use it when materially useful for Windows/cross-platform behavior. Never interrupt a busy runner or treat Windows as a substitute for an explicit Trusted Mac requirement.

## Authoritative production truth

`docs/current-production-status-2026-08-20.md` is authoritative for the TOTP/KMS/IAM facts explicitly re-verified on 2026-08-20. Later verified production facts must be layered on explicitly rather than inferred from repository merges.

Current production boundaries include:

- API access and customer accounts/password authentication: enabled;
- private Admin Gateway/static Admin UI behind Cloudflare Access: live from separately approved production work;
- authenticator-app TOTP environment feature flag: enabled;
- dedicated production TOTP KMS stack/key/alias: live and re-verified;
- expected TOTP preflight/deploy OIDC supplemental policies: attached and re-verified;
- specific customer-account authenticator enrollment: separate account-level state; not established by infrastructure state;
- durable customer-priority foundation: deployed dormant;
- queue processing: OFF;
- customer priority: OFF;
- provider execution: OFF;
- subscription billing and production billing webhook: disabled;
- paid priority: disabled;
- real-charge authorization: none;
- general managed hosted SolveLang workflow execution: not live;
- Repository Audit write/remediation mode: disabled;
- Server Audit mutation/remediation mode: disabled.

Repository merges do not change those live-state facts by themselves.

## Hard production boundary

Do not automatically live-apply AWS/IAM/KMS changes, deploy production, change DNS/private ingress/Cloudflare Access, publish or mutate the production Admin UI, enroll customer TOTP, activate queue/customer/provider processing, enable customer priority, enable billing, use live Stripe/provider credentials, create charges/refunds, send email, mutate production customer/CRM data, execute uploaded customer source in production, or bypass protected environments/owner approvals.

If a production-sensitive track reaches an approval gate, stop that track and continue safe repository-only work elsewhere.