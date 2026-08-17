# Solve Graph Phase 2 — deterministic query and impact analysis

Status: **build-only, analyze-only**.

This phase adds bounded deterministic graph querying on top of the canonical Solve Graph document and the Phase 1 repository inventory extractor. It performs no repository acquisition, network access, code execution, mutation, deployment, provider call, billing action, or production operation.

## Query index

`createSolveGraphQueryIndex` first verifies the canonical document integrity hash, then builds read-only incoming/outgoing adjacency maps. A tampered graph is rejected before it can be queried.

## Node search

`findSolveGraphNodes` supports deterministic filtering by:

- node kind;
- case-insensitive label/semantic identity text;
- exact evidence path;
- bounded result count.

Results preserve canonical node-ID ordering.

## Traversal semantics

`traverseSolveGraph` exposes two explicit directions:

- `dependencies`: follow outgoing edges from the selected root; and
- `dependents`: follow incoming edges toward things that depend on the selected root.

Traversal is breadth-first, stable-ID deterministic, cycle-safe, and bounded by depth and result count. Every returned non-root entry records its deterministic parent and edge, so a caller can reconstruct the shortest discovered explanation path.

If a depth or result boundary hides additional reachable nodes, the result is marked truncated instead of silently implying completeness.

## Impact / blast radius

`analyzeSolveGraphImpact` is the first blast-radius primitive. It walks dependents and, by default, follows semantic relationships such as imports, calls, references, tests, deployments, permissions, and triggers. Pure `contains` edges are deliberately excluded from default impact traversal so a changed file does not incorrectly report its parent directory/repository as an impacted consumer.

Callers may provide an explicit edge-kind set when a specialized analysis needs different semantics.

## Safety and future phases

Hard caps protect depth and result cardinality even when a caller supplies custom limits. Invalid node IDs, node kinds, edge kinds, query limits, and corrupted graph integrity fail closed.

This phase does not infer dependencies that are not already represented by graph edges. Later extractor phases should add deterministic import/reference/symbol/workflow/resource relationships, after which the same query and impact engine can serve Repository Audit, MCP/Codex tools, and a local graph explorer without changing its safety boundary.
