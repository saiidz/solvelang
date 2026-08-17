import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditCoverageFindings } from "./coverageFindings";
import { parseServerAuditSnapshot } from "./snapshot";

function snapshot(processes: unknown) {
  return JSON.stringify({
    schemaVersion: "1",
    collectedAt: "2026-08-17T22:30:00.000Z",
    host: { hostname: "audit-host" },
    processes,
    metadata: { redactionsApplied: true },
  });
}

test("process inventory accepts bounded metadata without command lines", () => {
  const parsed = parseServerAuditSnapshot(snapshot([
    { pid: 1, ppid: 0, uid: 0, state: "Ss", name: "systemd" },
    { pid: 4242, ppid: 1, uid: 1001, state: "S", name: "node" },
  ]));

  assert.deepEqual(parsed.processes, [
    { pid: 1, ppid: 0, uid: 0, state: "Ss", name: "systemd" },
    { pid: 4242, ppid: 1, uid: 1001, state: "S", name: "node" },
  ]);
});

test("process inventory rejects command-line fields and invalid identifiers", () => {
  assert.throws(
    () => parseServerAuditSnapshot(snapshot([{ pid: 10, ppid: 1, uid: 1000, state: "S", name: "node", args: "node app.js --secret=x" }])),
    /unknown field args/,
  );
  assert.throws(
    () => parseServerAuditSnapshot(snapshot([{ pid: 0, ppid: 0, uid: 1000, state: "S", name: "node" }])),
    /processes\[0\]\.pid is invalid/,
  );
  assert.throws(
    () => parseServerAuditSnapshot(snapshot([{ pid: 10.5, ppid: 1, uid: 1000, state: "S", name: "node" }])),
    /processes\[0\]\.pid is invalid/,
  );
  assert.throws(
    () => parseServerAuditSnapshot(snapshot([{ pid: 10, ppid: 1, uid: 4_294_967_296, state: "S", name: "node" }])),
    /processes\[0\]\.uid is invalid/,
  );
});

test("coverage distinguishes absent process evidence from an explicit empty inventory", () => {
  const missing = parseServerAuditSnapshot(JSON.stringify({
    schemaVersion: "1",
    collectedAt: "2026-08-17T22:30:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  }));
  assert.ok(createServerAuditCoverageFindings(missing).some((finding) => finding.evidence.some((item) => item.source === "snapshot.processes")));

  const empty = parseServerAuditSnapshot(snapshot([]));
  assert.ok(!createServerAuditCoverageFindings(empty).some((finding) => finding.evidence.some((item) => item.source === "snapshot.processes")));
});