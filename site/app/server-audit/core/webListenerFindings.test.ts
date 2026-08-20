import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditWebListenerFindings } from "./webListenerFindings";
import { createServerAuditReport } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(overrides: Partial<ServerAuditSnapshot>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T12:00:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
    ...overrides,
  };
}

test("web listener evidence reports absent conventional HTTP(S) listeners without exposing local addresses", () => {
  const findings = createServerAuditWebListenerFindings(snapshot({
    web: { servers: ["private-proxy"] },
    listeningSockets: [{ protocol: "tcp", localAddress: "10.42.0.15", port: 8080, process: "private-proxy" }],
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.title, "Active web-server evidence lacks a conventional HTTP(S) listener");
  assert.deepEqual(findings[0]?.evidence, [
    { source: "web.servers", summary: "1 active web-server record observed" },
    { source: "listeningSockets", summary: "no collected TCP listener on conventional HTTP(S) ports" },
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-proxy"), false);
  assert.equal(serialized.includes("10.42.0.15"), false);
  assert.equal(serialized.includes("8080"), false);
});

test("web listener evidence reports conventional HTTP(S) listeners missing a web-server probe and composes into reports", () => {
  const input = snapshot({
    web: { servers: [] },
    listeningSockets: [{ protocol: "TCP", localAddress: "127.0.0.1", port: 443, process: "private-server" }],
  });
  const findings = createServerAuditWebListenerFindings(input);
  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.title, "Conventional HTTP(S) listener lacks web-server probe evidence");
  assert.equal(JSON.stringify(findings).includes("private-server"), false);

  const report = createServerAuditReport(input, "2026-08-20T12:01:00.000Z");
  assert.equal(report.findings.some((entry) => entry.title === findings[0]?.title), true);
  assert.ok(report.limitations.some((entry) => entry.includes("Web-listener consistency")));
});

test("web listener evidence requires both collected sections and is deterministic", () => {
  assert.deepEqual(createServerAuditWebListenerFindings(snapshot({ web: { servers: ["nginx"] } })), []);
  assert.deepEqual(createServerAuditWebListenerFindings(snapshot({ listeningSockets: [] })), []);

  const input = snapshot({
    web: { servers: ["nginx"] },
    listeningSockets: [{ protocol: "tcp", localAddress: "0.0.0.0", port: 80 }],
  });
  assert.deepEqual(createServerAuditWebListenerFindings(input), []);
  assert.deepEqual(createServerAuditWebListenerFindings(input), createServerAuditWebListenerFindings(structuredClone(input)));
});
