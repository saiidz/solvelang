import assert from "node:assert/strict";
import test from "node:test";
import { QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoSupportAutomationStore } from "../src/support-automation-store.js";

function clientWith(handler) {
  return { calls: [], async send(command) { this.calls.push(command); return handler(command, this.calls.length - 1); } };
}

test("active worker discovery uses the dedicated state index instead of table scan", async () => {
  const client = clientWith((command) => {
    assert.ok(command instanceof QueryCommand);
    return { Items: [{ recordType: "CONFIG", automationState: "ACTIVE", accountId: "acct_a" }] };
  });
  const store = createDynamoSupportAutomationStore(client, "support-table");
  const configs = await store.listActiveConfigs(10);
  assert.equal(configs.length, 1);
  const input = client.calls[0].input;
  assert.equal(input.IndexName, "AutomationStateIndex");
  assert.equal(input.KeyConditionExpression, "workerPartition = :active");
  assert.equal(input.ExpressionAttributeValues[":active"], "ACTIVE");
  assert.equal(input.Limit, 10);
});

test("resume publishes active-index keys and pause removes them atomically with revision check", async () => {
  const client = clientWith((command) => {
    assert.ok(command instanceof UpdateCommand);
    return { Attributes: { revision: 2 } };
  });
  const store = createDynamoSupportAutomationStore(client, "support-table");
  await store.setState("acct_a", 1, "ACTIVE", "2026-09-13T22:00:00Z");
  await store.setState("acct_a", 2, "PAUSED", "2026-09-13T22:01:00Z");
  const active = client.calls[0].input;
  assert.match(active.UpdateExpression, /workerPartition = :active/);
  assert.match(active.UpdateExpression, /workerSort = :accountId/);
  assert.equal(active.ExpressionAttributeValues[":accountId"], "acct_a");
  assert.equal(active.ConditionExpression, "revision = :expected");
  const paused = client.calls[1].input;
  assert.match(paused.UpdateExpression, /REMOVE workerPartition, workerSort/);
  assert.equal(paused.ConditionExpression, "revision = :expected");
});

test("revocation removes both credential references and worker index keys", async () => {
  const client = clientWith(() => ({ Attributes: { automationState: "REVOKED", revision: 3 } }));
  const store = createDynamoSupportAutomationStore(client, "support-table");
  await store.revokeConfig("acct_a", 2, "2026-09-13T22:02:00Z");
  const input = client.calls[0].input;
  assert.match(input.UpdateExpression, /gmailCredentialSecretArn/);
  assert.match(input.UpdateExpression, /linearCredentialSecretArn/);
  assert.match(input.UpdateExpression, /workerPartition/);
  assert.match(input.UpdateExpression, /workerSort/);
});
