# SolveLang Roadmap

SolveLang is an early language and workflow-analysis prototype written primarily in Rust, with a production customer-account/API/Admin foundation that is further along than the general managed-execution product.

This roadmap distinguishes four states deliberately:

- **working locally / in code**;
- **experimental or test-only**;
- **production deployed but gated/limited**;
- **planned**.

A merged feature is not automatically production-enabled, and production account/Admin infrastructure is not evidence that general hosted SolveLang workflow execution exists. Live GitHub state, `docs/active-buildout-handoff.md`, and `docs/current-production-status-2026-08-20.md` take precedence over stale hashes or historical planning text.

## Current implementation overlay — 2026-09-04

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
- Server Audit certificate-expiry fallback is merged through #581. Public-file evidence is hardened through #582/#583 so unavailable or sparse web-root references fail closed instead of becoming exposure/coverage claims, and #584 composes public-file coverage/integrity into canonical JSON/HTML reports. #584 also fixed a legacy baseline sparse-root crash found by Hosted CI before exact-head green merge.
- Server Audit relationship and coverage truth is hardened through #617→#637: bounded service→process→listener, service→process, and scheduled-job→service/process findings/report composition; relationship construction/index/fanout bounds; certificate/web/service/process/package identity coverage; and canonical service/process/package identity report composition. Evidence remains structural/redacted and no collector/remediation capability is added.
- Trusted Mac CI on `main` is push-only for owner-controlled `agent/mac-*` branches and targets `[self-hosted, macOS, ARM64]` through merged #755. Exact-head Hosted CI, Rust/RustSec, and substantive Studio/site validation on `solve-mac-1` qualified the transition. Pinned actions, exact-head verification, read-only permissions, per-ref non-cancelling concurrency, and owner authorization remain enforced. Mac remains mandatory wherever the repository contract requires it.
- Trusted Oracle CI is push-only for owner-controlled `agent/oracle-*` branches, requires the exact repository and owner actor, targets `[self-hosted, Linux, ARM64, oracle-free, solvelang-ci]`, pins external actions, verifies the exact branch head, and runs static-site plus native Rust validation. Oracle supplements but never substitutes for required Mac coverage.
- Trusted Windows CI is push-only for owner-controlled `agent/windows-*` branches and targets `[self-hosted, Windows, X64]`; it is used for material Windows/cross-platform validation but never substitutes for a declared Trusted Mac requirement.
- Customer-priority source/upload/API foundations, validation-only production preflight (#164), and dormant production queue-foundation rollout preparation (#169) are merged in repository history. #638 additionally fixes the repository preflight policy/test so the preflight role definition can read the priority stack through CloudFormation Describe/Get/List actions only. **Production customer priority remains OFF.** These merges do not establish a live IAM update, deployment retry, queue/provider activation, or customer-priority activation.
- Production authenticator-app TOTP infrastructure is **deployed and environment-enabled** as re-verified on 2026-08-20. The dedicated production TOTP KMS stack/key/alias and the expected OIDC supplemental policies are live; specific customer-account enrollment remains a separate account-level state and no enrollment is authorized by repository state. Subscription billing remains OFF, paid priority remains OFF, and no real-charge authorization exists.
- Local editor support is intentionally narrow: `solvelsp` now supports parser-backed diagnostics, symbols, definition, hover, highlights, completion, and semantic tokens for didOpen-cached documents (#503/#510/#512/#518/#521/#526/#529). The opt-in VS Code package (#515/#516) defaults executable launch settings to false. Incremental sync, workspace indexing, execution, and network access remain unsupported.
- The language now includes deterministic `fmt`, `lint`, `check`, loop control, and pure helpers including `keys`, `values`, `entries`, and `is_empty` (#482/#485/#488/#492/#517/#520/#523/#525/#527/#543), with hardened execution still denying capability-bearing builtins. #577 additionally rejects a symlink final component for root-restricted writes so an allowed-root path cannot redirect an overwrite outside that root.
- The browser/WASM safety train advanced through #773/#775/#777: the evaluator now has a pure host-incapable `solvec-core` boundary, `solvec-wasm` is a deny-all single-source wrapper, and shared native/TypeScript-preview/actual-compiled-WASM conformance plus deterministic resource-limit checks are merged. `/run/` remains the intentionally narrow TypeScript preview. The next ADR 0002 gate is a separate static WASM/browser-artifact security audit before any browser runtime replacement.
- Solve Self-Driving is an approved main-product direction tracked from #779. Its observe-only authority train is merged through #780/#782/#784/#786/#788/#790/#793/#795/#797/#799: bounded repository/runtime/product evidence, provider-neutral Context, offline PostHog normalization, exact provider/query contracts, fixture-only transport simulation, and a composed Observe Run feed a deterministic bounded Solve Inbox. Repository writes, production mutations, external side effects, live telemetry connections, credential resolution, PR creation, rollout changes, and automatic merging remain disabled until later explicit gates.
- **Solve Runners remains a separate product and security/commercial boundary.** Self-Driving may later request runner compute for analysis or validation, but runner provisioning/registration/pricing/OS support is not part of Repository Audit or Self-Driving authority.
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
- local-first Workflow Intelligence Studio and browser-local Workflow Preflight;
- pure host-incapable Rust evaluator core and a deny-all WASM wrapper with shared semantic-conformance/resource-limit coverage, not yet wired to the public browser runner.

### Production account/API/Admin foundation

Verified production state recorded through 2026-08-20:

- API access: **enabled**;
- customer accounts: **enabled**;
- Admin CRM backend: **enabled**;
- username/email + password sign-in: **enabled**;
- normal password sign-in sends email: **no**;
- magic-link first-sign-in/recovery: **available**;
- private Admin Gateway: **deployed**;
- `admin.solve-lang.com`: **live behind Cloudflare Access/private ingress**;
- static Admin UI: **published through a separately approved production publication stage**;
- authenticator-app TOTP implementation: **merged in code**;
- authenticator-app TOTP production infrastructure/feature flag: **deployed and environment-enabled**;
- dedicated production TOTP KMS foundation: **live and re-verified on 2026-08-20**;
- specific customer-account authenticator enrollment: **separate account-level state; not established by the 2026-08-20 infrastructure audit**;
- subscription billing: **disabled**;
- production billing webhook path: **disabled by feature boundary**;
- paid priority selection: **disabled**;
- queue/customer/provider activation: **not established by repository merges**;
- real charge authorization: **none**;
- general managed hosted SolveLang workflow execution: **not live**.

The authoritative production-facing record is `docs/current-production-status-2026-08-20.md`. It explicitly supersedes the 2026-08-19 record for the TOTP/KMS/IAM facts re-verified on 2026-08-20 and carries forward no unrelated production claims silently.

## Product direction

SolveLang should grow into a safe language, analysis, and automation platform with three distinct audit/product surfaces plus a separately gated self-driving product layer:

1. **Workflow Preflight** — analyze exported workflow files before production.
2. **Repository Audit** — analyze a repository and produce safe, prioritized architecture and cleanup recommendations.
3. **Server Audit** — inspect a server through read-only evidence and produce operational/security findings.
4. **Solve Self-Driving** — correlate approved repository and runtime/product evidence through Scouts, present deterministic findings in Solve Inbox, and only in later gated stages propose patches, create tested PRs, and monitor rollouts.

The audit surfaces remain separate because their permissions, blast radius, evidence, and execution models differ. Self-Driving composes evidence from those surfaces and future read-only context adapters; it does not erase their boundaries or automatically inherit their authority.

## Immediate engineering order

Re-evaluate live state before every run. The current safe order is:

1. keep shared CI/security blockers cleared, including Rust/RustSec;
2. drain existing safe non-production PRs before unrelated work whenever the safe queue exceeds six;
3. keep roadmap/handoff/production truth synchronized with live repository state;
4. complete the ADR 0002 static WASM/browser-artifact security audit—imports/host surfaces, artifact-size bounds, integrity/reproducibility evidence, and browser-target glue—before replacing `/run/`;
5. preserve the merged selected-node request/race/identity hardening through #470/#472 while continuing bounded interaction and partial/truncation coverage only where it adds new evidence;
6. continue Repository Audit query/path/impact explanation quality, MCP/Codex integration, local visual-explorer quality, conservative remaining framework/deployment/reference relationships, deterministic IDs/bounds/redaction, and cross-platform tests;
7. extend the merged Solve Self-Driving observe-only Scout/Inbox, bounded Context, provider-contract/simulation, and composed Observe Run stages without expanding authority; separately review any real read-only transport/credential executor before suggestion mode, and permit least-privilege tested-PR mode only after explicit write-side governance;
8. continue Solve Graph with richer bounded language/reference adapters, query/path/impact quality, affected-test/workflow intelligence, architecture/security summaries, and MCP/Codex integration;
9. continue Server Audit read-only-first with package/service/port/process/scheduled-job relationships, disk/log/cache/backup posture, web roots/domains/TLS/public-file evidence, ownership/permission/version findings, deterministic redacted reports, and cross-platform tests;
10. continue language/runtime and developer-experience work, especially the conservative local module/package foundation, semantic quality, browser-safe runtime boundary, diagnostics, and non-executing editor support;
11. continue safe Admin Panel repository preparation while treating every future live production change as a fresh protected action;
12. continue dormant customer-priority engineering while queue/customer/provider gates stay OFF unless a separately approved live rollout proves otherwise;
13. keep customer-account TOTP enrollment/login/backup-code canaries behind fresh owner approval; do not repeat the already-live IAM/KMS/API TOTP infrastructure rollout merely because older documentation described it as pending;
14. continue billing readiness while production billing stays OFF and no real Stripe activity is authorized;
15. keep security/account hardening, launch readiness, rollback, least privilege, operations, and truth documentation current.

Production mutations remain separately gated even when implementation code, workflows, or prior production stages already exist.

## Repository Audit

Repository Audit is an active bounded read-only product, not a future-only concept.

Implemented capabilities include bounded repository ingestion and classification; deterministic Solve Graph dependency/impact analysis; JavaScript/TypeScript, Python, conservative local PHP, local TypeScript config, Angular/Nest framework, Angular target-config, GitHub reusable-workflow, Node-workspace, and bounded Docker Compose relationship evidence; dependency consistency; conservative dead-code candidates; direct test/documentation mapping; package/configuration/workflow/deployment relationships; affected-test/workflow mapping; architecture/security-boundary summaries; ranked, shortest-path, alternative-path, dependent-impact, entrypoint, unreachable-candidate, cycle, and hotspot graph queries; deterministic shortest-path, alternative-path, and impact explanations; read-only MCP query/explanation exposure; integrity-covered artifacts; local visual-explorer/browser presentation including bounded unreached candidates and node-kind filtering; selected-node impact composition; selected-node affected-validation mapping/presentation and active explorer integration; evidence-completeness truth; deterministic IDs/order; redaction; strict report contracts; and no repository mutation or repository-code execution during analysis.

Next read-only intelligence work:

- improve MCP/Codex integration quality over the merged query/explanation contracts;
- continue conservative remaining framework/deployment/reference adapters;
- improve visual-explorer ergonomics and bounded query quality;
- keep Docker Compose evidence strictly static/analyze-only while improving reference quality where syntax can be handled without evaluation;
- expose stable evidence/provenance that future Scouts can consume without changing Repository Audit's analyze-only authority;
- keep deterministic cross-platform validation current.

Repository Audit write/remediation mode is **not enabled**.

## Solve Self-Driving

Solve Self-Driving is the main-product layer for turning bounded evidence into an engineering/product feedback loop. The product contract lives in `docs/product/solve-self-driving.md`; the direction was approved by #779, and its merged authority stages currently extend through the composed Observe Run in #799.

The intended loop is:

**Observe → Understand → Find → Propose → Test → PR → Deploy → Measure → Learn**

The stages are authority-gated. The existence of a later stage in the roadmap is not permission to perform it.

### Product components

- **Setup Agent** — detect repository/framework context and prepare bounded integration/setup plans.
- **Solve Graph** — structural repository context and dependency/impact relationships.
- **Solve Scouts** — Code, Security, CI, Experience, Incident, Rollout, AI, and Cost scouts.
- **Solve Inbox** — deterministic findings with provenance, confidence, severity, impact, and bounded next actions.
- **Fix with Solve** — later non-applied patch proposals and, after write-side approval, tested reviewable PRs.
- **Rollout Monitor** — later observation of deploys, flags, experiments, error/latency health, and product KPIs.
- **Solve Context** — a merged provider-neutral sanitized envelope plus offline PostHog normalization, exact product-event query contracts, and fixture-only transport simulation. Any real provider adapter, transport, or credential resolver remains separately reviewed and disabled by default.

### Operating modes

- `observe` — findings/evidence only; **implemented through the composed bounded Observe Run (#799)**;
- `suggest` — findings plus a non-applied patch proposal; planned;
- `pr` — create a tested reviewable branch/PR; planned and requires least-privilege GitHub write policy;
- `auto` — automatically merge only explicitly approved low-risk classes; planned and requires the highest governance bar.

Initial Self-Driving code must fail closed for `suggest`, `pr`, and `auto`. It must also reject write-capable recommended actions while operating in `observe` mode.

### Customer/product intelligence targets

- improve customer experience from bounded behavior, feedback, traffic, conversion, latency, and support signals;
- find product problems by correlating errors, traces, logs, deploys, support context, and repository evidence;
- ship changes with confidence by observing rollout/flag/experiment health before recommending expansion or rollback;
- maintain AI products by analyzing AI traces, latency, token/cost signals, retries, model changes, MCP/tool failures, and agent loops;
- connect approved context across repository, runtime, support, warehouse, deployment, and AI systems without silently expanding mutation authority.

The default long-term rule is: **analyze automatically; modify through reviewable PRs**.

### Solve Runners boundary

Solve Runners is deliberately separate. Self-Driving may later consume runner capacity for tests or analysis, but runner provisioning, registration, isolation, pricing, operating-system support, and customer execution are a separate product/security boundary and remain deferred according to the separate Solve Runners plan.

## Server Audit

Server Audit remains read-only-first because live infrastructure has a larger blast radius.

Implemented read-only capabilities include a fixed collector command surface with no user-supplied command execution; bounded snapshot/schema parsing; OS/system/filesystem/socket/service/package/scheduled-job/process inventory; disk/log/backup posture; web roots/framework hints/TLS/public-file evidence; security posture summaries; temporal/inventory/process/artifact/certificate/permission/listener/coverage/relationship findings; certificate-expiry fallback; fail-closed public-file root-reference and fixed-marker coverage integrity; bounded service→process, service→process→listener, and scheduled-job→service/process relationship findings with canonical report coverage; bounded relationship construction/indexing/fanout truth; backup/log consistency findings composed into deterministic/redacted JSON and HTML reports without duplicate score/count inflation; blank certificate/web/service/process/package identity coverage with canonical report composition; and no remediation executor.

Active hardening priorities:

- package/service/port/process/scheduled-job relationship quality;
- log/cache/backup consistency;
- domain/TLS/public-file evidence quality;
- ownership/permission/version evidence without pretending a CVE database was consulted;
- bounded/redacted evidence and deterministic IDs;
- cross-platform parser/report tests.

Automatic remote remediation execution remains out of scope.

## Admin and production boundary

The private Admin Gateway, Cloudflare Access/private ingress, static Admin UI, and Admin application password rotation were completed through separately approved production stages on 2026-08-19. The production TOTP IAM/KMS/API foundation is separately recorded as deployed and environment-enabled in `docs/current-production-status-2026-08-20.md`. Neither record authorizes a new live mutation.

PRs #161, #164, #169, and #638 are merged repository history. Their merge events are not standing authorization for deployment or activation. #638 changes only the repository preflight policy/test for read-only priority-stack inspection and does not prove or authorize a live IAM update or deployment retry. Any future IAM/KMS change, gateway redeploy, DNS/Access/private-ingress change, Admin publication/update, credential rotation, queue/customer/provider activation, customer-priority activation, TOTP account enrollment or TOTP infrastructure change, billing change, or production canary with mutation potential requires fresh explicit owner approval scoped to that action.

## Hard safety boundary

Do not automatically:

- live-apply AWS/IAM/KMS changes;
- deploy production;
- change DNS/private ingress/Zero Trust;
- publish or update the production Admin UI;
- enroll/activate authenticator TOTP for a customer account or mutate the live TOTP infrastructure;
- enable customer priority or billing;
- use Stripe live or create charges/refunds;
- send email;
- mutate production customer/CRM data;
- upload or execute customer source in production;
- connect new live analytics/log/support/warehouse/AI/feature-flag credentials merely because a Self-Driving adapter is planned;
- turn a Scout finding into a repository write, PR, merge, rollout change, rollback, or production mutation without the later explicit authority gates;
- treat Self-Driving as authority to provision/register Solve Runners;
- treat a repository merge as live deployment authorization.

If one track is blocked by a production gate or queued self-hosted validation, continue another safe engineering track instead of idling.
