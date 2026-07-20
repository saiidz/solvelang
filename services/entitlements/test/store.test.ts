import assert from "node:assert/strict";
import test from "node:test";
import { GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { createEntitlementStore } from "../src/store.js";
import type { EntitlementRecord } from "../src/service.js";

const record: EntitlementRecord = {
  scanId: "6c8e4b95-1e66-4dc3-9b67-af15f0742875",
  sessionId: "cs_test_paid_session",
  paymentStatus: "paid",
  stripeEventId: "evt_test_paid",
  createdAt: "2026-07-20T00:00:00.000Z",
  expiresAt: 1_755_648_000,
};

test("Dynamo store conditionally persists only the allowlisted entitlement record", async () => {
  const commands: Array<PutCommand | GetCommand> = [];
  const store = createEntitlementStore({
    async send(command) {
      commands.push(command);
      return command instanceof GetCommand ? { Item: record } : {};
    },
  }, "test-entitlements");

  assert.equal(await store.putIfAbsent(record), "created");
  assert.deepEqual((commands[0] as PutCommand).input, {
    TableName: "test-entitlements",
    Item: record,
    ConditionExpression: "attribute_not_exists(scanId)",
  });
  assert.deepEqual(await store.get(record.scanId), record);
  assert.deepEqual((commands[1] as GetCommand).input, {
    TableName: "test-entitlements",
    Key: { scanId: record.scanId },
    ConsistentRead: true,
  });
});

test("Dynamo conditional conflicts are treated as successful duplicate delivery", async () => {
  const duplicate = new Error("private database detail");
  duplicate.name = "ConditionalCheckFailedException";
  const store = createEntitlementStore({ async send() { throw duplicate; } }, "test-entitlements");
  assert.equal(await store.putIfAbsent(record), "duplicate");
});
