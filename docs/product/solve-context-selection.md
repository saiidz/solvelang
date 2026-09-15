# Solve Context: changed-file and graph-aware selection

Status reconciled through the selector/evaluation work in #913, #915, #916 and #918.

`solvelang_context_plan` and `solvelang_context_pack` accept optional `changedPaths` and `graphPath`. This is local deterministic ranking, not a provider proxy or autonomous repository agent. No Git command, source execution, network request, credential lookup or repository mutation is performed.

```json
{
  "task": "investigate the checkout regression",
  "changedPaths": ["src/checkout.ts"],
  "graphPath": "artifacts/solve-graph.json",
  "budgetBytes": 8192
}
```

The graph must be an existing `solvelang.graph.v0` analyze-only snapshot accepted by the shared integrity/stable-ID parser. `graphPath` requires a nonempty explicit `changedPaths` list. A caller can supply changed paths without a graph. Without either option, lexical discovery remains available.

## Selection and provenance

Changed paths receive deterministic priority before the discovery source-read cap. Matching graph node `metadata.path` values seed a **single hop** over reviewed structural relationship kinds such as imports/references/calls/tests/depends-on. Relationship evidence contributes deterministic ranking reasons; those scores are heuristics, not measured relevance or runtime-reachability claims.

Selection now combines several exact-source strategies:

- lexical task/path/source matches expand to bounded line windows;
- explicit changed paths can remain relevant even without a lexical match;
- one-hop graph-selected dependency/dependent/test neighbors can contribute bounded relationship evidence;
- when a graph-selected neighbor would otherwise contribute only a shallow header, exported function/class declaration text can anchor a bounded exact window;
- after independent external-source regressions, graph-selected neighbors with lexical/JSDoc hits can expand into bounded exported function/class/`const`/`let`/`var` declaration windows, including reviewed leading comment/JSDoc context;
- when a relevant matching window is larger than the complete or remaining byte budget, the selector may retain a bounded whole-line exact fragment instead of yielding an empty pack;
- candidate fragments are globally re-ranked by their actual score, with deterministic tie behavior that prefers distinct task evidence where scores are equal.

These are textual/local selection rules, not semantic parsing claims. No selected source is replaced by a generated summary.

The original task hash, source/excerpt hashes, content-addressed retrieval handles, exact coordinates and UTF-8 budget truth remain intact. Required-evidence regression fixtures were not weakened to make the newer selector behavior pass.

## Graph freshness truth

`workspace.selection` reports changed paths, prioritized-path count, unmatched graph roots, independent root/path truncation and skipped unsafe graph-path count. Graph evidence records the exact file hash, graph ID, one-hop bound and `workspaceFreshness: "not-verified"`.

Integrity detects graph-artifact changes; it does **not** authenticate the graph author or prove that the graph represents the current workspace. Regenerate the graph when current structural relationships are required. Retrieved source excerpts independently reject changed source hashes.

## Privacy and bounds

- Caller changed paths, graph roots, retained priorities and graph bytes remain bounded by the implementation schemas/contracts.
- Graph paths and node metadata do not grant file-access authority. Sensitive-path checks, bounded discovery, vendor/build exclusions and symlink/workspace confinement still apply.
- An explicit `paths` list remains a closed source allowlist. Graph evidence can rank within it but cannot silently add arbitrary source reads outside it; reading the explicitly requested graph is separate.
- Graph truncation, workspace-discovery truncation and excerpt-budget truncation remain separate truth fields.
- One-hop structural evidence is not a whole-program coverage claim.

## Evaluation evidence

Selection behavior is exercised by:

- synthetic determinism/integrity/bounds/privacy tests;
- a pinned first-party SolveLang source subset with manually authored evidence expectations;
- independent pinned Chalk/node-fetch source subsets with equal-byte lexical/changed-path/graph-assisted comparisons;
- package/plugin/packed-consumer MCP CI.

Those suites exposed the declaration-window, budget-fragment and graph-neighbor selection gaps described above. They prove regression behavior on reviewed snapshots, not real Claude/Codex task success or provider-token/cache savings.

## Claim boundary

Real agent quality, provider tokens, end-to-end latency and cache behavior remain separate measurements under the #898 agent-record contract. This selector work does not publish a package, alter the historical v0.2.0 public installation pin, enable paid/provider features or grant Solve Runners/Solblend authority.
