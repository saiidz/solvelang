import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditWebRootPermissionCoverageFindings } from "./webRootPermissionCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(roots: NonNullable<NonNullable<ServerAuditSnapshot["web"]>["roots"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-21T04:20:00.000Z",
    host: { hostname: "audit-host" },
    web: { roots },
    metadata: { redactionsApplied: true },
  };
}

test("web-root permission coverage reports missing ownership and mode evidence structurally", () => {
  const findings = createServerAuditWebRootPermissionCoverageFindings(snapshot([
    { path: "/srv/private-complete", owner: "app", mode: "0755" },
    { path: "/srv/private-no-owner", mode: "0750" },
    { path: "/srv/private-blank-owner", owner: "   ", mode: "0750" },
    { path: "/srv/private-no-mode", owner: "deploy" },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Web-root ownership or permission evidence is incomplete");
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "coverage");
  assert.ok(findings[0].summary.includes("2 of 4 supplied web-root record(s) lack usable owner evidence"));
  assert.ok(findings[0].summary.includes("1 lack mode evidence"));
  assert.deepEqual(findings[0].evidence, [
    { source: "web.roots[1].owner", summary: "owner missing or blank" },
    { source: "web.roots[3].mode", summary: "mode missing" },
    { source: "web.roots[2].owner", summary: "owner missing or blank" },
  ]);

  const serialized = JSON.stringify(findings);
  for (const privateValue of [
    "/srv/private-complete",
    "/srv/private-no-owner",
    "/srv/private-blank-owner",
    "/srv/private-no-mode",
    "deploy",
    "app",
    "0755",
  ]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("web-root permission coverage leaves absent, empty, complete, and uninterpretable modes to existing stages", () => {
  const absent: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-21T04:20:00.000Z",
    host: { hostname: "audit-host" },
    metadata: { redactionsApplied: true },
  };

  assert.deepEqual(createServerAuditWebRootPermissionCoverageFindings(absent), []);
  assert.deepEqual(createServerAuditWebRootPermissionCoverageFindings(snapshot([])), []);
  assert.deepEqual(createServerAuditWebRootPermissionCoverageFindings(snapshot([
    { path: "/srv/private-a", owner: "app", mode: "0755" },
    { path: "/srv/private-b", owner: "deploy", mode: "not-octal" },
  ])), []);
});

test("web-root permission coverage is deterministic and bounds interleaved structural evidence", () => {
  const roots = Array.from({ length: 150 }, (_, index) => ({
    path: `/srv/private-${index}`,
  }));

  const first = createServerAuditWebRootPermissionCoverageFindings(snapshot(roots));
  const second = createServerAuditWebRootPermissionCoverageFindings(snapshot(roots));

  assert.deepEqual(first, second);
  assert.equal(first.length, 1);
  assert.equal(first[0].evidence.length, 100);
  assert.deepEqual(first[0].evidence[0], {
    source: "web.roots[0].owner",
    summary: "owner missing or blank",
  });
  assert.deepEqual(first[0].evidence[1], {
    source: "web.roots[0].mode",
    summary: "mode missing",
  });
  assert.deepEqual(first[0].evidence[98], {
    source: "web.roots[49].owner",
    summary: "owner missing or blank",
  });
  assert.deepEqual(first[0].evidence[99], {
    source: "web.roots[49].mode",
    summary: "mode missing",
  });
  assert.ok(first[0].summary.includes("150 of 150 supplied web-root record(s) lack usable owner evidence"));
  assert.ok(first[0].summary.includes("150 lack mode evidence"));
  assert.ok(first[0].summary.includes("Only the first 100 structural reference(s) are included."));
  assert.equal(JSON.stringify(first).includes("web.roots[50].owner"), false);
  assert.equal(JSON.stringify(first).includes("private-149"), false);
});

test("web-root permission coverage preserves both evidence dimensions when their gaps occur in disjoint ranges", () => {
  const roots = Array.from({ length: 200 }, (_, index) => index < 100
    ? { path: `/srv/private-owner-${index}`, mode: "0755" }
    : { path: `/srv/private-mode-${index}`, owner: "app" });

  const findings = createServerAuditWebRootPermissionCoverageFindings(snapshot(roots));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].evidence.length, 100);
  assert.deepEqual(findings[0].evidence.slice(0, 4), [
    { source: "web.roots[0].owner", summary: "owner missing or blank" },
    { source: "web.roots[100].mode", summary: "mode missing" },
    { source: "web.roots[1].owner", summary: "owner missing or blank" },
    { source: "web.roots[101].mode", summary: "mode missing" },
  ]);
  assert.deepEqual(findings[0].evidence.at(-2), {
    source: "web.roots[49].owner",
    summary: "owner missing or blank",
  });
  assert.deepEqual(findings[0].evidence.at(-1), {
    source: "web.roots[149].mode",
    summary: "mode missing",
  });
  assert.ok(findings[0].summary.includes("100 of 200 supplied web-root record(s) lack usable owner evidence"));
  assert.ok(findings[0].summary.includes("100 lack mode evidence"));
  assert.ok(findings[0].summary.includes("Only the first 100 structural reference(s) are included."));
  assert.equal(JSON.stringify(findings).includes("private-owner"), false);
  assert.equal(JSON.stringify(findings).includes("private-mode"), false);
});
