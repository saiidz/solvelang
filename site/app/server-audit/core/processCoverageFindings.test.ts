import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditProcessCoverageFindings } from "./processCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(processes: NonNullable<ServerAuditSnapshot["processes"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:10:00.000Z",
    host: { hostname: "audit-host" },
    processes,
    metadata: { redactionsApplied: true },
  };
}

test("process coverage reports explicit empty inventory but leaves absent section to generic coverage", () => {
  const empty = createServerAuditProcessCoverageFindings(snapshot([]));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].title, "No process records supplied");
  assert.deepEqual(empty[0].evidence, [{ source: "processes", summary: "0 process records" }]);

  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:10:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
  assert.deepEqual(createServerAuditProcessCoverageFindings(absent), []);
});

test("process coverage does not report a concrete process inventory", () => {
  const findings = createServerAuditProcessCoverageFindings(snapshot([
    { pid: 42, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
  ]));
  assert.deepEqual(findings, []);
});

test("process coverage output is deterministic and emits structural evidence only", () => {
  const first = createServerAuditProcessCoverageFindings(snapshot([]));
  const second = createServerAuditProcessCoverageFindings(snapshot([]));

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first).includes("private-worker"), false);
});
