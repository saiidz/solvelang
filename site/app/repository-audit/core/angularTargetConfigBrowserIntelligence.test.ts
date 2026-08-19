import assert from "node:assert/strict";
import test from "node:test";

// Keep this focused integration suite on the current-main PR head so hosted CI proves the retargeted composition.
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import type { RepositoryAngularTargetConfigEvidenceAnalysis } from "./angularTargetConfigEvidence";
import { createRepositoryAuditBrowserIntelligence } from "./browserIntelligence";
import type { RepositoryDeploymentPathEvidenceAnalysis } from "./deploymentPathEvidence";

async function fixture() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:angular-browser-intelligence",
    label: "Angular browser intelligence repository",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const angularConfig = await createSolveGraphNode({
    kind: "file",
    identity: "file:angular.json",
    label: "angular.json",
    evidence: [{ kind: "configuration", path: "angular.json", line: 1 }],
    metadata: { path: "angular.json" },
  });
  const tsconfig = await createSolveGraphNode({
    kind: "file",
    identity: "file:tsconfig.app.json",
    label: "tsconfig.app.json",
    evidence: [{ kind: "configuration", path: "tsconfig.app.json", line: 1 }],
    metadata: { path: "tsconfig.app.json" },
  });
  const containsAngular = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: angularConfig.id,
    evidence: [{ kind: "deterministic-analysis", path: "angular.json" }],
  });
  const containsTsconfig = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: tsconfig.id,
    evidence: [{ kind: "deterministic-analysis", path: "tsconfig.app.json" }],
  });
  const graph = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "angular-browser-intelligence-fixture", version: "1", deterministic: true }],
    nodes: [repository, angularConfig, tsconfig],
    edges: [containsAngular, containsTsconfig],
  });
  const deploymentPathEvidence: RepositoryDeploymentPathEvidenceAnalysis = {
    schema: "solvelang.repository-audit.deployment-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: "complete",
    relationships: [],
    skipped: { missingText: 0, oversizedText: 0, invalidJson: 0, dynamicReference: 0 },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 250,
      maxConfigTextBytes: 1024 * 1024,
      relationshipsTruncated: false,
      acceptedFiles: 2,
      deploymentFilesExamined: 0,
      graphTruncated: false,
    },
  };
  const angularTargetConfigEvidence: RepositoryAngularTargetConfigEvidenceAnalysis = {
    schema: "solvelang.repository-audit.angular-target-config-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: "complete",
    relationships: [{
      evidenceId: "angular-target-tsconfig:angular.json:projects.app.build.options.tsConfig:tsconfig.app.json",
      kind: "angular-target-tsconfig",
      framework: "angular",
      fromPath: "angular.json",
      project: "app",
      target: "build",
      rawReference: "tsconfig.app.json",
      targetPath: "tsconfig.app.json",
      targetState: "present",
      evidence: { path: "angular.json", field: "projects.app.build.options.tsConfig" },
    }],
    skipped: { missingText: 0, oversizedText: 0, invalidJson: 0, dynamicReference: 0 },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 250,
      maxConfigTextBytes: 1024 * 1024,
      relationshipsTruncated: false,
      acceptedFiles: 2,
      angularConfigsExamined: 1,
      graphTruncated: false,
    },
  };
  return { graph, deploymentPathEvidence, angularTargetConfigEvidence };
}

test("composes optional Angular target-config presentation into browser intelligence", async () => {
  const { graph, deploymentPathEvidence, angularTargetConfigEvidence } = await fixture();
  const result = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    {},
    undefined,
    angularTargetConfigEvidence,
  );

  assert.equal(result.status, "complete");
  assert.equal(result.angularTargetConfigs?.summary.relationships, 1);
  assert.equal(result.angularTargetConfigs?.summary.presentTargets, 1);
  assert.equal(result.execution.angularTargetConfigPartial, false);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
});

test("Angular target-config browser intelligence preserves independent row truncation truth", async () => {
  const { graph, deploymentPathEvidence, angularTargetConfigEvidence } = await fixture();
  angularTargetConfigEvidence.relationships.push({
    ...angularTargetConfigEvidence.relationships[0]!,
    evidenceId: "angular-target-tsconfig:angular.json:projects.app.test.options.tsConfig:tsconfig.spec.json",
    target: "test",
    rawReference: "tsconfig.spec.json",
    targetPath: "tsconfig.spec.json",
    targetState: "missing",
    evidence: { path: "angular.json", field: "projects.app.test.options.tsConfig" },
  });

  const result = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    { angularTargetConfigs: { maxRows: 1 } },
    undefined,
    angularTargetConfigEvidence,
  );

  assert.equal(result.status, "partial");
  assert.equal(result.execution.angularTargetConfigPartial, true);
  assert.equal(result.angularTargetConfigs?.execution.rowsTruncated, true);
  assert.equal(result.angularTargetConfigs?.summary.rowsHidden, 1);
});

test("fails closed when Angular target-config evidence belongs to another graph", async () => {
  const { graph, deploymentPathEvidence, angularTargetConfigEvidence } = await fixture();
  angularTargetConfigEvidence.graphId = "sg_other_angular_graph";

  await assert.rejects(
    createRepositoryAuditBrowserIntelligence(
      graph,
      deploymentPathEvidence,
      {},
      undefined,
      angularTargetConfigEvidence,
    ),
    /requires Angular target-config evidence from the same Solve Graph document/,
  );
});
