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

async function fixture() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:browser-intelligence",
    label: "Browser intelligence repository",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const dockerfile = await createSolveGraphNode({
    kind: "file",
    identity: "file:Dockerfile",
    label: "Dockerfile",
    evidence: [{ kind: "configuration", path: "Dockerfile", line: 1 }],
    metadata: { path: "Dockerfile" },
  });
  const app = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/app.ts",
    label: "app.ts",
    evidence: [{ kind: "parser", path: "src/app.ts", line: 1 }],
    metadata: { path: "src/app.ts", language: "typescript" },
  });
  const containsDockerfile = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: dockerfile.id,
    evidence: [{ kind: "deterministic-analysis", path: "Dockerfile" }],
  });
  const containsApp = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: app.id,
    evidence: [{ kind: "deterministic-analysis", path: "src/app.ts" }],
  });
  const graph = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "browser-intelligence-fixture", version: "1", deterministic: true }],
    nodes: [repository, dockerfile, app],
    edges: [containsDockerfile, containsApp],
  });
  const deploymentPathEvidence: RepositoryDeploymentPathEvidenceAnalysis = {
    schema: "solvelang.repository-audit.deployment-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: "complete",
    relationships: [{
      evidenceId: "deployment-path:docker-copy-source:Dockerfile:2:src/app.ts",
      kind: "docker-copy-source",
      fromPath: "Dockerfile",
      rawReference: "src/app.ts",
      targetPath: "src/app.ts",
      targetType: "file",
      targetState: "present",
      evidence: { path: "Dockerfile", line: 2 },
    }],
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
      acceptedFiles: 2,
      deploymentFilesExamined: 1,
      graphTruncated: false,
    },
  };
  return { graph, deploymentPathEvidence };
}

test("composes deterministic deployment and explorer browser intelligence without capabilities", async () => {
  const { graph, deploymentPathEvidence } = await fixture();
  const first = await createRepositoryAuditBrowserIntelligence(graph, deploymentPathEvidence);
  const second = await createRepositoryAuditBrowserIntelligence(
    structuredClone(graph),
    structuredClone(deploymentPathEvidence),
  );

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.browser-intelligence.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.graphId, graph.graphId);
  assert.equal(first.status, "complete");
  assert.equal(first.deploymentPaths.summary.relationships, 1);
  assert.equal(first.deploymentPaths.summary.presentTargets, 1);
  assert.equal(first.visualExplorer.summary.nodesObserved, 3);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("propagates bounded partial truth independently from each browser surface", async () => {
  const { graph, deploymentPathEvidence } = await fixture();
  deploymentPathEvidence.status = "partial";
  deploymentPathEvidence.execution.relationshipsTruncated = true;

  const deploymentPartial = await createRepositoryAuditBrowserIntelligence(graph, deploymentPathEvidence);
  assert.equal(deploymentPartial.status, "partial");
  assert.equal(deploymentPartial.execution.deploymentPathPartial, true);
  assert.equal(deploymentPartial.execution.visualExplorerPartial, false);
  assert.match(deploymentPartial.deploymentPaths.notices.join(" "), /relationship limit/i);

  const { graph: secondGraph, deploymentPathEvidence: secondEvidence } = await fixture();
  const explorerPartial = await createRepositoryAuditBrowserIntelligence(
    secondGraph,
    secondEvidence,
    { visualExplorer: { maxNodes: 1, maxEdges: 1 } },
  );
  assert.equal(explorerPartial.status, "partial");
  assert.equal(explorerPartial.execution.deploymentPathPartial, false);
  assert.equal(explorerPartial.execution.visualExplorerPartial, true);
});

test("fails closed when deployment evidence belongs to another graph", async () => {
  const { graph, deploymentPathEvidence } = await fixture();
  deploymentPathEvidence.graphId = "sg_other_graph";

  await assert.rejects(
    createRepositoryAuditBrowserIntelligence(graph, deploymentPathEvidence),
    /requires deployment evidence from the same Solve Graph document/,
  );
});
