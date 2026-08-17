import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerAuditProcessRelationships } from "./processRelationships";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-17T23:00:00.000Z",
    host: { hostname: "audit-host" },
    processes: [
      { pid: 10, ppid: 1, uid: 0, state: "S", name: "private-parent" },
      { pid: 11, ppid: 10, uid: 1000, state: "S", name: "private-child" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "shared-worker" },
      { pid: 21, ppid: 1, uid: 1000, state: "S", name: "shared-worker" },
    ],
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "private-child" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3001, process: "shared-worker" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3002, process: "missing-worker" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3003 },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("process relationship analysis maps bounded parent and listener evidence without raw names", () => {
  const analysis = analyzeServerAuditProcessRelationships(snapshot());

  assert.deepEqual(
    analysis.relationships.map((relationship) => relationship.kind).sort(),
    ["parent-process", "listener-process", "ambiguous-listener-process"].sort(),
  );
  assert.equal(analysis.summary.processesChecked, 4);
  assert.equal(analysis.summary.listenersChecked, 4);
  assert.equal(analysis.summary.parentRelationshipsFound, 1);
  assert.equal(analysis.summary.listenerRelationshipsFound, 1);
  assert.equal(analysis.summary.ambiguousListenerAttributions, 1);
  assert.equal(analysis.summary.unresolvedListenerAttributions, 1);
  assert.equal(analysis.summary.duplicateProcessIdsSkipped, 0);
  assert.equal(analysis.summary.relationshipsWithTruncatedSources, 0);
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);

  const serialized = JSON.stringify(analysis);
  for (const sensitive of ["private-parent", "private-child", "shared-worker", "missing-worker"]) {
    assert.equal(serialized.includes(sensitive), false);
  }
  assert.ok(serialized.includes("processes[0]"));
  assert.ok(serialized.includes("processes[1]"));
  assert.ok(serialized.includes("listeningSockets[0]"));
});

test("duplicate PIDs are excluded from parent relationships instead of guessing identity", () => {
  const input = snapshot();
  input.processes = [
    { pid: 30, ppid: 1, uid: 1000, state: "S", name: "duplicate-a" },
    { pid: 30, ppid: 1, uid: 1001, state: "R", name: "duplicate-b" },
    { pid: 31, ppid: 30, uid: 1000, state: "S", name: "child" },
  ];
  input.listeningSockets = [];

  const analysis = analyzeServerAuditProcessRelationships(input);
  assert.equal(analysis.summary.duplicateProcessIdsSkipped, 2);
  assert.equal(analysis.summary.parentRelationshipsFound, 0);
  assert.deepEqual(analysis.relationships, []);
});

test("ambiguous listener evidence caps structural sources without losing ambiguity truth", () => {
  const input = snapshot();
  input.processes = Array.from({ length: 100 }, (_, index) => ({
    pid: 1000 + index,
    ppid: 1,
    uid: 1000,
    state: "S",
    name: "shared-private-worker",
  }));
  input.listeningSockets = [{ protocol: "tcp", localAddress: "127.0.0.1", port: 4000, process: "shared-private-worker" }];

  const analysis = analyzeServerAuditProcessRelationships(input);
  assert.equal(analysis.relationships.length, 1);
  assert.equal(analysis.relationships[0].kind, "ambiguous-listener-process");
  assert.equal(analysis.relationships[0].sources.length, analysis.execution.maxSourcesPerRelationship);
  assert.equal(analysis.relationships[0].sourcesTruncated, true);
  assert.equal(analysis.summary.relationshipsWithTruncatedSources, 1);
  assert.equal(JSON.stringify(analysis).includes("shared-private-worker"), false);
});

test("relationship output is deterministic when the supplied snapshot is unchanged", () => {
  const input = snapshot();
  const first = analyzeServerAuditProcessRelationships(input);
  const second = analyzeServerAuditProcessRelationships(input);
  assert.deepEqual(first, second);
  assert.ok(first.relationships.every((relationship) => /^server-process:[a-f0-9]{8}$/.test(relationship.id)));
});

test("relationship output is bounded and reports truncation", () => {
  const input = snapshot();
  const analysis = analyzeServerAuditProcessRelationships(input, { maxRelationships: 2 });
  assert.equal(analysis.relationships.length, 2);
  assert.equal(analysis.execution.relationshipsTruncated, true);
  assert.throws(
    () => analyzeServerAuditProcessRelationships(input, { maxRelationships: 0 }),
    /process maxRelationships/,
  );
});
