import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const PROCESS_COVERAGE_LIMITATION =
  "Process-coverage findings report only an explicit empty process inventory; because the reviewed collector maps failed/unavailable fixed `ps` execution or empty usable output to an empty array, they do not prove that the host has no processes or that process collection was complete or authoritative.";

function snapshot(processes: NonNullable<ServerAuditSnapshot["processes"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:12:00.000Z",
    host: { hostname: "audit-host" },
    processes,
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose explicit empty process coverage with structural evidence", () => {
  const report = createServerAuditReport(snapshot([]), "2026-08-20T16:13:00.000Z");
  const finding = report.findings.find((item) => item.title === "No process records supplied");

  assert.ok(finding);
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [{ source: "processes", summary: "0 process records" }]);
  assert.ok(report.limitations.includes(PROCESS_COVERAGE_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.ok(json.includes("No process records supplied"));
  assert.ok(html.includes("No process records supplied"));
  assert.ok(json.includes("Process-coverage findings report only an explicit empty process inventory"));
  assert.ok(html.includes("Process-coverage findings report only an explicit empty process inventory"));
  assert.equal(json.includes("private-worker"), false);
  assert.equal(html.includes("private-worker"), false);
});

test("canonical reports do not add process coverage findings for a non-empty inventory", () => {
  const report = createServerAuditReport(snapshot([
    { pid: 42, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
  ]), "2026-08-20T16:13:00.000Z");

  assert.equal(report.findings.some((item) => item.title === "No process records supplied"), false);
  assert.ok(report.limitations.includes(PROCESS_COVERAGE_LIMITATION));
});
