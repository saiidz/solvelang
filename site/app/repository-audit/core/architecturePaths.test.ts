import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphDocument,
  createSolveGraphEdge,
  createSolveGraphNode,
} from "../../solve-graph/core/canonical";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import { analyzeRepositoryArchitecturePaths } from "./architecturePaths";

async function fixture() {
  const route = await createSolveGraphNode({
    kind: "route",
    identity: "route:GET /projects",
    label: "GET /projects",
    evidence: [{ kind: "configuration", path: "src/routes.ts", line: 8 }],
    metadata: { path: "src/routes.ts" },
  });
  const projectsModule = await createSolveGraphNode({
    kind: "module",
    identity: "module:src/projects.ts",
    label: "src/projects.ts",
    evidence: [{ kind: "parser", path: "src/projects.ts" }],
    metadata: { path: "src/projects.ts" },
  });
  const dependency = await createSolveGraphNode({
    kind: "dependency",
    identity: "dependency:@example/data",
    label: "@example/data",
    evidence: [{ kind: "manifest", path: "package.json", line: 14 }],
  });
  const workflow = await createSolveGraphNode({
    kind: "workflow",
    identity: "workflow:.github/workflows/deploy.yml",
    label: "deploy.yml",
    evidence: [{ kind: "workflow", path: ".github/workflows/deploy.yml" }],
    metadata: { path: ".github/workflows/deploy.yml" },
  });
  const job = await createSolveGraphNode({
    kind: "job",
    identity: "job:.github/workflows/deploy.yml:deploy",
    label: "deploy",
    evidence: [{ kind: "workflow", path: ".github/workflows/deploy.yml", line: 10 }],
  });
  const resource = await createSolveGraphNode({
    kind: "resource",
    identity: "resource:artifact-bucket",
    label: "artifact-bucket",
    evidence: [{ kind: "configuration", path: "infra/template.yml", line: 20 }],
    metadata: { path: "infra/template.yml" },
  });
  const permission = await createSolveGraphNode({
    kind: "permission",
    identity: "permission:s3:GetObject",
    label: "s3:GetObject",
    evidence: [{ kind: "configuration", path: "infra/template.yml", line: 42 }],
    metadata: { path: "infra/template.yml" },
  });

  const edges = await Promise.all([
    createSolveGraphEdge({
      kind: "imports",
      from: route.id,
      to: projectsModule.id,
      evidence: [{ kind: "parser", path: "src/routes.ts", line: 2 }],
    }),
    createSolveGraphEdge({
      kind: "depends-on",
      from: projectsModule.id,
      to: dependency.id,
      evidence: [{ kind: "manifest", path: "package.json", line: 14 }],
    }),
    createSolveGraphEdge({
      kind: "triggers",
      from: workflow.id,
      to: job.id,
      evidence: [{ kind: "workflow", path: ".github/workflows/deploy.yml", line: 10 }],
    }),
    createSolveGraphEdge({
      kind: "deploys",
      from: job.id,
      to: resource.id,
      evidence: [{ kind: "workflow", path: ".github/workflows/deploy.yml", line: 24 }],
    }),
    createSolveGraphEdge({
      kind: "grants",
      from: resource.id,
      to: permission.id,
      evidence: [{ kind: "configuration", path: "infra/template.yml", line: 42 }],
    }),
  ]);

  const document = await createSolveGraphDocument({
    source: { ...solveGraphFixtureSource, displayName: "architecture-paths" },
    extractors: [{ id: "fixture", version: "1", deterministic: true }],
    nodes: [route, projectsModule, dependency, workflow, job, resource, permission],
    edges,
  });

  return { document, route, workflow, dependency, resource, permission };
}

test("summarizes deterministic architecture and security-boundary paths without executing code", async () => {
  const { document, route, workflow, dependency, resource, permission } = await fixture();
  const analysis = await analyzeRepositoryArchitecturePaths(document);

  const routeDependency = analysis.paths.find((path) => path.root.nodeId === route.id && path.target.nodeId === dependency.id);
  assert.ok(routeDependency);
  assert.equal(routeDependency.classification, "architecture");
  assert.equal(routeDependency.depth, 2);
  assert.deepEqual(routeDependency.segments.map((item) => item.kind), ["imports", "depends-on"]);
  assert.equal(routeDependency.root.path, "src/routes.ts");

  const workflowResource = analysis.paths.find((path) => path.root.nodeId === workflow.id && path.target.nodeId === resource.id);
  assert.ok(workflowResource);
  assert.equal(workflowResource.classification, "architecture");
  assert.deepEqual(workflowResource.segments.map((item) => item.kind), ["triggers", "deploys"]);

  const workflowPermission = analysis.paths.find((path) => path.root.nodeId === workflow.id && path.target.nodeId === permission.id);
  assert.ok(workflowPermission);
  assert.equal(workflowPermission.classification, "security-boundary");
  assert.deepEqual(workflowPermission.segments.map((item) => item.kind), ["triggers", "deploys", "grants"]);
  assert.equal(workflowPermission.target.path, "infra/template.yml");
  assert.equal(analysis.status, "complete");
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
  assert.ok(analysis.summary.architecturePaths >= 2);
  assert.ok(analysis.summary.securityBoundaryPaths >= 1);
});

test("path output bounds and traversal depth are explicit and fail partial rather than overclaiming", async () => {
  const { document } = await fixture();
  const rootsBounded = await analyzeRepositoryArchitecturePaths(document, { maxRootNodes: 1 });
  assert.equal(rootsBounded.status, "partial");
  assert.equal(rootsBounded.execution.rootsTruncated, true);
  assert.equal(rootsBounded.summary.rootsAnalyzed, 1);

  const depthBounded = await analyzeRepositoryArchitecturePaths(document, { maxDepth: 1 });
  assert.equal(depthBounded.status, "partial");
  assert.equal(depthBounded.execution.traversalTruncated, true);

  const pathsBounded = await analyzeRepositoryArchitecturePaths(document, { maxPaths: 1 });
  assert.equal(pathsBounded.status, "partial");
  assert.equal(pathsBounded.execution.pathsTruncated, true);
  assert.equal(pathsBounded.paths.length, 1);

  await assert.rejects(analyzeRepositoryArchitecturePaths(document, { maxPaths: 2_001 }), /maxPaths/);
});

test("integrity-invalid graph input fails closed before path summaries are produced", async () => {
  const { document } = await fixture();
  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(analyzeRepositoryArchitecturePaths(tampered), /integrity-valid/);
});

test("path summaries are stable across repeated analysis", async () => {
  const { document } = await fixture();
  const first = await analyzeRepositoryArchitecturePaths(document);
  const second = await analyzeRepositoryArchitecturePaths(document);
  assert.deepEqual(first, second);
});
