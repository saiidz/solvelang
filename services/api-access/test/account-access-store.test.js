import test from "node:test";
import assert from "node:assert/strict";
import { createDynamoAccountAccessStore } from "../src/account-access-store.js";

const ACCOUNT_ID = `acct_${"c".repeat(32)}`;

function clientWithAccount(account) {
  const sent = [];
  return {
    sent,
    async send(command) {
      sent.push(command);
      const name = command.constructor.name;
      if (name === "GetCommand") return { Item: account };
      if (name === "TransactWriteCommand") return {};
      throw new Error(`unexpected command ${name}`);
    },
  };
}

test("reads only the exact requested account record consistently", async () => {
  const client = clientWithAccount({ kind: "account", accountId: ACCOUNT_ID });
  const store = createDynamoAccountAccessStore(client, { tableName: "auth-table" });
  const account = await store.getAccount(ACCOUNT_ID);
  assert.equal(account.accountId, ACCOUNT_ID);
  const input = client.sent[0].input;
  assert.deepEqual(input.Key, { authKey: `account#${ACCOUNT_ID}` });
  assert.equal(input.ConsistentRead, true);

  const corruptClient = clientWithAccount({ kind: "account", accountId: `acct_${"d".repeat(32)}` });
  const corruptStore = createDynamoAccountAccessStore(corruptClient, { tableName: "auth-table" });
  await assert.rejects(() => corruptStore.getAccount(ACCOUNT_ID), /Customer account identity is invalid/);
});

test("transition writes request ledger, account version bump, and audit record atomically", async () => {
  const client = clientWithAccount({ kind: "account", accountId: ACCOUNT_ID, authVersion: 3 });
  const store = createDynamoAccountAccessStore(client, { tableName: "auth-table" });
  const outcome = await store.transitionAccess({
    account: { kind: "account", accountId: ACCOUNT_ID, accessState: "active", authVersion: 3 },
    previousState: "active",
    targetState: "suspended",
    reason: "security review",
    changedAt: "2026-08-13T20:00:00.000Z",
    changedBy: "api-access-admin",
    requestId: "req_suspend_1000",
    requestFingerprint: "f".repeat(64),
  });
  assert.equal(outcome, "updated");
  const transaction = client.sent.at(-1).input.TransactItems;
  assert.equal(transaction.length, 3);
  assert.match(transaction[0].Put.Item.authKey, /^access-request#/);
  assert.equal(transaction[0].Put.ConditionExpression, "attribute_not_exists(authKey)");
  assert.equal(transaction[1].Update.ExpressionAttributeValues[":previousState"], "active");
  assert.equal(transaction[1].Update.ExpressionAttributeValues[":currentAuthVersion"], 3);
  assert.equal(transaction[1].Update.ExpressionAttributeValues[":nextAuthVersion"], 4);
  assert.match(transaction[1].Update.UpdateExpression, /authVersion = :nextAuthVersion/);
  assert.match(transaction[2].Put.Item.authKey, /^access-audit#/);
  assert.equal(transaction[2].Put.ConditionExpression, "attribute_not_exists(authKey)");
});

test("fully legacy account omits unreferenced state/version placeholders", async () => {
  const client = clientWithAccount({ kind: "account", accountId: ACCOUNT_ID });
  const store = createDynamoAccountAccessStore(client, { tableName: "auth-table" });
  await store.transitionAccess({
    account: { kind: "account", accountId: ACCOUNT_ID },
    previousState: "active",
    targetState: "suspended",
    reason: "review",
    changedAt: "2026-08-13T20:00:00.000Z",
    changedBy: "api-access-admin",
    requestId: "req_suspend_1001",
    requestFingerprint: "e".repeat(64),
  });
  const update = client.sent.at(-1).input.TransactItems[1].Update;
  assert.match(update.ConditionExpression, /attribute_not_exists\(accessState\)/);
  assert.match(update.ConditionExpression, /attribute_not_exists\(authVersion\)/);
  assert.equal(update.ExpressionAttributeValues[":previousState"], undefined);
  assert.equal(update.ExpressionAttributeValues[":currentAuthVersion"], undefined);
  assert.equal(update.ExpressionAttributeValues[":nextAuthVersion"], 2);
});

test("partially legacy account supplies only placeholders referenced by its selected conditions", async () => {
  const missingStateClient = clientWithAccount({ kind: "account", accountId: ACCOUNT_ID, authVersion: 4 });
  const missingStateStore = createDynamoAccountAccessStore(missingStateClient, { tableName: "auth-table" });
  await missingStateStore.transitionAccess({
    account: { kind: "account", accountId: ACCOUNT_ID, authVersion: 4 },
    previousState: "active",
    targetState: "suspended",
    reason: "review",
    changedAt: "2026-08-13T20:00:00.000Z",
    changedBy: "api-access-admin",
    requestId: "req_suspend_1003",
    requestFingerprint: "c".repeat(64),
  });
  const missingStateUpdate = missingStateClient.sent.at(-1).input.TransactItems[1].Update;
  assert.equal(missingStateUpdate.ExpressionAttributeValues[":previousState"], undefined);
  assert.equal(missingStateUpdate.ExpressionAttributeValues[":currentAuthVersion"], 4);

  const missingVersionClient = clientWithAccount({ kind: "account", accountId: ACCOUNT_ID, accessState: "active" });
  const missingVersionStore = createDynamoAccountAccessStore(missingVersionClient, { tableName: "auth-table" });
  await missingVersionStore.transitionAccess({
    account: { kind: "account", accountId: ACCOUNT_ID, accessState: "active" },
    previousState: "active",
    targetState: "suspended",
    reason: "review",
    changedAt: "2026-08-13T20:00:00.000Z",
    changedBy: "api-access-admin",
    requestId: "req_suspend_1004",
    requestFingerprint: "b".repeat(64),
  });
  const missingVersionUpdate = missingVersionClient.sent.at(-1).input.TransactItems[1].Update;
  assert.equal(missingVersionUpdate.ExpressionAttributeValues[":previousState"], "active");
  assert.equal(missingVersionUpdate.ExpressionAttributeValues[":currentAuthVersion"], undefined);
  assert.equal(missingVersionUpdate.ExpressionAttributeValues[":nextAuthVersion"], 2);
});

test("transaction cancellation fails closed as conflict", async () => {
  const client = {
    async send(command) {
      if (command.constructor.name === "TransactWriteCommand") {
        const error = new Error("conflict");
        error.name = "TransactionCanceledException";
        throw error;
      }
      return {};
    },
  };
  const store = createDynamoAccountAccessStore(client, { tableName: "auth-table" });
  const result = await store.transitionAccess({
    account: { kind: "account", accountId: ACCOUNT_ID, accessState: "active", authVersion: 2 },
    previousState: "active",
    targetState: "suspended",
    reason: "review",
    changedAt: "2026-08-13T20:00:00.000Z",
    changedBy: "api-access-admin",
    requestId: "req_suspend_1002",
    requestFingerprint: "d".repeat(64),
  });
  assert.equal(result, "conflict");
});
