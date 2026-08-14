import assert from "node:assert/strict";
import test from "node:test";
import { createAccountAccessAdminHandler } from "../src/account-access-admin-handler.js";

const ADMIN_SECRET = "a".repeat(64);
const ACCOUNT_ID = `acct_${"f".repeat(32)}`;

function event(method, body, headers = {}, queryStringParameters) {
  return {
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    queryStringParameters,
    requestContext: { http: { method } },
  };
}

function fixture() {
  const calls = [];
  const accountAccess = {
    async getStatus(accountId) {
      calls.push(["status", accountId]);
      return { accountId, state: "active", authVersion: 4 };
    },
    async transition(input, actor) {
      calls.push(["transition", input, actor]);
      return { accountId: input.accountId, state: input.state, authVersion: 5, changed: true };
    },
  };
  const handler = createAccountAccessAdminHandler({
    accountAccess,
    adminSecret: ADMIN_SECRET,
    siteOrigin: "https://www.solve-lang.com",
    logger: { error() {} },
  });
  return { handler, calls };
}

test("GET status requires the admin secret and returns no-store metadata", async () => {
  const { handler, calls } = fixture();
  const denied = await handler(event("GET", undefined, {}, { accountId: ACCOUNT_ID }));
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).code, "admin_denied");
  assert.equal(calls.length, 0);

  const accepted = await handler(event("GET", undefined, {
    "x-solvelang-admin-secret": ADMIN_SECRET,
  }, { accountId: ACCOUNT_ID }));
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.headers["cache-control"], "no-store");
  assert.deepEqual(JSON.parse(accepted.body).account, {
    accountId: ACCOUNT_ID,
    state: "active",
    authVersion: 4,
  });
  assert.deepEqual(calls, [["status", ACCOUNT_ID]]);
});

test("POST transition uses a server-owned actor", async () => {
  const { handler, calls } = fixture();
  const input = {
    accountId: ACCOUNT_ID,
    state: "suspended",
    reason: "security review",
    requestId: "req_suspend_admin_1",
    changedBy: "attacker-controlled",
  };
  const response = await handler(event("POST", input, {
    "x-solvelang-admin-secret": ADMIN_SECRET,
  }));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [["transition", input, "api-access-admin"]]);
});

test("malformed JSON and unexpected methods are sanitized", async () => {
  const { handler } = fixture();
  const malformed = event("POST", undefined, { "x-solvelang-admin-secret": ADMIN_SECRET });
  malformed.body = "{";
  const invalid = await handler(malformed);
  assert.equal(invalid.statusCode, 400);
  assert.equal(JSON.parse(invalid.body).code, "invalid_request");

  const method = await handler(event("DELETE", undefined, { "x-solvelang-admin-secret": ADMIN_SECRET }));
  assert.equal(method.statusCode, 405);
});
