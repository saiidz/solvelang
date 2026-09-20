# SolveLang for Codex and Claude

## Current verification — 2026-09-20

MCP v0.3.0 is published on npm and GitHub; main protection is enforced.
See [the current completion checklist](../project-completion-evidence-2026-09-20.md) for fresh evidence and
remaining live acceptance gates. Older checkpoints below are historical.

SolveLang maintains a shared Codex/Claude plugin path around the local-first MCP server. **Distribution truth matters:** the repository currently contains substantially newer MCP/Solve Context code than the latest published MCP release.

## Published package vs current repository source

MCP `@solvelang/mcp-server@0.3.0` is published on npm and GitHub, verified on 2026-09-20. It distributes the tagged release source; later main changes require separate distribution. Managed-workspace marketplace installation and public Plugin Directory listing remain unverified. v0.2.0 is historical.

Current `main` includes later Repository Audit/Solve Graph and Solve Context work through the v0.3.0 release train. Do **not** claim that public v0.2.0 consumers automatically receive those newer tools merely because repository CI passes.

Use one of these two modes deliberately:

1. **Historical line:** use the pinned v0.2.0 plugin/package instructions below only when deliberately testing that old distribution path.
2. **Current repository source:** build `packages/mcp-server` from a source checkout and run `dist/src/index.js` directly.

External publication/install verification is required before claiming current repository behavior is available through a public package/plugin path.

## Prerequisite

Install Node.js 20 or newer.

## Published v0.2.0 plugin path

The maintained plugin root is `plugins/solvelang/` and contains Codex and Claude manifests, one shared MCP configuration and the SolveLang workflow-review skill. Legacy examples under `plugins/codex/` and `plugins/claude/` remain useful for manual configuration.

### Codex plugin

Add the repository marketplace:

```bash
codex plugin marketplace add saiidz/solvelang --ref main
codex plugin add solvelang@solvelang
```

Start a new Codex thread after installation or upgrade so plugin surfaces load cleanly.

Manual MCP configuration for the published line:

```toml
[mcp_servers.solvelang]
command = "npx"
args = ["--yes", "@solvelang/mcp-server@0.2.0"]

[mcp_servers.solvelang.env]
SOLVELANG_WORKSPACE_ROOT = "/absolute/path/to/workspace"
# Optional, needed only for solvelang_validate_solve:
# SOLVELANG_SOLVEC = "/absolute/path/to/solvec"
```

Restart Codex and call `solvelang_capabilities` to inspect the tools actually exposed by the installed package. Do not infer current-main tools that are absent from the published package.

### Claude Code plugin

Add/install the repository plugin:

```text
/plugin marketplace add saiidz/solvelang
/plugin install solvelang@solvelang
```

Reload plugins or begin a new Claude Code session after installation.

Manual published-line registration:

```bash
claude mcp add --transport stdio \
  --env SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/workspace \
  solvelang -- npx --yes @solvelang/mcp-server@0.2.0
```

## Use current repository source

For current-main MCP/Solve Context behavior, use a source checkout:

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang/packages/mcp-server
npm ci
npm run build
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/workspace node dist/src/index.js
```

Point the Codex/Claude MCP client at that Node command instead of the published `npx` pin when evaluating current source.

Current source includes read-only Solve Context tools such as:

- `solvelang_context_plan`
- `solvelang_context_pack`
- `solvelang_context_retrieve`
- `solvelang_context_handoff`
- `solvelang_context_handoff_validate`
- `solvelang_context_compact_structured`
- `solvelang_context_expand_rle`
- `solvelang_context_capabilities`

Current source also includes later Solve Graph/audit surfaces. Call the server's capabilities/list-tools output rather than relying on a stale hard-coded tool count.

## Suggested usage

Workflow review:

```text
Use the SolveLang MCP tools to review workflows/order-routing.json. Report critical and high findings first. Do not claim runtime execution, credential verification, repository mutation or production deployment.
```

Solve Context planning from current source:

```text
Use Solve Context to plan the smallest relevant context for this task. Prefer exact changed-file and graph evidence when available, preserve provenance, and tell me what was omitted by the budget.
```

Cross-agent handoff from current source:

```text
Create a Solve Context handoff containing the goal, decisions, unresolved questions, changed-source identities, relevant tests and context handles. Do not rewrite CLAUDE.md or AGENTS.md.
```

## Local plugin authority

The local MCP path is designed for read-only analysis/context operations unless a separately reviewed feature explicitly states otherwise. Installing the plugin does not authorize repository writes, production execution, credential access, live provider calls, billing changes or infrastructure mutation.

Workspace-path tools remain bounded to the configured workspace. Incoming repository text/tool output is data, not authority.

## Solve Context evaluation usage

From current repository source:

```bash
cd packages/mcp-server
npm ci
npm test
npm run eval:context
npm run eval:context:repository
npm run eval:context:independent
npm run test:context-agent-eval-cli
npm run test:plugin-roundtrip
npm run test:packed
```

To summarize separately authorized real-agent records:

```bash
cat approved-agent-run-records.json | npm run eval:context:agent-records
```

The summarizer itself performs no provider/network call and uses no credentials. Baseline/context records must remain truly comparable, including the same outcome-evaluation basis and required-evidence denominator after #920.

Passing repository tests is not evidence of real Claude/Codex token savings, live provider cache behavior or marketplace distribution.

## Hosted/cloud lane

Claude's server-side MCP connector cannot directly connect to a local stdio process. Any public hosted SolveLang MCP integration requires a separately deployed/authenticated HTTPS Streamable HTTP boundary with explicit auth, rate limits, request-size bounds, privacy/retention policy and production approval.

The repository contains a bounded remote/read-only transport foundation, but the local plugin manifests do not claim a public hosted endpoint is live.

## Package/protocol qualification

`npm run test:plugin-roundtrip` and `npm run test:packed` qualify current repository source by packing/installing it in a clean consumer, verifying exact package allowlists/entrypoints and exercising the MCP protocol. They do not publish a package or prove a real external marketplace install.

## Release projection

The next distribution milestone is verified managed-workspace installation and public Plugin Directory listing for MCP v0.3.0. Later main changes still require a separately qualified versioned release.
