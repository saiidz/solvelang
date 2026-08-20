import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

const WEB_INVENTORY_COVERAGE_LIMITATION =
  "Web-inventory coverage findings report only explicit empty web-server, web-root, or TLS-certificate inventories from the fixed local probes; they do not prove those surfaces are absent, that discovery was complete or authoritative, or that any endpoint is publicly reachable.";

function snapshot(web: NonNullable<ServerAuditSnapshot["web"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:47:00.000Z",
    host: { hostname: "audit-host" },
    web,
    metadata: { redactionsApplied: true },
  };
}

test("canonical reports compose explicit empty web inventories with structural evidence", () => {
  const report = createServerAuditReport(
    snapshot({ servers: [], roots: [], certificates: [] }),
    "2026-08-20T16:48:00.000Z",
  );

  const titles = report.findings.map((finding) => finding.title);
  assert.ok(titles.includes("No web-server records supplied"));
  assert.ok(titles.includes("No web-root records supplied"));
  assert.ok(titles.includes("No TLS certificate records supplied"));
  assert.ok(report.limitations.includes(WEB_INVENTORY_COVERAGE_LIMITATION));

  const webCoverage = report.findings.filter((finding) => [
    "No web-server records supplied",
    "No web-root records supplied",
    "No TLS certificate records supplied",
  ].includes(finding.title));
  assert.deepEqual(webCoverage.flatMap((finding) => finding.evidence), [
    { source: "web.certificates", summary: "0 TLS certificate records" },
    { source: "web.roots", summary: "0 web-root records" },
    { source: "web.servers", summary: "0 web-server records" },
  ]);

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.ok(json.includes("Web-inventory coverage findings report only explicit empty"));
  assert.ok(html.includes("Web-inventory coverage findings report only explicit empty"));
  for (const privateValue of ["private-web-server", "/private/web-root", "private-certificate"]) {
    assert.equal(json.includes(privateValue), false);
    assert.equal(html.includes(privateValue), false);
  }
});

test("canonical reports do not add web inventory coverage findings for concrete inventories", () => {
  const report = createServerAuditReport(snapshot({
    servers: ["private-web-server"],
    roots: [{ path: "/private/web-root", owner: "1000", mode: "0750" }],
    certificates: [{ name: "private-certificate", daysRemaining: 90 }],
  }), "2026-08-20T16:48:00.000Z");

  assert.equal(report.findings.some((finding) => finding.title === "No web-server records supplied"), false);
  assert.equal(report.findings.some((finding) => finding.title === "No web-root records supplied"), false);
  assert.equal(report.findings.some((finding) => finding.title === "No TLS certificate records supplied"), false);
  assert.ok(report.limitations.includes(WEB_INVENTORY_COVERAGE_LIMITATION));
});
