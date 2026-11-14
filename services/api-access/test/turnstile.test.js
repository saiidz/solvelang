import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { createTurnstileVerifier } from "../src/turnstile.js";

const adminSecret = "a".repeat(64);
const service = {
  provisionSubscription: async (body) => ({ ...body, normalized: true }),
  issueApiKey: async () => ({ apiKey: "sl_test_once", env: "SOLVELANG_API_KEY=<redacted>\n" }),
  revokeApiKey: async ({ keyId }) => ({ keyId, revokedAt: "2026-07-28T12:00:00.000Z" }),
  consumeUsage: async () => ({ used: 1, limit: 1_000, remaining: 999 }),
  getSubscriptionAccount: async () => undefined,
};

function event(method, rawPath, body, headers = {}) {
  return {
    rawPath,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { http: { method, sourceIp: "203.0.113.8" } },
  };
}

function siteverifyFetch(result, capture = {}) {
  return async (url, options) => {
    capture.url = url;
    capture.options = options;
    return { ok: true, json: async () => result };
  };
}

test("Turnstile verification posts the token, client IP and idempotency key to siteverify", async () => {
  const capture = {};
  const verifier = createTurnstileVerifier({
    secret: "secret-key",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: siteverifyFetch({ success: true, hostname: "www.solve-lang.com", action: "signin" }, capture),
    createIdempotencyKey: () => "11111111-1111-4111-8111-111111111111",
  });
  const verified = await verifier.verify({ token: "token-123", remoteIp: "203.0.113.8", expectedAction: "signin" });
  assert.equal(verified, true);
  assert.equal(capture.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  const params = new URLSearchParams(capture.options.body);
  assert.equal(params.get("secret"), "secret-key");
  assert.equal(params.get("response"), "token-123");
  assert.equal(params.get("remoteip"), "203.0.113.8");
  assert.equal(params.get("idempotency_key"), "11111111-1111-4111-8111-111111111111");
});

test("Turnstile verification fails closed on mismatch, rejection and transport errors", async () => {
  const base = { secret: "secret-key", expectedHostname: "www.solve-lang.com", createIdempotencyKey: () => "id" };
  const cases = [
    { success: false, hostname: "www.solve-lang.com", action: "signin" },
    { success: true, hostname: "evil.example", action: "signin" },
    { success: true, hostname: "www.solve-lang.com", action: "checkout" },
    null,
  ];
  for (const result of cases) {
    const verifier = createTurnstileVerifier({ ...base, fetchImpl: siteverifyFetch(result) });
    assert.equal(await verifier.verify({ token: "t", remoteIp: "203.0.113.8", expectedAction: "signin" }), false);
  }
  const httpError = createTurnstileVerifier({ ...base, fetchImpl: async () => ({ ok: false, json: async () => ({}) }) });
  assert.equal(await httpError.verify({ token: "t", expectedAction: "signin" }), false);
  const transportError = createTurnstileVerifier({ ...base, fetchImpl: async () => { throw new Error("network down"); } });
  assert.equal(await transportError.verify({ token: "t", expectedAction: "signin" }), false);
  let fetchCalled = false;
  const noToken = createTurnstileVerifier({ ...base, fetchImpl: async () => { fetchCalled = true; return { ok: true, json: async () => ({}) }; } });
  assert.equal(await noToken.verify({ token: "", expectedAction: "signin" }), false);
  assert.equal(await noToken.verify({ expectedAction: "signin" }), false);
  assert.equal(fetchCalled, false);
});

function authHandler(botProtection) {
  const calls = { magicLink: [], password: [] };
  const customerAuth = {
    requestMagicLink: async (body) => { calls.magicLink.push(body); },
    loginWithPassword: async (body) => {
      calls.password.push(body);
      return { accountId: "acct_1", email: body.email, csrfToken: "csrf", cookie: "session=abc" };
    },
  };
  const handler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount: {},
    ...(botProtection ? { botProtection } : {}),
    logger: { error() {} },
  });
  return { handler, calls };
}

const signinHeaders = { origin: "https://www.solve-lang.com" };

test("magic-link bot gate: honeypot and instant submissions send nothing, clean requests pass", async () => {
  const { handler, calls } = authHandler(undefined);
  const honeypot = await handler(event("POST", "/customer/auth/magic-link", { email: "a@example.com", website: "http://spam.example" }, signinHeaders));
  assert.equal(honeypot.statusCode, 202);
  assert.equal(JSON.parse(honeypot.body).accepted, true);
  const instant = await handler(event("POST", "/customer/auth/magic-link", { email: "a@example.com", formElapsedMs: 40 }, signinHeaders));
  assert.equal(instant.statusCode, 202);
  assert.equal(calls.magicLink.length, 0);
  const clean = await handler(event("POST", "/customer/auth/magic-link", { email: "a@example.com", formElapsedMs: 4_500 }, signinHeaders));
  assert.equal(clean.statusCode, 202);
  assert.equal(calls.magicLink.length, 1);
  assert.equal(calls.magicLink[0].email, "a@example.com");
});

test("magic-link bot gate: Turnstile enforced when configured, before any email is sent", async () => {
  const seen = [];
  const verifier = { verify: async (input) => { seen.push(input); return input.token === "good-token"; } };
  const { handler, calls } = authHandler(verifier);
  const rejected = await handler(event("POST", "/customer/auth/magic-link", { email: "a@example.com", turnstileToken: "bad-token" }, signinHeaders));
  assert.equal(rejected.statusCode, 202);
  assert.equal(JSON.parse(rejected.body).accepted, true);
  assert.equal(calls.magicLink.length, 0);
  assert.equal(seen[0].expectedAction, "signin");
  assert.equal(seen[0].remoteIp, "203.0.113.8");
  const accepted = await handler(event("POST", "/customer/auth/magic-link", { email: "a@example.com", turnstileToken: "good-token" }, signinHeaders));
  assert.equal(accepted.statusCode, 202);
  assert.equal(calls.magicLink.length, 1);
});

test("password bot gate: failed checks return the generic credential error and never reach the login", async () => {
  const { handler, calls } = authHandler({ verify: async () => false });
  const blocked = await handler(event("POST", "/customer/auth/password", { email: "a@example.com", password: "pw", turnstileToken: "bad" }, signinHeaders));
  assert.equal(blocked.statusCode, 401);
  assert.equal(JSON.parse(blocked.body).code, "invalid_credentials");
  assert.equal(calls.password.length, 0);

  const open = authHandler(undefined);
  const honeypot = await open.handler(event("POST", "/customer/auth/password", { email: "a@example.com", password: "pw", website: "x" }, signinHeaders));
  assert.equal(honeypot.statusCode, 401);
  assert.equal(open.calls.password.length, 0);
  const clean = await open.handler(event("POST", "/customer/auth/password", { email: "a@example.com", password: "pw" }, signinHeaders));
  assert.equal(clean.statusCode, 200);
  assert.equal(open.calls.password.length, 1);
});
