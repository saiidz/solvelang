import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const workflowsDirectory = new URL("../../../.github/workflows/", import.meta.url);
const sharedConcurrencyGroup = "api-access-stack-deployment";

test("all workflows deploying API_ACCESS_STACK_NAME share one non-cancelling concurrency group", async () => {
  const workflowNames = (await readdir(workflowsDirectory)).filter((name) => /\.ya?ml$/.test(name));
  const deploymentWorkflows = [];

  for (const name of workflowNames) {
    const source = await readFile(new URL(name, workflowsDirectory), "utf8");
    if (/API_ACCESS_STACK_NAME/.test(source) && /sam deploy/.test(source)) {
      deploymentWorkflows.push({ name, source });
    }
  }

  assert.deepEqual(
    deploymentWorkflows.map(({ name }) => name).sort(),
    [
      "deploy-api-access-production-customer-accounts.yml",
      "deploy-api-access-production-foundation.yml",
      "deploy-api-access.yml",
    ],
  );

  for (const { name, source } of deploymentWorkflows) {
    assert.match(source, new RegExp(`concurrency:\\n  group: ${sharedConcurrencyGroup}\\n  cancel-in-progress: false`), name);
  }
});
