import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditListenerConsistencyFindings } from "./listenerConsistencyFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(listeningSockets: NonNullable<ServerAuditSnapshot["listeningSockets"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T19:40:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets,
    metadata: { redactionsApplied: true },
  };
}

test("conflicting duplicate listener ownership is reported with structural evidence only", () => {
  const findings = createServerAuditListenerConsistencyFindings(snapshot([
    { protocol: "tcp", localAddress: "10.42.0.15", port: 8443, process: "private-api" },
    { protocol: "TCP", localAddress: "10.42.0.15", port: 8443, process: "private-proxy" },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Listener inventory reports conflicting ownership");
  assert.deepEqual(findings[0].evidence.map((item) => item.source), [
    "listeningSockets[0]",
    "listeningSockets[1]",
  ]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("10.42.0.15"), false);
  assert.equal(serialized.includes("8443"), false);
  assert.equal(serialized.includes("private-api"), false);
  assert.equal(serialized.includes("private-proxy"), false);
});

test("missing versus present process attribution is treated as conflicting endpoint evidence", () => {
  const findings = createServerAuditListenerConsistencyFindings(snapshot([
    { protocol: "tcp", localAddress: "127.0.0.1", port: 9000 },
    { protocol: "tcp", localAddress: "127.0.0.1", port: 9000, process: "private-worker" },
  ]));
  assert.equal(findings.length, 1);
  assert.equal(JSON.stringify(findings).includes("private-worker"), false);
});

test("identical duplicate listeners and distinct endpoints do not produce false conflicts", () => {
  const findings = createServerAuditListenerConsistencyFindings(snapshot([
    { protocol: "tcp", localAddress: "127.0.0.1", port: 8080, process: "app" },
    { protocol: "TCP", localAddress: "127.0.0.1", port: 8080, process: "app" },
    { protocol: "tcp", localAddress: "127.0.0.1", port: 8081, process: "other" },
  ]));
  assert.deepEqual(findings, []);
});

test("listener-consistency findings are deterministic and bounded", () => {
  const sockets: NonNullable<ServerAuditSnapshot["listeningSockets"]> = [];
  for (let index = 0; index < 6; index += 1) {
    sockets.push(
      { protocol: "tcp", localAddress: `10.0.0.${index + 1}`, port: 7000 + index, process: `a-${index}` },
      { protocol: "tcp", localAddress: `10.0.0.${index + 1}`, port: 7000 + index, process: `b-${index}` },
    );
  }
  const input = snapshot(sockets);
  const first = createServerAuditListenerConsistencyFindings(input, { maxFindings: 4 });
  const second = createServerAuditListenerConsistencyFindings(input, { maxFindings: 4 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(first.filter((finding) => finding.title === "Listener-consistency findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("10.0.0."), false);
  assert.equal(serialized.includes("a-"), false);
  assert.equal(serialized.includes("b-"), false);
});

test("listener-consistency option bounds fail closed", () => {
  const input = snapshot([]);
  assert.throws(() => createServerAuditListenerConsistencyFindings(input, { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditListenerConsistencyFindings(input, { maxFindings: 1001 }), /maxFindings/);
});
