# SolveLang remote MCP boundary

SolveLang includes a repository-safe remote MCP server boundary for clients that cannot launch the local stdio package, including server-side Claude MCP connectors.

This document describes code capability only. It does not claim that a public endpoint is deployed, that a production bearer credential exists, or that any third-party marketplace listing has been submitted or approved.

## Authority model

Remote mode is deliberately narrower than local stdio mode.

It accepts only raw JSON supplied in the MCP request and exposes deterministic read-only analysis. It does not accept workspace paths, read the filesystem, invoke `solvec`, spawn subprocesses, mutate repositories, inspect credential values, or make provider/network calls from tools.

The remote tool set is limited to:

- `solvelang_analyze_n8n`
- `solvelang_generate_n8n_report`
- `solvelang_graph_find_nodes`
- `solvelang_graph_search_nodes`
- `solvelang_graph_dependencies`
- `solvelang_graph_dependents`
- `solvelang_graph_shortest_path`
- `solvelang_graph_impact`
- `solvelang_graph_explain_impact`
- `solvelang_capabilities`

`.solve` validation remains local-only because it requires the local `solvec` executable.

## Transport and authentication

The server uses MCP Streamable HTTP in stateless mode.

- MCP endpoint: `/mcp` by default.
- Health endpoint: `GET /healthz`.
- MCP requests: `POST` only.
- Authentication: exact Bearer token, checked before MCP request-body parsing.
- Request content type: `application/json`.
- Request ceiling: 4 MiB before MCP parsing.
- N8n/Solve Graph input ceilings remain the existing 2 MiB analysis limits.
- HTTP responses use `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`.
- Raw workflow/graph input is not intentionally logged or persisted by the application.

The application token must be 32–1024 UTF-8 bytes with no whitespace/control characters. Production deployments should inject it through an approved secret store; never put it in Git, plugin manifests, documentation, or chat.

## Local qualification run

After building the package:

```bash
cd packages/mcp-server
npm ci
npm test
npm run test:packed
```

Run the remote boundary locally with a development-only token:

```bash
SOLVELANG_REMOTE_BEARER_TOKEN='replace-with-a-long-random-development-token' \
SOLVELANG_REMOTE_HOST=127.0.0.1 \
SOLVELANG_REMOTE_PORT=8787 \
npm run start:remote
```

Then the MCP URL is `http://127.0.0.1:8787/mcp` and the health URL is `http://127.0.0.1:8787/healthz`.

The packaged executable is also named `solvelang-mcp-remote`.

## Public hosting requirements

Before connecting Claude's server-side MCP connector or any internet client, a separate deployment must provide:

1. HTTPS termination with a stable public hostname.
2. Production secret storage and rotation for the bearer credential, or a separately reviewed OAuth upgrade.
3. Network/firewall policy that exposes only the intended HTTPS ingress.
4. Rate limiting and abuse monitoring at the edge/runtime.
5. Request/response logging configured so raw JSON and Authorization headers are not retained.
6. Retention/deletion policy and incident-response ownership.
7. Health/availability monitoring and rollback/disable controls.
8. Explicit owner approval for the exact deployment and credential activation.

A repository merge does not satisfy those requirements and does not authorize deployment.

## Claude and Codex relationship

The canonical `plugins/solvelang/` bundle remains the preferred local integration for Codex and Claude Code because it can use the richer local stdio tool set under workspace bounds.

The remote boundary exists for server-side/cloud clients that require a public HTTP MCP server. Once a protected HTTPS deployment is separately approved and verified, its URL can be configured in compatible clients without changing the underlying read-only analysis contracts.
