import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditWebIdentityCoverageFindings } from "./webIdentityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(web: NonNullable<ServerAuditSnapshot["web"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
    web,
    metadata: { redactionsApplied: true },
  };
}

test("web identity coverage reports blank server and root identities using structural evidence only", () => {
  const findings = createServerAuditWebIdentityCoverageFindings(snapshot({
    servers: ["   ", "nginx"],
    roots: [
      { path: "\t", owner: "1000", mode: "0750" },
      { path: "/private/valid-root", owner: "1000", mode: "0750" },
    ],
  }));

  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map((finding) => finding.title).sort(), [
    "Web-root record lacks a usable path identity",
    "Web-server record lacks a usable identity",
  ]);
  assert.deepEqual(findings.flatMap((finding) => finding.evidence.map((evidence) => evidence.source)).sort(), [
    "web.roots[0].path",
    "web.servers[0]",
  ]);
  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("nginx"), false);
  assert.equal(serialized.includes("/private/valid-root"), false);
  assert.equal(serialized.includes("1000"), false);
});

test("web identity coverage accepts normalized non-empty server and root identities", () => {
  assert.deepEqual(createServerAuditWebIdentityCoverageFindings(snapshot({
    servers: [" nginx ", "éproxy", "e\u0301proxy"],
    roots: [{ path: " /srv/www " }, { path: "/srv/é" }, { path: "/srv/e\u0301" }],
  })), []);
});

test("web identity coverage leaves unavailable records to their dedicated integrity stages", () => {
  const unavailableServer = undefined as unknown as string;
  const unavailableRoot = undefined as unknown as NonNullable<NonNullable<ServerAuditSnapshot["web"]>["roots"]>[number];
  assert.deepEqual(createServerAuditWebIdentityCoverageFindings(snapshot({
    servers: [unavailableServer],
    roots: [unavailableRoot],
  })), []);
});

test("web identity coverage output is deterministic and bounded across server and root records", () => {
  const first = createServerAuditWebIdentityCoverageFindings(snapshot({
    servers: Array.from({ length: 50 }, () => " "),
    roots: Array.from({ length: 60 }, () => ({ path: " " })),
  }));
  const second = createServerAuditWebIdentityCoverageFindings(snapshot({
    servers: Array.from({ length: 50 }, () => " "),
    roots: Array.from({ length: 60 }, () => ({ path: " " })),
  }));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.filter((finding) => finding.title === "Web identity coverage findings were truncated").length, 1);
  const structuralSources = first
    .filter((finding) => finding.title !== "Web identity coverage findings were truncated")
    .flatMap((finding) => finding.evidence.map((evidence) => evidence.source));
  assert.equal(new Set(structuralSources).size, 99);
  assert.equal(structuralSources.every((source) => /^web\.(servers\[\d+\]|roots\[\d+\]\.path)$/.test(source)), true);
});

test("web identity coverage emits no finding without web identity evidence", () => {
  assert.deepEqual(createServerAuditWebIdentityCoverageFindings({
    schemaVersion: "1",
    collectedAt: "2026-08-20T13:00:00.000Z",
    host: { hostname: "audit-host" },
  }), []);
});
