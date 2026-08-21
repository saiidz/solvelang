import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditFilesystemByteCoverageFindings } from "./filesystemByteCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(filesystems: NonNullable<ServerAuditSnapshot["filesystems"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T05:55:00.000Z",
    host: { hostname: "audit-host" },
    filesystems,
    metadata: { redactionsApplied: true },
  };
}

test("filesystem byte coverage reports missing size, used, and available evidence structurally", () => {
  const findings = createServerAuditFilesystemByteCoverageFindings(snapshot([
    { mount: "/private-a", filesystem: "/dev/private-a", sizeBytes: 100, usedBytes: 50, availableBytes: 50 },
    { mount: "/private-b", filesystem: "/dev/private-b", sizeBytes: 100, availableBytes: 50 },
    { mount: "/private-c", filesystem: "/dev/private-c", usedBytes: 20, availableBytes: 80 },
    { mount: "/private-d", filesystem: "/dev/private-d", sizeBytes: 100, usedBytes: 20 },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Filesystem byte-accounting evidence is incomplete");
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "coverage");
  assert.ok(findings[0].summary.includes("1 sizeBytes, 1 usedBytes, and 1 availableBytes"));
  assert.deepEqual(findings[0].evidence, [
    { source: "filesystems[2].sizeBytes", summary: "sizeBytes missing" },
    { source: "filesystems[1].usedBytes", summary: "usedBytes missing" },
    { source: "filesystems[3].availableBytes", summary: "availableBytes missing" },
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-a"), false);
  assert.equal(serialized.includes("private-b"), false);
  assert.equal(serialized.includes("private-c"), false);
  assert.equal(serialized.includes("private-d"), false);
  assert.equal(serialized.includes("/dev/private"), false);
});

test("filesystem byte coverage leaves absent, empty, and complete inventories to existing stages", () => {
  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-21T05:55:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };

  assert.deepEqual(createServerAuditFilesystemByteCoverageFindings(absent), []);
  assert.deepEqual(createServerAuditFilesystemByteCoverageFindings(snapshot([])), []);
  assert.deepEqual(createServerAuditFilesystemByteCoverageFindings(snapshot([
    { mount: "/private-a", sizeBytes: 0, usedBytes: 0, availableBytes: 0 },
    { mount: "/private-b", sizeBytes: 100, usedBytes: 100, availableBytes: 0 },
  ])), []);
});

test("filesystem byte coverage is deterministic, bounded, and fair across evidence dimensions", () => {
  const filesystems = [
    ...Array.from({ length: 120 }, (_, index) => ({
      mount: `/private-size-${index}`,
      filesystem: `/dev/private-size-${index}`,
      usedBytes: 20,
      availableBytes: 80,
    })),
    ...Array.from({ length: 120 }, (_, index) => ({
      mount: `/private-used-${index}`,
      filesystem: `/dev/private-used-${index}`,
      sizeBytes: 100,
      availableBytes: 80,
    })),
    ...Array.from({ length: 120 }, (_, index) => ({
      mount: `/private-available-${index}`,
      filesystem: `/dev/private-available-${index}`,
      sizeBytes: 100,
      usedBytes: 20,
    })),
  ];

  const first = createServerAuditFilesystemByteCoverageFindings(snapshot(filesystems));
  const second = createServerAuditFilesystemByteCoverageFindings(snapshot(filesystems));

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].evidence.length, 100);
  assert.deepEqual(first[0].evidence.slice(0, 6), [
    { source: "filesystems[0].sizeBytes", summary: "sizeBytes missing" },
    { source: "filesystems[120].usedBytes", summary: "usedBytes missing" },
    { source: "filesystems[240].availableBytes", summary: "availableBytes missing" },
    { source: "filesystems[1].sizeBytes", summary: "sizeBytes missing" },
    { source: "filesystems[121].usedBytes", summary: "usedBytes missing" },
    { source: "filesystems[241].availableBytes", summary: "availableBytes missing" },
  ]);
  assert.ok(first[0].summary.includes("120 sizeBytes, 120 usedBytes, and 120 availableBytes"));
  assert.ok(first[0].summary.includes("Only the first 100 structural reference(s) are included."));
  assert.equal(JSON.stringify(first).includes("private-size"), false);
  assert.equal(JSON.stringify(first).includes("private-used"), false);
  assert.equal(JSON.stringify(first).includes("private-available"), false);
});
