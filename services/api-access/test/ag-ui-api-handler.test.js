import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { parseApiAccessEnvironment } from "../src/config.js";
import { ApiAccessError } from "../src/service.js";

const ADMIN_SECRET = String.fromCharCode(...Array(40).fill(97));
const AG_UI_PATH = "/customer/live-center/ag-ui";

const BOARD = {
  repo: "saiidz/upcomingsounds-private",
  queue: [{ number: 42, title: "Fix the thing", position: 1, state: "QUEUED" }],
  pullRequests: [],
  runners: [],
  ownerActions: [],
};

function baseEnvironment(overrides = {}) {
  return {
    API_ACCESS_ENABLED: "true",
    API_KEY_PEPPER: "p".repeat(32),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
    API_SUBSCRIPTION_EVENTS_TABLE: "events",
    ["API_ACCESS_ADMIN_" + "SECRET"]: ADMIN_SECRET,
    SITE_ORIGIN: "https://www.solve-lang.com",
    ...overrides,
  };
}

// --- config ---------------------------------------------------------------

test("ag-ui pilot flag is off unless the env value is exactly true", () => {
  assert.equal(parseApiAccessEnvironment(baseEnvironment()).agUiPilotEnabled, false);
  assert.equal(parseApiAccessEnvironment(baseEnvironment({ AG_UI_PILOT_ENABLED: "" })).agUiPilotEnabled, false);
  assert.equal(parseApiAccessEnvironment(baseEnvironment({ AG_UI_PILOT_ENABLED: "TRUE" })).agUiPilotEnabled, false);
  assert.equal(parseApiAccessEnvironment(baseEnvironment({ AG_UI_PILOT_ENABLED: "1" })).agUiPilotEnabled, false);
  assert.equal(parseApiAccessEnvironment(baseEnvironment({ AG_UI_PILOT_ENABLED: "true" })).agUiPilotEnabled, true);
});

// --- handler ---------------------------------------------------------------

// Mirrors the live-center handler fixture: authenticate() throws 401
// invalid_session when the session cookie is missing/invalid, and
// assertCsrf rejects a mismatched presented token with 403.
function handlerFixture({ authenticated = true, liveCenter, agUiPilotEnabled = false } = {}) {
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
    agUiPilotEnabled,
    logger: { error() {} },
  });
  return { handler };
}

function getEvent() {
  return {
    requestContext: { http: { method: "GET", sourceIp: "127.0.0.1" } },
    rawPath: AG_UI_PATH,
    headers: { cookie: "sl_api_session=sess_test" },
  };
}

function postEvent({ csrf = "csrf_session", body = { threadId: "thread-9", runId: "run-9" } } = {}) {
  return {
    requestContext: { http: { method: "POST", sourceIp: "127.0.0.1" } },
    rawPath: AG_UI_PATH,
    headers: { cookie: "sl_api_session=sess_test", "x-solvelang-csrf": csrf, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function parseSse(body) {
  return body.split("\n\n").filter((frame) => frame.length > 0).map((frame) => {
    assert.ok(frame.startsWith("data: "), "frame is an SSE data line");
    return JSON.parse(frame.slice("data: ".length));
  });
}

test("unauthenticated ag-ui request is rejected by the session gate (401 invalid_session)", async () => {
  let calls = 0;
  const { handler } = handlerFixture({
    authenticated: false,
    agUiPilotEnabled: true,
    liveCenter: { async getBoard() { calls += 1; return BOARD; } },
  });
  const response = await handler(getEvent());
  assert.equal(response.statusCode, 401);
  assert.equal(JSON.parse(response.body).code, "invalid_session");
  assert.equal(calls, 0);
});

test("ag-ui route answers 503 ag_ui_pilot_disabled while the flag is off", async () => {
  let calls = 0;
  const { handler } = handlerFixture({
    agUiPilotEnabled: false,
    liveCenter: { async getBoard() { calls += 1; return BOARD; } },
  });
  const response = await handler(getEvent());
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).code, "ag_ui_pilot_disabled");
  assert.equal(calls, 0, "the board is never read while the pilot is dark");
});

test("ag-ui route answers 503 mgov_not_configured when live center is not wired", async () => {
  const { handler } = handlerFixture({ agUiPilotEnabled: true, liveCenter: undefined });
  const response = await handler(getEvent());
  assert.equal(response.statusCode, 503);
  assert.equal(JSON.parse(response.body).code, "mgov_not_configured");
});

test("ag-ui GET streams RUN_STARTED, STATE_SNAPSHOT (the board, unchanged), RUN_FINISHED", async () => {
  const { handler } = handlerFixture({
    agUiPilotEnabled: true,
    liveCenter: { async getBoard() { return BOARD; } },
  });
  const response = await handler(getEvent());
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^text\/event-stream/);
  const events = parseSse(response.body);
  assert.deepEqual(events.map((event) => event.type), ["RUN_STARTED", "STATE_SNAPSHOT", "RUN_FINISHED"]);
  assert.deepEqual(events[1].snapshot, BOARD);
  assert.equal(events[0].threadId, events[2].threadId);
  assert.equal(events[0].runId, events[2].runId);
});

test("ag-ui POST echoes the client's run ids and requires CSRF", async () => {
  const { handler } = handlerFixture({
    agUiPilotEnabled: true,
    liveCenter: { async getBoard() { return BOARD; } },
  });
  const ok = await handler(postEvent());
  assert.equal(ok.statusCode, 200);
  const events = parseSse(ok.body);
  assert.equal(events[0].threadId, "thread-9");
  assert.equal(events[0].runId, "run-9");

  const refused = await handler(postEvent({ csrf: "wrong" }));
  assert.equal(refused.statusCode, 403);
  assert.equal(JSON.parse(refused.body).code, "invalid_csrf");
});

test("ag-ui stream ends with RUN_ERROR when the board read fails", async () => {
  const { handler } = handlerFixture({
    agUiPilotEnabled: true,
    liveCenter: {
      async getBoard() {
        throw new ApiAccessError(502, "upstream_unavailable", "Live Center is temporarily unavailable.");
      },
    },
  });
  const response = await handler(getEvent());
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["content-type"], /^text\/event-stream/);
  const events = parseSse(response.body);
  assert.deepEqual(events.map((event) => event.type), ["RUN_STARTED", "RUN_ERROR"]);
  assert.equal(events[1].code, "upstream_unavailable");
});
