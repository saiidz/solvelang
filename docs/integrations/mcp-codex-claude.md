# SolveLang for Codex and Claude

SolveLang ships a canonical cross-platform plugin bundle backed by the published local-first MCP server.

The maintained plugin root is `plugins/solvelang/` and contains both Codex and Claude manifests, one shared MCP configuration, and the SolveLang workflow-review skill. Legacy setup examples under `plugins/codex/` and `plugins/claude/` remain useful for manual configuration, but new installs should prefer the canonical plugin.

## Prerequisite

Install Node.js 20 or newer. The local plugin runs the published `@solvelang/mcp-server@0.2.0` package through `npx`; a global install and SolveLang source checkout are not required.

## Codex plugin

The repository contains a Codex marketplace at `.agents/plugins/marketplace.json` and a valid plugin manifest at `plugins/solvelang/.codex-plugin/plugin.json`.

Add the SolveLang repository as a Codex marketplace:

```bash
codex plugin marketplace add saiidz/solvelang --ref main
```

Then install the plugin:

```bash
codex plugin add solvelang@solvelang
```

The installed plugin provides the SolveLang MCP server plus the `solvelang-workflow-review` skill. Start a new Codex thread after installation or upgrade so the plugin surfaces are loaded cleanly.

Suggested prompt:

```text
Use SolveLang to review workflows/order-routing.json. Report critical and high findings first, then generate a Markdown preflight report.
```

### Manual Codex MCP configuration

For clients that do not use plugin marketplaces, add the following to Codex configuration, replacing the workspace path:

```toml
[mcp_servers.solvelang]
command = "npx"
args = ["--yes", "@solvelang/mcp-server@0.2.0"]

[mcp_servers.solvelang.env]
SOLVELANG_WORKSPACE_ROOT = "/absolute/path/to/workspace"
# Optional, needed only for solvelang_validate_solve:
# SOLVELANG_SOLVEC = "/absolute/path/to/solvec"
```

Restart Codex and call `solvelang_capabilities` to confirm the SolveLang tools are available.

## Claude plugin

The repository also contains a Claude-compatible marketplace at `.claude-plugin/marketplace.json` and a plugin manifest at `plugins/solvelang/.claude-plugin/plugin.json`.

In Claude Code, add the marketplace:

```text
/plugin marketplace add saiidz/solvelang
```

Install SolveLang:

```text
/plugin install solvelang@solvelang
```

Reload plugins or begin a new Claude Code session after installation.

Suggested prompt:

```text
Analyze workflows/order-routing.json with the SolveLang MCP tools. Do not claim runtime execution or credential verification.
```

### Manual Claude Code MCP configuration

Register the server from the target project directory:

```bash
claude mcp add --transport stdio \
  --env SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/workspace \
  solvelang -- npx --yes @solvelang/mcp-server@0.2.0
```

The older `plugins/claude/.mcp.json.example` remains available for projects that want explicit project-local MCP configuration.

## Local plugin authority

The packaged plugin uses stdio and is designed for local coding-agent sessions. The MCP tools are read-only analysis surfaces. Installing the plugin does not authorize repository writes, production execution, credential access, external API calls, billing changes, or infrastructure mutation.

Workspace-path tools remain bounded to the configured workspace. Raw JSON workflow and Solve Graph inputs remain the preferred portable inputs where no local file access is needed.

## Hosted Claude/API and cloud-app lane

Claude's server-side MCP connector cannot directly connect to a local stdio process. A future public SolveLang cloud integration therefore requires an authenticated HTTPS MCP endpoint using Streamable HTTP, with a deliberately reduced remote tool surface and explicit auth, rate limits, request-size bounds, retention/deletion rules, privacy controls, and deployment approval.

That hosted endpoint is a separate security and production boundary. The local Codex/Claude plugin manifests do not claim that it is live.

## Source checkout and package verification

Contributors can verify the same package and protocol boundary referenced by both plugin manifests:

```bash
cd packages/mcp-server
npm ci
npm test
npm run test:plugin-roundtrip
npm run test:packed
```

`test:plugin-roundtrip` first exact-checks the Codex and Claude manifests against the same pinned MCP package version, then packs and installs the current MCP package into a clean temporary consumer, performs a real MCP stdio initialization/list-tools roundtrip against that installed artifact, verifies representative tools remain read-only/non-destructive, and calls `solvelang_analyze_n8n` with an in-memory fixture. It does not publish a package, install through the external Codex or Claude marketplace clients, execute a workflow, access credentials, or mutate a repository.

`test:packed` independently builds an npm tarball, checks its exact allowlist, installs it into a clean temporary consumer, and starts the installed `solvelang-mcp` executable with `npx --no-install`. It does not publish the tarball or execute a workflow.

Passing repository CI therefore proves the shared plugin manifest/package/protocol contract. A real marketplace-client installation remains a separate release/distribution proof and must not be inferred from repository CI alone.

## Releases

SolveLang MCP Server v0.2.0 is the current repository release line for this plugin bundle. Publishing remains restricted to the protected npm release workflow and its existing validation gates; plugin packaging does not grant publication authority.
