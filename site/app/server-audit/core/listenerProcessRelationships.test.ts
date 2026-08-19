import assert from "node:assert/strict";
import test from "node:test";
import type { ServerAuditSnapshot } from "./types";
import { analyzeServerAuditListenerProcessRelationships } from "./listenerProcessRelationships";

function snapshot(overrides: Partial<ServerAuditSnapshot> = {}): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-19T00:00:00Z",
    host: { hostname: "server-audit-fixture" },
    ...overrides,
  };
}

test("maps sanitized listener process labels to exact process inventory matches", () => {
  const analysis = analyzeServerAuditListenerProcessRelationships(snapshot({
    processes: [
      { pid: 10, ppid: 1, uid: 33, state: "S", name: "nginx" },
      { pid: 11, ppid: 10, uid: 33, state: "S", name: "nginx" },
      { pid: 20, ppid: 1, uid: 999, state: "S", name: "postgres" },
    ],
    listeningSockets: [
      { protocol: "tcp", localAddress: "0.0.0.0", port: 80, process: "nginx" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 5432, process: "postgres" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 9000, process: "unknown" },
      { protocol: "tcp", localAddress: "0.0.0.0", port: 22 },
    ],
  }));

  assert.equal(analysis.relationships.length, 2);
  const grouped = analysis.relationships.find((entry) => entry.processName === "nginx");
  const single = analysis.relationships.find((entry) => entry.processName === "postgres");
  assert.equal(grouped?.kind, "listener-process-group");
  assert.deepEqual(grouped?.sources, ["listeningSockets[0]", "processes[0]", "processes[1]"]);
  assert.equal(single?.kind, "listener-process");
  assert.deepEqual(single?.sources, ["listeningSockets[1]", "processes[2]"]);
  assert.deepEqual(analysis.summary, {
    listenersChecked: 4,
    processesChecked: 3,
    matchedListeners: 2,
    groupedProcessMatches: 1,
    unmatchedListeners: 1,
    missingProcessLabels: 1,
    relationshipsWithTruncatedSources: 0,
  });
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("normalizes process labels but rejects control-character or oversized labels", () => {
  const analysis = analyzeServerAuditListenerProcessRelationships(snapshot({
    processes: [{ pid: 1, ppid: 0, uid: 0, state: "S", name: "node" }],
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "  node  " },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3001, process: "node\nworker" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3002, process: "x".repeat(129) },
    ],
  }));

  assert.equal(analysis.relationships.length, 1);
  assert.equal(analysis.relationships[0].processName, "node");
  assert.equal(analysis.summary.missingProcessLabels, 2);
});

test("bounds relationship count and per-relationship evidence sources deterministically", () => {
  const processes = Array.from({ length: 40 }, (_, index) => ({
    pid: index + 1,
    ppid: 1,
    uid: 1000,
    state: "S",
    name: "worker",
  }));
  const analysis = analyzeServerAuditListenerProcessRelationships(snapshot({
    processes,
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 7000, process: "worker" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 7001, process: "worker" },
    ],
  }), { maxRelationships: 1 });

  assert.equal(analysis.relationships.length, 1);
  assert.equal(analysis.execution.relationshipsTruncated, true);
  assert.equal(analysis.relationships[0].sources.length, 32);
  assert.equal(analysis.relationships[0].sourcesTruncated, true);
  assert.equal(analysis.summary.relationshipsWithTruncatedSources, 1);
});

test("invalid listener-process bounds fail closed", () => {
  const input = snapshot();
  assert.throws(
    () => analyzeServerAuditListenerProcessRelationships(input, { maxRelationships: 0 }),
    /maxRelationships/,
  );
  assert.throws(
    () => analyzeServerAuditListenerProcessRelationships(input, { maxRelationships: 5_001 }),
    /maxRelationships/,
  );
});
