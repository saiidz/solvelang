import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "..");
const repositoryRoot = resolve(packageRoot, "../..");

async function readJson(path) {
  return JSON.parse(await readFile(resolve(repositoryRoot, path), "utf8"));
}

function semverTuple(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value);
  assert.ok(match, `expected stable semantic version, got ${value}`);
  return match.slice(1).map(Number);
}

function isGreaterVersion(candidate, published) {
  const left = semverTuple(candidate);
  const right = semverTuple(published);
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] > right[index];
  }
  return false;
}

const candidate = await readJson("packages/mcp-server/release-candidate.json");
const packageManifest = await readJson("packages/mcp-server/package.json");
const packageLock = await readJson("packages/mcp-server/package-lock.json");
const codexPlugin = await readJson("plugins/solvelang/.codex-plugin/plugin.json");
const claudePlugin = await readJson("plugins/solvelang/.claude-plugin/plugin.json");
const mcpManifest = await readJson("plugins/solvelang/.mcp.json");
const claudeMarketplace = await readJson(".claude-plugin/marketplace.json");
const releaseWorkflow = await readFile(resolve(repositoryRoot, ".github/workflows/npm-release.yml"), "utf8");

assert.equal(candidate.schema, "solvelang.mcp.release-candidate.v1");
assert.equal(
  ["selected-not-published", "release-ready-not-published"].includes(candidate.state),
  true,
  `unsupported release-candidate state ${candidate.state}`,
);
assert.equal(candidate.publicationAuthorized, false, "repository state must never grant publication authority");
assert.equal(isGreaterVersion(candidate.candidateVersion, candidate.publishedVersion), true, "candidate version must advance the published line");

const releaseReady = candidate.state === "release-ready-not-published";
const expectedDistributionVersion = releaseReady ? candidate.candidateVersion : candidate.publishedVersion;
assert.equal(
  candidate.publicPluginTracksPublishedVersion,
  !releaseReady,
  "public-plugin tracking flag must match the selected vs held-release state",
);

assert.equal(packageManifest.version, expectedDistributionVersion, "package metadata version drifted from the release state");
assert.equal(packageLock.version, expectedDistributionVersion, "lockfile root version drifted from the release state");
assert.equal(packageLock.packages?.[""]?.version, expectedDistributionVersion, "lockfile package version drifted from the release state");

for (const [label, plugin] of [["Codex", codexPlugin], ["Claude", claudePlugin]]) {
  assert.equal(plugin.version, expectedDistributionVersion, `${label} plugin version drifted from the release state`);
}
assert.equal(claudeMarketplace.plugins?.[0]?.version, expectedDistributionVersion, "Claude marketplace version drifted from the release state");

const pin = mcpManifest.mcpServers?.solvelang?.args?.[1];
assert.equal(pin, `@solvelang/mcp-server@${expectedDistributionVersion}`, "canonical plugin MCP pin drifted from the release state");

// Preserve the fail-closed publishing boundary in every repository state. A release-ready
// branch prepares exact artifacts but still does not create publication authority.
assert.match(releaseWorkflow, /release:\s*\n\s*types:\s*\n\s*- published/);
assert.match(releaseWorkflow, /vars\.NPM_SCOPE_OWNERSHIP_VERIFIED == 'true'/);
assert.match(releaseWorkflow, /environment:\s*npm-production/);
assert.match(releaseWorkflow, /RELEASE_TAG/);
assert.match(releaseWorkflow, /test \"\$RELEASE_TAG\" = \"v\$\(node -p/);
assert.match(releaseWorkflow, /npm test/);
assert.match(releaseWorkflow, /npm run test:packed/);
assert.match(releaseWorkflow, /npm publish --access public/);
assert.doesNotMatch(releaseWorkflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);

console.log(
  releaseReady
    ? `SolveLang MCP ${candidate.candidateVersion} RELEASE-READY on held branch; published line remains ${candidate.publishedVersion}; publication remains unauthorized.`
    : `SolveLang MCP release candidate ${candidate.candidateVersion} SELECTED; published/plugin line remains ${candidate.publishedVersion}; publication remains unauthorized.`,
);
