import test from "node:test";
import assert from "node:assert/strict";
import { createAccessGuardedCustomerAuthStore } from "../src/customer-auth-access-guard.js";

const ACTIVE = `acct_${"a".repeat(32)}`;
const SUSPENDED = `acct_${"b".repeat(32)}`;

function fixture() {
  const accounts = new Map([
    [ACTIVE, { accountId: ACTIVE, kind: "account" }],
    [SUSPENDED, { accountId: SUSPENDED, kind: "account", accessState: "suspended" }],
  ]);
  const records = new Map();
  const calls = [];
  const store = {
    async putMagicLink(record) { calls.push(["putMagicLink", record.accountId]); },
    async putSession(input) { calls.push(["putSession", input.accountId]); },
    async putMfaChallenge(input) { calls.push(["putMfaChallenge", input.accountId]); },
    async consumeMagicLinkForAuth(input) { calls.push(["consumeMagicLinkForAuth", input.tokenId]); return { accountId: ACTIVE }; },
    async consumeMagicLinkAndCreateSession(input) { calls.push(["consumeMagicLinkAndCreateSession", input.tokenId]); return { accountId: ACTIVE }; },
    async consumeMfaChallengeAndCreateSession(input) { calls.push(["consumeMfaChallengeAndCreateSession", input.challenge.accountId]); return "consumed"; },
    async getSession(id) { return records.get(`session#${id}`); },
    async getAccount(id) { return accounts.get(id); },
  };
  const reader = {
    async getAccount(id) { return accounts.get(id); },
    async getRecord(key) { return records.get(key); },
  };
  return { guard: createAccessGuardedCustomerAuthStore(store, reader), calls, records };
}

test("active account can create a session", async () => {
  const { guard, calls } = fixture();
  await guard.putSession({ accountId: ACTIVE, session: {} });
  assert.deepEqual(calls, [["putSession", ACTIVE]]);
});

test("suspended account cannot create password session", async () => {
  const { guard, calls } = fixture();
  await assert.rejects(
    () => guard.putSession({ accountId: SUSPENDED, session: {} }),
    (error) => error.code === "account_access_restricted" && error.statusCode === 403,
  );
  assert.equal(calls.length, 0);
});

test("suspended account cannot create an MFA challenge", async () => {
  const { guard, calls } = fixture();
  await assert.rejects(
    () => guard.putMfaChallenge({ accountId: SUSPENDED, challenge: {} }),
    (error) => error.code === "account_access_restricted",
  );
  assert.equal(calls.length, 0);
});

test("existing suspended session is treated as invalid before customer action", async () => {
  const { guard, records } = fixture();
  records.set("session#old", { sessionId: "old", accountId: SUSPENDED });
  assert.equal(await guard.getSession("old"), undefined);
});

test("magic link consumption is blocked before it can create a session", async () => {
  const { guard, calls, records } = fixture();
  records.set("magic#token1", { kind: "magic", accountId: SUSPENDED });
  await assert.rejects(
    () => guard.consumeMagicLinkForAuth({ tokenId: "token1" }),
    (error) => error.code === "account_access_restricted",
  );
  assert.equal(calls.length, 0);
});

test("MFA challenge consumption is blocked for suspended account", async () => {
  const { guard, calls } = fixture();
  await assert.rejects(
    () => guard.consumeMfaChallengeAndCreateSession({ challenge: { accountId: SUSPENDED } }),
    (error) => error.code === "account_access_restricted",
  );
  assert.equal(calls.length, 0);
});
