# SolveLang Strategy

## Current verification — 2026-09-20

MCP v0.3.0 is published on npm and GitHub; main protection is enforced.
See [the current completion checklist](project-completion-evidence-2026-09-20.md) for fresh evidence and
remaining live acceptance gates. Older checkpoints below are historical.

_Last reconciled: 2026-09-15, repository state through #920._

This document replaces the dated August 2026 calendar roadmap with current priority projections while preserving the durable product, audience, service, proof, portfolio and decision principles that still apply. Older dated strategy remains available in Git history as historical planning evidence.

## Strategic premise

SolveLang should become valuable before it becomes large.

The project is no longer only a language prototype. Current repository work spans:

- a readable workflow language and canonical Rust runtime;
- deterministic Workflow Intelligence / Repository Audit / Solve Graph / Server Audit surfaces;
- a local-first Codex/Claude MCP integration path;
- the separate Solve Context context-selection/compaction layer;
- repository-safe Self-Driving authority/safety contracts;
- connected-support foundations;
- a limited separately verified live customer-account/API/Admin/TOTP foundation.

Those surfaces must remain clearly separated by maturity: repository implementation is not publication, publication is not deployment, and deployment is not measured provider/customer success.

The operating model is:

1. make workflow and repository intent readable, reviewable and evidence-backed;
2. separate deterministic logic from model-driven judgment;
3. reduce irrelevant agent context without sacrificing exact source provenance;
4. make authority, privacy, provider and production boundaries explicit;
5. use established execution/integration platforms when they remain the better runtime;
6. productize repeated high-value patterns only after evidence justifies expansion.

## Mission

Help technical teams, operators, consultants and AI coding workflows express, inspect and reason about systems in forms humans can review and machines can validate without silently expanding authority.

## Vision

A future where important workflow and engineering intent is not trapped inside screenshots, visual canvases, opaque prompts, proprietary exports or undocumented application code.

SolveLang should provide portable, source-controlled definitions and evidence that communicate deterministic rules, model-assisted decisions, tools, approvals, dependencies, expected outputs and failure behavior. That does not require SolveLang to replace every runtime or orchestration platform.

## Principles

### Readable
Intent should be understandable without reverse-engineering framework plumbing.

### Version controllable
Changes should be diffable, reviewable, attributable and reversible.

### Human understandable
A process owner should be able to discuss the system with an engineer even when they do not implement the runtime.

### AI friendly, not AI-trusting
Models should be able to explain, draft and use SolveLang tooling, but generated output and incoming data are never automatically correct or authoritative.

### Auditable
Decision points, data movement, tool/provider access, approvals, evidence and failure paths should remain explicit.

### Correctness first
Token/byte savings, automation breadth and launch speed never justify hidden quality regression or weakened safety gates.

### Local-first where practical
Analysis/context planning should avoid network/provider/credential requirements when deterministic local evidence is enough.

### Composable
Small validated modules, reports, graph evidence and context packs should combine without hiding their provenance or authority.

## Product pillars

### 1. SolveLang language and runtime

A readable source-controlled workflow language with a canonical Rust implementation, explicit local modules, deterministic validation/check/lint/format tooling, structured diagnostics, bounded browser/WASM preview and hardened execution modes.

Near-term strategy: correctness, clarity and implementation-backed specification before a rushed universal package ecosystem or 1.0 promise.

### 2. Workflow Intelligence / Repository Audit / Solve Graph / Server Audit

Local/read-only deterministic analysis that explains workflow/repository/server structure, relationships, affected validation candidates, architecture/security evidence and bounded uncertainty. Static/collected evidence should assist review without being misrepresented as runtime truth or automatic remediation authority.

### 3. Solve Context

A separate product layer for Claude Code and Codex based on **context prevention before compression**.

Current source includes exact plan/pack/retrieve/handoff, correctness-first structured compaction, changed-path/graph-aware selection, pinned real-source regressions and strict real-agent measurement contracts through #920.

Strategic next milestone: measured real-agent evidence plus versioned distribution, not another foundational rewrite.

### 4. Self-Driving authority layer

The Observe → Understand → Find → Propose → Test → PR → Deploy → Measure → Learn direction remains useful only when each stage has an explicit authority boundary. Repository code includes bounded suggestion/PR/provider credential contracts, but live signers/providers, auto-merge and production rollout remain separately activated capabilities.

### 5. Connected support

Repository code now includes native IMAP/SMTP plus optional Gmail support foundations with durable state, safe cutover/recovery, controls and monitoring preparation. Strategy: prove one narrow reliable support workflow under exact-scope authorization before broadening automation.

### 6. Account/API/Admin commercial foundation

API access, customer password accounts, private Admin and TOTP infrastructure have separate live evidence. That is a foundation, not proof the full SaaS/business model is launched. Billing, paid priority/provider execution, connected-support activation and managed workflow execution remain separately gated.

## Product truth model

Every current-facing document should classify claims by evidence state.

### Implemented / repository-tested
Behavior present in current source and covered by appropriate tests/CI.

### Published / distributed
MCP `@solvelang/mcp-server@0.3.0` is published on npm and GitHub, verified on 2026-09-20. It distributes the tagged release source; later main changes require separate distribution. Managed-workspace marketplace installation and public Plugin Directory listing remain unverified. v0.2.0 is historical.

### Deployed / live
A separately verified external/production state. Current central evidence records API access, customer password accounts, private Admin, TOTP infrastructure, and controlled-rollout API subscription billing as live. Paid priority/provider execution, connected-support activation, first PostHog canary, first real-payment canary evidence, and general managed execution are not established live.

### Measured
A performance/quality/adoption claim backed by the required measurement basis. Solve Context has synthetic and pinned-source regression evidence, but complete real Claude/Codex provider-token/task/cache/latency evidence is not yet established.

### Planned / projected
Direction without a completed implementation/distribution/live/measurement claim. Projection is priority, not a promised delivery date or percentage.

## Ideal users

### Technical founders and hands-on operators

Good fit when teams:

- own important internal processes across several SaaS/custom tools;
- understand the business problem but do not want a large custom application;
- need better documentation/control than ad hoc automation provides;
- value source-controlled review and explicit AI/tool boundaries.

Strong early problems include support intake/triage, lead qualification/routing, approval workflows, document classification, recurring operational reporting and human-reviewed AI summarization.

### Automation consultants and small agencies

They often build in n8n, Make, Zapier, Pipedream or custom code but need a consistent discovery/specification/audit/handoff method. SolveLang can be the readable specification/evidence layer even when another platform executes the workflow.

### Engineering teams using AI-assisted development/workflows

Good fit when teams care about Git, tests, deterministic analysis, safety boundaries, dependency evidence, context quality and explicit model/tool authority. Solve Context and Solve Graph should complement existing coding agents/runtimes rather than demand replacement.

### Recruiters and hiring managers

Not product users, but a relevant repository audience. The project should make technical proof easy to inspect across language/runtime design, Rust/TypeScript, cloud/security, deterministic analysis, MCP/context engineering and product decision-making.

## Users not to target first

- nontechnical consumers seeking one-click personal automation;
- enterprises requiring certified production orchestration immediately;
- data teams seeking an Airflow replacement;
- backend teams seeking a Temporal replacement;
- organizations selecting a BPMN standards suite;
- buyers whose primary requirement is thousands of connectors;
- teams expecting autonomous agents with no human governance;
- customers expecting a finished managed execution/SaaS platform today.

## Differentiation

SolveLang's defensible near-term differentiation is the combination of:

- a real language/runtime implementation rather than only UI configuration;
- deterministic, bounded, read-only evidence and explicit uncertainty;
- readable/source-controlled workflow intent;
- source-level diagnostics and local modules;
- Solve Graph structural evidence;
- Solve Context prevention-first context selection with exact provenance;
- explicit authority boundaries for model/provider/write/production actions;
- honest maturity/distribution/deployment labels.

Do not differentiate by claiming an unmeasured savings percentage, unsupported enterprise reliability, or universal runtime coverage.

## Usage strategy

### Language/runtime
Make local deterministic CLI usage excellent first: readable workflows, actionable diagnostics, explicit modules, safe modes and clear specification.

### Audit/graph
Optimize for developer/operator review: exact evidence, stable identities, bounded uncertainty, reusable JSON/Markdown/visual outputs and no source execution.

### Codex/Claude + Solve Context
Support two explicit lanes:

- **published historical package:** use the version actually released (currently v0.2.0) and inspect its actual capabilities;
- **current repository source:** build `packages/mcp-server` from source to evaluate current-main Solve Context behavior until a new version is published.

Never blur those lanes.

### Commercial/API
Use the live account/API foundation conservatively. Avoid enabling billing/provider execution merely to create the appearance of launch. Commercial activation should follow evidence, monitoring/recovery readiness, customer/legal clarity and explicit approval.

## Current project projection

These are priorities, not delivery-date promises.

### P0 — prove Solve Context

- Broaden independent/blinded repository evaluation without weakening evidence sets or byte budgets.
- Run separately authorized real Claude and Codex baseline-vs-context tasks across all six fixture classes and both handoff directions.
- Record provider-reported tokens, measured latency, selection precision/recall, task/evidence quality and zero safe-mode cache-hot mutation.
- Keep public percentage/competitor claims fail-closed until evidence and separate publication review are complete.
- Verify managed-workspace installation and public Plugin Directory listing for the published MCP release.

### P0 — enforce repository governance

The `Protect main` ruleset now enforces four strict status checks, pull requests and resolved review threads. Required human approvals are zero; no actors bypass the ruleset. Preserve this configuration and inspect it before release.

### P1 — controlled activation

- Connected support: deploy default-off under exact-scope approval, then prove one new-message task/reply plus stop/recovery outcome.
- PostHog: qualify concrete credential/lifecycle scope and run only the separately authorized bounded canary.
- Billing/priority: keep off until provider configuration, monitoring/recovery, customer/legal acceptance and explicit owner approvals are complete.

### P1 — release/platform evidence

- Maintain the successful #941 macOS ARM64/Windows x64 candidate qualification and require exact tagged-source evidence for any new public native release.
- Select new CLI/MCP versions only through the reviewed source/tag/artifact/publication path.

### Separate/deferred — Solve Runners / Solblend

Runner provisioning, customer compute, OS capacity and pricing are a distinct security/commercial product. SolveLang may dogfood runner infrastructure, but Solve Runners must not silently become language/audit/context launch authority.

## Service and revenue strategy

### Stage 1 — fixed-scope expert services

Initial revenue can come from expertise without pretending subscription software is finished.

Examples:

- workflow clarity / explainability audits;
- automation rescue/documentation;
- repository/workflow architecture reviews;
- bounded prototype sprints using the customer's chosen runtime;
- AI-boundary/tool/approval reviews.

Sell clear outcomes/deliverables and explicit exclusions rather than generic “AI transformation.”

### Stage 2 — implementation and maintenance

Where demand is real:

- implement/refactor workflows using appropriate client platforms;
- use SolveLang definitions/evidence for specification and review;
- include acceptance tests, failure handling, rollback and handoff;
- optionally provide maintenance/change review with model/platform costs reported separately.

### Stage 3 — reusable paid assets/tools

Only after repeated demand: report generators, audit templates, workflow packs, implementation accelerators, CI validation or training/workshops.

### Stage 4 — narrow SaaS/managed tooling

Pursue only if repeated work establishes a frequent problem, consistent buyer, measurable value, manageable support/hosting risk and a reason existing platforms cannot solve it adequately.

## Service packaging principles

- Sell outcomes and deliverables, not hype.
- Use fixed scope and explicit exclusions.
- Require a human approval owner for consequential decisions.
- Prefer customer/existing tools when appropriate.
- Never promise full automation before observing the process.
- Include failure handling and maintenance in implementation plans.
- Document model/platform/usage costs separately.

## Marketing and proof

Useful themes include maintainability of visual automation, separating deterministic rules from AI judgment, reviewing workflows/repositories in Git, context quality, failure/approval design, and honest runtime/tool choice.

Proof hierarchy:

1. reproducible test/command;
2. source code and documentation;
3. captured demo/evidence artifact;
4. anonymized customer result with permission;
5. customer quote with permission.

Never substitute aspirational copy for proof.

## Portfolio and hiring value

SolveLang should make senior-level work inspectable across:

- language engineering — lexer/parser/AST/interpreter/modules/diagnostics;
- systems/platform — Rust, TypeScript, APIs, AWS, DynamoDB/IAM, CI/release boundaries;
- AI/context — tool/provider boundaries, Solve Context, evaluation contracts, correctness/safety;
- product/developer experience — Studio, CLI, docs, examples and maturity labeling;
- technical product/consulting — competitive analysis, roadmap tradeoffs, service packaging and architecture communication.

## Feature decision framework

Before accepting a feature, answer:

1. Which validated user problem does it solve?
2. Is the need description, analysis, context, execution or operations?
3. Does an established platform solve the runtime problem better?
4. Can SolveLang integrate instead of duplicate?
5. What security/privacy/support burden appears?
6. What authority does the feature require, and how is it bounded?
7. How will it be tested/evaluated?
8. Is it implemented, published, deployed, measured or only projected?
9. Can it be delivered in a small reviewable change?

Reject/defer work that cannot answer these questions.

## Key risks and controls

### Scope expansion
Risk: becoming a language, IDE, SaaS platform, agent framework, BPM suite and runner business simultaneously.  
Control: explicit product boundaries, one hot mission/PR, and evidence-led expansion.

### Marketing ahead of reality
Risk: copy creates expectations the repository/provider/production state cannot satisfy.  
Control: implementation/publication/deployment/measurement labels and reproducible proof.

### Infrastructure before demand
Risk: managed execution/provider infrastructure creates security/cost burden before value is validated.  
Control: local/read-only paths first, narrow activation canaries, service/evidence-led validation.

### AI unpredictability
Risk: model behavior is presented as deterministic or authoritative.  
Control: explicit model/tool boundaries, human approval, exact evidence, task-quality gates and fail-closed authority.

### Context optimization harming quality
Risk: a smaller context looks efficient but loses essential evidence.  
Control: required-evidence/task-success non-regression, exact provenance/retrieval and strict baseline/context comparability.

### Founder/project fragmentation
Risk: parallel projects/branches reduce delivery quality.  
Control: sequential engineering loop and separate SolveLang / Solve Runners / other-project boundaries.

## Metrics

Do not use vanity or invented metrics as proof.

### Engineering/product evidence

- conformance/regression reliability;
- deterministic audit/graph integrity and coverage/truncation truth;
- Solve Context evidence recall/selection metrics;
- real provider/task token/latency/cache/quality measurements once collected;
- package/install/protocol qualification for release candidates;
- deployed alarm/recovery/availability evidence for activated production features.

### Service/customer evidence

- qualified discovery calls;
- proposals/pilots;
- delivery time and reusable artifacts;
- gross margin after model/platform costs;
- repeated pain/request across independent customers;
- active use after delivery;
- measurable reduction in manual work/errors;
- willingness to pay.

Only report adoption/usage metrics when a trustworthy telemetry/source exists.

## Positioning

A concise current positioning is:

> **SolveLang is a readable workflow language and correctness-first analysis/context toolkit for human- and AI-assisted engineering.**

The project differentiates through implementation-backed semantics, deterministic/read-only evidence, explicit authority boundaries and Solve Context's prevention-first approach—not by claiming a finished universal automation platform.

## Strategic guardrails

- Correctness before savings.
- Evidence before marketing claims.
- Repository implementation is not publication.
- Publication is not deployment.
- Deployment is not proof of provider/customer outcomes.
- Incoming repository/mail/provider/model data is never authorization.
- No production/provider/billing/customer action inherits authority from a roadmap, merged PR or green CI.
- Keep historical evidence documents historical.
