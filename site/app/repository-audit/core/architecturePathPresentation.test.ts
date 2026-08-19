import assert from "node:assert/strict";
import test from "node:test";

import type { RepositoryArchitecturePathAnalysis } from "./architecturePaths";
import { createRepositoryArchitecturePathPresentation } from "./architecturePathPresentation";

function fixture(): RepositoryArchitecturePathAnalysis {
  return {
    schema: "solvelang.repository-audit.architecture-paths.v0",
    mode: "analyze-only",
    graphId: "sg_presentation",
    status: "complete",
    summary: {
      rootCandidates: 2,
      rootsAnalyzed: 2,
      architecturePaths: 1,
      securityBoundaryPaths: 1,
    },
    paths: [
      {
        classification: "security-boundary",
        root: { nodeId: "workflow:z", kind: "workflow", path: ".github/workflows/deploy.yml" },
        target: { nodeId: "permission:write", kind: "permission", path: "infra/policy.json" },
        depth: 2,
        segments: [
          {
            edgeId: "edge:z-1",
            kind: "deploys",
            from: "workflow:z",
            to: "resource:service",
            evidence: { path: ".github/workflows/deploy.yml", line: 14 },
          },
          {
            edgeId: "edge:z-2",
            kind: "grants",
            from: "resource:service",
            to: "permission:write",
            evidence: { path: "infra/policy.json", line: 8 },
          },
        ],
      },
      {
        classification: "architecture",
        root: { nodeId: "route:a", kind: "route", path: "src/api.ts" },
        target: { nodeId: "dependency:db", kind: "dependency" },
        depth: 1,
        segments: [
          {
            edgeId: "edge:a-1",
            kind: "depends-on",
            from: "route:a",
            to: "dependency:db",
            evidence: { path: "src/api.ts", line: 5 },
          },
          {
            edgeId: "edge:a-duplicate-evidence",
            kind: "references",
            from: "route:a",
            to: "dependency:db",
            evidence: { path: "src/api.ts", line: 5 },
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

test("creates a deterministic browser presentation without adding capabilities", () => {
  const analysis = fixture();
  const first = createRepositoryArchitecturePathPresentation(analysis);
  const second = createRepositoryArchitecturePathPresentation({
    ...analysis,
    paths: [...analysis.paths].reverse(),
  });

  assert.deepEqual(first, second);
  assert.equal(first.schema, "solvelang.repository-audit.architecture-path-presentation.v0");
  assert.equal(first.mode, "analyze-only");
  assert.equal(first.graphId, "sg_presentation");
  assert.equal(first.summary.rowsShown, 2);
  assert.equal(first.summary.rowsHidden, 0);
  assert.equal(first.rows[0]?.root.label, "src/api.ts");
  assert.equal(first.rows[0]?.target.label, "dependency:db");
  assert.deepEqual(first.rows[0]?.relationshipKinds, ["depends-on", "references"]);
  assert.deepEqual(first.rows[0]?.evidence, [{ path: "src/api.ts", line: 5 }]);
  assert.equal(first.execution.networkAccess, false);
  assert.equal(first.execution.writeAccess, false);
  assert.deepEqual(first.notices, []);
});

test("preserves partial and truncation truth in concise notices", () => {
  const analysis = fixture();
  analysis.status = "partial";
  analysis.execution.graphTruncated = true;
  analysis.execution.rootsTruncated = true;
  analysis.execution.traversalTruncated = true;
  analysis.execution.pathsTruncated = true;

  const presentation = createRepositoryArchitecturePathPresentation(analysis, { maxRows: 1 });

  assert.equal(presentation.status, "partial");
  assert.equal(presentation.summary.rowsShown, 1);
  assert.equal(presentation.summary.rowsHidden, 1);
  assert.equal(presentation.execution.sourcePartial, true);
  assert.equal(presentation.execution.rowsTruncated, true);
  assert.equal(presentation.notices.length, 5);
  assert.match(presentation.notices[0] ?? "", /repository graph is partial/i);
  assert.match(presentation.notices[4] ?? "", /first bounded subset/i);
});

test("rejects invalid presentation bounds", () => {
  assert.throws(
    () => createRepositoryArchitecturePathPresentation(fixture(), { maxRows: 0 }),
    /maxRows must be an integer from 1 through 1000/,
  );
  assert.throws(
    () => createRepositoryArchitecturePathPresentation(fixture(), { maxRows: 1_001 }),
    /maxRows must be an integer from 1 through 1000/,
  );
});
