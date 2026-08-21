import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const LISTENER_CONSISTENCY_LIMITATION =
  "Listener-consistency findings identify only duplicate supplied endpoints whose process attribution conflicts; collection timing, visibility limits, duplicate rows, or process churn can explain the contradiction, and the stage does not determine authoritative ownership or reachability.";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:05:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets: [
      { protocol: "tcp", localAddress: "10.42.0.15", port: 8443, process: "private-api" },
      { protocol: "TCP", localAddress: "10.42.0.15", port: 8443, process: "private-proxy" },
      { protocol: "tcp", localAddress: "127.0.0.1", port: 9000, process: "stable-worker" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose conflicting listener attribution with structural evidence only", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T02:06:00.000Z");
  const finding = report.findings.find(
    (candidate) => candidate.title === "Listener inventory reports conflicting ownership",
  );

  assert.ok(finding);
  assert.deepEqual(finding.evidence.map((item) => item.source), [
    "listeningSockets[0]",
    "listeningSockets[1]",
  ]);
  assert.ok(report.limitations.includes(LISTENER_CONSISTENCY_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const value of [
    "Listener inventory reports conflicting ownership",
    LISTENER_CONSISTENCY_LIMITATION,
  ]) {
    assert.ok(json.includes(value));
    assert.ok(html.includes(value));
  }

  for (const privateValue of ["10.42.0.15", "8443", "private-api", "private-proxy"]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }
});

test("canonical reports remain finding-free for consistent duplicate listener attribution", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:05:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 8080, process: "app" },
      { protocol: "TCP", localAddress: "127.0.0.1", port: 8080, process: "app" },
    ],
    metadata: { redactionsApplied: true },
  };

  const report = createServerAuditReport(input, "2026-08-21T02:06:00.000Z");
  assert.equal(
    report.findings.some((finding) => finding.title === "Listener inventory reports conflicting ownership"),
    false,
  );
  assert.ok(report.limitations.includes(LISTENER_CONSISTENCY_LIMITATION));
});
