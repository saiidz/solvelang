import assert from "node:assert/strict";
import test from "node:test";
import { DeleteCommand, GetCommand, PutCommand, TransactWriteCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createEntitlementStore } from "../src/store.js";
import type { EntitlementRecord } from "../src/service.js";

const record: EntitlementRecord = {
  scanId: "6c8e4b95-1e66-4dc3-9b67-af15f0742875",
  sessionId: "pi_test_paid_payment",
  paymentStatus: "paid",
  stripeEventId: "evt_test_paid",
  createdAt: "2026-07-20T00:00:00.000Z",
  expiresAt: 1_755_648_000,
};

test("Dynamo store conditionally persists only the allowlisted entitlement record", async () => {
  const commands: Array<DeleteCommand | PutCommand | GetCommand | TransactWriteCommand | UpdateCommand> = [];
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

  assert.equal(await store.updateRefundStatus(record.scanId, record.sessionId, "full", "evt_refund", "2026-07-22T00:00:00.000Z"), "updated");
  assert.deepEqual((commands[2] as UpdateCommand).input, {
    TableName: "test-entitlements",
    Key: { scanId: record.scanId },
    ConditionExpression: "sessionId = :paymentIntentId AND (attribute_not_exists(refundEventId) OR refundEventId <> :eventId)",
    UpdateExpression: "SET refundStatus = :refundStatus, refundEventId = :eventId, refundUpdatedAt = :updatedAt",
    ExpressionAttributeValues: {
      ":paymentIntentId": record.sessionId,
      ":refundStatus": "full",
      ":eventId": "evt_refund",
      ":updatedAt": "2026-07-22T00:00:00.000Z",
    },
  });
});

test("Dynamo conditional conflicts are treated as successful duplicate delivery", async () => {
  const duplicate = new Error("private database detail");
  duplicate.name = "ConditionalCheckFailedException";
  const store = createEntitlementStore({ async send() { throw duplicate; } }, "test-entitlements");
  assert.equal(await store.putIfAbsent(record), "duplicate");
});
