import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphNode } from "../../solve-graph/core/canonical";
import type { SolveGraphNode } from "../../solve-graph/core/contracts";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import type { RepositorySnapshot } from "./inventory";
import { createRepositoryConfigurationReferenceAnalysis } from "./configurationReferences";

async function fileNode(path: string): Promise<SolveGraphNode> {
  return createSolveGraphNode({
    kind: "file",
    identity: `file:${path}`,
    label: path.slice(path.lastIndexOf("/") + 1),
    evidence: [{ kind: "deterministic-analysis", path }],
    metadata: { path },
  });
}

function snapshot(files: Array<{ path: string; text?: string }>): RepositorySnapshot {
  return {
    source: {
      kind: "github",
      displayName: solveGraphFixtureSource.displayName,
      revision: solveGraphFixtureSource.revision,
      fingerprint: solveGraphFixtureSource.fingerprint,
    },
    files: files.map((file) => ({
      path: file.path,
      byteSize: file.text === undefined ? 0 : new TextEncoder().encode(file.text).byteLength,
      ...(file.text === undefined ? {} : { text: file.text }),
    })),
  };
}

async function graph(paths: string[], partial = false) {
  return createSolveGraphDocument({
    source: solveGraphFixtureSource,
    extractors: [{ id: "inventory", version: "1.0.0", deterministic: true }],
    ...(partial ? { status: "partial" as const, truncationReasons: ["file-count" as const] } : {}),
    nodes: await Promise.all(paths.map(fileNode)),
    edges: [],
  });
}

test("maps package entrypoints without treating out-of-scope files as scanned", async () => {
  const input = snapshot([
    { path: "package.json", text: JSON.stringify({ main: "./dist/index.js", types: "./dist/index.d.ts", bin: { solve: "./bin/solve.js" } }) },
    { path: "dist/index.js", text: "export {};" },
    { path: "dist/index.d.ts", text: "export {};" },
  ]);
  const analysis = await createRepositoryConfigurationReferenceAnalysis(input, await graph(["package.json", "dist/index.js"]));
  assert.deepEqual(
    analysis.references.map((reference) => [reference.evidence.field, reference.targetPath, reference.targetState]),
    [
      ["bin.solve", "bin/solve.js", "missing"],
      ["main", "dist/index.js", "present"],
      ["types", "dist/index.d.ts", "outside-bounded-scan"],
    ],
  );
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("records only explicit repository-local GitHub Action references", async () => {
  const workflowText = [
    "jobs:",
    "  verify:",
    "    steps:",
    "      - uses: actions/checkout@v4",
    "      - uses: ./.github/actions/setup",
    "      - uses: './.github/actions/missing'",
  ].join("\n");
  const input = snapshot([
    { path: ".github/workflows/verify.yml", text: workflowText },
    { path: ".github/actions/setup/action.yml", text: "name: setup" },
  ]);
  const analysis = await createRepositoryConfigurationReferenceAnalysis(
    input,
    await graph([".github/workflows/verify.yml", ".github/actions/setup/action.yml"]),
  );
  assert.deepEqual(
    analysis.references.map((reference) => [reference.rawReference, reference.targetPath, reference.targetState]),
    [
      ["./.github/actions/missing", undefined, "missing"],
      ["./.github/actions/setup", ".github/actions/setup/action.yml", "present"],
    ],
  );
});

test("keeps bounded partial truth and fails closed on source or integrity mismatch", async () => {
  const input = snapshot([
    { path: "package.json", text: JSON.stringify({ main: "./dist/index.js" }) },
    { path: "dist/index.js", text: "export {};" },
  ]);
  const partial = await createRepositoryConfigurationReferenceAnalysis(input, await graph(["package.json"], true));
  assert.equal(partial.status, "partial");
  assert.equal(partial.references[0].targetState, "outside-bounded-scan");

  const document = await graph(["package.json"]);
  const mismatched = structuredClone(input);
  mismatched.source.revision = "different";
  await assert.rejects(createRepositoryConfigurationReferenceAnalysis(mismatched, document), /source does not match/);

  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(createRepositoryConfigurationReferenceAnalysis(input, tampered), /integrity-valid/);
});
