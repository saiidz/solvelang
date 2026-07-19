# SolveLang MCP Server

Local-first, read-only workflow analysis for MCP clients such as Codex and Claude Code.

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
npm install
npm test
```

## Run

```bash
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/project node dist/src/index.js
```

For `.solve` validation, build `solvec` or provide its path:

```bash
SOLVELANG_SOLVEC=/absolute/path/to/solvec node dist/src/index.js
```

Use the templates under `plugins/codex` and `plugins/claude` to connect supported clients.
