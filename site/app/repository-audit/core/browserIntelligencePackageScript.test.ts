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
import type { RepositoryPackageScriptPathEvidenceAnalysis } from "./packageScriptPathEvidence";

async function fixture() {
  const repository = await createSolveGraphNode({
    kind: "repository",
    identity: "repo:package-script-browser-intelligence",
    label: "Package script browser intelligence repository",
    evidence: [{ kind: "deterministic-analysis", path: "README.md" }],
  });
  const packageJson = await createSolveGraphNode({
    kind: "file",
    identity: "file:package.json",
    label: "package.json",
    evidence: [{ kind: "configuration", path: "package.json", line: 1 }],
    metadata: { path: "package.json" },
  });
  const app = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/app.ts",
    label: "app.ts",
    evidence: [{ kind: "parser", path: "src/app.ts", line: 1 }],
    metadata: { path: "src/app.ts", language: "typescript" },
  });
  const containsPackage = await createSolveGraphEdge({
    kind: "contains",
    from: repository.id,
    to: packageJson.id,
    evidence: [{ kind: "deterministic-analysis", path: "package.json" }],
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
    extractors: [{ id: "package-script-browser-intelligence-fixture", version: "1", deterministic: true }],
    nodes: [repository, packageJson, app],
    edges: [containsPackage, containsApp],
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
      acceptedFiles: 2,
      deploymentFilesExamined: 0,
      graphTruncated: false,
    },
  };

  const packageScriptPathEvidence: RepositoryPackageScriptPathEvidenceAnalysis = {
    schema: "solvelang.repository-audit.package-script-path-evidence.v0",
    mode: "analyze-only",
    graphId: graph.graphId,
    status: "complete",
    relationships: [{
      evidenceId: "package-script-path:node-entrypoint:package.json:start:src/app.ts",
      kind: "node-entrypoint",
      fromPath: "package.json",
      scriptName: "start",
      rawReference: "./src/app.ts",
      targetPath: "src/app.ts",
      targetState: "present",
      evidence: { path: "package.json", field: "scripts.start" },
    }],
    skipped: {
      missingText: 0,
      oversizedPackageText: 0,
      oversizedScript: 0,
      invalidJson: 0,
      dynamicScript: 0,
      invalidTarget: 0,
    },
    execution: {
      networkAccess: false,
      writeAccess: false,
      maxRelationships: 250,
      maxPackageTextBytes: 1024 * 1024,
      maxScriptTextBytes: 4 * 1024,
      relationshipsTruncated: false,
      acceptedFiles: 2,
      packageFilesExamined: 1,
      graphTruncated: false,
    },
  };

  return { graph, deploymentPathEvidence, packageScriptPathEvidence };
}

test("composes optional package-script presentation without adding capabilities", async () => {
  const { graph, deploymentPathEvidence, packageScriptPathEvidence } = await fixture();
  const result = await createRepositoryAuditBrowserIntelligence(
    graph,
    deploymentPathEvidence,
    {},
    undefined,
    undefined,
    packageScriptPathEvidence,
  );

  assert.equal(result.status, "complete");
  assert.equal(result.packageScriptPaths?.summary.relationships, 1);
  assert.equal(result.packageScriptPaths?.summary.presentTargets, 1);
  assert.equal(result.packageScriptPaths?.rows[0]?.scriptName, "start");
  assert.equal(result.execution.packageScriptPathPartial, false);
  assert.equal(result.execution.networkAccess, false);
  assert.equal(result.execution.writeAccess, false);
});

test("keeps package-script composition optional for existing callers", async () => {
  const { graph, deploymentPathEvidence } = await fixture();
  const result = await createRepositoryAuditBrowserIntelligence(graph, deploymentPathEvidence);

  assert.equal(result.packageScriptPaths, undefined);
  assert.equal(result.execution.packageScriptPathPartial, undefined);
  assert.equal(result.status, "complete");
});

test("propagates package-script analyzer and presentation bounds independently", async () => {
  const analyzerFixture = await fixture();
  analyzerFixture.packageScriptPathEvidence.status = "partial";
  analyzerFixture.packageScriptPathEvidence.execution.relationshipsTruncated = true;
  const analyzerPartial = await createRepositoryAuditBrowserIntelligence(
    analyzerFixture.graph,
    analyzerFixture.deploymentPathEvidence,
    {},
    undefined,
    undefined,
    analyzerFixture.packageScriptPathEvidence,
  );
  assert.equal(analyzerPartial.status, "partial");
  assert.equal(analyzerPartial.execution.packageScriptPathPartial, true);
  assert.match(analyzerPartial.packageScriptPaths?.notices.join(" ") ?? "", /relationship limit/i);

  const rowFixture = await fixture();
  rowFixture.packageScriptPathEvidence.relationships.push({
    evidenceId: "package-script-path:tsc-project:package.json:typecheck:tsconfig.json",
    kind: "tsc-project",
    fromPath: "package.json",
    scriptName: "typecheck",
    rawReference: "tsconfig.json",
    targetPath: "tsconfig.json",
    targetState: "missing",
    evidence: { path: "package.json", field: "scripts.typecheck" },
  });
  const rowPartial = await createRepositoryAuditBrowserIntelligence(
    rowFixture.graph,
    rowFixture.deploymentPathEvidence,
    { packageScriptPaths: { maxRows: 1 } },
    undefined,
    undefined,
    rowFixture.packageScriptPathEvidence,
  );
  assert.equal(rowPartial.status, "partial");
  assert.equal(rowPartial.execution.packageScriptPathPartial, true);
  assert.equal(rowPartial.packageScriptPaths?.execution.rowsTruncated, true);
  assert.equal(rowPartial.packageScriptPaths?.summary.rowsHidden, 1);
});

test("fails closed when package-script evidence belongs to another graph", async () => {
  const { graph, deploymentPathEvidence, packageScriptPathEvidence } = await fixture();
  packageScriptPathEvidence.graphId = "sg_other_package_script_graph";

  await assert.rejects(
    createRepositoryAuditBrowserIntelligence(
      graph,
      deploymentPathEvidence,
      {},
      undefined,
      undefined,
      packageScriptPathEvidence,
    ),
    /requires package-script path evidence from the same Solve Graph document/,
  );
});
