import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoApiAccessStore } from "../src/dynamo-store.js";
import { ApiAccessError, createApiAccessService } from "../src/service.js";

const pepper = "p".repeat(64);
const now = Date.UTC(2026, 6, 28, 12, 0, 0);
const tables = {
  accountsTable: "accounts",
  keysTable: "keys",
  keysAccountIndex: "AccountIdIndex",
  usageTable: "usage",
  idempotencyTable: "idempotency",
};

test("service creates a bounded Checkout reservation and preserves same-request retries", async () => {
  const calls = [];
  const store = {
    reserveSubscriptionCheckout: async (input) => {
      calls.push(input);
      return calls.length === 1 ? "created" : "duplicate";
    },
  };
  const service = createApiAccessService({ store, pepper, now: () => now });
  const created = await service.reserveSubscriptionCheckout({ accountId: "acct_1", requestId: "request_1" });
  assert.deepEqual(created, {
    accountId: "acct_1",
    requestId: "request_1",
    expiresAt: now + 15 * 60 * 1_000,
    duplicate: false,
  });
  const duplicate = await service.reserveSubscriptionCheckout({ accountId: "acct_1", requestId: "request_1" });
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(calls[0], {
    accountId: "acct_1",
    requestId: "request_1",
    now,
    expiresAt: now + 15 * 60 * 1_000,
  });
});

test("service rejects a concurrent Checkout reservation", async () => {
  const service = createApiAccessService({
    store: { reserveSubscriptionCheckout: async () => "conflict" },
    pepper,
    now: () => now,
  });
  await assert.rejects(
    () => service.reserveSubscriptionCheckout({ accountId: "acct_1", requestId: "request_2" }),
    (error) => error instanceof ApiAccessError
      && error.statusCode === 409
      && error.code === "subscription_checkout_conflict",
  );
});

test("Dynamo reservation uses an atomic condition covering subscriptions, pending attempts, retries, and expiry", async () => {
  let command;
  const client = { send: async (input) => { command = input; return {}; } };
  const store = createDynamoApiAccessStore(client, tables);
  assert.equal(await store.reserveSubscriptionCheckout({
    accountId: "acct_1",
    requestId: "request_1",
    now,
    expiresAt: now + 900_000,
  }), "created");
  assert.equal(command.constructor.name, "UpdateCommand");
  assert.match(command.input.ConditionExpression, /attribute_not_exists\(stripeSubscriptionId\)/);
  assert.match(command.input.ConditionExpression, /pendingCheckoutExpiresAt <= :now/);
  assert.match(command.input.ConditionExpression, /pendingCheckoutRequestId = :requestId/);
  assert.equal(command.input.ExpressionAttributeValues[":expiresAt"], now + 900_000);
});

test("Dynamo reservation recognizes an idempotent retry after a conditional failure", async () => {
  let call = 0;
  const conditional = Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
  const client = {
    async send(command) {
      call += 1;
      if (call === 1) throw conditional;
      assert.equal(command.constructor.name, "GetCommand");
      return {
        Item: {
          accountId: "acct_1",
          pendingCheckoutRequestId: "request_1",
          pendingCheckoutExpiresAt: now + 900_000,
        },
      };
    },
  };
  const store = createDynamoApiAccessStore(client, tables);
  assert.equal(await store.reserveSubscriptionCheckout({
    accountId: "acct_1",
    requestId: "request_1",
    now,
    expiresAt: now + 900_000,
  }), "duplicate");
});

test("Dynamo reservation rejects another active subscription or request", async () => {
  const conditional = Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
  async function resultFor(item, requestId = "request_new") {
    let call = 0;
    const client = {
      async send() {
        call += 1;
        if (call === 1) throw conditional;
        return { Item: item };
      },
    };
    return createDynamoApiAccessStore(client, tables).reserveSubscriptionCheckout({
      accountId: "acct_1",
      requestId,
      now,
      expiresAt: now + 900_000,
    });
  }
  assert.equal(await resultFor({
    accountId: "acct_1",
    stripeSubscriptionId: "sub_active",
    subscriptionStatus: "active",
  }), "conflict");
  assert.equal(await resultFor({
    accountId: "acct_1",
    pendingCheckoutRequestId: "request_old",
    pendingCheckoutExpiresAt: now + 900_000,
  }), "conflict");
});

test("reservation infrastructure failures are rethrown", async () => {
  const failure = Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" });
  const store = createDynamoApiAccessStore({ send: async () => { throw failure; } }, tables);
  await assert.rejects(() => store.reserveSubscriptionCheckout({
    accountId: "acct_1",
    requestId: "request_1",
    now,
    expiresAt: now + 900_000,
  }), (error) => error === failure);
});
