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

const ACCOUNT_ID = `acct_${"d".repeat(32)}`;

function ledgerStore(initial) {
  let account = initial ? { ...initial } : undefined;
  const requests = new Map();
  const transitions = [];
  return {
    transitions,
    async getAccount(accountId) {
      return accountId === account?.accountId ? { ...account } : undefined;
    },
    async getRequest(requestFingerprint) {
      const request = requests.get(requestFingerprint);
      return request ? { ...request } : undefined;
    },
    async transitionAccess(input) {
      transitions.push(input);
      requests.set(input.requestFingerprint, {
        kind: "access-request",
        accountId: input.account.accountId,
        requestId: input.requestId,
        previousState: input.previousState,
        targetState: input.targetState,
        reason: input.reason,
        changedAt: input.changedAt,
        changedBy: input.changedBy,
      });
      account = {
        ...account,
        accessState: input.targetState,
        accessReason: input.reason,
        accessChangedAt: input.changedAt,
        accessChangedBy: input.changedBy,
        authVersion: (account?.authVersion ?? 1) + 1,
      };
      return "updated";
    },
  };
}

test("missing and malformed account state is never active", () => {
  assert.equal(accountAccessState(undefined), "missing");
  assert.equal(accountIsActive(undefined), false);
  assert.equal(accountAccessState({ accountId: ACCOUNT_ID, accessState: "unexpected" }), "invalid");
  assert.equal(accountIsActive({ accountId: ACCOUNT_ID, accessState: "unexpected" }), false);
  assert.throws(
    () => publicAccountAccess(undefined),
    (error) => error.code === "account_not_found" && error.statusCode === 404,
  );
});

test("assertActive fails closed for a missing account", async () => {
  const service = createAccountAccessService({ store: ledgerStore(undefined) });
  await assert.rejects(
    () => service.assertActive(ACCOUNT_ID),
    (error) => error.code === "account_access_restricted" && error.statusCode === 403,
  );
});

test("exact access request replay is idempotent", async () => {
  const store = ledgerStore({ accountId: ACCOUNT_ID, authVersion: 4 });
  const service = createAccountAccessService({ store, now: () => Date.parse("2026-08-13T23:00:00Z") });
  const input = {
    accountId: ACCOUNT_ID,
    state: ACCOUNT_ACCESS_SUSPENDED,
    reason: "security review",
    requestId: "req_suspend_1001",
  };

  const first = await service.transition(input);
  const replay = await service.transition(input);

  assert.equal(first.changed, true);
  assert.equal(first.duplicate, false);
  assert.equal(first.state, ACCOUNT_ACCESS_SUSPENDED);
  assert.equal(replay.changed, false);
  assert.equal(replay.duplicate, true);
  assert.equal(replay.requestedState, ACCOUNT_ACCESS_SUSPENDED);
  assert.equal(store.transitions.length, 1);
});

test("request ID reuse with different transition input is rejected", async () => {
  const store = ledgerStore({ accountId: ACCOUNT_ID, authVersion: 4 });
  const service = createAccountAccessService({ store });
  await service.transition({
    accountId: ACCOUNT_ID,
    state: ACCOUNT_ACCESS_SUSPENDED,
    reason: "security review",
    requestId: "req_suspend_1002",
  });

  await assert.rejects(
    () => service.transition({
      accountId: ACCOUNT_ID,
      state: ACCOUNT_ACCESS_SUSPENDED,
      reason: "different reason",
      requestId: "req_suspend_1002",
    }),
    (error) => error.code === "idempotency_conflict" && error.statusCode === 409,
  );
  assert.equal(store.transitions.length, 1);
});

test("new request for current state is a no-op conflict, not a duplicate", async () => {
  const store = ledgerStore({
    accountId: ACCOUNT_ID,
    authVersion: 5,
    accessState: ACCOUNT_ACCESS_SUSPENDED,
  });
  const service = createAccountAccessService({ store });

  await assert.rejects(
    () => service.transition({
      accountId: ACCOUNT_ID,
      state: ACCOUNT_ACCESS_SUSPENDED,
      reason: "another review",
      requestId: "req_suspend_1003",
    }),
    (error) => error.code === "account_access_noop" && error.statusCode === 409,
  );
  assert.equal(store.transitions.length, 0);
});

test("suspension can be cleared but termination is irreversible", async () => {
  const store = ledgerStore({
    accountId: ACCOUNT_ID,
    authVersion: 8,
    accessState: ACCOUNT_ACCESS_SUSPENDED,
  });
  const service = createAccountAccessService({ store });

  const active = await service.transition({
    accountId: ACCOUNT_ID,
    state: ACCOUNT_ACCESS_ACTIVE,
    reason: "review cleared",
    requestId: "req_resume_1001",
  });
  assert.equal(active.state, ACCOUNT_ACCESS_ACTIVE);

  const terminated = await service.transition({
    accountId: ACCOUNT_ID,
    state: ACCOUNT_ACCESS_TERMINATED,
    reason: "account closed",
    requestId: "req_terminate_1001",
  });
  assert.equal(terminated.state, ACCOUNT_ACCESS_TERMINATED);

  await assert.rejects(
    () => service.transition({
      accountId: ACCOUNT_ID,
      state: ACCOUNT_ACCESS_ACTIVE,
      reason: "attempt restore",
      requestId: "req_restore_1001",
    }),
    (error) => error.code === "account_terminated" && error.statusCode === 409,
  );
});
