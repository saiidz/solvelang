import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditListenerCoverageFindings } from "./listenerCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(listeningSockets: NonNullable<ServerAuditSnapshot["listeningSockets"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:00:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets,
    metadata: { redactionsApplied: true },
  };
}

test("listener coverage reports explicit empty inventory but leaves absent section to generic coverage", () => {
  const empty = createServerAuditListenerCoverageFindings(snapshot([]));
  assert.equal(empty.length, 1);
  assert.equal(empty[0].title, "No listening socket records supplied");
  assert.deepEqual(empty[0].evidence, [{ source: "listeningSockets", summary: "0 listening socket records" }]);

  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:00:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
  assert.deepEqual(createServerAuditListenerCoverageFindings(absent), []);
});

test("listener coverage does not report a concrete listening-socket inventory", () => {
  const findings = createServerAuditListenerCoverageFindings(snapshot([
    { protocol: "tcp", localAddress: "127.0.0.1", port: 8080, process: "private-admin" },
  ]));
  assert.deepEqual(findings, []);
});

test("listener coverage output is deterministic and emits structural evidence only", () => {
  const first = createServerAuditListenerCoverageFindings(snapshot([]));
  const second = createServerAuditListenerCoverageFindings(snapshot([]));

  assert.deepEqual(first, second);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("127.0.0.1"), false);
  assert.equal(serialized.includes("private-admin"), false);
});
