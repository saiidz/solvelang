import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function run(command, args, options = {}) {
  return execFileAsync(command, args, {
    maxBuffer: 20 * 1024 * 1024,
    ...options,
  });
}

async function replaceExact(filePath, from, to) {
  const text = await readFile(filePath, "utf8");
  const first = text.indexOf(from);
  assert.notEqual(first, -1, `${path.basename(filePath)} is missing the expected version marker`);
  assert.equal(text.indexOf(from, first + from.length), -1, `${path.basename(filePath)} has an ambiguous duplicate version marker`);
  await writeFile(filePath, text.replace(from, to), "utf8");
}

const candidate = await readJson(path.join(packageRoot, "release-candidate.json"));
const sourceManifest = await readJson(path.join(packageRoot, "package.json"));
const sourceLock = await readJson(path.join(packageRoot, "package-lock.json"));

assert.equal(candidate.schema, "solvelang.mcp.release-candidate.v1");
assert.equal(
  ["selected-not-published", "release-ready-not-published"].includes(candidate.state),
  true,
  `unsupported release-candidate state ${candidate.state}`,
);
assert.equal(candidate.publicationAuthorized, false, "qualification must not grant publication authority");
assert.notEqual(candidate.candidateVersion, candidate.publishedVersion, "candidate qualification must exercise a distinct next version");

const releaseReady = candidate.state === "release-ready-not-published";
const sourceVersion = releaseReady ? candidate.candidateVersion : candidate.publishedVersion;
assert.equal(sourceManifest.version, sourceVersion, "repository package metadata does not match the current release state");
assert.equal(sourceLock.version, sourceVersion, "repository lockfile does not match the current release state");
assert.equal(sourceLock.packages?.[""]?.version, sourceVersion, "repository lockfile root package does not match the current release state");

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "solvelang-mcp-finalization-"));
let client;
try {
  const candidateRoot = path.join(temporaryRoot, "candidate");
  await cp(packageRoot, candidateRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(packageRoot, source);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      return !parts.includes("node_modules") && !relative.endsWith(".tgz");
    },
  });

  if (!releaseReady) {
    const stagedManifestPath = path.join(candidateRoot, "package.json");
    const stagedManifest = await readJson(stagedManifestPath);
    stagedManifest.version = candidate.candidateVersion;
    await writeFile(stagedManifestPath, `${JSON.stringify(stagedManifest, null, 2)}\n`, "utf8");

    const stagedLockPath = path.join(candidateRoot, "package-lock.json");
    const stagedLock = await readJson(stagedLockPath);
    stagedLock.version = candidate.candidateVersion;
    assert.ok(stagedLock.packages?.[""], "staged lockfile must contain a root package record");
    stagedLock.packages[""].version = candidate.candidateVersion;
    await writeFile(stagedLockPath, `${JSON.stringify(stagedLock, null, 2)}\n`, "utf8");

    await replaceExact(
      path.join(candidateRoot, "src", "index.ts"),
      `{ name: "solvelang", version: "${candidate.publishedVersion}" }`,
      `{ name: "solvelang", version: "${candidate.candidateVersion}" }`,
    );
    await replaceExact(
      path.join(candidateRoot, "src", "remote.ts"),
      `{ name: "solvelang-remote", version: "${candidate.publishedVersion}" }`,
      `{ name: "solvelang-remote", version: "${candidate.candidateVersion}" }`,
    );
  }

  await symlink(path.join(packageRoot, "node_modules"), path.join(candidateRoot, "node_modules"), "dir");
  await run("npm", ["run", "build"], { cwd: candidateRoot });

  const { stdout: packStdout } = await run(
    "npm",
    ["pack", "--json", "--ignore-scripts", "--pack-destination", temporaryRoot],
    { cwd: candidateRoot },
  );
  const [packResult] = JSON.parse(packStdout);
  assert.ok(packResult?.filename, "candidate npm pack must produce one tarball");
  assert.equal(packResult.version, candidate.candidateVersion, "candidate tarball version must match the selected candidate");

  const consumerRoot = path.join(temporaryRoot, "consumer");
  const workspaceRoot = path.join(temporaryRoot, "workspace");
  await mkdir(consumerRoot);
  await mkdir(workspaceRoot);
  await writeFile(path.join(consumerRoot, "package.json"), '{"private":true,"type":"module"}\n', "utf8");

  const tarballPath = path.join(temporaryRoot, packResult.filename);
  const npmEnvironment = { ...process.env, npm_config_cache: path.join(temporaryRoot, "npm-cache") };
  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarballPath],
    { cwd: consumerRoot, env: npmEnvironment },
  );

  const installedRoot = path.join(consumerRoot, "node_modules", "@solvelang", "mcp-server");
  const installedManifest = await readJson(path.join(installedRoot, "package.json"));
  assert.equal(installedManifest.name, "@solvelang/mcp-server");
  assert.equal(installedManifest.version, candidate.candidateVersion);

  const installedIndex = await readFile(path.join(installedRoot, "dist", "src", "index.js"), "utf8");
  const installedRemote = await readFile(path.join(installedRoot, "dist", "src", "remote.js"), "utf8");
  assert.match(installedIndex, new RegExp(`version: ["']${candidate.candidateVersion.replaceAll(".", "\\.")}["']`));
  assert.match(installedRemote, new RegExp(`version: ["']${candidate.candidateVersion.replaceAll(".", "\\.")}["']`));

  const installedEntrypoint = path.join(installedRoot, "dist", "src", "index.js");
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [installedEntrypoint],
    cwd: workspaceRoot,
    env: { ...process.env, SOLVELANG_WORKSPACE_ROOT: workspaceRoot },
  });
  client = new Client(
    { name: "solvelang-release-finalization-smoke", version: "0.0.0" },
    { capabilities: {} },
  );
  await client.connect(transport);

  const listed = await client.listTools();
  const toolNames = new Set(listed.tools.map((tool) => tool.name));
  for (const name of [
    "solvelang_context_plan",
    "solvelang_context_pack",
    "solvelang_context_retrieve",
    "solvelang_context_handoff",
    "solvelang_context_handoff_validate",
    "solvelang_context_compact_structured",
    "solvelang_context_expand_rle",
    "solvelang_context_capabilities",
  ]) {
    assert.equal(toolNames.has(name), true, `qualified ${candidate.candidateVersion} package is missing ${name}`);
  }

  console.log(
    `SolveLang MCP ${candidate.candidateVersion} ${releaseReady ? "release-ready" : "staged"} finalization PASS: clean tarball install and Solve Context startup verified; published line remains ${candidate.publishedVersion}; publication remains unauthorized.`,
  );
} finally {
  try {
    await client?.close();
  } catch {
    // Best-effort cleanup only; qualification assertions above remain authoritative.
  }
  await rm(temporaryRoot, { recursive: true, force: true });
}
