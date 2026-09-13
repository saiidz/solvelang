# Solve Context evals v0

Status: **offline structural benchmark**  
Tracking epic: #898

## Purpose

This suite makes Solve Context regressions measurable before any marketing claim is made about Claude Code, Codex, token savings, or competitors.

Run it from `packages/mcp-server`:

```bash
npm run eval:context
```

The command builds the MCP package, runs the fixture suite, prints a deterministic JSON report, and exits non-zero if a required quality gate fails. MCP CI runs the same suite on pull requests that touch the package.

## What v0 measures

The fixture suite covers five coding-context categories:

- bug-fix context selection,
- CI/log diagnosis,
- multi-file refactor context,
- JSON-heavy tool output,
- Claude-to-Codex handoff freshness.

For context selection it measures:

- exact UTF-8 bytes in the synthetic full corpus,
- exact UTF-8 bytes selected into context excerpts,
- full-corpus byte reduction,
- required-path recall,
- selected-path precision,
- required evidence-string recall,
- deterministic pack identity independent of source order,
- exact source, excerpt, line-range, and handle integrity.

For handoff it measures:

- no source bodies embedded in context references,
- a fresh handoff validates in the receiver workspace,
- source drift is detected,
- stale exact-context references are detected,
- the transferred handoff checksum remains intact when only the workspace changes.

## Required v0 gates

The committed suite currently requires:

- path recall: **100%**,
- evidence recall: **100%**,
- selected-path precision: **100%**,
- deterministic output: **required**,
- exact integrity: **required**,
- fresh/stale handoff behavior: **required**,
- mean synthetic full-corpus byte reduction: **at least 70%**.

These thresholds are regression gates for the committed synthetic fixtures. They are not claims about arbitrary repositories.

## Truth boundaries

A v0 report says `byteReductionIsNotTokenSavings: true` and explicitly records that provider tokens, end-to-end agent task success, and external competitors were not measured.

Therefore, a passing v0 suite does **not** establish any of the following:

- Claude API token savings,
- OpenAI/Codex token savings,
- Anthropic prompt-cache savings,
- answer-quality equivalence,
- coding-task success-rate improvement,
- latency improvement,
- superiority over Headroom or another product.

Those require additional controlled benchmarks.

## Next benchmark levels

### V1 — real repository selection

Use fixed public repository snapshots and task fixtures with reviewed evidence sets. Record selected bytes, path/evidence recall, retrieval correctness, latency, and repository-scale behavior.

### V2 — provider token accounting

For supported Claude and Codex workflows, record provider-reported input/cache/output usage where available. Keep byte metrics separate from token metrics and distinguish estimated values from measured values.

### V3 — agent task success

Run fixed coding tasks in isolated repository snapshots for Claude Code and Codex both with and without Solve Context. Grade task success from tests and reviewed acceptance criteria rather than model self-evaluation.

### V4 — competitor comparison

Only after comparable configuration and workload controls exist, run Solve Context and competing context systems against the same repositories, agent versions, task fixtures, budgets, and quality gates. Publish methodology and raw results alongside any comparative claim.

## Claim policy

Until V3/V4 evidence exists, describe Solve Context as an engineering target designed to exceed generic compression-only approaches. Do not state that it has been measured to beat Headroom in production.
