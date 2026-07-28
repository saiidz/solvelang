import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessService, ApiAccessError } from "../src/service.js";
import { fingerprintApiKey, parseApiKey } from "../src/keys.js";

class MemoryStore {
  accounts = new Map();
  keys = new Map();
  usage = new Map();
  idempotency = new Set();

  async putAccount(account) { this.accounts.set(account.accountId, structuredClone(account)); }
  async getAccount(accountId) { return structuredClone(this.accounts.get(accountId)); }
  async listKeys(accountId) { return [...this.keys.values()].filter((key) => key.accountId === accountId).map((key) => structuredClone(key)); }
  async putKey(key) {
    if (this.keys.has(key.keyId)) throw new Error("duplicate key id");
    this.keys.set(key.keyId, structuredClone(key));
  }
  async getKey(keyId) { return structuredClone(this.keys.get(keyId)); }
  async revokeKey(keyId, accountId, revokedAt) {
    const key = this.keys.get(keyId);
    if (!key || key.accountId !== accountId) throw new Error("key missing");
    key.revokedAt = revokedAt;
  }
  async touchKey(keyId, lastUsedAt) {
    const key = this.keys.get(keyId);
    if (key) key.lastUsedAt = lastUsedAt;
  }
  async consumeUsage({ accountId, period, units, limit, idempotencyKey }) {
    const dedupeKey = `${accountId}:${period}:${idempotencyKey}`;
    const usageKey = `${accountId}:${period}`;
    const current = this.usage.get(usageKey) ?? 0;
    if (this.idempotency.has(dedupeKey)) return { status: "duplicate", used: current };
    if (current + units > limit) return { status: "quota_exceeded", used: current };
    this.idempotency.add(dedupeKey);
    this.usage.set(usageKey, current + units);
    return { status: "consumed", used: current + units };
  }
}

const pepper = "p".repeat(64);
const fixedNow = Date.UTC(2026, 6, 28, 12, 0, 0);
let randomCounter = 1;
function deterministicRandom(size) {
  const output = Buffer.alloc(size, randomCounter);
  randomCounter += 1;
  return output;
}

async function activeService(plan = "developer") {
  randomCounter = 1;
  const store = new MemoryStore();
  const service = createApiAccessService({ store, pepper, mode: "test", now: () => fixedNow, randomBytes: deterministicRandom });
  await service.provisionSubscription({
    accountId: "acct_test_1",
    email: "Dev@example.com",
    stripeCustomerId: "cus_test_1",
    stripeSubscriptionId: "sub_test_1",
    plan,
    subscriptionStatus: "active",
    currentPeriodEnd: fixedNow + 30 * 24 * 60 * 60 * 1_000,
  });
  return { store, service };
}

test("issues a one-time API key and stores only its fingerprint", async () => {
  const { store, service } = await activeService();
  const issued = await service.issueApiKey({ accountId: "acct_test_1", name: "Production server" });
  assert.match(issued.apiKey, /^sl_test_[a-f0-9]{24}_[A-Za-z0-9_-]{43}$/);
  assert.match(issued.env, /^SOLVELANG_API_KEY=sl_test_/);
  assert.ok(issued.env.includes("SOLVELANG_API_BASE=https://api.solve-lang.com/v1"));

  const parsed = parseApiKey(issued.apiKey);
  const stored = await store.getKey(parsed.keyId);
  assert.equal(stored.accountId, "acct_test_1");
  assert.equal(stored.secret, undefined);
  assert.equal(stored.apiKey, undefined);
  assert.equal(stored.secretFingerprint, fingerprintApiKey({ ...parsed, pepper }));
  assert.ok(!JSON.stringify(stored).includes(parsed.secret));
});

test("authorizes valid bearer keys and rejects substitutions, wrong modes, and missing scopes", async () => {
  const { store, service } = await activeService();
  const issued = await service.issueApiKey({ accountId: "acct_test_1", name: "CI", scopes: ["repository:audit"] });
  const context = await service.authorize({ authorization: `Bearer ${issued.apiKey}`, requiredScope: "repository:audit" });
  assert.deepEqual(context, {
    accountId: "acct_test_1",
    keyId: issued.key.keyId,
    plan: "developer",
    scopes: ["repository:audit"],
    subscriptionStatus: "active",
  });
  assert.equal((await store.getKey(issued.key.keyId)).lastUsedAt, new Date(fixedNow).toISOString());

  const substituted = issued.apiKey.slice(0, -1) + (issued.apiKey.endsWith("A") ? "B" : "A");
  await assert.rejects(() => service.authorize({ authorization: `Bearer ${substituted}` }), (error) => error instanceof ApiAccessError && error.code === "invalid_api_key");
  await assert.rejects(() => service.authorize({ authorization: `Bearer ${issued.apiKey.replace("sl_test_", "sl_live_")}` }), (error) => error instanceof ApiAccessError && error.code === "key_mode_mismatch");
  await assert.rejects(() => service.authorize({ authorization: `Bearer ${issued.apiKey}`, requiredScope: "admin:all" }), (error) => error instanceof ApiAccessError && error.code === "missing_scope");
});

test("enforces plan key limits and revocation", async () => {
  const { service } = await activeService("developer");
  const first = await service.issueApiKey({ accountId: "acct_test_1", name: "First" });
  await service.issueApiKey({ accountId: "acct_test_1", name: "Second" });
  await assert.rejects(() => service.issueApiKey({ accountId: "acct_test_1", name: "Third" }), (error) => error instanceof ApiAccessError && error.code === "key_limit_reached");

  const revoked = await service.revokeApiKey({ accountId: "acct_test_1", keyId: first.key.keyId });
  assert.equal(revoked.alreadyRevoked, false);
  await assert.rejects(() => service.authorize({ authorization: `Bearer ${first.apiKey}` }), (error) => error instanceof ApiAccessError && error.code === "invalid_api_key");
  const replacement = await service.issueApiKey({ accountId: "acct_test_1", name: "Replacement" });
  assert.ok(replacement.apiKey);
});

test("allows a bounded past-due grace period and fails closed afterward", async () => {
  const store = new MemoryStore();
  const service = createApiAccessService({ store, pepper, mode: "test", now: () => fixedNow, randomBytes: deterministicRandom });
  await service.provisionSubscription({
    accountId: "acct_grace",
    email: "grace@example.com",
    stripeCustomerId: "cus_grace",
    stripeSubscriptionId: "sub_grace",
    plan: "pro",
    subscriptionStatus: "past_due",
    currentPeriodEnd: fixedNow - 1,
    graceUntil: fixedNow + 60_000,
  });
  const issued = await service.issueApiKey({ accountId: "acct_grace", name: "Grace key" });
  assert.ok(issued.apiKey);

  const expiredService = createApiAccessService({ store, pepper, mode: "test", now: () => fixedNow + 60_001, randomBytes: deterministicRandom });
  await assert.rejects(() => expiredService.authorize({ authorization: `Bearer ${issued.apiKey}` }), (error) => error instanceof ApiAccessError && error.code === "subscription_inactive");
});

test("enforces hard monthly quotas with idempotent consumption", async () => {
  const { service } = await activeService("developer");
  const first = await service.consumeUsage({ accountId: "acct_test_1", units: 999, idempotencyKey: "req_1" });
  assert.equal(first.used, 999);
  assert.equal(first.remaining, 1);
  assert.equal(first.duplicate, false);

  const duplicate = await service.consumeUsage({ accountId: "acct_test_1", units: 999, idempotencyKey: "req_1" });
  assert.equal(duplicate.used, 999);
  assert.equal(duplicate.duplicate, true);

  const last = await service.consumeUsage({ accountId: "acct_test_1", units: 1, idempotencyKey: "req_2" });
  assert.equal(last.used, 1_000);
  assert.equal(last.remaining, 0);
  await assert.rejects(() => service.consumeUsage({ accountId: "acct_test_1", units: 1, idempotencyKey: "req_3" }), (error) => error instanceof ApiAccessError && error.statusCode === 429);
});

test("does not issue keys for inactive subscriptions", async () => {
  const store = new MemoryStore();
  const service = createApiAccessService({ store, pepper, mode: "test", now: () => fixedNow, randomBytes: deterministicRandom });
  await service.provisionSubscription({
    accountId: "acct_canceled",
    email: "cancel@example.com",
    stripeCustomerId: "cus_cancel",
    stripeSubscriptionId: "sub_cancel",
    plan: "developer",
    subscriptionStatus: "canceled",
    currentPeriodEnd: fixedNow + 1_000,
  });
  await assert.rejects(() => service.issueApiKey({ accountId: "acct_canceled", name: "Nope" }), (error) => error instanceof ApiAccessError && error.code === "subscription_inactive");
});
