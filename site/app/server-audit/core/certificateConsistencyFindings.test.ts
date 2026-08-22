import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditCertificateConsistencyFindings } from "./certificateConsistencyFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithCertificates(
  certificates: NonNullable<NonNullable<ServerAuditSnapshot["web"]>["certificates"]>,
): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T16:55:00.000Z",
    host: { hostname: "audit-host" },
    web: { certificates },
  };
}

test("duplicate certificate identities surface only contradictory explicit evidence", () => {
  const findings = createServerAuditCertificateConsistencyFindings(snapshotWithCertificates([
    { name: "API.Example.com", notAfter: "2026-10-01T00:00:00Z", daysRemaining: 44 },
    { name: "api.example.com", notAfter: "2026-10-02T00:00:00Z", daysRemaining: 45 },
    { name: "static.example.com", notAfter: "2026-11-01T00:00:00Z", daysRemaining: 75 },
  ]));

  assert.deepEqual(
    findings.map((finding) => finding.title).sort(),
    [
      "Duplicate certificate identity has conflicting expiry evidence",
      "Duplicate certificate identity has conflicting remaining-days evidence",
    ].sort(),
  );
  assert.deepEqual(findings.map((finding) => finding.id).sort(), ["srv_70a8022e", "srv_d4d6f842"].sort());
  assert.ok(findings.every((finding) => finding.severity === "info"));
  assert.ok(findings.every((finding) => finding.category === "evidence-integrity"));
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("api.example.com"), false);
  assert.equal(serialized.includes("API.Example.com"), false);
  assert.ok(serialized.includes("web.certificates[0].notAfter"));
  assert.ok(serialized.includes("web.certificates[1].daysRemaining"));
});

test("streaming contradiction detection preserves the first historical conflicting pair", () => {
  const findings = createServerAuditCertificateConsistencyFindings(snapshotWithCertificates([
    { name: "api.example.com", notAfter: "2026-10-01T00:00:00Z" },
    { name: "API.EXAMPLE.COM", notAfter: "2026-10-01T00:00:00Z" },
    { name: " api.example.com ", notAfter: "2026-10-02T00:00:00Z" },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.id, "srv_6fa8009b");
  assert.deepEqual(findings[0]?.evidence.map((item) => item.source), [
    "web.certificates[0].notAfter",
    "web.certificates[2].notAfter",
  ]);
});

test("blank explicit expiry text remains contradictory evidence rather than missing evidence", () => {
  const findings = createServerAuditCertificateConsistencyFindings(snapshotWithCertificates([
    { name: "api.example.com", notAfter: "   " },
    { name: "API.EXAMPLE.COM", notAfter: "2026-10-01T00:00:00Z" },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0]?.title, "Duplicate certificate identity has conflicting expiry evidence");
  assert.deepEqual(findings[0]?.evidence.map((item) => item.source), [
    "web.certificates[0].notAfter",
    "web.certificates[1].notAfter",
  ]);
});

test("matching duplicate records and missing fields do not create false conflicts", () => {
  const findings = createServerAuditCertificateConsistencyFindings(snapshotWithCertificates([
    { name: "api.example.com", notAfter: "2026-10-01T00:00:00Z", daysRemaining: 44 },
    { name: " API.EXAMPLE.COM ", notAfter: "2026-10-01T00:00:00Z", daysRemaining: 44 },
    { name: "api.example.com" },
  ]));
  assert.deepEqual(findings, []);
});

test("one explicit value and one absent value is incomplete evidence, not a contradiction", () => {
  const findings = createServerAuditCertificateConsistencyFindings(snapshotWithCertificates([
    { name: "api.example.com", notAfter: "2026-10-01T00:00:00Z", daysRemaining: 44 },
    { name: "api.example.com" },
  ]));
  assert.deepEqual(findings, []);
});

test("finding identifiers do not fingerprint certificate identities", () => {
  const first = createServerAuditCertificateConsistencyFindings(snapshotWithCertificates([
    { name: "private-a.example.internal", notAfter: "2026-10-01T00:00:00Z", daysRemaining: 44 },
    { name: "PRIVATE-A.EXAMPLE.INTERNAL", notAfter: "2026-10-02T00:00:00Z", daysRemaining: 45 },
  ]));
  const second = createServerAuditCertificateConsistencyFindings(snapshotWithCertificates([
    { name: "different-secret.internal", notAfter: "2026-10-01T00:00:00Z", daysRemaining: 44 },
    { name: "DIFFERENT-SECRET.INTERNAL", notAfter: "2026-10-02T00:00:00Z", daysRemaining: 45 },
  ]));

  assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
});

test("certificate consistency ordering and bounds are deterministic and redact identities", () => {
  const certificates = Array.from({ length: 120 }, (_, index) => [
    {
      name: `private-${index}.example.internal`,
      notAfter: "2026-10-01T00:00:00Z",
      daysRemaining: 44,
    },
    {
      name: `PRIVATE-${index}.EXAMPLE.INTERNAL`,
      notAfter: "2026-10-02T00:00:00Z",
      daysRemaining: 45,
    },
  ]).flat();
  const input = snapshotWithCertificates(certificates);
  const first = createServerAuditCertificateConsistencyFindings(input);
  const second = createServerAuditCertificateConsistencyFindings(input);

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.filter((finding) => finding.title === "Certificate consistency findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("example.internal"), false);
});

test("certificate consistency retains only bounded findings for thousands of contradictory groups", () => {
  const certificates = Array.from({ length: 5_000 }, (_, index) => [
    {
      name: `private-bulk-${index}.example.internal`,
      notAfter: "2026-10-01T00:00:00Z",
      daysRemaining: 44,
    },
    {
      name: `PRIVATE-BULK-${index}.EXAMPLE.INTERNAL`,
      notAfter: "2026-10-02T00:00:00Z",
      daysRemaining: 45,
    },
  ]).flat();

  const findings = createServerAuditCertificateConsistencyFindings(snapshotWithCertificates(certificates));

  assert.equal(findings.length, 100);
  assert.equal(findings.filter((finding) => finding.title === "Certificate consistency findings were truncated").length, 1);
  assert.equal(findings.filter((finding) => finding.category === "evidence-integrity").length, 99);
  assert.equal(JSON.stringify(findings).includes("private-bulk-"), false);
});
