# Solve Context v0

Status: **foundation / not yet a released context-optimization product**  
Tracking epic: #898

## Purpose

Solve Context is a separate product layer for Claude Code and Codex. It is not part of the SolveLang language semantics and it is not Solve Runners. SolveLang can dogfood it, but the context engine must work for arbitrary repositories.

The goal is to reduce coding-agent context cost and noise without sacrificing correctness. The first principle is to prevent irrelevant context from being read in the first place. Compression is a later fallback, not the primary architecture.

## Why this is different

A generic compression proxy sees content after the agent or tool has already produced it. Solve Context should use task intent plus repository structure to decide what the agent should read before broad file, graph, log, or JSON payloads flood the context window.

The target experience for both Claude Code and Codex is one shared local-first plugin path backed by deterministic context tools:

1. plan the smallest relevant context set,
2. package exact excerpts with source provenance,
3. retrieve originals by content-addressed handle,
4. hand the same task state between agents,
5. compact only live-zone content when a safe deterministic or reversible transform exists.

## Competitive engineering target

Headroom demonstrates a useful market baseline: local context compression, proxying, agent wrappers, MCP tools, reversible retrieval, cross-agent memory, session learning, output shaping, and savings telemetry.

Solve Context should exceed that baseline by emphasizing **context prevention, repository/task awareness, and provider-fidelity contracts**. Headroom's public realignment audit currently documents bug classes involving cache-hot prompt mutation, JSON reserialization, cache-control boundaries, history compression, OpenAI Responses field preservation, numeric precision, and streaming reconstruction. Those are treated here as explicit classes of regressions to design out, not as behavior to emulate.

No production claim that Solve Context is "better than Headroom" is permitted until repeatable Claude/Codex benchmark evidence exists.

## V0 contract

V0 introduces a deterministic context-pack contract. It does not proxy provider traffic and it does not summarize source code.

A context pack contains:

- a schema identifier,
- a content-addressed pack ID,
- a hash of the task text rather than the task text itself,
- a hard byte budget,
- measured selected bytes,
- explicit truncation truth,
- exact workspace-relative source paths,
- exact line ranges,
- SHA-256 identities for the complete source and selected excerpt,
- a stable retrieval handle,
- deterministic relevance reasons and score,
- the exact selected source text.

The canonical schema is `schemas/solve-context-pack.v0.schema.json`.

## Selection behavior

The initial builder in `packages/mcp-server/src/context-pack.ts` is intentionally simple and deterministic:

- task text is tokenized locally,
- task tokens are matched against normalized workspace-relative paths and source lines,
- matching lines expand to bounded nearby line windows,
- overlapping windows merge,
- candidates are ranked deterministically,
- candidates that would exceed the hard byte budget are omitted rather than silently truncated,
- irrelevant sources are omitted rather than summarized or hallucinated,
- output ordering is stable regardless of source-input order.

This is a foundation, not the final relevance model. Later phases should add Solve Graph, git diff, symbol, dependency, and affected-test evidence without weakening determinism or provenance.

## Safety invariants

### Local and read-only

The V0 pack builder performs no network requests, provider calls, repository writes, credential reads, or workflow execution.

### Source identity

Every selected excerpt records both:

- `sourceSha256` for the complete source supplied to the builder, and
- `excerptSha256` for the exact selected content.

Future retrieval must reject stale handles when the source identity no longer matches.

### Path identity

Context paths are normalized workspace-relative identities. Absolute paths, drive-qualified paths, traversal segments, and duplicate empty path segments are rejected.

### Budget truth

`selectedBytes` is measured from the exact UTF-8 excerpt payload. `truncated` is true only when at least one relevant candidate was omitted by the budget. V0 does not publish token-savings percentages because no provider tokenizer is involved yet.

### No hidden summarization

V0 excerpts are exact source text. If content does not fit, it is omitted and counted. Future lossy transforms must be explicitly labeled and reversible.

## Required next phases

### Phase B — MCP plan / pack / retrieve

Add read-only MCP tools to the existing shared Claude/Codex server:

- `solvelang_context_plan`
- `solvelang_context_pack`
- `solvelang_context_retrieve`

Workspace discovery must remain bounded and must not recursively ingest ignored/binary/vendor trees without explicit policy.

### Phase C — Claude/Codex handoff

Add `solvelang_context_handoff` with a portable local task-state contract containing goals, decisions, unresolved questions, changed-source identities, relevant tests, and context handles. Handoff must not automatically rewrite `CLAUDE.md`, `AGENTS.md`, or other repository instruction files.

### Phase D — structured-output compaction

Implement lossless transforms first for repetitive JSON, tables, logs, and diffs. Error/failure lines must remain byte-exact. Any semantic summary must carry retrieval handles to the original material.

### Phase E — quality and savings evals

Run repeatable Claude Code and Codex fixtures for bug fixing, CI diagnosis, refactoring, issue triage, JSON-heavy tools, and cross-agent handoff. Record task success, evidence retention, latency, measured tokens, and any observable provider-cache effects.

### Phase F — optional provider proxy

A provider proxy is allowed only after raw-byte and streaming conformance fixtures exist. Required invariants include:

- unchanged blocks remain byte-identical,
- cache-hot prefixes are never dynamically rewritten for memory injection,
- Anthropic `cache_control` boundaries are honored,
- OpenAI Responses fields such as `phase` are preserved,
- numeric representation is not lossy,
- tool-call IDs and content-part order are stable,
- UTF-8 is parsed at complete byte boundaries,
- thinking/signature/citation deltas are preserved,
- mid-stream errors and missing terminators remain visible as failures,
- an optimizer that cannot prove a safe rewrite forwards the original content.

## Success criterion

The product target is not simply a larger compression percentage. Solve Context succeeds when Claude and Codex complete coding tasks with less irrelevant context, exact recoverability of source evidence, stable provider cache behavior, and no measurable quality regression.
