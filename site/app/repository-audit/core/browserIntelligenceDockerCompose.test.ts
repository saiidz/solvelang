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
import { analyzeDockerComposeSnapshot } from "./dockerComposeSnapshotEvidence";
import type { RepositorySnapshot } from "./inventory";

async function fixture() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:compose-browser",
    label: "Compose browser repository",
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
    extractors: [{ id: "compose-browser-fixture", version: "1", deterministic: true }],
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
      byteSize: 82,
      text: "services:\n  web:\n    image: example/web:1\n  api:\n    image: ${API_IMAGE}\n",
    }],
  };
  return {
    graph,
    deploymentPathEvidence,
    dockerComposeEvidence: analyzeDockerComposeSnapshot(snapshot),
  };
}

test("composes optional Docker Compose presentation into browser intelligence", async () => {
  const { graph, deploymentPathEvidence, dockerComposeEvidence } = await fixture();
  const result = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    { dockerCompose: { maxRows: 10 } },
    undefined,
    undefined,
    undefined,
    dockerComposeEvidence,
  );

  assert.equal(result.status, "complete");
  assert.equal(result.dockerCompose?.summary.services, 2);
  assert.equal(result.dockerCompose?.summary.declaredImages, 1);
  assert.equal(result.dockerCompose?.summary.unresolvedImages, 1);
  assert.equal(result.execution.dockerComposePartial, false);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
});

test("propagates Docker Compose source and row partiality independently", async () => {
  const { graph, deploymentPathEvidence, dockerComposeEvidence } = await fixture();
  const rowPartial = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    { dockerCompose: { maxRows: 1 } },
    undefined,
    undefined,
    undefined,
    dockerComposeEvidence,
  );

  assert.equal(rowPartial.status, "partial");
  assert.equal(rowPartial.execution.dockerComposePartial, true);
  assert.equal(rowPartial.dockerCompose?.execution.rowsTruncated, true);
  assert.equal(rowPartial.execution.deploymentPathPartial, false);
  assert.equal(rowPartial.execution.visualExplorerPartial, false);

  dockerComposeEvidence.status = "partial";
  const sourcePartial = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    {},
    undefined,
    undefined,
    undefined,
    dockerComposeEvidence,
  );
  assert.equal(sourcePartial.status, "partial");
  assert.equal(sourcePartial.execution.dockerComposePartial, true);
  assert.equal(sourcePartial.dockerCompose?.execution.sourcePartial, true);
});

test("keeps Docker Compose composition optional for existing callers", async () => {
  const { graph, deploymentPathEvidence } = await fixture();
  const result = await createRepositoryAuditBrowserIntelligence(graph, deploymentPathEvidence);

  assert.equal(result.dockerCompose, undefined);
  assert.equal(result.execution.dockerComposePartial, undefined);
});

test("fails closed when Docker Compose evidence belongs to another snapshot", async () => {
  const { graph, deploymentPathEvidence, dockerComposeEvidence } = await fixture();
  dockerComposeEvidence.source.revision = "other-revision";

  await assert.rejects(
    createRepositoryAuditBrowserIntelligence(
      graph,
      deploymentPathEvidence,
      {},
      undefined,
      undefined,
      undefined,
      dockerComposeEvidence,
    ),
    /requires Docker Compose evidence from the same repository snapshot/,
  );
});
