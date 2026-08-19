import assert from "node:assert/strict";
import test from "node:test";
import type { ServerAuditProcessRelationshipAnalysis } from "./processRelationships";
import { createServerAuditProcessRelationshipPresentation } from "./processRelationshipPresentation";

function fixture(): ServerAuditProcessRelationshipAnalysis {
  return {
    schema: "solvelang.server-audit.process-relationships.v0",
    mode: "analyze-only",
    relationships: [
      {
        id: "server-process:00000003",
        kind: "ambiguous-listener-process",
        sources: ["listeningSockets[2]", "processes[3]", "processes[4]"],
      },
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
      processesChecked: 5,
      listenersChecked: 3,
      parentRelationshipsFound: 1,
      listenerRelationshipsFound: 1,
      ambiguousListenerAttributions: 1,
      unresolvedListenerAttributions: 0,
      duplicateProcessIdsSkipped: 0,
      invalidProcessLabelsSkipped: 0,
      invalidListenerLabelsSkipped: 0,
      relationshipsWithTruncatedSources: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 1_000,
      maxSourcesPerRelationship: 32,
      maxAttributionLabelBytes: 128,
      relationshipsTruncated: false,
    },
  };
}

test("creates deterministic structural-only process relationship presentation", () => {
  const analysis = fixture();
  const first = createServerAuditProcessRelationshipPresentation(analysis);
  const second = createServerAuditProcessRelationshipPresentation(analysis);

  assert.deepEqual(first, second);
  assert.deepEqual(first.rows.map((entry) => entry.id), [
    "server-process:00000001",
    "server-process:00000002",
    "server-process:00000003",
  ]);
  assert.deepEqual(first.summary, {
    relationships: 3,
    parentRelationships: 1,
    listenerRelationships: 1,
    ambiguousListenerRelationships: 1,
    shownRows: 3,
    hiddenRows: 0,
    unresolvedListenerAttributions: 0,
    duplicateProcessIdsSkipped: 0,
    invalidProcessLabelsSkipped: 0,
    invalidListenerLabelsSkipped: 0,
    relationshipsWithTruncatedSources: 0,
  });
  assert.equal(first.status, "partial");
  assert.equal(first.execution.sourcePartial, true);
  assert.ok(first.notices.some((notice) => notice.includes("explicitly ambiguous")));
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("nginx"), false);
  assert.equal(serialized.includes("postgres"), false);
  assert.ok(serialized.includes("listeningSockets[0]"));
  assert.ok(serialized.includes("processes[1]"));
});

test("presentation rows are detached from mutable analysis sources", () => {
  const analysis = fixture();
  const presentation = createServerAuditProcessRelationshipPresentation(analysis);

  analysis.relationships[0]!.sources[0] = "changed-after-presentation";
  assert.equal(presentation.rows[2]!.sources[0], "listeningSockets[2]");
});

test("source uncertainty and truncation are preserved with explicit notices", () => {
  const analysis = fixture();
  analysis.summary.ambiguousListenerAttributions = 0;
  analysis.summary.unresolvedListenerAttributions = 2;
  analysis.summary.duplicateProcessIdsSkipped = 3;
  analysis.summary.invalidProcessLabelsSkipped = 4;
  analysis.summary.invalidListenerLabelsSkipped = 5;
  analysis.summary.relationshipsWithTruncatedSources = 1;
  analysis.relationships[0]!.sourcesTruncated = true;
  analysis.execution.relationshipsTruncated = true;

  const presentation = createServerAuditProcessRelationshipPresentation(analysis);

  assert.equal(presentation.status, "partial");
  assert.equal(presentation.execution.sourcePartial, true);
  assert.ok(presentation.notices.some((notice) => notice.includes("relationship limit")));
  assert.ok(presentation.notices.some((notice) => notice.includes("source fanout")));
  assert.ok(presentation.notices.some((notice) => notice.includes("could not be resolved")));
  assert.ok(presentation.notices.some((notice) => notice.includes("duplicate process IDs")));
  assert.ok(presentation.notices.some((notice) => notice.includes("process label(s) were rejected")));
  assert.ok(presentation.notices.some((notice) => notice.includes("listening-socket process label(s)")));
});

test("row limits are independent and invalid bounds fail closed", () => {
  const analysis = fixture();
  analysis.summary.ambiguousListenerAttributions = 0;
  analysis.relationships = analysis.relationships.map((entry) => entry.kind === "ambiguous-listener-process"
    ? { ...entry, kind: "listener-process" as const }
    : entry);
  const presentation = createServerAuditProcessRelationshipPresentation(analysis, { maxRows: 1 });

  assert.equal(presentation.rows.length, 1);
  assert.equal(presentation.summary.hiddenRows, 2);
  assert.equal(presentation.execution.rowsTruncated, true);
  assert.equal(presentation.status, "partial");
  assert.ok(presentation.notices.some((notice) => notice.includes("first bounded subset")));

  assert.throws(
    () => createServerAuditProcessRelationshipPresentation(analysis, { maxRows: 0 }),
    /maxRows/,
  );
  assert.throws(
    () => createServerAuditProcessRelationshipPresentation(analysis, { maxRows: 1_001 }),
    /maxRows/,
  );
});

test("fully resolved bounded structural evidence remains complete", () => {
  const analysis = fixture();
  analysis.relationships = analysis.relationships.filter((entry) => entry.kind !== "ambiguous-listener-process");
  analysis.summary.ambiguousListenerAttributions = 0;
  const presentation = createServerAuditProcessRelationshipPresentation(analysis);

  assert.equal(presentation.status, "complete");
  assert.equal(presentation.execution.sourcePartial, false);
  assert.deepEqual(presentation.notices, []);
});

test("mutable or non-analyze-only execution contracts fail closed", () => {
  const mutable = fixture() as unknown as {
    mode: string;
    execution: Omit<ServerAuditProcessRelationshipAnalysis["execution"], "writeAccess"> & {
      writeAccess: boolean;
    };
  };
  mutable.execution.writeAccess = true;
  assert.throws(
    () => createServerAuditProcessRelationshipPresentation(mutable as unknown as ServerAuditProcessRelationshipAnalysis),
    /analyze-only input/,
  );
});
