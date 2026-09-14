# Solve Context: changed-file and graph-aware selection

The existing `solvelang_context_plan` and `solvelang_context_pack` tools accept optional `changedPaths` and `graphPath`. This is local deterministic ranking, not a provider proxy or an autonomous repository agent. No Git command, source execution, network request, credential lookup, or repository mutation is performed.

```json
{
  "task": "investigate the checkout regression",
  "changedPaths": ["src/checkout.ts"],
  "graphPath": "artifacts/solve-graph.json",
  "budgetBytes": 8192
}
```

The graph must be an existing `solvelang.graph.v0` analyze-only snapshot accepted by the shared integrity/stable-ID parser. `graphPath` requires a nonempty explicit `changedPaths` list. A caller can supply changed paths without a graph. Without either option, the existing lexical behavior and pack identity remain unchanged.

## Selection and provenance

Changed paths receive a deterministic priority score of 128. Matching graph node `metadata.path` values seed a **single hop** over `imports`, `references`, `calls`, `tests`, and `depends-on`. Direct dependencies receive 64, direct dependents 48, and incoming `tests` relationships 96. These are ranking heuristics, not measured relevance or runtime-reachability claims. Multiple relationships use the highest score with a deterministic witness tie-break.

Selection happens before the discovery source-read cap and then contributes to the existing excerpt scoring. Sources without lexical matches contribute only their bounded opening window. Source text is never replaced with a generated summary. The original task hash, source/excerpt hashes, content-addressed retrieval handles, and UTF-8 excerpt budget remain intact. Graph-selected entries include a structural edge witness and the graph-file SHA-256 in their reasons.

`workspace.selection` reports the changed paths, prioritized-path count, unmatched graph roots, independent root/path truncation, and skipped unsafe graph-path count. Its graph evidence records the exact file hash, graph ID, one-hop limit, and `workspaceFreshness: "not-verified"`. Integrity detects artifact changes; it does **not** authenticate the graph author or prove that the graph still represents the current workspace. Regenerate the graph for current relationships. Retrieved source excerpts independently reject changed source hashes.

## Privacy and bounds

- At most 128 caller-supplied changed paths, 128 graph roots, and 512 retained path priorities; graph reads retain the existing 2 MiB bound.
- Graph paths and node metadata do not grant file-access authority. Sensitive-path checks, bounded discovery, vendor/build exclusions, and the existing symlink/workspace-confinement reader still apply.
- An explicit `paths` list remains a closed source allowlist. A graph may affect ranking inside it but does not add source reads outside it; reading the explicitly requested graph is separate.
- Graph truncation, workspace-discovery truncation, and excerpt-budget truncation are separate. One-hop evidence is not a whole-program coverage claim.

The synthetic tests exercise graph integrity, determinism, one-hop selection, bounds, sensitive paths, symlinks, explicit allowlists, stale retrieval, discovery ordering, and the shared MCP argument wiring. Existing MCP CI also runs the package tests, context evaluation harness, packed-consumer checks, and Claude/Codex protocol roundtrip. Real agent task quality, token savings, and cache behavior remain unmeasured here. This change does not publish a package, alter public installation pins, enable paid features or providers, or grant Solve Runners/Solblend authority.
