import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Release 0.4.0 (QA for the release-mechanics root): pin the single-bin
// shape that makes the bare npx form work, the version lockstep across the
// registry/plugin surfaces, and the audited dependency floor that cleared
// the published 0.3.0 advisories.

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = path.resolve(packageRoot, "../..");

function readJson(fromRoot: string, relativePath: string): Record<string, any> {
  return JSON.parse(readFileSync(path.join(fromRoot, relativePath), "utf8")) as Record<string, any>;
}

function gte(version: string, floor: string): boolean {
  const a = version.split(".").map(Number);
  const b = floor.split(".").map(Number);
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return true;
}

test("0.4.0 package ships exactly one bin so bare npx can choose it", () => {
  const pkg = readJson(packageRoot, "package.json");
  assert.equal(pkg.version, "0.4.0");
  assert.deepEqual(pkg.bin, { "solvelang-mcp": "dist/src/index.js" });
});

test("registry and plugin surfaces track 0.4.0 in lockstep", () => {
  const server = readJson(packageRoot, "server.json");
  assert.equal(server.version, "0.4.0");
  assert.equal(server.packages[0].version, "0.4.0");
  const candidate = readJson(packageRoot, "release-candidate.json");
  assert.equal(candidate.candidateVersion, "0.4.0");
  assert.equal(candidate.publishedVersion, "0.3.0");
  for (const rel of [".codex-plugin/plugin.json", ".claude-plugin/plugin.json"]) {
    const plugin = readJson(path.join(repoRoot, "plugins/solvelang"), rel);
    assert.equal(plugin.version, "0.4.0", `${rel} tracks the release version`);
  }
  const mcp = readJson(path.join(repoRoot, "plugins/solvelang"), ".mcp.json");
  assert.deepEqual(mcp.mcpServers.solvelang.args, [
    "-y",
    "--package",
    "@solvelang/mcp-server@0.4.0",
    "solvelang-mcp",
  ]);
});

test("dependency floor that cleared the 0.3.0 advisories holds in the lock", () => {
  const pkg = readJson(packageRoot, "package.json");
  assert.equal(pkg.dependencies["@modelcontextprotocol/sdk"], "1.32.2");
  assert.equal(pkg.dependencies.zod, "4.6.7");
  const lock = readJson(packageRoot, "package-lock.json");
  assert.equal(lock.version, "0.4.0");
  const honoNode = lock.packages["node_modules/@hono/node-server"];
  assert.ok(honoNode, "lock carries @hono/node-server");
  assert.ok(
    gte(honoNode.version, "2.1.6"),
    `@hono/node-server ${honoNode.version} must be >= 2.1.6 (GHSA-qv5m-9pm6-hqp3 / GHSA-jpvv-r467-5p4w floor)`,
  );
});
