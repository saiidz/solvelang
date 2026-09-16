import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, "..");
const repositoryRoot = path.resolve(packageRoot, "../..");

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
  assert.notEqual(first, -1, `${path.relative(repositoryRoot, filePath)} is missing expected version marker ${from}`);
  assert.equal(text.indexOf(from, first + from.length), -1, `${path.relative(repositoryRoot, filePath)} has an ambiguous duplicate version marker`);
  await writeFile(filePath, text.replace(from, to), "utf8");
}

function assertStableVersion(value, label) {
  assert.match(value, /^\d+\.\d+\.\d+$/, `${label} must be a stable semantic version`);
}

const candidate = await readJson(path.join(packageRoot, "release-candidate.json"));
const checkedInPackage = await readJson(path.join(packageRoot, "package.json"));

assert.equal(candidate.schema, "solvelang.mcp.release-candidate.v1");
assert.equal(candidate.state, "selected-not-published");
assert.equal(candidate.publicationAuthorized, false, "distribution rehearsal must not grant publication authority");
assert.equal(candidate.publicPluginTracksPublishedVersion, true);
assertStableVersion(candidate.publishedVersion, "published version");
assertStableVersion(candidate.candidateVersion, "candidate version");
assert.notEqual(candidate.candidateVersion, candidate.publishedVersion);
assert.equal(checkedInPackage.version, candidate.publishedVersion, "checked-in package must remain on the actually published line before release finalization");

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "solvelang-distribution-finalization-"));
try {
  const stagedRoot = path.join(temporaryRoot, "repository");
  const stagedPackageRoot = path.join(stagedRoot, "packages", "mcp-server");
  const stagedPluginRoot = path.join(stagedRoot, "plugins", "solvelang");

  await mkdir(path.dirname(stagedPackageRoot), { recursive: true });
  await cp(packageRoot, stagedPackageRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(packageRoot, source);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      return !parts.includes("node_modules") && !relative.endsWith(".tgz");
    },
  });
  await mkdir(path.dirname(stagedPluginRoot), { recursive: true });
  await cp(path.join(repositoryRoot, "plugins", "solvelang"), stagedPluginRoot, { recursive: true });

  await mkdir(path.join(stagedRoot, ".agents", "plugins"), { recursive: true });
  await cp(
    path.join(repositoryRoot, ".agents", "plugins", "marketplace.json"),
    path.join(stagedRoot, ".agents", "plugins", "marketplace.json"),
  );
  await mkdir(path.join(stagedRoot, ".claude-plugin"), { recursive: true });
  await cp(
    path.join(repositoryRoot, ".claude-plugin", "marketplace.json"),
    path.join(stagedRoot, ".claude-plugin", "marketplace.json"),
  );

  const stagedPackageManifestPath = path.join(stagedPackageRoot, "package.json");
  const stagedPackageManifest = await readJson(stagedPackageManifestPath);
  stagedPackageManifest.version = candidate.candidateVersion;
  await writeJson(stagedPackageManifestPath, stagedPackageManifest);

  const stagedLockPath = path.join(stagedPackageRoot, "package-lock.json");
  const stagedLock = await readJson(stagedLockPath);
  stagedLock.version = candidate.candidateVersion;
  assert.ok(stagedLock.packages?.[""], "staged lockfile must contain its root package record");
  stagedLock.packages[""].version = candidate.candidateVersion;
  await writeJson(stagedLockPath, stagedLock);

  await replaceExact(
    path.join(stagedPackageRoot, "src", "index.ts"),
    `{ name: "solvelang", version: "${candidate.publishedVersion}" }`,
    `{ name: "solvelang", version: "${candidate.candidateVersion}" }`,
  );
  await replaceExact(
    path.join(stagedPackageRoot, "src", "remote.ts"),
    `{ name: "solvelang-remote", version: "${candidate.publishedVersion}" }`,
    `{ name: "solvelang-remote", version: "${candidate.candidateVersion}" }`,
  );

  for (const manifestPath of [
    path.join(stagedPluginRoot, ".codex-plugin", "plugin.json"),
    path.join(stagedPluginRoot, ".claude-plugin", "plugin.json"),
  ]) {
    const manifest = await readJson(manifestPath);
    assert.equal(manifest.version, candidate.publishedVersion, `${path.basename(path.dirname(manifestPath))} must start from the published line`);
    manifest.version = candidate.candidateVersion;
    await writeJson(manifestPath, manifest);
  }

  const stagedMcpManifestPath = path.join(stagedPluginRoot, ".mcp.json");
  const stagedMcpManifest = await readJson(stagedMcpManifestPath);
  assert.deepEqual(stagedMcpManifest.mcpServers?.solvelang?.args, [
    "--yes",
    `@solvelang/mcp-server@${candidate.publishedVersion}`,
  ], "checked-in plugin must initially pin the published MCP package");
  stagedMcpManifest.mcpServers.solvelang.args[1] = `@solvelang/mcp-server@${candidate.candidateVersion}`;
  await writeJson(stagedMcpManifestPath, stagedMcpManifest);

  const stagedClaudeMarketplacePath = path.join(stagedRoot, ".claude-plugin", "marketplace.json");
  const stagedClaudeMarketplace = await readJson(stagedClaudeMarketplacePath);
  assert.equal(stagedClaudeMarketplace.plugins?.length, 1, "Claude marketplace should contain one reviewed SolveLang plugin");
  assert.equal(stagedClaudeMarketplace.plugins[0].version, candidate.publishedVersion, "Claude marketplace must start from the published line");
  stagedClaudeMarketplace.plugins[0].version = candidate.candidateVersion;
  await writeJson(stagedClaudeMarketplacePath, stagedClaudeMarketplace);

  const stagedCodexMarketplace = await readJson(path.join(stagedRoot, ".agents", "plugins", "marketplace.json"));
  assert.equal(stagedCodexMarketplace.name, "solvelang");
  assert.equal(stagedCodexMarketplace.plugins?.length, 1);
  assert.equal(stagedCodexMarketplace.plugins[0].name, "solvelang");
  assert.deepEqual(stagedCodexMarketplace.plugins[0].source, { source: "local", path: "./plugins/solvelang" });
  assert.equal(stagedCodexMarketplace.plugins[0].policy?.products?.includes("CODEX"), true);

  // Reuse the exact dependency graph already qualified by the checked-in lockfile. Nothing is
  // installed into or modified in the source repository by this rehearsal.
  await symlink(path.join(packageRoot, "node_modules"), path.join(stagedPackageRoot, "node_modules"), "dir");

  await run("npm", ["run", "build"], { cwd: stagedPackageRoot });
  const builtIndex = await readFile(path.join(stagedPackageRoot, "dist", "src", "index.js"), "utf8");
  const builtRemote = await readFile(path.join(stagedPackageRoot, "dist", "src", "remote.js"), "utf8");
  const candidatePattern = new RegExp(`version: ["']${candidate.candidateVersion.replaceAll(".", "\\.")}["']`);
  assert.match(builtIndex, candidatePattern, "staged local MCP runtime must identify as the candidate version");
  assert.match(builtRemote, candidatePattern, "staged remote MCP runtime must identify as the candidate version");

  await run(process.execPath, [path.join(stagedPackageRoot, "scripts", "validate-plugin-packaging.mjs")], {
    cwd: stagedPackageRoot,
  });
  await run(process.execPath, [path.join(stagedPackageRoot, "scripts", "smoke-plugin-roundtrip.mjs")], {
    cwd: stagedPackageRoot,
    env: { ...process.env, npm_config_cache: path.join(temporaryRoot, "npm-cache") },
  });

  // Re-read the staged metadata after the actual roundtrip. The package/plugin/marketplace
  // contract must still agree exactly on the candidate version.
  const finalPackage = await readJson(stagedPackageManifestPath);
  const finalCodex = await readJson(path.join(stagedPluginRoot, ".codex-plugin", "plugin.json"));
  const finalClaude = await readJson(path.join(stagedPluginRoot, ".claude-plugin", "plugin.json"));
  const finalMcp = await readJson(stagedMcpManifestPath);
  const finalClaudeMarketplace = await readJson(stagedClaudeMarketplacePath);
  for (const [label, value] of [
    ["package", finalPackage.version],
    ["Codex plugin", finalCodex.version],
    ["Claude plugin", finalClaude.version],
    ["Claude marketplace", finalClaudeMarketplace.plugins?.[0]?.version],
  ]) {
    assert.equal(value, candidate.candidateVersion, `${label} must remain on the candidate version after roundtrip`);
  }
  assert.equal(
    finalMcp.mcpServers?.solvelang?.args?.[1],
    `@solvelang/mcp-server@${candidate.candidateVersion}`,
    "canonical staged npx pin must target the candidate version",
  );

  console.log(
    `SolveLang full distribution transition ${candidate.publishedVersion} -> ${candidate.candidateVersion} PASS: package, local/remote runtime, Codex plugin, Claude plugin, Claude marketplace, Codex marketplace, npx pin, clean package install, and MCP roundtrip agree; source/public metadata remains unchanged and publication remains unauthorized.`,
  );
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
