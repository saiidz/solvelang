import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditReport } from "./report";
import type { ServerAuditSnapshot } from "./types";

function inconsistentSnapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-15T05:00:00.000Z",
    host: { hostname: "audit-host" },
    packages: [
      { name: "private-package-name", version: "1.0.0" },
      { name: "private-package-name", version: "2.0.0" },
    ],
    services: [
      { name: "private-service-name", state: "active", enabled: "enabled" },
      { name: "private-service-name", state: "inactive", enabled: "disabled" },
    ],
    filesystems: [
      { mount: "/srv/private-volume", sizeBytes: 1000, usedBytes: 400, availableBytes: 500, usagePercent: 40 },
      { mount: "/srv/private-volume", sizeBytes: 1000, usedBytes: 500, availableBytes: 400, usagePercent: 50 },
    ],
    web: {
      roots: [
        { path: "/srv/private/customer-a/public", owner: "owner-a", mode: "0755" },
        { path: "/srv/private/customer-a/public", owner: "owner-b", mode: "0750" },
      ],
    },
    metadata: { redactionsApplied: true },
  };
}

test("Server Audit report composes inventory consistency evidence without raw names or paths", () => {
  const report = createServerAuditReport(inconsistentSnapshot(), "2026-08-15T06:00:00.000Z");
  const inventory = report.findings.filter((finding) => finding.category === "evidence-integrity");

  assert.deepEqual(
    inventory.map((finding) => finding.title).sort(),
    [
      "Package inventory reports conflicting versions",
      "Service inventory reports conflicting state",
      "Filesystem inventory reports conflicting capacity",
      "Web-root inventory reports conflicting metadata",
    ].sort(),
  );
  assert.ok(inventory.every((finding) => /^srv_[a-f0-9]{8}$/.test(finding.id)));

  const serialized = JSON.stringify(inventory);
  assert.equal(serialized.includes("private-package-name"), false);
  assert.equal(serialized.includes("private-service-name"), false);
  assert.equal(serialized.includes("/srv/private-volume"), false);
  assert.equal(serialized.includes("/srv/private/customer-a/public"), false);
  assert.ok(serialized.includes("packages[0]"));
  assert.ok(serialized.includes("services[0]"));
  assert.ok(serialized.includes("filesystems[0]"));
  assert.ok(serialized.includes("web.roots[0]"));
});

test("inventory report integration stays deterministic across generation timestamps", () => {
  const first = createServerAuditReport(inconsistentSnapshot(), "2026-08-15T06:00:00.000Z");
  const second = createServerAuditReport(inconsistentSnapshot(), "2026-08-15T07:00:00.000Z");

  assert.equal(first.reportId, second.reportId);
  assert.deepEqual(
    first.findings.map((finding) => finding.id),
    second.findings.map((finding) => finding.id),
  );
  assert.ok(first.limitations.some((item) => item.includes("Inventory-consistency")));
});
