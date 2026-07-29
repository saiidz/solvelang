import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoCustomerUsageReader } from "../src/customer-usage.js";

test("reads the strongly consistent monthly usage bucket", async () => {
  const commands = [];
  const reader = createDynamoCustomerUsageReader({
    async send(command) {
      commands.push(command.input);
      return { Item: { used: 321 } };
    },
  }, "usage-table");
  assert.equal(await reader.getUsage("acct_1", "2026-07"), 321);
  assert.deepEqual(commands[0], {
    TableName: "usage-table",
    Key: { usageKey: "acct_1:2026-07" },
    ConsistentRead: true,
  });
});

test("missing or malformed usage records fail closed to zero", async () => {
  const missing = createDynamoCustomerUsageReader({ async send() { return {}; } }, "usage-table");
  assert.equal(await missing.getUsage("acct_1", "2026-07"), 0);
  const malformed = createDynamoCustomerUsageReader({ async send() { return { Item: { used: -1 } }; } }, "usage-table");
  assert.equal(await malformed.getUsage("acct_1", "2026-07"), 0);
});
