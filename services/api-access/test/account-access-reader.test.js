import assert from "node:assert/strict";
import test from "node:test";
import { createDynamoAccountAccessReader } from "../src/account-access-reader.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;

function client(item) {
  return {
    async send(command) {
      assert.equal(command.constructor.name, "GetCommand");
      return { Item: item };
    },
  };
}

test("reader accepts only an account record whose embedded ID matches the requested key", async () => {
  const reader = createDynamoAccountAccessReader(client({ kind: "account", accountId: ACCOUNT_ID }), {
    tableName: "auth-table",
  });
  assert.equal((await reader.getAccount(ACCOUNT_ID)).accountId, ACCOUNT_ID);

  const corrupt = createDynamoAccountAccessReader(client({
    kind: "account",
    accountId: `acct_${"b".repeat(32)}`,
  }), { tableName: "auth-table" });
  await assert.rejects(() => corrupt.getAccount(ACCOUNT_ID), /Customer account identity is invalid/);
});

test("reader treats non-account records as absent", async () => {
  const reader = createDynamoAccountAccessReader(client({ kind: "magic", accountId: ACCOUNT_ID }), {
    tableName: "auth-table",
  });
  assert.equal(await reader.getAccount(ACCOUNT_ID), undefined);
  assert.equal(await reader.isActive(ACCOUNT_ID), false);
});
