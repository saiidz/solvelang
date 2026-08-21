import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditProcessStateCoverageFindings } from "./processStateCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(processes: NonNullable<ServerAuditSnapshot["processes"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:30:00.000Z",
    host: { hostname: "audit-host" },
    processes,
    metadata: { redactionsApplied: true },
  };
}

test("process state coverage reports blank normalized state using structural evidence only", () => {
  const findings = createServerAuditProcessStateCoverageFindings(snapshot([
    { pid: 101, ppid: 1, uid: 1000, state: "   ", name: "private-api" },
    { pid: 102, ppid: 1, uid: 1000, state: "\t", name: "private-worker" },
    { pid: 103, ppid: 1, uid: 1000, state: "S", name: "private-ok" },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "Process record lacks usable state evidence"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "processes[0].state",
    "processes[1].state",
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-api"), false);
  assert.equal(serialized.includes("private-worker"), false);
  assert.equal(serialized.includes("private-ok"), false);
  assert.equal(serialized.includes("101"), false);
  assert.equal(serialized.includes("102"), false);
  assert.equal(serialized.includes("1000"), false);
});

test("process state coverage treats normalized non-empty states as usable without interpreting them", () => {
  assert.deepEqual(createServerAuditProcessStateCoverageFindings(snapshot([
    { pid: 201, ppid: 1, uid: 0, state: " S ", name: "sleeping" },
    { pid: 202, ppid: 1, uid: 0, state: "Z", name: "zombie-observed-elsewhere" },
    { pid: 203, ppid: 1, uid: 0, state: "mystery-state", name: "custom" },
  ])), []);
});

test("process state coverage output is deterministic and bounded", () => {
  const processes = Array.from({ length: 105 }, (_, index) => ({
    pid: index + 1,
    ppid: 0,
    uid: 1000,
    state: "   ",
    name: `private-process-${index}`,
  }));
  const first = createServerAuditProcessStateCoverageFindings(snapshot(processes));
  const second = createServerAuditProcessStateCoverageFindings(snapshot(processes));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const stateFindings = first.filter((finding) => finding.title === "Process record lacks usable state evidence");
  assert.equal(stateFindings.length, 99);
  assert.equal(first.filter((finding) => finding.title === "Process state coverage findings were truncated").length, 1);
  const structuralSources = stateFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^processes\[\d+\]\.state$/.test(source)), true);
  assert.equal(JSON.stringify(first).includes("private-process-104"), false);
});

test("process state coverage emits no finding for absent or explicitly empty process evidence", () => {
  assert.deepEqual(createServerAuditProcessStateCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:30:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
  assert.deepEqual(createServerAuditProcessStateCoverageFindings(snapshot([])), []);
});
