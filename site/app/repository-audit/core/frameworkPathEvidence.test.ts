import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphNode } from "../../solve-graph/core/canonical";
import type { SolveGraphNode } from "../../solve-graph/core/contracts";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import type { RepositorySnapshot } from "./inventory";
import { createRepositoryFrameworkPathEvidenceAnalysis } from "./frameworkPathEvidence";

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

test("maps explicit Angular project roots and build entrypoints without executing framework configuration", async () => {
  const input = snapshot([
    {
      path: "angular.json",
      text: JSON.stringify({
        projects: {
          web: {
            root: "apps/web",
            sourceRoot: "apps/web/src",
            architect: {
              build: {
                options: {
                  browser: "apps/web/src/main.ts",
                  index: { input: "apps/web/src/index.html" },
                  server: "apps/web/src/server.ts",
                },
              },
            },
          },
        },
      }),
    },
    { path: "apps/web/src/main.ts", text: "bootstrapApplication(App);" },
    { path: "apps/web/src/index.html", text: "<app-root></app-root>" },
  ]);
  const analysis = await createRepositoryFrameworkPathEvidenceAnalysis(
    input,
    await graph(["angular.json", "apps/web/src/main.ts"]),
  );

  assert.deepEqual(
    analysis.relationships.map((relationship) => [
      relationship.kind,
      relationship.evidence.field,
      relationship.targetPath,
      relationship.targetType,
      relationship.targetState,
    ]),
    [
      ["angular-build-entrypoint", "projects.web.build.options.browser", "apps/web/src/main.ts", "file", "present"],
      ["angular-build-entrypoint", "projects.web.build.options.index.input", "apps/web/src/index.html", "file", "outside-bounded-scan"],
      ["angular-build-entrypoint", "projects.web.build.options.server", "apps/web/src/server.ts", "file", "missing"],
      ["angular-project-root", "projects.web.root", "apps/web", "directory", "present"],
      ["angular-source-root", "projects.web.sourceRoot", "apps/web/src", "directory", "present"],
    ],
  );
  assert.equal(analysis.status, "complete");
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("maps nested Nest source roots relative to the configuration file", async () => {
  const input = snapshot([
    { path: "packages/api/nest-cli.json", text: JSON.stringify({ sourceRoot: "src" }) },
    { path: "packages/api/src/main.ts", text: "bootstrap();" },
  ]);
  const analysis = await createRepositoryFrameworkPathEvidenceAnalysis(
    input,
    await graph(["packages/api/nest-cli.json"]),
  );

  assert.deepEqual(
    analysis.relationships.map((relationship) => [
      relationship.kind,
      relationship.targetPath,
      relationship.targetState,
    ]),
    [["nest-source-root", "packages/api/src", "outside-bounded-scan"]],
  );
  assert.equal(analysis.execution.frameworkFilesExamined, 1);
  assert.equal(analysis.status, "complete");
});

test("marks skipped dynamic or malformed framework configuration as partial", async () => {
  const input = snapshot([
    { path: "angular.json", text: JSON.stringify({ projects: { web: { root: "$APP_ROOT" } } }) },
    { path: "packages/api/nest-cli.json", text: "{not-json" },
  ]);
  const analysis = await createRepositoryFrameworkPathEvidenceAnalysis(
    input,
    await graph(["angular.json", "packages/api/nest-cli.json"]),
  );

  assert.equal(analysis.relationships.length, 0);
  assert.equal(analysis.skipped.dynamicReference, 1);
  assert.equal(analysis.skipped.invalidJson, 1);
  assert.equal(analysis.status, "partial");
});

test("keeps deterministic bounds and fails closed on source or graph-integrity mismatch", async () => {
  const input = snapshot([
    {
      path: "angular.json",
      text: JSON.stringify({
        projects: {
          web: {
            root: "apps/web",
            sourceRoot: "apps/web/src",
          },
        },
      }),
    },
    { path: "apps/web/src/main.ts", text: "export {};" },
  ]);
  const document = await graph(["angular.json", "apps/web/src/main.ts"]);
  const bounded = await createRepositoryFrameworkPathEvidenceAnalysis(input, document, { maxRelationships: 1 });
  assert.equal(bounded.relationships.length, 1);
  assert.equal(bounded.execution.relationshipsTruncated, true);
  assert.equal(bounded.status, "partial");

  const partial = await createRepositoryFrameworkPathEvidenceAnalysis(input, await graph(["angular.json"], true));
  assert.equal(partial.execution.graphTruncated, true);
  assert.equal(partial.status, "partial");

  const mismatched = structuredClone(input);
  mismatched.source.revision = "different";
  await assert.rejects(
    createRepositoryFrameworkPathEvidenceAnalysis(mismatched, document),
    /source does not match/,
  );

  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(
    createRepositoryFrameworkPathEvidenceAnalysis(input, tampered),
    /integrity-valid/,
  );
});
