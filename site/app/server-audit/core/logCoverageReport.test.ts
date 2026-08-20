import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T14:00:00.000Z",
    host: { hostname: "audit-host" },
    logs: [
      { path: "/private/activity-missing.log", sizeBytes: 1024 },
      { path: "/private/size-missing.log", modifiedAt: "2026-08-20T13:00:00.000Z" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose missing log activity and size evidence without path leakage", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T14:01:00.000Z");
  const activity = report.findings.find((finding) => finding.title === "Log record lacks activity timestamp evidence");
  const size = report.findings.find((finding) => finding.title === "Log record lacks size evidence");

  assert.ok(activity);
  assert.ok(size);
  assert.deepEqual(activity.evidence, [{ source: "logs[0].modifiedAt", summary: "activity timestamp evidence is absent" }]);
  assert.deepEqual(size.evidence, [{ source: "logs[1].sizeBytes", summary: "size evidence is absent" }]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const privatePath of ["/private/activity-missing.log", "/private/size-missing.log"]) {
    assert.equal(json.includes(privatePath), false);
    assert.equal(html.includes(privatePath), false);
  }
  assert.ok(report.limitations.includes(
    "Log-coverage findings report only explicit empty log inventories or supplied log records that lack modifiedAt or sizeBytes evidence; they do not prove logging failure, activity, retention, completeness, or collector authority.",
  ));
});
