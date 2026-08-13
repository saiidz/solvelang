import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoCustomerAuthStore } from "../src/customer-auth-store.js";

function clientWith(handler) {
  return { send: handler };
}

test("source throttling uses a bounded atomic counter", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    return {};
  }), "auth-table");

  assert.equal(
    await store.reserveSourceRequest({ sourceKey: "source", window: 42, limit: 10, expiresAt: 120 }),
    "created",
  );
  assert.deepEqual(commands[0].Key, { authKey: "source#source#42" });
  assert.equal(commands[0].ConditionExpression, "attribute_not_exists(#count) OR #count < :limit");
  assert.equal(commands[0].ExpressionAttributeValues[":limit"], 10);
});

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

test("active throttles are classified without hiding Dynamo failures", async () => {
  const limited = createDynamoCustomerAuthStore(clientWith(async () => {
    const error = new Error("conditional");
    error.name = "ConditionalCheckFailedException";
    throw error;
  }), "auth-table");
  assert.equal(await limited.reserveEmailRequest({ throttleKey: "abc", now: 100, expiresAt: 160 }), "limited");
  assert.equal(
    await limited.reserveSourceRequest({ sourceKey: "source", window: 1, limit: 10, expiresAt: 160 }),
    "limited",
  );

  const failed = createDynamoCustomerAuthStore(clientWith(async () => {
    throw new Error("Dynamo unavailable");
  }), "auth-table");
  await assert.rejects(
    () => failed.reserveEmailRequest({ throttleKey: "abc", now: 100, expiresAt: 160 }),
    /Dynamo unavailable/,
  );
  await assert.rejects(
    () => failed.reserveSourceRequest({ sourceKey: "source", window: 1, limit: 10, expiresAt: 160 }),
    /Dynamo unavailable/,
  );
});

test("magic-link consumption relies on an atomic fingerprint condition", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    if (commands.length === 1) {
      return {
        Item: {
          kind: "magic",
          authKey: "magic#token",
          accountId: "acct_1",
          email: "dev@example.com",
          expiresAt: 200,
        },
      };
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

test("verified accounts are materialized without overwriting an existing identity", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    if (commands.length === 1) return {};
    return {
      Item: {
        authKey: "account#acct_1",
        kind: "account",
        accountId: "acct_1",
        email: "dev@example.com",
      },
    };
  }), "auth-table");

  const account = await store.ensureAccount({
    accountId: "acct_1",
    email: "dev@example.com",
    createdAt: "2026-08-12T22:00:00.000Z",
  });
  assert.equal(commands[0].Item.kind, "account");
  assert.equal(commands[0].ConditionExpression, "attribute_not_exists(authKey)");
  assert.equal(account.email, "dev@example.com");
});

test("initial credential setup claims the username and account update atomically", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    if (commands.length === 1) {
      return {
        Item: {
          authKey: "account#acct_1",
          kind: "account",
          accountId: "acct_1",
          email: "dev@example.com",
        },
      };
    }
    return {};
  }), "auth-table");

  const result = await store.setCredentials({
    accountId: "acct_1",
    username: "devuser",
    passwordSalt: "salt",
    passwordHash: "hash",
    passwordScheme: "scrypt-v1",
    passwordUpdatedAt: "2026-08-12T22:00:00.000Z",
  });
  assert.equal(result, "updated");
  const transaction = commands[1].TransactItems;
  assert.deepEqual(transaction[0].Put.Item, {
    authKey: "username#devuser",
    kind: "username",
    username: "devuser",
    accountId: "acct_1",
    createdAt: "2026-08-12T22:00:00.000Z",
  });
  assert.equal(transaction[0].Put.ConditionExpression, "attribute_not_exists(authKey)");
  assert.match(transaction[1].Update.ConditionExpression, /attribute_not_exists\(username\)/);
});

test("password replacement for the same username updates only the account record", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    if (commands.length === 1) {
      return {
        Item: {
          authKey: "account#acct_1",
          kind: "account",
          accountId: "acct_1",
          email: "dev@example.com",
          username: "devuser",
        },
      };
    }
    return {};
  }), "auth-table");

  assert.equal(await store.setCredentials({
    accountId: "acct_1",
    username: "devuser",
    passwordSalt: "new-salt",
    passwordHash: "new-hash",
    passwordScheme: "scrypt-v1",
    passwordUpdatedAt: "2026-08-12T22:05:00.000Z",
  }), "updated");
  assert.equal(commands[1].Key.authKey, "account#acct_1");
  assert.match(commands[1].UpdateExpression, /passwordHash/);
  assert.equal(commands[1].ExpressionAttributeValues[":username"], "devuser");
});

test("password sessions use a conditional write and preserve account ownership", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    return {};
  }), "auth-table");

  await store.putSession({
    session: {
      sessionId: "session",
      secretFingerprint: "fingerprint",
      createdAt: "2026-08-12T22:00:00.000Z",
      expiresAt: 999,
    },
    accountId: "acct_1",
    email: "dev@example.com",
  });
  assert.equal(commands[0].Item.authKey, "session#session");
  assert.equal(commands[0].Item.accountId, "acct_1");
  assert.equal(commands[0].ConditionExpression, "attribute_not_exists(authKey)");
});

test("session revocation uses the supplied clock value", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    return {};
  }), "auth-table");
  await store.revokeSession("session", "2026-07-29T20:00:00.000Z");
  assert.equal(
    commands[0].ExpressionAttributeValues[":expiresAt"],
    Date.parse("2026-07-29T20:00:00.000Z") / 1_000,
  );
});
