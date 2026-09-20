# Solve Context v0

## Current verification — 2026-09-20

MCP v0.3.0 is published on npm and GitHub; main protection is enforced.
See [the current completion checklist](../project-completion-evidence-2026-09-20.md) for fresh evidence and
remaining live acceptance gates. Older checkpoints below are historical.

Status: **implemented repository product foundation with real-source regression coverage; distributed in the tagged MCP v0.3.0 package; not yet proven by complete real-agent/provider measurements**
Tracking epic: #898  
Repository status reconciled through #920 on 2026-09-15.

## Purpose

Solve Context is a separate product layer for Claude Code and Codex. It is not part of SolveLang language semantics and it is not Solve Runners. SolveLang can dogfood it, but the context engine is designed for arbitrary repositories.

The product thesis is: **prevent irrelevant context from being read first; compact only when necessary and only when correctness can be preserved.**

## Implemented today

Current repository source includes:

1. `solvelang_context_plan` — bounded deterministic task-aware planning;
2. `solvelang_context_pack` — content-addressed exact excerpts with source provenance and byte budgets;
3. `solvelang_context_retrieve` — stale-source-safe exact retrieval;
4. `solvelang_context_handoff` and validation — portable Claude ↔ Codex task state without automatic instruction-file mutation;
5. correctness-first structured compaction/expansion for JSON/log/diff payloads;
6. changed-path priority and bounded direct relationships from an integrity-validated supplied Solve Graph;
7. deterministic selection reasons, path/source ranges, source/excerpt hashes, omission/truncation truth and stable ordering;
8. pinned first-party real-source regressions from SolveLang;
9. independently pinned Chalk and node-fetch source subsets with equal-budget lexical/changed-path/graph-assisted comparisons;
10. an offline agent-run record/report contract for future approved real Claude/Codex measurements;
11. #920 pair-integrity rules requiring baseline and Solve Context arms to use the same fixture/provider/model/agent/record class, outcome-evaluation basis and required-evidence denominator.

## What is not established yet

The repository does **not** currently establish:

- a public current-main Solve Context release after MCP v0.2.0;
- real Claude/Codex provider-token savings;
- real-agent task-success improvement or quality equivalence across the full benchmark suite;
- provider cache-reuse improvement;
- end-to-end agent latency improvement;
- superiority over Headroom or another context product;
- a live provider proxy;
- a provenance/memory learner that is part of the released product.

Synthetic/pinned-source excerpt-byte reduction is not provider-token savings.

## Context-pack contract

A context pack contains:

- a schema identifier;
- a content-addressed pack ID;
- a hash of task text rather than storing the task text as pack identity;
- a hard UTF-8 byte budget;
- measured selected bytes and explicit omission/truncation truth;
- normalized workspace-relative source paths;
- exact line ranges;
- SHA-256 identities for complete source and selected excerpt;
- stable retrieval handles;
- deterministic relevance reasons/score;
- exact selected source text.

The canonical schema is `schemas/solve-context-pack.v0.schema.json`.

## Selection behavior

Selection is local and deterministic. It combines lexical evidence with optional explicit changed paths and an optional supplied Solve Graph. Current behavior includes:

- local task-token/path/source matching;
- bounded lexical windows;
- deterministic whole-line budget fragments when a matching window is larger than remaining budget;
- changed-path priority before the discovery read cap;
- one-hop graph dependency/dependent/test evidence;
- bounded exported-declaration text windows for graph-selected neighbors where necessary to preserve relevant implementation evidence;
- global ranking of fragments using actual scores with stable tie handling;
- exact provenance for every included excerpt;
- explicit omissions rather than hidden summarization.

The graph input is local and integrity-validated but is not an authenticated statement of workspace freshness. The tool reports that distinction rather than pretending a checksum proves current workspace truth.

## Safety invariants

### Local-first and read-only

Context optimization does not imply a model call, network call, repository write, credential read, dependency installation or repository-source execution.

### Source identity

Every selected excerpt retains complete-source and excerpt identity. Retrieval rejects stale source when the workspace content no longer matches the handle.

### Path and privacy bounds

Paths are normalized workspace-relative identities; unsafe/traversal-style paths and likely sensitive paths are rejected according to the reviewed runtime policy. Workspace discovery remains bounded.

### Budget truth

`selectedBytes` is measured from exact UTF-8 content. Content that cannot fit is omitted or represented by an explicitly bounded exact fragment according to the reviewed algorithm; no hidden summary is presented as exact source.

### Provider/cache truth

Current context-pack operation does not mutate provider request prefixes. Future safe-mode measurement requires `cacheHotBytesChanged: 0` to be measured, not inferred from missing data.

## Evaluation status

The evaluation stack now has three layers:

### Synthetic deterministic suite

Covers all six acceptance categories:

- monorepo bug fix;
- GitHub issue triage;
- CI/log diagnosis;
- multi-file refactor;
- JSON-heavy tool output;
- cross-agent handoff.

Synthetic results are regression evidence only.

### Pinned source regressions

- first-party SolveLang source subset;
- independent external subsets from Chalk and node-fetch.

These prove deterministic selection/integrity behavior on immutable source snapshots but are not blinded whole-repository or live-agent benchmarks.

### Real-agent record/report contract

Future separately authorized baseline-vs-Solve-Context runs can be summarized only when records pass strict identity and measurement validation. `benchmarkEvidenceComplete` remains false until measured pairs cover all six categories, both Claude and Codex, both handoff directions, no quality regression, provider-reported tokens for every measured pair, measured latency, measured selection precision/recall and measured zero safe-mode cache-hot mutation for every context arm.

Even a complete engineering matrix keeps publication/public-percentage authorization false until separately approved.

## Distribution truth

MCP `@solvelang/mcp-server@0.3.0` is published on npm and GitHub, verified on 2026-09-20. It distributes the tagged release source; later main changes require separate distribution. Managed-workspace marketplace installation and public Plugin Directory listing remain unverified. v0.2.0 is historical.

External distribution verification remains a distinct milestone from repository source/tag state.

## Projected next work

These are priorities, not promised dates:

1. add broader independent/blinded repository fixtures without weakening budgets/evidence;
2. fix only demonstrated selection defects exposed by those fixtures;
3. run separately authorized real Claude/Codex baseline-vs-context tasks covering all acceptance categories and both handoff directions;
4. collect truthful provider-token/latency/cache/selection/quality evidence;
5. verify managed-workspace installation and Plugin Directory listing for the published release;
6. consider optional provider-proxy or provenance/memory work only as separately reviewed expansion after core evidence is strong.

## Optional provider proxy boundary

A provider proxy is not part of current v0 activation. If later approved, it must be fixture-locked for raw-byte/streaming fidelity: untouched material byte-identical, cache-hot prefixes preserved, Anthropic cache-control boundaries respected, OpenAI Responses fields such as `phase` preserved, numeric/tool/content ordering stable, UTF-8 handled at byte boundaries and streaming errors/termination truth retained. If safe transformation cannot be proven, optimization must fail open to the original content.

## Success criterion

Solve Context succeeds when Claude and Codex complete coding tasks with less irrelevant context **without measurable quality regression**, while exact source evidence remains recoverable and provider/cache behavior stays truthful. Compression percentage alone is not the product goal.
