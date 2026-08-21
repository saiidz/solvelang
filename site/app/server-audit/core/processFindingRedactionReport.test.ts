import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:40:00.000Z",
    host: { hostname: "audit-host" },
    processes: [
      { pid: 111111, ppid: 1, uid: 424242, state: "S", name: "private-parent" },
      { pid: 222222, ppid: 333333, uid: 434343, state: "Z+", name: "private-zombie" },
    ],
    listeningSockets: [
      { protocol: "tcp", localAddress: "203.0.113.77", port: 45678, process: "private-listener" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports keep process and listener finding evidence structural", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T07:41:00.000Z");
  assert.ok(report.findings.some((finding) => finding.title === "Zombie process observed"));
  assert.ok(report.findings.some((finding) => finding.title === "Process parent is outside collected inventory"));
  assert.ok(report.findings.some((finding) => finding.title === "Listener process is outside collected process inventory"));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "private-parent",
    "private-zombie",
    "private-listener",
    "203.0.113.77",
    "45678",
    "333333",
    "424242",
    "434343",
    "Z+",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }

  for (const structuralSource of [
    "processes[1].state",
    "processes[1].ppid",
    "listeningSockets[0].process",
  ]) {
    assert.ok(json.includes(structuralSource));
    assert.ok(html.includes(structuralSource));
  }
});
