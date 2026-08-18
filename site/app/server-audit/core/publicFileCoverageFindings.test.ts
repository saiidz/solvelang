import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditPublicFileCoverageFindings } from "./publicFileCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(web: NonNullable<ServerAuditSnapshot["web"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T18:45:00.000Z",
    host: { hostname: "audit-host" },
    web,
  };
}

const completeChecks = [
  { rootIndex: 0, marker: "env-file" as const, present: false },
  { rootIndex: 0, marker: "git-config" as const, present: false },
  { rootIndex: 0, marker: "npmrc" as const, present: false },
  { rootIndex: 0, marker: "composer-auth" as const, present: false },
];

test("complete fixed marker coverage produces no integrity finding", () => {
  const findings = createServerAuditPublicFileCoverageFindings(snapshot({
    roots: [{ path: "/var/www/private-name" }],
    publicFileChecks: completeChecks,
  }));
  assert.deepEqual(findings, []);
});

test("missing fixed marker checks are reported structurally without root paths", () => {
  const findings = createServerAuditPublicFileCoverageFindings(snapshot({
    roots: [{ path: "/var/www/private-customer-name" }],
    publicFileChecks: completeChecks.slice(0, 2),
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "coverage");
  assert.deepEqual(findings[0].evidence.map((item) => item.summary).sort(), ["composer-auth check absent", "npmrc check absent"]);
  assert.equal(JSON.stringify(findings).includes("private-customer-name"), false);
  assert.equal(JSON.stringify(findings).includes("/var/www"), false);
});

test("conflicting duplicate marker checks are explicit and structural", () => {
  const findings = createServerAuditPublicFileCoverageFindings(snapshot({
    roots: [{ path: "/var/www/private" }],
    publicFileChecks: [
      ...completeChecks,
      { rootIndex: 0, marker: "env-file", present: true },
    ],
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "low");
  assert.equal(findings[0].category, "evidence-integrity");
  assert.deepEqual(findings[0].evidence.map((item) => item.source), [
    "web.publicFileChecks[0].present",
    "web.publicFileChecks[4].present",
  ]);
  assert.equal(JSON.stringify(findings).includes("/var/www/private"), false);
});

test("public-file coverage findings are deterministic and bounded", () => {
  const roots = Array.from({ length: 10 }, (_, index) => ({ path: `/var/www/private-${index}` }));
  const input = snapshot({ roots, publicFileChecks: [] });
  const first = createServerAuditPublicFileCoverageFindings(input, { maxFindings: 4 });
  const second = createServerAuditPublicFileCoverageFindings(input, { maxFindings: 4 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(first.filter((finding) => finding.title === "Public-file coverage findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("private-"), false);
});

test("public-file coverage option bounds fail closed", () => {
  const input = snapshot({ roots: [], publicFileChecks: [] });
  assert.throws(() => createServerAuditPublicFileCoverageFindings(input, { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditPublicFileCoverageFindings(input, { maxFindings: 1001 }), /maxFindings/);
});
