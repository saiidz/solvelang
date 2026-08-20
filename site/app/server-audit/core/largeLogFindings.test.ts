import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditLargeLogFindings } from "./largeLogFindings";
import { createServerAuditReport } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(logs: NonNullable<ServerAuditSnapshot["logs"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T18:30:00.000Z",
    host: { hostname: "audit-host" },
    logs,
  };
}

test("large-log findings use structural evidence and never expose log paths", () => {
  const findings = createServerAuditLargeLogFindings(snapshot([
    { path: "/var/log/private-customer-name.log", sizeBytes: 6 * 1024 * 1024 * 1024 },
    { path: "/var/log/small.log", sizeBytes: 1024 },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
  assert.equal(findings[0].title, "Very large log file");
  assert.equal(findings[0].evidence[0].source, "logs[0].sizeBytes");
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-customer-name"), false);
  assert.equal(serialized.includes("/var/log"), false);
});

test("large-log findings are deterministic and bounded", () => {
  const logs = Array.from({ length: 10 }, (_, index) => ({
    path: `/var/log/private-${index}.log`,
    sizeBytes: 10_000 + index,
  }));
  const input = snapshot(logs);
  const first = createServerAuditLargeLogFindings(input, { thresholdBytes: 1, maxFindings: 4 });
  const second = createServerAuditLargeLogFindings(input, { thresholdBytes: 1, maxFindings: 4 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(first.filter((finding) => finding.title === "Large-log findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("private-"), false);
});

test("large-log option bounds fail closed", () => {
  const input = snapshot([]);
  assert.throws(() => createServerAuditLargeLogFindings(input, { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditLargeLogFindings(input, { thresholdBytes: 0 }), /thresholdBytes/);
  assert.throws(() => createServerAuditLargeLogFindings(input, { thresholdBytes: Number.MAX_SAFE_INTEGER + 1 }), /thresholdBytes/);
});

test("canonical reports compose bounded redacted large-log evidence", () => {
  const report = createServerAuditReport(snapshot([
    { path: "/var/log/private-customer-name.log", sizeBytes: 6 * 1024 * 1024 * 1024 },
  ]), "2026-08-20T07:00:00.000Z");

  const findings = report.findings.filter((finding) => finding.title === "Very large log file");
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence, [{ source: "logs[0].sizeBytes", summary: `${6 * 1024 * 1024 * 1024} bytes` }]);
  assert.equal(JSON.stringify(report).includes("private-customer-name"), false);
  assert.equal(JSON.stringify(report).includes("/var/log"), false);
});
