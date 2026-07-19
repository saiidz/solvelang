# SolveLang for Codex and Claude

SolveLang ships one local-first MCP server and thin client-specific guidance.

## Build

```bash
cd packages/mcp-server
npm install
npm test
```

## Codex

1. Copy `plugins/codex/config.toml.example` into the appropriate Codex configuration and replace absolute paths.
2. Install or import `plugins/codex/skills/solvelang-workflow-review/SKILL.md` as a reusable skill.
3. Restart Codex and confirm the four `solvelang_*` tools are available.

Suggested prompt:

```text
Use SolveLang to review workflows/order-routing.json. Report critical and high findings first, then generate a Markdown preflight report.
```

## Claude Code

Either copy `plugins/claude/.mcp.json.example` to `.mcp.json` and replace absolute paths, or register the same command through `claude mcp`.

Copy the guidance in `plugins/claude/CLAUDE.md` into the project when durable workflow-review behavior is desired.

Suggested prompt:

```text
Analyze workflows/order-routing.json with the SolveLang MCP tools. Do not claim runtime execution or credential verification.
```

## Local-only v1

This release uses stdio and is designed for local coding agents. A future authenticated Streamable HTTP service can reuse the same tool contracts after remote auth, retention, rate limiting, and privacy controls are implemented.
