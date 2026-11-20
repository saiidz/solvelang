// Solve Context Index — query-side proof (Phase 7).
//
// A hand-built index fixture (records hashed with the loader's own
// canonical projection, so the builder/loader contract is round-tripped)
// over a three-file workspace asserts:
//   * status reports the index with a valid hash and graph reference;
//   * a query ranks the declaration-matching file first, returns pack
//     entries in the standard pack format with hash-pinned provenance,
//     and pulls in the graph neighbor of a top hit;
//   * a file changed after indexing is excluded and reported stale;
//   * a missing index is a calm status and a clear query error;
//   * the real local stdio server exposes exactly 31 tools, the two new
//     ones read-only, and answers a query through the MCP protocol.

import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

import { sha256Text } from "../src/context-pack.js";
import {
  canonicalContextIndexJson,
  contextIndexStatus,
  queryContextIndex,
  type ContextIndexDocument,
  type ContextIndexRecord,
} from "../src/context-index.js";

const UTIL = "export function formatWidgetName(name: string): string {\n  return name.trim().toLowerCase();\n}\n";
const WIDGET = "import { formatWidgetName } from \"./util\";\n\nexport class Widget {\n  constructor(private readonly rawName: string) {}\n  get name(): string { return formatWidgetName(this.rawName); }\n}\n";
const GUIDE = "# Guide\n\nHow widget formatting works.\n";

function record(filePath: string, text: string, extra: Partial<ContextIndexRecord>): ContextIndexRecord {
  return {
    path: filePath,
    sha256: sha256Text(text),
    bytes: Buffer.byteLength(text, "utf8"),
    classification: "source",
    terms: [],
    declarations: [],
    imports: [],
    oversize: false,
    ...extra,
  };
}

async function seedWorkspace(root: string): Promise<void> {
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "docs"), { recursive: true });
  await mkdir(path.join(root, ".solve"), { recursive: true });
  await writeFile(path.join(root, "src/util.ts"), UTIL, "utf8");
  await writeFile(path.join(root, "src/widget.ts"), WIDGET, "utf8");
  await writeFile(path.join(root, "docs/guide.md"), GUIDE, "utf8");

  const graph = {
    schema: "solvelang.graph.v0",
    graphId: "sg_fixture",
    mode: "analyze-only",
    execution: { networkAccess: false, writeAccess: false },
    nodes: [
      { id: "n_util", kind: "file", metadata: { path: "src/util.ts" } },
      { id: "n_widget", kind: "file", metadata: { path: "src/widget.ts" } },
      { id: "n_guide", kind: "file", metadata: { path: "docs/guide.md" } },
    ],
    edges: [
      { id: "e_widget_util", kind: "imports", from: "n_widget", to: "n_util" },
    ],
  };
  const graphText = JSON.stringify(graph, null, 2);
  await writeFile(path.join(root, ".solve/context-index.graph.json"), graphText, "utf8");

  const records = [
    record("src/util.ts", UTIL, {
      terms: ["format", "formatwidgetname", "lowercase", "name", "string", "trim", "widget"],
      declarations: ["formatWidgetName"],
    }),
    record("src/widget.ts", WIDGET, {
      terms: ["class", "formatwidgetname", "name", "rawname", "widget"],
      declarations: ["Widget"],
      imports: ["src/util.ts"],
    }),
    record("docs/guide.md", GUIDE, {
      classification: "documentation",
      terms: ["formatting", "guide", "how", "widget", "works"],
    }),
  ];
  const withoutHash: Omit<ContextIndexDocument, "indexSha256"> = {
    schema: "solvelang.context.index.v1",
    tool: { name: "solvelang-context-index", version: "0.1.0" },
    source: { displayName: "fixture", revision: "fixture-revision", fingerprint: "a".repeat(64) },
    graph: {
      file: "context-index.graph.json",
      sha256: sha256Text(graphText),
      graphId: "sg_fixture",
      status: "complete",
      nodes: 3,
      edges: 1,
    },
    counts: { walkedFiles: 3, records: 3, skippedSensitive: 0, skippedUnsupported: 0, skippedEmpty: 0, skippedOversize: [] },
    records,
  };
  const index: ContextIndexDocument = {
    ...withoutHash,
    indexSha256: sha256Text(canonicalContextIndexJson(withoutHash)),
  };
  await writeFile(path.join(root, ".solve/context-index.json"), `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-index-query-"));
  const previous = process.env.SOLVELANG_WORKSPACE_ROOT;
  process.env.SOLVELANG_WORKSPACE_ROOT = root;
  try {
    await run(root);
  } finally {
    if (previous === undefined) delete process.env.SOLVELANG_WORKSPACE_ROOT;
    else process.env.SOLVELANG_WORKSPACE_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("status reports a valid index and query returns the right context from it", async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);

    const status = await contextIndexStatus();
    assert.equal(status.present, true);
    assert.equal(status.indexHashValid, true);
    assert.equal(status.graph?.hashMatches, true);
    assert.equal(status.counts?.records, 3);

    const result = await queryContextIndex("format widget name");
    assert.equal(result.schema, "solvelang.context.index-query.v1");
    assert.equal(result.selection.graphHintsUsed, true);
    assert.equal(result.selection.indexStale, false);
    assert.equal(result.selection.ranked[0]?.path, "src/util.ts");
    assert.ok(result.selection.ranked[0]?.reasons.some((reason) => reason.startsWith("declaration:")));

    assert.ok(result.pack, "expected a pack");
    assert.equal(result.pack.schema, "solvelang.context.pack.v0");
    const entryPaths = result.pack.entries.map((entry) => entry.path);
    assert.ok(entryPaths.includes("src/util.ts"), "the declaration-matching file must be in the pack");
    assert.ok(entryPaths.includes("src/widget.ts"), "the graph neighbor / importer must be in the pack");
    const utilEntry = result.pack.entries.find((entry) => entry.path === "src/util.ts")!;
    assert.equal(utilEntry.sourceSha256, sha256Text(UTIL));
    assert.ok(utilEntry.content.includes("formatWidgetName"));
  });
});

test("a file changed after indexing is excluded and reported stale", async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    await writeFile(path.join(root, "src/util.ts"), `${UTIL}\n// edited after indexing\n`, "utf8");

    const result = await queryContextIndex("format widget name");
    assert.equal(result.selection.indexStale, true);
    assert.deepEqual(result.selection.stalePaths, ["src/util.ts"]);
    const entryPaths = result.pack?.entries.map((entry) => entry.path) ?? [];
    assert.equal(entryPaths.includes("src/util.ts"), false);
  });
});

test("a workspace without an index reports absence and query explains the build step", async () => {
  await withWorkspace(async () => {
    const status = await contextIndexStatus();
    assert.equal(status.present, false);
    await assert.rejects(() => queryContextIndex("anything"), /No Solve Context index found/);
  });
});

test("the local stdio server exposes 31 tools with the two index tools read-only", async () => {
  await withWorkspace(async (root) => {
    await seedWorkspace(root);
    const serverEntry = path.join(process.cwd(), "dist/src/index.js");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverEntry],
      cwd: root,
      env: { ...process.env, SOLVELANG_WORKSPACE_ROOT: root },
    });
    const client = new Client({ name: "context-index-test", version: "0.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.equal(tools.length, 31);
      for (const name of ["solvelang_context_index_query", "solvelang_context_index_status"]) {
        const tool = tools.find((candidate) => candidate.name === name);
        assert.ok(tool, `expected tool ${name}`);
        assert.equal(tool.annotations?.readOnlyHint, true);
        assert.equal(tool.annotations?.openWorldHint, false);
      }

      const statusResult = await client.callTool({ name: "solvelang_context_index_status", arguments: {} });
      const statusText = (statusResult.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      assert.equal(JSON.parse(statusText).present, true);

      const queryResult = await client.callTool({
        name: "solvelang_context_index_query",
        arguments: { task: "format widget name" },
      });
      const queryText = (queryResult.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
      const parsed = JSON.parse(queryText);
      assert.equal(parsed.schema, "solvelang.context.index-query.v1");
      assert.ok(parsed.pack.entries.some((entry: { path: string }) => entry.path === "src/util.ts"));
    } finally {
      await client.close();
    }
  });
});
