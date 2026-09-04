# Solve Self-Driving

Solve Self-Driving is the product layer that connects SolveLang's repository intelligence to bounded runtime/product signals, then turns those signals into reviewable engineering findings and, only in later explicitly gated stages, tested pull requests.

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

The Setup Agent detects supported repository/framework context and generates a bounded integration plan from the existing Repository Audit inventory.

The initial planning contract is merged through #782. It is analyze-only and observe-only: it summarizes frameworks, languages, package managers, and deployment targets; maps recognized frameworks to candidate future Context adapters and Scout coverage; and emits plans rather than shell commands, dependency-install commands, credentials, repository writes, or live provider connections.

Later stages may configure approved SDKs, CI checks, MCP integrations, or repository metadata only through separately reviewed write-side policy.

### Solve Graph

Solve Graph remains the structural source-of-truth for repository relationships: source files, packages, workflows, deployment paths, permissions, tests, and other bounded evidence.

Runtime/product context may attach to graph nodes later, but runtime evidence must not be mislabeled as static repository truth.

### Solve Scouts

Scout classes encoded by the initial contract:

- **Code Scout** — correctness, architecture, dependency, dead-code, and maintenance findings.
- **Security Scout** — static security-boundary and permission findings.
- **CI Scout** — workflow, validation, flaky/failing lane, and coverage signals.
- **Experience Scout** — conversion, behavior, feedback, latency, and support friction.
- **Incident Scout** — errors, logs, traces, deployments, and likely root-cause context.
- **Rollout Scout** — feature flags, experiments, canaries, release health, and rollout outcomes.
- **AI Scout** — AI traces, model/tool/MCP failures, loops, prompt/model regressions, latency, and reliability.
- **Cost Scout** — AI/token, infrastructure, workflow, and other measurable cost regressions.

A scout finding must retain provenance, confidence, impact, severity, and a bounded recommended next action.

The first AI Scout intelligence contract is merged through #786. It consumes only the sanitized provider-neutral Context contract and may report direct `outcome=failure` AI evidence plus caller-supplied retry, latency, token, or cost budget breaches. Missing budgets do not become implicit thresholds. The initial AI Scout has no raw-prompt, provider, credential, network, repository-write, or production-mutation authority and emits `inspect` findings only.

The first Experience/Incident/Rollout intelligence contract is merged through #788. Incident findings require direct error/failure state. Experience and rollout KPI findings require caller-supplied conversion, abandonment, error-rate, or latency budgets. The product Scouts explicitly do not infer that a deployment, flag, experiment, or code change caused a metric change, and they have no rollout-control authority.

### Solve Inbox

Solve Inbox is the deterministic presentation layer for Scout findings.

The initial contract `solvelang.self-driving.inbox.v0` is merged through #780 and is intentionally **observe-only**:

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

Solve Context is the adapter/evidence layer for approved external context such as:

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

The first provider-neutral envelope `solvelang.self-driving.context.v0` is merged through #784. It accepts **already-sanitized** bounded signals only and deliberately performs no provider connection. It normalizes timestamps, dimensions, metrics, signal identity, candidate Scout routing, ordering, duplicate handling, and truncation truth while retaining analyze-only/observe-only policy.

The initial Context contract rejects credential-shaped metadata keys, common secret-shaped values, multiline/raw-looking summaries, invalid timestamps, excessive metadata, and non-observe modes. Its policy explicitly records no network access, credential access, repository writes, production mutation, or external side effects.

The first provider-specific adapter is merged through #790 as an **offline/export-only PostHog adapter**. It accepts only a strict sanitized export contract, maps bounded product/error/deployment/flag/experiment/AI/MCP records into Solve Context, preserves provider partiality separately from Context truncation, and rejects person/profile identity, session replay, raw bodies, raw prompts/completions, headers/cookies, credential-shaped evidence, and arbitrary provider payloads. It has no API key, network, provider-project, or mutation authority.

Every real provider adapter still needs a separate evidence, redaction, bounds, credentials, tenancy, retention, and authority review before it is treated as production-ready. The provider-neutral envelope and offline PostHog adapter are not claims that PostHog, Sentry, Datadog, OpenTelemetry, a warehouse, support provider, feature-flag provider, LLM provider, or MCP server is connected live.

### Provider connection policy

The provider connection policy is merged through #793. It is analyze-only and intentionally performs no network call. It requires:

- an exact provider and region;
- an exact tenant/project locator;
- an opaque credential **reference**, not a credential value;
- an explicit read-capability allowlist rather than arbitrary endpoints;
- hard bounds for pages, records, response bytes, request count, timeout, and lookback;
- mandatory redaction rules for identities, session replay, raw request/response bodies, raw prompts/completions, credentials/secrets, headers, and cookies;
- no caller-controlled URL, path, HTTP method, or request body surface;
- no mutation endpoint authority;
- observe-only mode.

Provider plans are deeply immutable authorization artifacts, are revalidated before a read intent is created, and reject undeclared bound keys from untyped input. The PostHog read-intent contract maps allowlisted product-event, error, deployment, feature-flag, experiment, AI-trace, and MCP-tool-call reads to expected Solve Context signal kinds, but records `status=not-executed`, zero network requests, and zero credential resolutions.

### Exact PostHog product-events query contract

PR #795 implements the first exact provider request/response surface, still without transport execution.

For `product-events` only, the contract:

- requires an exact numeric `project:<id>` tenant locator;
- maps the approved US/EU region to a fixed PostHog Cloud host;
- constructs only `POST /api/projects/<id>/query/`;
- carries the already-approved opaque credential reference with declared `query:read` scope, never a credential value;
- uses one internal `HogQLQuery` event-count aggregate template;
- passes bounded lookback and row limit through typed query values rather than caller SQL interpolation;
- selects only event name and aggregate sample count, not person/session/property identity;
- records zero network requests and zero credential resolutions;
- normalizes only strict `[event, samples]` rows and drops provider response metadata;
- rejects identity-, credential-, multiline-, duplicate-, malformed-, and excessive aggregate rows;
- marks provider `hasMore` or the query row limit as partial evidence.

A complete aggregate result can enter the existing sanitized PostHog adapter only when the caller supplies an explicit observation timestamp. A partial aggregate result must **not** be bridged into Solve Context under the current export contract because the exact unseen-row count is unknown; SolveLang refuses to invent that count or claim completeness.

### Fixture-only PostHog transport simulation

PR #797 implements an in-memory, fixture-only simulation of the approved PostHog product-events request. It serializes only the exact request authorized by the provider plan and query contract, then enforces the immutable page, response-byte, request-count, timeout, terminal-HTTP-200, and one-request/one-response bounds before parsing JSON.

The simulation exposes no callback, provider SDK, live transport, or credential resolver. It records zero network requests and zero credential resolutions, never persists a raw provider response, and exists to prove request integrity and bounded response handling without connecting to PostHog.

### Composed Observe Run

PR #799 composes the provider-neutral Context and the AI, Cost, Experience, Incident, and Rollout Scouts into `solvelang.self-driving.observe-run.v0`, producing one canonical bounded Solve Inbox.

The run consumes already-sanitized Context, accepts caller-supplied budgets without inventing thresholds, bounds inputs to 500 signals and each Scout component to 5,000 findings, and leaves final truncation truth to the canonical Inbox. Its policy explicitly records no provider access, network access, credential resolution, repository write, rollout control, production mutation, or other external side effect.

## Operating modes

The product direction encodes four operating modes:

| Mode | Intended behavior | Current status |
| --- | --- | --- |
| `observe` | findings and evidence only | implemented through the composed bounded Observe Run (#799) |
| `suggest` | findings plus non-applied patch proposal | planned |
| `pr` | create a tested reviewable branch/PR | planned, requires write-side policy |
| `auto` | automatically merge only explicitly approved low-risk classes | planned, highest governance bar |

The existence of these mode names in a schema or type is not evidence that the mode is enabled. The current implementation fails closed for every mode except `observe`.

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

Correlation must preserve the provenance of each input rather than collapsing multiple evidence classes into an unsupported causal claim. Candidate Scout routing from a signal is a routing hint, not a causal claim or a finding by itself.

## Current implementation sequence

1. **Observe contract — merged #780**: strict Scout types and deterministic bounded Solve Inbox; write-capable actions and non-observe modes fail closed.
2. **Setup Agent plan — merged #782**: existing Repository Audit detections map to reviewable setup/context plans; no commands, credentials, or writes.
3. **Provider-neutral Context envelope — merged #784**: sanitized bounded runtime/product/AI signals gain deterministic identity, ordering, Scout routing, duplicate handling, and safety rejection; no live providers.
4. **AI Scout intelligence — merged #786**: direct AI failure evidence and explicit caller-budget breaches become deterministic observe-only findings without invented baselines or provider access.
5. **Experience/Incident/Rollout intelligence — merged #788**: direct error/failure evidence and explicit KPI-budget breaches become conservative product findings without control-plane authority or causality claims.
6. **Offline PostHog adapter — merged #790**: strict sanitized PostHog exports normalize into Solve Context without API keys, network access, identity/session ingestion, or mutation authority.
7. **Provider connection policy — merged #793**: exact tenant binding, opaque credential references, read-capability allowlists, hard transport budgets, mandatory redaction, immutable/revalidated authorization plans, and not-executed read intents.
8. **Exact PostHog product-events query contract — merged #795**: fixed host/path/method/scope, parameterized bounded HogQL, strict aggregate-result normalization, and truth-preserving Context bridge rules; still no network execution.
9. **Fixture-only PostHog transport simulation — merged #797**: exact-request serialization and bounded in-memory fixture response handling with no live transport or credential resolution.
10. **Composed Observe Run — merged #799**: provider-neutral Context and the AI, Cost, Experience, Incident, and Rollout Scouts compose into one canonical bounded Solve Inbox without external side effects.
11. **Injected read-only transport executor — planned**: invoke only an exact approved request contract through a separately reviewed transport/credential resolver, with byte/request/timeout proof and redaction before durable evidence.
12. **Suggestion mode**: produce non-applied patches and validation plans.
13. **PR mode**: least-privilege GitHub write side, protected branches, explicit policy, tested PR creation.
14. **Rollout observation**: correlate deploys/flags/experiments with outcomes.
15. **Controlled rollout actions**: separately approved mutation policies with rollback/audit requirements.
16. **Auto mode**: only for narrow, explicitly approved low-risk classes after sustained evidence.

## Provider adapter rule

A provider adapter must not be treated as a generic permission escalation. Each adapter should separately define:

- exact read-only API/data surface;
- tenant/project identity;
- credential scope and storage boundary;
- redaction before durable evidence;
- maximum records/bytes/time window;
- pagination and partial/truncation truth;
- retention behavior;
- retry/rate-limit behavior;
- deterministic transformation into the provider-neutral Context contract;
- evidence that no write/mutation endpoint is invoked.

Provider credentials must never be accepted in Scout findings, Solve Inbox items, exported sanitized Context signals, provider read intents, or query-result artifacts. Credential references may identify where a future approved transport resolves a credential, but the planning/request layers never resolve or emit the value.

## Solve Runners boundary

**Solve Runners is a separate product.**

Self-Driving may later request compute from Solve Runners for analysis or PR validation, but runner provisioning, pricing, operating systems, registration, customer isolation, and execution capacity remain a separate product and security boundary.

The Self-Driving roadmap must not use repository-analysis, Context, provider-connection, or provider-query features as a back door to introduce managed runner authority.
