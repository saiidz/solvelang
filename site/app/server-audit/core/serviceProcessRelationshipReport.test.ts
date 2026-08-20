import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const SERVICE_PROCESS_RELATIONSHIP_LIMITATION =
  "Service-process relationship findings use only conservative exact static-label matches across supplied service and process records; grouped, unmatched, skipped, or truncated mappings are completeness/integrity signals and do not prove service ownership, process identity, runtime health, or collector authority.";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:30:00.000Z",
    host: { hostname: "audit-host" },
    services: [
      { name: "private-api.service", state: "active" },
      { name: "private-worker.service", state: "active" },
      { name: "missing.service", state: "inactive" },
      { name: "invalid service label", state: "unknown" },
    ],
    processes: [
      { pid: 10, ppid: 1, uid: 1000, state: "S", name: "private-api" },
      { pid: 20, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
      { pid: 21, ppid: 1, uid: 1000, state: "S", name: "private-worker" },
    ],
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose service-process relationship truth with structural evidence", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-20T20:31:00.000Z");

  const grouped = report.findings.find(
    (finding) => finding.title === "Service maps to multiple collected process records",
  );
  const unmatched = report.findings.find(
    (finding) => finding.title === "Some collected services have no exact-label process relationship",
  );
  const skipped = report.findings.find(
    (finding) => finding.title === "Service-process mapping skipped unsupported service labels",
  );

  assert.ok(grouped);
  assert.ok(unmatched);
  assert.ok(skipped);
  assert.deepEqual(
    grouped.evidence.map((item) => item.source).sort(),
    ["processes[1]", "processes[2]", "services[1]"].sort(),
  );
  assert.ok(report.limitations.includes(SERVICE_PROCESS_RELATIONSHIP_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const text of [
    "Service maps to multiple collected process records",
    "Some collected services have no exact-label process relationship",
    "Service-process mapping skipped unsupported service labels",
    SERVICE_PROCESS_RELATIONSHIP_LIMITATION,
  ]) {
    assert.ok(json.includes(text));
    assert.ok(html.includes(text));
  }
});

test("canonical reports do not add service-process uncertainty for a unique exact-label mapping", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T20:30:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "api.service", state: "active" }],
    processes: [{ pid: 10, ppid: 1, uid: 1000, state: "S", name: "api" }],
    metadata: { redactionsApplied: true },
  };

  const report = createServerAuditReport(input, "2026-08-20T20:31:00.000Z");
  const relationshipTitles = new Set([
    "Service maps to multiple collected process records",
    "Some collected services have no exact-label process relationship",
    "Service-process mapping skipped unsupported service labels",
    "Service-process relationships were truncated",
  ]);

  assert.equal(report.findings.some((finding) => relationshipTitles.has(finding.title)), false);
  assert.ok(report.limitations.includes(SERVICE_PROCESS_RELATIONSHIP_LIMITATION));
});
