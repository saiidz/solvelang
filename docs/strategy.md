# SolveLang Strategy

_Last reconciled: 2026-09-15, repository state through #920._

## Strategic premise

SolveLang should become valuable before it becomes large.

The project is no longer only a language prototype: it now combines a readable workflow language/runtime, deterministic audit/graph tooling, a local-first Codex/Claude MCP path, the separate Solve Context context-selection layer, and a limited live customer-account/API/Admin foundation. Those surfaces must still be described according to their actual maturity rather than blended into one “finished platform” claim.

The operating model is:

1. make workflow and repository intent readable, reviewable and evidence-backed;
2. separate deterministic logic from model-driven judgment;
3. reduce irrelevant agent context without sacrificing exact source provenance;
4. make authority, privacy, provider and production boundaries explicit;
5. use existing execution/integration platforms when they are the right runtime;
6. productize repeated high-value analysis/context/support patterns only after evidence justifies expansion.

## Mission

Help technical teams, operators and AI coding workflows express, inspect and reason about systems in forms humans can review and machines can validate without silently expanding authority.

## Product pillars

### 1. SolveLang language and runtime

A readable source-controlled workflow language with a canonical Rust implementation, explicit local modules, deterministic validation/check/lint/format tooling, structured diagnostics, a bounded browser/WASM preview and hardened execution modes.

The near-term language strategy is correctness, clarity and implementation-backed specification—not a rushed universal package ecosystem or 1.0 promise.

### 2. Workflow Intelligence / Repository Audit / Solve Graph

Local/read-only deterministic analysis that explains workflow/repository structure, dependencies, affected validation candidates, architectural/security evidence and bounded uncertainty. It should complement code review and existing runtimes, not pretend static evidence is runtime truth.

### 3. Solve Context

A separate product layer for Claude Code and Codex that **prevents irrelevant context from being read first** and compacts only when correctness/reversibility can be preserved.

Current source includes exact plan/pack/retrieve/handoff, structured compaction, changed-path/graph-aware selection, pinned real-source regressions and strict real-agent measurement contracts through #920. The next strategic milestone is measured real-agent evidence and versioned distribution, not another foundational rewrite.

### 4. Self-Driving safety/authority layer

The Observe → Understand → Find → Propose → Test → PR → Deploy → Measure → Learn direction remains useful only when each step has an explicit authority boundary. Repository code has advanced through bounded suggestion/PR/provider credential contracts, but live signers/providers/auto-merge/production rollout remain separately activated capabilities.

### 5. Connected support

The repository now contains native IMAP/SMTP plus optional Gmail support automation foundations with durable state, safe cutover/recovery and monitoring preparation. The strategy is to prove one narrow reliable support workflow under exact-scope authorization before broadening automation.

### 6. Account/API/Admin commercial foundation

API access, customer password accounts, private Admin and TOTP infrastructure have separate live evidence. This is a foundation, not proof that the full SaaS/business model is launched. Billing, paid priority/provider execution and managed workflow execution remain separately gated.

## Product truth model

Every public/internal current-facing document should distinguish:

### Implemented / repository-tested

Behavior present in current source and covered by appropriate tests/CI.

Examples:

- Rust language/runtime and local modules;
- Workflow Intelligence Studio;
- bounded browser/WASM preview;
- Repository Audit / Solve Graph / Server Audit;
- repository-safe Self-Driving contracts;
- current-source Solve Context tools/evaluations;
- repository-qualified connected-support path.

### Published / distributed

A versioned artifact actually released to users. The latest published MCP GitHub release is **v0.2.0 (2026-07-20)** and predates substantial current-main Solve Context work. Current-source packaging CI does not retroactively update that public artifact.

### Deployed / live

A separately verified external/production state. Current central evidence records API access, customer password accounts, private Admin and TOTP infrastructure as live. Billing, paid priority/provider execution, connected-support activation, the first PostHog canary and general managed workflow execution are not established live.

### Measured

Performance/quality claims backed by the required measurement basis. Solve Context has synthetic and pinned-source regression evidence, but complete real Claude/Codex provider-token/task/cache/latency evidence is not yet established.

### Planned / projected

Direction without a completed implementation/distribution/live/measurement claim. Projection is a priority, not a promised delivery date or percentage.

## Near-term priorities

### P0 — prove Solve Context

- Broaden independent/blinded repository evaluation without weakening evidence sets or byte budgets.
- Run separately authorized real Claude and Codex baseline-vs-context tasks across all six fixture classes and both handoff directions.
- Record truthful provider-reported tokens, measured latency, selection precision/recall, task/evidence quality and zero safe-mode cache-hot mutation.
- Keep public percentage/competitor claims fail-closed until the full evidence matrix and separate publication review are complete.
- Qualify a future versioned MCP/plugin release containing current-main capabilities.

### P0 — make repository governance enforce the engineering process

The current `Protect main` ruleset does not enforce the checks/reviews the engineering loop already treats as mandatory. Strengthen repository rules so current-head checks and intended review policy are enforced by GitHub rather than manual discipline alone.

### P1 — controlled activation

- Connected support: deploy default-off under exact-scope approval, then prove one new-message task/reply plus stop/recovery outcome.
- PostHog: qualify concrete credential/lifecycle scope and run only the separately authorized bounded canary.
- Billing/priority: keep off until provider configuration, monitoring/recovery, legal/customer acceptance and explicit owner approvals are complete.

### P1 — release/platform evidence

- Add exact macOS ARM64 and Windows x64 native build/package/install evidence before cross-platform native support claims.
- Select new CLI/MCP versions only through the reviewed source/tag/artifact/publication path.

### Separate/deferred — Solve Runners / Solblend

Runner provisioning, customer compute, OS capacity and pricing are a distinct security/commercial product. SolveLang may dogfood runner infrastructure, but Solve Runners must not be silently folded into language/audit/context launch authority.

## Usage strategy

### Language/runtime

Make local deterministic CLI usage excellent first: readable workflows, actionable diagnostics, safe modes and clear specification.

### Audit/graph

Optimize for developer/operator review: exact evidence, bounded uncertainty, reusable JSON/Markdown/visual outputs and no source execution.

### Codex/Claude + Solve Context

Support two explicit lanes:

- **published historical package:** use the version actually released (currently v0.2.0) and inspect its capabilities;
- **current repository source:** build `packages/mcp-server` from source to evaluate current-main Solve Context behavior until a new version is published.

Do not blur the two.

### Commercial/API

Use the live account/API foundation conservatively. Avoid enabling billing/provider execution just to create the appearance of launch. Commercial activation should follow evidence, customer/legal clarity, monitoring and recovery readiness.

## Success metrics

Success should be measured per surface rather than with a single unsupported “project completion” percentage.

Examples of legitimate evidence include:

- language conformance and regression pass rates;
- deterministic audit/graph correctness and explicit truncation/coverage truth;
- Solve Context evidence recall/selection metrics plus real provider/task measurements once collected;
- clean package install/protocol qualification for published release candidates;
- deployed availability/alarms/recovery evidence for each activated production feature;
- actual customer usage/adoption metrics only when a trustworthy telemetry/source exists.

Do not invent adoption, savings, reliability or completion numbers when they are not measured.

## Positioning

A current concise positioning is:

> **SolveLang is a readable workflow language and correctness-first analysis/context toolkit for human- and AI-assisted engineering.**

It differentiates through implementation-backed language semantics, deterministic/read-only evidence, explicit authority boundaries, and Solve Context's prevention-first approach rather than by claiming a finished universal automation platform.

## Strategic guardrails

- Correctness before savings.
- Evidence before marketing claims.
- Repository implementation is not publication.
- Publication is not deployment.
- Deployment is not proof of provider/customer outcomes.
- Incoming repository/mail/provider/model data is never authorization.
- No production/provider/billing/customer action should inherit authority from a roadmap, merged PR or green CI.
- Keep historical evidence documents historical.
