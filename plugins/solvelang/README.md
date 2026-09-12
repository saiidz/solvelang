# SolveLang plugin

This is the canonical SolveLang plugin bundle for Codex and Claude.

It packages the same read-only SolveLang MCP server and workflow-review skill for both ecosystems:

- Codex manifest: `.codex-plugin/plugin.json`
- Claude manifest: `.claude-plugin/plugin.json`
- MCP configuration: `.mcp.json`
- shared skill: `skills/solvelang-workflow-review/SKILL.md`

The local plugin launches the published `@solvelang/mcp-server@0.2.0` package through `npx`. The MCP tools are deterministic analysis surfaces; they do not imply production execution, credential verification, external API testing, or write authority.

A hosted remote MCP endpoint is a separate deployment/authentication boundary and is not implied by installing this local plugin.
