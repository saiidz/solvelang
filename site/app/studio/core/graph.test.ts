import test from "node:test";
import assert from "node:assert/strict";
import { buildGraphIndex, pathDepths } from "./graph";
import { makeNode } from "./templates";
import type { WorkflowDocument } from "./types";

test("path depth analysis stays bounded for dense cyclic graphs", () => {
  const nodes = Array.from({ length: 1_000 }, (_, index) => makeNode(`dense-${index}`, index === 0 ? "trigger" : "action", `Dense ${index}`, index % 20, Math.floor(index / 20)));
  const edges = Array.from({ length: 5_000 }, (_, index) => ({
    id: `dense-edge-${index}`,
    source: `dense-${index % nodes.length}`,
    target: `dense-${(index * 37 + 1) % nodes.length}`,
    condition: "",
    priority: index,
    label: "next",
    fallback: false,
    metadata: {},
  }));
  const workflow: WorkflowDocument = {
    schemaVersion: 1, id: "dense", name: "Dense", description: "", version: "1", createdAt: "", updatedAt: "",
    nodes, edges, scenarios: [], policies: [], analytics: { tags: [], lastAnalyzedAt: null, analysisRuns: 0 }, suppressedRuleIds: [],
  };
  const depths = pathDepths(buildGraphIndex(workflow), ["dense-0"]);
  assert.ok(depths.length > 0);
  assert.ok(depths.every((depth) => Number.isFinite(depth) && depth >= 0 && depth <= 200));
});
