import assert from "node:assert/strict";
import test from "node:test";
import { createSupportAutomationApiHandler } from "../src/support-automation-api-handler.js";

function event(method, path, body, headers = {}, queryStringParameters) {
  return { requestContext: { http: { method } }, rawPath: path, body: body === undefined ? undefined : JSON.stringify(body), headers, queryStringParameters };
}

function dependencies(enabled = true) {
  const calls = [];
  const customerAuth = {
    async authenticate(cookie) { assert.equal(cookie, "session=test"); return { accountId: "acct_owner", email: "owner@example.com", csrfToken: "csrf_test" }; },
    assertCsrf(session, token) { assert.equal(session.accountId, "acct_owner"); if (token !== "csrf_test") { const error = new Error("bad csrf"); error.statusCode = 403; throw error; } },
  };
  const supportAutomation = {
    async status(session) { calls.push(["status", session.accountId]); return { configured: false }; },
    async history(session, limit) { calls.push(["history", session.accountId, limit]); return []; },
    async configure(session, input) { calls.push(["configure", session.accountId, input]); return { automationState: "PAUSED" }; },
    async pause(session) { calls.push(["pause", session.accountId]); return { paused: true }; },
    async resume(session) { calls.push(["resume", session.accountId]); return { resumed: true }; },
    async revoke(session) { calls.push(["revoke", session.accountId]); return { revoked: true }; },
  };
  const handler = createSupportAutomationApiHandler({ enabled, supportAutomation: enabled ? supportAutomation : undefined, customerAuth: enabled ? customerAuth : undefined, siteOrigin: "https://www.solve-lang.com", logger: { error() {} } });
  return { handler, calls };
}

test("support automation customer routes are authenticated, account-bound, and mutations require CSRF", async () => {
  const { handler, calls } = dependencies();
  const common = { cookie: "session=test", "x-solvelang-csrf": "csrf_test" };
  assert.equal((await handler(event("GET", "/customer/support-automation", undefined, common))).statusCode, 200);
  assert.equal((await handler(event("GET", "/customer/support-automation/history", undefined, common, { limit: "7" }))).statusCode, 200);
  assert.equal((await handler(event("POST", "/customer/support-automation/config", { provider: "gmail" }, common))).statusCode, 200);
  assert.equal((await handler(event("POST", "/customer/support-automation/pause", {}, common))).statusCode, 200);
  assert.equal((await handler(event("POST", "/customer/support-automation/resume", {}, common))).statusCode, 200);
  assert.equal((await handler(event("POST", "/customer/support-automation/revoke", {}, common))).statusCode, 200);
  assert.deepEqual(calls.map((call) => call[1]), Array(6).fill("acct_owner"));
  assert.equal(calls.find((call) => call[0] === "history")[2], 7);
});

test("feature-disabled endpoint fails closed without touching customer auth or provider service", async () => {
  const { handler } = dependencies(false);
  const response = await handler(event("GET", "/customer/support-automation", undefined, { cookie: "session=test" }));
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).code, "support_automation_disabled");
});

test("unknown support automation paths are not routed as successful operations", async () => {
  const { handler } = dependencies();
  const response = await handler(event("GET", "/customer/support-automation/nope", undefined, { cookie: "session=test" }));
  assert.equal(response.statusCode, 404);
});
