import assert from "node:assert/strict";
import test from "node:test";
import { createServerAuditListenerIdentityCoverageFindings } from "./listenerIdentityCoverageFindings";
import type { ServerAuditSnapshot } from "./types";

function snapshot(listeningSockets?: ServerAuditSnapshot["listeningSockets"]): ServerAuditSnapshot {
  return {
    schemaVersion: "1",
    collectedAt: "2026-08-20T23:30:00.000Z",
    host: { hostname: "audit-host" },
    listeningSockets,
  };
}

test("listener identity coverage stays silent for absent or usable identities", () => {
  assert.deepEqual(createServerAuditListenerIdentityCoverageFindings(snapshot()), []);
  assert.deepEqual(createServerAuditListenerIdentityCoverageFindings(snapshot([
    { protocol: "tcp", localAddress: "127.0.0.1", port: 8080, process: "private-worker" },
  ])), []);
});

test("listener identity coverage emits structural evidence for blank protocol and address", () => {
  const findings = createServerAuditListenerIdentityCoverageFindings(snapshot([
    { protocol: " \t ", localAddress: "\n", port: 443, process: "private-worker" },
    { protocol: "tcp", localAddress: "10.0.0.12", port: 8443, process: "private-valid" },
  ]));

  assert.equal(findings.length, 2);
  assert.deepEqual(
    new Set(findings.map((finding) => finding.title)),
    new Set([
      "Listening socket record lacks a usable protocol identity",
      "Listening socket record lacks a usable local-address identity",
    ]),
  );
  assert.deepEqual(
    new Set(findings.flatMap((finding) => finding.evidence.map((item) => item.source))),
    new Set(["listeningSockets[0].protocol", "listeningSockets[0].localAddress"]),
  );

  const serialized = JSON.stringify(findings);
  assert.equal(serialized.includes("private-worker"), false);
  assert.equal(serialized.includes("private-valid"), false);
  assert.equal(serialized.includes("10.0.0.12"), false);
});

test("listener identity coverage is deterministic and bounded", () => {
  const listeners = Array.from({ length: 60 }, (_, index) => ({
    protocol: " ",
    localAddress: "\t",
    port: 10_000 + index,
    process: `private-process-${index}`,
  }));

  const first = createServerAuditListenerIdentityCoverageFindings(snapshot(listeners));
  const second = createServerAuditListenerIdentityCoverageFindings(snapshot(listeners));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  assert.equal(first.filter((finding) => finding.title === "Listening socket identity coverage findings were truncated").length, 1);
  assert.equal(JSON.stringify(first).includes("private-process-"), false);
});

test("listener identity coverage retention stays bounded across 5,000 dual-gap records", () => {
  const listeners = Array.from({ length: 5_000 }, (_, index) => ({
    protocol: " ",
    localAddress: "\t",
    port: 20_000 + (index % 40_000),
    process: `private-process-${index}`,
  }));
  const input = snapshot(listeners);
  const first = createServerAuditListenerIdentityCoverageFindings(input);
  const second = createServerAuditListenerIdentityCoverageFindings(structuredClone(input));

  assert.deepEqual(first, second);
  assert.equal(first.length, 100);
  const limitation = first.find((finding) => finding.title === "Listening socket identity coverage findings were truncated");
  assert.ok(limitation);
  assert.match(limitation.summary, /produced 10000 findings/);
  assert.equal(new Set(first.map((finding) => finding.id)).size, first.length);
  assert.equal(JSON.stringify(first).includes("private-process-"), false);
});
