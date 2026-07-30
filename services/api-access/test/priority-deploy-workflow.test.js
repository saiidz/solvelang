import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-priority-queue.yml", import.meta.url);
async function workflow() { return await readFile(workflowUrl, "utf8"); }

test("priority deployment is protected, manual, main-only, server-only, and test-only", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-test/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /PriorityQueueMode="test"/);
  assert.doesNotMatch(source, /priority-queue-production/);
  assert.doesNotMatch(source, /PriorityQueueMode="live"|SITE_ORIGIN/);
});

test("canary deployment proves all four weighted worker lanes and empty failure queues", async () => {
  const source = await workflow();
  assert.match(source, /submit standard/);
  assert.match(source, /submit express/);
  assert.match(source, /submit priority/);
  assert.match(source, /submit critical/);
  assert.match(source, /standard 1/);
  assert.match(source, /express 2/);
  assert.match(source, /priority 5/);
  assert.match(source, /critical 10/);
  assert.match(source, /\.result\.capacityWeight/);
  assert.match(source, /PriorityDispatchFailureQueueUrl/);
  assert.match(source, /StandardDeadLetterQueueUrl/);
  assert.match(source, /ApproximateNumberOfMessagesNotVisible/);
});
