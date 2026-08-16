import assert from "node:assert/strict";
import test from "node:test";
import {
  createSolveGraphNode,
  normalizeSolveGraphEvidence,
  normalizeSolveGraphMetadata,
} from "./canonical";
import { defaultSolveGraphScanLimits } from "./limits";

test("graph metadata permits bounded derived facts but rejects secret-shaped keys", () => {
  assert.deepEqual(normalizeSolveGraphMetadata({ language: "typescript", exported: true, fanOut: 7 }), {
    exported: true,
    fanOut: 7,
    language: "typescript",
  });
  assert.throws(() => normalizeSolveGraphMetadata({ apiKey: "do-not-store" }), /sensitive and forbidden/);
  assert.throws(() => normalizeSolveGraphMetadata({ passwordHash: "do-not-store" }), /sensitive and forbidden/);
  assert.throws(() => normalizeSolveGraphMetadata({ token_count: 3 }), /sensitive and forbidden/);
});

test("graph evidence is repository-relative and source-located without source excerpts", () => {
  assert.deepEqual(normalizeSolveGraphEvidence({
    kind: "compiler",
    path: "src/main.solve",
    line: 12,
    column: 4,
    endLine: 12,
    endColumn: 18,
    note: "resolved call target",
  }), {
    kind: "compiler",
    path: "src/main.solve",
    line: 12,
    column: 4,
    endLine: 12,
    endColumn: 18,
    note: "resolved call target",
  });
  assert.throws(() => normalizeSolveGraphEvidence({ kind: "parser", path: "/Users/example/private.ts" }), /repository-relative/);
  assert.throws(() => normalizeSolveGraphEvidence({ kind: "parser", path: "src/a.ts", column: 2 }), /column requires line/);
});

test("graph element limits fail closed before oversized metadata or evidence can enter the document", async () => {
  const limits = {
    ...defaultSolveGraphScanLimits,
    maxEvidencePerElement: 1,
    maxMetadataEntries: 1,
    maxMetadataStringBytes: 8,
    maxIdentityBytes: 16,
  };
  await assert.rejects(createSolveGraphNode({
    kind: "function",
    identity: "src/a#function:x",
    label: "x",
    evidence: [
      { kind: "parser", path: "src/a.ts", line: 1 },
      { kind: "parser", path: "src/a.ts", line: 2 },
    ],
  }, limits), /maxEvidencePerElement/);
  await assert.rejects(createSolveGraphNode({
    kind: "function",
    identity: "short-id",
    label: "x",
    evidence: [{ kind: "parser", path: "src/a.ts" }],
    metadata: { one: true, two: false },
  }, limits), /maxMetadataEntries/);
  await assert.rejects(createSolveGraphNode({
    kind: "function",
    identity: "this-identity-is-too-long",
    label: "x",
    evidence: [{ kind: "parser", path: "src/a.ts" }],
  }, limits), /maxIdentityBytes/);
});
