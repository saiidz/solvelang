import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositorySnapshot } from "./analysisPipeline";
import { analyzeRepositoryInventory, type RepositorySnapshot } from "./inventory";
import {
  createCanonicalRepositoryAuditReport,
  serializeCanonicalRepositoryAuditReport,
} from "./canonicalReport";
import { verifyRepositoryAuditIntegrity } from "./reportIntegrity";

const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const hmacKey = new Uint8Array(32).fill(17);

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

function intelligenceFixture(): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "intelligence.zip",
      revision: `sha256:${"6".repeat(64)}`,
      fingerprint: `sha256:${"7".repeat(64)}`,
    },
    files: [
      {
        path: "src/store.ts",
        byteSize: 24,
        text: "export const store = 1;\n",
        sha256: "8".repeat(64),
      },
      {
        path: "src/api.ts",
        byteSize: 100,
        text: `import { store } from "./store";\nconst token = "${secret}";\nexport { store };\n`,
        sha256: "9".repeat(64),
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
  assert.equal(report.redaction.secretCorrelationFingerprintsIncluded, false);
  assert.equal(report.redaction.redactedMatchCount, 0);
  assert.match(report.reportId, /^ra_[a-f0-9]{32}$/);
  assert.match(report.integrity.canonicalJsonSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(await verifyRepositoryAuditIntegrity(report), true);
  assert.ok(serializeCanonicalRepositoryAuditReport(report).endsWith("\n"));
});

test("version 1.1 canonical report includes bounded graph intelligence and sanitized secret warnings inside the integrity digest", async () => {
  const intelligence = await analyzeRepositorySnapshot(intelligenceFixture(), { secretHmacKey: hmacKey });
  const timestamp = new Date("2026-08-17T09:30:00.000Z");
  const report = await createCanonicalRepositoryAuditReport(intelligence.inventory, {
    generatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    archiveName: "intelligence.zip",
    intelligence,
  });

  assert.equal(report.schemaVersion, "1.1.0");
  assert.equal(report.execution.status, "complete");
  assert.ok((report.summary.graphNodes ?? 0) >= 2);
  assert.ok((report.summary.graphEdges ?? 0) >= 1);
  assert.equal(report.summary.redactedSecretMatches, 1);
  assert.ok(report.graph);
  assert.equal(report.graph?.graphId, intelligence.graph.graph.graphId);
  assert.equal(report.detections.secretExposureWarnings.length, 1);
  assert.equal(report.detections.secretExposureWarnings[0].path, "src/api.ts");
  assert.ok(!("fingerprint" in report.detections.secretExposureWarnings[0]));
  assert.equal(report.redaction.secretValuesIncluded, false);
  assert.equal(report.redaction.secretCorrelationFingerprintsIncluded, false);
  assert.equal(report.redaction.redactedMatchCount, 1);
  assert.equal(await verifyRepositoryAuditIntegrity(report), true);

  const serialized = serializeCanonicalRepositoryAuditReport(report);
  assert.ok(!serialized.includes(secret));
  assert.ok(!serialized.includes("hmac-sha256:"));
});

test("canonical intelligence ordering and digest are reproducible for the same bounded analysis", async () => {
  const leftIntelligence = await analyzeRepositorySnapshot(intelligenceFixture(), { secretHmacKey: hmacKey });
  const rightIntelligence = await analyzeRepositorySnapshot(intelligenceFixture(), { secretHmacKey: hmacKey });
  const timestamp = new Date("2026-08-17T09:30:00.000Z");
  const left = await createCanonicalRepositoryAuditReport(leftIntelligence.inventory, {
    generatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    archiveName: "intelligence.zip",
    intelligence: leftIntelligence,
  });
  const right = await createCanonicalRepositoryAuditReport(rightIntelligence.inventory, {
    generatedAt: timestamp,
    startedAt: timestamp,
    finishedAt: timestamp,
    archiveName: "intelligence.zip",
    intelligence: rightIntelligence,
  });

  assert.deepEqual(left.graph?.hotspots, right.graph?.hotspots);
  assert.deepEqual(left.detections.secretExposureWarnings, right.detections.secretExposureWarnings);
  assert.equal(left.integrity.canonicalJsonSha256, right.integrity.canonicalJsonSha256);
});

test("canonical report refuses intelligence from a different snapshot", async () => {
  const analysis = analyzeRepositoryInventory(fixture());
  const intelligence = await analyzeRepositorySnapshot(intelligenceFixture(), { secretHmacKey: hmacKey });
  await assert.rejects(
    createCanonicalRepositoryAuditReport(analysis, { archiveName: "fixture.zip", intelligence }),
    /source does not match/,
  );
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
