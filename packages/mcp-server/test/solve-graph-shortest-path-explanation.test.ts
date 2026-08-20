import assert from "node:assert/strict";
import test from "node:test";

import { createSolveGraphShortestPathExplanation } from "../src/solve-graph-shortest-path-explanation.js";
import type { SolveGraphShortestPathResponse } from "../src/solve-graph-shortest-path.js";

const sourceId = `sgn_${"1".repeat(32)}`;
const middleId = `sgn_${"2".repeat(32)}`;
const targetId = `sgn_${"3".repeat(32)}`;

function foundResponse(direction: "dependencies" | "dependents" = "dependencies"): SolveGraphShortestPathResponse {
  const nodes = [
    { id: sourceId, kind: "file" as const, label: "src/a.ts", path: "src/a.ts" },
    { id: middleId, kind: "file" as const, label: "src/b.ts", path: "src/b.ts" },
    { id: targetId, kind: "file" as const, label: "src/c.ts", path: "src/c.ts" },
  ];
  const dependencyHops = [
    {
      edgeId: `sge_${"a".repeat(32)}`,
      edgeKind: "imports" as const,
      edgeFromId: sourceId,
      edgeToId: middleId,
      traversalFromId: sourceId,
      traversalToId: middleId,
    },
    {
      edgeId: `sge_${"b".repeat(32)}`,
      edgeKind: "calls" as const,
      edgeFromId: middleId,
      edgeToId: targetId,
      traversalFromId: middleId,
      traversalToId: targetId,
    },
  ];
  const dependentHops = [
    {
      ...dependencyHops[0],
      edgeFromId: middleId,
      edgeToId: sourceId,
    },
    {
      ...dependencyHops[1],
      edgeFromId: targetId,
      edgeToId: middleId,
    },
  ];
  return {
    apiVersion: "v0",
    tool: "solve_graph.shortest_path",
    graphId: `sg_${"f".repeat(32)}`,
    direction,
    sourceId,
    targetId,
    found: true,
    nodes,
    hops: direction === "dependencies" ? dependencyHops : dependentHops,
    visitedCount: 3,
    truncated: false,
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxDepth: 8,
      maxVisited: 1_000,
    },
  };
}

function noPathResponse(truncationReason?: "depth" | "visited-count"): SolveGraphShortestPathResponse {
  return {
    apiVersion: "v0",
    tool: "solve_graph.shortest_path",
    graphId: `sg_${"f".repeat(32)}`,
    direction: "dependencies",
    sourceId,
    targetId,
    found: false,
    nodes: [],
    hops: [],
    visitedCount: truncationReason === "visited-count" ? 2 : 3,
    truncated: truncationReason !== undefined,
    ...(truncationReason === undefined ? {} : { truncationReason }),
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxDepth: 8,
      maxVisited: truncationReason === "visited-count" ? 2 : 1_000,
    },
  };
}

test("explains deterministic dependency and dependent paths from safe MCP summaries", () => {
  const dependency = createSolveGraphShortestPathExplanation(foundResponse());
  assert.equal(dependency.status, "complete");
  assert.equal(dependency.headline, "Dependency path found");
  assert.deepEqual(dependency.steps.map((step) => step.sentence), [
    "src/a.ts --imports--> src/b.ts",
    "src/b.ts --calls--> src/c.ts",
  ]);
  assert.equal(dependency.execution.networkAccess, false);
  assert.equal(dependency.execution.writeAccess, false);

  const dependent = createSolveGraphShortestPathExplanation(foundResponse("dependents"));
  assert.equal(dependent.headline, "Dependent path found");
  assert.deepEqual(dependent.steps.map((step) => step.edgeKind), ["imports", "calls"]);
});

test("keeps complete no-path truth distinct from bounded uncertainty", () => {
  const complete = createSolveGraphShortestPathExplanation(noPathResponse());
  assert.equal(complete.status, "complete");
  assert.equal(complete.headline, "No dependency path found");
  assert.match(complete.detail, /completely searched configured graph scope/);
  assert.match(complete.notices.join(" "), /complete search/);

  const depth = createSolveGraphShortestPathExplanation(noPathResponse("depth"));
  assert.equal(depth.status, "partial");
  assert.equal(depth.headline, "Dependency path search incomplete");
  assert.match(depth.detail, /absence is not proven/);
  assert.match(depth.notices.join(" "), /depth bound/);

  const visited = createSolveGraphShortestPathExplanation(noPathResponse("visited-count"));
  assert.equal(visited.status, "partial");
  assert.match(visited.notices.join(" "), /visited-node bound/);
});

test("supports zero-hop identity paths", () => {
  const response = foundResponse();
  response.targetId = sourceId;
  response.nodes = [response.nodes[0]!];
  response.hops = [];
  response.visitedCount = 1;

  const explanation = createSolveGraphShortestPathExplanation(response);
  assert.equal(explanation.headline, "Source and target are the same node");
  assert.equal(explanation.summary.hopCount, 0);
  assert.equal(explanation.steps.length, 0);
});

test("fails closed on capability, truncation, and traversal tampering", () => {
  const capability = foundResponse();
  (capability.execution as unknown as { networkAccess: boolean }).networkAccess = true;
  assert.throws(() => createSolveGraphShortestPathExplanation(capability), /capability-free input/);

  const truncation = noPathResponse("depth");
  truncation.truncated = false;
  assert.throws(() => createSolveGraphShortestPathExplanation(truncation), /inconsistent truncation truth/);

  const traversal = foundResponse();
  traversal.hops[0]!.traversalToId = targetId;
  assert.throws(() => createSolveGraphShortestPathExplanation(traversal), /mismatched traversal evidence/);
});
