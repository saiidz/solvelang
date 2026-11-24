import assert from "node:assert/strict";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";
import { createSubscriptionLifecycleService } from "../src/subscriptions.js";
import { ApiAccessError } from "../src/service.js";

const ADMIN_SECRET = "test-admin-secret-value-that-is-long";
const SYNC_SECRET = "team-sync-secret-value";
const TEAMS_PATH = "/customer/team-context/teams";
const CUSTOMER_PATH = "/customer/subscriptions/team-context/elements-checkout";
const INTERNAL_PATH = "/internal/subscriptions/team-context/elements-checkout";
const SYNC_PATH = "/team-context/seat-sync";

// Mirrors the real gate in customer-auth.js, as in
// merge-governance-handler.test.js: authenticate() throws 401
// invalid_session without a valid session and assertCsrf throws 403
// invalid_csrf on a mismatched token.
function gateFixture({ authenticated = true, syncSecret = SYNC_SECRET, team = undefined } = {}) {
  const calls = { checkout: [], listOwnerTeams: [], getTeamSeats: [], syncTeamSeats: [] };
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
    service: {
      async getSubscriptionAccount(accountId) {
        assert.equal(accountId, "acct_session");
        return { stripeCustomerId: "cus_from_account" };
      },
    },
    enabled: true,
    adminSecret: ADMIN_SECRET,
    siteOrigin: "https://www.solve-lang.com",
    customerAccountsEnabled: true,
    customerAuth,
    customerAccount: {},
    subscriptionBillingEnabled: true,
    subscriptionCheckout: { createCheckout: async () => ({}) },
    subscriptionLifecycle: { processEvent: async () => ({ handled: true, duplicate: false }) },
    stripeGateway: { constructWebhookEvent: () => ({}) },
    teamContextCheckout: {
      async createTeamContextCheckout(input) {
        calls.checkout.push(input);
        return {
          subscriptionId: "sub_team",
          customerId: input.customerId ?? "cus_new",
          paymentRequired: true,
          clientSecret: "pi_team_secret",
        };
      },
    },
    teamContextBilling: {
      async listOwnerTeams(input) {
        calls.listOwnerTeams.push(input);
        return { product: "team-context-index", plan: "team-seat-monthly", perSeatAmountCents: 800, currency: "usd", teams: [] };
      },
      async getTeamSeats(input) {
        calls.getTeamSeats.push(input);
        return team ?? { id: "team_1", name: "Core", ownerEmail: "owner@example.com", activeSeats: 3 };
      },
      async syncTeamSeats(input) {
        calls.syncTeamSeats.push(input);
        return { synced: true, teamId: input.teamId, activeSeats: input.activeSeats };
      },
    },
    teamContextSyncSecret: syncSecret ?? undefined,
    logger: { error() {} },
  });
  return { handler, calls };
}

function event(path, { method = "POST", body = {}, csrf = "csrf_session", headers = {} } = {}) {
  return {
    requestContext: { http: { method, sourceIp: "127.0.0.1" } },
    rawPath: path,
    headers: {
      cookie: "sl_api_session=session-cookie",
      ...(csrf === null ? {} : { "x-solvelang-csrf": csrf }),
      ...headers,
    },
    body: JSON.stringify(body),
  };
}

test("the teams read serves the signed-in owner's teams from the session identity", async () => {
  const { handler, calls } = gateFixture();
  const response = await handler(event(TEAMS_PATH, { method: "GET" }));
  assert.equal(response.statusCode, 200);
  assert.equal(JSON.parse(response.body).perSeatAmountCents, 800);
  assert.deepEqual(calls.listOwnerTeams, [{ email: "owner@example.com" }]);

  const denied = gateFixture({ authenticated: false });
  const rejected = await denied.handler(event(TEAMS_PATH, { method: "GET" }));
  assert.equal(rejected.statusCode, 401);
  assert.equal(denied.calls.listOwnerTeams.length, 0);
});

test("the customer checkout takes quantity and ownership from the team record, never the request", async () => {
  const { handler, calls } = gateFixture();
  const response = await handler(event(CUSTOMER_PATH, {
    body: { teamId: "team_1", requestId: "checkout_1", quantity: 99, accountId: "acct_attacker", email: "attacker@example.com" },
  }));
  assert.equal(response.statusCode, 201);
  assert.deepEqual(calls.getTeamSeats, [{ teamId: "team_1" }]);
  assert.deepEqual(calls.checkout, [{
    accountId: "acct_session",
    email: "owner@example.com",
    plan: "team-seat-monthly",
    teamId: "team_1",
    quantity: 3,
    requestId: "checkout_1",
    customerId: "cus_from_account",
    promotionCode: undefined,
  }]);
});

test("a non-owner cannot subscribe for someone else's team", async () => {
  const { handler, calls } = gateFixture({
    team: { id: "team_9", name: "Theirs", ownerEmail: "someone-else@example.com", activeSeats: 2 },
  });
  const response = await handler(event(CUSTOMER_PATH, { body: { teamId: "team_9", requestId: "checkout_1" } }));
  assert.equal(response.statusCode, 403);
  assert.equal(JSON.parse(response.body).code, "team_context_forbidden");
  assert.equal(calls.checkout.length, 0);
});

test("the internal checkout route stays behind the admin secret", async () => {
  const { handler, calls } = gateFixture();
  const denied = await handler(event(INTERNAL_PATH, {
    body: { accountId: "acct_1", email: "owner@example.com", plan: "team-seat-monthly", teamId: "team_1", quantity: 2, requestId: "r1" },
  }));
  assert.equal(denied.statusCode, 403);
  assert.equal(JSON.parse(denied.body).code, "admin_denied");
  assert.equal(calls.checkout.length, 0);

  const allowed = await handler(event(INTERNAL_PATH, {
    body: { accountId: "acct_1", email: "owner@example.com", plan: "team-seat-monthly", teamId: "team_1", quantity: 2, requestId: "r1" },
    headers: { "x-solvelang-admin-secret": ADMIN_SECRET },
  }));
  assert.equal(allowed.statusCode, 201);
  assert.equal(calls.checkout.length, 1);
  assert.equal(calls.checkout[0].teamId, "team_1");
});

test("seat sync answers only to its own shared secret", async () => {
  const { handler, calls } = gateFixture();
  const missing = await handler(event(SYNC_PATH, { body: { teamId: "team_1", activeSeats: 4 } }));
  assert.equal(missing.statusCode, 403);
  assert.equal(JSON.parse(missing.body).code, "team_context_sync_denied");

  const wrong = await handler(event(SYNC_PATH, {
    body: { teamId: "team_1", activeSeats: 4 },
    headers: { "x-team-context-sync-secret": "not-the-secret" },
  }));
  assert.equal(wrong.statusCode, 403);
  assert.equal(calls.syncTeamSeats.length, 0);

  // The master admin secret does NOT open the sync route.
  const adminOnly = await handler(event(SYNC_PATH, {
    body: { teamId: "team_1", activeSeats: 4 },
    headers: { "x-solvelang-admin-secret": ADMIN_SECRET },
  }));
  assert.equal(adminOnly.statusCode, 403);
  assert.equal(calls.syncTeamSeats.length, 0);

  const ok = await handler(event(SYNC_PATH, {
    body: { teamId: "team_1", activeSeats: 4 },
    headers: { "x-team-context-sync-secret": SYNC_SECRET },
  }));
  assert.equal(ok.statusCode, 200);
  assert.deepEqual(calls.syncTeamSeats, [{ teamId: "team_1", activeSeats: 4 }]);

  const dark = gateFixture({ syncSecret: null });
  const disabled = await dark.handler(event(SYNC_PATH, {
    body: { teamId: "team_1", activeSeats: 4 },
    headers: { "x-team-context-sync-secret": SYNC_SECRET },
  }));
  assert.equal(disabled.statusCode, 503);
  assert.equal(JSON.parse(disabled.body).code, "team_context_sync_disabled");
});

test("team product webhook events are acknowledged and skipped by the API lifecycle", async () => {
  const lifecycle = createSubscriptionLifecycleService({
    apiAccessService: {
      provisionSubscription: async () => { throw new Error("must not provision"); },
      getSubscriptionAccount: async () => { throw new Error("must not read the account"); },
    },
    eventStore: {
      claimEvent: async () => { throw new Error("must not claim"); },
      completeEvent: async () => "completed",
      releaseEvent: async () => {},
    },
    priceIds: { developer: "price_dev123", pro: "price_pro123", business: "price_business123" },
  });
  const result = await lifecycle.processEvent({
    id: "evt_team_1",
    type: "customer.subscription.created",
    created: 1_794_000_000,
    data: {
      object: {
        id: "sub_team",
        customer: "cus_team",
        status: "incomplete",
        metadata: { accountId: "acct_1", email: "owner@example.com", plan: "team-seat-monthly", product: "team-context-index", teamId: "team_1" },
        items: { data: [{ price: { id: "price_team_seat" }, quantity: 2 }] },
      },
    },
  });
  assert.deepEqual(result, { handled: false, duplicate: false, ignored: "team-context-index" });
});
