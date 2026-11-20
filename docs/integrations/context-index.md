# Solve Context Index: persistent semantic context indexing

Phase 7 adds a persistent index to Solve Context so context packs build
and refresh themselves instead of leaning on a caller-supplied plan on
every request. Onboarding (Phase 3) generates the first context pack for
a repository; the index is what keeps that knowledge alive as the code
changes.

The word "semantic" is the phase's name, and the mechanism is stated
plainly: ranking is **lexical + graph-structure**. A record's lexical
term set and declared identifiers are matched against the task, and the
stored Solve Graph contributes neighborhoods (dependencies, dependents,
tests). There are no embeddings, no vector store, no model calls, and no
network access anywhere in the build, refresh, or query paths.

## The index

`solvelang-context-index build` walks a workspace once — zero-config:
no task string, no caller planning, no allowlist to maintain — and
writes three files under `.solve/` (the directory onboard already uses):

- `context-index.json` — one record per pack-eligible file: workspace
  path, SHA-256 of the source, byte size, repository classification
  (source / test / documentation / configuration / …), a bounded
  lexical term set, the file's declared identifiers (heuristic
  extraction for TypeScript/JavaScript, Python, PHP, Rust, and Go), the
  file's workspace imports projected from the Solve Graph, and an
  oversize flag. The document carries the source revision and
  fingerprint, the graph reference, skip counts, and `indexSha256`, a
  content hash over the index's canonical form. The index contains no
  timestamps and no random ids: it is a pure function of the tree, so
  two builds of the same tree produce the identical index.
- `context-index.graph.json` — the Solve Graph document for the tree,
  produced by the repository's own extraction engines and verified
  against the engine's integrity hash before it is written. The index
  never reimplements graph extraction.
- `context-index.state.json` — a stat cache (size + mtime + hash per
  file) that makes change detection cheap. It is a cache, not part of
  the index's identity; deleting it only costs a re-hash on the next
  refresh.

Sensitive paths (the context machinery's own refusal list — credential
files, private keys, environment files) are **excluded from the index
entirely**: counted in `counts.skippedSensitive`, never named, never
excerpted. Files over the pack machinery's 2 MB source cap are recorded
as oversize (hash and size, no terms) and listed in
`counts.skippedOversize` — listed, never excerpted, never fatal. Binary
content gets no record. Files over 8 MB are tracked by size alone.

## Incremental refresh

`solvelang-context-index refresh` is an explicit operation, not a manual
rebuild:

1. Change detection is by content hash. The stat cache answers first;
   anything whose size or mtime moved is re-hashed and compared — a
   touched-but-identical file is not a change. `--changed a,b,c` can
   name additional paths (for example from a CI checkout) that are
   treated as changed without detection.
2. The affected scope is the changed files plus their graph dependents,
   computed with the graph engine's own impact analysis over the stored
   graph. Records are recomputed only inside that scope; records
   outside it are carried over byte-identically, with their imports
   re-projected from the new graph — if a carried file's edges shifted,
   its record is updated and reported in `edgeShiftedPaths` instead of
   silently going stale.
3. The graph itself is re-extracted with the real extractor on every
   refresh. That is the honest cost of never running a second graph
   engine; the record-level work is what the increment saves. If the
   stored graph is missing or fails verification, the refresh falls
   back to recomputing every record and says so (`impactFallback`).

A refresh that reaches a tree state produces an index **identical** to
a full build of that state — same `indexSha256`, same graph bytes. The
test suite pins this on a fixture monorepo, and the large-repo proof
below confirms it on this repository itself. A refresh with no changes
is a no-op and leaves `context-index.json` byte-identical.

## Query

Two read-only tools on the **local stdio MCP server** (the local
surface is 31 tools; the remote endpoint's 10 tools do not change):

- `solvelang_context_index_query` — given a task string, rank the index
  records (path and term scoring in the pack engine's style, declaration
  identifier overlap as the strongest per-file signal, a one-hop graph
  neighborhood over the stored graph), read only the top candidates,
  **hash-verify each against its record** — a file changed since
  indexing is excluded and reported in `selection.stalePaths` — and
  excerpt the survivors with the existing pack machinery. The result is
  a standard `solvelang.context.pack.v0` pack inside a
  `solvelang.context.index-query.v1` envelope that also reports the
  ranked candidates and their reasons. The workspace is never
  re-walked.
- `solvelang_context_index_status` — presence, provenance (source
  revision and fingerprint), graph hash validity, and record counts.

The CLI exposes the same operations (`status`, `query --task "..."`)
through the same code the MCP tools serve. Exit codes follow the
repository convention: 0 = done, 2 = operational error.

The query loader accepts index and graph files up to 64 MB each. It
deliberately does not route the stored graph through the MCP graph
parser, whose 2 MB cap would refuse exactly the large-repository graphs
the index exists for; instead the loader verifies the graph file
against the SHA-256 recorded in the index (the builder verified the
engine's own integrity hash before writing it).

## Measured on this repository

Build, one-line scratch edit, refresh, and known-answer queries against
a throwaway copy of saiidz/solvelang at `bcf4f4e8` (the scratch edit was
never committed):

| Measure | Result |
| --- | --- |
| Walked files / index records | 1,678 / 1,632 |
| Graph | 1,973 nodes, 6,031 edges, status complete |
| Index size / graph size | 6.65 MB / 4.46 MB |
| Full build | 27.3 s (graph extraction 18.5 s, records 7.2 s) |
| Refresh after a 1-line change | 25.2 s wall, of which record work 0.36 s |
| Records recomputed / carried | 27 / 1,605 |
| Incremental ≡ full | identical `indexSha256` and graph bytes |
| Query "context pack budget bytes" | `packages/mcp-server/src/context-pack.ts` ranked #2, in pack |
| Query "pr gate policy protected paths override label" | `packages/pr-gate/src/policy.ts` ranked #1, in pack |
| Query "bus daemon lease claim ttl sweep" | `packages/mcp-server/src/bus-daemon.ts` ranked #1, in pack |

The refresh wall time is dominated by graph re-extraction (≈20 s),
which is the stated design cost above; the incremental saving is in the
record layer (7.2 s → 0.36 s) and in detection (≈1 s), and it grows with
the share of the tree a change does not touch.

## Limits

- Per-file source cap for terms/declarations/excerpts: 2 MB (the pack
  machinery's cap). Terms per file ≤ 384, declarations ≤ 256.
- Declaration extraction is heuristic (per-language line patterns), not
  a compiler front end; it is a ranking signal, not an API guarantee.
- The graph's own engine limits apply unchanged (for example, the
  ingestion layer retains text only up to 1 MB per file, so a file
  between 1 MB and 2 MB is indexed from its own bytes but contributes
  no graph edges).
- One index per workspace, at `.solve/` by default (`--out` relocates
  it). The index is a build artifact: commit it or rebuild it in CI —
  either works, because it is deterministic.
