import assert from "node:assert/strict";
import test from "node:test";
import { analyzeServerSnapshot } from "./analyze";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:55:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets: [
      {
        protocol: "tcp",
        localAddress: "0.0.0.0",
        port: 27017,
        process: "private-mongodb-process",
      },
      {
        protocol: "tcp",
        localAddress: "0.0.0.0",
        port: 45678,
        process: "private-custom-process",
      },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("public-listener findings use structural socket evidence only", () => {
  const findings = analyzeServerSnapshot(snapshot()).filter((finding) => finding.category === "network");
  assert.equal(findings.some((finding) => finding.title === "MongoDB listens on all interfaces"), true);
  assert.equal(findings.some((finding) => finding.title === "Unexpected public listener"), true);

  const sensitive = findings.find((finding) => finding.title === "MongoDB listens on all interfaces");
  assert.deepEqual(sensitive?.evidence, [
    { source: "listeningSockets[0].port", summary: "port matches reviewed sensitive service class" },
    { source: "listeningSockets[0].localAddress", summary: "address is wildcard or all-interface" },
  ]);

  const unexpected = findings.find((finding) => finding.title === "Unexpected public listener");
  assert.deepEqual(unexpected?.evidence, [
    { source: "listeningSockets[1].port", summary: "port is outside reviewed expected-public set" },
    { source: "listeningSockets[1].localAddress", summary: "address is wildcard or all-interface" },
  ]);

  const serialized = JSON.stringify(findings);
  for (const privateValue of [
    "private-mongodb-process",
    "private-custom-process",
    "0.0.0.0",
    "27017",
    "45678",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("canonical reports keep public-listener evidence structural and redacted", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T07:56:00.000Z");
  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);

  for (const privateValue of [
    "private-mongodb-process",
    "private-custom-process",
    "0.0.0.0",
    "27017",
    "45678",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  for (const structuralSource of [
    "listeningSockets[0].port",
    "listeningSockets[0].localAddress",
    "listeningSockets[1].port",
    "listeningSockets[1].localAddress",
  ]) {
    assert.ok(json.includes(structuralSource));
    assert.ok(html.includes(structuralSource));
  }
});
