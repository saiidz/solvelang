import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
  serializeSolveGraphDocument,
  solveGraphNodeId,
  verifySolveGraphIntegrity,
} from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";

test("stable node IDs depend on semantic identity rather than labels or input order", async () => {
  const id = await solveGraphNodeId("function", "src/auth.ts#function:login");
  const same = await solveGraphNodeId("function", "src/auth.ts#function:login");
  const different = await solveGraphNodeId("function", "src/auth.ts#function:logout");
  assert.match(id, /^sgn_[a-f0-9]{32}$/);
  assert.equal(id, same);
  assert.notEqual(id, different);
});

test("canonical graph serialization is identical for reordered equivalent inputs", async () => {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:fixture-repository",
    label: "Fixture repository",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const file = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/auth.ts",
    label: "src/auth.ts",
    evidence: [{ kind: "parser", path: "src/auth.ts", line: 1 }],
    metadata: { language: "typescript", byteSize: 128 },
  });
  const contains = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: file.id,
    evidence: [{ kind: "deterministic-analysis", path: "src/auth.ts" }],
  });

  const base = {
    source: solveGraphFixtureSource,
    engineVersion: "0.1.0",
    extractors: [{ id: "fixture", version: "1", deterministic: true as const }],
  };
  const left = await createSolveGraphDocument({ ...base, nodes: [repository, file], edges: [contains] });
  const right = await createSolveGraphDocument({ ...base, nodes: [file, repository], edges: [contains] });

  assert.equal(serializeSolveGraphDocument(left), serializeSolveGraphDocument(right));
  assert.equal(left.graphId, right.graphId);
  assert.equal(await verifySolveGraphIntegrity(left), true);
});

test("canonical document rejects missing endpoints, identity/ID disagreement, and tampering", async () => {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:fixture-repository",
    label: "Fixture repository",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const missing = await createSolveGraphNode({
    kind: "file",
    identity: "file:missing.ts",
    label: "missing.ts",
    evidence: [{ kind: "parser", path: "missing.ts" }],
  });
  const edge = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: missing.id,
    evidence: [{ kind: "deterministic-analysis", path: "missing.ts" }],
  });
  const base = {
    source: solveGraphFixtureSource,
    extractors: [{ id: "fixture", version: "1", deterministic: true as const }],
  };

  await assert.rejects(
    createSolveGraphDocument({ ...base, nodes: [repository], edges: [edge] }),
    /missing node/,
  );

  await assert.rejects(
    createSolveGraphDocument({ ...base, nodes: [{ ...repository, identity: "repo:changed" }], edges: [] }),
    /does not match its identity/,
  );

  const document = await createSolveGraphDocument({ ...base, nodes: [repository], edges: [] });
  const tampered = { ...document, source: { ...document.source, revision: "changed" } };
  assert.equal(await verifySolveGraphIntegrity(tampered), false);
});
