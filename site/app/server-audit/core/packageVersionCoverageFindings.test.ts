import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditPackageVersionCoverageFindings } from "./packageVersionCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(packages: NonNullable<ServerAuditSnapshot["packages"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:00:00.000Z",
    host: { hostname: "audit-host" },
    packages,
    metadata: { redactionsApplied: true },
  };
}

test("package version coverage reports blank normalized versions using structural evidence only", () => {
  const findings = createServerAuditPackageVersionCoverageFindings(snapshot([
    { name: "private-package-one", version: "   " },
    { name: "private-package-two", version: "\t" },
    { name: "private-package-three", version: "3.0.0-private" },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "Package record lacks usable version evidence"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "packages[0].version",
    "packages[1].version",
  ]);

  const serialized = JSON.stringify(findings);
  for (const privateValue of ["private-package-one", "private-package-two", "private-package-three", "3.0.0-private"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("package version coverage treats normalized non-empty versions as usable", () => {
  assert.deepEqual(createServerAuditPackageVersionCoverageFindings(snapshot([
    { name: "alpha", version: " 1.0.0 " },
    { name: "beta", version: "é" },
    { name: "gamma", version: "e\u0301" },
  ])), []);
});

test("package version coverage output is deterministic and bounded", () => {
  const packages = Array.from({ length: 105 }, (_, index) => ({ name: `package-${index}`, version: "   " }));
  const first = createServerAuditPackageVersionCoverageFindings(snapshot(packages));
  const second = createServerAuditPackageVersionCoverageFindings(snapshot(packages));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const versionFindings = first.filter((finding) => finding.title === "Package record lacks usable version evidence");
  assert.equal(versionFindings.length, 99);
  assert.equal(first.filter((finding) => finding.title === "Package version coverage findings were truncated").length, 1);
  const structuralSources = versionFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^packages\[\d+\]\.version$/.test(source)), true);
});

test("package version coverage emits no finding when package evidence is absent", () => {
  assert.deepEqual(createServerAuditPackageVersionCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-21T02:00:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
});
