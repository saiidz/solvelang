import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T07:35:00.000Z",
    host: { hostname: "audit-host" },
    processes: [
      { pid: 101, ppid: 1, uid: 1000, state: "S", name: "private-complete" },
      { pid: 102, ppid: 1, uid: 1001, state: "   ", name: "private-missing-state" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports include process state coverage with structural evidence only", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T07:36:00.000Z");
  const finding = report.findings.find(
    (candidate) => candidate.title === "Process record lacks usable state evidence",
  );

  assert.ok(finding);
  assert.equal(finding.severity, "info");
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [
    { source: "processes[1].state", summary: "process state is empty after normalization" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privateValue of [
    "private-complete",
    "private-missing-state",
    "1000",
    "1001",
  ]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }
  assert.ok(json.includes("processes[1].state"));
  assert.ok(html.includes("processes[1].state"));
  assert.ok(report.limitations.some((item) => item.includes("Process relationship findings are point-in-time evidence")));
});
