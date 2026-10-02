import assert from "node:assert/strict";
import { createHmac, scryptSync } from "node:crypto";
import test from "node:test";
import { createAccountIdentityResolver } from "../src/account-identity-resolver.js";
import { parseApiAccessEnvironment, parseApiKeyAuthorizerEnvironment } from "../src/config.js";
import { accountIdForEmail, createCustomerAuthService } from "../src/customer-auth.js";
import { createPriorityCustomerSessionAuth } from "../src/customer-priority-session-auth.js";
import { fingerprintApiKey, parseApiKey } from "../src/keys.js";
import { createApiAccessService } from "../src/service.js";
import { generateTotpCode, totpStep } from "../src/totp.js";

// Dual-read pepper rotation: verification accepts fingerprints minted under
// the current pepper or (during a window) the previous pepper; issuance
// always uses the current pepper. OLD = pre-rotation, NEW = post-rotation.
const OLD_PEPPER = "o".repeat(64);
const NEW_PEPPER = "n".repeat(64);
const fixedNow = Date.UTC(2026, 6, 29, 16, 0, 0);
let counter = 1;

function deterministicRandom(size) {
  const output = Buffer.alloc(size, counter);
  counter += 1;
  return output;
}

function digest(pepper, purpose, value) {
  return createHmac("sha256", pepper).update(`${purpose}:${value}`).digest("hex");
}

function tokenFromUrl(url) {
  return decodeURIComponent(new URL(url).hash.replace("#magic_token=", ""));
}

function cookieToken(cookie) {
  const pair = cookie.split(";")[0];
  return decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
}

// ---------------------------------------------------------------------------
// Config wiring
// ---------------------------------------------------------------------------

function fullEnvironment(overrides = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_ACCESS_MODE: "live",
    API_KEY_PEPPER: "k".repeat(64),
    API_ACCESS_ADMIN_SECRET: "a".repeat(64),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    API_CUSTOMER_ACCOUNTS_ENABLED: "true",
    API_CUSTOMER_AUTH_TABLE: "auth",
    API_CUSTOMER_AUTH_PEPPER: "c".repeat(64),
    API_CUSTOMER_AUTH_EMAIL_SENDER: "hello@example.com",
    SITE_ORIGIN: "https://www.solve-lang.com",
    ...overrides,
  };
}

test("config: previous peppers are unset by default and parsed when valid", () => {
  const environment = parseApiAccessEnvironment(fullEnvironment());
  assert.equal(environment.previousPepper, undefined);
  assert.equal(environment.customerAuthPreviousPepper, undefined);

  const rotating = parseApiAccessEnvironment(fullEnvironment({
    API_KEY_PEPPER_PREVIOUS: OLD_PEPPER,
    API_CUSTOMER_AUTH_PEPPER_PREVIOUS: OLD_PEPPER,
  }));
  assert.equal(rotating.previousPepper, OLD_PEPPER);
  assert.equal(rotating.customerAuthPreviousPepper, OLD_PEPPER);

  const blank = parseApiAccessEnvironment(fullEnvironment({ API_KEY_PEPPER_PREVIOUS: "" }));
  assert.equal(blank.previousPepper, undefined);

  assert.throws(
    () => parseApiAccessEnvironment(fullEnvironment({ API_KEY_PEPPER_PREVIOUS: "too-short" })),
    /API_KEY_PEPPER_PREVIOUS must contain at least 32 characters/,
  );
  assert.throws(
    () => parseApiAccessEnvironment(fullEnvironment({ API_CUSTOMER_AUTH_PEPPER_PREVIOUS: "too-short" })),
    /API_CUSTOMER_AUTH_PEPPER_PREVIOUS must contain at least 32 characters/,
  );
});

test("config: authorizer environment carries the previous key pepper", () => {
  const parsed = parseApiKeyAuthorizerEnvironment({
    API_KEY_PEPPER: "k".repeat(64),
    API_KEY_PEPPER_PREVIOUS: OLD_PEPPER,
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
    SITE_ORIGIN: "https://www.solve-lang.com",
  });
  assert.equal(parsed.previousPepper, OLD_PEPPER);
});

test("services reject a too-short previous pepper at construction", () => {
  assert.throws(
    () => createApiAccessService({ store: {}, pepper: NEW_PEPPER, previousPepper: "short", mode: "test" }),
    /Previous API key pepper must contain at least 32 characters/,
  );
  assert.throws(
    () => createCustomerAuthService({
      store: {},
      emailGateway: { sendMagicLink: async () => {} },
      pepper: NEW_PEPPER,
      previousPepper: "short",
      siteOrigin: "https://www.solve-lang.com",
    }),
    /Previous customer authentication pepper must contain at least 32 characters/,
  );
});

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

class KeyStore {
  accounts = new Map();
  keys = new Map();

  async putAccount(account) { this.accounts.set(account.accountId, structuredClone(account)); }
  async getAccount(accountId) {
    const account = this.accounts.get(accountId);
    return account ? structuredClone(account) : undefined;
  }
  async putKeyWithLimit(key) {
    if (this.keys.has(key.keyId)) return "key_collision";
    const account = this.accounts.get(key.accountId);
    if ((account.activeKeyCount ?? 0) >= 5) return "limit_reached";
    account.activeKeyCount = (account.activeKeyCount ?? 0) + 1;
    this.keys.set(key.keyId, structuredClone(key));
    return "created";
  }
  async getKey(keyId) {
    const key = this.keys.get(keyId);
    return key ? structuredClone(key) : undefined;
  }
  async touchKey(keyId, lastUsedAt) {
    const key = this.keys.get(keyId);
    if (key) key.lastUsedAt = lastUsedAt;
  }
}

async function provisionedService(store, options) {
  const service = createApiAccessService({ store, mode: "test", now: () => fixedNow, randomBytes: deterministicRandom, ...options });
  await service.provisionSubscription({
    accountId: "acct_test_1",
    email: "dev@example.com",
    stripeCustomerId: "cus_test_1",
    stripeSubscriptionId: "sub_test_1",
    plan: "developer",
    subscriptionStatus: "active",
    currentPeriodEnd: fixedNow + 30 * 24 * 60 * 60 * 1_000,
  });
  return service;
}

test("api keys: pre-rotation keys verify during the window, new keys mint under the current pepper", async () => {
  counter = 1;
  const store = new KeyStore();
  const before = await provisionedService(store, { pepper: OLD_PEPPER });
  const legacy = await before.issueApiKey({ accountId: "acct_test_1", name: "legacy" });
  const legacyParsed = parseApiKey(legacy.apiKey);
  assert.equal((await store.getKey(legacyParsed.keyId)).secretFingerprint, fingerprintApiKey({ ...legacyParsed, pepper: OLD_PEPPER }));

  const rotating = createApiAccessService({
    store, pepper: NEW_PEPPER, previousPepper: OLD_PEPPER, mode: "test", now: () => fixedNow, randomBytes: deterministicRandom,
  });
  const recognized = await rotating.authorize({ authorization: `Bearer ${legacy.apiKey}`, requiredScope: "repository:audit" });
  assert.equal(recognized.keyId, legacyParsed.keyId);

  const fresh = await rotating.issueApiKey({ accountId: "acct_test_1", name: "fresh" });
  const freshParsed = parseApiKey(fresh.apiKey);
  const freshFingerprint = (await store.getKey(freshParsed.keyId)).secretFingerprint;
  assert.equal(freshFingerprint, fingerprintApiKey({ ...freshParsed, pepper: NEW_PEPPER }));
  assert.notEqual(freshFingerprint, fingerprintApiKey({ ...freshParsed, pepper: OLD_PEPPER }));
});

test("api keys: without a previous pepper, pre-rotation keys are rejected exactly as before", async () => {
  counter = 1;
  const store = new KeyStore();
  const before = await provisionedService(store, { pepper: OLD_PEPPER });
  const legacy = await before.issueApiKey({ accountId: "acct_test_1", name: "legacy" });

  const strict = createApiAccessService({
    store, pepper: NEW_PEPPER, mode: "test", now: () => fixedNow, randomBytes: deterministicRandom,
  });
  await assert.rejects(
    () => strict.authorize({ authorization: `Bearer ${legacy.apiKey}`, requiredScope: "repository:audit" }),
    (error) => error.code === "invalid_api_key",
  );
});

// ---------------------------------------------------------------------------
// Customer auth (magic links, sessions, account-ID fallback)
// ---------------------------------------------------------------------------

class AuthStore {
  source = new Map();
  throttle = new Set();
  magic = new Map();
  sessions = new Map();
  accounts = new Map();
  usernames = new Map();
  mfaChallenges = new Map();
  totpPending;

  async reserveSourceRequest({ sourceKey, window, limit }) {
    const key = `${sourceKey}:${window}`;
    const count = this.source.get(key) ?? 0;
    if (count >= limit) return "limited";
    this.source.set(key, count + 1);
    return "created";
  }

  async reserveEmailRequest({ throttleKey }) {
    if (this.throttle.has(throttleKey)) return "limited";
    this.throttle.add(throttleKey);
    return "created";
  }

  async putMagicLink(record) { this.magic.set(record.tokenId, structuredClone(record)); }

  async consumeMagicLinkAndCreateSession({ tokenId, presentedFingerprint, now, session }) {
    const magic = this.magic.get(tokenId);
    if (!magic || magic.expiresAt <= now || magic.secretFingerprint !== presentedFingerprint) return undefined;
    const account = this.accounts.get(magic.accountId);
    const currentAuthVersion = account?.authVersion ?? 1;
    if ((magic.authVersion ?? 1) !== currentAuthVersion) return undefined;
    this.magic.delete(tokenId);
    this.sessions.set(session.sessionId, {
      ...structuredClone(session),
      accountId: magic.accountId,
      email: magic.email,
      authVersion: currentAuthVersion,
    });
    return { accountId: magic.accountId, email: magic.email, authVersion: currentAuthVersion };
  }

  async ensureAccount(record) {
    if (!this.accounts.has(record.accountId)) {
      this.accounts.set(record.accountId, { kind: "account", authVersion: 1, ...structuredClone(record) });
    }
    return structuredClone(this.accounts.get(record.accountId));
  }

  async getAccount(accountId) {
    const account = this.accounts.get(accountId);
    return account ? structuredClone(account) : undefined;
  }

  async getUsername(username) {
    const accountId = this.usernames.get(username);
    return accountId ? { accountId } : undefined;
  }

  async putSession({ session, accountId, email }) {
    this.sessions.set(session.sessionId, { ...structuredClone(session), accountId, email });
  }

  async getSession(sessionId) {
    const session = this.sessions.get(sessionId);
    return session?.revokedAt ? undefined : structuredClone(session);
  }

  async revokeSession(sessionId, revokedAt) {
    const session = this.sessions.get(sessionId);
    if (session) session.revokedAt = revokedAt;
  }

  async putTotpPending(record) { this.totpPending = structuredClone(record); }
  async getTotpPending(accountId) {
    return this.totpPending?.accountId === accountId ? structuredClone(this.totpPending) : undefined;
  }

  async enableTotp({ accountId, secretCiphertext, enabledAt, backupCodeFingerprints, totpStep }) {
    const account = this.accounts.get(accountId);
    account.totpSecretCiphertext = secretCiphertext;
    account.totpEnabledAt = enabledAt;
    account.backupCodeFingerprints = [...backupCodeFingerprints];
    account.backupCodeCount = backupCodeFingerprints.length;
    account.totpLastStep = totpStep;
    account.authVersion = (account.authVersion ?? 1) + 1;
    this.totpPending = undefined;
    return "updated";
  }

  async putMfaChallenge({ challenge, accountId, email }) {
    this.mfaChallenges.set(challenge.challengeId, { ...structuredClone(challenge), accountId, email, attemptCount: 0 });
  }

  async reserveMfaAttempt({ challengeId, presentedFingerprint, now, limit }) {
    const challenge = this.mfaChallenges.get(challengeId);
    if (!challenge || challenge.expiresAt <= now || challenge.secretFingerprint !== presentedFingerprint) return undefined;
    if ((challenge.attemptCount ?? 0) >= limit) return undefined;
    challenge.attemptCount += 1;
    return structuredClone(challenge);
  }

  async consumeMfaChallengeAndCreateSession({ challenge, presentedFingerprint, session, totpStep, backupIndex, backupCodeFingerprint }) {
    const stored = this.mfaChallenges.get(challenge.challengeId);
    if (!stored || stored.secretFingerprint !== presentedFingerprint) return "conflict";
    const account = this.accounts.get(challenge.accountId);
    if (Number.isSafeInteger(totpStep)) {
      if (Number.isSafeInteger(account.totpLastStep) && totpStep <= account.totpLastStep) return "conflict";
      account.totpLastStep = totpStep;
    } else if (Number.isSafeInteger(backupIndex) && typeof backupCodeFingerprint === "string") {
      if (account.backupCodeFingerprints?.[backupIndex] !== backupCodeFingerprint) return "conflict";
      account.backupCodeFingerprints.splice(backupIndex, 1);
      account.backupCodeCount -= 1;
    } else return "conflict";
    this.mfaChallenges.delete(challenge.challengeId);
    this.sessions.set(session.sessionId, {
      ...structuredClone(session),
      accountId: challenge.accountId,
      email: challenge.email,
    });
    return "consumed";
  }
}

function authService(store, sent, peppers, extra = {}) {
  return createCustomerAuthService({
    store,
    emailGateway: { sendMagicLink: async (message) => sent.push(message) },
    siteOrigin: "https://www.solve-lang.com",
    now: () => fixedNow,
    randomBytes: deterministicRandom,
    ...peppers,
    ...extra,
  });
}

test("customer auth: sessions and magic links minted under the previous pepper verify during the window", async () => {
  counter = 1;
  const store = new AuthStore();
  const sent = [];
  const email = "owner@example.com";
  const before = authService(store, sent, { pepper: OLD_PEPPER });

  // Session minted pre-rotation.
  await before.requestMagicLink({ email }, { sourceIp: "203.0.113.1" });
  const firstLogin = await before.verifyMagicLink({ token: tokenFromUrl(sent[0].url) });
  const legacyCookie = firstLogin.cookie;

  // Magic link minted pre-rotation (for another user) but not yet consumed.
  await before.requestMagicLink({ email: "second@example.com" }, { sourceIp: "203.0.113.1" });
  const unconsumedToken = tokenFromUrl(sent[1].url);

  const rotating = authService(store, sent, { pepper: NEW_PEPPER, previousPepper: OLD_PEPPER });
  const authenticated = await rotating.authenticate(legacyCookie);
  assert.equal(authenticated.accountId, accountIdForEmail(email, OLD_PEPPER));

  const consumed = await rotating.verifyMagicLink({ token: unconsumedToken });
  const rotatedSession = [...store.sessions.values()].at(-1);
  assert.equal(rotatedSession.secretFingerprint, digest(NEW_PEPPER, "session", cookieToken(consumed.cookie)));

  // Issuance stayed current-only: the new session authenticates without the window.
  const strict = authService(store, sent, { pepper: NEW_PEPPER });
  const strictAuth = await strict.authenticate(consumed.cookie);
  assert.equal(strictAuth.accountId, accountIdForEmail("second@example.com", OLD_PEPPER));
});

test("customer auth: without a previous pepper, pre-rotation sessions fail exactly as before", async () => {
  counter = 1;
  const store = new AuthStore();
  const sent = [];
  const email = "owner@example.com";
  const before = authService(store, sent, { pepper: OLD_PEPPER });
  await before.requestMagicLink({ email }, { sourceIp: "203.0.113.1" });
  const login = await before.verifyMagicLink({ token: tokenFromUrl(sent[0].url) });

  const strict = authService(store, sent, { pepper: NEW_PEPPER });
  await assert.rejects(
    () => strict.authenticate(login.cookie),
    (error) => error.code === "invalid_session",
  );
});

test("customer auth: email lookups fall back to the previous-pepper account ID during the window", async () => {
  counter = 1;
  const store = new AuthStore();
  const sent = [];
  const email = "owner@example.com";
  const before = authService(store, sent, { pepper: OLD_PEPPER });
  await before.requestMagicLink({ email }, { sourceIp: "203.0.113.1" });
  await before.verifyMagicLink({ token: tokenFromUrl(sent[0].url) });
  assert.ok(store.accounts.has(accountIdForEmail(email, OLD_PEPPER)));

  sent.length = 0;
  const rotating = authService(store, sent, { pepper: NEW_PEPPER, previousPepper: OLD_PEPPER });
  await rotating.requestMagicLink({ email }, { sourceIp: "203.0.113.1" });
  const magicRecord = [...store.magic.values()].at(-1);
  assert.equal(magicRecord.accountId, accountIdForEmail(email, OLD_PEPPER));

  // A brand-new email still binds to the current-pepper ID.
  const freshEmail = "new@example.com";
  await rotating.requestMagicLink({ email: freshEmail }, { sourceIp: "203.0.113.1" });
  const freshRecord = [...store.magic.values()].at(-1);
  assert.equal(freshRecord.accountId, accountIdForEmail(freshEmail, NEW_PEPPER));
});

// ---------------------------------------------------------------------------
// Customer auth: MFA challenges + backup codes minted pre-rotation
// ---------------------------------------------------------------------------

function passwordRecord(password) {
  const saltBytes = Buffer.alloc(16, 9);
  const salt = saltBytes.toString("base64url");
  const hash = scryptSync(password, saltBytes, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString("base64url");
  return { passwordScheme: "scrypt-v1", passwordSalt: salt, passwordHash: hash };
}

test("customer auth: MFA challenges and backup codes minted pre-rotation verify during the window", async () => {
  counter = 1;
  const store = new AuthStore();
  const sent = [];
  const email = "owner@example.com";
  const password = "correct horse battery staple";
  const accountId = accountIdForEmail(email, OLD_PEPPER);
  store.accounts.set(accountId, {
    accountId,
    email,
    username: "owner",
    authVersion: 1,
    ...passwordRecord(password),
  });
  const protector = {
    async encrypt(id, secret) { return `${id}:${secret}`; },
    async decrypt(id, ciphertext) { return ciphertext.slice(id.length + 1); },
  };
  const totp = { totpFeatureEnabled: true, totpProtector: protector };

  const before = authService(store, sent, { pepper: OLD_PEPPER }, totp);
  const sessionStub = { sessionId: "existing-session", accountId, email };
  const setup = await before.beginTotpSetup(sessionStub);
  const confirmed = await before.confirmTotpSetup(sessionStub, {
    password,
    code: generateTotpCode(setup.secret, totpStep(fixedNow)),
  });
  assert.equal(confirmed.backupCodes.length, 10);

  // Challenge minted pre-rotation via password login.
  const login = await before.loginWithPassword({ identifier: email, password }, { sourceIp: "203.0.113.1" });
  assert.equal(login.mfaRequired, true);

  // During the window the challenge (old-pepper fingerprint) reserves, and a
  // backup code minted under the old pepper authenticates. The session it
  // creates is minted under the new pepper.
  const rotating = authService(store, sent, { pepper: NEW_PEPPER, previousPepper: OLD_PEPPER }, totp);
  const result = await rotating.verifyMfaChallenge(
    { challengeToken: login.challengeToken, code: confirmed.backupCodes[0] },
    { sourceIp: "203.0.113.1" },
  );
  assert.ok(result.cookie);
  const createdSession = [...store.sessions.values()].at(-1);
  assert.equal(createdSession.secretFingerprint, digest(NEW_PEPPER, "session", cookieToken(result.cookie)));
  assert.equal(store.accounts.get(accountId).backupCodeCount, 9);

  // Without the window, a second pre-rotation challenge cannot be used.
  const secondLogin = await before.loginWithPassword({ identifier: email, password }, { sourceIp: "203.0.113.1" });
  const strict = authService(store, sent, { pepper: NEW_PEPPER }, totp);
  await assert.rejects(
    () => strict.verifyMfaChallenge(
      { challengeToken: secondLogin.challengeToken, code: confirmed.backupCodes[1] },
      { sourceIp: "203.0.113.1" },
    ),
    (error) => error.code === "invalid_mfa_challenge",
  );
});

// ---------------------------------------------------------------------------
// Identity resolver
// ---------------------------------------------------------------------------

test("identity resolver: email resolution prefers the previous-pepper ID when it exists during the window", async () => {
  const email = "owner@example.com";
  const store = {
    async getUsername() { return undefined; },
    async getAccount(accountId) {
      return accountId === accountIdForEmail(email, OLD_PEPPER) ? { accountId } : undefined;
    },
  };

  const rotating = createAccountIdentityResolver({ store, pepper: NEW_PEPPER, previousPepper: OLD_PEPPER });
  assert.equal((await rotating.resolve({ email })).accountId, accountIdForEmail(email, OLD_PEPPER));

  const strict = createAccountIdentityResolver({ store, pepper: NEW_PEPPER });
  assert.equal((await strict.resolve({ email })).accountId, accountIdForEmail(email, NEW_PEPPER));
});

// ---------------------------------------------------------------------------
// Priority runtime session auth
// ---------------------------------------------------------------------------

test("priority session auth: session and CSRF fingerprints minted pre-rotation verify during the window", async () => {
  const token = `sess_${"a".repeat(32)}_${"b".repeat(43)}`;
  const csrfToken = "csrf-token-value";
  const session = {
    kind: "session",
    accountId: `acct_${"c".repeat(32)}`,
    email: "owner@example.com",
    authVersion: 1,
    expiresAt: Math.floor(fixedNow / 1_000) + 3_600,
    secretFingerprint: digest(OLD_PEPPER, "session", token),
    csrfFingerprint: digest(OLD_PEPPER, "csrf", csrfToken),
  };
  const account = { kind: "account", accountId: session.accountId, email: session.email, authVersion: 1 };
  const documentClient = {
    async send(command) {
      const key = command.input.Key.authKey;
      if (key === `session#${"a".repeat(32)}`) return { Item: session };
      if (key === `account#${session.accountId}`) return { Item: account };
      return {};
    },
  };
  const accountAccess = { async assertActive() {} };

  const rotating = createPriorityCustomerSessionAuth({
    documentClient, tableName: "auth", pepper: NEW_PEPPER, previousPepper: OLD_PEPPER, accountAccess, now: () => fixedNow,
  });
  const authenticated = await rotating.authenticate(`sl_api_session=${token}`);
  rotating.assertCsrf(authenticated, csrfToken);

  const strict = createPriorityCustomerSessionAuth({
    documentClient, tableName: "auth", pepper: NEW_PEPPER, accountAccess, now: () => fixedNow,
  });
  await assert.rejects(
    () => strict.authenticate(`sl_api_session=${token}`),
    (error) => error.code === "session_invalid",
  );
});
