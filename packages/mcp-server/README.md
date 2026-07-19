# SolveLang MCP Server

Local-first, read-only workflow analysis for MCP clients such as Codex and Claude Code.

## Run with npx

Node.js 20 or newer is required. Point the server at the local workspace its tools may read:

```bash
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/project \
  npx --yes @solvelang/mcp-server
```

No global install or SolveLang repository clone is required. For `.solve` validation, make `solvec` available on `PATH` or set `SOLVELANG_SOLVEC` to its executable. The n8n tools do not require `solvec`.

## Tools

- `solvelang_analyze_n8n` — deterministic structural scan of an n8n JSON export.
- `solvelang_validate_solve` — validates a `.solve` file through the local `solvec` executable.
- `solvelang_generate_n8n_report` — returns Markdown or JSON evidence without writing files.
- `solvelang_capabilities` — reports limits, privacy boundaries, and available tools.

## Security boundaries

- Workspace-relative paths only; traversal outside the configured root is rejected.
- Maximum file size: 2 MB.
- Maximum n8n node count: 5,000.
- No workflow execution, network requests, file writes, or credential-value inspection.
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

`@solvelang/mcp-server@0.1.0` is publicly available on npm.

Trusted Publishing is the required release path. The release workflow runs only for a published GitHub Release, requires the protected `npm-production` environment and `NPM_SCOPE_OWNERSHIP_VERIFIED=true`, checks that the `v<version>` tag matches this manifest, reruns the unit and packed-install tests, and publishes with npm's GitHub Actions identity. Do not add an npm access token or create a tag or release outside the approved release process.
