import assert from "node:assert/strict";
import test from "node:test";

import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const WEB_SERVER_RELATIONSHIP_LIMITATION =
  "Web-server relationship findings compare only recognized static web-server labels with supplied service and package inventory evidence; missing or contradictory matches are completeness/integrity signals and do not prove installation source, service ownership, runtime health, public reachability, or collector authority.";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:10:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "private-unrelated.service", state: "active" }],
    packages: [{ name: "private-unrelated-package", version: "1.2.3-private" }],
    web: { servers: ["nginx"] },
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose web-server service and package relationship gaps", () => {
  const report = createServerAuditReport(snapshot(), "2026-08-21T02:11:00.000Z");
  const serviceGap = report.findings.find(
    (finding) => finding.title === "Active web server is not represented in service inventory",
  );
  const packageGap = report.findings.find(
    (finding) => finding.title === "Active web server is not represented in package inventory",
  );

  assert.ok(serviceGap);
  assert.ok(packageGap);
  assert.deepEqual(serviceGap.evidence.map((item) => item.source), ["web.servers[0]"]);
  assert.deepEqual(packageGap.evidence.map((item) => item.source), ["web.servers[0]"]);
  assert.ok(report.limitations.includes(WEB_SERVER_RELATIONSHIP_LIMITATION));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  for (const value of [
    "Active web server is not represented in service inventory",
    "Active web server is not represented in package inventory",
    WEB_SERVER_RELATIONSHIP_LIMITATION,
  ]) {
    assert.ok(json.includes(value));
    assert.ok(html.includes(value));
  }
  for (const privateValue of ["private-unrelated.service", "private-unrelated-package", "1.2.3-private"]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }
});

test("canonical reports compose contradictory active-web-server and service-health evidence", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:10:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "nginx.service", state: "failed" }],
    packages: [{ name: "nginx", version: "1.26.0" }],
    web: { servers: ["nginx"] },
    metadata: { redactionsApplied: true },
  };

  const report = createServerAuditReport(input, "2026-08-21T02:11:00.000Z");
  const conflict = report.findings.find(
    (finding) => finding.title === "Web-server probes disagree on service health",
  );
  assert.ok(conflict);
  assert.deepEqual(conflict.evidence.map((item) => item.source), [
    "web.servers[0]",
    "services[0].state",
  ]);
  assert.ok(report.limitations.includes(WEB_SERVER_RELATIONSHIP_LIMITATION));
});
