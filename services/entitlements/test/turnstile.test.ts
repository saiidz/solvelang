import assert from "node:assert/strict";
import test from "node:test";
import { createTurnstileGateway } from "../src/turnstile.js";

test("Turnstile verification posts the token, client IP, and UUID idempotency key to the canonical siteverify endpoint", async () => {
  let request: { input: string; init?: RequestInit } | undefined;
  const gateway = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    createIdempotencyKey: () => "79ee5e6a-5826-431b-87dc-bd2808c062c8",
    fetchImpl: async (input, init) => {
      request = { input: String(input), init };
      return new Response(JSON.stringify({ success: true, hostname: "www.solve-lang.com", action: "checkout" }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  assert.equal(await gateway.verify({ token: "turnstile-response", remoteIp: "203.0.113.7", expectedAction: "checkout" }), true);
  assert.deepEqual(request?.input, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(request?.init?.method, "POST");
  assert.equal(request?.init?.headers instanceof Headers ? request.init.headers.get("content-type") : (request?.init?.headers as Record<string, string>)?.["content-type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request?.init?.body as string)), {
    secret: "turnstile-test-secret",
    response: "turnstile-response",
    remoteip: "203.0.113.7",
    idempotency_key: "79ee5e6a-5826-431b-87dc-bd2808c062c8",
  });
});

test("Turnstile verification rejects unsuccessful, hostname-mismatched, action-mismatched, and malformed responses", async () => {
  const rejected = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: async () => new Response(JSON.stringify({ success: false, hostname: "www.solve-lang.com", action: "checkout" }), { status: 200 }),
  });
  assert.equal(await rejected.verify({ token: "invalid", remoteIp: "127.0.0.1", expectedAction: "checkout" }), false);

  const hostnameMismatch = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: async () => new Response(JSON.stringify({ success: true, hostname: "attacker.example", action: "checkout" }), { status: 200 }),
  });
  assert.equal(await hostnameMismatch.verify({ token: "invalid", remoteIp: "127.0.0.1", expectedAction: "checkout" }), false);

  const actionMismatch = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: async () => new Response(JSON.stringify({ success: true, hostname: "www.solve-lang.com", action: "other" }), { status: 200 }),
  });
  assert.equal(await actionMismatch.verify({ token: "invalid", remoteIp: "127.0.0.1", expectedAction: "checkout" }), false);

  const malformed = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: async () => new Response(JSON.stringify({ success: true }), { status: 200 }),
  });
  assert.equal(await malformed.verify({ token: "invalid", remoteIp: "127.0.0.1", expectedAction: "checkout" }), false);
});

test("Turnstile verification fails closed for malformed JSON, timeouts, and network failures", async () => {
  const malformedJson = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: async () => new Response("not-json", { status: 200 }),
  });
  assert.equal(await malformedJson.verify({ token: "valid", remoteIp: "127.0.0.1", expectedAction: "withdrawal" }), false);

  const unavailable = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: async () => new Response("unavailable", { status: 503 }),
  });
  await assert.rejects(unavailable.verify({ token: "valid", remoteIp: "127.0.0.1", expectedAction: "withdrawal" }));

  const timeout = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: async () => {
      const error = new Error("request timed out");
      error.name = "TimeoutError";
      throw error;
    },
  });
  await assert.rejects(timeout.verify({ token: "valid", remoteIp: "127.0.0.1", expectedAction: "withdrawal" }));

  const networkFailure = createTurnstileGateway({
    secret: "turnstile-test-secret",
    expectedHostname: "www.solve-lang.com",
    fetchImpl: async () => { throw new Error("network unavailable"); },
  });
  await assert.rejects(networkFailure.verify({ token: "valid", remoteIp: "127.0.0.1", expectedAction: "withdrawal" }));
});
