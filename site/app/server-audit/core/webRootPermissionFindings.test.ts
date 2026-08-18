import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditWebRootPermissionFindings } from "./webRootPermissionFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshotWithRoots(roots: NonNullable<NonNullable<ServerAuditSnapshot["web"]>["roots"]>): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-18T15:50:00.000Z",
    host: { hostname: "audit-host" },
    web: { roots },
  };
}

test("web-root permission findings stay conservative and structural", () => {
  const findings = createServerAuditWebRootPermissionFindings(snapshotWithRoots([
    { path: "/srv/private/world", owner: "0", mode: "0777" },
    { path: "/srv/private/group", owner: "1001", mode: "775" },
    { path: "/srv/private/safe", owner: "1002", mode: "755" },
  ]));

  assert.deepEqual(
    findings.map((finding) => [finding.severity, finding.title]),
    [
      ["high", "Candidate web root is world-writable"],
      ["low", "Candidate web root is group-writable"],
    ],
  );

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("/srv/private/world"), false);
  assert.equal(serialized.includes("/srv/private/group"), false);
  assert.equal(serialized.includes("1001"), false);
  assert.ok(serialized.includes("web.roots[0].mode"));
  assert.ok(serialized.includes("web.roots[1].owner"));
});

test("world-writable evidence is not duplicated as group-writable", () => {
  const findings = createServerAuditWebRootPermissionFindings(snapshotWithRoots([
    { path: "/srv/private/root", owner: "1000", mode: "777" },
  ]));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].title, "Candidate web root is world-writable");
});

test("uninterpretable or absent mode evidence never becomes a permission assertion", () => {
  const findings = createServerAuditWebRootPermissionFindings(snapshotWithRoots([
    { path: "/srv/private/unknown", owner: "1000", mode: "rwxrwxrwx" },
    { path: "/srv/private/not-collected", owner: "1000" },
  ]));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "info");
  assert.equal(findings[0].category, "evidence-integrity");
  assert.equal(findings[0].title, "Web-root permission evidence is not interpretable");
  assert.equal(JSON.stringify(findings).includes("rwxrwxrwx"), false);
});

test("web-root permission finding order and bounds are deterministic", () => {
  const roots = Array.from({ length: 130 }, (_, index) => ({
    path: `/srv/private/${index}`,
    owner: String(1000 + index),
    mode: index % 2 === 0 ? "777" : "775",
  }));
  const input = snapshotWithRoots(roots);
  const first = createServerAuditWebRootPermissionFindings(input);
  const second = createServerAuditWebRootPermissionFindings(input);

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.filter((finding) => finding.title === "Web-root permission findings were truncated").length, 1);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("/srv/private/"), false);
});
