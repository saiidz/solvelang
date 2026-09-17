# SolveLang plugin

This is the canonical SolveLang plugin bundle for Codex and Claude.

It packages one shared read-only MCP configuration and workflow-review skill for both ecosystems:

- Codex manifest: `.codex-plugin/plugin.json`
- Claude manifest: `.claude-plugin/plugin.json`
- MCP configuration: `.mcp.json`
- shared skill: `skills/solvelang-workflow-review/SKILL.md`

## Install in Codex

For an eligible managed workspace, import this GitHub marketplace using:

- repository: `https://github.com/saiidz/solvelang`
- import path: repository root / blank
- marketplace manifest: `.agents/plugins/marketplace.json`
- plugin: `solvelang`

After the workspace administrator imports the marketplace, install **SolveLang** in Codex and start a fresh session. The plugin's `.mcp.json` launches the public `@solvelang/mcp-server@0.3.0` package through `npx`.

Workspace import is an administrator-controlled Codex action and is separate from global public Plugin Directory publication.

## Distribution truth

SolveLang MCP v0.3.0 is the current checked-in and released package line. The canonical plugin pin is:

`@solvelang/mcp-server@0.3.0`

The v0.3.0 GitHub release triggered the repository's trusted npm publication workflow. That workflow checked out the released commit, verified the tag/package version, ran MCP tests, verified a packed clean-consumer install and `npx` entrypoint, and completed the public-package publish step successfully.

A successful npm publication does not by itself prove that a particular Codex managed workspace has imported or installed the plugin. Record workspace install/search/use evidence separately after an administrator performs the import.

See [`../../docs/integrations/mcp-codex-claude.md`](../../docs/integrations/mcp-codex-claude.md) for integration details.

## Authority boundary

The local MCP tools are deterministic/read-only analysis and context surfaces unless a separately reviewed feature says otherwise. Installing the plugin does not imply production execution, repository write authority, credential access/verification, live external API/provider calls, billing changes or infrastructure mutation.

A hosted remote MCP endpoint is a separate deployment/authentication/privacy boundary and is not implied by installing this local plugin.
