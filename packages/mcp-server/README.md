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
- `solvelang_graph_dependencies` — traverses outbound dependency relationships from stable Solve Graph node IDs.
- `solvelang_graph_dependents` — traverses inbound dependency relationships from stable Solve Graph node IDs.
- `solvelang_graph_impact` — computes bounded transitive impact for changed nodes while excluding containment-only noise by default.
- `solvelang_capabilities` — reports limits, privacy boundaries, input modes, and available tools.

For n8n analysis and reports, provide exactly one of:

- `path`: a workspace-relative JSON file; or
- `rawJson`: an n8n export supplied directly to the MCP tool.

Raw JSON is bounded before parsing, processed only in memory, never written to disk, never logged, and never sent over the network. JSON reports include a stable schema identifier, deterministic finding order, severity counts, score, and a `pass` boolean suitable for CI policy decisions.

For Solve Graph tools, provide exactly one of:

- `path`: a workspace-relative canonical `solvelang.graph.v0` JSON document; or
- `rawJson`: canonical graph JSON supplied directly to the MCP tool.

Solve Graph input is accepted only when it is analyze-only, declares `networkAccess=false` and `writeAccess=false`, has stable canonical node/edge IDs, and passes its SHA-256 integrity check. The MCP transport returns only bounded node summaries and traversal evidence; it never executes repository code or mutates the graph or workspace. The MCP-facing tool names use underscore-safe identifiers, while responses preserve the Solve Graph tool API names (`solve_graph.find_nodes`, `solve_graph.dependencies`, `solve_graph.dependents`, and `solve_graph.impact`) for deterministic downstream handling.

## Security boundaries

- Workspace-relative paths only; traversal outside the configured root is rejected.
- Maximum input size: 2 MB for files and raw JSON, including Solve Graph documents.
- Maximum n8n node count: 5,000.
- Solve Graph traversal roots: at most 128; depth: at most 64; result count: at most 10,000.
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
