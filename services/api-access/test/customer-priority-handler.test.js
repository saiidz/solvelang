import assert from "node:assert/strict";
import test from "node:test";
import { createCustomerPriorityHandler } from "../src/customer-priority-handler.js";

const ACCOUNT_ID = `acct_${"d".repeat(32)}`;

function event(method, path, { body, headers = {}, cookies, isBase64Encoded = false } = {}) {
  return {
    rawPath: path,
    headers,
    cookies,
    body: body === undefined ? undefined : (isBase64Encoded ? body : JSON.stringify(body)),
    isBase64Encoded,
    requestContext: { http: { method } },
  };
}

function fixture({ enabled = true } = {}) {
  const calls = [];
  const customerAuth = {
    async authenticate(cookie) {
      calls.push(["authenticate", cookie]);
      return { accountId: ACCOUNT_ID, email: "customer@example.com", csrfToken: "csrf-good" };
    },
    assertCsrf(session, presented) {
      calls.push(["csrf", session.accountId, presented]);
      if (presented !== "csrf-good") {
        const error = new Error("CSRF denied");
        error.statusCode = 403;
        error.code = "csrf_failed";
        error.publicMessage = "CSRF verification failed.";
        throw error;
      }
    },
  };
  const priority = {
    async quote(input) { calls.push(["quote", input]); return { accountId: input.accountId, priority: input.priority, weightedCredits: 2 }; },
    async submit(input) { calls.push(["submit", input]); return { jobId: "job_" + "a".repeat(32), accountId: input.accountId, status: "queued" }; },
    async getJob(input) { calls.push(["getJob", input]); return { jobId: input.jobId, accountId: input.accountId, status: "queued" }; },
  };
  const sourceStore = {
    async putSource(input) {
      calls.push(["putSource", input]);
      return { fingerprint: "f".repeat(64), bytes: input.source.length };
    },
  };
  return {
    calls,
    handler: createCustomerPriorityHandler({
      customerAuth,
      priority,
      sourceStore,
      siteOrigin: "https://www.solve-lang.com",
      enabled,
      logger: { error() {} },
    }),
  };
}

test("disabled customer priority rejects uploads before authentication or storage", async () => {
  const { handler, calls } = fixture({ enabled: false });
  const response = await handler(event("POST", "/customer/priority/source", {
    headers: { cookie: "session=abc", "x-solvelang-csrf": "csrf-good", "content-type": "application/zip" },
    body: Buffer.from([0x50, 0x4b, 0x03, 0x04]).toString("base64"),
    isBase64Encoded: true,
  }));
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).code, "customer_priority_disabled");
  assert.equal(calls.length, 0);
});

test("source upload derives ownership from the authenticated session, requires CSRF, and accepts only binary application/zip", async () => {
  const { handler, calls } = fixture();
  const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]);
  const response = await handler(event("POST", "/customer/priority/source", {
    headers: { cookie: "session=abc", "x-solvelang-csrf": "csrf-good", "content-type": "application/zip" },
    body: zip.toString("base64"),
    isBase64Encoded: true,
  }));
  assert.equal(response.statusCode, 201);
  const upload = calls.find((call) => call[0] === "putSource");
  assert.equal(upload[1].accountId, ACCOUNT_ID);
  assert.deepEqual(upload[1].source, zip);

  const wrongType = await handler(event("POST", "/customer/priority/source", {
    headers: { cookie: "session=abc", "x-solvelang-csrf": "csrf-good", "content-type": "application/json" },
    body: zip.toString("base64"),
    isBase64Encoded: true,
  }));
  assert.equal(wrongType.statusCode, 415);

  const notBinary = await handler(event("POST", "/customer/priority/source", {
    headers: { cookie: "session=abc", "x-solvelang-csrf": "csrf-good", "content-type": "application/zip" },
    body: { fake: true },
  }));
  assert.equal(notBinary.statusCode, 400);
});

test("quote and submit derive account ownership from the authenticated session and require CSRF", async () => {
  const { handler, calls } = fixture();
  const quote = await handler(event("POST", "/customer/priority/quote", {
    cookies: ["session=abc"],
    headers: { "x-solvelang-csrf": "csrf-good" },
    body: { accountId: `acct_${"e".repeat(32)}`, priority: "express", inputTokens: 1 },
  }));
  assert.equal(quote.statusCode, 200);
  const quoteCall = calls.find((call) => call[0] === "quote");
  assert.equal(quoteCall[1].accountId, ACCOUNT_ID);
  assert.equal(quoteCall[1].priority, "express");

  const submit = await handler(event("POST", "/customer/priority/jobs", {
    headers: { cookie: "session=abc", "x-solvelang-csrf": "csrf-good" },
    body: { requestId: "req-12345678", sourceFingerprint: "f".repeat(64), priority: "priority" },
  }));
  assert.equal(submit.statusCode, 201);
  const submitCall = calls.find((call) => call[0] === "submit");
  assert.equal(submitCall[1].accountId, ACCOUNT_ID);
});

test("job status is ownership-scoped by the authenticated account", async () => {
  const { handler, calls } = fixture();
  const jobId = `job_${"a".repeat(32)}`;
  const response = await handler(event("GET", `/customer/priority/jobs/${jobId}`, { headers: { cookie: "session=abc" } }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls.find((call) => call[0] === "getJob")[1], { accountId: ACCOUNT_ID, jobId });
});

test("adapter returns no-store CORS responses and does not expose admin authentication", async () => {
  const { handler } = fixture();
  const response = await handler(event("OPTIONS", "/customer/priority/jobs"));
  assert.equal(response.statusCode, 204);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.equal(response.headers["access-control-allow-origin"], "https://www.solve-lang.com");
  assert.doesNotMatch(response.headers["access-control-allow-headers"], /admin-secret/i);
});
