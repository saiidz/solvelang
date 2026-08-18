import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditPublicFileFindings } from "./publicFileFindings";
import { createServerAuditReport } from "./report";
import { parseServerAuditSnapshot } from "./snapshot";
import type { ServerAuditSnapshot } from "./types";

function snapshot(): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-17T23:00:00.000Z",
    host: { hostname: "audit-host" },
    web: {
      roots: [{ path: "/srv/private/customer-app/public", owner: "1000", mode: "0755" }],
      publicFileChecks: [
        { rootIndex: 0, marker: "env-file", present: true },
        { rootIndex: 0, marker: "git-config", present: false },
      ],
    },
    metadata: { redactionsApplied: true },
  };
}

test("public-file marker findings report structural evidence without web-root paths or file contents", () => {
  const findings = createServerAuditPublicFileFindings(snapshot());
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
  assert.equal(findings[0].category, "web-exposure");
  assert.equal(findings[0].title, "Environment-file marker exists under a candidate web root");
  assert.deepEqual(findings[0].evidence.map((item) => item.source), ["web.publicFileChecks[0]", "web.roots[0]"]);

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("/srv/private/customer-app/public"), false);
  assert.equal(serialized.includes(".env"), false);
  assert.ok(serialized.includes("env-file"));
});

test("public-file marker findings are deterministic and bounded with explicit truncation truth", () => {
  const input = snapshot();
  input.web!.publicFileChecks = Array.from({ length: 140 }, (_, index) => ({
    rootIndex: 0,
    marker: index % 2 === 0 ? "env-file" as const : "npmrc" as const,
    present: true,
  }));

  const first = createServerAuditPublicFileFindings(input);
  const second = createServerAuditPublicFileFindings(input);
  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.at(-1)?.title, "Public-file marker findings were truncated");
  assert.ok(first.every((finding) => /^srv_[a-f0-9]{8}$/.test(finding.id)));
});

test("snapshot parser accepts bounded fixed marker evidence and rejects invalid roots or marker names", () => {
  const valid = JSON.stringify({
    schemaVersion: "1",
    collectedAt: "2026-08-17T23:00:00.000Z",
    host: { hostname: "audit-host" },
    web: {
      roots: [{ path: "/var/www/app" }],
      publicFileChecks: [{ rootIndex: 0, marker: "composer-auth", present: false }],
    },
  });
  assert.deepEqual(parseServerAuditSnapshot(valid).web?.publicFileChecks, [{ rootIndex: 0, marker: "composer-auth", present: false }]);

  const invalidRoot = JSON.stringify({
    schemaVersion: "1",
    collectedAt: "2026-08-17T23:00:00.000Z",
    host: { hostname: "audit-host" },
    web: { roots: [], publicFileChecks: [{ rootIndex: 0, marker: "env-file", present: true }] },
  });
  assert.throws(() => parseServerAuditSnapshot(invalidRoot), /rootIndex is invalid/);

  const invalidMarker = JSON.stringify({
    schemaVersion: "1",
    collectedAt: "2026-08-17T23:00:00.000Z",
    host: { hostname: "audit-host" },
    web: { roots: [{ path: "/var/www/app" }], publicFileChecks: [{ rootIndex: 0, marker: "secret-file", present: true }] },
  });
  assert.throws(() => parseServerAuditSnapshot(invalidMarker), /marker is invalid/);
});

test("public-file marker evidence composes into deterministic canonical reports", () => {
  const input = snapshot();
  const first = createServerAuditReport(input, "2026-08-17T23:10:00.000Z");
  const second = createServerAuditReport(input, "2026-08-18T00:10:00.000Z");
  const finding = first.findings.find((item) => item.title === "Environment-file marker exists under a candidate web root");

  assert.ok(finding);
  assert.equal(first.reportId, second.reportId);
  assert.ok(first.limitations.some((item) => item.includes("Public-file marker")));
  assert.equal(JSON.stringify(finding).includes("/srv/private/customer-app/public"), false);
});
