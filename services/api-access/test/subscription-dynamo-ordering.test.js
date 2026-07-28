import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoApiAccessStore } from "../src/dynamo-store.js";

const tables = {
  accountsTable: "accounts",
  keysTable: "keys",
  keysAccountIndex: "AccountIdIndex",
  usageTable: "usage",
  idempotencyTable: "idempotency",
};

function account() {
  return {
    accountId: "acct_1",
    email: "dev@example.com",
    plan: "pro",
    subscriptionStatus: "active",
    currentPeriodEnd: 1_800_000_000_000,
    subscriptionEventCreatedAt: 1_785_254_400_000,
    subscriptionEventOrder: 1_785_254_400_022,
    stripeCustomerId: "cus_1",
    stripeSubscriptionId: "sub_1",
    updatedAt: "2026-07-28T12:00:00.000Z",
  };
}

test("Dynamo account updates require a strictly newer lifecycle order", async () => {
  let command;
  const client = { send: async (input) => { command = input; return {}; } };
  const store = createDynamoApiAccessStore(client, tables);
  assert.equal(await store.putAccount(account()), "updated");
  assert.equal(command.constructor.name, "UpdateCommand");
  assert.equal(command.input.ExpressionAttributeNames["#eventCreatedAt"], "subscriptionEventCreatedAt");
  assert.equal(command.input.ExpressionAttributeNames["#eventOrder"], "subscriptionEventOrder");
  assert.equal(command.input.ConditionExpression, "attribute_not_exists(#eventOrder) OR #eventOrder < :eventOrder");
  assert.equal(command.input.ExpressionAttributeValues[":eventCreatedAt"], 1_785_254_400_000);
  assert.equal(command.input.ExpressionAttributeValues[":eventOrder"], 1_785_254_400_022);
  assert.match(command.input.UpdateExpression, /activeKeyCount = if_not_exists/);
});

test("conditional stale-event failures are classified without hiding Dynamo outages", async () => {
  const stale = Object.assign(new Error("stale"), { name: "ConditionalCheckFailedException" });
  const staleStore = createDynamoApiAccessStore({ send: async () => { throw stale; } }, tables);
  assert.equal(await staleStore.putAccount(account()), "stale");

  const throttled = Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" });
  const unavailable = createDynamoApiAccessStore({ send: async () => { throw throttled; } }, tables);
  await assert.rejects(() => unavailable.putAccount(account()), (error) => error === throttled);
});
