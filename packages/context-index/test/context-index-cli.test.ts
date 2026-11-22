// Solve Context Index — CLI end-to-end proof (Phase 7).
//
// Drives the compiled solvelang-context-index binary as a user would:
// build a small monorepo fixture, read status, answer a query from the
// index (through the MCP server's own query core), change a file, and
// refresh — asserting exit codes and the JSON reports at each step.

import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = path.join(__dirname, "..", "src", "cli.js");

async function cli(args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [CLI, ...args], { cwd, maxBuffer: 32 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

async function write(root: string, relative: string, content: string): Promise<void> {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

const UTIL_V1 = "export function formatWidgetName(name: string): string {\n  return name.trim().toLowerCase();\n}\n";
const UTIL_V2 = "export function formatWidgetName(name: string): string {\n  return name.trim().toUpperCase();\n}\n";

test("build, status, query, and refresh work end to end through the CLI", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-index-cli-"));
  try {
    await write(root, "package.json", `${JSON.stringify({ name: "cli-fixture", private: true }, null, 2)}\n`);
    await write(root, "src/util.ts", UTIL_V1);
    await write(root, "src/widget.ts", "import { formatWidgetName } from \"./util\";\n\nexport class Widget {\n  label(name: string): string { return formatWidgetName(name); }\n}\n");

    const build = await cli(["build", root], root);
    assert.equal(build.code, 0, build.stderr);
    const buildReport = JSON.parse(build.stdout);
    assert.equal(buildReport.command, "build");
    assert.ok(buildReport.counts.records >= 3);
    assert.match(buildReport.indexSha256, /^[a-f0-9]{64}$/);

    const status = await cli(["status", root], root);
    assert.equal(status.code, 0, status.stderr);
    const statusReport = JSON.parse(status.stdout);
    assert.equal(statusReport.present, true);
    assert.equal(statusReport.indexHashValid, true);

    const query = await cli(["query", root, "--task", "format widget name"], root);
    assert.equal(query.code, 0, query.stderr);
    const queryReport = JSON.parse(query.stdout);
    assert.equal(queryReport.schema, "solvelang.context.index-query.v1");
    const entryPaths = queryReport.pack.entries.map((entry: { path: string }) => entry.path);
    assert.ok(entryPaths.includes("src/util.ts"));

    await write(root, "src/util.ts", UTIL_V2);
    const refresh = await cli(["refresh", root], root);
    assert.equal(refresh.code, 0, refresh.stderr);
    const refreshReport = JSON.parse(refresh.stdout);
    assert.equal(refreshReport.changed, true);
    assert.deepEqual(refreshReport.modifiedPaths, ["src/util.ts"]);
    assert.ok(refreshReport.affectedPaths.includes("src/widget.ts"));

    const noChange = await cli(["refresh", root], root);
    assert.equal(noChange.code, 0, noChange.stderr);
    assert.equal(JSON.parse(noChange.stdout).changed, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("refresh without an index is an operational error (exit 2)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-index-cli-empty-"));
  try {
    const refresh = await cli(["refresh", root], root);
    assert.equal(refresh.code, 2);
    assert.match(refresh.stderr, /No Solve Context index/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("build and query survive giant files in the tree (CLI)", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-index-cli-giant-"));
  try {
    await write(root, "package.json", `${JSON.stringify({ name: "cli-giant-fixture", private: true }, null, 2)}\n`);
    await write(root, "src/util.ts", UTIL_V1);
    const line = "INSERT INTO cities (id, name) VALUES (1, 'Springfield');\n";
    await write(root, "src/cities.sql", line.repeat(Math.ceil((9 * 1024 * 1024) / line.length)));

    const build = await cli(["build", root], root);
    assert.equal(build.code, 0, build.stderr);
    const buildReport = JSON.parse(build.stdout);
    assert.deepEqual(buildReport.counts.skippedOversize, ["src/cities.sql"]);

    const query = await cli(["query", root, "--task", "format widget name"], root);
    assert.equal(query.code, 0, query.stderr);
    const entryPaths = JSON.parse(query.stdout).pack.entries.map((entry: { path: string }) => entry.path);
    assert.ok(entryPaths.includes("src/util.ts"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
