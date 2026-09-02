# Solve Self-Driving

Solve Self-Driving is the planned product layer that connects SolveLang's repository intelligence to bounded runtime/product signals, then turns those signals into reviewable engineering findings and, only in later explicitly gated stages, tested pull requests.

This document is a product/architecture contract. It does not claim that live telemetry ingestion, GitHub write access, automatic remediation, rollout mutation, or managed execution is enabled today.

## Product promise

Solve Self-Driving should help teams:

1. **Improve the customer experience** — study bounded behavior, feedback, traffic, conversion, latency, and support signals to identify where users get stuck.
2. **Find product problems** — correlate errors, sessions/traces, logs, deployments, support context, and repository evidence into explainable findings.
3. **Ship changes with confidence** — observe flags, experiments, deployments, canaries, error rates, latency, and product KPIs before recommending rollout expansion or rollback.
4. **Maintain an AI product** — inspect AI traces, token/cost signals, latency, failures, retries, model changes, MCP/tool calls, and agent loops.
5. **Connect context and automate work** — connect approved repository, runtime, support, warehouse, deployment, and AI contexts so agents can act on explicit signals under policy.

## Main components

### Setup Agent

The Setup Agent will detect supported repository/framework context and generate a bounded integration plan. Later stages may configure approved SDKs, CI checks, MCP integrations, or repository metadata through a reviewable change.

Initial repository analysis remains read-only.

### Solve Graph

Solve Graph remains the structural source-of-truth for repository relationships: source files, packages, workflows, deployment paths, permissions, tests, and other bounded evidence.

Runtime/product context may attach to graph nodes later, but runtime evidence must not be mislabeled as static repository truth.

### Solve Scouts

Planned scout classes:

- **Code Scout** — correctness, architecture, dependency, dead-code, and maintenance findings.
- **Security Scout** — static security-boundary and permission findings.
- **CI Scout** — workflow, validation, flaky/failing lane, and coverage signals.
- **Experience Scout** — conversion, behavior, feedback, latency, and support friction.
- **Incident Scout** — errors, logs, traces, deployments, and likely root-cause context.
- **Rollout Scout** — feature flags, experiments, canaries, release health, and rollout outcomes.
- **AI Scout** — AI traces, model/tool/MCP failures, loops, prompt/model regressions, latency, and reliability.
- **Cost Scout** — AI/token, infrastructure, workflow, and other measurable cost regressions.

A scout finding must retain provenance, confidence, impact, severity, and a bounded recommended next action.

### Solve Inbox

Solve Inbox is the deterministic presentation layer for Scout findings.

The initial contract is `solvelang.self-driving.inbox.v0` and is intentionally **observe-only**:

- analyze-only;
- no repository write access;
- no production mutation access;
- no external side effects;
- only `inspect` is an allowed action;
- deterministic ordering and IDs;
- bounded finding count;
- duplicate findings collapsed by normalized structural identity;
- provenance required for every finding.

### Fix with Solve

`Fix with Solve` is a later write-side capability. The intended default is:

> analyze automatically; modify through reviewable pull requests.

Before this is enabled, SolveLang must establish a least-privilege GitHub App/write contract, branch policy, explicit approval behavior, validation requirements, rollback evidence, and an audit trail. A finding is never permission to write.

### Rollout Monitor

Rollout Monitor is a later runtime-control layer. It may observe flags, experiments, deployment health, and KPIs before recommending expansion, pause, or rollback.

No initial Self-Driving contract may mutate a feature flag, deployment, customer account, billing state, or production system.

### Solve Context

Solve Context is the planned adapter layer for approved external evidence such as:

- repository and CI metadata;
- runtime events;
- errors and logs;
- traces;
- support context;
- deployment metadata;
- feature flags and experiments;
- warehouse aggregates;
- AI traces;
- MCP/tool-call telemetry.

Each adapter needs a separate evidence, redaction, bounds, credentials, tenancy, retention, and authority review before it is treated as production-ready.

## Operating modes

The product direction encodes four operating modes:

| Mode | Intended behavior | Current status |
| --- | --- | --- |
| `observe` | findings and evidence only | initial implementation |
| `suggest` | findings plus non-applied patch proposal | planned |
| `pr` | create a tested reviewable branch/PR | planned, requires write-side policy |
| `auto` | automatically merge only explicitly approved low-risk classes | planned, highest governance bar |

The existence of these mode names in a schema or type is not evidence that the mode is enabled. The initial implementation must fail closed for every mode except `observe`.

## Evidence model

Self-Driving evidence is deliberately split by source so that confidence is not inflated by mixing static and runtime facts.

Initial signal kinds reserved by the contract are:

- repository;
- runtime event;
- error;
- log;
- trace;
- support;
- deployment;
- feature flag;
- experiment;
- warehouse;
- AI trace;
- MCP tool call.

A future finding may correlate several kinds, for example:

`conversion drop -> frontend error -> deployment -> source node -> affected tests -> proposed PR`

or:

`AI cost increase -> repeated MCP call loop -> agent definition -> source node -> prompt/tool patch -> validation`

Correlation must preserve the provenance of each input rather than collapsing multiple evidence classes into an unsupported causal claim.

## Initial implementation slice

Issue #779 begins with a repository-only foundation:

1. roadmap/product contract;
2. strict Scout finding types;
3. deterministic bounded Solve Inbox projection;
4. explicit future operating-mode names with observe-only enforcement;
5. tests for ordering, deduplication, provenance, bounds, and fail-closed action/mode rejection.

This first slice does not connect live analytics, logs, support systems, AI providers, feature-flag providers, warehouses, or deployment systems.

## Staged build order

1. **Observe contract** — deterministic Scout/Inbox model with no side effects.
2. **Setup Agent plans** — repository/framework detection mapped to reviewable setup plans; still no automatic write.
3. **Context adapters** — add individually bounded read-only runtime/product sources.
4. **AI Scout** — standardized AI trace/MCP/tool/cost finding contracts and repository correlation.
5. **Suggestion mode** — produce non-applied patches and validation plans.
6. **PR mode** — least-privilege GitHub write side, protected branches, explicit policy, tested PR creation.
7. **Rollout observation** — correlate deploys/flags/experiments with outcomes.
8. **Controlled rollout actions** — separately approved mutation policies with rollback/audit requirements.
9. **Auto mode** — only for narrow, explicitly approved low-risk classes after sustained evidence.

## Solve Runners boundary

**Solve Runners is a separate product.**

Self-Driving may later request compute from Solve Runners for analysis or PR validation, but runner provisioning, pricing, operating systems, registration, customer isolation, and execution capacity remain a separate product and security boundary.

The Self-Driving roadmap must not use repository-analysis features as a back door to introduce managed runner authority.
