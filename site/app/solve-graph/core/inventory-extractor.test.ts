import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryFileInput, RepositorySnapshot } from "../../repository-audit/core/inventory";
import { serializeSolveGraphDocument, verifySolveGraphIntegrity } from "./canonical";
import { extractRepositoryInventoryGraph } from "./inventory-extractor";
import { defaultSolveGraphScanLimits } from "./limits";

const source = {
  kind: "github" as const,
  displayName: "example/graph-fixture",
  revision: "014c074e89f91e9bfb8ddf80b7998be040b8257a",
  fingerprint: `sha256:${"a".repeat(64)}`,
};

function snapshot(files: RepositoryFileInput[]): RepositorySnapshot {
  return { source, files };
}

function hash(character: string): string {
  return character.repeat(64);
}

test("repository inventory extraction is deterministic across input ordering and normalized paths", async () => {
  const files: RepositoryFileInput[] = [
    { path: "./src//index.ts", byteSize: 120, sha256: hash("1") },
    { path: "README.md", byteSize: 80, sha256: hash("2") },
    { path: "src/index.test.ts", byteSize: 95, sha256: hash("3") },
  ];

  const left = await extractRepositoryInventoryGraph(snapshot(files));
  const right = await extractRepositoryInventoryGraph(snapshot([...files].reverse()));

  assert.equal(serializeSolveGraphDocument(left), serializeSolveGraphDocument(right));
  assert.equal(left.graphId, right.graphId);
  assert.equal(await verifySolveGraphIntegrity(left), true);
  assert.equal(left.execution.status, "complete");
  assert.equal(left.execution.networkAccess, false);
  assert.equal(left.execution.writeAccess, false);
});

test("repository inventory extraction creates directory containment and classified file metadata", async () => {
  const graph = await extractRepositoryInventoryGraph(snapshot([
    { path: "src/lib/index.ts", byteSize: 120, sha256: hash("4") },
    { path: "src/lib/index.test.ts", byteSize: 95, sha256: hash("5") },
    { path: "docs/architecture.md", byteSize: 70, sha256: hash("6") },
  ]), { privateSource: false });

  const repository = graph.nodes.find((node) => node.kind === "repository");
  const src = graph.nodes.find((node) => node.kind === "directory" && node.metadata?.path === "src");
  const lib = graph.nodes.find((node) => node.kind === "directory" && node.metadata?.path === "src/lib");
  const sourceFile = graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === "src/lib/index.ts");
  const testFile = graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === "src/lib/index.test.ts");
  const docFile = graph.nodes.find((node) => node.kind === "file" && node.metadata?.path === "docs/architecture.md");

  assert.ok(repository);
  assert.ok(src);
  assert.ok(lib);
  assert.ok(sourceFile);
  assert.ok(testFile);
  assert.ok(docFile);
  assert.equal(graph.source.private, false);
  assert.equal(sourceFile.metadata?.fileClass, "source");
  assert.equal(sourceFile.metadata?.contentSha256, hash("4"));
  assert.equal(testFile.metadata?.fileClass, "test");
  assert.equal(docFile.metadata?.fileClass, "documentation");

  const contains = (from: string, to: string) => graph.edges.some((edge) => (
    edge.kind === "contains" && edge.from === from && edge.to === to
  ));
  assert.equal(contains(repository.id, src.id), true);
  assert.equal(contains(src.id, lib.id), true);
  assert.equal(contains(lib.id, sourceFile.id), true);
});

test("node and edge capacity truncate whole files without creating dangling graph elements", async () => {
  const files: RepositoryFileInput[] = [
    { path: "src/a.ts", byteSize: 10, sha256: hash("7") },
    { path: "src/b.ts", byteSize: 10, sha256: hash("8") },
  ];
  const nodeLimited = await extractRepositoryInventoryGraph(snapshot(files), {
    limits: { ...defaultSolveGraphScanLimits, maxNodes: 3 },
  });
  assert.equal(nodeLimited.execution.status, "partial");
  assert.deepEqual(nodeLimited.execution.truncationReasons, ["node-count"]);
  assert.equal(nodeLimited.nodes.filter((node) => node.kind === "file").length, 1);
  assert.equal(await verifySolveGraphIntegrity(nodeLimited), true);

  const edgeLimited = await extractRepositoryInventoryGraph(snapshot([
    { path: "a.ts", byteSize: 10, sha256: hash("9") },
    { path: "b.ts", byteSize: 10, sha256: hash("b") },
  ]), {
    limits: { ...defaultSolveGraphScanLimits, maxEdges: 1 },
  });
  assert.equal(edgeLimited.execution.status, "partial");
  assert.deepEqual(edgeLimited.execution.truncationReasons, ["edge-count"]);
  assert.equal(edgeLimited.nodes.filter((node) => node.kind === "file").length, 1);
  assert.equal(edgeLimited.edges.length, 1);
  assert.equal(await verifySolveGraphIntegrity(edgeLimited), true);
});

test("empty repositories remain valid complete analyze-only graphs", async () => {
  const graph = await extractRepositoryInventoryGraph(snapshot([]));
  assert.equal(graph.execution.status, "complete");
  assert.equal(graph.nodes.length, 1);
  assert.equal(graph.nodes[0].kind, "repository");
  assert.equal(graph.edges.length, 0);
  assert.equal(await verifySolveGraphIntegrity(graph), true);
});

test("unsafe repository paths fail closed before graph extraction", async () => {
  await assert.rejects(
    extractRepositoryInventoryGraph(snapshot([{ path: "../secret.txt", byteSize: 1, sha256: hash("c") }])),
    /traverse outside the repository/,
  );
});
