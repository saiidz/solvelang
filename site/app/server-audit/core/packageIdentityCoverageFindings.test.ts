import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditPackageIdentityCoverageFindings } from "./packageIdentityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(packages: NonNullable<ServerAuditSnapshot["packages"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T19:00:00.000Z",
    host: { hostname: "audit-host" },
    packages,
    metadata: { redactionsApplied: true },
  };
}

test("package identity coverage reports blank normalized names using structural evidence only", () => {
  const findings = createServerAuditPackageIdentityCoverageFindings(snapshot([
    { name: "   ", version: "1.0.0" },
    { name: "\t", version: "2.0.0" },
    { name: "openssl", version: "3.0.0" },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "Package record lacks a usable identity"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "packages[0].name",
    "packages[1].name",
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("openssl"), false);
  assert.equal(serialized.includes("1.0.0"), false);
  assert.equal(serialized.includes("2.0.0"), false);
});

test("package identity coverage treats normalized non-empty names as usable", () => {
  assert.deepEqual(createServerAuditPackageIdentityCoverageFindings(snapshot([
    { name: " openssl ", version: "3.0.0" },
    { name: "é-pkg", version: "1" },
    { name: "e\u0301-pkg", version: "2" },
  ])), []);
});

test("package identity coverage output is deterministic and bounded", () => {
  const packages = Array.from({ length: 105 }, (_, index) => ({ name: "   ", version: String(index) }));
  const first = createServerAuditPackageIdentityCoverageFindings(snapshot(packages));
  const second = createServerAuditPackageIdentityCoverageFindings(snapshot(packages));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const identityFindings = first.filter((finding) => finding.title === "Package record lacks a usable identity");
  assert.equal(identityFindings.length, 99);
  assert.equal(first.filter((finding) => finding.title === "Package identity coverage findings were truncated").length, 1);
  const structuralSources = identityFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^packages\[\d+\]\.name$/.test(source)), true);
});

test("package identity coverage emits no finding when package evidence is absent", () => {
  assert.deepEqual(createServerAuditPackageIdentityCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-20T19:00:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
});
