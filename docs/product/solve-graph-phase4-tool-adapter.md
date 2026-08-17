# Solve Graph Phase 4 — bounded tool adapter

Status: **build-only, analyze-only**.

Phase 4 adds a small deterministic request/response boundary over the canonical Solve Graph query engine so future MCP, Codex, CLI, and local explorer surfaces can reuse one safe contract instead of reimplementing graph traversal.

## Tool contract

The adapter exposes four versioned operations:

- `solve_graph.find_nodes` — bounded node search by kind/text/evidence path;
- `solve_graph.dependencies` — bounded outgoing dependency traversal;
- `solve_graph.dependents` — bounded reverse traversal;
- `solve_graph.impact` — bounded blast-radius analysis using the reviewed impact edge set.

Requests are runtime-validated. Traversal roots must be canonical Solve Graph node IDs, duplicate roots are removed deterministically, root lists are capped, and the existing query engine continues to enforce depth/result bounds and edge-kind validation.

## Safe output

Tool responses intentionally expose only stable graph identifiers plus safe summaries needed for navigation:

- node ID, kind, and label;
- normalized repository path when present;
- declared package name when present;
- traversal depth/root/parent and the canonical edge ID/kind used to reach a node.

Arbitrary node metadata, evidence notes, repository source text, credentials, environment values, and executable content are not returned through this adapter.

Responses can be serialized with canonical key ordering so equivalent requests produce reproducible output suitable for tests, caches, and tool-call transcripts.

## Integration boundary

This phase does **not** start an MCP server, expose a network port, invoke Codex, mutate a repository, execute repository code, install dependencies, or send graph data to an external provider. It is the reusable in-process contract that those future surfaces can call after they independently establish authentication, transport, privacy, and permission boundaries.

The next integration step can wrap these operations in a local/read-only MCP transport and a browser-local graph explorer without changing graph semantics.
