import assert from "node:assert/strict";
import test from "node:test";
import { accountIdForEmail, createCustomerAuthService } from "../src/customer-auth.js";

const pepper = "p".repeat(64);
const email = "owner@example.com";

test("starting authenticator setup again replaces the pending secret", async () => {
  const account = {
    accountId: accountIdForEmail(email, pepper),
    email,
    username: "owner",
    authVersion: 1,
    passwordScheme: "scrypt-v1",
    passwordSalt: "configured",
    passwordHash: "configured",
  };
  let pending;
  let fill = 1;
  const service = createCustomerAuthService({
    store: {
      async getAccount(accountId) { return accountId === account.accountId ? { ...account } : undefined; },
      async putTotpPending(value) { pending = { ...value }; },
    },
    emailGateway: { async sendMagicLink() {} },
    pepper,
    siteOrigin: "https://www.solve-lang.com",
    totpFeatureEnabled: true,
    totpProtector: {
      async encrypt(accountId, secret) { return `${accountId}:${secret}`; },
      async decrypt(accountId, ciphertext) { return ciphertext.slice(accountId.length + 1); },
    },
    randomBytes(size) {
      const bytes = Buffer.alloc(size, fill);
      fill += 1;
      return bytes;
    },
    now: () => 1_800_000_000_000,
  });
  const session = { sessionId: "session", accountId: account.accountId, email };

  const first = await service.beginTotpSetup(session);
  const firstCiphertext = pending.secretCiphertext;
  const second = await service.beginTotpSetup(session);

  assert.notEqual(second.secret, first.secret);
  assert.notEqual(pending.secretCiphertext, firstCiphertext);
  assert.equal(pending.secretCiphertext.endsWith(second.secret), true);
  assert.equal(second.otpauthUri.includes(second.secret), true);
  assert.equal(second.otpauthUri.includes(first.secret), false);
});
