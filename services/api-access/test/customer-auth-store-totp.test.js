import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoCustomerAuthStore } from "../src/customer-auth-store.js";

function clientWith(handler) {
  return { send: handler };
}

test("MFA challenges cap attempts on the challenge record instead of resetting each time window", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    return {
      Attributes: {
        kind: "mfa",
        challengeId: "challenge",
        accountId: "acct_1",
        email: "owner@example.com",
        authVersion: 3,
        attemptCount: 1,
      },
    };
  }), "auth-table");
  const result = await store.reserveMfaAttempt({
    challengeId: "challenge",
    presentedFingerprint: "fingerprint",
    now: 100,
    limit: 5,
  });
  assert.equal(result.attemptCount, 1);
  assert.deepEqual(commands[0].Key, { authKey: "mfa#challenge" });
  assert.match(commands[0].ConditionExpression, /attemptCount < :limit/);
  assert.equal(commands[0].ExpressionAttributeValues[":limit"], 5);
  assert.equal(commands[0].ReturnValues, "ALL_NEW");
});

test("TOTP challenge consumption atomically blocks time-step replay while creating one session", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    return {};
  }), "auth-table");
  assert.equal(await store.consumeMfaChallengeAndCreateSession({
    challenge: {
      challengeId: "challenge",
      accountId: "acct_1",
      email: "owner@example.com",
      authVersion: 4,
    },
    presentedFingerprint: "fingerprint",
    now: 100,
    session: { sessionId: "session", secretFingerprint: "session-fingerprint", expiresAt: 300 },
    totpStep: 60,
  }), "consumed");
  const transaction = commands[0].TransactItems;
  assert.equal(transaction.length, 3);
  assert.equal(transaction[0].Delete.Key.authKey, "mfa#challenge");
  assert.equal(transaction[1].Put.Key, undefined);
  assert.equal(transaction[1].Put.Item.authKey, "session#session");
  assert.equal(transaction[1].Put.Item.authVersion, 4);
  assert.match(transaction[2].Update.ConditionExpression, /totpLastStep < :totpStep/);
  assert.equal(transaction[2].Update.ExpressionAttributeValues[":totpStep"], 60);
  assert.equal(transaction[2].Update.ExpressionAttributeValues[":authVersion"], 4);
});

test("backup-code challenge consumption removes exactly one fingerprint and decrements the count atomically", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    return {};
  }), "auth-table");
  assert.equal(await store.consumeMfaChallengeAndCreateSession({
    challenge: {
      challengeId: "challenge",
      accountId: "acct_1",
      email: "owner@example.com",
      authVersion: 2,
    },
    presentedFingerprint: "fingerprint",
    now: 100,
    session: { sessionId: "session", secretFingerprint: "session-fingerprint", expiresAt: 300 },
    backupIndex: 3,
    backupCodeFingerprint: "backup-fingerprint",
  }), "consumed");
  const update = commands[0].TransactItems[2].Update;
  assert.match(update.UpdateExpression, /backupCodeCount = backupCodeCount - :one/);
  assert.match(update.UpdateExpression, /REMOVE backupCodeFingerprints\[3\]/);
  assert.match(update.ConditionExpression, /backupCodeFingerprints\[3\] = :backupCodeFingerprint/);
  assert.equal(update.ExpressionAttributeValues[":backupCodeFingerprint"], "backup-fingerprint");
});

test("enabling TOTP atomically consumes pending setup, bumps authVersion, and upgrades only the current session", async () => {
  const commands = [];
  const store = createDynamoCustomerAuthStore(clientWith(async (command) => {
    commands.push(command.input);
    if (commands.length === 1) {
      return {
        Item: {
          authKey: "account#acct_1",
          kind: "account",
          accountId: "acct_1",
          email: "owner@example.com",
          username: "owner",
          authVersion: 7,
        },
      };
    }
    return {};
  }), "auth-table");
  assert.equal(await store.enableTotp({
    accountId: "acct_1",
    sessionId: "session_1",
    secretCiphertext: "ciphertext",
    enabledAt: "2026-08-13T05:00:00.000Z",
    now: 100,
    backupCodeFingerprints: ["one", "two"],
    totpStep: 42,
  }), "updated");
  const transaction = commands[1].TransactItems;
  assert.equal(transaction.length, 3);
  assert.equal(transaction[0].Delete.Key.authKey, "totp-pending#acct_1");
  assert.equal(transaction[1].Update.ExpressionAttributeValues[":currentAuthVersion"], 7);
  assert.equal(transaction[1].Update.ExpressionAttributeValues[":nextAuthVersion"], 8);
  assert.deepEqual(transaction[1].Update.ExpressionAttributeValues[":backupCodes"], ["one", "two"]);
  assert.equal(transaction[2].Update.Key.authKey, "session#session_1");
  assert.equal(transaction[2].Update.ExpressionAttributeValues[":nextAuthVersion"], 8);
});
