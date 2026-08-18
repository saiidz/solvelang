import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditPackageVersionFindings } from "./packageVersionFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(packages: NonNullable<ServerAuditSnapshot["packages"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T19:20:00.000Z",
    host: { hostname: "audit-host" },
    packages,
  };
}

test("concrete package versions do not produce version-evidence findings", () => {
  const findings = createServerAuditPackageVersionFindings(snapshot([
    { name: "openssl", version: "3.0.13-1ubuntu3.4" },
    { name: "nginx", version: "1:1.24.0-2ubuntu7" },
    { name: "custom", version: "2026.08+build.17" },
  ]));
  assert.deepEqual(findings, []);
});

test("empty and placeholder versions are reported structurally without package identity or raw version text", () => {
  const findings = createServerAuditPackageVersionFindings(snapshot([
    { name: "private-customer-agent", version: "" },
    { name: "private-internal-tool", version: "LATEST" },
    { name: "private-third-tool", version: "unknown" },
  ]));

  assert.equal(findings.length, 3);
  assert.deepEqual(findings.map((finding) => finding.evidence[0].source).sort(), [
    "packages[0].version",
    "packages[1].version",
    "packages[2].version",
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-customer-agent"), false);
  assert.equal(serialized.includes("private-internal-tool"), false);
  assert.equal(serialized.includes("private-third-tool"), false);
  assert.equal(serialized.includes("LATEST"), false);
  assert.equal(serialized.includes("unknown"), false);
  assert.match(serialized, /no advisory or CVE database was consulted/i);
});

test("package-version findings are deterministic and bounded", () => {
  const packages = Array.from({ length: 10 }, (_, index) => ({
    name: `private-package-${index}`,
    version: index % 2 === 0 ? "unknown" : "latest",
  }));
  const input = snapshot(packages);
  const first = createServerAuditPackageVersionFindings(input, { maxFindings: 4 });
  const second = createServerAuditPackageVersionFindings(input, { maxFindings: 4 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 4);
  assert.equal(first.filter((finding) => finding.title === "Package-version evidence findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("private-package"), false);
});

test("package-version option bounds fail closed", () => {
  const input = snapshot([]);
  assert.throws(() => createServerAuditPackageVersionFindings(input, { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditPackageVersionFindings(input, { maxFindings: 1001 }), /maxFindings/);
});
