import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const FILESYSTEM_COVERAGE_LIMITATION =
  "Filesystem-coverage findings report only an explicit empty filesystem inventory; because the reviewed collector maps failed/unavailable fixed `df -P -B1` execution or empty usable output to an empty array, they do not prove that the host has no mounted filesystems or that filesystem collection was complete or authoritative.";

function snapshot(filesystems: NonNullable<ServerAuditSnapshot["filesystems"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:41:00.000Z",
    host: { hostname: "audit-host" },
    filesystems,
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose explicit empty filesystem coverage with structural evidence", () => {
  const report = createServerAuditReport(snapshot([]), "2026-08-20T16:42:00.000Z");
  const finding = report.findings.find((item) => item.title === "No filesystem records supplied");

  assert.ok(finding);
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [{ source: "filesystems", summary: "0 filesystem records" }]);
  assert.ok(report.limitations.includes(FILESYSTEM_COVERAGE_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.ok(json.includes("No filesystem records supplied"));
  assert.ok(html.includes("No filesystem records supplied"));
  assert.ok(json.includes("Filesystem-coverage findings report only an explicit empty filesystem inventory"));
  assert.ok(html.includes("Filesystem-coverage findings report only an explicit empty filesystem inventory"));
  assert.equal(json.includes("private-mount"), false);
  assert.equal(html.includes("private-mount"), false);
  assert.equal(json.includes("private-device"), false);
  assert.equal(html.includes("private-device"), false);
});

test("canonical reports do not add filesystem coverage findings for a non-empty inventory", () => {
  const report = createServerAuditReport(snapshot([
    { mount: "/private-mount", filesystem: "/dev/private-device", usagePercent: 42 },
  ]), "2026-08-20T16:42:00.000Z");

  assert.equal(report.findings.some((item) => item.title === "No filesystem records supplied"), false);
  assert.ok(report.limitations.includes(FILESYSTEM_COVERAGE_LIMITATION));
});
