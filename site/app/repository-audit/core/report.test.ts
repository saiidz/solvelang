import assert from "node:assert/strict";
import test from "node:test";
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

test("normalizes download filenames", () => {
  assert.equal(repositoryAuditSafeFilename("My Project (final).tar.gz"), "My-Project-final-.tar");
  assert.equal(repositoryAuditSafeFilename("***"), "repository");
});
