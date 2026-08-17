import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
  serializeSolveGraphDocument,
} from "./canonical";
import { loadSolveGraphDocumentText, MAX_LOCAL_SOLVE_GRAPH_BYTES } from "./document-io";
import { solveGraphFixtureSource } from "./fixtures";

async function fixture() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:explorer-fixture",
    label: "Explorer fixture",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const api = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/api.ts",
    label: "src/api.ts",
    evidence: [{ kind: "parser", path: "src/api.ts" }],
    metadata: { path: "src/api.ts" },
  });
  const edge = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: api.id,
    evidence: [{ kind: "deterministic-analysis", path: "src/api.ts" }],
  });
  return createSolveGraphDocument({
    source: { ...solveGraphFixtureSource, displayName: "explorer-fixture" },
    extractors: [{ id: "fixture", version: "1", deterministic: true }],
    nodes: [repository, api],
    edges: [edge],
  });
}

test("loads an exact canonical read-only graph and creates a query index", async () => {
  const document = await fixture();
  const loaded = await loadSolveGraphDocumentText(serializeSolveGraphDocument(document));
  assert.equal(loaded.document.graphId, document.graphId);
  assert.equal(loaded.index.nodesById.size, 2);
  assert.equal(loaded.index.outgoingByNodeId.get(document.nodes.find((node) => node.kind === "repository")!.id)?.length, 1);
});

test("rejects malformed, non-analyze-only, and mutable execution documents", async () => {
  await assert.rejects(loadSolveGraphDocumentText("{"), /malformed/);
  const document = await fixture();
  await assert.rejects(
    loadSolveGraphDocumentText(JSON.stringify({ ...document, mode: "execute" })),
    /analyze-only/,
  );
  await assert.rejects(
    loadSolveGraphDocumentText(JSON.stringify({
      ...document,
      execution: { ...document.execution, networkAccess: true },
    })),
    /networkAccess=false/,
  );
});

test("rejects tampering and non-canonical extra fields even when JSON is structurally plausible", async () => {
  const document = await fixture();
  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(loadSolveGraphDocumentText(JSON.stringify(tampered)), /does not match its canonical representation|ID does not match|canonical/);

  await assert.rejects(
    loadSolveGraphDocumentText(JSON.stringify({ ...document, unexpected: true })),
    /canonical representation/,
  );
});

test("enforces a bounded local JSON input size before parsing", async () => {
  const oversized = "x".repeat(MAX_LOCAL_SOLVE_GRAPH_BYTES + 1);
  await assert.rejects(loadSolveGraphDocumentText(oversized), /8 MB/);
});
