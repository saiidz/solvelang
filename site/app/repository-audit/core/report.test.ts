import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRepositorySnapshot } from "./analysisPipeline";
import { analyzeRepositoryInventory, type RepositorySnapshot } from "./inventory";
import { ingestArchiveSnapshotEntries } from "./ingestion";
import { createRepositoryAuditHtmlReport, createRepositoryAuditProductReport, repositoryAuditSafeFilename } from "./report";

const encoder = new TextEncoder();

const snapshot: RepositorySnapshot = {
  source: {
    kind: "archive",
    displayName: '<img src=x onerror="alert(1)">.zip',
    revision: `sha256:${"1".repeat(64)}`,
    fingerprint: `sha256:${"2".repeat(64)}`,
  },
  files: [
    { path: "src/a.ts", byteSize: 1, sha256: "3".repeat(64) },
    { path: "src/a.backup.ts", byteSize: 1, sha256: "3".repeat(64) },
  ],
};

const exposedTestToken = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ123456";
const reportHmacKey = new Uint8Array(32).fill(11);

function intelligenceSnapshot(): RepositorySnapshot {
  return {
    source: {
      kind: "archive",
      displayName: "intelligence.zip",
      revision: `sha256:${"4".repeat(64)}`,
      fingerprint: `sha256:${"5".repeat(64)}`,
    },
    files: [
      {
        path: "src/store.ts",
        byteSize: 24,
        sha256: "6".repeat(64),
        text: "export const store = 1;\n",
      },
      {
        path: "src/api.ts",
        byteSize: 100,
        sha256: "7".repeat(64),
        text: `import { store } from "./store";\nconst token = "${exposedTestToken}";\nexport { store };\n`,
      },
    ],
  };
}

test("creates a stable product report with explicit analyze-only boundaries", async () => {
  const ingestion = await ingestArchiveSnapshotEntries({
    archiveName: "repository.zip",
    archiveBytes: encoder.encode("archive"),
    entries: [
      { path: "src/a.ts", kind: "file", bytes: encoder.encode("x") },
      { path: "src/a.backup.ts", kind: "file", bytes: encoder.encode("x") },
    ],
  });
  const analysis = analyzeRepositoryInventory(snapshot);
  const report = createRepositoryAuditProductReport({
    archiveName: "repository.zip",
    ingestion,
    analysis,
    now: new Date("2026-07-28T12:00:00.000Z"),
  });
  assert.equal(report.schema, "solvelang.repository-audit.product-report.v0");
  assert.equal(report.generatedAt, "2026-07-28T12:00:00.000Z");
  assert.equal(report.analysis.mode, "analyze-only");
  assert.equal(report.analysis.execution.writeAccess, false);
  assert.equal(report.intelligence, undefined);
});

test("creates self-contained printable HTML and escapes archive plus evidence text", async () => {
  const ingestion = await ingestArchiveSnapshotEntries({
    archiveName: "repository.zip",
    archiveBytes: encoder.encode("archive"),
    entries: [{ path: "safe.txt", kind: "file", bytes: encoder.encode("safe") }],
  });
  const analysis = analyzeRepositoryInventory(snapshot);
  analysis.findings[0].evidence[0].note = '<script>alert("evidence")</script>';
  const report = createRepositoryAuditProductReport({
    archiveName: '<img src=x onerror="alert(1)">.zip',
    ingestion,
    analysis,
    now: new Date("2026-07-28T12:00:00.000Z"),
  });
  const html = createRepositoryAuditHtmlReport(report);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(html.includes("SolveLang Repository Audit"));
  assert.ok(html.includes("Human approval required"));
  assert.ok(html.includes("&lt;img"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(!html.includes('<img src=x onerror="alert(1)">'));
  assert.ok(!html.includes('<script>alert("evidence")</script>'));
  assert.ok(!html.includes("https://"));
});

test("exports bounded graph intelligence, evidence completeness, and redacted credential warnings without correlation fingerprints", async () => {
  const source = intelligenceSnapshot();
  const ingestion = await ingestArchiveSnapshotEntries({
    archiveName: "intelligence.zip",
    archiveBytes: encoder.encode("archive-intelligence"),
    entries: source.files.map((file) => ({ path: file.path, kind: "file" as const, bytes: encoder.encode(file.text ?? "") })),
  });
  const intelligence = await analyzeRepositorySnapshot(source, { secretHmacKey: reportHmacKey });
  const report = createRepositoryAuditProductReport({
    archiveName: "intelligence.zip",
    ingestion,
    analysis: intelligence.inventory,
    intelligence,
    now: new Date("2026-08-17T09:00:00.000Z"),
  });

  assert.equal(report.intelligence?.schema, "solvelang.repository-audit.product-intelligence.v0");
  assert.ok((report.intelligence?.graph.counts.nodes ?? 0) >= 2);
  assert.ok((report.intelligence?.graph.counts.edges ?? 0) >= 1);
  assert.equal(report.intelligence?.evidenceCompleteness.schema, "solvelang.repository-audit.evidence-completeness.v0");
  assert.equal(report.intelligence?.evidenceCompleteness.status, "complete");
  assert.equal(report.intelligence?.evidenceCompleteness.secretAnalysis.filesScanned, intelligence.execution.secretFilesScanned);
  assert.equal(report.intelligence?.securityWarnings.length, 1);
  assert.equal(report.intelligence?.securityWarnings[0].path, "src/api.ts");
  assert.ok(!("fingerprint" in (report.intelligence?.securityWarnings[0] ?? {})));

  const serialized = JSON.stringify(report);
  const html = createRepositoryAuditHtmlReport(report);
  assert.ok(html.includes("Evidence completeness"));
  assert.ok(html.includes("No bounded scan limit truncated"));
  assert.ok(html.includes("Dependency intelligence"));
  assert.ok(html.includes("Redacted credential warnings"));
  assert.ok(html.includes("src/api.ts"));
  assert.ok(html.includes("token"));
  assert.ok(!serialized.includes(exposedTestToken));
  assert.ok(!serialized.includes("hmac-sha256:"));
  assert.ok(!html.includes(exposedTestToken));
  assert.ok(!html.includes("hmac-sha256:"));
});

test("refuses to combine inventory and intelligence from different repository snapshots", async () => {
  const ingestion = await ingestArchiveSnapshotEntries({
    archiveName: "repository.zip",
    archiveBytes: encoder.encode("archive"),
    entries: [{ path: "safe.txt", kind: "file", bytes: encoder.encode("safe") }],
  });
  const intelligence = await analyzeRepositorySnapshot(intelligenceSnapshot(), { secretHmacKey: reportHmacKey });
  assert.throws(
    () => createRepositoryAuditProductReport({
      archiveName: "repository.zip",
      ingestion,
      analysis: analyzeRepositoryInventory(snapshot),
      intelligence,
    }),
    /source does not match/,
  );
});

test("normalizes download filenames", () => {
  assert.equal(repositoryAuditSafeFilename("My Project (final).tar.gz"), "My-Project-final-.tar");
  assert.equal(repositoryAuditSafeFilename("***"), "repository");
});
