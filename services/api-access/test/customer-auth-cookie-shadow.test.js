import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { createCustomerAuthService } from "../src/customer-auth.js";
import { createPriorityCustomerSessionAuth } from "../src/customer-priority-session-auth.js";
import { ApiAccessError } from "../src/service.js";

// Regression coverage for the stale-cookie shadow: a browser jar can
// hold two sl_api_session entries at once — the Domain cookie the
// service sets today and a host-only twin from before it — and may
// present the stale twin first. Authentication must try every
// presented value, sign-in must write the fresh token into both jar
// entries, and logout must clear both.

const STALE_TOKEN = `sess_${"0".repeat(24)}_${"A".repeat(43)}`;

// ---------------------------------------------------------------------------
// customer-auth harness (trimmed mirror of customer-auth.test.js)
// ---------------------------------------------------------------------------

class MemoryAuthStore {
  source = new Map();
  throttle = new Set();
  magic = new Map();
  sessions = new Map();
  accounts = new Map();

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
    const account = this.accounts.get(magic.accountId);
    const currentAuthVersion = account?.authVersion ?? 1;
    const magicAuthVersion = magic.authVersion ?? 1;
    if (magicAuthVersion !== currentAuthVersion) return undefined;
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

function tokenFromSetCookie(cookie) {
  return decodeURIComponent(cookie.split(";")[0].split("=")[1]);
}

async function verifiedSession(service, sent, email = "dev@example.com") {
  await service.requestMagicLink({ email }, { sourceIp: "203.0.113.1" });
  return service.verifyMagicLink({ token: tokenFromUrl(sent.at(-1).url) });
}

function isInvalidSession(error) {
  return error instanceof ApiAccessError && error.code === "invalid_session";
}

// ---------------------------------------------------------------------------
// authenticate(): every presented value gets a chance
// ---------------------------------------------------------------------------

test("authenticate accepts the fresh session when a stale twin is presented first", async () => {
  const { sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  const valid = tokenFromSetCookie(verified.cookie);
  const session = await service.authenticate(`sl_api_session=${STALE_TOKEN}; sl_api_session=${valid}`);
  assert.equal(session.accountId, verified.accountId);
  assert.equal(session.email, "dev@example.com");
});

test("authenticate accepts the fresh session when it is presented first and a stale twin follows", async () => {
  const { sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  const valid = tokenFromSetCookie(verified.cookie);
  const session = await service.authenticate(`sl_api_session=${valid}; sl_api_session=${STALE_TOKEN}`);
  assert.equal(session.accountId, verified.accountId);
});

test("authenticate still fails closed when only a stale twin is presented", async () => {
  const { service } = setup();
  await assert.rejects(() => service.authenticate(`sl_api_session=${STALE_TOKEN}`), isInvalidSession);
  await assert.rejects(() => service.authenticate("sl_api_session=not-a-session"), isInvalidSession);
  await assert.rejects(() => service.authenticate(undefined), isInvalidSession);
  await assert.rejects(() => service.authenticate("other=1"), isInvalidSession);
});

// ---------------------------------------------------------------------------
// emission: sign-in writes the fresh token into both jar entries
// ---------------------------------------------------------------------------

test("sign-in result carries both cookie variants with the same token", async () => {
  const { sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  assert.ok(Array.isArray(verified.cookies));
  assert.equal(verified.cookies.length, 2);
  assert.equal(verified.cookies[0], verified.cookie);
  assert.match(verified.cookies[0], /Domain=\.solve-lang\.com/);
  assert.doesNotMatch(verified.cookies[1], /Domain=/);
  assert.equal(tokenFromSetCookie(verified.cookies[1]), tokenFromSetCookie(verified.cookies[0]));
  for (const cookie of verified.cookies) {
    assert.match(cookie, /^sl_api_session=sess_/);
    assert.match(cookie, /Path=\//);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /Secure/);
    assert.match(cookie, /SameSite=None/);
    assert.match(cookie, /Partitioned/);
  }
});

// ---------------------------------------------------------------------------
// logout: revokes through the shadow and clears both variants
// ---------------------------------------------------------------------------

test("logout with a shadowed header revokes the real session and clears both variants", async () => {
  const { sent, service } = setup();
  const verified = await verifiedSession(service, sent);
  const valid = tokenFromSetCookie(verified.cookie);
  const cleared = await service.logout(`sl_api_session=${STALE_TOKEN}; sl_api_session=${valid}`);
  assert.ok(Array.isArray(cleared));
  assert.equal(cleared.length, 2);
  assert.match(cleared[0], /Max-Age=0/);
  assert.match(cleared[0], /Domain=\.solve-lang\.com/);
  assert.match(cleared[1], /Max-Age=0/);
  assert.doesNotMatch(cleared[1], /Domain=/);
  await assert.rejects(() => service.authenticate(`sl_api_session=${valid}`), isInvalidSession);
});

// ---------------------------------------------------------------------------
// api-handler seam: responses emit every variant the result carries
// ---------------------------------------------------------------------------

function handlerEvent(method, rawPath, body, headers = {}) {
  return {
    rawPath,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, sourceIp: "203.0.113.8" } },
  };
}

test("auth responses emit every cookie variant the auth result carries", async () => {
  const domainCookie = "sl_api_session=sess_test; Path=/; Domain=.solve-lang.com; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=604800";
  const hostOnlyCookie = "sl_api_session=sess_test; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=604800";
  const clearDomain = "sl_api_session=; Path=/; Domain=.solve-lang.com; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0";
  const clearHostOnly = "sl_api_session=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0";
  const session = { accountId: "acct_session", email: "dev@example.com", csrfToken: "csrf_ok" };
  const customerAuth = {
    verifyMagicLink: async () => ({ ...session, mfaRequired: false, cookie: domainCookie, cookies: [domainCookie, hostOnlyCookie] }),
    authenticate: async () => session,
    assertCsrf: () => {},
    logout: async () => [clearDomain, clearHostOnly],
  };
  const handler = createApiAccessHandler({
    service: {},
    enabled: true,
    adminSecret: "a".repeat(64),
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount: {},
    logger: { error() {} },
  });

  const verified = await handler(handlerEvent("POST", "/customer/auth/verify", { token: "ml_test" }));
  assert.equal(verified.statusCode, 200);
  assert.deepEqual(verified.cookies, [domainCookie, hostOnlyCookie]);

  const logoutEvent = handlerEvent("POST", "/customer/auth/logout", undefined, { "x-solvelang-csrf": "csrf_ok" });
  logoutEvent.cookies = ["sl_api_session=sess_test"];
  const loggedOut = await handler(logoutEvent);
  assert.equal(loggedOut.statusCode, 200);
  assert.deepEqual(loggedOut.cookies, [clearDomain, clearHostOnly]);
});

// ---------------------------------------------------------------------------
// priority session auth: same shadow rule on the bridge surface
// ---------------------------------------------------------------------------

const P_ACCOUNT_ID = `acct_${"a".repeat(32)}`;
const P_SESSION_ID = "b".repeat(32);
const P_TOKEN = `sess_${P_SESSION_ID}_${"A".repeat(43)}`;
const P_STALE_TOKEN = `sess_${"c".repeat(32)}_${"B".repeat(43)}`;
const P_PEPPER = "customer-auth-pepper-0123456789-abcdefghijklmnopqrstuvwxyz";

function pDigest(label, value) {
  return createHmac("sha256", P_PEPPER).update(`${label}:${value}`).digest("hex");
}

class FakeDocumentClient {
  constructor(records = {}) {
    this.records = records;
  }

  async send(command) {
    const key = command.input.Key?.authKey;
    return { Item: key ? this.records[key] : undefined };
  }
}

function priorityAuth() {
  const csrf = "csrf-token-1234567890";
  const client = new FakeDocumentClient({
    [`session#${P_SESSION_ID}`]: {
      kind: "session",
      accountId: P_ACCOUNT_ID,
      email: "customer@example.com",
      secretFingerprint: pDigest("session", P_TOKEN),
      csrfFingerprint: pDigest("csrf", csrf),
      csrfToken: csrf,
      authVersion: 1,
      expiresAt: 1_900_000_000,
    },
    [`account#${P_ACCOUNT_ID}`]: {
      kind: "account",
      accountId: P_ACCOUNT_ID,
      email: "customer@example.com",
      authVersion: 1,
    },
  });
  return createPriorityCustomerSessionAuth({
    documentClient: client,
    tableName: "customer-auth",
    pepper: P_PEPPER,
    accountAccess: { async assertActive() {} },
    now: () => 1_800_000_000_000,
  });
}

test("priority session auth accepts the fresh session behind a stale twin", async () => {
  const auth = priorityAuth();
  const session = await auth.authenticate(`sl_api_session=${P_STALE_TOKEN}; sl_api_session=${P_TOKEN}`);
  assert.equal(session.accountId, P_ACCOUNT_ID);
  const sessionFirst = await auth.authenticate(`sl_api_session=${P_TOKEN}; sl_api_session=${P_STALE_TOKEN}`);
  assert.equal(sessionFirst.accountId, P_ACCOUNT_ID);
});

test("priority session auth still fails closed on a stale twin alone", async () => {
  const auth = priorityAuth();
  await assert.rejects(
    () => auth.authenticate(`sl_api_session=${P_STALE_TOKEN}`),
    (error) => error?.statusCode === 401 && error?.code === "session_invalid",
  );
  await assert.rejects(
    () => auth.authenticate("sl_api_session=garbage"),
    (error) => error?.statusCode === 401 && error?.code === "session_required",
  );
  await assert.rejects(
    () => auth.authenticate(undefined),
    (error) => error?.statusCode === 401 && error?.code === "session_required",
  );
});
