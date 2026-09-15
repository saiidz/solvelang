# SolveLang plugin

This is the canonical SolveLang plugin bundle for Codex and Claude.

It packages one shared read-only MCP configuration and workflow-review skill for both ecosystems:

- Codex manifest: `.codex-plugin/plugin.json`
- Claude manifest: `.claude-plugin/plugin.json`
- MCP configuration: `.mcp.json`
- shared skill: `skills/solvelang-workflow-review/SKILL.md`

## Distribution truth

The checked-in plugin currently launches the published `@solvelang/mcp-server@0.2.0` package through `npx`. That is the latest published MCP release (2026-07-20), but it **predates substantial current-main MCP/Solve Context work through #920**.

Therefore:

- installing this plugin with its current `.mcp.json` pin uses the historical published v0.2.0 package;
- do not claim that the installed v0.2.0 plugin exposes every tool/capability present on current `main`;
- call capabilities/list-tools to inspect what the installed package actually provides;
- use a source checkout of `packages/mcp-server` when evaluating current-main Solve Context behavior;
- a future versioned MCP/plugin release is required before current-main capabilities are publicly distributed through this pin.

See [`../../docs/integrations/mcp-codex-claude.md`](../../docs/integrations/mcp-codex-claude.md) for published-vs-source usage instructions.

## Authority boundary

The local MCP tools are deterministic/read-only analysis and context surfaces unless a separately reviewed feature says otherwise. Installing the plugin does not imply production execution, repository write authority, credential access/verification, live external API/provider calls, billing changes or infrastructure mutation.

A hosted remote MCP endpoint is a separate deployment/authentication/privacy boundary and is not implied by installing this local plugin.
