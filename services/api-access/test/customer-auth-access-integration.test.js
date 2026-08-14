import assert from "node:assert/strict";
import test from "node:test";
import { accountIdForEmail, createCustomerAuthService } from "../src/customer-auth.js";
import { createAccessGuardedCustomerAuthService } from "../src/customer-auth-access-service.js";
import { createAccessGuardedCustomerAuthStore } from "../src/customer-auth-access-guard.js";

const PEPPER = "p".repeat(64);
const EMAIL = "restricted@example.com";
const ACCOUNT_ID = accountIdForEmail(EMAIL, PEPPER);

test("suspended magic-link request is enumeration-safe and sends no email", async () => {
  let emailCalls = 0;
  let putCalls = 0;
  const account = {
    kind: "account",
    accountId: ACCOUNT_ID,
    email: EMAIL,
    authVersion: 3,
    accessState: "suspended",
  };
  const baseStore = {
    async reserveSourceRequest() { return "created"; },
    async reserveEmailRequest() { return "created"; },
    async getAccount(accountId) { return accountId === ACCOUNT_ID ? account : undefined; },
    async putMagicLink() { putCalls += 1; },
  };
  const reader = {
    async getAccount(accountId) { return accountId === ACCOUNT_ID ? account : undefined; },
    async getRecord() { return undefined; },
  };
  const guardedStore = createAccessGuardedCustomerAuthStore(baseStore, reader);
  const auth = createAccessGuardedCustomerAuthService(createCustomerAuthService({
    store: guardedStore,
    emailGateway: {
      async sendMagicLink() { emailCalls += 1; },
    },
    pepper: PEPPER,
    siteOrigin: "https://www.solve-lang.com",
    now: () => Date.parse("2026-08-14T00:00:00Z"),
  }));

  assert.deepEqual(await auth.requestMagicLink({ email: EMAIL }, { sourceIp: "203.0.113.9" }), { accepted: true });
  assert.equal(putCalls, 0);
  assert.equal(emailCalls, 0);
});
