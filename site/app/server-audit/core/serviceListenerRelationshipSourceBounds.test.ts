import assert from "node:assert/strict";
import test from "node:test";

import { analyzeServerAuditServiceListenerRelationships } from "./serviceListenerRelationships";
import type { ServerAuditSnapshot } from "./types";

test("service-listener analysis bounds per-relationship source allocation for ambiguous labels", () => {
  const input: ServerAuditSnapshot = {
    schemaVersion: "1",
    collectedAt: "2026-08-20T19:30:00.000Z",
    host: { hostname: "audit-host" },
    services: [{ name: "shared.service", state: "active" }],
    processes: Array.from({ length: 5_000 }, (_, index) => ({
      pid: index + 1,
      ppid: 1,
      uid: 0,
      state: "S",
      name: "shared",
    })),
    listeningSockets: [
      { protocol: "tcp", localAddress: "127.0.0.1", port: 3000, process: "shared" },
    ],
    metadata: { redactionsApplied: true },
  };

  const result = analyzeServerAuditServiceListenerRelationships(input, { maxRelationships: 1 });

  assert.equal(result.relationships.length, 1);
  assert.equal(result.relationships[0].kind, "ambiguous-service-listener");
  assert.equal(result.relationships[0].sources.length, 32);
  assert.equal(result.relationships[0].sourcesTruncated, true);
  assert.deepEqual(result.relationships[0].sources.slice(0, 4), [
    "services[0]",
    "listeningSockets[0]",
    "processes[0]",
    "processes[1]",
  ]);
  assert.equal(result.relationships[0].sources.at(-1), "processes[4999]");
  assert.equal(result.summary.ambiguousListenerAttributions, 1);
  assert.equal(result.summary.relationshipsWithTruncatedSources, 1);
  assert.equal(result.execution.maxSourcesPerRelationship, 32);
  assert.equal(result.execution.relationshipsTruncated, false);
  assert.equal(result.relationships[0].id, "server-service-listener:e2ca86dd");
});
