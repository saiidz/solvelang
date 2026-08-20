import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const LISTENER_COVERAGE_LIMITATION =
  "Listener-coverage findings report only an explicit empty listening-socket inventory; because the reviewed collector maps both empty `ss` output and command failure/unavailability to an empty array, they do not prove that the host has no listeners or that socket collection was complete or authoritative.";

function snapshot(listeningSockets: NonNullable<ServerAuditSnapshot["listeningSockets"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:05:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets,
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose explicit empty listener coverage with structural evidence", () => {
  const report = createServerAuditReport(snapshot([]), "2026-08-20T16:06:00.000Z");
  const finding = report.findings.find((item) => item.title === "No listening socket records supplied");

  assert.ok(finding);
  assert.equal(finding.category, "coverage");
  assert.deepEqual(finding.evidence, [{ source: "listeningSockets", summary: "0 listening socket records" }]);
  assert.ok(report.limitations.includes(LISTENER_COVERAGE_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.ok(json.includes("No listening socket records supplied"));
  assert.ok(html.includes("No listening socket records supplied"));
  assert.ok(json.includes("Listener-coverage findings report only an explicit empty listening-socket inventory"));
  assert.ok(html.includes("Listener-coverage findings report only an explicit empty listening-socket inventory"));
  assert.equal(json.includes("127.0.0.1"), false);
  assert.equal(html.includes("127.0.0.1"), false);
});

test("canonical reports do not add listener coverage findings for a non-empty inventory", () => {
  const report = createServerAuditReport(snapshot([
    { protocol: "tcp", localAddress: "127.0.0.1", port: 8080, process: "private-admin" },
  ]), "2026-08-20T16:06:00.000Z");

  assert.equal(report.findings.some((item) => item.title === "No listening socket records supplied"), false);
  assert.ok(report.limitations.includes(LISTENER_COVERAGE_LIMITATION));
});
