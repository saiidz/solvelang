import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { parseApiAccessEnvironment } from "../src/config.js";
import { createLiveCenterService } from "../src/live-center.js";
import { ApiAccessError } from "../src/service.js";

const ADMIN_SECRET = "test-admin-secret-with-at-least-32-chars";
const BOARD_PATH = "/customer/live-center/board";

const PILOT_CONFIG = {
  enabled: true,
  baseUrl: "https://pilot.example.com",
  adminToken: "pilot-admin-token",
  tenant: "saiidz-pilot",
  owner: "saiidz",
  repo: "upcomingsounds-private",
  installationId: "179351888",
};

const BOARD = {
  repo: "saiidz/upcomingsounds-private",
  queue: [{ number: 42, title: "Fix the thing", position: 1, state: "QUEUED" }],
  pullRequests: [],
  runners: [],
  ownerActions: [],
};

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

// --- config ---------------------------------------------------------------

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

test("live center config is disabled until every pilot pointer is set", () => {
  const unset = parseApiAccessEnvironment(baseEnvironment());
  assert.equal(unset.liveCenter.enabled, false);
  assert.equal(unset.liveCenter.baseUrl, undefined);

  const partial = parseApiAccessEnvironment(baseEnvironment({
    MGOV_PILOT_BASE_URL: "https://pilot.example.com",
    MGOV_ADMIN_TOKEN: "pilot-admin-token",
  }));
  assert.equal(partial.liveCenter.enabled, false);
  assert.equal(partial.liveCenter.tenant, undefined);
});

test("live center config parses the full pilot pointer set", () => {
  const parsed = parseApiAccessEnvironment(baseEnvironment({
    MGOV_PILOT_BASE_URL: "https://pilot.example.com",
    MGOV_ADMIN_TOKEN: "pilot-admin-token",
    MGOV_PILOT_TENANT: "saiidz-pilot",
    MGOV_PILOT_OWNER: "saiidz",
    MGOV_PILOT_REPO: "upcomingsounds-private",
    MGOV_PILOT_INSTALLATION_ID: "179351888",
  }));
  assert.deepEqual(parsed.liveCenter, PILOT_CONFIG);
});

// --- service ---------------------------------------------------------------

test("unconfigured live center service fails closed with 503 and never fetches", async () => {
  let fetches = 0;
  const service = createLiveCenterService({
    config: { enabled: false },
    fetchImpl: async () => { fetches += 1; return jsonResponse(BOARD); },
  });
  await assert.rejects(
    service.getBoard(),
    (error) => error instanceof ApiAccessError && error.statusCode === 503 && error.code === "mgov_not_configured",
  );
  assert.equal(fetches, 0);
});

test("live center service calls the pilot board endpoint with the admin token and passes the board through", async () => {
  const seen = [];
  const service = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async (url, options) => { seen.push({ url, options }); return jsonResponse(BOARD); },
  });
  const board = await service.getBoard();
  assert.deepEqual(board, BOARD);
  assert.equal(seen.length, 1);
  assert.equal(
    seen[0].url,
    "https://pilot.example.com/tenants/saiidz-pilot/board?owner=saiidz&repo=upcomingsounds-private&installationId=179351888",
  );
  assert.equal(seen[0].options.method, "GET");
  assert.equal(seen[0].options.headers["x-admin-token"], "pilot-admin-token");
});

test("live center service maps upstream failures to 502", async () => {
  const failingFetch = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async () => { throw new Error("connection refused"); },
  });
  await assert.rejects(
    failingFetch.getBoard(),
    (error) => error instanceof ApiAccessError && error.statusCode === 502 && error.code === "upstream_unavailable",
  );

  const errorStatus = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async () => jsonResponse({ error: "nope" }, { ok: false, status: 500 }),
  });
  await assert.rejects(
    errorStatus.getBoard(),
    (error) => error instanceof ApiAccessError && error.statusCode === 502 && error.code === "upstream_unavailable",
  );

  const badJson = createLiveCenterService({
    config: PILOT_CONFIG,
    fetchImpl: async () => ({ ok: true, status: 200, async json() { throw new Error("not json"); } }),
  });
  await assert.rejects(
    badJson.getBoard(),
    (error) => error instanceof ApiAccessError && error.statusCode === 502 && error.code === "upstream_unavailable",
  );
});

// --- handler ---------------------------------------------------------------

// Mirrors the merge-governance handler fixture: authenticate() throws
// 401 invalid_session when the sl_api_session cookie is missing/invalid.
function handlerFixture({ authenticated = true, liveCenter } = {}) {
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
    liveCenter,
    logger: { error() {} },
  });
  return { handler };
}

function boardEvent() {
  return {
    requestContext: { http: { method: "GET", sourceIp: "127.0.0.1" } },
    rawPath: BOARD_PATH,
    headers: { cookie: "sl_api_session=sess_test" },
  };
}

test("unauthenticated board request is rejected by the session gate (401 invalid_session)", async () => {
  let calls = 0;
  const { handler } = handlerFixture({
    authenticated: false,
    liveCenter: { async getBoard() { calls += 1; return BOARD; } },
  });
  const response = await handler(boardEvent());
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, "invalid_session");
  assert.equal(calls, 0);
});

test("board route returns 503 mgov_not_configured when the live center is not wired", async () => {
  const { handler } = handlerFixture({ liveCenter: undefined });
  const response = await handler(boardEvent());
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).code, "mgov_not_configured");
});

test("board route passes the board JSON through unchanged for a signed-in customer", async () => {
  const { handler } = handlerFixture({
    liveCenter: { async getBoard() { return BOARD; } },
  });
  const response = await handler(boardEvent());
  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), BOARD);
});

test("board route surfaces an upstream failure as 502", async () => {
  const { handler } = handlerFixture({
    liveCenter: {
      async getBoard() { throw new ApiAccessError(502, "upstream_unavailable", "Live Center is temporarily unavailable."); },
    },
  });
  const response = await handler(boardEvent());
  assert.equal(response.statusCode, 502);
  assert.equal(JSON.parse(response.body).code, "upstream_unavailable");
});
