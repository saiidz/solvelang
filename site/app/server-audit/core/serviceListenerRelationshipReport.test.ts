import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const SERVICE_LISTENER_RELATIONSHIP_LIMITATION =
  "Service-listener relationship findings use only conservative exact static-label matches across supplied service, process, and listener records; ambiguous, unresolved, skipped, or truncated mappings are completeness/integrity signals and do not prove service ownership, exposure, runtime health, or collector authority.";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "private-api.service", state: "active" },
      { name: "private-worker.service", state: "active" },
      { name: "missing.service", state: "active" },
      { name: "invalid service label", state: "unknown" },
    ],
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "private-api" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
      { pid: 21, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
      { pid: 30, ppid: 1, uid: 1000, state: "S", name: "bad\u0001process" },
    ],
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "private-api" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3001, process: "private-worker" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3002, process: "missing" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3003, process: "bad\u0001listener" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose service-listener relationship uncertainty with structural evidence", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T18:01:00.000Z");

  const ambiguous = report.findings.find(
    (finding) => finding.title === "Listener attribution is ambiguous across collected processes",
  );
  const unresolved = report.findings.find(
    (finding) => finding.title === "Some service-listener attribution lacks collected process evidence",
  );
  const skipped = report.findings.find(
    (finding) => finding.title === "Service-listener mapping skipped unsupported label evidence",
  );

  assert.ok(ambiguous);
  assert.ok(unresolved);
  assert.ok(skipped);
  assert.deepEqual(
    ambiguous.evidence.map((item) => item.source).sort(),
    ["listeningSockets[1]", "processes[1]", "processes[2]", "services[1]"].sort(),
  );
  assert.ok(report.limitations.includes(SERVICE_LISTENER_RELATIONSHIP_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const text of [
    "Listener attribution is ambiguous across collected processes",
    "Some service-listener attribution lacks collected process evidence",
    "Service-listener mapping skipped unsupported label evidence",
    SERVICE_LISTENER_RELATIONSHIP_LIMITATION,
  ]) {
    assert.ok(json.includes(text));
    assert.ok(html.includes(text));
  }
});

test("canonical reports do not add service-listener uncertainty for a unique exact-label mapping", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T18:00:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "api.service", state: "active" }],
    processes: [{ pid: 10, ppid: 1, uid: 1000, state: "S", name: "api" }],
    listeningSockets: [{ protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "api" }],
    metadata: { redactionsApplied: true },
  };

  const report = createServerAuditReport(input, "2026-08-20T18:01:00.000Z");
  const relationshipTitles = new Set([
    "Listener attribution is ambiguous across collected processes",
    "Some service-listener attribution lacks collected process evidence",
    "Service-listener mapping skipped unsupported label evidence",
    "Service-listener relationships were truncated",
  ]);

  assert.equal(report.findings.some((finding) => relationshipTitles.has(finding.title)), false);
  assert.ok(report.limitations.includes(SERVICE_LISTENER_RELATIONSHIP_LIMITATION));
});
