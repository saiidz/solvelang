import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditCertificateCoverageFindings } from "./certificateCoverageFindings";
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

test("certificate coverage reports records with no supplied expiry evidence without leaking certificate names", () => {
  const privateName = "private-expiry-gap.example.internal";
  const findings = createServerAuditCertificateCoverageFindings(snapshot([
    { name: privateName },
    { name: "has-not-after", notAfter: "2026-09-01T00:00:00.000Z" },
    { name: "has-days", daysRemaining: 12 },
    { name: "has-both", notAfter: "2026-09-10T00:00:00.000Z", daysRemaining: 21 },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].id, "srv_2b1c75ef");
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "coverage");
  assert.equal(findings[0].title, "TLS certificate record lacks expiry evidence");
  assert.deepEqual(findings[0].evidence, [{
    source: "web.certificates[0]",
    summary: "certificate record has no supplied expiry evidence",
  }]);
  assert.equal(JSON.stringify(findings).includes(privateName), false);
});

test("certificate coverage output is deterministic and bounded", () => {
  const certificates = Array.from({ length: 105 }, (_, index) => ({ name: `private-${index}.example.internal` }));
  const first = createServerAuditCertificateCoverageFindings(snapshot(certificates));
  const second = createServerAuditCertificateCoverageFindings(snapshot(certificates));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.filter((finding) => finding.title === "TLS certificate record lacks expiry evidence").length, 99);
  assert.equal(first.filter((finding) => finding.title === "Certificate expiry coverage findings were truncated").length, 1);
  assert.equal(JSON.stringify(first).includes("private-104.example.internal"), false);
});

test("certificate coverage materializes only the bounded finding prefix for high-cardinality gaps", () => {
  const certificates = Array.from({ length: 5_000 }, (_, index) => ({
    name: `private-bulk-${index}.example.internal`,
  }));

  const findings = createServerAuditCertificateCoverageFindings(snapshot(certificates));

  assert.equal(findings.length, 100);
  assert.equal(findings.filter((finding) => finding.title === "TLS certificate record lacks expiry evidence").length, 99);
  assert.equal(findings.filter((finding) => finding.title === "Certificate expiry coverage findings were truncated").length, 1);
  assert.equal(JSON.stringify(findings).includes("private-bulk-"), false);
});

test("certificate coverage emits no finding when expiry evidence is supplied", () => {
  assert.deepEqual(createServerAuditCertificateCoverageFindings(snapshot([
    { name: "not-after-only", notAfter: "2026-09-01T00:00:00.000Z" },
    { name: "days-only", daysRemaining: 12 },
    { name: "both", notAfter: "2026-09-10T00:00:00.000Z", daysRemaining: 21 },
  ])), []);
});
