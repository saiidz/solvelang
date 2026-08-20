# SolveLang Roadmap

SolveLang is an early language and workflow-analysis prototype written primarily in Rust, with a production customer-account/API/Admin foundation that is further along than the general managed-execution product.

This roadmap distinguishes four states deliberately:

- **working locally / in code**;
- **experimental or test-only**;
- **production deployed but gated/limited**;
- **planned**.

A merged feature is not automatically production-enabled, and production account/Admin infrastructure is not evidence that general hosted SolveLang workflow execution exists. Live GitHub state, `docs/active-buildout-handoff.md`, and `docs/current-production-status-2026-08-19.md` take precedence over stale hashes or historical planning text.

## Current implementation overlay — 2026-08-20

- Centralized account suspension/termination foundations and rollback-preservation hardening are merged in repository history through #147/#161. Repository merge does not authorize a live account mutation or deployment.
- Imported-file source provenance is merged through #159.
- Admin Gateway deployment machinery (#168), private-ingress/publication preparation (#172/#321), and repository-only IAM/preflight corrections (#308/#312) are merged. Separately approved 2026-08-19 production work deployed the private Admin Gateway, Cloudflare Access/private ingress, static Admin UI, and rotated the Admin application password. Future live changes require fresh approval.
- The RustSec `h2` advisory that blocked the safe merge train was remediated through #229; Rust/RustSec CI remains mandatory.
- Repository Audit is implemented well beyond a v0 contract. The deterministic Python-import/dependency/coverage/dead-code/config/workflow train (#288 → #290 → #291 → #298 → #299 → #300 → #301) is merged and must not be recreated.
- Repository Audit affected-test/workflow mapping and report composition are merged through #311/#313/#314.
- Architecture/security-boundary analysis, integrity-covered artifacts, presentation, and browser export are merged through #317/#319/#322/#327/#332.
- Deployment-path evidence/artifact/presentation/browser integration is merged through #350→#356.
- Angular/Nest framework-path evidence/artifact/presentation/browser integration is merged through #358→#364.
- Angular target `options.tsConfig` evidence/artifact/presentation/browser integration is merged through #365→#371.
- Solve Graph deterministic ranked node search is merged in the core and MCP surfaces through #329/#335, local visual-explorer modeling through #337/#348/#349, conservative repository-local PHP include/require relationships through #341, bounded shortest-path queries through #372, and read-only MCP shortest-path exposure through #373. These remain bounded and analyze-only.
- The bounded shortest-path product train is merged through #432/#436/#439/#441/#442/#443. Deterministic shortest-path explanations and MCP explanation exposure are merged through #445/#446/#447/#448, including additive read-only `solvelang_graph_explain_shortest_path` with packed-consumer validation.
- Deterministic alternative-path explanation quality is merged through #450→#453, including `solvelang_graph_explain_alternative_paths` and Repository Audit browser explanations. Query truncation remains distinct from presentation-row truncation and zero-hop identity remains explicit.
- Deterministic dependent-impact explanations are merged through #455/#456 in the core and read-only MCP surfaces.
- The local Solve Graph explorer now presents bounded unreached candidates and an accessible node-kind filter through #530/#534/#542. Source-graph, traversal, and presentation partiality remain separate; these are structural candidates, not runtime reachability claims.
- Read-only MCP entrypoint and unreachable-from-known-entrypoint candidates are merged through #513/#519. Cycle, hotspot, affected-validation, and security-summary tools remain bounded/static evidence surfaces.
- Bounded Node workspace metadata and snapshot evidence are merged through #535/#539, preserving manifest-text/skipped-evidence bounds and absent/partial/complete truth.
- Bounded static Cargo, Go, .NET, and Maven evidence adapters are merged through #549/#552/#556/#557. They parse explicit local files only, preserve unresolved/outside-scan truth, and never resolve registries, evaluate build tools, execute source, use a network, or write. Gradle remains deferred because faithful build-script support requires evaluation.
- Bounded Docker Compose evidence, snapshot/artifact/presentation/browser surfaces, explicit static `depends_on` relationships, quoted static service keys, dependency presentation, and top-level Repository Audit product wiring are merged through #562→#574/#578. Compose evaluation, interpolation/anchors/profiles, image resolution, container starts, network access, and writes remain disabled.
- Local selected-node impact browser integration is merged through #457→#460. #461 hardens stale-selection behavior so a previous-scan node cannot invoke impact traversal with an unavailable root.
- Selected-node affected-test/workflow mapping is merged through #462; the bounded browser presentation panel is merged through #463; #464 composes selected-node impact plus affected-validation into one deterministic analyze-only product with independent partial/truncation truth; #466 integrates that product into the visual explorer with cancellation-safe browser state; #467 passes the already-produced workflow-path evidence into the explorer; and #470/#472 add deterministic request-state and workflow-evidence identity hardening.
- Repository-local TypeScript `extends` / project-reference evidence is merged through #333.
- Server Audit is implemented as a bounded read-only product surface with a strict snapshot/schema parser, fixed collector surface, OS/system/filesystem/socket/service/package/scheduled-job/process/web/backup/log/security/certificate evidence, deterministic findings, redaction, JSON/HTML reporting, cross-platform validation, and bounded scheduled-job relationships through #340.
- Server Audit backup/log consistency evidence and redacted findings are merged through #575/#576. #579 composes them into canonical JSON/HTML reports while deduplicating exact overlap with legacy artifact findings by category/title/structural evidence identity; the initial duplicate-count regression was fixed before exact-head CI/Rust green merge.
- Trusted Mac CI is push-only for owner-controlled `agent/mac-*` branches and targets `[self-hosted, macOS, ARM64]`; it remains mandatory wherever the repository contract requires it.
- Trusted Windows CI is push-only for owner-controlled `agent/windows-*` branches and targets `[self-hosted, Windows, X64]`; it is used for material Windows/cross-platform validation but never substitutes for a declared Trusted Mac requirement.
- Customer-priority source/upload/API foundations, validation-only production preflight (#164), and dormant production queue-foundation rollout preparation (#169) are merged in repository history. **Production customer priority remains OFF.** Those merges do not establish a live deployment or activation.
- Production TOTP remains OFF/incomplete. The 2026-08-19 Admin rollout did not perform the dedicated TOTP KMS rollout. Subscription billing remains OFF, paid priority remains OFF, and no real-charge authorization exists.
- Local editor support is intentionally narrow: `solvelsp` now supports parser-backed diagnostics, symbols, definition, hover, highlights, completion, and semantic tokens for didOpen-cached documents (#503/#510/#512/#518/#521/#526/#529). The opt-in VS Code package (#515/#516) defaults executable launch settings to false. Incremental sync, workspace indexing, execution, and network access remain unsupported.
- The language now includes deterministic `fmt`, `lint`, `check`, loop control, and pure helpers including `keys`, `values`, `entries`, and `is_empty` (#482/#485/#488/#492/#517/#520/#523/#525/#527/#543), with hardened execution still denying capability-bearing builtins. #577 additionally rejects a symlink final component for root-restricted writes so an allowed-root path cannot redirect an overwrite outside that root.
- Browser/WASM parity is deliberately deferred behind the pure-core extraction specified in ADR #537; the shared Rust library still exposes host adapters and is not safe to compile as the browser runtime.
- Repository-only operational preparation includes safe restore-drill contract gates (#531) and a provider-neutral future monitoring readiness contract (#538); neither deploys or enables a live feature.
- Additional repository-only operational contracts cover sanitized suspected API-key exposure handling (#550), evidence/reconciliation before re-enabling an emergency-disabled billing path (#553), and aggregate-only sanitized restore-drill evidence (#554). They authorize no live action.
- Conservative lint recognizes direct unreachable code plus a statement after an `if` whose two explicit branches terminate (#551/#555), without condition evaluation or dynamic inference.
- Subscription event replay retention uses receipt time for delayed delivery records (#544), while billing/webhooks/checkout remain disabled in production.

## Current baseline

### Language/runtime working today

- CLI runner for `.solve` files;
- lexer, parser, AST, canonical AST runtime, typed values, variables/reassignment, print/return;
- integer math, string joining, booleans/comparisons, `if / else`, `while`, functions, arrays, objects, property/index access, JSON helpers;
- relative `.solve` imports including recursive imports;
- parser/runtime source locations and structured diagnostics;
- hardened local execution modes that deny network, file, environment, AI, agent, and tool capabilities;
- agent prototype syntax: `agent`, `tool`, `instruction`, `ask`;
- local-first Workflow Intelligence Studio and browser-local Workflow Preflight.

### Production account/API/Admin foundation

Verified production state recorded on 2026-08-19:

- API access: **enabled**;
- customer accounts: **enabled**;
- Admin CRM backend: **enabled**;
- username/email + password sign-in: **enabled**;
- normal password sign-in sends email: **no**;
- magic-link first-sign-in/recovery: **available**;
- private Admin Gateway: **deployed**;
- `admin.solve-lang.com`: **live behind Cloudflare Access/private ingress**;
- static Admin UI: **published through a separately approved production publication stage**;
- optional authenticator-app TOTP implementation: **merged in code**;
- authenticator-app TOTP production rollout: **disabled / incomplete**;
- dedicated production TOTP KMS rollout: **not performed in the verified Admin work**;
- subscription billing: **disabled**;
- production billing webhook path: **disabled by feature boundary**;
- paid priority selection: **disabled**;
- queue/customer/provider activation: **not established by repository merges**;
- real charge authorization: **none**;
- general managed hosted SolveLang workflow execution: **not live**.

The authoritative production-facing record is `docs/current-production-status-2026-08-19.md`. Facts explicitly marked there as carried forward were not silently re-audited by unrelated repository work.

## Product direction

SolveLang should grow into a safe language, analysis, and automation platform with three distinct audit/product surfaces:

1. **Workflow Preflight** — analyze exported workflow files before production.
2. **Repository Audit** — analyze a repository and produce safe, prioritized architecture and cleanup recommendations.
3. **Server Audit** — inspect a server through read-only evidence and produce operational/security findings.

These surfaces remain separate because their permissions, blast radius, evidence, and execution models differ.

## Immediate engineering order

Re-evaluate live state before every run. The current safe order is:

1. keep shared CI/security blockers cleared, including Rust/RustSec;
2. drain existing safe non-production PRs before unrelated work whenever the safe queue exceeds six;
3. keep roadmap/handoff/production truth synchronized with live repository state;
4. preserve the merged selected-node request/race/identity hardening through #470/#472 while continuing bounded interaction and partial/truncation coverage only where it adds new evidence;
5. continue Repository Audit query/path/impact explanation quality, MCP/Codex integration, local visual-explorer quality, conservative remaining framework/deployment/reference relationships, deterministic IDs/bounds/redaction, and cross-platform tests;
6. continue Solve Graph with richer bounded language/reference adapters, query/path/impact quality, affected-test/workflow intelligence, architecture/security summaries, and MCP/Codex integration;
7. continue Server Audit read-only-first with package/service/port/process/scheduled-job relationships, disk/log/cache/backup posture, web roots/domains/TLS/public-file evidence, ownership/permission/version findings, deterministic redacted reports, and cross-platform tests;
8. continue language/runtime and developer-experience work, especially the conservative local module/package foundation, semantic quality, pure-core extraction needed for browser parity, diagnostics, and non-executing editor support;
9. continue safe Admin Panel repository preparation while treating every future live production change as a fresh protected action;
10. continue dormant customer-priority engineering while queue/customer/provider gates stay OFF unless a separately approved live rollout proves otherwise;
11. continue TOTP preparation while production TOTP stays OFF;
12. continue billing readiness while production billing stays OFF and no real Stripe activity is authorized;
13. keep security/account hardening, launch readiness, rollback, least privilege, operations, and truth documentation current.

Production mutations remain separately gated even when implementation code, workflows, or prior production stages already exist.

## Repository Audit

Repository Audit is an active bounded read-only product, not a future-only concept.

Implemented capabilities include bounded repository ingestion and classification; deterministic Solve Graph dependency/impact analysis; JavaScript/TypeScript, Python, conservative local PHP, local TypeScript config, Angular/Nest framework, Angular target-config, GitHub reusable-workflow, Node-workspace, and bounded Docker Compose relationship evidence; dependency consistency; conservative dead-code candidates; direct test/documentation mapping; package/configuration/workflow/deployment relationships; affected-test/workflow mapping; architecture/security-boundary summaries; ranked, shortest-path, alternative-path, dependent-impact, entrypoint, unreachable-candidate, cycle, and hotspot graph queries; deterministic shortest-path, alternative-path, and impact explanations; read-only MCP query/explanation exposure; integrity-covered artifacts; local visual-explorer/browser presentation including bounded unreached candidates and node-kind filtering; selected-node impact composition; selected-node affected-validation mapping/presentation and active explorer integration; evidence-completeness truth; deterministic IDs/order; redaction; strict report contracts; and no repository mutation or repository-code execution during analysis.

Next read-only intelligence work:

- improve MCP/Codex integration quality over the merged query/explanation contracts;
- continue conservative remaining framework/deployment/reference adapters;
- improve visual-explorer ergonomics and bounded query quality;
- keep Docker Compose evidence strictly static/analyze-only while improving reference quality where syntax can be handled without evaluation;
- keep deterministic cross-platform validation current.

Repository Audit write/remediation mode is **not enabled**.

## Server Audit

Server Audit remains read-only-first because live infrastructure has a larger blast radius.

Implemented read-only capabilities include a fixed collector command surface with no user-supplied command execution; bounded snapshot/schema parsing; OS/system/filesystem/socket/service/package/scheduled-job/process inventory; disk/log/backup posture; web roots/framework hints/TLS/public-file evidence; security posture summaries; temporal/inventory/process/artifact/certificate/permission/listener/coverage/relationship findings; bounded backup/log consistency findings composed into deterministic/redacted JSON and HTML reports without duplicate score/count inflation; and no remediation executor.

Active hardening priorities:

- package/service/port/process/scheduled-job relationship quality;
- log/cache/backup consistency;
- domain/TLS/public-file evidence quality;
- version evidence without pretending a CVE database was consulted;
- bounded/redacted evidence and deterministic IDs;
- cross-platform parser/report tests.

Automatic remote remediation execution remains out of scope.

## Admin and production boundary

The private Admin Gateway, Cloudflare Access/private ingress, static Admin UI, and Admin application password rotation were completed through separately approved production stages on 2026-08-19 and are recorded in `docs/current-production-status-2026-08-19.md`.

PRs #161, #164, and #169 are merged repository history. Their former merge approvals are historical repository events, not standing authorization for deployment or activation. Any future IAM/KMS change, gateway redeploy, DNS/Access/private-ingress change, Admin publication/update, credential rotation, queue/customer/provider activation, customer-priority activation, TOTP rollout, billing change, or production canary with mutation potential requires fresh explicit owner approval scoped to that action.

## Hard safety boundary

Do not automatically:

- live-apply AWS/IAM/KMS changes;
- deploy production;
- change DNS/private ingress/Zero Trust;
- publish or update the production Admin UI;
- enable TOTP, customer priority, or billing;
- use Stripe live or create charges/refunds;
- send email;
- mutate production customer/CRM data;
- upload or execute customer source in production;
- treat a repository merge as live deployment authorization.

If one track is blocked by a production gate or queued self-hosted validation, continue another safe engineering track instead of idling.