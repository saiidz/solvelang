import assert from "node:assert/strict";
import test from "node:test";
import type { ServerAuditProcessRelationshipAnalysis } from "./processRelationships";
import {
  createServerAuditProcessRelationshipArtifact,
  createServerAuditProcessRelationshipDownload,
  serializeServerAuditProcessRelationshipArtifact,
  type ServerAuditProcessRelationshipArtifact,
} from "./processRelationshipArtifact";

const encoder = new TextEncoder();

function fixture(): ServerAuditProcessRelationshipAnalysis {
  return {
    schema: "solvelang.server-audit.process-relationships.v0",
    mode: "analyze-only",
    relationships: [
      {
        id: "server-process:00000002",
        kind: "listener-process",
        sources: ["listeningSockets[0]", "processes[1]"],
      },
      {
        id: "server-process:00000001",
        kind: "parent-process",
        sources: ["processes[0]", "processes[1]"],
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
      maxRelationships: 1_000,
      maxSourcesPerRelationship: 32,
      maxAttributionLabelBytes: 128,
      relationshipsTruncated: false,
    },
  };
}

async function verifyIntegrity(artifact: ServerAuditProcessRelationshipArtifact): Promise<boolean> {
  const { integrity, ...withoutIntegrity } = artifact;
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    encoder.encode(JSON.stringify(withoutIntegrity)),
  );
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return hex === integrity.canonicalJsonSha256;
}

test("creates deterministic integrity-covered structural process relationship artifacts", async () => {
  const analysis = fixture();
  const first = await createServerAuditProcessRelationshipArtifact(analysis);
  const second = await createServerAuditProcessRelationshipArtifact(analysis);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.server-audit.process-relationships-artifact.v1");
  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.status, "complete");
  assert.deepEqual(first.relationships.map((entry) => entry.id), [
    "server-process:00000001",
    "server-process:00000002",
  ]);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(await verifyIntegrity(first), true);
  assert.ok(serializeServerAuditProcessRelationshipArtifact(first).endsWith("\n"));

  const serialized = JSON.stringify(first);
  assert.equal(serialized.includes("nginx"), false);
  assert.equal(serialized.includes("postgres"), false);
  assert.ok(serialized.includes("listeningSockets[0]"));
  assert.ok(serialized.includes("processes[1]"));
});

test("artifact is detached from mutable analyzer state and tampering breaks integrity", async () => {
  const analysis = fixture();
  const artifact = await createServerAuditProcessRelationshipArtifact(analysis);

  analysis.relationships[0]!.sources[0] = "changed-after-export";
  analysis.summary.listenerRelationshipsFound = 99;

  assert.equal(artifact.relationships[1]!.sources[0], "listeningSockets[0]");
  assert.equal(artifact.summary.listenerRelationshipsFound, 1);

  const tampered = {
    ...artifact,
    relationships: artifact.relationships.map((entry, index) => index === 0
      ? { ...entry, kind: "listener-process" as const }
      : entry),
  };
  assert.equal(await verifyIntegrity(tampered), false);
});

test("preserves ambiguity and bounded-evidence uncertainty as partial truth", async () => {
  const analysis = fixture();
  analysis.relationships.push({
    id: "server-process:00000003",
    kind: "ambiguous-listener-process",
    sources: ["listeningSockets[1]", "processes[0]", "processes[1]"],
    sourcesTruncated: true,
  });
  analysis.summary.ambiguousListenerAttributions = 1;
  analysis.summary.unresolvedListenerAttributions = 2;
  analysis.summary.duplicateProcessIdsSkipped = 3;
  analysis.summary.invalidProcessLabelsSkipped = 4;
  analysis.summary.invalidListenerLabelsSkipped = 5;
  analysis.summary.relationshipsWithTruncatedSources = 1;
  analysis.execution.relationshipsTruncated = true;

  const artifact = await createServerAuditProcessRelationshipArtifact(analysis);

  assert.equal(artifact.status, "partial");
  assert.equal(artifact.summary.ambiguousListenerAttributions, 1);
  assert.equal(artifact.summary.unresolvedListenerAttributions, 2);
  assert.equal(artifact.summary.relationshipsWithTruncatedSources, 1);
  assert.equal(artifact.relationships[2]?.sourcesTruncated, true);
  assert.equal(artifact.execution.relationshipsTruncated, true);
  assert.equal(await verifyIntegrity(artifact), true);
});

test("creates a safe browser-ready process relationship download", async () => {
  const download = await createServerAuditProcessRelationshipDownload(
    "Production Host 01.snapshot.json",
    fixture(),
  );

  assert.equal(
    download.filename,
    "Production-Host-01.snapshot-solvelang-server-audit-process-relationships.json",
  );
  assert.equal(download.mediaType, "application/json;charset=utf-8");
  assert.deepEqual(JSON.parse(download.content), download.artifact);
  assert.equal(download.artifact.mode, "analyze-only");
  assert.equal(download.artifact.execution.networkAccess, false);
  assert.equal(download.artifact.execution.writeAccess, false);
  assert.equal(await verifyIntegrity(download.artifact), true);
});

test("mutable or non-analyze-only artifact inputs fail closed", async () => {
  const mutable = fixture() as unknown as {
    mode: string;
    execution: Omit<ServerAuditProcessRelationshipAnalysis["execution"], "networkAccess"> & {
      networkAccess: boolean;
    };
  };
  mutable.execution.networkAccess = true;

  await assert.rejects(
    createServerAuditProcessRelationshipArtifact(mutable as unknown as ServerAuditProcessRelationshipAnalysis),
    /analyze-only input/,
  );
});
