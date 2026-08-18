import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditInventorySummary } from "./inventorySummary";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-17T23:00:00.000Z",
    host: { hostname: "private-host" },
    filesystems: [],
    listeningSockets: [{ protocol: "tcp", localAddress: "127.0.0.1", port: 8080, process: "private-process" }],
    processes: [{ pid: 10, ppid: 1, uid: 1000, state: "S", name: "private-process" }],
    services: [{ name: "private.service", state: "active" }],
    packages: [{ name: "private-package", version: "1.0.0" }],
    scheduledJobs: [],
    web: { servers: ["private-web"], roots: [], certificates: [] },
    backups: [],
    metadata: { redactionsApplied: true },
  };
}

test("inventory summary distinguishes collected-empty from absent sections using counts only", () => {
  const summary = createServerAuditInventorySummary(snapshot());
  assert.deepEqual(summary.sections, [
    { section: "filesystems", status: "collected", count: 0 },
    { section: "listeningSockets", status: "collected", count: 1 },
    { section: "processes", status: "collected", count: 1 },
    { section: "services", status: "collected", count: 1 },
    { section: "packages", status: "collected", count: 1 },
    { section: "scheduledJobs", status: "collected", count: 0 },
    { section: "webServers", status: "collected", count: 1 },
    { section: "webRoots", status: "collected", count: 0 },
    { section: "certificates", status: "collected", count: 0 },
    { section: "backups", status: "collected", count: 0 },
    { section: "logs", status: "not-collected" },
  ]);
  assert.equal(summary.execution.networkAccess, false);
  assert.equal(summary.execution.writeAccess, false);
});

test("inventory summary contains no raw host, process, service, package, or web-server identifiers", () => {
  const serialized = JSON.stringify(createServerAuditInventorySummary(snapshot()));
  for (const sensitive of ["private-host", "private-process", "private.service", "private-package", "private-web"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
});

test("inventory summary is deterministic", () => {
  const input = snapshot();
  assert.deepEqual(createServerAuditInventorySummary(input), createServerAuditInventorySummary(input));
});
