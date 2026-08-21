import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditWebServerRelationshipFindings } from "./webServerRelationshipFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(overrides: Partial<ServerAuditSnapshot>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T18:40:00.000Z",
    host: { hostname: "audit-host" },
    ...overrides,
  };
}

test("consistent web server, service, and package evidence produces no finding", () => {
  const findings = createServerAuditWebServerRelationshipFindings(snapshot({
    web: { servers: ["nginx"] },
    services: [{ name: "nginx.service", state: "loaded active running" }],
    packages: [{ name: "nginx-core", version: "1.26.0" }],
  }));
  assert.deepEqual(findings, []);
});

test("missing service and package relationships remain conservative evidence-integrity findings", () => {
  const findings = createServerAuditWebServerRelationshipFindings(snapshot({
    web: { servers: ["nginx"] },
    services: [],
    packages: [],
  }));

  assert.deepEqual(findings.map((finding) => finding.title).sort(), [
    "Active web server is not represented in package inventory",
    "Active web server is not represented in service inventory",
  ]);
  assert.ok(findings.every((finding) => finding.severity === "info"));
  assert.ok(findings.every((finding) => finding.category === "evidence-integrity"));
});

test("contradictory active and failed service evidence is explicit and structural", () => {
  const findings = createServerAuditWebServerRelationshipFindings(snapshot({
    web: { servers: ["apache2"] },
    services: [{ name: "apache2.service", state: "loaded failed failed" }],
    packages: [{ name: "apache2", version: "2.4" }],
  }));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "medium");
  assert.equal(findings[0].title, "Web-server probes disagree on service health");
  assert.deepEqual(findings[0].evidence.map((item) => item.source), ["web.servers[0]", "services[0].state"]);
});

test("unknown web-server labels are not guessed into relationships", () => {
  const findings = createServerAuditWebServerRelationshipFindings(snapshot({
    web: { servers: ["private-custom-proxy"] },
    services: [],
    packages: [],
  }));
  assert.deepEqual(findings, []);
});

test("relationship finding bounds fail closed and truncate deterministically", () => {
  const servers = Array.from({ length: 30 }, (_, index) => index % 2 === 0 ? "nginx" : "caddy");
  const input = snapshot({ web: { servers }, services: [], packages: [] });
  const first = createServerAuditWebServerRelationshipFindings(input, { maxFindings: 5 });
  const second = createServerAuditWebServerRelationshipFindings(input, { maxFindings: 5 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
  assert.equal(first.filter((finding) => finding.title === "Web-server relationship findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.throws(() => createServerAuditWebServerRelationshipFindings(input, { maxFindings: 0 }), /maxFindings/);
  assert.throws(() => createServerAuditWebServerRelationshipFindings(input, { maxFindings: 501 }), /maxFindings/);
});

test("retains only the bounded deterministic finding prefix under high-cardinality service contradictions", () => {
  const services = Array.from({ length: 5_000 }, (_, index) => ({
    name: `nginx@worker-${index}.service`,
    state: "loaded failed failed",
  }));
  const input = snapshot({ web: { servers: ["nginx"] }, services });

  const first = createServerAuditWebServerRelationshipFindings(input, { maxFindings: 2 });
  const second = createServerAuditWebServerRelationshipFindings(structuredClone(input), { maxFindings: 2 });

  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.equal(first.filter((finding) => finding.title === "Web-server probes disagree on service health").length, 1);
  const limitation = first.find((finding) => finding.title === "Web-server relationship findings were truncated");
  assert.ok(limitation);
  assert.match(limitation.summary, /produced 5000 findings/);
  assert.deepEqual(
    first.flatMap((finding) => finding.evidence.map((item) => item.source)).filter((source) => source.startsWith("services[")),
    ["services[2464].state"],
  );
});
