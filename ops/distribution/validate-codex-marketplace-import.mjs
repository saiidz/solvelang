import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(here, "../..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

function resolveInsideRepository(relativePath, label) {
  assert.equal(path.isAbsolute(relativePath), false, `${label} must be repository-relative`);
  const resolved = path.resolve(repositoryRoot, relativePath);
  const relative = path.relative(repositoryRoot, resolved);
  assert.equal(relative.startsWith("..") || path.isAbsolute(relative), false, `${label} must stay inside the repository`);
  return resolved;
}

const contract = await readJson("ops/distribution/codex-marketplace-import-contract.json");
assert.equal(contract.schema, "solvelang.codex.marketplace-import.v1");
assert.equal(contract.sourceRepository, "https://github.com/saiidz/solvelang");
assert.equal(contract.sourcePath, "", "root marketplace import must leave Path empty");
assert.equal(contract.recommendedBranch, "main");
assert.equal(contract.marketplaceManifest, ".agents/plugins/marketplace.json");
assert.equal(contract.marketplaceName, "solvelang");
assert.equal(contract.pluginName, "solvelang");
assert.equal(contract.product, "CODEX");
assert.equal(contract.workspacePolicyAuthority, "external-admin", "workspace install/auth policy must remain an external admin control");
assert.equal(contract.workspaceImportImpliesPublicDirectoryPublication, false);
assert.equal(contract.publicDirectoryPublicationAuthorized, false, "repository qualification must not authorize public directory publication");

const marketplace = await readJson(contract.marketplaceManifest);
assert.equal(marketplace.name, contract.marketplaceName);
assert.equal(marketplace.interface?.displayName, "SolveLang");
assert.equal(Array.isArray(marketplace.plugins), true);
assert.equal(marketplace.plugins.length, 1, "SolveLang marketplace should expose exactly one reviewed plugin entry");

const entry = marketplace.plugins[0];
assert.equal(entry.name, contract.pluginName);
assert.deepEqual(entry.source, { source: "local", path: contract.pluginSourcePath });
assert.equal(entry.policy?.products?.includes("CODEX"), true, "marketplace repository intent must include Codex");

const normalizedSource = path.posix.normalize(contract.pluginSourcePath.replaceAll("\\", "/"));
assert.equal(normalizedSource.startsWith("../") || normalizedSource === "..", false, "plugin source must not escape the repository");
const pluginRoot = resolveInsideRepository(normalizedSource, "plugin source");
await access(pluginRoot);

const pluginRelativeRoot = path.relative(repositoryRoot, pluginRoot);
const codexManifest = await readJson(path.join(pluginRelativeRoot, ".codex-plugin", "plugin.json"));
const mcpManifest = await readJson(path.join(pluginRelativeRoot, ".mcp.json"));
const candidate = await readJson("packages/mcp-server/release-candidate.json");
const packageManifest = await readJson("packages/mcp-server/package.json");

assert.equal(codexManifest.name, contract.pluginName);
assert.equal(codexManifest.mcpServers, "./.mcp.json", "Codex plugin must use the reviewed local MCP manifest");
assert.equal(codexManifest.skills, "./skills/", "Codex plugin must expose the reviewed skills directory");
assert.equal(codexManifest.repository, contract.sourceRepository);
assert.equal(codexManifest.license, "MIT");
assert.equal(codexManifest.interface?.displayName, "SolveLang");
assert.equal(codexManifest.interface?.category, "Developer Tools");
assert.equal(codexManifest.interface?.capabilities?.includes("Read"), true);

assert.equal(
  ["selected-not-published", "release-ready-not-published"].includes(candidate.state),
  true,
  `unsupported release-candidate state ${candidate.state}`,
);
assert.equal(candidate.publicationAuthorized, false);
const releaseReady = candidate.state === "release-ready-not-published";
const expectedDistributionVersion = releaseReady ? candidate.candidateVersion : candidate.publishedVersion;
assert.equal(packageManifest.version, expectedDistributionVersion, "package metadata must match the current release state");
assert.equal(codexManifest.version, expectedDistributionVersion, "workspace plugin version must match the current release state");
assert.deepEqual(mcpManifest, {
  mcpServers: {
    solvelang: {
      command: "npx",
      args: ["--yes", `@solvelang/mcp-server@${expectedDistributionVersion}`],
    },
  },
}, "workspace plugin MCP pin must match the current release state");

for (const requiredPath of [
  path.join(pluginRoot, "README.md"),
  path.join(pluginRoot, "LICENSE"),
  path.join(pluginRoot, "skills", "solvelang-workflow-review", "SKILL.md"),
]) {
  await access(requiredPath);
}

const skill = await readFile(path.join(pluginRoot, "skills", "solvelang-workflow-review", "SKILL.md"), "utf8");
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
assert.ok(frontmatter, "Codex skill must start with YAML frontmatter");
assert.match(frontmatter[1], /^name:\s*solvelang-workflow-review\s*$/m);
assert.match(frontmatter[1], /^description:\s*\S.+$/m);

console.log(
  releaseReady
    ? `SolveLang Codex marketplace RELEASE-READY contract PASS at ${expectedDistributionVersion}; recommended workspace import branch remains main and publication remains unauthorized.`
    : `SolveLang Codex GitHub marketplace import contract PASS: source=${contract.sourceRepository}, path=<root>, branch=${contract.recommendedBranch}, plugin=${contract.pluginName}, published MCP=${candidate.publishedVersion}. Workspace import remains separate from public-directory publication.`,
);
