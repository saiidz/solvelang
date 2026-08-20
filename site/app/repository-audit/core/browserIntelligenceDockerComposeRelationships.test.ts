import assert from "node:assert/strict";
import test from "node:test";

import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { createRepositoryAuditBrowserIntelligence } from "./browserIntelligence";
import type { RepositoryDeploymentPathEvidenceAnalysis } from "./deploymentPathEvidence";
import { analyzeDockerComposeRelationshipSnapshot } from "./dockerComposeRelationshipSnapshotEvidence";
import type { RepositorySnapshot } from "./inventory";

async function fixture() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:compose-relationship-browser",
    label: "Compose relationship browser repository",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const compose = await createSolveGraphNode({
    kind: "file",
    identity: "file:compose.yml",
    label: "compose.yml",
    evidence: [{ kind: "configuration", path: "compose.yml", line: 1 }],
    metadata: { path: "compose.yml" },
  });
  const containsCompose = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: compose.id,
    evidence: [{ kind: "deterministic-analysis", path: "compose.yml" }],
  });
  const graph = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "compose-relationship-browser-fixture", version: "1", deterministic: true }],
    nodes: [repository, compose],
    edges: [containsCompose],
  });
  const deploymentPathEvidence: RepositoryDeploymentPathEvidenceAnalysis = {
    schema: "solvelang.repository-audit.deployment-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: "complete",
    relationships: [],
    skipped: {
      missingText: 0,
      oversizedText: 0,
      invalidJson: 0,
      dynamicReference: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 250,
      maxConfigTextBytes: 1024 * 1024,
      relationshipsTruncated: false,
      acceptedFiles: 1,
      deploymentFilesExamined: 0,
      graphTruncated: false,
    },
  };
  const snapshot: RepositorySnapshot = {
    source: {
      kind: "github",
      displayName: solveGraphFixtureSource.displayName,
      revision: solveGraphFixtureSource.revision,
      fingerprint: solveGraphFixtureSource.fingerprint,
    },
    files: [{
      path: "compose.yml",
      byteSize: 120,
      text: "services:\n  web:\n    depends_on:\n      - db\n      - cache\n  db:\n    image: postgres:17\n  cache:\n    image: redis:7\n",
    }],
  };
  return {
    graph,
    deploymentPathEvidence,
    dockerComposeRelationshipEvidence: analyzeDockerComposeRelationshipSnapshot(snapshot),
  };
}

test("composes optional Docker Compose relationship presentation into browser intelligence", async () => {
  const { graph, deploymentPathEvidence, dockerComposeRelationshipEvidence } = await fixture();
  const result = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    { dockerComposeRelationships: { maxRows: 10 } },
    undefined,
    undefined,
    undefined,
    undefined,
    dockerComposeRelationshipEvidence,
  );

  assert.equal(result.status, "complete");
  assert.equal(result.dockerComposeRelationships?.summary.relationshipsSeen, 2);
  assert.deepEqual(
    result.dockerComposeRelationships?.rows.map((row) => row.toService),
    ["cache", "db"],
  );
  assert.equal(result.execution.dockerComposeRelationshipPartial, false);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
});

test("propagates Compose relationship source and row partiality independently", async () => {
  const { graph, deploymentPathEvidence, dockerComposeRelationshipEvidence } = await fixture();
  const rowPartial = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    { dockerComposeRelationships: { maxRows: 1 } },
    undefined,
    undefined,
    undefined,
    undefined,
    dockerComposeRelationshipEvidence,
  );

  assert.equal(rowPartial.status, "partial");
  assert.equal(rowPartial.execution.dockerComposeRelationshipPartial, true);
  assert.equal(rowPartial.dockerComposeRelationships?.execution.rowsTruncated, true);
  assert.equal(rowPartial.execution.deploymentPathPartial, false);
  assert.equal(rowPartial.execution.visualExplorerPartial, false);

  dockerComposeRelationshipEvidence.status = "partial";
  const sourcePartial = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    {},
    undefined,
    undefined,
    undefined,
    undefined,
    dockerComposeRelationshipEvidence,
  );
  assert.equal(sourcePartial.status, "partial");
  assert.equal(sourcePartial.execution.dockerComposeRelationshipPartial, true);
  assert.equal(sourcePartial.dockerComposeRelationships?.execution.sourcePartial, true);
});

test("keeps Compose relationship composition optional for existing callers", async () => {
  const { graph, deploymentPathEvidence } = await fixture();
  const result = await createRepositoryAuditBrowserIntelligence(graph, deploymentPathEvidence);

  assert.equal(result.dockerComposeRelationships, undefined);
  assert.equal(result.execution.dockerComposeRelationshipPartial, undefined);
});

test("fails closed when Compose relationship evidence belongs to another snapshot", async () => {
  const { graph, deploymentPathEvidence, dockerComposeRelationshipEvidence } = await fixture();
  dockerComposeRelationshipEvidence.source.revision = "other-revision";

  await assert.rejects(
    createRepositoryAuditBrowserIntelligence(
      graph,
      deploymentPathEvidence,
      {},
      undefined,
      undefined,
      undefined,
      undefined,
      dockerComposeRelationshipEvidence,
    ),
    /requires Docker Compose relationship evidence from the same repository snapshot/,
  );
});
