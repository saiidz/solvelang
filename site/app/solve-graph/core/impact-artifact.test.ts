import assert from "node:assert/strict";
import test from "node:test";

import { sha256Hex } from "../../repository-audit/core/ingestion";
import { canonicalSolveGraphJson, createSolveGraphDocument, createSolveGraphEdge, createSolveGraphNode } from "./canonical";
import { solveGraphFixtureSource } from "./fixtures";
import { createSolveGraphImpactDownload } from "./impact-artifact";
import {
  MAX_SOLVE_GRAPH_IMPACT_ARTIFACT_BYTES,
  parseAndVerifySolveGraphImpactArtifact,
  verifySolveGraphImpactArtifact,
} from "./impact-artifact-verify";
import { analyzeSolveGraphImpact, createSolveGraphQueryIndex } from "./query-impact";

const encoder = new TextEncoder();

async function fixture() {
  const root = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/root.ts",
    label: "root.ts",
    evidence: [{ kind: "parser", path: "src/root.ts" }],
    metadata: { path: "src/root.ts" },
  });
  const direct = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/direct.ts",
    label: "direct.ts",
    evidence: [{ kind: "parser", path: "src/direct.ts" }],
    metadata: { path: "src/direct.ts" },
  });
  const edge = await createSolveGraphEdge({
    kind: "imports",
    from: direct.id,
    to: root.id,
    evidence: [{ kind: "parser", path: "src/direct.ts" }],
  });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "impact-artifact-fixture", version: "1", deterministic: true }],
    nodes: [direct, root],
    edges: [edge],
  });
  return {
    index: await createSolveGraphQueryIndex(document),
    root,
    direct,
  };
}

async function resign(value: Record<string, unknown>): Promise<void> {
  const { integrity: _integrity, ...unsigned } = value;
  value.integrity = {
    canonicalJsonSha256: `sha256:${await sha256Hex(encoder.encode(canonicalSolveGraphJson(unsigned)))}`,
  };
}

test("creates and verifies a canonical bounded analyze-only impact download", async () => {
  const { index, root } = await fixture();
  const query = analyzeSolveGraphImpact(index, [root.id]);
  const download = await createSolveGraphImpactDownload("fixture repo", index, query);

  assert.equal(download.filename, "fixture-repo-impact.json");
  const verified = await verifySolveGraphImpactArtifact(index, JSON.parse(download.content));
  assert.equal(verified.integrity.canonicalJsonSha256, download.artifact.integrity.canonicalJsonSha256);
  assert.deepEqual(await parseAndVerifySolveGraphImpactArtifact(index, download.content), verified);
});

test("rejects self-consistent impact artifacts whose traversal evidence is invalid", async () => {
  const { index, root, direct } = await fixture();
  const query = analyzeSolveGraphImpact(index, [root.id]);
  const download = await createSolveGraphImpactDownload("fixture repo", index, query);
  const malformed = JSON.parse(download.content) as Record<string, unknown>;
  const malformedQuery = malformed.query as { entries: Array<{ id: string; parentId?: string }> };
  malformedQuery.entries.find((entry) => entry.id === direct.id)!.parentId = direct.id;
  await resign(malformed);

  await assert.rejects(
    verifySolveGraphImpactArtifact(index, malformed),
    /parent chain is invalid/,
  );
});

test("rejects traversal edges outside the default impact scope", async () => {
  const root = await createSolveGraphNode({
    kind: "file",
    identity: "file:src/root.ts",
    label: "root.ts",
    evidence: [{ kind: "parser", path: "src/root.ts" }],
  });
  const container = await createSolveGraphNode({
    kind: "directory",
    identity: "directory:src",
    label: "src",
    evidence: [{ kind: "parser", path: "src" }],
  });
  const contains = await createSolveGraphEdge({
    kind: "contains",
    from: container.id,
    to: root.id,
    evidence: [{ kind: "parser", path: "src" }],
  });
  const document = await createSolveGraphDocument({
    source: solveGraphFixtureSource,
    engineVersion: "0.2.0",
    extractors: [{ id: "impact-artifact-edge-scope-fixture", version: "1", deterministic: true }],
    nodes: [container, root],
    edges: [contains],
  });
  const index = await createSolveGraphQueryIndex(document);
  const forged = {
    direction: "dependents" as const,
    roots: [root.id],
    entries: [
      { id: root.id, depth: 0, rootId: root.id },
      {
        id: container.id,
        depth: 1,
        rootId: root.id,
        parentId: root.id,
        viaEdgeId: contains.id,
      },
    ],
    truncated: false,
  };

  await assert.rejects(
    createSolveGraphImpactDownload("fixture repo", index, forged),
    /outside the default impact scope/,
  );
});

test("binds impact artifacts to the verified query graph", async () => {
  const { index, root } = await fixture();
  const query = analyzeSolveGraphImpact(index, [root.id]);
  const download = await createSolveGraphImpactDownload("fixture repo", index, query);
  const wrongGraph = JSON.parse(download.content) as Record<string, unknown>;
  wrongGraph.graphId = "sg_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await resign(wrongGraph);

  await assert.rejects(
    verifySolveGraphImpactArtifact(index, wrongGraph),
    /different graph/,
  );
});

test("rejects tampering, non-canonical fields, and oversized serialized artifacts", async () => {
  const { index, root } = await fixture();
  const query = analyzeSolveGraphImpact(index, [root.id]);
  const download = await createSolveGraphImpactDownload("fixture repo", index, query);

  const tampered = JSON.parse(download.content) as { query: { roots: string[] } };
  tampered.query.roots[0] = "sgn_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await assert.rejects(verifySolveGraphImpactArtifact(index, tampered), /root does not exist|integrity/);

  const extra = JSON.parse(download.content) as Record<string, unknown>;
  extra.unexpected = true;
  await resign(extra);
  await assert.rejects(verifySolveGraphImpactArtifact(index, extra), /integrity|canonical/);

  await assert.rejects(
    parseAndVerifySolveGraphImpactArtifact(index, " ".repeat(MAX_SOLVE_GRAPH_IMPACT_ARTIFACT_BYTES + 1)),
    /8 MiB verification limit/,
  );
});

test("refuses to create signed artifacts from malformed traversal evidence", async () => {
  const { index, root, direct } = await fixture();
  const query = analyzeSolveGraphImpact(index, [root.id]);
  const malformed = structuredClone(query);
  malformed.entries.find((entry) => entry.id === direct.id)!.parentId = direct.id;

  await assert.rejects(
    createSolveGraphImpactDownload("fixture repo", index, malformed),
    /parent chain is invalid/,
  );
});
