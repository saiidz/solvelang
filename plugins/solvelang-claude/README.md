# SolveLang for Claude

SolveLang gives Claude deterministic, read-only analysis for n8n workflow JSON and canonical Solve Graph documents. The plugin pairs a focused workflow-review skill with the public SolveLang MCP connector at `https://mcp.solve-lang.com/mcp`, so it works across Claude chat, Cowork, and Claude Code without installing a local runtime.

Use it to review workflow structure, generate preflight reports, search repository graph nodes, trace dependencies and dependents, find bounded paths, and explain change impact. The connector processes only JSON supplied to the tool call. It does not execute workflows, read a local workspace, inspect credential values, modify repositories, or call third-party providers.

## Public connector

- MCP URL: `https://mcp.solve-lang.com/mcp`
- Health: `https://mcp.solve-lang.com/healthz`
- Documentation: `https://www.solve-lang.com/mcp/`
- Privacy: `https://www.solve-lang.com/privacy-policy/`
- Support: `hello@solve-lang.com`
- Authentication: none; the public connector is anonymous and read-only

Raw workflow or Solve Graph JSON is processed in memory by the application and is not intentionally persisted or logged by SolveLang. Hosting and edge providers may process request metadata needed for delivery, security, and abuse prevention as described in the privacy policy.

## What Claude should use it for

Ask Claude to:

- review an n8n workflow and prioritize structural risks;
- generate a deterministic Markdown preflight report;
- search canonical Solve Graph nodes;
- trace dependency or dependent relationships;
- calculate and explain bounded change impact;
- describe what the public SolveLang connector can and cannot do.

Local `.solve` validation and workspace-path analysis are intentionally unavailable in this public plugin. Those remain local-development capabilities outside the directory connector.

## Safety boundary

All public SolveLang tools are read-only and non-destructive. Tool output is structural evidence, not proof that a workflow ran successfully, credentials are valid, an external API is available, or a production change is safe to perform.
