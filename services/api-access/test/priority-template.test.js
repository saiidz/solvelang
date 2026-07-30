import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateUrl = new URL("../priority-template.yaml", import.meta.url);
async function template() { return await readFile(templateUrl, "utf8"); }

test("priority stack defaults off and remains isolated from customer billing", async () => {
  const source = await template();
  assert.match(source, /PriorityQueueEnabled:[\s\S]*Default: "false"/);
  assert.match(source, /AllowedValues: \[test\]/);
  assert.match(source, /Condition: PriorityQueueIsEnabled/);
  assert.doesNotMatch(source, /StripeSecretKey|CustomerAccountsEnabled|ApiKeyPepper/);
});

test("priority stack has encrypted dedicated lanes, DLQs, and weighted concurrency", async () => {
  const source = await template();
  for (const lane of ["Standard", "Express", "Priority", "Critical"]) {
    assert.match(source, new RegExp(`${lane}Queue:`));
    assert.match(source, new RegExp(`${lane}DeadLetterQueue:`));
  }
  assert.equal((source.match(/SqsManagedSseEnabled: true/g) ?? []).length, 8);
  assert.match(source, /ReservedConcurrentExecutions: 1/);
  assert.match(source, /ReservedConcurrentExecutions: 2/);
  assert.match(source, /ReservedConcurrentExecutions: 5/);
  assert.match(source, /ReservedConcurrentExecutions: 10/);
  assert.match(source, /MaximumConcurrency: 2/);
  assert.match(source, /MaximumConcurrency: 5/);
  assert.match(source, /MaximumConcurrency: 10/);
  assert.doesNotMatch(source, /MaximumConcurrency: 1/);
});
