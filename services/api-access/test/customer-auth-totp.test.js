import assert from "node:assert/strict";
import { scryptSync } from "node:crypto";
import test from "node:test";
import { createCustomerAuthService } from "../src/customer-auth.js";
import { generateTotpCode, totpStep } from "../src/totp.js";

const pepper = "p".repeat(64);
const password = "correct horse battery staple";

function passwordRecord() {
  const saltBytes = Buffer.alloc(16, 9);
  const salt = saltBytes.toString("base64url");
  const hash = scryptSync(password, saltBytes, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url");
  return { passwordScheme: "scrypt-v1", passwordSalt: salt, passwordHash: hash };
}

function fixture({ featureEnabled = true } = {}) {
  let clock = 1_800_000_000_000;
  const account = {
    accountId: `acct_${"a".repeat(32)}`,
    email: "owner@example.com",
    username: "owner",
    authVersion: 1,
    ...passwordRecord(),
  };
  let pending;
  let challenge;
  let session;
  const store = {
    sessionsCreated: 0,
    async reserveSourceRequest() { return "created"; },
    async reserveEmailRequest() { return "created"; },
    async getAccount(accountId) { return accountId === account.accountId ? { ...account } : undefined; },
    async getUsername(username) { return username === account.username ? { accountId: account.accountId } : undefined; },
    async putMagicLink() {},
    async ensureAccount() { return { ...account }; },
    async putSession({ session: created }) { session = created; this.sessionsCreated += 1; },
    async putMfaChallenge({ challenge: created, accountId, email }) {
      challenge = { ...created, accountId, email, attemptCount: 0 };
    },
    async reserveMfaAttempt({ challengeId, limit }) {
      if (!challenge || challenge.challengeId !== challengeId || challenge.attemptCount >= limit) return undefined;
      challenge.attemptCount += 1;
      return { ...challenge };
    },
    async consumeMfaChallengeAndCreateSession({ challenge: presented, session: created, totpStep: step, backupIndex }) {
      if (!challenge || challenge.challengeId !== presented.challengeId) return "conflict";
      if (Number.isSafeInteger(step)) {
        if (Number.isSafeInteger(account.totpLastStep) && step <= account.totpLastStep) return "conflict";
        account.totpLastStep = step;
      } else if (Number.isSafeInteger(backupIndex)) {
        if (!Array.isArray(account.backupCodeFingerprints) || !account.backupCodeFingerprints[backupIndex]) return "conflict";
        account.backupCodeFingerprints.splice(backupIndex, 1);
        account.backupCodeCount -= 1;
      } else return "conflict";
      challenge = undefined;
      session = created;
      this.sessionsCreated += 1;
      return "consumed";
    },
    async putTotpPending(value) { pending = { kind: "totp-pending", ...value }; },
    async getTotpPending(accountId) { return pending?.accountId === accountId ? { ...pending } : undefined; },
    async enableTotp({ secretCiphertext, backupCodeFingerprints, totpStep: step }) {
      account.totpSecretCiphertext = secretCiphertext;
      account.totpEnabledAt = new Date(clock).toISOString();
      account.backupCodeFingerprints = [...backupCodeFingerprints];
      account.backupCodeCount = backupCodeFingerprints.length;
      account.totpLastStep = step;
      account.authVersion += 1;
      pending = undefined;
      return "updated";
    },
    async rotateBackupCodes({ backupCodeFingerprints, proofTotpStep, proofBackupIndex }) {
      if (Number.isSafeInteger(proofTotpStep)) account.totpLastStep = proofTotpStep;
      else if (!Number.isSafeInteger(proofBackupIndex)) return "conflict";
      account.backupCodeFingerprints = [...backupCodeFingerprints];
      account.backupCodeCount = backupCodeFingerprints.length;
      account.authVersion += 1;
      return "updated";
    },
    async disableTotp() {
      delete account.totpSecretCiphertext;
      delete account.totpEnabledAt;
      delete account.totpLastStep;
      delete account.backupCodeFingerprints;
      delete account.backupCodeCount;
      account.authVersion += 1;
      return "updated";
    },
    async getSession() { return session; },
    async revokeSession() {},
    async setCredentials() { return "updated"; },
  };
  const protector = {
    async encrypt(accountId, secret) { return `${accountId}:${secret}`; },
    async decrypt(accountId, ciphertext) { return ciphertext.slice(accountId.length + 1); },
  };
  const service = createCustomerAuthService({
    store,
    emailGateway: { async sendMagicLink() {} },
    pepper,
    siteOrigin: "https://www.solve-lang.com",
    totpFeatureEnabled: featureEnabled,
    totpProtector: featureEnabled ? protector : undefined,
    now: () => clock,
  });
  const authenticatedSession = {
    sessionId: "existing-session",
    accountId: account.accountId,
    email: account.email,
    authVersion: account.authVersion,
  };
  return {
    service,
    store,
    account,
    authenticatedSession,
    advance(milliseconds) { clock += milliseconds; },
    now() { return clock; },
  };
}

test("authenticator enrollment requires password proof and returns ten unique one-time backup codes", async () => {
  const f = fixture();
  const setup = await f.service.beginTotpSetup(f.authenticatedSession);
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.match(setup.otpauthUri, /^otpauth:\/\/totp\//);
  const code = generateTotpCode(setup.secret, totpStep(f.now()));
  const result = await f.service.confirmTotpSetup(f.authenticatedSession, { password, code });
  assert.equal(result.auth.totpEnabled, true);
  assert.equal(result.backupCodes.length, 10);
  assert.equal(new Set(result.backupCodes).size, 10);
  assert.equal(f.account.backupCodeCount, 10);
  for (const plaintext of result.backupCodes) {
    assert.equal(JSON.stringify(f.account).includes(plaintext.replaceAll("-", "")), false);
  }
});

test("password login for a TOTP account creates only a short-lived challenge until a fresh code succeeds", async () => {
  const f = fixture();
  const setup = await f.service.beginTotpSetup(f.authenticatedSession);
  await f.service.confirmTotpSetup(f.authenticatedSession, {
    password,
    code: generateTotpCode(setup.secret, totpStep(f.now())),
  });
  f.advance(31_000);
  const before = f.store.sessionsCreated;
  const first = await f.service.loginWithPassword({ identifier: "owner", password }, { sourceIp: "203.0.113.10" });
  assert.equal(first.mfaRequired, true);
  assert.match(first.challengeToken, /^mfa_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/);
  assert.equal(f.store.sessionsCreated, before);
  const verified = await f.service.verifyMfaChallenge({
    challengeToken: first.challengeToken,
    code: generateTotpCode(setup.secret, totpStep(f.now())),
  }, { sourceIp: "203.0.113.10" });
  assert.equal(verified.mfaRequired, false);
  assert.match(verified.cookie, /^sl_api_session=/);
  assert.equal(f.store.sessionsCreated, before + 1);
});

test("a TOTP step cannot be replayed to satisfy a second login challenge", async () => {
  const f = fixture();
  const setup = await f.service.beginTotpSetup(f.authenticatedSession);
  await f.service.confirmTotpSetup(f.authenticatedSession, {
    password,
    code: generateTotpCode(setup.secret, totpStep(f.now())),
  });
  f.advance(31_000);
  const code = generateTotpCode(setup.secret, totpStep(f.now()));
  const first = await f.service.loginWithPassword({ identifier: "owner", password });
  await f.service.verifyMfaChallenge({ challengeToken: first.challengeToken, code });
  const second = await f.service.loginWithPassword({ identifier: "owner", password });
  await assert.rejects(
    () => f.service.verifyMfaChallenge({ challengeToken: second.challengeToken, code }),
    (error) => error.code === "invalid_mfa",
  );
});

test("backup codes are one-time second factors", async () => {
  const f = fixture();
  const setup = await f.service.beginTotpSetup(f.authenticatedSession);
  const enrolled = await f.service.confirmTotpSetup(f.authenticatedSession, {
    password,
    code: generateTotpCode(setup.secret, totpStep(f.now())),
  });
  const backup = enrolled.backupCodes[0];
  const first = await f.service.loginWithPassword({ identifier: "owner", password });
  await f.service.verifyMfaChallenge({ challengeToken: first.challengeToken, code: backup });
  assert.equal(f.account.backupCodeCount, 9);
  const second = await f.service.loginWithPassword({ identifier: "owner", password });
  await assert.rejects(
    () => f.service.verifyMfaChallenge({ challengeToken: second.challengeToken, code: backup }),
    (error) => error.code === "invalid_mfa",
  );
});

test("TOTP-enabled accounts fail closed when the authenticator feature is unavailable", async () => {
  const f = fixture({ featureEnabled: false });
  f.account.totpSecretCiphertext = "encrypted";
  f.account.totpEnabledAt = new Date(f.now()).toISOString();
  await assert.rejects(
    () => f.service.loginWithPassword({ identifier: "owner", password }),
    (error) => error.statusCode === 503 && error.code === "authenticator_unavailable",
  );
  assert.equal(f.store.sessionsCreated, 0);
});
