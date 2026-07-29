import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoCustomerAuthStore } from "../src/customer-auth-store.js";

function clientWith(handler) {
  return { send: handler };
}

test("email throttling can replace an expired Dynamo record", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    return {};
  }), "auth-table");

  assert.equal(await store.reserveEmailRequest({ throttleKey: "abc", now: 100, expiresAt: 160 }), "created");
  assert.equal(commands[0].ConditionExpression, "attribute_not_exists(authKey) OR expiresAt <= :now");
  assert.deepEqual(commands[0].ExpressionAttributeValues, { ":now": 100 });
});

test("active email throttles are classified without hiding Dynamo failures", async () => {
  const limited = createDynamoCustomerAuthStore(clientWith(async () => {
    const error = new Error("conditional");
    error.name = "ConditionalCheckFailedException";
    throw error;
  }), "auth-table");
  assert.equal(await limited.reserveEmailRequest({ throttleKey: "abc", now: 100, expiresAt: 160 }), "limited");

  const failed = createDynamoCustomerAuthStore(clientWith(async () => {
    throw new Error("Dynamo unavailable");
  }), "auth-table");
  await assert.rejects(() => failed.reserveEmailRequest({ throttleKey: "abc", now: 100, expiresAt: 160 }), /Dynamo unavailable/);
});

test("magic-link consumption relies on an atomic fingerprint condition", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    if (commands.length === 1) {
      return { Item: { kind: "magic", authKey: "magic#token", accountId: "acct_1", email: "dev@example.com", expiresAt: 200 } };
    }
    const error = new Error("transaction canceled");
    error.name = "TransactionCanceledException";
    throw error;
  }), "auth-table");

  const result = await store.consumeMagicLinkAndCreateSession({
    tokenId: "token",
    presentedFingerprint: "wrong-fingerprint",
    now: 100,
    session: { sessionId: "session", secretFingerprint: "session-fingerprint", expiresAt: 300 },
  });
  assert.equal(result, undefined);
  const deletion = commands[1].TransactItems[0].Delete;
  assert.match(deletion.ConditionExpression, /secretFingerprint = :fingerprint/);
  assert.equal(deletion.ExpressionAttributeValues[":fingerprint"], "wrong-fingerprint");
});

test("session revocation uses the supplied clock value", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    return {};
  }), "auth-table");
  await store.revokeSession("session", "2026-07-29T20:00:00.000Z");
  assert.equal(commands[0].ExpressionAttributeValues[":expiresAt"], Date.parse("2026-07-29T20:00:00.000Z") / 1_000);
});
