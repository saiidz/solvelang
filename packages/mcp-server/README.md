# SolveLang MCP Server

[![mcptry](https://mcptry.com/badge/io.github.saiidz/solvelang)](https://mcptry.com/servers/io.github.saiidz/solvelang)

## Current verification — 2026-09-20

MCP v0.3.0 is published on npm and GitHub; main protection is enforced.
Older checkpoints below are historical.

Local-first, read-only workflow, Solve Graph and Solve Context analysis for MCP clients such as Codex and Claude Code.

## Distribution status

MCP `@solvelang/mcp-server@0.3.0` is published on npm and GitHub, verified on 2026-09-20. It distributes the tagged release source; later main changes require separate distribution. Managed-workspace marketplace installation and public Plugin Directory listing remain unverified. v0.2.0 is historical.

That means:

- `npx --yes @solvelang/mcp-server@0.2.0` uses the historical package line;
- the current source tree must not be assumed to match the old v0.2.0 artifact;
- source-checkout instructions below are the correct way to evaluate current-main capabilities;
- repository packing/consumer tests prove release readiness, not external publication;
- verify npm/package registry or marketplace records before claiming current-main behavior is publicly distributed there.

## Published package usage

Node.js 20 or newer is required. For the published v0.3.0 line:

```bash
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/project \
  npx -y --package @solvelang/mcp-server@0.3.0 solvelang-mcp
```

The package ships two executables, so npx needs the explicit --package form above — the bare `npx @solvelang/mcp-server` form cannot choose one and fails.

Call `solvelang_capabilities` / MCP list-tools to inspect the exact tools exposed by the installed version. Do not infer current-main tools from this README when using an older published package.

## Current source usage

To run the repository version:

```bash
git clone https://github.com/saiidz/solvelang.git
cd solvelang/packages/mcp-server
npm ci
npm run build
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/project node dist/src/index.js
```

For `.solve` validation, make `solvec` available on `PATH` or set:

```bash
SOLVELANG_SOLVEC=/absolute/path/to/solvec \
SOLVELANG_WORKSPACE_ROOT=/absolute/path/to/project \
node dist/src/index.js
```

## Current repository tool families

### Workflow / n8n

- `solvelang_analyze_n8n` — deterministic structural scan from workspace-relative path or bounded in-memory raw JSON.
- `solvelang_validate_solve` — validates a `.solve` file through the local `solvec` executable.
- `solvelang_generate_n8n_report` — Markdown or CI-friendly JSON evidence without writing files.

### Solve Graph

Current source includes bounded deterministic tools for:

- node find/ranked search;
- dependencies/dependents;
- shortest/alternative paths plus explanations;
- transitive impact plus explanation;
- affected validation candidates;
- cycles and hotspots;
- entrypoint/unreachable candidates;
- structural security summary.

Graph input can be a workspace-relative canonical graph or raw canonical graph JSON. It must remain analyze-only, declare network/write access false, use stable canonical IDs and pass integrity validation. Graph queries are structural evidence; they do not execute repository code, install dependencies or prove runtime reachability/criticality/security.

### Solve Context

Current repository source includes:

- `solvelang_context_plan`
- `solvelang_context_pack`
- `solvelang_context_retrieve`
- `solvelang_context_handoff`
- `solvelang_context_handoff_validate`
- `solvelang_context_compact_structured`
- `solvelang_context_expand_rle`
- `solvelang_context_capabilities`
- `solvelang_context_index_query`
- `solvelang_context_index_status`

The two index tools answer from the workspace's persistent Solve Context index (`.solve/context-index.json`, built and refreshed by the `solvelang-context-index` CLI in `@solvelang/context-index`) instead of re-walking the workspace: lexical + graph-structure ranking over content-hashed records, with every excerpt hash-verified against the index before it is returned. See `docs/integrations/context-index.md`.

Solve Context is deterministic/local-first. It selects exact bounded context, preserves source/excerpt provenance, rejects stale retrieval, supports portable Claude ↔ Codex handoff state, and provides correctness-first lossless structured compaction/expansion. These tools do not launch agents, call providers, mutate repositories or imply a provider proxy.

## Solve Context evaluation commands

```bash
npm run eval:context
npm run eval:context:repository
npm run eval:context:independent
npm run test:context-agent-eval-cli
```

- `eval:context` — synthetic deterministic fixtures;
- `eval:context:repository` — pinned first-party SolveLang source regressions;
- `eval:context:independent` — independently pinned Chalk/node-fetch source subsets;
- `test:context-agent-eval-cli` — validates the offline real-agent record/report claim boundaries.

To summarize separately authorized previously collected agent records:

```bash
cat approved-agent-run-records.json | npm run eval:context:agent-records
```

The summarizer itself makes no provider/network call and uses no credentials. Baseline/context record pairs must use the same outcome-evaluation basis and required-evidence denominator in addition to the same fixture/provider/model/agent/record class.

Repository evaluation does **not** establish a public token-savings percentage, improved agent success/latency, provider cache savings or competitor superiority.

## Input and privacy boundaries

For n8n/workflow analysis, provide exactly one of:

- `path`: workspace-relative JSON; or
- `rawJson`: bounded n8n JSON supplied directly.

For Solve Graph, provide exactly one of `path` or canonical graph `rawJson`.

For Solve Context workspace operations, all file discovery/reading is bounded to the configured workspace and reviewed path/privacy rules. Likely sensitive paths are denied by the context runtime policy.

Raw supplied workflow/graph data is processed in memory, is not written by the read-only tools, and malformed-input errors must not echo sensitive source content.

## Security boundaries

- Workspace-relative paths only; traversal outside the configured root is rejected.
- Bounded file/raw-input sizes and graph traversal/result/state limits are enforced by tool-specific contracts.
- No workflow execution, arbitrary repository-source execution, network requests, file writes or credential-value inspection from read-only analysis/context tools.
- Solve Graph integrity/stable IDs/endpoints/read-only flags are checked before queries.
- Solve Context preserves explicit source/excerpt hashes, exact ranges and omission/truncation truth.
- The stdio server writes MCP protocol messages to stdout and diagnostics to stderr.
- Hosted/remote transport is a separate authenticated boundary and does not inherit local workspace authority automatically.

See the implementation/tool schemas for exact per-tool numeric limits; do not copy a limit from one tool family to another.

## Build and qualify current source

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

MCP CI also runs the exact locked dependency audit. `test:plugin-roundtrip` and `test:packed` pack/install current repository source into clean temporary consumers and verify the shared protocol/entrypoints/allowlist. They do not publish to npm or prove an external marketplace install.

## Client configuration

See:

- `plugins/solvelang/` for the canonical published-package plugin bundle;
- `docs/integrations/mcp-codex-claude.md` for published-vs-current-source Codex/Claude instructions;
- `plugins/codex/` and `plugins/claude/` for legacy/manual examples.

## Hosted remote boundary

The repository includes a deliberately read-only Streamable HTTP transport (`solvelang-mcp-remote`, `src/remote.ts`): the same raw-JSON-only analysis surface described in `docs/integrations/remote-mcp.md`, behind bearer authentication, a 4 MiB request ceiling, and a built-in per-address rate limiter (default 60 requests per 60 seconds, enforced before authentication and MCP parsing). Protocol-level tests and a real-client proof (an MCP SDK client completing a context-pack-driven impact task) pin the behavior, and a reviewed production deployment shape lives in `deploy/`.

**The endpoint is LIVE** (deployed 2026-11-20 on the owner's explicit production approval): `https://mcp.solve-lang.com` serves the 10 read-only remote tools behind bearer authentication, as a container on the production host behind TLS, with the built-in rate limit (60 requests per 60 seconds per source) active and the production token held on the host only. Verify at any time: `GET https://mcp.solve-lang.com/healthz` returns `{"status":"ok","service":"solvelang-mcp","mode":"remote-read-only"}`. Still outstanding as production hardening: edge rate limiting in front of the origin and monitoring. The hosted relay for the multi-agent bus is also live, at `https://relay.solve-lang.com` (see the Hosted relay section above).

## Multi-agent bus

The package also ships the SolveLang multi-agent bus (`solvelang-bus`, `src/bus-cli.ts`, with `src/bus-daemon.ts`, `src/bus-client.ts`, `src/bus-envelope.ts`): a local-first coordination layer for agents sharing a workspace — presence, push signals, and atomic work claims with leases, so contention surfaces at claim time instead of merge time. It layers over the handoff documents above rather than replacing them: the bus carries signals, documents carry truth, and killing the daemon degrades clients to pure document handoffs with no state loss. Messages extend the handoff envelope (content-hash `sch_` ids, at-least-once delivery with idempotent consumers) and can carry Phase 4 Ed25519 signatures in the reserved `sig` field, verified against the same `solvelang.key-registry` v1 registry as signed gates; without a registry the daemon runs in the explicitly named local-open mode (localhost only, no sender authenticity). Full design, lifecycle, and honest limits: `docs/integrations/multi-agent-bus.md`.

The bus is a separate bin and module set. It adds no MCP tools and does not change the read-only tool contract of `solvelang-mcp` or `solvelang-mcp-remote`.

### Hosted relay (live)

The bus's hosted counterpart also ships in this package (`solvelang-mcp-relay`, `src/relay-cli.ts`, with `src/relay.ts`): the same bus envelope, claim leases, and Phase 4 signature verification, carried over authenticated HTTPS between workspaces on different machines — bearer tokens bind one (workspace, agent) pair each, workspaces are fully isolated, and a message that fails authenticity is refused, never relayed. It is a separate bin and adds no MCP tools.

**The relay is deployed and live at `https://relay.solve-lang.com`** (Phase 6, Nov 20, 2026): a dedicated container on the SolveLang production host beside the remote MCP endpoint, deployed from the reviewed shape in `deploy/` (`Dockerfile.relay`, `docker-compose.relay.yml`) under the owner's explicit production approval, and verified end-to-end from outside the host with two independent clients (claim contention denied at claim time, signed signal delivery, presence, unsigned/revoked/bad-signature refusals, workspace isolation, rate-limit 429, and a stop/restart kill-switch cycle degrading to document handoffs). Full protocol, hosting shape, and honest limits: `docs/integrations/hosted-relay.md`.

## Releases

MCP `@solvelang/mcp-server@0.3.0` is published on npm and GitHub, verified on 2026-09-20. It distributes the tagged release source; later main changes require separate distribution. Managed-workspace marketplace installation and public Plugin Directory listing remain unverified. v0.2.0 is historical.

Trusted Publishing/protected release controls remain the required publication path. Do not republish the old version number, add an npm access token, or create a release/publication outside the approved process.
