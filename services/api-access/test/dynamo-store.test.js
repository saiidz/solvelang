import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoApiAccessStore, createDynamoApiKeyAuthorizerStore } from "../src/dynamo-store.js";

class ScriptedClient {
  constructor(steps) {
    this.steps = [...steps];
    this.commands = [];
  }

  async send(command) {
    this.commands.push(command);
    const step = this.steps.shift();
    if (!step) throw new Error(`Unexpected ${command.constructor.name}.`);
    if (step.command) assert.equal(command.constructor.name, step.command);
    if (step.inspect) step.inspect(command.input);
    if (step.error) throw step.error;
    return step.result ?? {};
  }
}

const tables = {
  accountsTable: "accounts",
  keysTable: "keys",
  keysAccountIndex: "AccountIdIndex",
  usageTable: "usage",
  idempotencyTable: "idempotency",
};

function transactionCanceled() {
  return Object.assign(new Error("transaction canceled"), { name: "TransactionCanceledException" });
}

test("subscription updates preserve the atomic active-key counter", async () => {
  const client = new ScriptedClient([{
    command: "UpdateCommand",
    inspect(input) {
      assert.equal(input.TableName, "accounts");
      assert.match(input.UpdateExpression, /activeKeyCount = if_not_exists\(activeKeyCount, :zero\)/);
      assert.match(input.UpdateExpression, /REMOVE graceUntil/);
      assert.equal(input.ExpressionAttributeValues[":zero"], 0);
    },
  }]);
  const store = createDynamoApiAccessStore(client, tables);
  await store.putAccount({
    accountId: "acct_1",
    email: "dev@example.com",
    plan: "pro",
    subscriptionStatus: "active",
    currentPeriodEnd: 1_800_000_000_000,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    updatedAt: "2026-07-28T12:00:00.000Z",
  });
  assert.equal(client.steps.length, 0);
});

test("atomic key issuance classifies a reached limit after strong reads", async () => {
  const client = new ScriptedClient([
    { command: "TransactWriteCommand", error: transactionCanceled() },
    { command: "GetCommand", result: {} },
    { command: "GetCommand", result: { Item: { accountId: "acct_1", activeKeyCount: 2 } } },
  ]);
  const store = createDynamoApiAccessStore(client, tables);
  const result = await store.putKeyWithLimit({ keyId: "key_1", accountId: "acct_1" }, 2);
  assert.equal(result, "limit_reached");
});

test("usage cancellation is quota exhaustion only when strong state proves it", async () => {
  const client = new ScriptedClient([
    { command: "TransactWriteCommand", error: transactionCanceled() },
    { command: "GetCommand", result: {} },
    { command: "GetCommand", result: { Item: { used: 1_000 } } },
  ]);
  const store = createDynamoApiKeyAuthorizerStore(client, tables);
  const result = await store.consumeUsage({
    accountId: "acct_1",
    period: "2026-07",
    units: 1,
    limit: 1_000,
    idempotencyKey: "request_1",
    expiresAt: 1_800_000_000,
  });
  assert.deepEqual(result, { status: "quota_exceeded", used: 1_000 });
});

test("usage cancellation preserves duplicate and conflicting idempotency semantics", async () => {
  const duplicateClient = new ScriptedClient([
    { command: "TransactWriteCommand", error: transactionCanceled() },
    { command: "GetCommand", result: { Item: { units: 3 } } },
    { command: "GetCommand", result: { Item: { used: 7 } } },
  ]);
  const duplicateStore = createDynamoApiKeyAuthorizerStore(duplicateClient, tables);
  assert.deepEqual(await duplicateStore.consumeUsage({
    accountId: "acct_1",
    period: "2026-07",
    units: 3,
    limit: 1_000,
    idempotencyKey: "request_2",
    expiresAt: 1_800_000_000,
  }), { status: "duplicate", used: 7 });

  const conflictClient = new ScriptedClient([
    { command: "TransactWriteCommand", error: transactionCanceled() },
    { command: "GetCommand", result: { Item: { units: 4 } } },
    { command: "GetCommand", result: { Item: { used: 7 } } },
  ]);
  const conflictStore = createDynamoApiKeyAuthorizerStore(conflictClient, tables);
  assert.deepEqual(await conflictStore.consumeUsage({
    accountId: "acct_1",
    period: "2026-07",
    units: 3,
    limit: 1_000,
    idempotencyKey: "request_2",
    expiresAt: 1_800_000_000,
  }), { status: "idempotency_conflict", used: 7 });
});

test("transaction conflicts and service failures are rethrown when state does not prove a business condition", async () => {
  const canceled = transactionCanceled();
  const conflictClient = new ScriptedClient([
    { command: "TransactWriteCommand", error: canceled },
    { command: "GetCommand", result: {} },
    { command: "GetCommand", result: { Item: { used: 10 } } },
  ]);
  const conflictStore = createDynamoApiKeyAuthorizerStore(conflictClient, tables);
  await assert.rejects(() => conflictStore.consumeUsage({
    accountId: "acct_1",
    period: "2026-07",
    units: 1,
    limit: 1_000,
    idempotencyKey: "request_3",
    expiresAt: 1_800_000_000,
  }), (error) => error === canceled);

  const throttled = Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" });
  const failureClient = new ScriptedClient([{ command: "TransactWriteCommand", error: throttled }]);
  const failureStore = createDynamoApiKeyAuthorizerStore(failureClient, tables);
  await assert.rejects(() => failureStore.consumeUsage({
    accountId: "acct_1",
    period: "2026-07",
    units: 1,
    limit: 1_000,
    idempotencyKey: "request_4",
    expiresAt: 1_800_000_000,
  }), (error) => error === throttled);
  assert.equal(failureClient.commands.length, 1);
});
