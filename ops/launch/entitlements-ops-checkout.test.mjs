import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const workflowPath = path.join(repositoryRoot, ".github/workflows/entitlements-ci.yml");

let workflowPromise;
function readWorkflow() {
  workflowPromise ??= readFile(workflowPath, "utf8");
  return workflowPromise;
}

test("entitlements CI checks out the private ops repo with the deploy-key secret", async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /repository:\s*saiidz\/solvelang-ops/);
  assert.match(workflow, /ssh-key:\s*\$\{\{\s*secrets\.OPS_REPO_DEPLOY_KEY\s*\}\}/);
  assert.match(workflow, /path:\s*solvelang-ops/);
});

test("the ops checkout lands before the gate step and feeds SOLVELANG_OPS_ROOT", async () => {
  const workflow = await readWorkflow();
  const checkoutAt = workflow.indexOf("repository: saiidz/solvelang-ops");
  const gateAt = workflow.indexOf("Assert entitlement launch code gates");
  assert.ok(checkoutAt >= 0, "ops checkout step is present");
  assert.ok(gateAt > checkoutAt, "ops checkout must precede the gate step");
  assert.match(workflow, /SOLVELANG_OPS_ROOT:\s*\$\{\{\s*github\.workspace\s*\}\}\/solvelang-ops/);
});

test("the gate step runs this regression test alongside the launch-control tests", async () => {
  const workflow = await readWorkflow();
  assert.match(workflow, /node --test ops\/launch\/launch-control\.test\.mjs ops\/launch\/entitlements-ops-checkout\.test\.mjs/);
});

test("the workflow carries no private key material", async () => {
  const workflow = await readWorkflow();
  assert.equal(workflow.includes("PRIVATE KEY-----"), false);
});
