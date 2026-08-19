import assert from "node:assert/strict";
import test from "node:test";
import type { RepositoryArchitecturePathAnalysis } from "./architecturePaths";
import {
  createRepositoryArchitecturePathEvidenceArtifact,
  createRepositoryArchitecturePathEvidenceDownload,
  serializeRepositoryArchitecturePathEvidenceArtifact,
} from "./architecturePathArtifact";
import { verifyRepositoryAuditIntegrity } from "./reportIntegrity";

function fixture(): RepositoryArchitecturePathAnalysis {
  return {
    schema: "solvelang.repository-audit.architecture-paths.v0",
    mode: "analyze-only",
    graphId: "sg_fixture",
    status: "complete",
    summary: {
      rootCandidates: 1,
      rootsAnalyzed: 1,
      architecturePaths: 0,
      securityBoundaryPaths: 1,
    },
    paths: [
      {
        classification: "security-boundary",
        root: { nodeId: "route:api", kind: "route", path: "src/api.ts" },
        target: { nodeId: "permission:write", kind: "permission", path: "infra/policy.json" },
        depth: 2,
        segments: [
          {
            edgeId: "edge:route-resource",
            kind: "exposes",
            from: "route:api",
            to: "resource:queue",
            evidence: { path: "src/api.ts", line: 12 },
          },
          {
            edgeId: "edge:resource-permission",
            kind: "grants",
            from: "resource:queue",
            to: "permission:write",
            evidence: { path: "infra/policy.json", line: 8 },
          },
        ],
      },
    ],
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRootNodes: 50,
      maxDepth: 6,
      maxTraversalResults: 1_000,
      maxPaths: 200,
      graphTruncated: false,
      rootsTruncated: false,
      traversalTruncated: false,
      pathsTruncated: false,
    },
  };
}

test("creates deterministic integrity-covered architecture path evidence", async () => {
  const analysis = fixture();
  const first = await createRepositoryArchitecturePathEvidenceArtifact(analysis);
  const second = await createRepositoryArchitecturePathEvidenceArtifact(analysis);

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.architecture-path-evidence.v1");
  assert.equal(first.schemaVersion, "1.0.0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.equal(first.summary.securityBoundaryPaths, 1);
  assert.equal(first.paths[0]?.segments[0]?.evidence?.path, "src/api.ts");
  assert.equal(await verifyRepositoryAuditIntegrity(first), true);
  assert.ok(serializeRepositoryArchitecturePathEvidenceArtifact(first).endsWith("\n"));
});

test("artifact is detached from mutable analysis input and tampering breaks integrity", async () => {
  const analysis = fixture();
  const artifact = await createRepositoryArchitecturePathEvidenceArtifact(analysis);

  analysis.paths[0]!.root.path = "changed-after-export.ts";
  analysis.paths[0]!.segments[0]!.evidence!.path = "changed-after-export.ts";

  assert.equal(artifact.paths[0]?.root.path, "src/api.ts");
  assert.equal(artifact.paths[0]?.segments[0]?.evidence?.path, "src/api.ts");

  const tampered = {
    ...artifact,
    summary: { ...artifact.summary, securityBoundaryPaths: 0 },
  };
  assert.equal(await verifyRepositoryAuditIntegrity(tampered), false);
});

test("preserves explicit partial and truncation truth without adding capabilities", async () => {
  const analysis = fixture();
  analysis.status = "partial";
  analysis.execution.pathsTruncated = true;

  const artifact = await createRepositoryArchitecturePathEvidenceArtifact(analysis);

  assert.equal(artifact.status, "partial");
  assert.equal(artifact.execution.pathsTruncated, true);
  assert.equal(artifact.execution.networkAccess, false);
  assert.equal(artifact.execution.writeAccess, false);
});

test("creates a browser-ready architecture evidence download without changing the artifact schema", async () => {
  const download = await createRepositoryArchitecturePathEvidenceDownload(
    "My Repository.zip",
    fixture(),
  );

  assert.equal(
    download.filename,
    "My-Repository-solvelang-repository-audit-architecture-paths.json",
  );
  assert.equal(download.mediaType, "application/json;charset=utf-8");
  assert.ok(download.content.endsWith("\n"));
  assert.deepEqual(JSON.parse(download.content), download.artifact);
  assert.equal(download.artifact.schema, "solvelang.repository-audit.architecture-path-evidence.v1");
  assert.equal(download.artifact.schemaVersion, "1.0.0");
  assert.equal(download.artifact.mode, "analyze-only");
  assert.equal(download.artifact.execution.networkAccess, false);
  assert.equal(download.artifact.execution.writeAccess, false);
  assert.equal(await verifyRepositoryAuditIntegrity(download.artifact), true);
});
