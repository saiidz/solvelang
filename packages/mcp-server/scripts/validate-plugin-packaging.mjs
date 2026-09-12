import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

async function readJson(path) {
  const text = await readFile(resolve(root, path), "utf8");
  return JSON.parse(text);
}

const packageJson = await readJson("packages/mcp-server/package.json");
const codex = await readJson("plugins/solvelang/.codex-plugin/plugin.json");
const claude = await readJson("plugins/solvelang/.claude-plugin/plugin.json");
const mcp = await readJson("plugins/solvelang/.mcp.json");
const codexMarketplace = await readJson(".agents/plugins/marketplace.json");
const claudeMarketplace = await readJson(".claude-plugin/marketplace.json");

assert.equal(packageJson.name, "@solvelang/mcp-server");
assert.match(packageJson.version, /^\d+\.\d+\.\d+$/);

for (const [label, manifest] of [["Codex", codex], ["Claude", claude]]) {
  assert.equal(manifest.name, "solvelang", `${label} plugin name drifted`);
  assert.equal(manifest.version, packageJson.version, `${label} plugin version must match MCP package version`);
  assert.equal(manifest.description?.length > 0, true, `${label} plugin description is required`);
  assert.equal(manifest.author?.name, "SolveLang", `${label} plugin author is required`);
  assert.equal(manifest.repository, "https://github.com/saiidz/solvelang", `${label} repository drifted`);
  assert.equal(manifest.license, "MIT", `${label} license drifted`);
  assert.equal(manifest.mcpServers, "./.mcp.json", `${label} MCP manifest path drifted`);
}

assert.equal(codex.skills, "./skills/");
assert.equal(codex.interface?.displayName, "SolveLang");
assert.equal(codex.interface?.category, "Developer Tools");
assert.deepEqual(codex.interface?.capabilities, ["Interactive", "Read"]);
assert.ok(Array.isArray(codex.interface?.defaultPrompt) && codex.interface.defaultPrompt.length > 0);

assert.deepEqual(mcp, {
  mcpServers: {
    solvelang: {
      command: "npx",
      args: ["--yes", `@solvelang/mcp-server@${packageJson.version}`],
    },
  },
});

assert.equal(codexMarketplace.name, "solvelang");
assert.equal(codexMarketplace.plugins?.length, 1);
assert.equal(codexMarketplace.plugins[0].name, "solvelang");
assert.deepEqual(codexMarketplace.plugins[0].source, { source: "local", path: "./plugins/solvelang" });
assert.deepEqual(codexMarketplace.plugins[0].policy?.products, ["CODEX"]);
assert.equal(codexMarketplace.plugins[0].policy?.installation, "AVAILABLE");

assert.equal(claudeMarketplace.name, "solvelang");
assert.equal(claudeMarketplace.plugins?.length, 1);
assert.equal(claudeMarketplace.plugins[0].name, "solvelang");
assert.equal(claudeMarketplace.plugins[0].version, packageJson.version);
assert.equal(claudeMarketplace.plugins[0].source, "./plugins/solvelang");

for (const path of [
  "plugins/solvelang/README.md",
  "plugins/solvelang/LICENSE",
  "plugins/solvelang/skills/solvelang-workflow-review/SKILL.md",
]) {
  const text = await readFile(resolve(root, path), "utf8");
  assert.ok(text.trim().length > 0, `${path} must not be empty`);
}

console.log(`SolveLang Codex/Claude plugin packaging PASS at MCP version ${packageJson.version}`);
