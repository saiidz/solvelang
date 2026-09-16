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
assert.equal(candidate.state, "selected-not-published");
assert.equal(candidate.publicationAuthorized, false, "candidate selection must not grant publication authority");
assert.equal(candidate.publicPluginTracksPublishedVersion, true);
assert.equal(isGreaterVersion(candidate.candidateVersion, candidate.publishedVersion), true, "candidate version must advance the published line");

// Until publication is separately authorized and executed, package/lock/plugin metadata must
// continue to describe the actually published line. The selected next version lives only in
// the release-candidate record and release notes.
assert.equal(packageManifest.version, candidate.publishedVersion, "package metadata must remain on the published line before release finalization");
assert.equal(packageLock.version, candidate.publishedVersion, "lockfile root version must remain on the published line before release finalization");
assert.equal(packageLock.packages?.[""]?.version, candidate.publishedVersion, "lockfile package version must remain on the published line before release finalization");

for (const [label, plugin] of [["Codex", codexPlugin], ["Claude", claudePlugin]]) {
  assert.equal(plugin.version, candidate.publishedVersion, `${label} public plugin must track the published package line`);
}
assert.equal(claudeMarketplace.plugins?.[0]?.version, candidate.publishedVersion, "Claude marketplace metadata must track the published package line");

const pin = mcpManifest.mcpServers?.solvelang?.args?.[1];
assert.equal(pin, `@solvelang/mcp-server@${candidate.publishedVersion}`, "canonical plugin must pin the actually published MCP package");

// Preserve the existing fail-closed publishing boundary. Selecting a candidate must never
// create a second publish path or turn repository merge into publication authority.
assert.match(releaseWorkflow, /release:\s*\n\s*types:\s*\n\s*- published/);
assert.match(releaseWorkflow, /vars\.NPM_SCOPE_OWNERSHIP_VERIFIED == 'true'/);
assert.match(releaseWorkflow, /environment:\s*npm-production/);
assert.match(releaseWorkflow, /RELEASE_TAG/);
assert.match(releaseWorkflow, /test \"\$RELEASE_TAG\" = \"v\$\(node -p/);
assert.match(releaseWorkflow, /npm test/);
assert.match(releaseWorkflow, /npm run test:packed/);
assert.match(releaseWorkflow, /npm publish --access public/);
assert.doesNotMatch(releaseWorkflow, /NPM_TOKEN|NODE_AUTH_TOKEN/);

console.log(`SolveLang MCP release candidate ${candidate.candidateVersion} SELECTED; published/plugin line remains ${candidate.publishedVersion}; publication remains unauthorized.`);
