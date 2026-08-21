import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditFilesystemCapacityCoverageFindings } from "./filesystemCapacityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(filesystems: NonNullable<ServerAuditSnapshot["filesystems"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:25:00.000Z",
    host: { hostname: "audit-host" },
    filesystems,
    metadata: { redactionsApplied: true },
  };
}

test("filesystem capacity coverage reports supplied records that omit usagePercent", () => {
  const findings = createServerAuditFilesystemCapacityCoverageFindings(snapshot([
    { mount: "/private-a", filesystem: "/dev/private-a", usagePercent: 42 },
    { mount: "/private-b", filesystem: "/dev/private-b" },
    { mount: "/private-c", filesystem: "/dev/private-c" },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Filesystem usage evidence is incomplete");
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "coverage");
  assert.ok(findings[0].summary.includes("2 of 3 supplied filesystem record(s) omit usagePercent"));
  assert.deepEqual(findings[0].evidence, [
    { source: "filesystems[1].usagePercent", summary: "usagePercent missing" },
    { source: "filesystems[2].usagePercent", summary: "usagePercent missing" },
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-a"), false);
  assert.equal(serialized.includes("private-b"), false);
  assert.equal(serialized.includes("private-c"), false);
  assert.equal(serialized.includes("/dev/private"), false);
});

test("filesystem capacity coverage leaves absent, empty, and complete inventories to their existing stages", () => {
  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:25:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };

  assert.deepEqual(createServerAuditFilesystemCapacityCoverageFindings(absent), []);
  assert.deepEqual(createServerAuditFilesystemCapacityCoverageFindings(snapshot([])), []);
  assert.deepEqual(createServerAuditFilesystemCapacityCoverageFindings(snapshot([
    { mount: "/private-a", usagePercent: 0 },
    { mount: "/private-b", usagePercent: 100 },
  ])), []);
});

test("filesystem capacity coverage is deterministic and bounds structural evidence", () => {
  const filesystems = Array.from({ length: 150 }, (_, index) => ({
    mount: `/private-${index}`,
    filesystem: `/dev/private-${index}`,
  }));

  const first = createServerAuditFilesystemCapacityCoverageFindings(snapshot(filesystems));
  const second = createServerAuditFilesystemCapacityCoverageFindings(snapshot(filesystems));

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].evidence.length, 100);
  assert.deepEqual(first[0].evidence[0], {
    source: "filesystems[0].usagePercent",
    summary: "usagePercent missing",
  });
  assert.deepEqual(first[0].evidence[99], {
    source: "filesystems[99].usagePercent",
    summary: "usagePercent missing",
  });
  assert.ok(first[0].summary.includes("150 of 150 supplied filesystem record(s) omit usagePercent"));
  assert.ok(first[0].summary.includes("Only the first 100 structural reference(s) are included."));
  assert.equal(JSON.stringify(first).includes("filesystems[100].usagePercent"), false);
  assert.equal(JSON.stringify(first).includes("private-149"), false);
});
