import assert from "node:assert/strict";
import test from "node:test";

import type { RepositorySelectedNodeIntelligence } from "./selectedNodeIntelligence";
import {
  createRepositorySelectedNodeIntelligenceRequestKey,
  resolveRepositorySelectedNodeIntelligenceViewState,
} from "./selectedNodeIntelligenceController";

function product(graphId: string, selectedNodeId: string): RepositorySelectedNodeIntelligence {
  return { graphId, selectedNodeId } as RepositorySelectedNodeIntelligence;
}

test("creates a deterministic request key only for an actionable selection", () => {
  assert.equal(
    createRepositorySelectedNodeIntelligenceRequestKey("graph-a", "graph-a", "node-a"),
    "graph-a:graph-a:node-a",
  );
  assert.equal(createRepositorySelectedNodeIntelligenceRequestKey("graph-a", undefined, "node-a"), undefined);
  assert.equal(createRepositorySelectedNodeIntelligenceRequestKey("graph-a", "graph-a", undefined), undefined);
});

test("treats a prior request result as pending after a rapid selection change", () => {
  const requestKey = createRepositorySelectedNodeIntelligenceRequestKey("graph-a", "graph-a", "node-b");
  const state = {
    requestKey: "graph-a:graph-a:node-a",
    product: product("graph-a", "node-a"),
  };

  const view = resolveRepositorySelectedNodeIntelligenceViewState("graph-a", "node-b", requestKey, state);

  assert.equal(view.pending, true);
  assert.equal(view.product, undefined);
  assert.equal(view.error, "");
});

test("never activates a product from another graph or selected node", () => {
  const requestKey = "graph-a:graph-a:node-a";

  const wrongGraph = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    requestKey,
    { requestKey, product: product("graph-b", "node-a") },
  );
  const wrongNode = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    requestKey,
    { requestKey, product: product("graph-a", "node-b") },
  );

  assert.equal(wrongGraph.pending, false);
  assert.equal(wrongGraph.product, undefined);
  assert.equal(wrongNode.product, undefined);
});

test("activates only the exact current result and scopes errors to the current request", () => {
  const requestKey = "graph-a:graph-a:node-a";
  const current = product("graph-a", "node-a");

  const success = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    requestKey,
    { requestKey, product: current },
  );
  const error = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    "node-a",
    requestKey,
    { requestKey, error: "bounded composition failed" },
  );
  const cleared = resolveRepositorySelectedNodeIntelligenceViewState(
    "graph-a",
    undefined,
    undefined,
    { requestKey, product: current, error: "stale" },
  );

  assert.equal(success.pending, false);
  assert.equal(success.product, current);
  assert.equal(error.error, "bounded composition failed");
  assert.equal(cleared.pending, false);
  assert.equal(cleared.product, undefined);
  assert.equal(cleared.error, "");
});
