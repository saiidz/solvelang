import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositoryInventory, type RepositorySnapshot } from "./inventory";
import {
  createCanonicalRepositoryAuditReport,
  serializeCanonicalRepositoryAuditReport,
} from "./canonicalReport";
import { verifyRepositoryAuditIntegrity } from "./reportIntegrity";

function fixture(): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "fixture.zip",
      revision: `sha256:${"1".repeat(64)}`,
      fingerprint: `sha256:${"2".repeat(64)}`,
    },
    files: [
      {
        path: "src/main.ts",
        byteSize: 19,
        text: "export const x = 1;",
        sha256: "3".repeat(64),
      },
      {
        path: "src/main.ts.bak",
        byteSize: 19,
        text: "export const x = 2;",
        sha256: "4".repeat(64),
      },
      {
        path: "package.json",
        byteSize: 48,
        text: '{"dependencies":{"next":"15.0.0"}}',
        sha256: "5".repeat(64),
      },
    ],
  };
}

test("canonical report uses the published analyze-only shape and verifies its digest", async () => {
  const analysis = await analyzeRepositoryInventory(fixture());
  const timestamp = new Date("2026-08-13T20:00:00.000Z");
  const report = await createCanonicalRepositoryAuditReport(analysis, {
    generatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    archiveName: "fixture.zip",
  });

  assert.equal(report.schemaVersion, "1.0.0");
  assert.equal(report.mode, "analyze-only");
  assert.equal(report.engine.deterministic, true);
  assert.equal(report.source.kind, "archive");
  assert.equal(report.source.archiveName, "fixture.zip");
  assert.equal(report.execution.networkAccess, false);
  assert.equal(report.execution.writeAccess, false);
  assert.deepEqual(report.detections.secretExposureWarnings, []);
  assert.equal(report.redaction.secretValuesIncluded, false);
  assert.equal(report.redaction.redactedMatchCount, 0);
  assert.match(report.reportId, /^ra_[a-f0-9]{32}$/);
  assert.match(report.integrity.canonicalJsonSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await verifyRepositoryAuditIntegrity(report), true);
  assert.ok(serializeCanonicalRepositoryAuditReport(report).endsWith("\n"));
});

test("report identity is stable across generation timestamps for the same snapshot and limits", async () => {
  const analysis = await analyzeRepositoryInventory(fixture());
  const first = await createCanonicalRepositoryAuditReport(analysis, {
    generatedAt: new Date("2026-08-13T20:00:00.000Z"),
    archiveName: "fixture.zip",
  });
  const second = await createCanonicalRepositoryAuditReport(analysis, {
    generatedAt: new Date("2026-08-13T21:00:00.000Z"),
    archiveName: "fixture.zip",
  });

  assert.equal(first.reportId, second.reportId);
  assert.notEqual(first.generatedAt, second.generatedAt);
});

test("canonical findings remain deterministically ordered", async () => {
  const analysis = await analyzeRepositoryInventory(fixture());
  const report = await createCanonicalRepositoryAuditReport(analysis, {
    generatedAt: new Date("2026-08-13T20:00:00.000Z"),
    archiveName: "fixture.zip",
  });

  const ordering = report.findings.map((finding) => [
    finding.severity,
    finding.ruleId,
    finding.evidence[0]?.path ?? "",
    finding.id,
  ]);
  const rerun = await createCanonicalRepositoryAuditReport(analysis, {
    generatedAt: new Date("2026-08-13T20:00:00.000Z"),
    archiveName: "fixture.zip",
  });
  assert.deepEqual(ordering, rerun.findings.map((finding) => [
    finding.severity,
    finding.ruleId,
    finding.evidence[0]?.path ?? "",
    finding.id,
  ]));
});
