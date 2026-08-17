import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditCoverageFindings } from "./coverageFindings";
import { createServerAuditReport } from "./report";
import type { ServerAuditSnapshot } from "./types";

function completeSnapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-17T21:30:00.000Z",
    host: { hostname: "coverage-host" },
    system: {},
    filesystems: [],
    listeningSockets: [],
    processes: [],
    services: [],
    packages: [],
    scheduledJobs: [],
    web: { servers: [], roots: [], certificates: [] },
    backups: [],
    logs: [],
    security: {},
    metadata: { redactionsApplied: true },
  };
}

test("coverage findings report only structurally absent snapshot sections", () => {
  const snapshot: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-17T21:30:00.000Z",
    host: { hostname: "private-hostname" },
    filesystems: [],
    services: [],
    web: { roots: [] },
    metadata: { redactionsApplied: true },
  };

  const findings = createServerAuditCoverageFindings(snapshot);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.severity, "info");
  assert.equal(findings[0]?.category, "coverage");
  assert.ok(findings[0]?.evidence.some((item) => item.source === "snapshot.packages"));
  assert.ok(findings[0]?.evidence.some((item) => item.source === "snapshot.web.certificates"));
  assert.equal(findings[0]?.evidence.some((item) => item.source === "snapshot.filesystems"), false);
  assert.equal(JSON.stringify(findings).includes("private-hostname"), false);
});

test("explicit empty inventories count as collected coverage", () => {
  assert.deepEqual(createServerAuditCoverageFindings(completeSnapshot()), []);
});

test("coverage evidence composes deterministically into reports without affecting score", () => {
  const snapshot: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-17T21:30:00.000Z",
    host: { hostname: "coverage-host" },
    metadata: { redactionsApplied: true },
  };
  const first = createServerAuditReport(snapshot, "2026-08-17T21:31:00.000Z");
  const second = createServerAuditReport(snapshot, "2026-08-17T22:31:00.000Z");
  const coverage = first.findings.filter((finding) => finding.title === "Read-only snapshot coverage is incomplete");

  assert.equal(coverage.length, 1);
  assert.equal(first.reportId, second.reportId);
  assert.equal(first.summary.score, second.summary.score);
  assert.ok(first.limitations.some((item) => item.includes("Coverage-gap")));
});