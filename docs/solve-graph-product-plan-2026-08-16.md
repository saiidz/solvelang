# Solve Graph / Solve Intelligence Product Plan

Date: 2026-08-16
Status: **planned; documentation only; no production or hosted graph service exists yet**
Owner: SolveLang

## Executive decision

SolveLang should add a persistent, deterministic software knowledge-graph subsystem that serves both machines and humans:

1. **Local code intelligence** for the CLI, Repository Audit, Codex/agents, impact analysis, architecture understanding, and MCP queries.
2. **A visual graph explorer** for developers to inspect repositories, architecture, dependencies, risk hubs, security paths, and change impact.

Working product names:

- **Solve Graph** for the graph engine and CLI surface.
- **Solve Intelligence** for the broader product family built on top of the graph.

The first implementation must be local-first and read-only. Hosted repository ingestion, public repository pages, organization graphs, and paid features come only after the deterministic local engine is accurate, bounded, and safe.

This plan is inspired by the useful product category represented by code-graph tools and visual repository explorers, but SolveLang should implement its own contracts, UX, and architecture. Do not copy proprietary product code or UI.

## Why this belongs in SolveLang

SolveLang already spans several related product surfaces:

- the `.solve` language and runtime;
- Workflow Intelligence Studio and Workflow Preflight;
- Repository Audit;
- Server Audit;
- MCP and AI-agent integration;
- API/customer-account and future hosted execution infrastructure.

A shared graph layer can become the common structural intelligence underneath these products.

Today, repository understanding is repeatedly reconstructed from files. A persistent graph allows deterministic answers to questions such as:

- What depends on this function, module, service, route, workflow, or table?
- What tests cover a changed component?
- What production workflow deploys this service?
- What can this pull request affect?
- Which paths can reach billing, credentials, account termination, network calls, or persistent storage?
- Which modules are highly connected and risky to modify?
- Which repository areas are disconnected, duplicated, cyclic, unused, or under-tested?

For `.solve` code, SolveLang has a special advantage: the compiler can emit semantic relationships directly instead of inferring all relationships from syntax.

## Product principles

The graph system must follow these rules from the beginning:

- deterministic checks first; AI explanation second;
- local-first by default;
- read-only indexing by default;
- no repository code execution during indexing;
- no package-manager hooks, build scripts, or untrusted commands during indexing;
- exact source provenance for every node and edge;
- stable IDs where inputs are unchanged;
- bounded file count, file size, graph size, memory, and wall-clock time;
- generated graph caches are not committed by default;
- secret values are never intentionally stored in the graph;
- sensitive literals are redacted or fingerprinted rather than copied;
- private repositories never become public graph pages implicitly;
- AI/model access is opt-in and receives only the minimum required graph context;
- graph claims must distinguish exact semantic facts from heuristic/inferred relationships;
- write/remediation actions remain separate from analysis;
- hosted ingestion and organization-wide graphs require separate privacy and threat-model review.

## Non-goals for v0

Solve Graph v0 is not:

- a general graph database service;
- a replacement for Git;
- a replacement for the compiler or parser;
- a hosted source-code backup system;
- an automatic refactoring engine;
- an autonomous production-change system;
- a reason to execute repository code during analysis;
- a guarantee that every dynamically resolved runtime relationship can be known statically.

## Proposed architecture

```text
Repository / Workspace
        |
        v
+-------------------------+
| Deterministic indexers  |
|-------------------------|
| Solve semantic emitter  |
| JS/TS adapter           |
| Rust adapter            |
| Python adapter          |
| GitHub Actions adapter  |
| config/IaC adapters     |
+-------------------------+
        |
        v
+-------------------------+
| Canonical graph model   |
| nodes + edges + source  |
| provenance + confidence |
+-------------------------+
        |
        +--------------------+
        |                    |
        v                    v
+------------------+   +-------------------+
| Query / impact   |   | Repository Audit  |
| path analysis    |   | architecture      |
| risk metrics     |   | findings          |
+------------------+   +-------------------+
        |
        +--------------------+
        |                    |
        v                    v
+------------------+   +-------------------+
| CLI / MCP        |   | Local web explorer|
| Codex / agents   |   | interactive graph |
+------------------+   +-------------------+
                             |
                             v
                       Hosted explorer
                       only after later
                       privacy review
```

The graph engine should be reusable by Repository Audit rather than implemented as a second unrelated analyzer.

## Canonical graph contract

The first major implementation milestone is a versioned machine-readable graph contract.

### Node contract

Every node should include at minimum:

- `id` — deterministic identifier scoped to repository identity + graph schema version;
- `kind` — e.g. repository, file, module, function, type, route, test, workflow, job, resource, permission, dependency;
- `name` — human-readable canonical name;
- `language` or source domain when applicable;
- `path` — repository-relative path when source-backed;
- source span where available: line/column start and end;
- `visibility` when meaningful;
- `fingerprint` for stable change detection;
- `origin` — exact semantic, syntax-derived, config-derived, or heuristic;
- optional safe metadata with bounded keys and values.

### Edge contract

Every edge should include at minimum:

- deterministic `id`;
- `from` node ID;
- `to` node ID;
- `kind`;
- source provenance;
- `origin` classification;
- optional confidence only for heuristic edges;
- optional bounded metadata.

Initial edge kinds should include:

- `contains`
- `imports`
- `calls`
- `references`
- `implements`
- `extends`
- `uses_type`
- `defines_route`
- `invokes_handler`
- `reads_resource`
- `writes_resource`
- `deploys`
- `depends_on`
- `tests`
- `grants`
- `triggers`
- `produces`
- `consumes`

Do not overload one generic `related_to` edge when a precise relationship is known.

### Provenance contract

Every source-backed fact must be traceable back to its repository-relative path and source span where available.

The graph UI and MCP tools must be able to answer "why is this edge present?" without requiring the model to guess.

## `.solve` semantic advantage

The compiler/parser should become the authoritative adapter for `.solve` relationships.

Target exact relationships include:

- file -> defines -> function/type/agent/tool;
- module -> imports -> module;
- function -> calls -> function;
- function -> uses_type -> type;
- agent -> uses -> tool;
- statement/expression -> reads/writes -> variable or declared resource where semantics support it;
- test/example -> exercises -> symbol where deterministically known.

The graph emitter should consume canonical AST/semantic structures rather than reparsing `.solve` source through a generic tree-sitter adapter.

This creates a differentiated product advantage: Solve Graph can be exact for SolveLang while remaining useful for polyglot repositories.

## Polyglot adapters

After the canonical graph contract is stable, add adapters incrementally.

Recommended order based on the current SolveLang repository and product goals:

1. JavaScript / TypeScript
2. Rust
3. GitHub Actions YAML
4. JSON/YAML configuration and package manifests
5. Python
6. Terraform / CloudFormation
7. PHP and other languages based on demand

Generic language adapters may use parser/tree-sitter-based analysis, but the graph must mark relationships as exact syntax facts versus inferred/heuristic facts.

Do not claim dynamic call relationships that cannot be proven statically.

## GitHub Actions and infrastructure graphing

This is a high-value SolveLang differentiator because source code alone does not describe the full production system.

Target workflow nodes/edges:

- workflow -> triggers -> event;
- workflow -> contains -> job;
- job -> uses -> action;
- job -> invokes -> script;
- workflow -> deploys -> stack/service;
- workflow -> reads -> environment variable/secret name without secret value;
- workflow -> assumes -> IAM role reference;
- stack -> provisions -> resource;
- policy -> grants -> action/resource pattern;
- route -> backed_by -> Lambda/service;

This supports deterministic questions such as:

- Which workflow can mutate production?
- Which workflow can deploy this service?
- What source files affect this deployment workflow?
- What services depend on this CloudFormation resource?
- Which permissions can reach a sensitive operation?

Secrets must be represented only by safe identifiers such as the secret name, never by secret value.

## Storage and cache model

Local indexing should create a reproducible graph artifact plus an incremental cache.

Proposed defaults:

```text
.solve/
  cache/
    graph-v1/
      manifest.json
      graph.json
      index/
```

The cache directory should be ignored by Git by default.

Export commands may explicitly produce user-selected files such as:

```text
graph.json
graph.html
SOLVE_GRAPH_REPORT.md
```

The canonical export must be deterministic for the same repository snapshot and options.

The implementation should avoid requiring Neo4j or another external database for local use. Start with bounded in-process structures and portable JSON/index files. A database-backed hosted implementation can be evaluated later.

## CLI design

Initial target commands:

```bash
solve graph .
solve graph build .
solve graph update .
solve graph stats .
solve graph query "what depends on CustomerAuth?"
solve graph node CustomerAuth
solve graph neighbors CustomerAuth
solve graph path CustomerAuth CustomerAuthTable
solve graph impact path/to/file
solve graph impact --git-diff
solve graph architecture .
solve graph export --json graph.json
solve graph serve .
```

Natural-language `query` should initially translate into deterministic graph operations rather than silently using a remote model. If AI interpretation is added, it must be explicit and fall back to inspectable graph queries.

## Query engine v0

Required deterministic primitives:

- exact node lookup;
- node search by path/name/kind;
- inbound neighbors;
- outbound neighbors;
- bounded breadth/depth traversal;
- shortest path;
- all paths with strict limits;
- dependency cone;
- reverse dependency cone;
- changed-file impact set;
- strongly connected components;
- fan-in/fan-out metrics;
- orphan/disconnected candidates;
- edge explanation with provenance.

Every traversal must have bounded depth/node/edge limits to avoid accidental graph explosions.

## Impact analysis

Impact analysis is one of the primary product features.

Input forms:

- file path;
- symbol;
- git diff;
- commit range;
- PR diff when GitHub integration is available.

Output should distinguish:

- direct dependents;
- transitive dependents;
- tests;
- workflows/deployment surfaces;
- sensitive resources or permissions;
- confidence/origin of each path;
- unresolved dynamic relationships.

A future PR check may summarize:

```text
Change impact
- 8 direct symbols
- 31 transitive symbols
- 6 tests
- 2 production workflows
- 1 sensitive auth boundary
- no billing path detected
```

This must remain evidence-backed and link every claim to graph paths.

## MCP / Codex integration

After local graph queries are stable, expose a narrow MCP surface.

Initial MCP tools:

- `graph_stats`
- `find_nodes`
- `get_node`
- `get_neighbors`
- `find_path`
- `impact_analysis`
- `affected_tests`
- `affected_workflows`
- `architecture_summary`
- `explain_edge`

MCP output must remain bounded. Do not dump entire repository graphs into model context.

The graph should reduce repeated repository scanning by allowing Codex/agents to request only the relevant structural neighborhood.

## Local visual explorer

The first visual product should be local and static/server-local, not hosted.

Target capabilities:

- interactive graph canvas;
- node search and filtering;
- edge-kind filters;
- file/module/service grouping;
- architecture communities;
- source-provenance drawer;
- dependency and reverse-dependency views;
- path highlighting;
- impact view for a changed file or git diff;
- high fan-in/fan-out hotspots;
- cycles;
- orphan candidates;
- test relationships;
- workflow/deployment overlay;
- security-sensitive path overlay;
- export to self-contained HTML where practical.

The UI must remain useful on large repositories. It should default to clustered/filtered views instead of attempting to render every node at once.

## Hosted visual explorer

Hosted repository graphs come later.

Potential surfaces:

```text
solve-lang.com/explore
solve-lang.com/graph/<owner>/<repo>
```

Possible hosted features:

- private repository graph workspaces;
- opt-in public repository pages;
- historical graph snapshots;
- PR graph diffs;
- team annotations;
- organization-wide dependency mapping;
- cross-repository service graphs;
- security and ownership policies;
- AI architecture Q&A grounded in graph paths.

Before hosted ingestion, require a dedicated privacy/security design covering:

- GitHub OAuth/App scopes;
- source-code retention;
- encryption at rest;
- tenant isolation;
- deletion guarantees;
- repository visibility changes;
- public/private graph publication rules;
- model-provider boundaries;
- audit logging;
- abuse/rate limits;
- data-region requirements if enterprise demand exists.

No private repository should become a public graph because a repository changes visibility or because a user shares a URL accidentally.

## Repository Audit integration

Solve Graph should become the structural engine for Repository Audit v1 rather than duplicating graph logic.

Repository Audit can consume graph outputs for:

- import/reference graph;
- dependency cycles;
- high-risk hubs;
- dead/unreferenced candidates;
- route-to-handler consistency;
- dependency usage candidates;
- test coverage relationships;
- deployment relationships;
- architecture scoring;
- blast-radius analysis;
- evidence-linked cleanup recommendations.

Repository Audit findings must still be generated through its safe finding/report contract. The graph is evidence, not an excuse to bypass audit severity, provenance, redaction, or review rules.

## Server Audit integration

Do not merge Server Audit and Repository Audit permission models.

Later, Server Audit may emit a separate infrastructure graph:

- host -> runs -> service;
- service -> listens_on -> port;
- reverse proxy -> routes_to -> application;
- domain -> terminates_at -> certificate/proxy;
- application -> deployed_from -> repository/service identifier where proven;
- scheduled job -> invokes -> command/service.

Cross-linking repository and server graphs should happen only through explicit, evidence-backed identifiers.

Server collection remains read-only and least privilege.

## Security graph capability

A later graph layer can support security path analysis such as:

```text
public route
  -> handler
  -> authorization check
  -> service
  -> sensitive resource
```

or:

```text
GitHub workflow
  -> production role
  -> IAM permission
  -> CloudFormation stack
  -> Lambda
  -> customer table
```

Security-path results must distinguish existence of a structural path from proof of exploitability. Solve Graph should not automatically label every path a vulnerability.

## AI usage model

AI is an optional explanation/query layer, not the graph source of truth.

Recommended order:

1. deterministic parsing/indexing;
2. deterministic graph queries;
3. deterministic metrics/findings;
4. optional AI explanation over bounded graph evidence.

If a model is used:

- include node/edge IDs and source references;
- cap context size;
- never include secret values;
- record which graph evidence supported the answer;
- allow local/provider-disabled operation;
- keep deterministic commands fully usable without an AI API key.

## Performance goals

Initial targets for v0 should be measurable rather than aspirational.

Suggested baseline targets:

- index 10,000 source/config files without repository code execution;
- hard file-size and total-byte limits;
- bounded memory use with explicit refusal on oversized input;
- deterministic graph output ordering;
- incremental rebuild avoids reparsing unchanged files when safe;
- common node lookup and one-hop queries complete interactively;
- path/impact queries enforce strict traversal budgets;
- web explorer never attempts to render an unbounded full graph.

Exact limits should be set by benchmarks before release and exposed in diagnostics/config.

## Versioning

Version independently:

- graph schema;
- adapter versions;
- query protocol;
- MCP contract;
- report/export formats.

A cache generated by an incompatible schema/adapter version must be invalidated safely rather than partially reused.

## Privacy and secret handling

Mandatory rules:

- repository-relative paths are allowed; absolute local paths should not be exported by default;
- secret scanners may attach redacted warnings/fingerprints but not raw secret values;
- `.env` and credential files require special handling and must not be treated like ordinary source text;
- binary/large/vendor/generated directories should be excluded or bounded by policy;
- model prompts must never receive raw credentials from repository content;
- local graph cache permissions should follow normal user-local security expectations;
- hosted private graphs require tenant-scoped authorization on every object/query;
- graph exports should carry a warning that repository structure itself can be sensitive.

## Product packaging direction

Do not lock pricing before product value is proven, but the architecture should support a natural split.

Potential future packaging:

### Free / open local tooling

- local graph build/update;
- deterministic CLI queries;
- local architecture statistics;
- local visual explorer;
- core MCP graph queries.

### Developer

- private hosted repository graphs;
- PR impact summaries;
- saved architecture history;
- bounded AI architecture Q&A.

### Pro / Team

- multiple repositories;
- richer security paths;
- team annotations;
- historical graph diffs;
- policy checks;
- organization reporting.

### Business / Enterprise

- organization/cross-repository graph;
- SSO/governance;
- audit history;
- policy enforcement;
- retention controls;
- enterprise support and deployment options.

Local language/compiler functionality should not require a paid hosted subscription.

## Competitive differentiation

SolveLang should not compete only on "pretty code graphs."

The strongest differentiation is the combination of:

- exact `.solve` compiler semantics;
- polyglot repository graphing;
- GitHub Actions/deployment/IAM relationships;
- Repository Audit findings;
- Server Audit evidence later;
- deterministic impact analysis;
- MCP/Codex context;
- optional hosted visual exploration;
- explicit safety separation between analysis and execution.

The product thesis is:

> The compiler explains what a Solve program means. Solve Graph explains what the whole software system means to developers and AI agents.

## Implementation phases and PR sequence

Each phase should be an isolated PR with tests. Do not combine the entire product into one large branch.

### Phase 0 — contracts and fixtures

Branch suggestion: `agent/solve-graph-contract-v0`

Deliverables:

- versioned graph JSON schema/structs;
- node/edge/provenance contracts;
- deterministic IDs/order rules;
- bounded scan policy;
- representative repository fixtures;
- graph golden-test fixtures;
- cache/export directory decision;
- no hosted code.

Acceptance gate:

- deterministic serialization proven across repeated runs;
- malformed/oversized graph input fails closed;
- no absolute-path leakage in default export fixtures;
- no secret values in fixtures/outputs.

### Phase 1 — `.solve` semantic graph emitter

Branch suggestion: `agent/solve-graph-solve-semantic-v0`

Deliverables:

- compiler/AST integration;
- files/modules/functions/types/imports/calls;
- exact source provenance;
- graph build CLI for `.solve` repositories;
- golden tests including nested imports and source provenance.

Acceptance gate:

- exact relationships verified against hand-authored fixtures;
- imported-file provenance remains correct;
- graph generation does not change runtime semantics.

### Phase 2 — repository/polyglot index

Branch suggestion: `agent/solve-graph-repository-index-v0`

Deliverables:

- repository tree/file nodes;
- JS/TS adapter;
- Rust adapter;
- package/dependency manifests;
- GitHub Actions adapter;
- generated/vendor exclusion policy;
- incremental file fingerprint/cache support.

Acceptance gate:

- bounded scan of SolveLang itself;
- deterministic graph on repeated identical commit;
- no repository code/build/hook execution;
- adapters clearly mark exact vs inferred relationships.

### Phase 3 — deterministic query and impact engine

Branch suggestion: `agent/solve-graph-query-v0`

Deliverables:

- lookup/neighbors/path/SCC/dependency-cone primitives;
- changed-file and git-diff impact analysis;
- source evidence for all returned relationships;
- strict traversal budgets;
- human-readable CLI output plus JSON mode.

Acceptance gate:

- impact results covered by golden fixtures;
- cyclic/large graphs terminate within configured bounds;
- ambiguous symbols are not silently conflated.

### Phase 4 — Repository Audit integration

Branch suggestion: `agent/repository-audit-graph-integration-v1`

Deliverables:

- import/reference findings based on graph;
- dependency cycle and hub findings;
- unreferenced/dead candidates with conservative language;
- test/deployment relationship evidence;
- graph evidence linked into report finding IDs.

Acceptance gate:

- Repository Audit remains read-only;
- no cleanup/remediation capability introduced by this phase;
- false-positive fixtures documented and bounded.

### Phase 5 — MCP / Codex graph tools

Branch suggestion: `agent/solve-graph-mcp-v0`

Deliverables:

- bounded MCP tools;
- graph cache discovery;
- response-size limits;
- provenance-rich results;
- no whole-repo graph dumps by default.

Acceptance gate:

- MCP works without exposing secret values;
- malformed queries fail safely;
- agents can perform common impact/path tasks using materially less repository context.

### Phase 6 — local visual explorer

Branch suggestion: `agent/solve-graph-explorer-v0`

Deliverables:

- `solve graph serve`;
- interactive node/edge explorer;
- cluster/filter/search;
- source provenance view;
- impact/path visualization;
- architecture/hotspot/cycle views;
- no hosted source upload.

Acceptance gate:

- remains usable on benchmark graphs;
- graph rendering is bounded/clustered;
- browser receives no local secret material that is not part of the safe graph export.

### Phase 7 — PR impact integration

Branch suggestion: `agent/solve-graph-pr-impact-v0`

Deliverables:

- diff-to-graph impact report;
- affected tests/workflows;
- sensitive path indicators;
- optional GitHub check/comment integration after permission review.

Acceptance gate:

- report is evidence-linked;
- GitHub integration uses minimum scopes;
- analysis remains non-mutating unless a separate comment/check write is explicitly enabled.

### Phase 8 — hosted private explorer design

Branch suggestion: `docs/solve-graph-hosted-threat-model`

Documentation/design first:

- tenant model;
- GitHub App scopes;
- repository ingest/deletion lifecycle;
- encryption/retention;
- hosted graph store choice;
- model-provider boundary;
- pricing/quotas;
- abuse controls;
- public repository opt-in rules.

Acceptance gate:

- threat model reviewed before production ingestion code;
- no private-source upload until tenant isolation and deletion design are approved.

### Phase 9 — hosted explorer implementation

Only after Phase 8 approval.

Potential deliverables:

- private graph workspaces;
- public opt-in repository pages;
- graph snapshots/history;
- PR graph diff;
- team/organization capabilities in later PRs.

Every hosted production mutation/deployment remains separately gated under the existing SolveLang production-safety process.

## Testing strategy

Required test classes:

- unit tests for graph ID/schema contracts;
- golden tests for known repositories/fixtures;
- provenance tests;
- deterministic ordering tests;
- incremental cache invalidation tests;
- malformed/oversized input tests;
- secret-redaction regression tests;
- cross-platform path normalization tests;
- traversal-budget/DoS tests;
- adapter false-positive/false-negative fixtures;
- CLI JSON contract tests;
- MCP output-bound tests;
- explorer large-graph smoke/performance tests.

No test fixture may contain live credentials or production customer data.

## Metrics for deciding whether the feature is working

Track measurable outcomes:

- graph build time by repository size;
- incremental rebuild time;
- nodes/edges per adapter;
- percentage of edges with exact source spans;
- impact-query latency;
- false-positive rate on curated fixtures;
- repository-context/token reduction for graph-assisted agent tasks;
- user time to answer architecture questions with vs without explorer;
- number of Repository Audit findings supported by graph evidence.

Do not claim token/cost savings until measured.

## Go/no-go rules

Do not advance to hosted ingestion if any of these remain unresolved:

- graph output leaks secret values or absolute private paths by default;
- deterministic builds are unstable;
- graph IDs change unnecessarily between identical snapshots;
- large/cyclic repositories can cause unbounded traversal;
- `.solve` source provenance is incorrect;
- Repository Audit cannot explain the evidence behind graph findings;
- private/public repository visibility rules are ambiguous;
- tenant isolation or deletion guarantees are not designed.

## Relationship to current priorities

Solve Graph is a strategic product track, but it should not bypass current production safety work.

Current production auth/admin/billing/priority gates remain independent. The graph work can proceed in parallel as local/read-only development because it does not require enabling billing, customer priority, TOTP, or the Admin Console.

Recommended scheduling:

1. finish currently approved Admin Gateway branch cleanup/CI independently;
2. begin Solve Graph Phase 0 contracts on a new isolated branch;
3. land Phase 1 `.solve` semantic graph before broad polyglot adapters;
4. reuse the graph in Repository Audit v1 rather than building duplicate dependency analysis;
5. keep hosted graph ingestion behind a separate future approval.

## First implementation checkpoint

The next coding authorization for this track should be scoped to **Phase 0 only**:

> Build the versioned Solve Graph contract, deterministic IDs/serialization, bounded scan policy, fixtures, and tests on an isolated branch. Do not add hosted ingestion, external model calls, repository mutation, production deployment, or customer data access.

Suggested approval phrase:

`APPROVE SOLVE GRAPH PHASE 0 CONTRACT + TESTS`

## Continuation handoff

If work resumes in another chat or agent session, start from this file and verify current GitHub state before coding.

Key decisions to preserve:

- local-first before hosted;
- deterministic graph facts before AI explanation;
- compiler-semantic emitter for `.solve`;
- polyglot adapters after schema stability;
- Repository Audit consumes the shared graph engine;
- MCP responses stay bounded;
- private repository hosting is opt-in and separately threat-modeled;
- no production mutation is implied by merging graph code.
