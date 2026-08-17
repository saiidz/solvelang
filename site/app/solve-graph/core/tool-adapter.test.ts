import assert from "node:assert/strict";
import test from "node:test";
import type { RepositorySnapshot } from "../../repository-audit/core/inventory";
import { extractRepositoryDependencyGraph } from "./import-extractor";
import { createSolveGraphQueryIndex } from "./query-impact";
import {
  executeSolveGraphTool,
  executeSolveGraphToolOnDocument,
  parseSolveGraphToolRequest,
  serializeSolveGraphToolResponse,
} from "./tool-adapter";

function file(path: string, text: string): RepositorySnapshot["files"][number] {
  return { path, text, byteSize: new TextEncoder().encode(text).byteLength };
}

function snapshot(): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "tool-fixture",
      revision: "fixture-v1",
      fingerprint: `sha256:${"b".repeat(64)}`,
    },
    files: [
      file("package.json", JSON.stringify({ dependencies: { react: "19.0.0" } })),
      file("src/lib.ts", "export const lib = 1;"),
      file("src/service.ts", 'import { lib } from "./lib"; export const service = lib;'),
      file("src/route.ts", 'import { service } from "./service"; import React from "react"; export const route = service;'),
    ],
  };
}

function fileNodeId(graph: Awaited<ReturnType<typeof extractRepositoryDependencyGraph>>, path: string): string {
  const node = graph.nodes.find((candidate) => candidate.kind === "file" && candidate.metadata?.path === path);
  assert.ok(node, `missing file node ${path}`);
  return node.id;
}

test("tool adapter exposes bounded safe node summaries without arbitrary metadata or evidence", async () => {
  const graph = await extractRepositoryDependencyGraph(snapshot());
  const response = await executeSolveGraphToolOnDocument(graph, {
    tool: "solve_graph.find_nodes",
    query: { kinds: ["file"], text: "route", limit: 10 },
  });

  if (response.tool !== "solve_graph.find_nodes") throw new Error(`unexpected response tool: ${response.tool}`);
  assert.equal(response.graphId, graph.graphId);
  assert.deepEqual(response.nodes, [{
    id: fileNodeId(graph, "src/route.ts"),
    kind: "file",
    label: "route.ts",
    path: "src/route.ts",
  }]);
  assert.equal(response.truncated, false);
  assert.equal("metadata" in response.nodes[0], false);
  assert.equal("evidence" in response.nodes[0], false);
});

test("dependencies and impact return deterministic enriched paths suitable for tool consumers", async () => {
  const graph = await extractRepositoryDependencyGraph(snapshot());
  const index = await createSolveGraphQueryIndex(graph);
  const libId = fileNodeId(graph, "src/lib.ts");
  const serviceId = fileNodeId(graph, "src/service.ts");
  const routeId = fileNodeId(graph, "src/route.ts");

  const dependencies = executeSolveGraphTool(index, {
    tool: "solve_graph.dependencies",
    rootIds: [routeId],
    options: { edgeKinds: ["imports"], maxDepth: 3, maxResults: 20 },
  });
  if (dependencies.tool !== "solve_graph.dependencies") throw new Error(`unexpected response tool: ${dependencies.tool}`);
  assert.deepEqual(
    dependencies.entries.filter((entry) => entry.node.kind === "file").map((entry) => [entry.node.path, entry.depth]),
    [["src/route.ts", 0], ["src/service.ts", 1], ["src/lib.ts", 2]],
  );
  assert.ok(dependencies.entries.some((entry) => entry.depth === 1 && entry.viaEdgeKind === "imports"));

  const impact = executeSolveGraphTool(index, {
    tool: "solve_graph.impact",
    changedNodeIds: [libId],
    options: { maxDepth: 3, maxResults: 20 },
  });
  if (impact.tool !== "solve_graph.impact") throw new Error(`unexpected response tool: ${impact.tool}`);
  assert.deepEqual(impact.entries.map((entry) => entry.id), [libId, serviceId, routeId]);
  assert.deepEqual(impact.entries.map((entry) => entry.depth), [0, 1, 2]);
  assert.equal(impact.truncated, false);
});

test("runtime request parser rejects unknown tools, malformed IDs, and unbounded root lists", () => {
  assert.throws(
    () => parseSolveGraphToolRequest({ tool: "solve_graph.delete_everything" }),
    /tool is invalid/,
  );
  assert.throws(
    () => parseSolveGraphToolRequest({ tool: "solve_graph.dependencies", rootIds: ["not-a-node"] }),
    /invalid node ID/,
  );
  assert.throws(
    () => parseSolveGraphToolRequest({
      tool: "solve_graph.impact",
      changedNodeIds: Array.from({ length: 129 }, (_, index) => `sgn_${index.toString(16).padStart(32, "0")}`),
    }),
    /exceeds 128 roots/,
  );
  assert.throws(
    () => parseSolveGraphToolRequest({ tool: "solve_graph.dependents", rootIds: [`sgn_${"a".repeat(32)}`], options: [] }),
    /traversal options must be an object/,
  );
});

test("equivalent root ordering produces identical canonical tool output", async () => {
  const graph = await extractRepositoryDependencyGraph(snapshot());
  const index = await createSolveGraphQueryIndex(graph);
  const libId = fileNodeId(graph, "src/lib.ts");
  const serviceId = fileNodeId(graph, "src/service.ts");

  const left = executeSolveGraphTool(index, {
    tool: "solve_graph.impact",
    changedNodeIds: [serviceId, libId],
    options: { maxDepth: 3, maxResults: 20 },
  });
  const right = executeSolveGraphTool(index, {
    tool: "solve_graph.impact",
    changedNodeIds: [libId, serviceId, libId],
    options: { maxDepth: 3, maxResults: 20 },
  });

  assert.equal(serializeSolveGraphToolResponse(left), serializeSolveGraphToolResponse(right));
});
