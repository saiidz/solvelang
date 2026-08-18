import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport, serverAuditReportHtml, serverAuditReportJson } from "./report";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithRoot(root: NonNullable<NonNullable<ServerAuditSnapshot["web"]>["roots"]>[number]): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T16:30:00.000Z",
    host: { hostname: "audit-host" },
    web: { roots: [root] },
    metadata: { redactionsApplied: true },
  };
}

test("canonical Server Audit reports replace raw-path web-root permission findings with structural evidence", () => {
  const secretPath = "/srv/customer/private-next-app";
  const report = createServerAuditReport(snapshotWithRoot({
    path: secretPath,
    owner: "root",
    mode: "0777",
    frameworkHints: ["Next.js"],
  }), "2026-08-18T16:31:00.000Z");

  const permissionFindings = report.findings.filter((finding) => finding.category === "permissions");
  assert.deepEqual(
    permissionFindings.map((finding) => finding.title).sort(),
    ["Application web root uses a privileged owner", "Candidate web root is world-writable"].sort(),
  );
  assert.equal(report.findings.some((finding) => finding.title === "Web root is world-writable"), false);
  assert.equal(report.findings.some((finding) => finding.title === "Application web root owned by root"), false);

  const serializedFindings = JSON.stringify(permissionFindings);
  assert.equal(serializedFindings.includes(secretPath), false);
  assert.ok(serializedFindings.includes("web.roots[0].mode"));
  assert.ok(serializedFindings.includes("web.roots[0].owner"));
  assert.ok(serializedFindings.includes("web.roots[0].frameworkHints"));

  const json = serverAuditReportJson(report);
  const html = serverAuditReportHtml(report);
  assert.equal(json.includes(secretPath), false);
  assert.equal(html.includes(secretPath), false);
  assert.ok(report.limitations.some((item) => item.includes("structural snapshot references")));
});

test("privileged application ownership is reported even when mode evidence is absent", () => {
  const report = createServerAuditReport(snapshotWithRoot({
    path: "/srv/customer/app",
    owner: "0",
    frameworkHints: ["Laravel"],
  }), "2026-08-18T16:31:00.000Z");

  const permissionFindings = report.findings.filter((finding) => finding.category === "permissions");
  assert.equal(permissionFindings.length, 1);
  assert.equal(permissionFindings[0].title, "Application web root uses a privileged owner");
  assert.deepEqual(permissionFindings[0].evidence.map((item) => item.source), [
    "web.roots[0].owner",
    "web.roots[0].frameworkHints",
  ]);
});
