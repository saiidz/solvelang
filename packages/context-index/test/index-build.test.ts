// Solve Context Index — build/refresh proof on a synthetic monorepo
// fixture (Phase 7, deliverable 5a). The pins that matter:
//   * a full build writes a content-hashed index whose records carry
//     classifications and graph-projected imports, with sensitive paths
//     excluded and oversize files listed, never excerpted;
//   * a no-change refresh is a no-op and leaves the index byte-identical;
//   * after a code change, refresh recomputes only the affected scope
//     (changed files + graph dependents), records outside that scope stay
//     byte-identical, and the refreshed index is identical to a full
//     build of the same tree state (incremental ≡ full);
//   * additions and deletions are detected by content hash.

import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { verifySolveGraphIntegrity } from "../../../site/app/solve-graph/core/canonical";
import type { SolveGraphDocument } from "../../../site/app/solve-graph/core/contracts";
import { buildContextIndex, refreshContextIndex } from "../src/index-build";
import {
  CONTEXT_INDEX_FILE,
  CONTEXT_INDEX_GRAPH_FILE,
  computeContextIndexSha256,
  type ContextIndex,
  type ContextIndexRecord,
} from "../src/index-format";

const UTIL_V1 = [
  "export function formatWidgetName(name: string): string {",
  "  return name.trim().toLowerCase();",
  "}",
  "",
].join("\n");

const UTIL_V2 = [
  "export function formatWidgetName(name: string): string {",
  "  return name.trim().toLowerCase().replace(/\\s+/g, \"-\");",
  "}",
  "",
  "export function slugifyWidgetName(name: string): string {",
  "  return formatWidgetName(name);",
  "}",
  "",
].join("\n");

async function write(root: string, relative: string, content: string): Promise<void> {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

async function seedMonorepo(root: string): Promise<void> {
  await write(root, "package.json", `${JSON.stringify({ name: "fixture-monorepo", private: true }, null, 2)}\n`);
  await write(root, "packages/core/package.json", `${JSON.stringify({ name: "@fixture/core", version: "1.0.0" }, null, 2)}\n`);
  await write(root, "packages/core/src/util.ts", UTIL_V1);
  await write(root, "packages/core/src/widget.ts", [
    "import { formatWidgetName } from \"./util\";",
    "",
    "export class Widget {",
    "  constructor(private readonly rawName: string) {}",
    "  get name(): string { return formatWidgetName(this.rawName); }",
    "}",
    "",
  ].join("\n"));
  await write(root, "packages/core/src/index.ts", "export { Widget } from \"./widget\";\n");
  await write(root, "packages/web/package.json", `${JSON.stringify({ name: "@fixture/web", version: "1.0.0" }, null, 2)}\n`);
  await write(root, "packages/web/src/view.ts", [
    "import { formatWidgetName } from \"../../core/src/util\";",
    "",
    "export function renderView(name: string): string {",
    "  return `<view>${formatWidgetName(name)}</view>`;",
    "}",
    "",
  ].join("\n"));
  await write(root, "packages/web/src/main.ts", [
    "import { Widget } from \"../../core/src/widget\";",
    "import { renderView } from \"./view\";",
    "",
    "export function main(): string {",
    "  return renderView(new Widget(\"demo\").name);",
    "}",
    "",
  ].join("\n"));
  await write(root, "packages/web/test/view.test.ts", [
    "import { renderView } from \"../src/view\";",
    "",
    "export function checkView(): boolean {",
    "  return renderView(\"x\").includes(\"<view>\");",
    "}",
    "",
  ].join("\n"));
  await write(root, "docs/guide.md", "# Guide\n\nHow widget formatting works for the web package.\n");
  await write(root, ".env", "FIXTURE_SECRET=not-a-real-secret\n");
}

async function withFixture(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-index-"));
  try {
    await seedMonorepo(root);
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readIndex(root: string, outDir?: string): Promise<ContextIndex> {
  const directory = outDir ?? path.join(root, ".solve");
  return JSON.parse(await readFile(path.join(directory, CONTEXT_INDEX_FILE), "utf8")) as ContextIndex;
}

function recordOf(index: ContextIndex, filePath: string): ContextIndexRecord {
  const record = index.records.find((candidate) => candidate.path === filePath);
  assert.ok(record, `expected an index record for ${filePath}`);
  return record;
}

function recordJson(index: ContextIndex, filePath: string): string {
  return JSON.stringify(recordOf(index, filePath));
}

test("build writes a content-hashed index, a verified graph, and classified records", async () => {
  await withFixture(async (root) => {
    const report = await buildContextIndex(root);
    const index = report.index;

    assert.equal(index.schema, "solvelang.context.index.v1");
    assert.equal(index.indexSha256, computeContextIndexSha256(index));
    assert.equal(index.counts.records, index.records.length);

    const util = recordOf(index, "packages/core/src/util.ts");
    assert.equal(util.classification, "source");
    assert.ok(util.declarations.includes("formatWidgetName"));
    assert.ok(util.terms.includes("formatwidgetname"));
    assert.equal(util.oversize, false);
    assert.match(util.sha256 ?? "", /^[a-f0-9]{64}$/);

    const widget = recordOf(index, "packages/core/src/widget.ts");
    assert.deepEqual(widget.imports, ["packages/core/src/util.ts"]);
    const view = recordOf(index, "packages/web/src/view.ts");
    assert.deepEqual(view.imports, ["packages/core/src/util.ts"]);
    const testRecord = recordOf(index, "packages/web/test/view.test.ts");
    assert.equal(testRecord.classification, "test");
    assert.equal(recordOf(index, "docs/guide.md").classification, "documentation");

    // Sensitive paths are excluded entirely: no record, counted once.
    assert.equal(index.records.some((record) => record.path === ".env"), false);
    assert.ok(index.counts.skippedSensitive >= 1);

    // The graph file is the engine's own document, integrity-verified.
    const graphText = await readFile(path.join(root, ".solve", CONTEXT_INDEX_GRAPH_FILE), "utf8");
    const document = JSON.parse(graphText) as SolveGraphDocument;
    assert.equal(await verifySolveGraphIntegrity(document), true);
    assert.equal(index.graph.graphId, document.graphId);
    assert.equal(index.graph.sha256.length, 64);
  });
});

test("a no-change refresh is a no-op and leaves the index byte-identical", async () => {
  await withFixture(async (root) => {
    await buildContextIndex(root);
    const before = await readFile(path.join(root, ".solve", CONTEXT_INDEX_FILE), "utf8");
    const report = await refreshContextIndex(root);
    assert.equal(report.changed, false);
    assert.deepEqual(report.affectedPaths, []);
    const after = await readFile(path.join(root, ".solve", CONTEXT_INDEX_FILE), "utf8");
    assert.equal(after, before);
  });
});

test("refresh after a leaf change recomputes only the affected scope and equals a full build", async () => {
  const rootA = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-index-a-"));
  const rootB = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-index-b-"));
  try {
    await seedMonorepo(rootA);
    await cp(rootA, rootB, { recursive: true });

    await buildContextIndex(rootA);
    const before = await readIndex(rootA);
    const guideBefore = recordJson(before, "docs/guide.md");
    const rootManifestBefore = recordJson(before, "package.json");
    const webManifestBefore = recordJson(before, "packages/web/package.json");

    // The scripted change: one leaf file in the core package.
    await write(rootA, "packages/core/src/util.ts", UTIL_V2);
    await write(rootB, "packages/core/src/util.ts", UTIL_V2);

    const report = await refreshContextIndex(rootA);
    assert.equal(report.changed, true);
    assert.deepEqual(report.modifiedPaths, ["packages/core/src/util.ts"]);
    assert.deepEqual(report.addedPaths, []);
    assert.deepEqual(report.deletedPaths, []);

    // Affected scope = the changed leaf + its graph dependents.
    for (const dependent of ["packages/core/src/widget.ts", "packages/web/src/view.ts"]) {
      assert.ok(report.affectedPaths.includes(dependent), `expected ${dependent} in the affected scope`);
    }
    for (const recomputed of report.recomputedRecordPaths) {
      assert.ok(report.affectedPaths.includes(recomputed), `recomputed ${recomputed} outside the affected scope`);
    }

    // Records outside the affected scope are byte-identical.
    const after = await readIndex(rootA);
    assert.equal(recordJson(after, "docs/guide.md"), guideBefore);
    assert.equal(recordJson(after, "package.json"), rootManifestBefore);
    assert.equal(recordJson(after, "packages/web/package.json"), webManifestBefore);
    assert.ok(recordOf(after, "packages/core/src/util.ts").declarations.includes("slugifyWidgetName"));

    // Incremental ≡ full: a full build of the same tree state produces
    // the identical index and the identical graph bytes.
    await buildContextIndex(rootB);
    const full = await readIndex(rootB);
    assert.equal(computeContextIndexSha256(after), computeContextIndexSha256(full));
    assert.deepEqual(after, full);
    const graphA = await readFile(path.join(rootA, ".solve", CONTEXT_INDEX_GRAPH_FILE), "utf8");
    const graphB = await readFile(path.join(rootB, ".solve", CONTEXT_INDEX_GRAPH_FILE), "utf8");
    assert.equal(graphA, graphB);
  } finally {
    await rm(rootA, { recursive: true, force: true });
    await rm(rootB, { recursive: true, force: true });
  }
});

test("refresh detects additions and deletions by content hash", async () => {
  await withFixture(async (root) => {
    await buildContextIndex(root);
    const before = await readIndex(root);
    const viewBefore = recordJson(before, "packages/web/src/view.ts");

    await write(root, "packages/web/src/extra.ts", [
      "import { renderView } from \"./view\";",
      "",
      "export function renderExtra(): string { return renderView(\"extra\"); }",
      "",
    ].join("\n"));
    await rm(path.join(root, "packages/web/test/view.test.ts"));

    const report = await refreshContextIndex(root);
    assert.equal(report.changed, true);
    assert.deepEqual(report.addedPaths, ["packages/web/src/extra.ts"]);
    assert.deepEqual(report.deletedPaths, ["packages/web/test/view.test.ts"]);

    const after = await readIndex(root);
    assert.equal(after.records.some((record) => record.path === "packages/web/test/view.test.ts"), false);
    assert.deepEqual(recordOf(after, "packages/web/src/extra.ts").imports, ["packages/web/src/view.ts"]);
    // The deleted file was a dependent of view.ts, not a dependency:
    // view.ts itself is outside the affected scope and byte-identical.
    assert.equal(recordJson(after, "packages/web/src/view.ts"), viewBefore);
  });
});

test("oversize files are indexed as oversize and binary content gets no record", async () => {
  await withFixture(async (root) => {
    const bigBody = `// ${"x".repeat(2_200_000)}\nexport function bigFixture(): number { return 1; }\n`;
    await write(root, "packages/core/src/big.ts", bigBody);
    await write(root, "packages/core/src/binary.ts", "text before\0binary after\n");

    const report = await buildContextIndex(root);
    const big = recordOf(report.index, "packages/core/src/big.ts");
    assert.equal(big.oversize, true);
    assert.deepEqual(big.terms, []);
    assert.match(big.sha256 ?? "", /^[a-f0-9]{64}$/);
    assert.ok(report.index.counts.skippedOversize.includes("packages/core/src/big.ts"));
    assert.equal(report.index.records.some((record) => record.path === "packages/core/src/binary.ts"), false);
  });
});

test("giant text files above the walk cap are recorded oversize, never fatal", async () => {
  await withFixture(async (root) => {
    // ~9 MB of SQL inserts: over the 2 MB pack cap AND over the 8 MB
    // walk read cap, so the walker carries the file size-only. This is
    // the UCS dogfood repro shape (a cities seeder chunk).
    const line = "INSERT INTO cities (id, name) VALUES (1, 'Springfield');\n";
    const sql = line.repeat(Math.ceil((9 * 1024 * 1024) / line.length));
    await write(root, "database/seeders/cities.sql", sql);

    const report = await buildContextIndex(root);
    const record = recordOf(report.index, "database/seeders/cities.sql");
    assert.equal(record.oversize, true);
    assert.equal(record.bytes, Buffer.byteLength(sql));
    assert.equal(record.sha256, null);
    assert.deepEqual(record.terms, []);
    assert.deepEqual(record.declarations, []);
    assert.ok(report.index.counts.skippedOversize.includes("database/seeders/cities.sql"));

    // Nothing of the giant file's content is excerpted into the index.
    const rawIndex = await readFile(path.join(root, ".solve", CONTEXT_INDEX_FILE), "utf8");
    assert.equal(rawIndex.includes("INSERT INTO cities"), false);

    // The rest of the tree indexed normally.
    assert.ok(recordOf(report.index, "packages/core/src/util.ts").declarations.includes("formatWidgetName"));
  });
});

test("giant binary files above the walk cap get no record and never fail the build", async () => {
  await withFixture(async (root) => {
    const bytes = Buffer.alloc(9 * 1024 * 1024, 0);
    bytes.write("ftypmp42", 4, "ascii");
    const destination = path.join(root, "media/clip.m4v");
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);

    const report = await buildContextIndex(root);
    assert.equal(report.index.records.some((record) => record.path === "media/clip.m4v"), false);
    assert.equal(report.index.counts.skippedOversize.includes("media/clip.m4v"), false);
    assert.ok(recordOf(report.index, "packages/core/src/util.ts"));
  });
});

test("a generated file just above the walk cap builds and refreshes cleanly", async () => {
  await withFixture(async (root) => {
    // Sparse generated content just over the 8 MB size-only threshold.
    const filler = `${"x".repeat(1024)}\n`;
    await write(root, "logs/huge.txt", filler.repeat(8 * 1024 + 64));

    const report = await buildContextIndex(root);
    const record = recordOf(report.index, "logs/huge.txt");
    assert.equal(record.oversize, true);
    assert.equal(record.sha256, null);

    const refresh = await refreshContextIndex(root);
    assert.equal(refresh.changed, false);
  });
});

test("a mixed tree with a giant file and a symlink indexes its small files normally", async () => {
  await withFixture(async (root) => {
    const line = "INSERT INTO cities (id, name) VALUES (1, 'Springfield');\n";
    await write(root, "database/seeders/cities.sql", line.repeat(Math.ceil((9 * 1024 * 1024) / line.length)));
    await symlink("util.ts", path.join(root, "packages/core/src/util-link.ts"));

    const report = await buildContextIndex(root);
    const widget = recordOf(report.index, "packages/core/src/widget.ts");
    assert.deepEqual(widget.imports, ["packages/core/src/util.ts"]);
    assert.equal(report.index.records.some((record) => record.path === "packages/core/src/util-link.ts"), false);
    assert.equal(recordOf(report.index, "database/seeders/cities.sql").oversize, true);
  });
});
