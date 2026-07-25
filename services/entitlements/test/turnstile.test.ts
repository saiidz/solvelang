import assert from "node:assert/strict";
import test from "node:test";
import { createTurnstileGateway } from "../src/turnstile.js";

test("Turnstile verification posts the token and client IP to the canonical siteverify endpoint", async () => {
  let request: { input: string; init?: RequestInit } | undefined;
  const gateway = createTurnstileGateway("turnstile-test-secret", async (input, init) => {
    request = { input: String(input), init };
    return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "content-type": "application/json" } });
  });

  assert.equal(await gateway.verify({ token: "turnstile-response", remoteIp: "203.0.113.7" }), true);
  assert.deepEqual(request?.input, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(request?.init?.method, "POST");
  assert.equal(request?.init?.headers instanceof Headers ? request.init.headers.get("content-type") : (request?.init?.headers as Record<string, string>)?.["content-type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(request?.init?.body as string)), {
    secret: "turnstile-test-secret",
    response: "turnstile-response",
    remoteip: "203.0.113.7",
  });
});

test("Turnstile verification rejects unsuccessful responses and fails on unavailable verification", async () => {
  const rejected = createTurnstileGateway("turnstile-test-secret", async () => new Response(JSON.stringify({ success: false }), { status: 200 }));
  assert.equal(await rejected.verify({ token: "invalid", remoteIp: "127.0.0.1" }), false);

  const unavailable = createTurnstileGateway("turnstile-test-secret", async () => new Response("unavailable", { status: 503 }));
  await assert.rejects(unavailable.verify({ token: "valid", remoteIp: "127.0.0.1" }));
});
