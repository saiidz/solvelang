import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphNode } from "../../solve-graph/core/canonical";
import type { SolveGraphNode } from "../../solve-graph/core/contracts";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import type { RepositorySnapshot } from "./inventory";
import { createRepositoryPackageScriptPathEvidenceAnalysis } from "./packageScriptPathEvidence";

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

test("maps conservative literal package-script entrypoint and config references", async () => {
  const input = snapshot([
    {
      path: "apps/api/package.json",
      text: JSON.stringify({
        scripts: {
          start: "node ./src/server.js",
          typecheck: "tsc -p tsconfig.build.json",
          build: "vite --config vite.config.ts",
          lint: "eslint --config eslint.config.js",
          dev: "next dev",
        },
      }),
    },
    { path: "apps/api/src/server.js", text: "export {};" },
    { path: "apps/api/tsconfig.build.json", text: "{}" },
    { path: "apps/api/eslint.config.js", text: "export default [];" },
  ]);
  const analysis = await createRepositoryPackageScriptPathEvidenceAnalysis(
    input,
    await graph([
      "apps/api/package.json",
      "apps/api/src/server.js",
      "apps/api/eslint.config.js",
    ]),
  );

  assert.deepEqual(
    analysis.relationships.map((relationship) => [
      relationship.scriptName,
      relationship.kind,
      relationship.targetPath,
      relationship.targetState,
    ]),
    [
      ["build", "vite-config", "apps/api/vite.config.ts", "missing"],
      ["lint", "eslint-config", "apps/api/eslint.config.js", "present"],
      ["start", "node-entrypoint", "apps/api/src/server.js", "present"],
      ["typecheck", "tsc-project", "apps/api/tsconfig.build.json", "outside-bounded-scan"],
    ],
  );
  assert.equal(analysis.status, "complete");
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("supports npx wrappers and nested local resolution without executing scripts", async () => {
  const input = snapshot([
    {
      path: "packages/tool/package.json",
      text: JSON.stringify({ scripts: {
        check: "npx tsc --project ./config/tsconfig.json",
        run: "tsx ./src/index.ts",
        legacy: "ts-node ./src/legacy.ts",
      } }),
    },
    { path: "packages/tool/config/tsconfig.json", text: "{}" },
    { path: "packages/tool/src/index.ts", text: "export {};" },
    { path: "packages/tool/src/legacy.ts", text: "export {};" },
  ]);
  const analysis = await createRepositoryPackageScriptPathEvidenceAnalysis(
    input,
    await graph([
      "packages/tool/package.json",
      "packages/tool/config/tsconfig.json",
      "packages/tool/src/index.ts",
      "packages/tool/src/legacy.ts",
    ]),
  );

  assert.deepEqual(
    analysis.relationships.map((relationship) => relationship.kind).sort(),
    ["ts-node-entrypoint", "tsc-project", "tsx-entrypoint"],
  );
  assert.ok(analysis.relationships.every((relationship) => relationship.targetState === "present"));
  assert.equal(analysis.status, "complete");
});

test("skips shell-heavy, oversized, malformed, and invalid local evidence as partial", async () => {
  const input = snapshot([
    {
      path: "package.json",
      text: JSON.stringify({ scripts: {
        dynamic: "node ./scripts/run.js && echo done",
        invalid: "node ../outside.js",
        huge: "x".repeat(20),
      } }),
    },
  ]);
  const analysis = await createRepositoryPackageScriptPathEvidenceAnalysis(
    input,
    await graph(["package.json"]),
    { maxScriptTextBytes: 10 },
  );

  assert.equal(analysis.relationships.length, 0);
  assert.equal(analysis.skipped.dynamicScript, 1);
  assert.equal(analysis.skipped.invalidTarget, 1);
  assert.equal(analysis.skipped.oversizedScript, 1);
  assert.equal(analysis.status, "partial");

  const malformed = await createRepositoryPackageScriptPathEvidenceAnalysis(
    snapshot([{ path: "package.json", text: "{not-json" }]),
    await graph(["package.json"]),
  );
  assert.equal(malformed.skipped.invalidJson, 1);
  assert.equal(malformed.status, "partial");
});

test("keeps deterministic bounds and fails closed on source or graph-integrity mismatch", async () => {
  const input = snapshot([
    {
      path: "package.json",
      text: JSON.stringify({ scripts: {
        one: "node ./one.js",
        two: "node ./two.js",
      } }),
    },
    { path: "one.js", text: "export {};" },
    { path: "two.js", text: "export {};" },
  ]);
  const document = await graph(["package.json", "one.js", "two.js"]);
  const bounded = await createRepositoryPackageScriptPathEvidenceAnalysis(input, document, { maxRelationships: 1 });
  assert.equal(bounded.relationships.length, 1);
  assert.equal(bounded.execution.relationshipsTruncated, true);
  assert.equal(bounded.status, "partial");

  const partial = await createRepositoryPackageScriptPathEvidenceAnalysis(input, await graph(["package.json"], true));
  assert.equal(partial.execution.graphTruncated, true);
  assert.equal(partial.status, "partial");

  const mismatched = structuredClone(input);
  mismatched.source.revision = "different";
  await assert.rejects(
    createRepositoryPackageScriptPathEvidenceAnalysis(mismatched, document),
    /source does not match/,
  );

  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(
    createRepositoryPackageScriptPathEvidenceAnalysis(input, tampered),
    /integrity-valid/,
  );
});
