# SolveLang MCP Server

Local-first, read-only workflow and Solve Graph analysis for MCP clients such as Codex and Claude Code.

## Run with npx

Node.js 20 or newer is required. Point the server at the local workspace its tools may read:

```bash
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/project \
  npx --yes @solvelang/mcp-server
```

No global install or SolveLang repository clone is required. For `.solve` validation, make `solvec` available on `PATH` or set `SOLVELANG_SOLVEC` to its executable. The n8n and Solve Graph tools do not require `solvec`.

## Tools

- `solvelang_analyze_n8n` — deterministic structural scan from either a workspace-relative n8n JSON file or raw JSON supplied directly.
- `solvelang_validate_solve` — validates a `.solve` file through the local `solvec` executable.
- `solvelang_generate_n8n_report` — returns Markdown or CI-friendly JSON evidence without writing files.
- `solvelang_graph_find_nodes` — searches a canonical Solve Graph by node kind, text, or exact evidence path.
- `solvelang_graph_search_nodes` — ranks bounded node matches by deterministic label, identity, evidence-path, and string-metadata evidence.
- `solvelang_graph_dependencies` — traverses outbound dependency relationships from stable Solve Graph node IDs.
- `solvelang_graph_dependents` — traverses inbound dependency relationships from stable Solve Graph node IDs.
- `solvelang_graph_shortest_path` — finds one deterministic bounded shortest dependency or dependent path between stable node IDs and returns safe node summaries plus relationship/traversal hops.
- `solvelang_graph_explain_shortest_path` — runs the same bounded shortest-path query and returns a deterministic human-readable explanation with explicit complete-versus-partial search truth.
- `solvelang_graph_alternative_paths` — enumerates bounded deterministic simple dependency or dependent paths between stable node IDs.
- `solvelang_graph_explain_alternative_paths` — runs the bounded alternative-path query and returns deterministic path explanations with explicit depth, path-count, and traversal-state truncation truth.
- `solvelang_graph_impact` — computes bounded transitive impact for changed nodes while excluding containment-only noise by default.
- `solvelang_capabilities` — reports limits, privacy boundaries, input modes, and available tools.

For n8n analysis and reports, provide exactly one of:

- `path`: a workspace-relative JSON file; or
- `rawJson`: an n8n export supplied directly to the MCP tool.

Raw JSON is bounded before parsing, processed only in memory, never written to disk, never logged, and never sent over the network. JSON reports include a stable schema identifier, deterministic finding order, severity counts, score, and a `pass` boolean suitable for CI policy decisions.

For Solve Graph tools, provide exactly one of:

- `path`: a workspace-relative canonical `solvelang.graph.v0` JSON document; or
- `rawJson`: canonical graph JSON supplied directly to the MCP tool.

Solve Graph input is accepted only when it is analyze-only, declares `networkAccess=false` and `writeAccess=false`, has stable canonical node/edge IDs, and passes its SHA-256 integrity check. The MCP transport returns only bounded node summaries and traversal evidence; it never executes repository code or mutates the graph or workspace. The MCP-facing tool names use underscore-safe identifiers, while responses preserve deterministic Solve Graph query contracts and explicit explanation schemas for downstream handling.

Shortest-path queries are breadth-first and deterministic. They can be limited by edge kind, direction, depth, and visited-node count. A no-path response distinguishes complete absence from a bounded search that stopped at a depth or visited-node boundary. For dependent-direction paths, each hop reports both the underlying graph-edge orientation and the traversal orientation so callers do not have to infer reversal semantics.

The shortest-path explanation tool reuses that exact bounded implementation and then applies the reviewed explanation contract. Found paths become ordered safe structural steps; complete no-path searches state absence only within the configured graph scope; bounded searches explicitly state that absence is not proven. Explanation output remains analyze-only with network and write access fixed to false.

Alternative-path queries enumerate deterministic simple paths and are bounded independently by depth, returned path count, and traversal-state count. The alternative-path explanation tool reuses that exact query contract. It distinguishes a complete result set from bounded partial evidence, reports when additional paths may exist, preserves dependency-versus-dependent edge orientation, and returns only safe structural node summaries. Its schema is `solvelang.mcp.solve-graph.alternative-paths-explanation.v0`.

## Security boundaries

- Workspace-relative paths only; traversal outside the configured root is rejected.
- Maximum input size: 2 MB for files and raw JSON, including Solve Graph documents.
- Maximum n8n node count: 5,000.
- Solve Graph traversal roots: at most 128; dependency/dependent and shortest-path depth: at most 64; alternative-path depth: at most 32; alternative paths: at most 32; traversal/result/state limits: at most 10,000 where applicable.
- No workflow execution, repository execution, network requests, file writes, or credential-value inspection.
- Solve Graph integrity, stable IDs, endpoints, schema, and read-only execution flags are verified before queries run.
- Malformed input errors do not echo supplied workflow or graph content.
- The stdio server writes protocol messages only to stdout and diagnostics only to stderr.

## Build

```bash
cd packages/mcp-server
npm ci
npm test
npm run test:packed
```

## Run from a source checkout

```bash
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/project node dist/src/index.js
```

For `.solve` validation, build `solvec` or provide its path:

```bash
SOLVELANG_SOLVEC=/absolute/path/to/solvec node dist/src/index.js
```

Use the templates under `plugins/codex` and `plugins/claude` to connect supported clients.

## Releases

`@solvelang/mcp-server@0.1.0` is publicly available on npm. The raw-JSON, CI-report, and Solve Graph changes are later-version readiness work; this branch intentionally does not change the package version or publish a release.

Trusted Publishing is the required release path. The release workflow runs only for a published GitHub Release, requires the protected `npm-production` environment and `NPM_SCOPE_OWNERSHIP_VERIFIED=true`, checks that the `v<version>` tag matches this manifest, reruns the unit and packed-install tests, and publishes with npm's GitHub Actions identity. Do not add an npm access token or create a tag or release outside the approved release process.
