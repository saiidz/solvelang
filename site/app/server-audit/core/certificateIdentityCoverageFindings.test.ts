import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditCertificateIdentityCoverageFindings } from "./certificateIdentityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(certificates: NonNullable<NonNullable<ServerAuditSnapshot["web"]>["certificates"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
    web: { certificates },
    metadata: { redactionsApplied: true },
  };
}

test("certificate identity coverage reports blank normalized identities using structural evidence only", () => {
  const findings = createServerAuditCertificateIdentityCoverageFindings(snapshot([
    { name: "   ", notAfter: "2026-09-01T00:00:00.000Z" },
    { name: "\t", daysRemaining: 12 },
    { name: "api.example.internal", notAfter: "2026-09-10T00:00:00.000Z", daysRemaining: 21 },
  ]));

  assert.equal(findings.length, 2);
  assert.equal(findings.every((finding) => finding.severity === "info"), true);
  assert.equal(findings.every((finding) => finding.category === "coverage"), true);
  assert.equal(findings.every((finding) => finding.title === "TLS certificate record lacks a usable identity"), true);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "web.certificates[0].name",
    "web.certificates[1].name",
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("api.example.internal"), false);
  assert.equal(serialized.includes("2026-09-01"), false);
});

test("certificate identity coverage treats normalized non-empty identities as usable", () => {
  assert.deepEqual(createServerAuditCertificateIdentityCoverageFindings(snapshot([
    { name: " Example.COM ", daysRemaining: 12 },
    { name: "éxample.internal", notAfter: "2026-09-10T00:00:00.000Z" },
    { name: "e\u0301xample.internal", daysRemaining: 21 },
  ])), []);
});

test("certificate identity coverage output is deterministic and bounded", () => {
  const certificates = Array.from({ length: 105 }, () => ({ name: "   " }));
  const first = createServerAuditCertificateIdentityCoverageFindings(snapshot(certificates));
  const second = createServerAuditCertificateIdentityCoverageFindings(snapshot(certificates));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const identityFindings = first.filter((finding) => finding.title === "TLS certificate record lacks a usable identity");
  assert.equal(identityFindings.length, 99);
  assert.equal(first.filter((finding) => finding.title === "Certificate identity coverage findings were truncated").length, 1);
  const structuralSources = identityFindings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^web\.certificates\[\d+\]\.name$/.test(source)), true);
});

test("certificate identity coverage emits no finding when certificate evidence is absent", () => {
  assert.deepEqual(createServerAuditCertificateIdentityCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
});
