import test from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_ACCESS_ACTIVE,
  ACCOUNT_ACCESS_SUSPENDED,
  ACCOUNT_ACCESS_TERMINATED,
  accountAccessState,
  accountIsActive,
  createAccountAccessService,
  publicAccountAccess,
} from "../src/account-access.js";

const ACCOUNT_ID = `acct_${"a".repeat(32)}`;

function memoryStore(initial) {
  let account = { ...initial };
  const calls = [];
  return {
    calls,
    async getAccount(accountId) {
      return accountId === account.accountId ? { ...account } : undefined;
    },
    async transitionAccess(input) {
      calls.push(input);
      account = {
        ...account,
        accessState: input.targetState,
        accessReason: input.reason,
        accessChangedAt: input.changedAt,
        accessChangedBy: input.changedBy,
        authVersion: (account.authVersion ?? 1) + 1,
      };
      return "updated";
    },
  };
}

test("legacy account state and missing authVersion default to active version one", () => {
  const account = { accountId: ACCOUNT_ID };
  assert.equal(accountAccessState(account), ACCOUNT_ACCESS_ACTIVE);
  assert.equal(accountIsActive(account), true);
  assert.equal(publicAccountAccess(account).authVersion, 1);
});

test("known restricted states are not active", () => {
  assert.equal(accountIsActive({ accountId: ACCOUNT_ID, accessState: ACCOUNT_ACCESS_SUSPENDED }), false);
  assert.equal(accountIsActive({ accountId: ACCOUNT_ID, accessState: ACCOUNT_ACCESS_TERMINATED }), false);
  assert.equal(accountAccessState({ accountId: ACCOUNT_ID, accessState: "corrupt" }), "invalid");
});

test("public status rejects malformed access state or authentication version", () => {
  assert.throws(
    () => publicAccountAccess({ accountId: ACCOUNT_ID, accessState: "corrupt" }),
    (error) => error.code === "account_access_state_invalid" && error.statusCode === 409,
  );
  for (const authVersion of [0, -1, "2", 1.5]) {
    const account = { accountId: ACCOUNT_ID, accessState: ACCOUNT_ACCESS_ACTIVE, authVersion };
    assert.equal(accountIsActive(account), false);
    assert.throws(
      () => publicAccountAccess(account),
      (error) => error.code === "account_access_state_invalid" && error.statusCode === 409,
    );
  }
});

test("assertActive fails closed on malformed authentication version", async () => {
  const store = memoryStore({ accountId: ACCOUNT_ID, authVersion: "2" });
  const service = createAccountAccessService({ store });
  await assert.rejects(
    () => service.assertActive(ACCOUNT_ID),
    (error) => error.code === "account_access_restricted" && error.statusCode === 403,
  );
});

test("suspension advances auth version through the store transition", async () => {
  const store = memoryStore({ accountId: ACCOUNT_ID, authVersion: 4 });
  const service = createAccountAccessService({ store, now: () => Date.parse("2026-08-13T20:00:00Z") });
  const result = await service.transition({
    accountId: ACCOUNT_ID,
    state: ACCOUNT_ACCESS_SUSPENDED,
    reason: "security review",
    requestId: "req_suspend_0001",
  });
  assert.equal(result.state, ACCOUNT_ACCESS_SUSPENDED);
  assert.equal(result.authVersion, 5);
  assert.equal(result.changed, true);
  assert.equal(store.calls.length, 1);
});

test("suspended account can be reactivated", async () => {
  const store = memoryStore({
    accountId: ACCOUNT_ID,
    authVersion: 8,
    accessState: ACCOUNT_ACCESS_SUSPENDED,
  });
  const service = createAccountAccessService({ store, now: () => Date.parse("2026-08-13T20:01:00Z") });
  const result = await service.transition({
    accountId: ACCOUNT_ID,
    state: ACCOUNT_ACCESS_ACTIVE,
    reason: "review cleared",
    requestId: "req_resume_0001",
  });
  assert.equal(result.state, ACCOUNT_ACCESS_ACTIVE);
  assert.equal(result.authVersion, 9);
});

test("terminated account cannot be reactivated", async () => {
  const store = memoryStore({
    accountId: ACCOUNT_ID,
    authVersion: 9,
    accessState: ACCOUNT_ACCESS_TERMINATED,
  });
  const service = createAccountAccessService({ store });
  await assert.rejects(
    () => service.transition({
      accountId: ACCOUNT_ID,
      state: ACCOUNT_ACCESS_ACTIVE,
      reason: "attempted restore",
      requestId: "req_restore_0001",
    }),
    (error) => error.code === "account_terminated" && error.statusCode === 409,
  );
});

test("assertActive rejects suspended accounts", async () => {
  const store = memoryStore({
    accountId: ACCOUNT_ID,
    authVersion: 2,
    accessState: ACCOUNT_ACCESS_SUSPENDED,
  });
  const service = createAccountAccessService({ store });
  await assert.rejects(
    () => service.assertActive(ACCOUNT_ID),
    (error) => error.code === "account_access_restricted" && error.statusCode === 403,
  );
});
