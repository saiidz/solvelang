import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphNode } from "../../solve-graph/core/canonical";
import type { SolveGraphNode } from "../../solve-graph/core/contracts";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createRepositoryAngularTargetConfigEvidenceAnalysis } from "./angularTargetConfigEvidence";
import type { RepositorySnapshot } from "./inventory";

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

test("maps explicit Angular target tsConfig references without executing framework configuration", async () => {
  const input = snapshot([
    {
      path: "angular.json",
      text: JSON.stringify({
        projects: {
          web: {
            architect: {
              build: { options: { tsConfig: "apps/web/tsconfig.app.json" } },
              test: { options: { tsConfig: "apps/web/tsconfig.spec.json" } },
            },
          },
        },
      }),
    },
    { path: "apps/web/tsconfig.app.json", text: "{}" },
    { path: "apps/web/tsconfig.spec.json", text: "{}" },
  ]);
  const analysis = await createRepositoryAngularTargetConfigEvidenceAnalysis(
    input,
    await graph(["angular.json", "apps/web/tsconfig.app.json"]),
  );

  assert.deepEqual(
    analysis.relationships.map((relationship) => [
      relationship.project,
      relationship.target,
      relationship.evidence.field,
      relationship.targetPath,
      relationship.targetState,
    ]),
    [
      ["web", "build", "projects.web.build.options.tsConfig", "apps/web/tsconfig.app.json", "present"],
      ["web", "test", "projects.web.test.options.tsConfig", "apps/web/tsconfig.spec.json", "outside-bounded-scan"],
    ],
  );
  assert.equal(analysis.status, "complete");
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("keeps missing targets as evidence and skips dynamic references instead of guessing", async () => {
  const input = snapshot([
    {
      path: "packages/ui/angular.json",
      text: JSON.stringify({
        projects: {
          ui: {
            targets: {
              build: { options: { tsConfig: "$CONFIG_PATH" } },
              test: { options: { tsConfig: "tsconfig.spec.json" } },
            },
          },
        },
      }),
    },
  ]);
  const analysis = await createRepositoryAngularTargetConfigEvidenceAnalysis(
    input,
    await graph(["packages/ui/angular.json"]),
  );

  assert.deepEqual(
    analysis.relationships.map((relationship) => [relationship.target, relationship.targetPath, relationship.targetState]),
    [["test", "packages/ui/tsconfig.spec.json", "missing"]],
  );
  assert.equal(analysis.skipped.dynamicReference, 1);
  assert.equal(analysis.status, "partial");
});

test("enforces deterministic bounds and graph/source integrity", async () => {
  const input = snapshot([
    {
      path: "angular.json",
      text: JSON.stringify({
        projects: {
          a: { architect: { build: { options: { tsConfig: "a.json" } } } },
          b: { architect: { build: { options: { tsConfig: "b.json" } } } },
        },
      }),
    },
    { path: "a.json", text: "{}" },
    { path: "b.json", text: "{}" },
  ]);
  const document = await graph(["angular.json", "a.json", "b.json"]);
  const bounded = await createRepositoryAngularTargetConfigEvidenceAnalysis(
    input,
    document,
    { maxRelationships: 1 },
  );
  assert.equal(bounded.relationships.length, 1);
  assert.equal(bounded.execution.relationshipsTruncated, true);
  assert.equal(bounded.status, "partial");

  const partial = await createRepositoryAngularTargetConfigEvidenceAnalysis(
    input,
    await graph(["angular.json"], true),
  );
  assert.equal(partial.execution.graphTruncated, true);
  assert.equal(partial.status, "partial");

  const mismatched = structuredClone(input);
  mismatched.source.revision = "different";
  await assert.rejects(
    createRepositoryAngularTargetConfigEvidenceAnalysis(mismatched, document),
    /source does not match/,
  );

  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(
    createRepositoryAngularTargetConfigEvidenceAnalysis(input, tampered),
    /integrity-valid/,
  );
});
