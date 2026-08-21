import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditSystemMetricsCoverageFindings } from "./systemMetricsCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(system: NonNullable<ServerAuditSnapshot["system"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T03:15:00.000Z",
    host: { hostname: "audit-host" },
    system,
    metadata: { redactionsApplied: true },
  };
}

test("system metric coverage reports missing bounded telemetry using structural evidence only", () => {
  const findings = createServerAuditSystemMetricsCoverageFindings(snapshot({
    uptimeSeconds: 3600,
    load: [0.5, 0.4, 0.3],
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "coverage");
  assert.equal(findings[0].title, "System telemetry evidence is incomplete");
  assert.deepEqual(findings[0].evidence, [
    { source: "system.memoryTotalBytes", summary: "metric missing" },
    { source: "system.memoryAvailableBytes", summary: "metric missing" },
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("3600"), false);
  assert.equal(serialized.includes("0.5"), false);
});

test("system metric coverage reports an incomplete load vector without echoing load values", () => {
  const findings = createServerAuditSystemMetricsCoverageFindings(snapshot({
    uptimeSeconds: 3600,
    load: [0.5, 0.4],
    memoryTotalBytes: 4096,
    memoryAvailableBytes: 2048,
  }));

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence, [
    { source: "system.load", summary: "load vector incomplete" },
  ]);
  assert.match(findings[0].summary, /missing or incomplete/);
  const serialized = JSON.stringify(findings);
  for (const privateMetricValue of ["3600", "0.5", "0.4", "4096", "2048"]) {
    assert.equal(serialized.includes(privateMetricValue), false);
  }
});

test("system metric coverage treats an empty supplied load vector as incomplete evidence", () => {
  const findings = createServerAuditSystemMetricsCoverageFindings(snapshot({
    uptimeSeconds: 0,
    load: [],
    memoryTotalBytes: 0,
    memoryAvailableBytes: 0,
  }));

  assert.deepEqual(findings[0]?.evidence, [
    { source: "system.load", summary: "load vector incomplete" },
  ]);
});

test("system metric coverage reports an explicitly sparse system section without inventing health", () => {
  const findings = createServerAuditSystemMetricsCoverageFindings(snapshot({}));

  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0].evidence.map((item) => item.source), [
    "system.uptimeSeconds",
    "system.load",
    "system.memoryTotalBytes",
    "system.memoryAvailableBytes",
  ]);
});

test("system metric coverage treats zero values as present and emits no finding for complete telemetry", () => {
  assert.deepEqual(createServerAuditSystemMetricsCoverageFindings(snapshot({
    uptimeSeconds: 0,
    load: [0, 0, 0],
    memoryTotalBytes: 0,
    memoryAvailableBytes: 0,
  })), []);
});

test("system metric coverage emits no duplicate finding when the whole system section is absent", () => {
  assert.deepEqual(createServerAuditSystemMetricsCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-21T03:15:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  }), []);
});
