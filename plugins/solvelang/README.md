# SolveLang plugin

This is the canonical SolveLang plugin bundle for Codex and Claude.

It packages one shared read-only MCP configuration and workflow-review skill for both ecosystems:

- Codex manifest: `.codex-plugin/plugin.json`
- Claude manifest: `.claude-plugin/plugin.json`
- MCP configuration: `.mcp.json`
- shared skill: `skills/solvelang-workflow-review/SKILL.md`

## Distribution truth

The checked-in plugin launches the published `@solvelang/mcp-server@0.3.0` package through `npx`. The package, Codex manifest, Claude manifest, and shared MCP pin are version-aligned at v0.3.0.

For public OpenAI directory publication, the local `npx` transport is not sufficient by itself. The public listing must submit the separately deployed HTTPS remote MCP endpoint through OpenAI's **With MCP** review flow. The local bundle remains useful for Codex/Claude local development and package qualification.

## Authority boundary

The local MCP tools are deterministic/read-only analysis and context surfaces unless a separately reviewed feature says otherwise. Installing the plugin does not imply production execution, repository write authority, credential access/verification, live external API/provider calls, billing changes or infrastructure mutation.

A hosted remote MCP endpoint is a separate deployment/authentication/privacy boundary and is not implied by installing this local plugin.
