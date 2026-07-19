# SolveLang for Codex and Claude

SolveLang ships one local-first MCP server and thin client-specific guidance.

## Prerequisite

Install Node.js 20 or newer. The published package runs through `npx`; a global install and SolveLang source checkout are not required.

## Codex

1. Add the following to Codex configuration, replacing the workspace path:

   ```toml
   [mcp_servers.solvelang]
   command = "npx"
   args = ["--yes", "@solvelang/mcp-server"]

   [mcp_servers.solvelang.env]
   SOLVELANG_WORKSPACE_ROOT = "/absolute/path/to/workspace"
   # Optional, needed only for solvelang_validate_solve:
   # SOLVELANG_SOLVEC = "/absolute/path/to/solvec"
   ```

2. Restart Codex and call `solvelang_capabilities` to confirm the four `solvelang_*` tools are available.
3. Install or import `plugins/codex/skills/solvelang-workflow-review/SKILL.md` as a reusable skill.

Suggested prompt:

```text
Use SolveLang to review workflows/order-routing.json. Report critical and high findings first, then generate a Markdown preflight report.
```

## Claude Code

Register the server from the target project directory:

```bash
claude mcp add --transport stdio \
  --env SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/workspace \
  solvelang -- npx --yes @solvelang/mcp-server
```

Or copy `plugins/claude/.mcp.json.example` to `.mcp.json` and replace the workspace path. Add `SOLVELANG_SOLVEC` only when `.solve` validation is needed.

Copy the guidance in `plugins/claude/CLAUDE.md` into the project when durable workflow-review behavior is desired.

Suggested prompt:

```text
Analyze workflows/order-routing.json with the SolveLang MCP tools. Do not claim runtime execution or credential verification.
```

## Local-only v1

This release uses stdio and is designed for local coding agents. A future authenticated Streamable HTTP service can reuse the same tool contracts after remote auth, retention, rate limiting, and privacy controls are implemented.

## Source checkout and package verification

Contributors can verify the same artifact consumers install:

```bash
cd packages/mcp-server
npm ci
npm test
npm run test:packed
```

`test:packed` builds an npm tarball, checks its exact allowlist, installs it into a clean temporary consumer, and starts the installed `solvelang-mcp` executable with `npx --no-install`. It does not publish the tarball or execute a workflow.

## Release prerequisite

As of July 19, 2026, the public registry returned `E404` for `@solvelang/mcp-server` and this development machine had no authenticated npm session, so ownership of `@solvelang` was not verified. Publishing remains disabled through the `NPM_SCOPE_OWNERSHIP_VERIFIED` repository-variable gate. Before any GitHub Release is created, follow the ownership, protected-environment, trusted-publishing, and optional bootstrap-token checklist in `packages/mcp-server/README.md`.
