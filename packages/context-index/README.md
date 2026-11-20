# SolveLang Context Index (`@solvelang/context-index`)

Zero-config persistent semantic context indexing for large
repositories (Phase 7). One walk builds a content-hashed index of the
workspace — files, classifications, declared identifiers, lexical
terms, and Solve Graph edges — under `.solve/`; later operations read
the index instead of re-walking the repo.

"Semantic" is the phase's name; the mechanism is lexical +
graph-structure, stated plainly: term and identifier matching plus
Solve Graph neighborhoods. No embeddings, no model calls, no network.

## CLI

```
solvelang-context-index build   [root] [--out <dir>]
solvelang-context-index refresh [root] [--out <dir>] [--changed a,b,c]
solvelang-context-index status  [root] [--out <dir>]
solvelang-context-index query   [root] --task "..." [--budget-bytes <n>]
```

- **build** — one zero-config walk (no task string, no caller
  planning). Writes `context-index.json` (records + `indexSha256`),
  `context-index.graph.json` (the engines' own graph document,
  integrity-verified), and `context-index.state.json` (a stat cache).
  Sensitive paths are excluded entirely; files over the pack
  machinery's 2 MB cap are recorded as oversize and listed, never
  excerpted.
- **refresh** — incremental: content-hash change detection, affected
  scope = changed files + graph dependents, untouched records carried
  byte-identically. A refresh reaching a tree state produces an index
  identical to a full build of that state (pinned in tests and proven
  on saiidz/solvelang itself). A no-change refresh is a no-op.
- **status / query** — run the MCP server's own query core, so the CLI
  answers identically to the local MCP tools
  `solvelang_context_index_status` / `solvelang_context_index_query`.

Exit codes: 0 = done, 2 = operational error.

Full documentation: `docs/integrations/context-index.md` in the
repository (design, refresh semantics, query ranking, limits, and the
measured large-repo proof).
