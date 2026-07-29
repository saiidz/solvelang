import assert from "node:assert/strict";
import test from "node:test";
import { accountIdForEmail, createCustomerAuthService } from "../src/customer-auth.js";
import { ApiAccessError } from "../src/service.js";

class MemoryAuthStore {
  throttle = new Set();
  magic = new Map();
  sessions = new Map();

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

test("sends a fragment-based, single-use magic link and stores only a fingerprint", async () => {
  const { store, sent, service } = setup();
  assert.deepEqual(await service.requestMagicLink({ email: " Dev@Example.com " }), { accepted: true });
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
  await service.requestMagicLink({ email: "dev@example.com" });
  assert.deepEqual(await service.requestMagicLink({ email: "dev@example.com" }), { accepted: true });
  assert.equal(sent.length, 1);
});

test("verifies once, sets a secure HttpOnly cookie, and authenticates the session", async () => {
  const { sent, service } = setup();
  await service.requestMagicLink({ email: "dev@example.com" });
  const token = tokenFromUrl(sent[0].url);
  const verified = await service.verifyMagicLink({ token });
  assert.equal(verified.email, "dev@example.com");
  assert.match(verified.cookie, /^sl_api_session=sess_/);
  assert.match(verified.cookie, /HttpOnly/);
  assert.match(verified.cookie, /Secure/);
  assert.match(verified.cookie, /SameSite=Lax/);
  assert.equal(typeof verified.csrfToken, "string");

  const session = await service.authenticate(`other=x; sl_api_session=${encodeURIComponent(cookieValue(verified.cookie))}`);
  assert.equal(session.accountId, verified.accountId);
  assert.equal(session.email, "dev@example.com");
  assert.equal(session.csrfToken, verified.csrfToken);
  service.assertCsrf(session, verified.csrfToken);
  assert.throws(() => service.assertCsrf(session, "wrong"), (error) => error instanceof ApiAccessError && error.code === "invalid_csrf");

  await assert.rejects(() => service.verifyMagicLink({ token }), (error) => error instanceof ApiAccessError && error.code === "invalid_magic_link");
});

test("logout revokes the server session and clears the cookie", async () => {
  const { sent, service } = setup();
  await service.requestMagicLink({ email: "dev@example.com" });
  const verified = await service.verifyMagicLink({ token: tokenFromUrl(sent[0].url) });
  const rawCookie = `sl_api_session=${encodeURIComponent(cookieValue(verified.cookie))}`;
  const cleared = await service.logout(rawCookie);
  assert.match(cleared, /Max-Age=0/);
  await assert.rejects(() => service.authenticate(rawCookie), (error) => error instanceof ApiAccessError && error.code === "invalid_session");
});
