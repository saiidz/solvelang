// Solve Context Index — host-aware provenance labels (Phase 0 of the
// platform-compatibility program).
//
// Drives the compiled CLI against real git checkouts whose origin remote
// lives on different git hosts. The pins that matter:
//   * a gitlab.com remote labels the index "gitlab.com/group/subgroup/repo"
//     (host kept, full subgroup path preserved);
//   * a self-hosted Gitea remote labels the index "gitea.example.com/owner/repo";
//   * a checkout with no remote keeps the historical "local/context-index";
//   * a github.com remote keeps the historical "owner/repository" label,
//     byte-identical to the pre-Phase-0 behavior;
//   * in every case the index builds and answers a query end to end.

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

async function git(args: string[], cwd: string): Promise<void> {
  await run("git", args, { cwd });
}

async function write(root: string, relative: string, content: string): Promise<void> {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, content, "utf8");
}

const UTIL = "export function formatWidgetName(name: string): string {\n  return name.trim().toLowerCase();\n}\n";

async function seedCheckout(remoteUrl: string | undefined): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "solvelang-context-index-hosts-"));
  await write(root, "package.json", `${JSON.stringify({ name: "host-fixture", private: true }, null, 2)}\n`);
  await write(root, "src/util.ts", UTIL);
  await write(root, "src/widget.ts", "import { formatWidgetName } from \"./util\";\n\nexport class Widget {\n  label(name: string): string { return formatWidgetName(name); }\n}\n");
  await git(["init", "-q"], root);
  await git(["config", "user.email", "fixture@example.com"], root);
  await git(["config", "user.name", "Fixture"], root);
  if (remoteUrl) await git(["remote", "add", "origin", remoteUrl], root);
  await git(["add", "-A"], root);
  await git(["commit", "-qm", "fixture"], root);
  return root;
}

async function buildLabelAndQuery(root: string): Promise<string> {
  const build = await cli(["build", root], root);
  assert.equal(build.code, 0, build.stderr);
  const buildReport = JSON.parse(build.stdout);
  assert.equal(buildReport.command, "build");

  const query = await cli(["query", root, "--task", "format widget name"], root);
  assert.equal(query.code, 0, query.stderr);
  const queryReport = JSON.parse(query.stdout);
  assert.equal(queryReport.schema, "solvelang.context.index-query.v1");
  const entryPaths = queryReport.pack.entries.map((entry: { path: string }) => entry.path);
  assert.ok(entryPaths.includes("src/util.ts"), `expected src/util.ts in the query pack, got ${entryPaths.join(", ")}`);

  return buildReport.source.displayName as string;
}

test("gitlab.com remote labels with the host and the full subgroup path", async () => {
  const root = await seedCheckout("git@gitlab.com:group/subgroup/repo.git");
  try {
    assert.equal(await buildLabelAndQuery(root), "gitlab.com/group/subgroup/repo");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("self-hosted Gitea remote labels with the host", async () => {
  const root = await seedCheckout("https://gitea.example.com/owner/repo.git");
  try {
    assert.equal(await buildLabelAndQuery(root), "gitea.example.com/owner/repo");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("checkout with no remote keeps the local fallback label", async () => {
  const root = await seedCheckout(undefined);
  try {
    assert.equal(await buildLabelAndQuery(root), "local/context-index");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("github.com remote keeps the historical owner/repository label", async () => {
  const root = await seedCheckout("git@github.com:example/automation-app.git");
  try {
    assert.equal(await buildLabelAndQuery(root), "example/automation-app");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
