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
const claudeDirectory = await readJson("plugins/solvelang-claude/.claude-plugin/plugin.json");
const claudeDirectoryMcp = await readJson("plugins/solvelang-claude/.mcp.json");
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
assert.ok(codex.interface.shortDescription.length <= 30, "Codex short description must fit public-directory limit");
assert.equal(codex.interface.websiteURL, "https://www.solve-lang.com");
assert.equal(codex.interface.privacyPolicyURL, "https://www.solve-lang.com/privacy-policy/");
assert.equal(codex.interface.termsOfServiceURL, "https://www.solve-lang.com/terms/");
assert.equal(codex.interface.supportURL, "https://www.solve-lang.com/support/");
assert.equal(codex.interface.logo, "./assets/solvelang-mark.svg");
assert.equal(codex.interface.composerIcon, "./assets/solvelang-mark.svg");

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
assert.equal(claudeMarketplace.plugins[0].version, "0.3.1");
assert.equal(claudeMarketplace.plugins[0].displayName, "SolveLang");
assert.equal(claudeMarketplace.plugins[0].source, "./plugins/solvelang-claude");
assert.equal(claudeMarketplace.plugins[0].homepage, "https://www.solve-lang.com/mcp/");

assert.equal(claudeDirectory.name, "solvelang");
assert.equal(claudeDirectory.displayName, "SolveLang");
assert.equal(claudeDirectory.version, "0.3.1");
assert.equal(claudeDirectory.author?.name, "SolveLang");
assert.equal(claudeDirectory.repository, "https://github.com/saiidz/solvelang");
assert.equal(claudeDirectory.license, "MIT");
assert.equal(claudeDirectory.mcpServers, "./.mcp.json");
assert.deepEqual(claudeDirectoryMcp, {
  mcpServers: {
    solvelang: {
      type: "http",
      url: "https://mcp.solve-lang.com/mcp",
    },
  },
});

for (const path of [
  "plugins/solvelang/README.md",
  "plugins/solvelang/LICENSE",
  "plugins/solvelang/skills/solvelang-workflow-review/SKILL.md",
  "plugins/solvelang/assets/solvelang-mark.svg",
  "plugins/solvelang-claude/README.md",
  "plugins/solvelang-claude/LICENSE",
  "plugins/solvelang-claude/skills/solvelang-workflow-review/SKILL.md",
]) {
  const text = await readFile(resolve(root, path), "utf8");
  assert.ok(text.trim().length > 0, `${path} must not be empty`);
}

const skill = await readFile(
  resolve(root, "plugins/solvelang/skills/solvelang-workflow-review/SKILL.md"),
  "utf8",
);
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
assert.ok(frontmatter, "Codex skill must start with YAML frontmatter");
assert.match(frontmatter[1], /^name:\s*solvelang-workflow-review\s*$/m, "Codex skill frontmatter must declare the exact skill name");
assert.match(frontmatter[1], /^description:\s*\S.+$/m, "Codex skill frontmatter must include a non-empty description");

const claudeDirectoryReadme = await readFile(resolve(root, "plugins/solvelang-claude/README.md"), "utf8");
assert.ok(
  claudeDirectoryReadme
    .replace(/```[\s\S]*?```/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length >= 40,
  "Claude directory README must contain at least 40 non-code words",
);
const claudeDirectorySkill = await readFile(
  resolve(root, "plugins/solvelang-claude/skills/solvelang-workflow-review/SKILL.md"),
  "utf8",
);
assert.match(claudeDirectorySkill, /^---\n[\s\S]*?\n---\n/, "Claude directory skill must start with YAML frontmatter");
assert.doesNotMatch(claudeDirectorySkill, /call `solvelang_validate_solve`/i, "Public Claude skill must not instruct unavailable local .solve validation");
assert.match(claudeDirectorySkill, /public Claude connector/i, "Public Claude skill must disclose the remote-only boundary");

console.log(`SolveLang Codex/Claude plugin packaging PASS at MCP version ${packageJson.version}`);
