import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const verifierUrl = new URL("../scripts/verify-production-data-protection.sh", import.meta.url);

async function verifier() {
  return readFile(verifierUrl, "utf8");
}

test("production data protection verifier covers durable customer and billing replay state", async () => {
  const source = await verifier();
  assert.match(source, /ApiAccountsTable/);
  assert.match(source, /ApiKeysTable/);
  assert.match(source, /ApiCustomerAuthTable/);
  assert.match(source, /ApiSubscriptionEventsTable/);
  assert.match(source, /describe-table/);
  assert.match(source, /describe-continuous-backups/);
  assert.match(source, /PointInTimeRecoveryStatus == \"ENABLED\"/);
  assert.match(source, /EarliestRestorableDateTime/);
  assert.match(source, /LatestRestorableDateTime/);
  assert.match(source, /SSEDescription\.Status == \"ENABLED\"/);
});

test("production data protection verifier fails closed on non-production stack names", async () => {
  const source = await verifier();
  assert.match(source, /STACK_NAME.*prod.*production/);
  assert.match(source, /STACK_NAME.*!= \*test\*/);
});

test("production data protection verifier cannot mutate or restore production resources", async () => {
  const source = await verifier();
  assert.doesNotMatch(source, /aws\s+(?:dynamodb|cloudformation)\s+(?:update|create|delete|restore|put)/);
  assert.doesNotMatch(source, /sam\s+deploy/);
  assert.doesNotMatch(source, /restore-table-to-point-in-time/);
  assert.doesNotMatch(source, /update-continuous-backups/);
  assert.match(source, /separately approved recovery action/);
});
