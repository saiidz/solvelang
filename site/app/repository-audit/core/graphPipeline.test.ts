import assert from "node:assert/strict";
import test from "node:test";
import { defaultSolveGraphScanLimits } from "../../solve-graph/core/limits";
import { analyzeRepositoryGraph } from "./graphPipeline";
import type { RepositorySnapshot } from "./inventory";

function fixture(files?: RepositorySnapshot["files"]): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "graph-pipeline.zip",
      revision: `sha256:${"1".repeat(64)}`,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    files: files ?? [
      {
        path: "package.json",
        byteSize: 50,
        sha256: "3".repeat(64),
        text: '{"dependencies":{"react":"19.0.0"}}',
      },
      {
        path: "src/store.ts",
        byteSize: 24,
        sha256: "4".repeat(64),
        text: "export const store = 1;\n",
      },
      {
        path: "src/api.ts",
        byteSize: 72,
        sha256: "5".repeat(64),
        text: 'import { store } from "./store";\nimport React from "react";\nexport { store };\n',
      },
      {
        path: "test/api.test.ts",
        byteSize: 29,
        sha256: "6".repeat(64),
        text: 'import "../src/api";\n',
      },
    ],
  };
}

test("builds an integrity-verified dependency graph and bounded audit intelligence from one snapshot", async () => {
  const result = await analyzeRepositoryGraph(fixture());
  assert.equal(result.schema, "solvelang.repository-audit.graph-pipeline.v0");
  assert.equal(result.mode, "analyze-only");
  assert.equal(result.graph.source.private, true);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
  assert.equal(result.intelligence.graphId, result.graph.graphId);
  assert.ok(result.graph.edges.some((edge) => edge.kind === "imports"));

  const store = result.intelligence.hotspots.find((item) => item.path === "src/store.ts");
  assert.ok(store);
  assert.equal(store.directDependents, 1);
  assert.equal(store.transitiveImpact, 2);

  const dependency = result.graph.nodes.find((node) => node.kind === "dependency" && node.label === "react");
  assert.ok(dependency);
});

test("equivalent reordered snapshots produce the same graph identity and intelligence", async () => {
  const first = fixture();
  const second = fixture([...first.files].reverse());
  const left = await analyzeRepositoryGraph(first);
  const right = await analyzeRepositoryGraph(second);
  assert.equal(left.graph.graphId, right.graph.graphId);
  assert.deepEqual(left.intelligence, right.intelligence);
});

test("graph scan truncation remains explicit and does not weaken analyze-only boundaries", async () => {
  const result = await analyzeRepositoryGraph(fixture(), {
    graphLimits: { ...defaultSolveGraphScanLimits, maxFiles: 2 },
    intelligence: { maxHotspots: 10, maxImpactDepth: 2, maxImpactResults: 20 },
  });
  assert.equal(result.execution.status, "partial");
  assert.equal(result.execution.truncated, true);
  assert.ok(result.execution.truncationReasons.includes("file-count"));
  assert.equal(result.graph.execution.networkAccess, false);
  assert.equal(result.graph.execution.writeAccess, false);
});

test("invalid repository paths fail closed before graph intelligence is produced", async () => {
  await assert.rejects(
    analyzeRepositoryGraph(fixture([{ path: "../outside.ts", byteSize: 1, text: "x" }])),
    /cannot traverse outside|repository-relative/,
  );
});
