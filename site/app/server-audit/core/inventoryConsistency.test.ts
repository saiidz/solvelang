import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerAuditInventoryConsistency } from "./inventoryConsistency";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-17T20:00:00.000Z",
    host: { hostname: "audit-host" },
    packages: [
      { name: "internal-agent", version: "1.0.0" },
      { name: "internal-agent", version: "2.0.0" },
      { name: "curl", version: "8.0" },
      { name: "curl", version: "8.0" },
    ],
    services: [
      { name: "worker.service", state: "active", enabled: "enabled" },
      { name: "worker.service", state: "failed", enabled: "enabled" },
    ],
    filesystems: [
      { mount: "/", sizeBytes: 100, usedBytes: 50, availableBytes: 50, usagePercent: 50 },
      { mount: "/", sizeBytes: 100, usedBytes: 60, availableBytes: 40, usagePercent: 60 },
    ],
    web: {
      roots: [
        { path: "/srv/private/app", owner: "deploy", mode: "0755" },
        { path: "/srv/private/app", owner: "root", mode: "0775" },
      ],
    },
    metadata: { redactionsApplied: true },
  };
}

test("inventory consistency reports conflicting duplicate evidence without raw identifiers", () => {
  const analysis = analyzeServerAuditInventoryConsistency(snapshot());
  assert.deepEqual(
    analysis.issues.map((issue) => issue.kind).sort(),
    [
      "conflicting-filesystem-capacity",
      "conflicting-package-version",
      "conflicting-service-state",
      "conflicting-web-root-metadata",
    ].sort(),
  );
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);

  const serialized = JSON.stringify(analysis.issues);
  assert.equal(serialized.includes("internal-agent"), false);
  assert.equal(serialized.includes("worker.service"), false);
  assert.equal(serialized.includes("/srv/private/app"), false);
  assert.ok(serialized.includes("packages[0]"));
  assert.ok(serialized.includes("services[0]"));
  assert.ok(serialized.includes("filesystems[0]"));
  assert.ok(serialized.includes("web.roots[0]"));
});

test("process topology consistency reports conflicting PIDs, self-parenting, and parent cycles without process names", () => {
  const input = snapshot();
  input.packages = [];
  input.services = [];
  input.filesystems = [];
  input.web = { roots: [] };
  input.processes = [
    { pid: 100, ppid: 1, uid: 1000, state: "S", name: "sensitive-worker" },
    { pid: 100, ppid: 1, uid: 0, state: "R", name: "sensitive-worker" },
    { pid: 200, ppid: 201, uid: 1000, state: "S", name: "cycle-a" },
    { pid: 201, ppid: 200, uid: 1000, state: "S", name: "cycle-b" },
    { pid: 300, ppid: 300, uid: 1000, state: "S", name: "private-self-exec" },
  ];

  const analysis = analyzeServerAuditInventoryConsistency(input);
  assert.deepEqual(
    analysis.issues.map((issue) => issue.kind).sort(),
    ["conflicting-process-identity", "cyclic-process-parentage", "self-parent-process"].sort(),
  );
  assert.equal(analysis.summary.processesChecked, 5);

  const serialized = JSON.stringify(analysis.issues);
  assert.equal(serialized.includes("sensitive-worker"), false);
  assert.equal(serialized.includes("cycle-a"), false);
  assert.equal(serialized.includes("private-self-exec"), false);
  assert.ok(serialized.includes("processes[0]"));
  assert.ok(serialized.includes("processes[2]"));
  assert.ok(serialized.includes("processes[4]"));
});

test("identical duplicate evidence does not produce false conflict findings", () => {
  const input = snapshot();
  input.packages = [
    { name: "curl", version: "8.0" },
    { name: "curl", version: "8.0" },
  ];
  input.services = [
    { name: "worker.service", state: "active", enabled: "enabled" },
    { name: "worker.service", state: "active", enabled: "enabled" },
  ];
  input.filesystems = [
    { mount: "/", sizeBytes: 100, usedBytes: 50, availableBytes: 50, usagePercent: 50 },
    { mount: "/", sizeBytes: 100, usedBytes: 50, availableBytes: 50, usagePercent: 50 },
  ];
  input.web = {
    roots: [
      { path: "/srv/private/app", owner: "deploy", mode: "0755" },
      { path: "/srv/private/app", owner: "deploy", mode: "0755" },
    ],
  };
  input.processes = [
    { pid: 55, ppid: 1, uid: 1000, state: "S", name: "worker" },
    { pid: 55, ppid: 1, uid: 1000, state: "S", name: "worker" },
  ];

  assert.deepEqual(analyzeServerAuditInventoryConsistency(input).issues, []);
});

test("inventory consistency output is deterministic and bounded", () => {
  const first = analyzeServerAuditInventoryConsistency(snapshot(), { maxIssues: 2 });
  const second = analyzeServerAuditInventoryConsistency(snapshot(), { maxIssues: 2 });

  assert.deepEqual(first, second);
  assert.equal(first.issues.length, 2);
  assert.equal(first.execution.issuesTruncated, true);
  assert.throws(
    () => analyzeServerAuditInventoryConsistency(snapshot(), { maxIssues: 0 }),
    /inventory maxIssues/,
  );
});
