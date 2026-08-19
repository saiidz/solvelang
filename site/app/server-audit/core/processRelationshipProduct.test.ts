import assert from "node:assert/strict";
import test from "node:test";

import type { ServerAuditProcessRelationshipAnalysis } from "./processRelationships";
import { createServerAuditProcessRelationshipProductBundle } from "./processRelationshipProduct";

function fixture(): ServerAuditProcessRelationshipAnalysis {
  return {
    schema: "solvelang.server-audit.process-relationships.v0",
    mode: "analyze-only",
    relationships: [
      {
        id: "server-process:00000001",
        kind: "parent-process",
        sources: ["processes[0]", "processes[1]"],
      },
      {
        id: "server-process:00000002",
        kind: "listener-process",
        sources: ["listeningSockets[0]", "processes[1]"],
      },
    ],
    summary: {
      processesChecked: 2,
      listenersChecked: 1,
      parentRelationshipsFound: 1,
      listenerRelationshipsFound: 1,
      ambiguousListenerAttributions: 0,
      unresolvedListenerAttributions: 0,
      duplicateProcessIdsSkipped: 0,
      invalidProcessLabelsSkipped: 0,
      invalidListenerLabelsSkipped: 0,
      relationshipsWithTruncatedSources: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 1000,
      maxSourcesPerRelationship: 32,
      maxAttributionLabelBytes: 128,
      relationshipsTruncated: false,
    },
  };
}

test("composes deterministic structural artifact and presentation outputs", async () => {
  const first = await createServerAuditProcessRelationshipProductBundle("host snapshot.json", fixture());
  const second = await createServerAuditProcessRelationshipProductBundle("host snapshot.json", structuredClone(fixture()));

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.server-audit.process-relationship-product.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.status, "complete");
  assert.equal(first.download.artifact.relationships.length, 2);
  assert.equal(first.presentation.summary.relationships, 2);
  assert.match(first.download.filename, /host-snapshot-solvelang-server-audit-process-relationships\.json$/);
  assert.match(first.download.artifact.integrity.canonicalJsonSha256, /^[a-f0-9]{64}$/);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.ok(!JSON.stringify(first).includes("nginx"));
});

test("presentation row bounds participate in product partial truth without mutating source analysis", async () => {
  const analysis = fixture();
  const before = structuredClone(analysis);
  const result = await createServerAuditProcessRelationshipProductBundle("host.json", analysis, { maxRows: 1 });

  assert.deepEqual(analysis, before);
  assert.equal(result.status, "partial");
  assert.equal(result.execution.sourcePartial, false);
  assert.equal(result.execution.presentationRowsTruncated, true);
  assert.equal(result.presentation.summary.shownRows, 1);
  assert.equal(result.presentation.summary.hiddenRows, 1);
  assert.equal(result.download.artifact.relationships.length, 2);
});

test("source ambiguity remains partial independently from presentation bounds", async () => {
  const analysis = fixture();
  analysis.relationships[1] = {
    id: "server-process:00000002",
    kind: "ambiguous-listener-process",
    sources: ["listeningSockets[0]", "processes[0]", "processes[1]"],
  };
  analysis.summary.listenerRelationshipsFound = 0;
  analysis.summary.ambiguousListenerAttributions = 1;
  const result = await createServerAuditProcessRelationshipProductBundle("host.json", analysis, { maxRows: 10 });

  assert.equal(result.status, "partial");
  assert.equal(result.execution.sourcePartial, true);
  assert.equal(result.execution.presentationRowsTruncated, false);
  assert.match(result.presentation.notices.join(" "), /explicitly ambiguous/i);
});

test("fails closed when runtime input claims mutable capabilities", async () => {
  const runtimeAnalysis = structuredClone(fixture()) as unknown as {
    mode: string;
    execution: { networkAccess: boolean; writeAccess: boolean } & Record<string, unknown>;
  };
  runtimeAnalysis.execution.writeAccess = true;

  await assert.rejects(
    createServerAuditProcessRelationshipProductBundle(
      "host.json",
      runtimeAnalysis as unknown as ServerAuditProcessRelationshipAnalysis,
    ),
    /requires analyze-only input/,
  );
});
