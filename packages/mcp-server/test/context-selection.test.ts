import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildContextPack, MAX_CONTEXT_SOURCES, sha256Text } from "../src/context-pack.js";
import { buildContextSelection, MAX_CONTEXT_CHANGED_PATHS, MAX_CONTEXT_GRAPH_ROOTS } from "../src/context-selection.js";
import { buildWorkspaceContextPack, planWorkspaceContext, retrieveWorkspaceContext } from "../src/context-workspace.js";
import {
  canonicalSolveGraphJson, parseSolveGraphText, SOLVE_GRAPH_SCHEMA,
  type SolveGraphDocument, type SolveGraphNode, type SolveGraphEdge, type SolveGraphEdgeKind,
} from "../src/solve-graph.js";

const digest = (value: unknown) => sha256Text(canonicalSolveGraphJson(value));
function node(inputPath: string, identity = inputPath): SolveGraphNode {
  return {
    id: `sgn_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind: "file", identity }).slice(0, 32)}`,
    kind: "file", identity, label: identity, evidence: [{ path: inputPath }], metadata: { path: inputPath },
  };
}
function edge(from: SolveGraphNode, to: SolveGraphNode, kind: SolveGraphEdgeKind = "imports"): SolveGraphEdge {
  return {
    id: `sge_${digest({ schema: SOLVE_GRAPH_SCHEMA, kind, from: from.id, to: to.id, qualifier: "" }).slice(0, 32)}`,
    from: from.id, to: to.id, kind, evidence: [],
  };
}
function graph(nodes: SolveGraphNode[], edges: SolveGraphEdge[]): SolveGraphDocument {
  const source = { fingerprint: "synthetic-context-selection-fixture" };
  const engine = { name: "fixture", version: "0.0.0", deterministic: true as const };
  const extractors: unknown[] = [];
  const limits = { fixtureOnly: true };
  const body = {
    schema: SOLVE_GRAPH_SCHEMA,
    graphId: `sg_${digest({ schema: SOLVE_GRAPH_SCHEMA, sourceFingerprint: source.fingerprint, engineVersion: engine.version, extractors, limits }).slice(0, 32)}`,
    mode: "analyze-only" as const, engine, source, extractors, limits,
    execution: { networkAccess: false as const, writeAccess: false as const },
    nodes: [...nodes].sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...edges].sort((a, b) => a.id.localeCompare(b.id)),
    integrity: { stableIds: true as const, ordering: "id-ascending" as const },
  };
  return { ...body, integrity: { ...body.integrity, canonicalJsonSha256: `sha256:${digest(body)}` } };
}
function snapshot(document: SolveGraphDocument) {
  const text = JSON.stringify(document);
  return { path: "graph.json", sourceSha256: sha256Text(text), document: parseSolveGraphText(text) };
}
async function inWorkspace(files: Record<string, string>, action: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "solve-context-selection-"));
  const previous = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  try {
    for (const [name, text] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true });
      await writeFile(path.join(root, name), text);
    }
    await action(root);
  } finally {
    if (previous === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

const rootNode = node("src/entry.ts");
const dependency = node("src/helper.ts");
const validation = node("test/entry.test.ts");
const transitive = node("src/deeper.ts");
const unrelated = node("src/unrelated.ts");
const fixture = graph([rootNode, dependency, validation, transitive, unrelated], [
  edge(rootNode, dependency), edge(validation, rootNode, "tests"), edge(dependency, transitive),
]);
const files = {
  "src/entry.ts": "export const entry = () => 17;\n",
  "src/helper.ts": "export const helper = () => 19;\n",
  "test/entry.test.ts": "assert.equal(entry(), 17);\n",
  "src/deeper.ts": "export const deeper = 23;\n",
  "src/unrelated.ts": "export const unrelated = 29;\n",
  "graph.json": JSON.stringify(fixture),
};

// No source bodies or graph labels are used as instructions or execution inputs.
test("explicit changes select exact source even without a task-word match", () => {
  const source = { path: "src/entry.ts", text: files["src/entry.ts"] };
  assert.equal(buildContextPack("rare_task_marker", [source]).entries.length, 0);
  const selection = buildContextSelection(["./src/entry.ts", "src/entry.ts"]);
  const pack = buildContextPack("rare_task_marker", [{ ...source, selection: selection.hints.get(source.path) }]);
  assert.equal(pack.entries.length, 1);
  assert.equal(pack.entries[0].content, source.text);
  assert.equal(pack.taskSha256, sha256Text("rare_task_marker"));
  assert.equal(pack.entries[0].sourceSha256, sha256Text(source.text));
  assert.deepEqual(pack.entries[0].reasons, ["explicit-changed-path"]);
  assert.deepEqual(selection.metadata.changedPaths, [source.path]);
});

test("one-hop graph selection includes dependencies and tests, not transitive files", () => {
  const selection = buildContextSelection([rootNode.metadata!.path as string], snapshot(fixture));
  assert.equal(selection.hints.get("src/entry.ts")?.score, 128);
  assert.equal(selection.hints.get("test/entry.test.ts")?.score, 96);
  assert.equal(selection.hints.get("src/helper.ts")?.score, 64);
  assert.equal(selection.hints.has("src/deeper.ts"), false);
  assert.equal(selection.hints.has("src/unrelated.ts"), false);
  assert.equal(selection.metadata.graph?.workspaceFreshness, "not-verified");
  assert.equal(selection.metadata.graph?.maxDepth, 1);
  assert.equal(selection.metadata.graphRoots, 1);
});

test("selection is deterministic under graph array order and changed-path order", () => {
  const first = buildContextSelection(["src/entry.ts", "src/helper.ts"], snapshot(fixture));
  const reordered = { ...fixture, nodes: [...fixture.nodes].reverse(), edges: [...fixture.edges].reverse() };
  // The same validated snapshot identity is retained here to isolate selection-order determinism.
  const second = buildContextSelection(["src/helper.ts", "src/entry.ts", "src/entry.ts"], {
    ...snapshot(fixture), document: reordered,
  });
  assert.deepEqual([...first.hints], [...second.hints]);
  assert.deepEqual(first.metadata, second.metadata);
});

test("unknown roots remain explicit and do not manufacture graph relationships", () => {
  const selection = buildContextSelection(["src/deleted.ts"], snapshot(fixture));
  assert.equal(selection.hints.size, 1);
  assert.equal(selection.metadata.graphRoots, 0);
  assert.deepEqual(selection.metadata.unmatchedChangedPaths, ["src/deleted.ts"]);
});

test("untrusted graph paths cannot escape or nominate sensitive files", () => {
  const invalid = ["../outside.ts", "/etc/passwd", "C:escape.ts", ".ssh/id_rsa", "bad\0name.ts"];
  const badNodes = invalid.map((value) => node(value));
  const selection = buildContextSelection(["src/entry.ts"], snapshot(graph([rootNode, ...badNodes], badNodes.map((value) => edge(rootNode, value)))),
    (value) => !value.startsWith(".ssh/"));
  assert.equal(selection.metadata.skippedGraphPaths, invalid.length);
  assert.deepEqual([...selection.hints.keys()], ["src/entry.ts"]);
});

test("only allowlisted structural relationships affect ranking", () => {
  const selection = buildContextSelection(["src/entry.ts"], snapshot(graph([rootNode, dependency], [edge(rootNode, dependency, "deploys")])));
  assert.deepEqual([...selection.hints.keys()], ["src/entry.ts"]);
});

test("root and selected-path truncation are bounded and reported independently", () => {
  const roots = Array.from({ length: MAX_CONTEXT_GRAPH_ROOTS + 1 }, (_, i) => node("src/entry.ts", `symbol-${i}`));
  const rootResult = buildContextSelection(["src/entry.ts"], snapshot(graph(roots, [])));
  assert.equal(rootResult.metadata.graphRoots, MAX_CONTEXT_GRAPH_ROOTS);
  assert.equal(rootResult.metadata.rootsTruncated, true);
  const neighbors = Array.from({ length: MAX_CONTEXT_SOURCES + 10 }, (_, i) => node(`src/file-${String(i).padStart(4, "0")}.ts`));
  const result = buildContextSelection(["src/entry.ts"], snapshot(graph([rootNode, ...neighbors], neighbors.map((value) => edge(rootNode, value)))));
  assert.equal(result.hints.size, MAX_CONTEXT_SOURCES);
  assert.equal(result.metadata.candidatesTruncated, true);
  assert.equal(result.hints.get("src/entry.ts")?.score, 128);
});

test("invalid selection bounds and source hints are rejected", () => {
  for (const changed of [[], Array(MAX_CONTEXT_CHANGED_PATHS + 1).fill("src/entry.ts"), ["../escape"], ["x".repeat(4_097)]]) {
    assert.throws(() => buildContextSelection(changed));
  }
  for (const selection of [{ score: Infinity, reasons: ["x"] }, { score: 129, reasons: ["x"] }, { score: 1, reasons: ["x\nunsafe"] }, { score: 1, reasons: Array(5).fill("x") }]) {
    assert.throws(() => buildContextPack("task", [{ path: "src/entry.ts", text: "source", selection }]), /selection evidence/);
  }
});

test("changed-file ranking obeys the original byte budget", () => {
  const source = "x".repeat(700);
  const selection = buildContextSelection(["z/changed.ts"]);
  const pack = buildContextPack("match", [
    { path: "a/match.ts", text: source },
    { path: "z/changed.ts", text: source, selection: selection.hints.get("z/changed.ts") },
  ], 1_024);
  assert.deepEqual(pack.entries.map((entry) => entry.path), ["z/changed.ts"]);
  assert.equal(pack.selectedBytes, 700);
  assert.equal(pack.truncated, true);
  assert.equal(pack.omittedCandidates, 1);
});

test("workspace plan and pack expose graph provenance without fabricated freshness", async () => {
  await inWorkspace(files, async () => {
    const options = { changedPaths: ["src/entry.ts"], graphPath: "graph.json", budgetBytes: 4_096 };
    const pack = await buildWorkspaceContextPack("rare_task_marker", options);
    const plan = await planWorkspaceContext("rare_task_marker", options);
    assert.deepEqual(pack.pack.entries.map((entry) => entry.path), ["src/entry.ts", "src/helper.ts", "test/entry.test.ts"]);
    assert.equal(pack.pack.packId, plan.pack.packId);
    assert.equal(plan.pack.entries.some((entry) => "content" in entry), false);
    assert.equal(pack.workspace.selection?.graph?.sourceSha256, sha256Text(files["graph.json"]));
    assert.equal(pack.workspace.selection?.graph?.workspaceFreshness, "not-verified");
    for (const entry of pack.pack.entries) {
      const retrieved = await retrieveWorkspaceContext(entry);
      assert.equal(retrieved.content, entry.content);
    }
  });
});

test("explicit paths remain a closed source allowlist even with a graph", async () => {
  await inWorkspace(files, async () => {
    const pack = await buildWorkspaceContextPack("rare_task_marker", {
      changedPaths: ["src/entry.ts"], graphPath: "graph.json", paths: ["src/entry.ts"],
    });
    assert.deepEqual(pack.pack.entries.map((entry) => entry.path), ["src/entry.ts"]);
    assert.equal(pack.workspace.selectedFiles, 1);
  });
});

test("workspace denies graph-only requests, tampering and sensitive hints", async () => {
  await inWorkspace(files, async (root) => {
    await assert.rejects(() => buildWorkspaceContextPack("task", { graphPath: "graph.json" }), /requires explicit changedPaths/);
    await assert.rejects(() => buildWorkspaceContextPack("task", { changedPaths: [".env"] }), /sensitive/);
    await assert.rejects(() => buildWorkspaceContextPack("task", { changedPaths: ["src/entry.ts"], graphPath: ".env" }), /sensitive/);
    await writeFile(path.join(root, "graph.json"), JSON.stringify({ ...fixture, edges: [] }));
    await assert.rejects(() => buildWorkspaceContextPack("task", { changedPaths: ["src/entry.ts"], graphPath: "graph.json" }), /integrity verification failed/);
  });
});

test("graph nominations do not bypass discovery exclusions or symlink confinement", async () => {
  const sensitive = node(".env");
  const vendor = node("node_modules/pkg/index.ts");
  const link = node("src/link.ts");
  const nominating = graph([rootNode, sensitive, vendor, link], [edge(rootNode, sensitive), edge(rootNode, vendor), edge(rootNode, link)]);
  await inWorkspace({ ...files, ".env": "fixture-secret-must-not-emit", "node_modules/pkg/index.ts": "vendor-marker", "graph.json": JSON.stringify(nominating) }, async (root) => {
    if (process.platform !== "win32") await symlink(path.join(root, "src/helper.ts"), path.join(root, "src/link.ts"));
    const result = await buildWorkspaceContextPack("rare_task_marker", { changedPaths: ["src/entry.ts"], graphPath: "graph.json" });
    assert.deepEqual(result.pack.entries.map((entry) => entry.path), ["src/entry.ts"]);
    assert.doesNotMatch(JSON.stringify(result), /fixture-secret-must-not-emit|vendor-marker/);
    if (process.platform !== "win32") {
      await symlink(path.join(root, "graph.json"), path.join(root, "linked-graph.json"));
      await assert.rejects(() => buildWorkspaceContextPack("task", { changedPaths: ["src/entry.ts"], graphPath: "linked-graph.json" }), /symbolic link/);
    }
  });
});

test("graph-selected excerpt retrieval still rejects changed source", async () => {
  await inWorkspace(files, async (root) => {
    const result = await buildWorkspaceContextPack("rare_task_marker", { changedPaths: ["src/entry.ts"], graphPath: "graph.json" });
    const entry = result.pack.entries.find((candidate) => candidate.path === "src/helper.ts")!;
    await writeFile(path.join(root, entry.path), "changed after selection\n");
    await assert.rejects(() => retrieveWorkspaceContext(entry), /source changed/);
  });
});

test("changed candidates are prioritized before the discovery source-read cap", async () => {
  const manyFiles: Record<string, string> = { "z/changed.ts": "export const target = 7;\n" };
  for (let i = 0; i < MAX_CONTEXT_SOURCES; i += 1) manyFiles[`a/f${i}.ts`] = "filler\n";
  await inWorkspace(manyFiles, async () => {
    const result = await buildWorkspaceContextPack("rare_task_marker", { changedPaths: ["z/changed.ts"] });
    assert.deepEqual(result.pack.entries.map((entry) => entry.path), ["z/changed.ts"]);
    assert.equal(result.workspace.selectedFiles, MAX_CONTEXT_SOURCES);
    assert.equal(result.workspace.discoveryTruncated, true);
  });
});

test("without selection hints the workspace pack stays lexical-only", async () => {
  await inWorkspace(files, async () => {
    const result = await buildWorkspaceContextPack("rare_task_marker", { paths: ["src/entry.ts"] });
    assert.equal(result.workspace.selection, undefined);
    assert.deepEqual(result.pack, buildContextPack("rare_task_marker", [{ path: "src/entry.ts", text: files["src/entry.ts"] }]));
  });
});
