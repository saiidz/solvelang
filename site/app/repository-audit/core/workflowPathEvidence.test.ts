import assert from "node:assert/strict";
import test from "node:test";
import { createSolveGraphDocument, createSolveGraphNode } from "../../solve-graph/core/canonical";
import type { SolveGraphNode } from "../../solve-graph/core/contracts";
import { solveGraphFixtureSource } from "../../solve-graph/core/fixtures";
import type { RepositorySnapshot } from "./inventory";
import { createRepositoryWorkflowPathEvidence } from "./workflowPathEvidence";

async function fileNode(path: string): Promise<SolveGraphNode> {
  return createSolveGraphNode({ kind: "file", identity: `file:${path}`, label: path.slice(path.lastIndexOf("/") + 1), evidence: [{ kind: "deterministic-analysis", path }], metadata: { path } });
}
function snapshot(files: Array<{ path: string; text?: string }>): RepositorySnapshot {
  return {
    source: { kind: "github", displayName: solveGraphFixtureSource.displayName, revision: solveGraphFixtureSource.revision, fingerprint: solveGraphFixtureSource.fingerprint },
    files: files.map((file) => ({ path: file.path, byteSize: file.text === undefined ? 0 : new TextEncoder().encode(file.text).byteLength, ...(file.text === undefined ? {} : { text: file.text }) })),
  };
}
async function graph(paths: string[], partial = false) {
  return createSolveGraphDocument({ source: solveGraphFixtureSource, extractors: [{ id: "inventory", version: "1.0.0", deterministic: true }], ...(partial ? { status: "partial" as const, truncationReasons: ["file-count" as const] } : {}), nodes: await Promise.all(paths.map(fileNode)), edges: [] });
}

test("maps explicit workflow working directories and cache dependency files", async () => {
  const workflow = ["name: CI", "defaults:", "  run:", "    working-directory: site", "jobs:", "  build:", "    steps:", "      - uses: actions/setup-node@v4", "        with:", "          cache-dependency-path: 'site/package-lock.json'"].join("\n");
  const input = snapshot([
    { path: ".github/workflows/ci.yml", text: workflow },
    { path: "site/package-lock.json", text: "{}" },
    { path: "site/app/page.tsx", text: "export default function Page() { return null; }" },
  ]);
  const analysis = await createRepositoryWorkflowPathEvidence(input, await graph([".github/workflows/ci.yml", "site/package-lock.json", "site/app/page.tsx"]));
  assert.deepEqual(analysis.references.map((reference) => [reference.kind, reference.targetPath, reference.targetState]), [
    ["working-directory", "site", "present"],
    ["cache-dependency-path", "site/package-lock.json", "present"],
  ]);
  assert.deepEqual(analysis.impacts, [
    { targetPath: "site", workflows: [".github/workflows/ci.yml"], referenceKinds: ["working-directory"] },
    { targetPath: "site/package-lock.json", workflows: [".github/workflows/ci.yml"], referenceKinds: ["cache-dependency-path"] },
  ]);
  assert.equal(analysis.execution.networkAccess, false);
  assert.equal(analysis.execution.writeAccess, false);
});

test("distinguishes outside-scan and missing paths while skipping dynamic or multiline values", async () => {
  const workflow = ["jobs:", "  build:", "    defaults:", "      run:", "        working-directory: site", "    steps:", "      - with:", "          cache-dependency-path: missing/package-lock.json", "      - run: echo dynamic", "        working-directory: ${{ matrix.directory }}", "      - with:", "          cache-dependency-path: |", "            site/package-lock.json"].join("\n");
  const input = snapshot([{ path: ".github/workflows/verify.yaml", text: workflow }, { path: "site/package-lock.json", text: "{}" }]);
  const analysis = await createRepositoryWorkflowPathEvidence(input, await graph([".github/workflows/verify.yaml"]));
  assert.deepEqual(analysis.references.map((reference) => [reference.kind, reference.targetPath, reference.targetState]), [
    ["working-directory", "site", "outside-bounded-scan"],
    ["cache-dependency-path", "missing/package-lock.json", "missing"],
  ]);
  assert.equal(analysis.skipped.dynamicReferences, 1);
  assert.equal(analysis.skipped.multilineReferences, 1);
});

test("keeps deterministic bounds and fails closed on partial-source or integrity mismatch", async () => {
  const workflow = ["jobs:", "  build:", "    steps:", "      - run: echo one", "        working-directory: one", "      - run: echo two", "        working-directory: two"].join("\n");
  const input = snapshot([{ path: ".github/workflows/verify.yml", text: workflow }]);
  const partial = await createRepositoryWorkflowPathEvidence(input, await graph([".github/workflows/verify.yml"], true), { maxReferences: 1 });
  assert.equal(partial.status, "partial");
  assert.equal(partial.references.length, 1);
  assert.equal(partial.execution.referencesTruncated, true);
  assert.equal(partial.references[0].targetPath, "one");

  const document = await graph([".github/workflows/verify.yml"]);
  const mismatched = structuredClone(input);
  mismatched.source.revision = "different";
  await assert.rejects(createRepositoryWorkflowPathEvidence(mismatched, document), /source does not match/);

  const tampered = structuredClone(document);
  tampered.nodes[0].label = "tampered";
  await assert.rejects(createRepositoryWorkflowPathEvidence(input, tampered), /integrity-valid/);
});
