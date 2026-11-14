import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { parseApiAccessEnvironment } from "../src/config.js";
import { createGitHubBindingsService } from "../src/github-bindings.js";
import { ApiAccessError } from "../src/service.js";

const ADMIN_SECRET = "a".repeat(32);
const BINDINGS_PATH = "/customer/github/bindings";
const SESSION_ACCOUNT = "acct_session";

const MGOV_CONFIG = {
  enabled: true,
  baseUrl: "https://mgov.example.com",
  adminToken: "mgov-admin-token",
};

const UPSTREAM = {
  installations: [
    { accountLogin: "octo-org", state: "active", installationId: 4242, accountType: "Organization", secretField: "drop-me" },
    { accountLogin: "octo-user", state: "suspended", installationId: 777, extra: true },
  ],
  repos: [
    { repo: "octo-org/hello", installationId: 4242, boundVia: "product-app", internalNote: "drop-me" },
    { repo: "octo-user/world", installationId: 777, boundVia: "reader-app" },
  ],
  tenantInternalId: "drop-me",
  debug: { upstreamOnly: true },
};

const NORMALIZED = {
  connected: true,
  installations: [
    { accountLogin: "octo-org", state: "active" },
    { accountLogin: "octo-user", state: "suspended" },
  ],
  repositories: [
    { fullName: "octo-org/hello", installationId: 4242 },
    { fullName: "octo-user/world", installationId: 777 },
  ],
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

function baseEnvironment(overrides = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_KEY_PEPPER: "p".repeat(32),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    API_ACCESS_ADMIN_SECRET: ADMIN_SECRET,
    SITE_ORIGIN: "https://www.solve-lang.com",
    ...overrides,
  };
}

// Mirrors the live-center handler fixture: authenticate() throws
// 401 invalid_session when the sl_api_session cookie is missing/invalid.
function handlerFixture({ authenticated = true, githubBindings } = {}) {
  const customerAuth = {
    async authenticate() {
      if (!authenticated) throw new ApiAccessError(401, "invalid_session", "Sign in again to continue.");
      return { accountId: SESSION_ACCOUNT, email: "owner@example.com", csrfToken: "csrf_session" };
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
    githubBindings,
    logger: { error() {} },
  });
  return { handler };
}

function bindingsEvent(queryStringParameters) {
  return {
    requestContext: { http: { method: "GET", sourceIp: "127.0.0.1" } },
    rawPath: BINDINGS_PATH,
    headers: { cookie: "sl_api_session=sess_test" },
    ...(queryStringParameters ? { queryStringParameters } : {}),
  };
}

test("no session -> 401 identical to the /customer/github/* siblings, service never called", async () => {
  let calls = 0;
  const githubBindings = { async getBindings() { calls += 1; return NORMALIZED; } };
  const { handler } = handlerFixture({ authenticated: false, githubBindings });

  const bindings = await handler(bindingsEvent());
  assert.equal(bindings.statusCode, 401);
  assert.equal(JSON.parse(bindings.body).code, "invalid_session");
  assert.equal(calls, 0);

  // The sibling installations route answers the same gate the same way.
  const sibling = await handler({
    requestContext: { http: { method: "GET", sourceIp: "127.0.0.1" } },
    rawPath: "/customer/github/installations",
    headers: { cookie: "sl_api_session=sess_test" },
  });
  assert.equal(sibling.statusCode, bindings.statusCode);
  assert.equal(sibling.body, bindings.body);
});

test("unconfigured mgov pair -> 503 exact body, upstream never called", async () => {
  // Handler with no bindings service wired at all.
  const unwired = handlerFixture({ githubBindings: undefined });
  const missing = await unwired.handler(bindingsEvent());
  assert.equal(missing.statusCode, 503);
  assert.deepEqual(JSON.parse(missing.body), { error: "bindings_unavailable" });
  assert.equal(missing.body, JSON.stringify({ error: "bindings_unavailable" }));

  // Real service built from the parsed config with the pair unset.
  const parsed = parseApiAccessEnvironment(baseEnvironment());
  assert.equal(parsed.mergeGovernanceService.enabled, false);
  let fetches = 0;
  const service = createGitHubBindingsService({
    config: parsed.mergeGovernanceService,
    fetchImpl: async () => { fetches += 1; return jsonResponse(UPSTREAM); },
  });
  const { handler } = handlerFixture({ githubBindings: service });
  const response = await handler(bindingsEvent());
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "bindings_unavailable" });
  assert.equal(fetches, 0);

  // Service level: a partial pair also fails closed with 503.
  const partial = createGitHubBindingsService({
    config: { enabled: false, baseUrl: "https://mgov.example.com", adminToken: undefined },
    fetchImpl: async () => { fetches += 1; return jsonResponse(UPSTREAM); },
  });
  await assert.rejects(
    partial.getBindings(SESSION_ACCOUNT),
    (error) => error instanceof ApiAccessError && error.statusCode === 503 && error.code === "bindings_unavailable",
  );
  assert.equal(fetches, 0);
});

test("upstream 500 -> 503 exact body, no upstream internals leaked", async () => {
  const service = createGitHubBindingsService({
    config: MGOV_CONFIG,
    fetchImpl: async () => jsonResponse({ error: "internal mgov detail", stack: "secret" }, { ok: false, status: 500 }),
  });
  const { handler } = handlerFixture({ githubBindings: service });
  const response = await handler(bindingsEvent());
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "bindings_unavailable" });
  assert.doesNotMatch(response.body, /internal mgov detail|secret/);
});

test("upstream transport failure -> 503 exact body", async () => {
  const service = createGitHubBindingsService({
    config: MGOV_CONFIG,
    fetchImpl: async () => { throw new Error("connection refused to mgov.internal"); },
  });
  const { handler } = handlerFixture({ githubBindings: service });
  const response = await handler(bindingsEvent());
  assert.equal(response.statusCode, 503);
  assert.deepEqual(JSON.parse(response.body), { error: "bindings_unavailable" });
  assert.doesNotMatch(response.body, /mgov\.internal/);
});

test("happy path: normalization drops extra upstream fields and calls mgov with the admin token", async () => {
  const seen = [];
  const service = createGitHubBindingsService({
    config: MGOV_CONFIG,
    fetchImpl: async (url, options) => { seen.push({ url, options }); return jsonResponse(UPSTREAM); },
  });
  const { handler } = handlerFixture({ githubBindings: service });
  const response = await handler(bindingsEvent());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), NORMALIZED);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `https://mgov.example.com/bindings/by-tenant?tenantId=${SESSION_ACCOUNT}`);
  assert.equal(seen[0].options.method, "GET");
  assert.equal(seen[0].options.headers["x-admin-token"], "mgov-admin-token");
});

test("happy path: empty repos -> connected false", async () => {
  const service = createGitHubBindingsService({
    config: MGOV_CONFIG,
    fetchImpl: async () => jsonResponse({ installations: [], repos: [] }),
  });
  const { handler } = handlerFixture({ githubBindings: service });
  const response = await handler(bindingsEvent());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), { connected: false, installations: [], repositories: [] });
});

test("client-supplied ?tenantId= is ignored: upstream receives the SESSION tenant", async () => {
  const seen = [];
  const service = createGitHubBindingsService({
    config: MGOV_CONFIG,
    fetchImpl: async (url, options) => { seen.push({ url, options }); return jsonResponse(UPSTREAM); },
  });
  const { handler } = handlerFixture({ githubBindings: service });
  const response = await handler(bindingsEvent({ tenantId: "evil-tenant", tenant: "evil-tenant" }));
  assert.equal(response.statusCode, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, `https://mgov.example.com/bindings/by-tenant?tenantId=${SESSION_ACCOUNT}`);
  assert.doesNotMatch(seen[0].url, /evil-tenant/);
});
