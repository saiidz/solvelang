# SolveLang Active Buildout Handoff

**Purpose:** durable repository/build truth for continuing `saiidz/solvelang` without duplicating merged work or confusing repository state with production state.

**Captured:** 2026-08-21

> Historical checkpoint: this document contains detailed merged-train evidence captured on 2026-08-21. Use [project completion plan](project-completion-plan.md) for the current repository-completion checklist, and verify all GitHub/production facts live before acting.

Before every build/integration run, reconcile current `main`, all open PRs, recent closed/merged/superseded PRs, exact branch heads/bases, mergeability, review threads, Hosted CI/Rust/RustSec, self-hosted validation when applicable, active branches, open issues, `.github/workflows`, `ROADMAP.md`, this handoff, and `docs/current-production-status-2026-08-20.md`. Live GitHub state and newer verified production evidence always win over hashes recorded here.

## Repository refresh — 2026-09-04

Current repository checkpoint: `93c6c8c94c0c058e010f219dd501144b1287777f`, the protected squash merge of [#755](https://github.com/saiidz/solvelang/pull/755), following #800 at `ccfa95e82f5d819b6996d9902340032c2b0e07f5`. This refresh is repository evidence only; it does not re-verify or authorize production activity.

- #755 qualified exact head `5acf32ceebc03eb055db7fea2135fdbfb1366c93`: [Hosted CI](https://github.com/saiidz/solvelang/actions/runs/33925397839), [Rust/RustSec](https://github.com/saiidz/solvelang/actions/runs/33925397817), and [Trusted Mac on solve-mac-1](https://github.com/saiidz/solvelang/actions/runs/33925395481) all succeeded. Fresh code review reported no major issues; its earlier skipped-authorization finding was fixed and the thread resolved. The effective diff was one workflow file, reconciled once onto then-current main. No runner registration/service/label changed.
- Post-merge main [Hosted CI](https://github.com/saiidz/solvelang/actions/runs/33925921712) and [Rust/RustSec](https://github.com/saiidz/solvelang/actions/runs/33925922726) both passed at `93c6c8c94c0c058e010f219dd501144b1287777f`. #723 was then closed as superseded, without merging it.
- #771/#773/#775/#777 complete pure-core ownership/evaluation, deny-all WASM, shared native/preview/compiled-WASM conformance, and deterministic resource-limit foundations. Do not recreate these. Static browser-artifact security and browser replacement remain separate gates; `/run/` remains TypeScript.
- #779–#800 record Self-Driving observe-only progress: bounded Context, Scouts/Inbox, offline PostHog contracts, fake transport simulation, and composed Observe Run. Live credentials/providers, applied suggestions, PR writes, rollout mutations, and auto mode remain disabled. #778/#791 establish supplemental Oracle ARM64 qualification; Oracle never replaces required Mac evidence.
- #766 completes canonical CLI version behavior; #762/#764 provide non-publishable Linux x86_64 RC identity/checksum/provenance/smoke machinery. Neither Mac site CI nor Oracle runner availability establishes release support for a platform.
- Remaining work is tracked in the [completion plan](project-completion-plan.md). No completion report exists at this checkpoint; production billing/priority/provider processing remain disabled and all live/legal/business gates require explicit owner decisions.

## Historical repository checkpoint — 2026-08-21

At this refresh, reviewed source `main` is `47cd39ebcddab09113f40412b980c6ce3aa100d9`, the safe merge of #706.

The safe non-production open-PR queue is **zero** at this checkpoint. The historical Repository Audit Python-import/dependency train #288 → #290 → #291 → #298 → #299 → #300 → #301 is merged and must not be recreated. Historical #161/#164/#169 are merged repository-state facts only; their former approval phrases are not standing authorization for live production actions.

## Historical safe integration state — through #706

- #691 synchronized this handoff through #690.
- #692 pinned canonical JSON/HTML behavior for bounded inventory-consistency evidence.
- #693 bounded backup/log contradiction evidence to a reviewed default of 32 structural references while preserving exact affected-record cardinality and explicit truncation truth. Its review correction ensures a late conflicting witness survives a tight evidence bound instead of emitting a misleading prefix.
- #694 pinned canonical JSON/HTML behavior for that bounded backup/log evidence, including 32-of-40 cardinality truth, late-witness retention, and redaction of raw backup names/paths.
- #695 applied the same two-distinct-witness preservation rule to package, service, filesystem, web-root, and duplicate-process inventory contradictions while keeping topology findings independently bounded.
- #696 bounded the legacy artifact-consistency compatibility path to a reviewed default of 32 and hard maximum of 256 structural references per issue, preserved exact `sourceCount` plus truncation truth, bounded high-cardinality issue identity independently of caller-selected output limits, and kept preferred-vs-legacy canonical deduplication stable.
- #697 bounded ambiguous listener→process relationship source construction. The analyzer now streams complete stable identity while materializing at most the reviewed structural-source prefix; a 5,000-process regression pins historical identity, ordering, and truncation truth.
- #698 applied the same streaming-identity/bounded-source rule to grouped service→process relationships, again preserving historical IDs/order and bounding materialized structural evidence under 5,000-process ambiguity.
- #699 applied the same rule to filesystem→log/backup relationships while deliberately retaining the log/backup artifact witness as the final bounded source; a 5,000-filesystem ambiguity regression pins the historical relationship identity.
- #700 bounded scheduled-job→service/process relationship object construction itself. Exact reviewed head `7ba50ce07c67604bdfb2a2fcaeabb40935755a64` stops constructing every matched relationship object before applying `maxRelationships`; it preserves exact bounded candidate counts, existing stable IDs, and historical deterministic process-before-service ordering. A 10,000-target mixed service/process regression proves one-row materialization, exact candidate cardinality, relationship truncation, and partial-multi-target truth.
- #701 synchronized this handoff through #700.
- #702 bounded recognized web-server relationship finding materialization and service matching while preserving exact total finding cardinality and deterministic top-`maxFindings` output.
- #703, exact reviewed head `752a2cbf2c557ce9912a8876fd9232866ac9c7c1`, fixed the post-merge #702 Codex P2 by replacing per-observation retained-prefix sorting with bounded worst-first heap retention. A maximum 50-web-server × 5,000-service regression pins 250,000 observed findings at `maxFindings: 500`. Exact-head Hosted CI/Rust passed and the original #702 review thread was resolved with verified successor evidence.
- #704, exact reviewed head `9e4201678a81b8497edae0b9167bede8d17caea8`, removed full large-log finding-array materialization in favor of bounded heap retention while preserving exact total cardinality, deterministic ordering, truncation truth, and structural redaction. A 5,000-log regression pins the supported `maxFindings: 1000` boundary.
- #705, exact reviewed head `8926e782424ad728a4dfe2b83ca9ce6514feb2f5`, applied the same bounded retention rule to stale-log candidates, preserving exact candidate cardinality and the existing truncation marker under a 5,000-log regression.
- #706, exact reviewed head `0f26a20d7bdf11e1e8e0a36d2400f7e8db33bcb8`, applied bounded retention to backup-posture findings. A 5,000-backup regression where every record yields stale and zero-byte findings pins exact 10,000-finding truth while materializing only the bounded output prefix plus limitation marker. #706 passed exact-head Hosted CI and Rust/RustSec and merged as current `main` `47cd39ebcddab09113f40412b980c6ce3aa100d9`.

Ordinary branches in this recent Server Audit train used exact-head GitHub-hosted CI and Rust/RustSec. Trusted Mac or Trusted Windows was not required for #691–#706 and neither self-hosted lane was substituted for Hosted validation.

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

Server Audit remains read-only and non-remediating. Merged capabilities include a fixed allowlisted collector surface; bounded snapshot/schema parsing; OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence; deterministic findings; redaction; JSON/HTML reporting; process/listener/package/certificate/permission/inventory consistency checks; bounded service→process, service→process→listener, scheduled-job→service/process, recognized web-server→service/package, and filesystem→artifact structural relationships; ambiguity/unresolved/truncation/partial-fanout findings; stale/large-log evidence; local web/TLS/listener consistency; backup/log contradiction findings; certificate-expiry fallback and coverage; fail-closed public-file reference/coverage integrity; backup posture plus freshness/size coverage; log inventory/metadata coverage; explicit empty-inventory coverage; identity coverage; missing filesystem utilization/byte/source evidence; incomplete system telemetry/load-vector coverage; incomplete web-root owner/mode coverage; service/process state and service enablement coverage; structurally redacted process/service/public-listener/security-posture findings; bounded inventory-consistency issue evidence; and canonical JSON/HTML composition for those states.

Key trains that must not be recreated:

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
- #661/#662 — filesystem `usagePercent` coverage and canonical report composition.
- #666/#668 — incomplete supplied system telemetry/load-vector coverage and canonical report composition.
- #669/#670 — bounded web-root ownership/permission evidence coverage and canonical report composition.
- #672/#673 — structural filesystem-utilization findings and canonical report composition replacing legacy raw-mount evidence.
- #675/#676 — missing filesystem byte-accounting evidence and canonical report composition.
- #677/#678 — missing filesystem source/device identity evidence and canonical report composition.
- #679/#680 — blank normalized service-state evidence and canonical report composition.
- #682/#685 — service enablement coverage/report composition plus fixed read-only collector population of optional unit-file enablement evidence.
- #683/#684 — process-state coverage plus structural redaction of process/listener relationship findings.
- #686/#687/#689 — structural redaction of baseline failed-service, public-listener, and security-posture findings.
- #690/#692→#696 — bounded inventory/artifact contradiction evidence with limit-independent deterministic identity, exact source cardinality, explicit truncation truth, two-witness preservation, report regressions, and preferred-vs-legacy deduplication.
- #697→#706 — bounded high-cardinality relationship/finding construction for listener→process, service→process, filesystem→artifact, scheduled-job→service/process, web-server relationships, large/stale-log candidates, and backup posture while preserving exact bounded counts, stable identity, deterministic ordering, structural evidence, and truncation truth.

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
3. continue Server Audit read-only relationship/posture hardening: package/service/port/process/scheduled-job relationships, cache/log/backup consistency, domain/TLS/public-file evidence, ownership/permission/version truth, deterministic structural redaction, bounded source/object/finding construction, and cross-platform report tests;
4. continue language/runtime and DX through conservative semantics, diagnostics, package/module design, pure-core extraction, and non-executing editor support;
5. continue dormant customer-priority engineering only while queue/customer/provider gates remain OFF: source integrity, leases/retries/DLQ/observability, account/entitlement enforcement, report retention, credential boundaries, preflight validation, and safe browser/API readiness;
6. continue TOTP account-enrollment/login/backup-code preparation without repeating already-live infrastructure rollout or mutating accounts absent explicit approval;
7. continue billing readiness while production billing stays OFF and no real Stripe activity is authorized.

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

Repository provider/credential/report-retention/lease-hardening merges remain preparation only. They do not create or read live provider credentials, wire a provider into the production worker handler, call a provider, activate processing, expose customer priority, or enable billing.

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
