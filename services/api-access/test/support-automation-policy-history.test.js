import assert from "node:assert/strict";
import test from "node:test";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createDynamoSupportAutomationStore } from "../src/support-automation-store.js";

test("Dynamo event completion persists the exact policy version exposed by history", async () => {
  const client = {
    calls: [],
    async send(command) {
      this.calls.push(command);
      return {};
    },
  };
  const store = createDynamoSupportAutomationStore(client, "support-table");
  await store.finishEvent({
    accountId: "acct_a",
    eventId: "gmail:m1",
    claimId: "claim_1",
    state: "PROCESSED",
    category: "product_support",
    urgency: "normal",
    requiresReview: false,
    sensitiveReasons: [],
    policyVersion: "support-v1",
    actions: [{ action: "send_reply", status: "succeeded" }],
    updatedAt: "2026-09-13T22:45:00.000Z",
  });

  assert.equal(client.calls.length, 1);
  assert.ok(client.calls[0] instanceof UpdateCommand);
  const input = client.calls[0].input;
  assert.match(input.UpdateExpression, /policyVersion = :policyVersion/);
  assert.equal(input.ExpressionAttributeValues[":policyVersion"], "support-v1");
  assert.match(input.ConditionExpression, /claimId = :claimId/);
  assert.equal(input.ExpressionAttributeValues[":claimId"], "claim_1");
});
