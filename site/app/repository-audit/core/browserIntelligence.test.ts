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
import type { RepositoryFrameworkPathEvidenceAnalysis } from "./frameworkPathEvidence";

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
  const frameworkPathEvidence: RepositoryFrameworkPathEvidenceAnalysis = {
    schema: "solvelang.repository-audit.framework-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: "complete",
    relationships: [{
      evidenceId: "framework-path:angular-build-entrypoint:angular.json:projects.app.build.options.main:src/app.ts",
      kind: "angular-build-entrypoint",
      framework: "angular",
      fromPath: "angular.json",
      rawReference: "src/app.ts",
      targetPath: "src/app.ts",
      targetType: "file",
      targetState: "present",
      evidence: { path: "angular.json", field: "projects.app.build.options.main" },
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
      frameworkFilesExamined: 1,
      graphTruncated: false,
    },
  };
  return { graph, deploymentPathEvidence, frameworkPathEvidence };
}

test("composes deterministic deployment, framework, and explorer browser intelligence without capabilities", async () => {
  const { graph, deploymentPathEvidence, frameworkPathEvidence } = await fixture();
  const first = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    {},
    frameworkPathEvidence,
  );
  const second = await createRepositoryAuditBrowserIntelligence(
    structuredClone(graph),
    structuredClone(deploymentPathEvidence),
    {},
    structuredClone(frameworkPathEvidence),
  );

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.browser-intelligence.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.graphId, graph.graphId);
  assert.equal(first.status, "complete");
  assert.equal(first.deploymentPaths.summary.relationships, 1);
  assert.equal(first.deploymentPaths.summary.presentTargets, 1);
  assert.equal(first.frameworkPaths?.summary.relationships, 1);
  assert.equal(first.frameworkPaths?.summary.angularRelationships, 1);
  assert.equal(first.execution.frameworkPathPartial, false);
  assert.equal(first.visualExplorer.summary.nodesObserved, 3);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
});

test("keeps framework browser composition optional for existing callers", async () => {
  const { graph, deploymentPathEvidence } = await fixture();
  const result = await createRepositoryAuditBrowserIntelligence(graph, deploymentPathEvidence);

  assert.equal(result.status, "complete");
  assert.equal(result.frameworkPaths, undefined);
  assert.equal(result.execution.frameworkPathPartial, undefined);
});

test("propagates bounded partial truth independently from each browser surface", async () => {
  const { graph, deploymentPathEvidence, frameworkPathEvidence } = await fixture();
  deploymentPathEvidence.status = "partial";
  deploymentPathEvidence.execution.relationshipsTruncated = true;

  const deploymentPartial = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    {},
    frameworkPathEvidence,
  );
  assert.equal(deploymentPartial.status, "partial");
  assert.equal(deploymentPartial.execution.deploymentPathPartial, true);
  assert.equal(deploymentPartial.execution.frameworkPathPartial, false);
  assert.equal(deploymentPartial.execution.visualExplorerPartial, false);
  assert.match(deploymentPartial.deploymentPaths.notices.join(" "), /relationship limit/i);

  const frameworkFixture = await fixture();
  frameworkFixture.frameworkPathEvidence.status = "partial";
  frameworkFixture.frameworkPathEvidence.execution.relationshipsTruncated = true;
  const frameworkPartial = await createRepositoryAuditBrowserIntelligence(
    frameworkFixture.graph,
    frameworkFixture.deploymentPathEvidence,
    {},
    frameworkFixture.frameworkPathEvidence,
  );
  assert.equal(frameworkPartial.status, "partial");
  assert.equal(frameworkPartial.execution.deploymentPathPartial, false);
  assert.equal(frameworkPartial.execution.frameworkPathPartial, true);
  assert.match(frameworkPartial.frameworkPaths?.notices.join(" ") ?? "", /relationship limit/i);

  const rowFixture = await fixture();
  rowFixture.frameworkPathEvidence.relationships.push({
    evidenceId: "framework-path:nest-source-root:nest-cli.json:sourceRoot:apps/api/src",
    kind: "nest-source-root",
    framework: "nest",
    fromPath: "nest-cli.json",
    rawReference: "apps/api/src",
    targetPath: "apps/api/src",
    targetType: "directory",
    targetState: "outside-bounded-scan",
    evidence: { path: "nest-cli.json", field: "sourceRoot" },
  });
  const rowPartial = await createRepositoryAuditBrowserIntelligence(
    rowFixture.graph,
    rowFixture.deploymentPathEvidence,
    { frameworkPaths: { maxRows: 1 } },
    rowFixture.frameworkPathEvidence,
  );
  assert.equal(rowPartial.status, "partial");
  assert.equal(rowPartial.execution.frameworkPathPartial, true);
  assert.equal(rowPartial.frameworkPaths?.execution.rowsTruncated, true);

  const explorerFixture = await fixture();
  const explorerPartial = await createRepositoryAuditBrowserIntelligence(
    explorerFixture.graph,
    explorerFixture.deploymentPathEvidence,
    { visualExplorer: { maxNodes: 1, maxEdges: 1 } },
    explorerFixture.frameworkPathEvidence,
  );
  assert.equal(explorerPartial.status, "partial");
  assert.equal(explorerPartial.execution.deploymentPathPartial, false);
  assert.equal(explorerPartial.execution.frameworkPathPartial, false);
  assert.equal(explorerPartial.execution.visualExplorerPartial, true);
});

test("fails closed when deployment or framework evidence belongs to another graph", async () => {
  const { graph, deploymentPathEvidence, frameworkPathEvidence } = await fixture();
  deploymentPathEvidence.graphId = "sg_other_graph";

  await assert.rejects(
    createRepositoryAuditBrowserIntelligence(graph, deploymentPathEvidence, {}, frameworkPathEvidence),
    /requires deployment evidence from the same Solve Graph document/,
  );

  const second = await fixture();
  second.frameworkPathEvidence.graphId = "sg_other_framework_graph";
  await assert.rejects(
    createRepositoryAuditBrowserIntelligence(
      second.graph,
      second.deploymentPathEvidence,
      {},
      second.frameworkPathEvidence,
    ),
    /requires framework evidence from the same Solve Graph document/,
  );
});
