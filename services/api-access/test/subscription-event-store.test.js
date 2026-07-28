import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoSubscriptionEventStore } from "../src/subscription-event-store.js";

class Client {
  constructor(result) { this.result = result; this.command = undefined; }
  async send(command) {
    this.command = command;
    if (this.result instanceof Error) throw this.result;
    return this.result;
  }
}

const record = {
  eventId: "evt_1",
  eventType: "customer.subscription.updated",
  accountId: "acct_1",
  subscriptionId: "sub_1",
  createdAt: "2026-07-28T12:00:00.000Z",
  expiresAt: 1_800_000_000,
};

test("stores Stripe events with a uniqueness condition", async () => {
  const client = new Client({});
  const store = createDynamoSubscriptionEventStore(client, "events");
  assert.equal(await store.putEventIfAbsent(record), "created");
  assert.equal(client.command.constructor.name, "PutCommand");
  assert.equal(client.command.input.TableName, "events");
  assert.equal(client.command.input.ConditionExpression, "attribute_not_exists(eventId)");
  assert.deepEqual(client.command.input.Item, record);
});

test("classifies only conditional duplicates and rethrows infrastructure failures", async () => {
  const duplicate = new Client(Object.assign(new Error("duplicate"), { name: "ConditionalCheckFailedException" }));
  assert.equal(await createDynamoSubscriptionEventStore(duplicate, "events").putEventIfAbsent(record), "duplicate");

  const failure = Object.assign(new Error("throttled"), { name: "ProvisionedThroughputExceededException" });
  const unavailable = new Client(failure);
  await assert.rejects(() => createDynamoSubscriptionEventStore(unavailable, "events").putEventIfAbsent(record), (error) => error === failure);
});
