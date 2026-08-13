import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";
import { accountIdForEmail, createCustomerAuthService } from "../src/customer-auth.js";
import { ApiAccessError } from "../src/service.js";

const pepper = "p".repeat(64);
const password = "correct horse battery staple";
const email = "owner@example.com";

function passwordFields() {
  const saltBytes = Buffer.alloc(16, 7);
  return {
    passwordScheme: "scrypt-v1",
    passwordSalt: saltBytes.toString("base64url"),
    passwordHash: scryptSync(password, saltBytes, 32, {
      N: 32768,
      r: 8,
      p: 1,
      maxmem: 64 * 1024 * 1024,
    }).toString("base64url"),
  };
}

function serviceFor(account) {
  let sessionsCreated = 0;
  const service = createCustomerAuthService({
    store: {
      async reserveSourceRequest() { return "created"; },
      async reserveEmailRequest() { return "created"; },
      async getUsername(username) { return username === account.username ? { accountId: account.accountId } : undefined; },
      async getAccount(accountId) { return accountId === account.accountId ? { ...account } : undefined; },
      async putSession() { sessionsCreated += 1; },
      async putMfaChallenge() { throw new Error("Partial TOTP state must fail before an MFA challenge is stored."); },
    },
    emailGateway: { async sendMagicLink() {} },
    pepper,
    siteOrigin: "https://www.solve-lang.com",
    totpFeatureEnabled: true,
    totpProtector: {
      async encrypt() { return "ciphertext"; },
      async decrypt() { return "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"; },
    },
  });
  return { service, sessionsCreated: () => sessionsCreated };
}

test("password login fails closed when only totpEnabledAt is present", async () => {
  const account = {
    accountId: accountIdForEmail(email, pepper),
    email,
    username: "owner",
    authVersion: 2,
    ...passwordFields(),
    totpEnabledAt: "2026-08-13T05:00:00.000Z",
  };
  const fixture = serviceFor(account);
  await assert.rejects(
    () => fixture.service.loginWithPassword({ identifier: "owner", password }, { sourceIp: "203.0.113.90" }),
    (error) => error instanceof ApiAccessError
      && error.statusCode === 503
      && error.code === "authenticator_state_invalid",
  );
  assert.equal(fixture.sessionsCreated(), 0);
});

test("password login and profile reads fail closed when only TOTP ciphertext is present", async () => {
  const account = {
    accountId: accountIdForEmail(email, pepper),
    email,
    username: "owner",
    authVersion: 2,
    ...passwordFields(),
    totpSecretCiphertext: "encrypted-secret",
  };
  const fixture = serviceFor(account);
  await assert.rejects(
    () => fixture.service.loginWithPassword({ identifier: email, password }, { sourceIp: "203.0.113.91" }),
    (error) => error instanceof ApiAccessError
      && error.statusCode === 503
      && error.code === "authenticator_state_invalid",
  );
  await assert.rejects(
    () => fixture.service.getProfile({ accountId: account.accountId }),
    (error) => error instanceof ApiAccessError
      && error.statusCode === 503
      && error.code === "authenticator_state_invalid",
  );
  assert.equal(fixture.sessionsCreated(), 0);
});
