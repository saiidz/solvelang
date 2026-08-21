import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditTlsListenerFindings } from "./tlsListenerFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(
  certificates: NonNullable<NonNullable<ServerAuditSnapshot["web"]>["certificates"]>,
  listeningSockets: NonNullable<ServerAuditSnapshot["listeningSockets"]>,
): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T01:45:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets,
    web: { certificates },
    metadata: { redactionsApplied: true },
  };
}

test("TLS listener consistency reports certificate evidence without a conventional local TLS listener", () => {
  const findings = createServerAuditTlsListenerFindings(snapshot(
    [{ name: "private.example", notAfter: "2026-12-01T00:00:00Z", daysRemaining: 100 }],
    [{ protocol: "tcp", localAddress: "127.0.0.1", port: 8443, process: "private-proxy" }],
  ));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "TLS certificate evidence lacks a conventional local TLS listener");
  assert.deepEqual(findings[0].evidence, [
    { source: "web.certificates", summary: "1 TLS certificate record observed" },
    { source: "listeningSockets", summary: "no collected TCP listener on port 443" },
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private.example"), false);
  assert.equal(serialized.includes("127.0.0.1"), false);
  assert.equal(serialized.includes("private-proxy"), false);
});

test("TLS listener consistency reports a port 443 listener with an explicit empty certificate inventory", () => {
  const findings = createServerAuditTlsListenerFindings(snapshot(
    [],
    [{ protocol: " TCP ", localAddress: "0.0.0.0", port: 443, process: "private-server" }],
  ));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Conventional local TLS listener lacks certificate inventory evidence");
  assert.deepEqual(findings[0].evidence, [
    { source: "listeningSockets", summary: "1 collected TCP listener on port 443" },
    { source: "web.certificates", summary: "0 TLS certificate records" },
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("0.0.0.0"), false);
  assert.equal(serialized.includes("private-server"), false);
});

test("TLS listener consistency emits no finding when local certificate and port 443 evidence coexist", () => {
  assert.deepEqual(createServerAuditTlsListenerFindings(snapshot(
    [{ name: "private.example", daysRemaining: 30 }],
    [{ protocol: "tcp", localAddress: "[::]", port: 443, process: "private-server" }],
  )), []);
});

test("TLS listener consistency stays silent when either evidence section is absent", () => {
  const base: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-21T01:45:00.000Z",
    host: { hostname: "audit-host" },
  };

  assert.deepEqual(createServerAuditTlsListenerFindings({ ...base, web: { certificates: [] } }), []);
  assert.deepEqual(createServerAuditTlsListenerFindings({ ...base, listeningSockets: [] }), []);
});
