import assert from "node:assert/strict";
import test from "node:test";
import { GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoSupportAutomationStore, supportAutomationStoreInternals } from "../src/support-automation-store.js";

function clientWith(handler) { return { calls: [], async send(command) { this.calls.push(command); return handler(command, this.calls.length - 1); } }; }

test("active worker discovery uses the dedicated state index instead of table scan", async () => {
  const client = clientWith((command) => { assert.ok(command instanceof QueryCommand); return { Items: [{ recordType: "CONFIG", automationState: "ACTIVE", accountId: "acct_a" }] }; });
  const store = createDynamoSupportAutomationStore(client, "support-table");
  const configs = await store.listActiveConfigs(10);
  assert.equal(configs.length, 1);
  const input = client.calls[0].input;
  assert.equal(input.IndexName, "AutomationStateIndex"); assert.equal(input.KeyConditionExpression, "workerPartition = :active"); assert.equal(input.ExpressionAttributeValues[":active"], "ACTIVE"); assert.equal(input.Limit, 10);
});

test("resume publishes active-index keys and pause removes them atomically with revision check", async () => {
  const client = clientWith((command) => { assert.ok(command instanceof UpdateCommand); return { Attributes: { revision: 2 } }; });
  const store = createDynamoSupportAutomationStore(client, "support-table");
  await store.setState("acct_a", 1, "ACTIVE", "2026-09-13T22:00:00Z"); await store.setState("acct_a", 2, "PAUSED", "2026-09-13T22:01:00Z");
  const active = client.calls[0].input; assert.match(active.UpdateExpression, /workerPartition = :active/); assert.match(active.UpdateExpression, /workerSort = :accountId/); assert.equal(active.ExpressionAttributeValues[":accountId"], "acct_a"); assert.equal(active.ConditionExpression, "revision = :expected");
  const paused = client.calls[1].input; assert.match(paused.UpdateExpression, /REMOVE workerPartition, workerSort/); assert.equal(paused.ConditionExpression, "revision = :expected");
});

test("revocation removes both credential references and worker index keys", async () => {
  const client = clientWith(() => ({ Attributes: { automationState: "REVOKED", revision: 3 } }));
  const store = createDynamoSupportAutomationStore(client, "support-table");
  await store.revokeConfig("acct_a", 2, "2026-09-13T22:02:00Z");
  const input = client.calls[0].input; assert.match(input.UpdateExpression, /gmailCredentialSecretArn/); assert.match(input.UpdateExpression, /linearCredentialSecretArn/); assert.match(input.UpdateExpression, /workerPartition/); assert.match(input.UpdateExpression, /workerSort/);
});

test("expired processing event can be reclaimed only from the exact previous lease", async () => {
  const conditional = Object.assign(new Error("exists"), { name: "ConditionalCheckFailedException" });
  const existing = { pk: "ACCOUNT#acct_a", sk: "EVENT#gmail:m1", state: "PROCESSING", claimId: "old_claim", processingUntil: "2026-09-13T21:59:00.000Z" };
  const client = clientWith((command, index) => {
    if (index === 0) { assert.ok(command instanceof PutCommand); throw conditional; }
    if (index === 1) { assert.ok(command instanceof GetCommand); return { Item: existing }; }
    assert.ok(command instanceof UpdateCommand); return { Attributes: { ...existing, claimId: "new_claim", processingUntil: "2026-09-13T22:05:00.000Z" } };
  });
  const store = createDynamoSupportAutomationStore(client, "support-table");
  const result = await store.claimEvent({ accountId: "acct_a", eventId: "gmail:m1", providerMessageHash: "hash", claimId: "new_claim", processingUntil: "2026-09-13T22:05:00.000Z", createdAt: "2026-09-13T21:58:00.000Z", updatedAt: "2026-09-13T22:00:00.000Z" });
  assert.equal(result.created, true); assert.equal(result.reclaimed, true);
  const reclaim = client.calls[2].input; assert.match(reclaim.ConditionExpression, /claimId = :previousClaimId/); assert.match(reclaim.ConditionExpression, /processingUntil = :previousProcessingUntil/); assert.equal(reclaim.ExpressionAttributeValues[":previousClaimId"], "old_claim");
});

test("event and action records receive a bounded retention TTL while config is durable", async () => {
  const client = clientWith((command) => command instanceof QueryCommand ? { Items: [] } : {});
  const store = createDynamoSupportAutomationStore(client, "support-table");
  const createdAt = "2026-09-13T22:00:00.000Z";
  await store.claimEvent({ accountId: "acct_a", eventId: "gmail:m1", providerMessageHash: "hash", claimId: "event_claim", processingUntil: "2026-09-13T22:05:00.000Z", createdAt, updatedAt: createdAt });
  await store.claimAction({ accountId: "acct_a", eventId: "gmail:m1", actionId: "gmail_reply", createdAt, claimId: "action_claim" });
  const expected = Math.floor(Date.parse(createdAt) / 1000) + supportAutomationStoreInternals.RETENTION_SECONDS;
  assert.equal(client.calls[0].input.Item.expiresAt, expected);
  assert.equal(client.calls[1].input.Item.expiresAt, expected);
  assert.equal(client.calls[1].input.Item.sk, "ACTION#gmail:m1#gmail_reply");
  assert.equal(supportAutomationStoreInternals.RETENTION_SECONDS, 45 * 24 * 60 * 60);
});
