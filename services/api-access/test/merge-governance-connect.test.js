import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { createMergeGovernanceConnectService } from "../src/merge-governance-connect.js";
import { parseApiAccessEnvironment } from "../src/config.js";
import { ApiAccessError } from "../src/service.js";

const ADMIN_SECRET = "a".repeat(40);
const PILOT_BASE = "https://pilot.example.com";

// Mirrors the real gate in customer-auth.js: authenticate() throws
// 401 invalid_session when the sl_api_session cookie is missing,
// invalid, or expired.
function gateFixture({ authenticated = true, connect } = {}) {
  const customerAuth = {
    async authenticate() {
      if (!authenticated) throw new ApiAccessError(401, "invalid_session", "Sign in again to continue.");
      return { accountId: "acct_session", email: "owner@example.com", csrfToken: "csrf_session" };
    },
    assertCsrf(session, presented) {
      if (presented !== session.csrfToken) throw new ApiAccessError(403, "invalid_csrf", "The request could not be verified.");
    },
  };
  const handler = createApiAccessHandler({
    service: {},
    enabled: true,
    adminSecret: ADMIN_SECRET,
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount: {},
    mergeGovernanceConnect: connect,
    logger: { error() {} },
  });
  return { handler };
}

function getEvent(path, queryStringParameters = {}) {
  return {
    requestContext: { http: { method: "GET", sourceIp: "127.0.0.1" } },
    rawPath: path,
    headers: { cookie: "sl_api_session=session" },
    queryStringParameters,
  };
}

function stubUpstream({ status = 200, payload = {} } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return { ok: status >= 200 && status < 300, status, json: async () => payload };
  };
  return { calls, fetchImpl };
}

test("connect service lists repositories through the pilot product route", async () => {
  const { calls, fetchImpl } = stubUpstream({
    payload: { installationId: 123, repositories: [{ name: "alpha", fullName: "acme/alpha", private: true, defaultBranch: "main" }] },
  });
  const connect = createMergeGovernanceConnectService({ baseUrl: `${PILOT_BASE}/`, adminToken: "admin-token", fetchImpl });
  const result = await connect.listRepositories("123");
  assert.equal(result.repositories.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${PILOT_BASE}/apps/product/installations/123/repositories`);
  assert.equal(calls[0].options.headers["x-admin-token"], "admin-token");
});

test("connect service fetches the audit with encoded owner and repo", async () => {
  const { calls, fetchImpl } = stubUpstream({ payload: { repo: { fullName: "acme/alpha" } } });
  const connect = createMergeGovernanceConnectService({ baseUrl: PILOT_BASE, adminToken: "admin-token", fetchImpl });
  await connect.getAudit({ installationId: 123, owner: "acme", repo: "alpha" });
  assert.equal(calls[0].url, `${PILOT_BASE}/apps/product/installations/123/audit?owner=acme&repo=alpha`);
});

test("connect service validates identifiers before any upstream call", async () => {
  const { calls, fetchImpl } = stubUpstream();
  const connect = createMergeGovernanceConnectService({ baseUrl: PILOT_BASE, adminToken: "admin-token", fetchImpl });
  await assert.rejects(() => connect.listRepositories("nope"), (err) => err.statusCode === 400 && err.code === "invalid_request");
  await assert.rejects(() => connect.getAudit({ installationId: 123, owner: "acme", repo: "a/b" }), (err) => err.statusCode === 400);
  await assert.rejects(() => connect.getAudit({ installationId: 123, owner: "", repo: "alpha" }), (err) => err.statusCode === 400);
  assert.equal(calls.length, 0);
});

test("connect service maps an upstream product 503 to a switch-on 503", async () => {
  const { fetchImpl } = stubUpstream({ status: 503, payload: { error: "product_app_not_configured" } });
  const connect = createMergeGovernanceConnectService({ baseUrl: PILOT_BASE, adminToken: "admin-token", fetchImpl });
  await assert.rejects(
    () => connect.listRepositories(123),
    (err) => err.statusCode === 503 && err.code === "product_app_not_configured",
  );
});

test("connect service maps upstream failures and network errors to 502", async () => {
  const { fetchImpl } = stubUpstream({ status: 500, payload: { error: "boom" } });
  const connect = createMergeGovernanceConnectService({ baseUrl: PILOT_BASE, adminToken: "admin-token", fetchImpl });
  await assert.rejects(() => connect.listRepositories(123), (err) => err.statusCode === 502 && err.code === "merge_governance_unavailable");
  const down = createMergeGovernanceConnectService({
    baseUrl: PILOT_BASE,
    adminToken: "admin-token",
    fetchImpl: async () => { throw new Error("socket hangup"); },
  });
  await assert.rejects(() => down.listRepositories(123), (err) => err.statusCode === 502);
});

test("connect routes reject signed-out callers with 401 invalid_session", async () => {
  const { handler } = gateFixture({ authenticated: false, connect: { listRepositories: async () => ({}) } });
  const response = await handler(getEvent("/customer/connect/repositories", { installationId: "123" }));
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, "invalid_session");
});

test("connect routes answer 503 while the proxy is unconfigured", async () => {
  const { handler } = gateFixture({ connect: undefined });
  const repos = await handler(getEvent("/customer/connect/repositories", { installationId: "123" }));
  assert.equal(repos.statusCode, 503);
  assert.equal(JSON.parse(repos.body).code, "merge_governance_connect_disabled");
  const audit = await handler(getEvent("/customer/connect/audit", { installationId: "123", owner: "acme", repo: "alpha" }));
  assert.equal(audit.statusCode, 503);
  assert.equal(JSON.parse(audit.body).code, "merge_governance_connect_disabled");
});

test("connect routes pass the audit through for a signed-in customer", async () => {
  const seen = [];
  const connect = {
    async listRepositories(id) { seen.push(["repos", id]); return { installationId: 123, repositories: [] }; },
    async getAudit(input) { seen.push(["audit", input]); return { repo: { fullName: "acme/alpha" }, queue: { openPrs: 2, drafts: 1 } }; },
  };
  const { handler } = gateFixture({ connect });
  const repos = await handler(getEvent("/customer/connect/repositories", { installationId: "123" }));
  assert.equal(repos.statusCode, 200);
  assert.deepEqual(JSON.parse(repos.body), { installationId: 123, repositories: [] });
  const audit = await handler(getEvent("/customer/connect/audit", { installationId: "123", owner: "acme", repo: "alpha" }));
  assert.equal(audit.statusCode, 200);
  assert.equal(JSON.parse(audit.body).queue.openPrs, 2);
  assert.deepEqual(seen, [
    ["repos", "123"],
    ["audit", { installationId: "123", owner: "acme", repo: "alpha" }],
  ]);
});

test("config keeps the connect proxy dark unless both values are set", () => {
  const baseEnv = {
    API_ACCESS_MODE: "test",
    API_KEY_PEPPER: "p".repeat(40),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idem",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_ACCESS_ADMIN_SECRET: "s".repeat(40),
  };
  const unset = parseApiAccessEnvironment({ ...baseEnv });
  assert.equal(unset.mergeGovernanceService.enabled, false);
  const partial = parseApiAccessEnvironment({ ...baseEnv, MGOV_PILOT_BASE_URL: "https://pilot.example.com/" });
  assert.equal(partial.mergeGovernanceService.enabled, false);
  const full = parseApiAccessEnvironment({
    ...baseEnv,
    MGOV_PILOT_BASE_URL: "https://pilot.example.com/",
    MGOV_ADMIN_TOKEN: "token",
  });
  assert.equal(full.mergeGovernanceService.enabled, true);
  assert.equal(full.mergeGovernanceService.baseUrl, "https://pilot.example.com");
});
