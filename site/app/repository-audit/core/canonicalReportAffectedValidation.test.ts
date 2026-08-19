import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositorySnapshot } from "./analysisPipeline";
import type { RepositorySnapshot } from "./inventory";
import {
  createCanonicalRepositoryAuditReport,
  serializeCanonicalRepositoryAuditReport,
} from "./canonicalReport";
import { verifyRepositoryAuditIntegrity } from "./reportIntegrity";

function fixture(): RepositorySnapshot {
  const workflow = [
    "jobs:",
    "  test:",
    "    defaults:",
    "      run:",
    "        working-directory: src",
    "" ,
  ].join("\n");
  return {
    source: {
      kind: "archive",
      displayName: "affected-validation.zip",
      revision: `sha256:${"a".repeat(64)}`,
      fingerprint: `sha256:${"b".repeat(64)}`,
    },
    files: [
      { path: "src/core.ts", byteSize: 23, text: "export const core = 1;\n" },
      { path: "tests/core.test.ts", byteSize: 29, text: 'import "../src/core";\n' },
      { path: ".github/workflows/ci.yml", byteSize: workflow.length, text: workflow },
    ],
  };
}

test("canonical report includes bounded affected-validation evidence inside the integrity digest", async () => {
  const intelligence = await analyzeRepositorySnapshot(fixture(), {
    affectedValidation: { changedPaths: ["src/core.ts"] },
  });
  const timestamp = new Date("2026-08-19T02:00:00.000Z");
  const report = await createCanonicalRepositoryAuditReport(intelligence.inventory, {
    generatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    archiveName: "affected-validation.zip",
    intelligence,
  });

  assert.equal(report.schemaVersion, "1.2.0");
  assert.equal(report.summary.affectedTestFiles, 1);
  assert.equal(report.summary.affectedWorkflowFiles, 1);
  assert.ok(report.affectedValidation);
  assert.equal(report.affectedValidation.status, "complete");
  assert.equal(report.affectedValidation.graphId, intelligence.graph.graph.graphId);
  assert.deepEqual(report.affectedValidation.entries[0].tests.map((item) => item.testPath), ["tests/core.test.ts"]);
  assert.deepEqual(report.affectedValidation.entries[0].workflows.map((item) => item.workflowPath), [".github/workflows/ci.yml"]);
  assert.equal(report.affectedValidation.execution.networkAccess, false);
  assert.equal(report.affectedValidation.execution.writeAccess, false);
  assert.equal(await verifyRepositoryAuditIntegrity(report), true);

  const serialized = serializeCanonicalRepositoryAuditReport(report);
  assert.ok(serialized.includes('"affectedValidation"'));
  assert.ok(serialized.includes('"src/core.ts"'));
});

test("canonical intelligence without a changed-path request keeps the existing 1.1 shape", async () => {
  const intelligence = await analyzeRepositorySnapshot(fixture());
  const timestamp = new Date("2026-08-19T02:00:00.000Z");
  const report = await createCanonicalRepositoryAuditReport(intelligence.inventory, {
    generatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    archiveName: "affected-validation.zip",
    intelligence,
  });

  assert.equal(report.schemaVersion, "1.1.0");
  assert.ok(!("affectedValidation" in report));
  assert.ok(!("affectedTestFiles" in report.summary));
  assert.equal(await verifyRepositoryAuditIntegrity(report), true);
});
