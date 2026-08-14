import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createAccountIdentityResolver } from "../src/account-identity-resolver.js";
import { accountIdForEmail } from "../src/customer-auth.js";

const PEPPER = "p".repeat(64);
const ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const handlerUrl = new URL("../src/handler.js", import.meta.url);

function fixture(mapping) {
  const calls = [];
  const store = {
    async getUsername(username) {
      calls.push(username);
      return mapping?.[username];
    },
  };
  return {
    resolver: createAccountIdentityResolver({ store, pepper: PEPPER }),
    calls,
  };
}

test("resolves a canonical account ID without touching identity indexes", async () => {
  const { resolver, calls } = fixture();
  assert.deepEqual(await resolver.resolve({ accountId: ACCOUNT_ID }), {
    accountId: ACCOUNT_ID,
    matchedBy: "account_id",
  });
  assert.deepEqual(calls, []);
});

test("derives email identity with the same server-side account mapping used by customer auth", async () => {
  const { resolver, calls } = fixture();
  const email = " Owner.Example@Example.COM ";
  assert.deepEqual(await resolver.resolve({ email }), {
    accountId: accountIdForEmail(email, PEPPER),
    matchedBy: "email",
  });
  assert.deepEqual(calls, []);
});

test("resolves usernames through the canonical username index", async () => {
  const { resolver, calls } = fixture({
    "owner.user": { kind: "username", username: "owner.user", accountId: ACCOUNT_ID },
  });
  assert.deepEqual(await resolver.resolve({ username: " Owner.User " }), {
    accountId: ACCOUNT_ID,
    matchedBy: "username",
  });
  assert.deepEqual(calls, ["owner.user"]);
});

test("rejects missing, ambiguous, malformed, or unknown identity selectors", async () => {
  const { resolver } = fixture();
  await assert.rejects(() => resolver.resolve({}), (error) => error?.code === "invalid_request");
  await assert.rejects(
    () => resolver.resolve({ accountId: ACCOUNT_ID, email: "owner@example.com" }),
    (error) => error?.code === "invalid_request",
  );
  await assert.rejects(
    () => resolver.resolve({ accountId: "acct_not_canonical" }),
    (error) => error?.code === "invalid_request",
  );
  await assert.rejects(
    () => resolver.resolve({ username: "bad username" }),
    (error) => error?.code === "invalid_request",
  );
  await assert.rejects(
    () => resolver.resolve({ username: "missing.user" }),
    (error) => error?.code === "account_not_found",
  );
});

test("fails closed when a username index points to malformed identity state", async () => {
  const { resolver } = fixture({
    owner: { kind: "username", username: "other", accountId: "acct_bad" },
  });
  await assert.rejects(
    () => resolver.resolve({ username: "owner" }),
    (error) => error?.code === "account_identity_state_invalid",
  );
});

test("production handler wires identity lookup to the canonical customer-auth store and admin handler", async () => {
  const source = await readFile(handlerUrl, "utf8");
  assert.match(source, /createAccountIdentityResolver/);
  assert.match(source, /const customerAuthStore = createDynamoCustomerAuthStore/);
  assert.match(source, /store: customerAuthStore/);
  assert.match(source, /pepper: environment\.customerAuthPepper/);
  assert.match(source, /identityResolver: accountIdentityResolver/);
});
