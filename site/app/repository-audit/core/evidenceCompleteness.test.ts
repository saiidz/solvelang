import assert from "node:assert/strict";
import test from "node:test";
import { defaultSolveGraphScanLimits } from "../../solve-graph/core/limits";
import { analyzeRepositorySnapshot } from "./analysisPipeline";
import { createRepositoryAuditEvidenceCompleteness } from "./evidenceCompleteness";
import type { RepositorySnapshot } from "./inventory";

function fixture(): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "evidence.zip",
      revision: `sha256:${"1".repeat(64)}`,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    files: [
      {
        path: "src/config.ts",
        byteSize: 25,
        text: "export const retry = 3;\n",
      },
      {
        path: "src/app.ts",
        byteSize: 55,
        text: "import { retry } from './config';\nexport { retry };\n",
      },
      {
        path: "README.md",
        byteSize: 20,
        text: "# Evidence fixture\n",
      },
    ],
  };
}

test("summarizes complete bounded evidence without implying repository writes", async () => {
  const analysis = await analyzeRepositorySnapshot(fixture());
  const summary = createRepositoryAuditEvidenceCompleteness(analysis);

  assert.equal(summary.schema, "solvelang.repository-audit.evidence-completeness.v0");
  assert.equal(summary.mode, "analyze-only");
  assert.equal(summary.status, "complete");
  assert.equal(summary.truncated, false);
  assert.deepEqual(summary.limitations, []);
  assert.equal(summary.inventory.filesSeen, 3);
  assert.equal(summary.inventory.filesScanned, 3);
  assert.equal(summary.graph.fileNodes, analysis.execution.secretFilesScanned);
  assert.equal(summary.graph.nodes, analysis.graph.graph.nodes.length);
  assert.equal(summary.graph.edges, analysis.graph.graph.edges.length);
  assert.equal(summary.secretAnalysis.scope, "graph-accepted-files-only");
  assert.deepEqual(summary.safety, { networkAccess: false, writeAccess: false });
});

test("surfaces inventory and graph truncation as explicit deterministic limitations", async () => {
  const analysis = await analyzeRepositorySnapshot(fixture(), {
    inventoryLimits: { maxFiles: 1 },
    graph: {
      graphLimits: { ...defaultSolveGraphScanLimits, maxFiles: 1 },
    },
  });

  const left = createRepositoryAuditEvidenceCompleteness(analysis);
  const right = createRepositoryAuditEvidenceCompleteness(analysis);

  assert.deepEqual(left, right);
  assert.equal(left.status, "partial");
  assert.equal(left.truncated, true);
  assert.deepEqual(left.inventory.truncationReasons, ["file-count"]);
  assert.deepEqual(left.graph.truncationReasons, ["file-count"]);
  assert.deepEqual(left.limitations.map(({ scope, reason }) => ({ scope, reason })), [
    { scope: "inventory", reason: "file-count" },
    { scope: "graph", reason: "file-count" },
  ]);
  assert.ok(left.limitations.every((item) => item.message.includes("file-count")));
});

test("fails closed when aggregate execution truth drifts from emitted evidence", async () => {
  const analysis = await analyzeRepositorySnapshot(fixture());

  assert.throws(
    () => createRepositoryAuditEvidenceCompleteness({
      ...analysis,
      execution: {
        ...analysis.execution,
        redactedSecretMatches: analysis.execution.redactedSecretMatches + 1,
      },
    }),
    /redacted-secret count/,
  );

  assert.throws(
    () => createRepositoryAuditEvidenceCompleteness({
      ...analysis,
      execution: {
        ...analysis.execution,
        status: "partial",
      },
    }),
    /analysis status\/truncation truth/,
  );
});
