import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, "../..");

async function read(path) {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

function section(text, key, indent = 0) {
  const lines = text.split(/\r?\n/);
  const prefix = " ".repeat(indent);
  const start = lines.findIndex((line) => line === `${prefix}${key}:` || line.startsWith(`${prefix}${key}: `));
  assert.notEqual(start, -1, `missing YAML section ${key}`);

  const collected = [lines[start]];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.trim() === "") {
      collected.push(line);
      continue;
    }
    const leading = line.length - line.trimStart().length;
    if (leading <= indent) break;
    collected.push(line);
  }
  return collected.join("\n");
}

function assertRequiredWorkflow(workflow, entry) {
  const onBlock = section(workflow, "on", 0);
  const pullRequest = section(onBlock, "pull_request", 2);
  assert.doesNotMatch(pullRequest, /^\s+paths(?:-ignore)?:/m, `${entry.workflow} is path-filtered and cannot be globally required`);

  const jobsBlock = section(workflow, "jobs", 0);
  const jobBlock = section(jobsBlock, entry.jobId, 2);
  assert.match(jobBlock, new RegExp(`^\\s{4}name:\\s*["']?${escapeRegExp(entry.checkName)}["']?\\s*$`, "m"), `${entry.workflow} job ${entry.jobId} must expose stable check name ${entry.checkName}`);
}

function assertConditionalWorkflow(workflow, entry) {
  const onBlock = section(workflow, "on", 0);
  const pullRequest = section(onBlock, "pull_request", 2);
  assert.match(pullRequest, /^\s+paths(?:-ignore)?:/m, `${entry.workflow} is listed as conditional but is not path-filtered`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const contract = JSON.parse(await read("ops/governance/main-protection-contract.json"));
assert.equal(contract.schema, "solvelang.main-protection.v1");
assert.equal(contract.targetBranch, "main");
assert.equal(contract.intendedRuleset?.requirePullRequest, true);
assert.equal(contract.intendedRuleset?.requiredApprovals, 0);
assert.equal(contract.intendedRuleset?.requireConversationResolution, true);
assert.equal(contract.intendedRuleset?.requireStatusChecks, true);
assert.equal(contract.intendedRuleset?.requireBranchesUpToDate, true);
assert.equal(contract.intendedRuleset?.blockDeletion, true);
assert.equal(contract.intendedRuleset?.blockNonFastForward, true);

const checkNames = contract.requiredStatusChecks.map((entry) => entry.checkName);
assert.equal(new Set(checkNames).size, checkNames.length, "required check names must be unique");
assert.ok(checkNames.length >= 4, "expected the four always-on repository checks");

for (const entry of contract.requiredStatusChecks) {
  assertRequiredWorkflow(await read(entry.workflow), entry);
}
for (const entry of contract.conditionalStatusChecks) {
  assertConditionalWorkflow(await read(entry.workflow), entry);
}

console.log(`Main protection contract valid: ${checkNames.join(", ")}`);
