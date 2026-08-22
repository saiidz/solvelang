import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditProcessIdentityCoverageFindings } from "./processIdentityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(processes: NonNullable<ServerAuditSnapshot["processes"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:30:00.000Z",
    host: { hostname: "audit-host" },
    processes,
    metadata: { redactionsApplied: true },
  };
}

test("process identity coverage reports blank normalized names using structural evidence only", () => {
  const findings = createServerAuditProcessIdentityCoverageFindings(snapshot([
    { pid: 101, ppid: 1, uid: 1000, state: "S", name: "   " },
    { pid: 102, ppid: 101, uid: 1000, state: "R", name: "\t" },
    { pid: 103, ppid: 1, uid: 1000, state: "S", name: "worker" },
  ]));

  assert.equal(findings.length, 2);
  assert.deepEqual(new Set(findings.map((finding) => finding.id)), new Set(["srv_fdf6a4af", "srv_88889518"]));
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "Process record lacks a usable identity"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "processes[0].name",
    "processes[1].name",
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("worker"), false);
  assert.equal(serialized.includes("101"), false);
  assert.equal(serialized.includes("102"), false);
});

test("process identity coverage treats normalized non-empty names as usable", () => {
  assert.deepEqual(createServerAuditProcessIdentityCoverageFindings(snapshot([
    { pid: 101, ppid: 1, uid: 1000, state: "S", name: " worker " },
    { pid: 102, ppid: 1, uid: 1000, state: "S", name: "é-worker" },
    { pid: 103, ppid: 1, uid: 1000, state: "S", name: "e\u0301-worker" },
  ])), []);
});

test("process identity coverage output is deterministic and bounded", () => {
  const processes = Array.from({ length: 105 }, (_, index) => ({
    pid: 1_000 + index,
    ppid: 1,
    uid: 1000,
    state: "S",
    name: "   ",
  }));
  const first = createServerAuditProcessIdentityCoverageFindings(snapshot(processes));
  const second = createServerAuditProcessIdentityCoverageFindings(snapshot(processes));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const identityFindings = first.filter((finding) => finding.title === "Process record lacks a usable identity");
  assert.equal(identityFindings.length, 99);
  const truncation = first.filter((finding) => finding.title === "Process identity coverage findings were truncated");
  assert.equal(truncation.length, 1);
  assert.equal(truncation[0]?.id, "srv_da0e5de4");
  const structuralSources = identityFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^processes\[\d+\]\.name$/.test(source)), true);
});

test("process identity coverage materializes only bounded findings for high-cardinality identity gaps", () => {
  const processes = Array.from({ length: 5_000 }, (_, index) => ({
    pid: 10_000 + index,
    ppid: 1,
    uid: 1000,
    state: `private-state-${index}`,
    name: "   ",
  }));

  const findings = createServerAuditProcessIdentityCoverageFindings(snapshot(processes));

  assert.equal(findings.length, 100);
  assert.equal(findings.filter((finding) => finding.title === "Process record lacks a usable identity").length, 99);
  assert.equal(findings.filter((finding) => finding.title === "Process identity coverage findings were truncated").length, 1);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-state-"), false);
  assert.equal(serialized.includes("10000"), false);
});

test("process identity coverage emits no finding when process evidence is absent", () => {
  assert.deepEqual(createServerAuditProcessIdentityCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:30:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
});
