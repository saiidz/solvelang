import assert from "node:assert/strict";
import test from "node:test";
import { accountIdForEmail, createCustomerAuthService } from "../src/customer-auth.js";
import { ApiAccessError } from "../src/service.js";

class MemoryAuthStore {
  source = new Map();
  throttle = new Set();
  magic = new Map();
  sessions = new Map();
  accounts = new Map();
  usernames = new Map();

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

  async putMagicLink(record) {
    this.magic.set(record.tokenId, structuredClone(record));
  }

  async consumeMagicLinkAndCreateSession({ tokenId, presentedFingerprint, now, session }) {
    const magic = this.magic.get(tokenId);
    if (!magic || magic.expiresAt <= now || magic.secretFingerprint !== presentedFingerprint) return undefined;
    this.magic.delete(tokenId);
    this.sessions.set(session.sessionId, { ...structuredClone(session), accountId: magic.accountId, email: magic.email });
    return { accountId: magic.accountId, email: magic.email };
  }

  async ensureAccount(record) {
    if (!this.accounts.has(record.accountId)) {
      this.accounts.set(record.accountId, { kind: "account", ...structuredClone(record) });
    }
    return structuredClone(this.accounts.get(record.accountId));
  }

  async getAccount(accountId) {
    const account = this.accounts.get(accountId);
    return account ? structuredClone(account) : undefined;
  }

  async getUsername(username) {
    const accountId = this.usernames.get(username);
    return accountId ? { kind: "username", username, accountId } : undefined;
  }

  async setCredentials(record) {
    const account = this.accounts.get(record.accountId);
    if (!account) return "missing";
    if (account.username && account.username !== record.username) return "username_locked";
    const owner = this.usernames.get(record.username);
    if (owner && owner !== record.accountId) return "conflict";
    this.usernames.set(record.username, record.accountId);
    Object.assign(account, {
      username: record.username,
      passwordSalt: record.passwordSalt,
      passwordHash: record.passwordHash,
      passwordScheme: record.passwordScheme,
      passwordUpdatedAt: record.passwordUpdatedAt,
      updatedAt: record.passwordUpdatedAt,
    });
    return "updated";
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
}

const pepper = "p".repeat(64);
const fixedNow = Date.UTC(2026, 6, 29, 16, 0, 0);
let counter = 1;

function deterministicRandom(size) {
  const output = Buffer.alloc(size, counter);
  counter += 1;
  return output;
}

function setup() {
  counter = 1;
  const store = new MemoryAuthStore();
  const sent = [];
  const service = createCustomerAuthService({
    store,
    emailGateway: { sendMagicLink: async (message) => sent.push(message) },
    pepper,
    siteOrigin: "https://www.solve-lang.com",
    now: () => fixedNow,
    randomBytes: deterministicRandom,
  });
  return { store, sent, service };
}

function tokenFromUrl(url) {
  return decodeURIComponent(new URL(url).hash.replace("#magic_token=", ""));
}

function cookieValue(cookie) {
  return decodeURIComponent(cookie.split(";")[0].split("=")[1]);
}

async function verifiedSession(service, sent, email = "dev@example.com") {
  await service.requestMagicLink({ email }, { sourceIp: "203.0.113.1" });
  return service.verifyMagicLink({ token: tokenFromUrl(sent.at(-1).url) });
}

test("sends a fragment-based, single-use magic link and stores only a fingerprint", async () => {
  const { store, sent, service } = setup();
  assert.deepEqual(await service.requestMagicLink({ email: " Dev@Example.com " }, { sourceIp: "203.0.113.1" }), { accepted: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, "dev@example.com");
  assert.match(sent[0].url, /^https:\/\/www\.solve-lang\.com\/account\/api-keys\/#magic_token=ml_/);
  const token = tokenFromUrl(sent[0].url);
  const stored = [...store.magic.values()][0];
  assert.equal(stored.accountId, accountIdForEmail("dev@example.com", pepper));
  assert.equal(stored.email, "dev@example.com");
  assert.equal(stored.token, undefined);
  assert.ok(!JSON.stringify(stored).includes(token));
});

test("email throttling returns the same generic response and does not send twice", async () => {
  const { sent, service } = setup();
  await service.requestMagicLink({ email: "dev@example.com" }, { sourceIp: "203.0.113.1" });
  assert.deepEqual(await service.requestMagicLink({ email: "dev@example.com" }, { sourceIp: "203.0.113.1" }), { accepted: true });
  assert.equal(sent.length, 1);
});

test("source throttling limits varied recipient addresses without revealing the limit", async () => {
  const { sent, service } = setup();
  for (let index = 0; index < 11; index += 1) {
    assert.deepEqual(
      await service.requestMagicLink({ email: `dev${index}@example.com` }, { sourceIp: "203.0.113.44" }),
      { accepted: true },
    );
  }
  assert.equal(sent.length, 10);
});

test("magic-link verification creates the durable account and session", async () => {
  const { store, sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  assert.equal(verified.email, "dev@example.com");
  assert.match(verified.cookie, /^sl_api_session=sess_/);
  assert.match(verified.cookie, /HttpOnly/);
  assert.match(verified.cookie, /Secure/);
  assert.match(verified.cookie, /SameSite=None/);
  assert.match(verified.cookie, /Partitioned/);
  assert.equal(typeof verified.csrfToken, "string");

  const account = await store.getAccount(verified.accountId);
  assert.equal(account.email, "dev@example.com");
  assert.equal(account.username, undefined);

  const session = await service.authenticate(`other=x; sl_api_session=${encodeURIComponent(cookieValue(verified.cookie))}`);
  assert.equal(session.accountId, verified.accountId);
  assert.equal(session.email, "dev@example.com");
  assert.equal(session.csrfToken, verified.csrfToken);
  service.assertCsrf(session, verified.csrfToken);
  assert.throws(() => service.assertCsrf(session, "wrong"), (error) => error instanceof ApiAccessError && error.code === "invalid_csrf");

  await assert.rejects(
    () => service.verifyMagicLink({ token: tokenFromUrl(sent[0].url) }),
    (error) => error instanceof ApiAccessError && error.code === "invalid_magic_link",
  );
});

test("an authenticated account can enable username/password and then sign in without email", async () => {
  const { sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  const session = {
    accountId: verified.accountId,
    email: verified.email,
    csrfToken: verified.csrfToken,
  };

  assert.deepEqual(await service.getProfile(session), { username: null, passwordConfigured: false });
  assert.deepEqual(
    await service.setCredentials(session, { username: "Dev.User", password: "correct horse battery staple" }),
    { username: "dev.user", passwordConfigured: true },
  );
  assert.deepEqual(await service.getProfile(session), { username: "dev.user", passwordConfigured: true });

  const emailCount = sent.length;
  const byUsername = await service.loginWithPassword(
    { identifier: "DEV.USER", password: "correct horse battery staple" },
    { sourceIp: "203.0.113.2" },
  );
  assert.equal(byUsername.accountId, verified.accountId);
  assert.equal(sent.length, emailCount);

  const byEmail = await service.loginWithPassword(
    { identifier: "DEV@EXAMPLE.COM", password: "correct horse battery staple" },
    { sourceIp: "203.0.113.3" },
  );
  assert.equal(byEmail.accountId, verified.accountId);
  assert.equal(sent.length, emailCount);
});

test("wrong and unknown password logins return the same public error", async () => {
  const { sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  await service.setCredentials(
    { accountId: verified.accountId, email: verified.email },
    { username: "devuser", password: "correct horse battery staple" },
  );

  for (const attempt of [
    { identifier: "devuser", password: "wrong password" },
    { identifier: "missinguser", password: "wrong password" },
  ]) {
    await assert.rejects(
      () => service.loginWithPassword(attempt, { sourceIp: "203.0.113.9" }),
      (error) => error instanceof ApiAccessError
        && error.statusCode === 401
        && error.code === "invalid_credentials"
        && error.publicMessage === "Email/username or password is incorrect.",
    );
  }
});

test("a username is unique and cannot be changed through password reset", async () => {
  const first = setup();
  const firstVerified = await verifiedSession(first.service, first.sent, "first@example.com");
  await first.service.setCredentials(
    { accountId: firstVerified.accountId, email: firstVerified.email },
    { username: "sharedname", password: "correct horse battery staple" },
  );

  const secondAccountId = accountIdForEmail("second@example.com", pepper);
  await first.store.ensureAccount({
    accountId: secondAccountId,
    email: "second@example.com",
    createdAt: new Date(fixedNow).toISOString(),
  });
  await assert.rejects(
    () => first.service.setCredentials(
      { accountId: secondAccountId, email: "second@example.com" },
      { username: "sharedname", password: "different secure password value" },
    ),
    (error) => error instanceof ApiAccessError && error.code === "username_unavailable",
  );

  await assert.rejects(
    () => first.service.setCredentials(
      { accountId: firstVerified.accountId, email: firstVerified.email },
      { username: "renamed", password: "another secure password value" },
    ),
    (error) => error instanceof ApiAccessError && error.code === "username_locked",
  );
});

test("email recovery can replace the password without changing the username", async () => {
  const { sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  const session = { accountId: verified.accountId, email: verified.email };
  await service.setCredentials(session, { username: "devuser", password: "original secure password" });

  await service.setCredentials(session, { username: "devuser", password: "replacement secure password" });
  await assert.rejects(
    () => service.loginWithPassword(
      { identifier: "devuser", password: "original secure password" },
      { sourceIp: "203.0.113.20" },
    ),
    (error) => error instanceof ApiAccessError && error.code === "invalid_credentials",
  );
  const loggedIn = await service.loginWithPassword(
    { identifier: "devuser", password: "replacement secure password" },
    { sourceIp: "203.0.113.21" },
  );
  assert.equal(loggedIn.accountId, verified.accountId);
});

test("logout revokes the server session and clears the partitioned cookie", async () => {
  const { sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  const rawCookie = `sl_api_session=${encodeURIComponent(cookieValue(verified.cookie))}`;
  const cleared = await service.logout(rawCookie);
  assert.match(cleared, /Max-Age=0/);
  assert.match(cleared, /Partitioned/);
  await assert.rejects(
    () => service.authenticate(rawCookie),
    (error) => error instanceof ApiAccessError && error.code === "invalid_session",
  );
});
