import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditProcessFindings } from "./processFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(overrides: Partial<ServerAuditSnapshot> = {}): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T00:00:00.000Z",
    host: { hostname: "audit-host" },
    ...overrides,
  };
}

test("reports zombie processes without claiming persistence", () => {
  const findings = createServerAuditProcessFindings(snapshot({
    processes: [
      { pid: 1, ppid: 0, uid: 0, state: "Ss", name: "systemd" },
      { pid: 42, ppid: 1, uid: 1000, state: "Z+", name: "worker" },
    ],
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Zombie process observed");
  assert.equal(findings[0].severity, "low");
  assert.match(findings[0].summary, /single snapshot does not prove/i);
  assert.deepEqual(findings[0].evidence, [{ source: "pid:42", summary: "worker state Z+" }]);
});

test("reports missing parent references as evidence gaps but ignores init parentage", () => {
  const findings = createServerAuditProcessFindings(snapshot({
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "safe-child" },
      { pid: 20, ppid: 999, uid: 1000, state: "S", name: "orphaned-view" },
    ],
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Process parent is outside collected inventory");
  assert.equal(findings[0].severity, "info");
  assert.match(findings[0].summary, /process churn/i);
});

test("cross-checks literal listener process names only when process inventory is present", () => {
  const withInventory = createServerAuditProcessFindings(snapshot({
    processes: [{ pid: 100, ppid: 1, uid: 1000, state: "S", name: "nginx" }],
    listeningSockets: [
      { protocol: "tcp", localAddress: "0.0.0.0", port: 443, process: "nginx" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 9000, process: "php-fpm" },
    ],
  }));
  assert.equal(withInventory.length, 1);
  assert.equal(withInventory[0].title, "Listener process is outside collected process inventory");
  assert.match(withInventory[0].summary, /php-fpm/);

  assert.deepEqual(createServerAuditProcessFindings(snapshot({
    listeningSockets: [{ protocol: "tcp", localAddress: "127.0.0.1", port: 9000, process: "php-fpm" }],
  })), []);
});

test("keeps deterministic ordering and emits a bounded truncation marker", () => {
  const input = snapshot({
    processes: [
      { pid: 30, ppid: 9030, uid: 1000, state: "S", name: "c" },
      { pid: 10, ppid: 9010, uid: 1000, state: "S", name: "a" },
      { pid: 20, ppid: 9020, uid: 1000, state: "Z", name: "b" },
    ],
  });
  const first = createServerAuditProcessFindings(input, { maxFindings: 3 });
  const second = createServerAuditProcessFindings(snapshot({ processes: [...input.processes!].reverse() }), { maxFindings: 3 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 3);
  assert.ok(first.some((finding) => finding.title === "Process relationship findings were truncated"));
});

test("rejects invalid process finding bounds", () => {
  assert.throws(() => createServerAuditProcessFindings(snapshot({ processes: [] }), { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditProcessFindings(snapshot({ processes: [] }), { maxFindings: 1001 }), /maxFindings/);
});
