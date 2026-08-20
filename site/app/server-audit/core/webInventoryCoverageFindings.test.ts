import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditWebInventoryCoverageFindings } from "./webInventoryCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function base(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T16:38:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };
}

test("web inventory coverage reports explicit empty sub-inventories with structural evidence", () => {
  const snapshot: ServerAuditSnapshot = {
    ...base(),
    web: { servers: [], roots: [], certificates: [] },
  };
  const findings = createServerAuditWebInventoryCoverageFindings(snapshot);

  assert.deepEqual(findings.map((finding) => finding.title), [
    "No web-server records supplied",
    "No web-root records supplied",
    "No TLS certificate records supplied",
  ]);
  assert.deepEqual(findings.map((finding) => finding.evidence[0]), [
    { source: "web.servers", summary: "0 web-server records" },
    { source: "web.roots", summary: "0 web-root records" },
    { source: "web.certificates", summary: "0 TLS certificate records" },
  ]);
});

test("web inventory coverage leaves absent sub-inventories to generic coverage", () => {
  const findings = createServerAuditWebInventoryCoverageFindings({ ...base(), web: {} });
  assert.deepEqual(findings, []);
});

test("web inventory coverage does not report concrete inventories", () => {
  const findings = createServerAuditWebInventoryCoverageFindings({
    ...base(),
    web: {
      servers: ["private-web-server"],
      roots: [{ path: "/private/web-root", owner: "1000", mode: "0750" }],
      certificates: [{ name: "private-certificate", daysRemaining: 90 }],
    },
  });
  assert.deepEqual(findings, []);
});

test("web inventory coverage output is deterministic and does not serialize concrete private inventory values", () => {
  const snapshot: ServerAuditSnapshot = {
    ...base(),
    web: { servers: [], roots: [], certificates: [] },
  };
  const first = createServerAuditWebInventoryCoverageFindings(snapshot);
  const second = createServerAuditWebInventoryCoverageFindings(snapshot);

  assert.deepEqual(first, second);
  const text = JSON.stringify(first);
  assert.equal(text.includes("private-web-server"), false);
  assert.equal(text.includes("/private/web-root"), false);
  assert.equal(text.includes("private-certificate"), false);
});
