import assert from "node:assert/strict";
import test from "node:test";

import { parseApiAccessEnvironment } from "../src/config.js";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";
import {
  TEAM_CONTEXT_MAX_SEATS,
  TEAM_CONTEXT_MIN_SEATS,
  TEAM_CONTEXT_PLAN_NAMES,
  TEAM_CONTEXT_PLANS,
  TEAM_CONTEXT_PRODUCT,
  getTeamContextPlan,
} from "../src/team-context-plans.js";

test("team context catalog carries exactly the owner-decided seat price", () => {
  assert.equal(TEAM_CONTEXT_PRODUCT, "team-context-index");
  assert.deepEqual(TEAM_CONTEXT_PLAN_NAMES, ["team-seat-monthly"]);
  const plan = getTeamContextPlan("team-seat-monthly");
  assert.equal(plan.perSeatAmountCents, 800);
  assert.equal(plan.currency, "usd");
  assert.equal(plan.interval, "monthly");
  assert.equal(TEAM_CONTEXT_PLANS["team-seat-monthly"], plan);
  assert.equal(TEAM_CONTEXT_MIN_SEATS, 1);
  assert.equal(TEAM_CONTEXT_MAX_SEATS, 999);
  assert.throws(() => getTeamContextPlan("team-seat-annual"), /Unknown Team Context Index plan/);
  assert.throws(() => getTeamContextPlan(undefined), /Unknown Team Context Index plan/);
});

function baseEnvironment(overrides = {}) {
  return {
    API_ACCESS_MODE: "test",
    API_KEY_PEPPER: "p".repeat(40),
    API_ACCOUNTS_TABLE: "accounts",
    API_KEYS_TABLE: "keys",
    API_USAGE_TABLE: "usage",
    API_USAGE_IDEMPOTENCY_TABLE: "usage-idempotency",
    API_SUBSCRIPTION_EVENTS_TABLE: "subscription-events",
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_ACCESS_ADMIN_SECRET: "s".repeat(40),
    ...overrides,
  };
}

test("team context config stays dark without its pointers and parses them when present", () => {
  const dark = parseApiAccessEnvironment(baseEnvironment());
  assert.deepEqual(dark.teamContext, {
    priceId: undefined,
    syncSecret: undefined,
    mcpBaseUrl: undefined,
    mcpBillingToken: undefined,
  });

  const lit = parseApiAccessEnvironment(baseEnvironment({
    STRIPE_TEAM_CONTEXT_PRICE_ID: "price_team_seat",
    TEAM_CONTEXT_SYNC_SECRET: "sync-secret",
    TEAM_CONTEXT_MCP_BASE_URL: "https://mcp.solve-lang.com/",
    TEAM_CONTEXT_MCP_BILLING_TOKEN: "billing-token",
  }));
  assert.equal(lit.teamContext.priceId, "price_team_seat");
  assert.equal(lit.teamContext.syncSecret, "sync-secret");
  // The base URL is normalized the same way the Merge Governance
  // service pointer is: trailing slashes never reach the client.
  assert.equal(lit.teamContext.mcpBaseUrl, "https://mcp.solve-lang.com");
  assert.equal(lit.teamContext.mcpBillingToken, "billing-token");
});

function stripeClient(overrides = {}) {
  return {
    checkout: { sessions: { create: async () => ({ id: "cs_default" }) } },
    webhooks: { constructEvent: () => ({}) },
    customers: { create: async () => ({ id: "cus_1" }), update: async () => ({}), retrieve: async () => ({ id: "cus_1" }) },
    promotionCodes: { list: async () => ({ data: [] }) },
    subscriptions: {
      create: async () => ({ id: "sub_1", latest_invoice: { payment_intent: null, amount_due: 0, status: "paid" } }),
      retrieve: async () => ({ id: "sub_1", status: "active", items: { data: [{ id: "si_1", quantity: 2 }] } }),
      update: async () => ({ id: "sub_1", status: "active" }),
    },
    invoices: { list: async () => ({ data: [] }) },
    invoicePayments: { list: async () => ({ data: [] }) },
    paymentIntents: { retrieve: async () => ({}) },
    paymentMethods: { list: async () => ({ data: [] }), detach: async () => ({}) },
    setupIntents: { create: async () => ({ id: "seti_1" }), retrieve: async () => ({ id: "seti_1" }) },
    ...overrides,
  };
}

test("createIncompleteSubscription carries the team id in subscription metadata", async () => {
  let captured;
  const stripe = stripeClient({
    subscriptions: {
      create: async (args) => {
        captured = args;
        return { id: "sub_team", latest_invoice: { payment_intent: { client_secret: "pi_secret" }, amount_due: 1600, status: "open" } };
      },
      retrieve: async () => { throw new Error("not used"); },
      update: async () => { throw new Error("not used"); },
    },
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  const created = await gateway.createIncompleteSubscription({
    accountId: "acct_1",
    requestId: "req_1",
    email: "owner@example.com",
    plan: "team-seat-monthly",
    priceId: "price_team_seat",
    customerId: "cus_1",
    quantity: 2,
    product: "team-context-index",
    subscriptionMetadata: { teamId: "team_123" },
  });
  assert.equal(created.subscriptionId, "sub_team");
  assert.equal(created.paymentRequired, true);
  assert.deepEqual(captured.items, [{ price: "price_team_seat", quantity: 2 }]);
  assert.equal(captured.metadata.accountId, "acct_1");
  assert.equal(captured.metadata.plan, "team-seat-monthly");
  assert.equal(captured.metadata.product, "team-context-index");
  assert.equal(captured.metadata.teamId, "team_123");
});

test("updateSubscriptionQuantity moves the single item's quantity with prorations", async () => {
  const updates = [];
  const stripe = stripeClient({
    subscriptions: {
      create: async () => { throw new Error("not used"); },
      retrieve: async () => ({ id: "sub_1", status: "active", items: { data: [{ id: "si_1", quantity: 2 }] } }),
      update: async (id, args) => { updates.push([id, args]); return { id, status: "active" }; },
    },
  });
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");

  const up = await gateway.updateSubscriptionQuantity({ subscriptionId: "sub_1", quantity: 3 });
  assert.deepEqual(up, { applied: true, status: "active", quantity: 3 });
  assert.deepEqual(updates, [["sub_1", { items: [{ id: "si_1", quantity: 3 }], proration_behavior: "create_prorations" }]]);

  const unchanged = await gateway.updateSubscriptionQuantity({ subscriptionId: "sub_1", quantity: 2 });
  assert.deepEqual(unchanged, { applied: false, reason: "unchanged", status: "active", quantity: 2 });
  assert.equal(updates.length, 1);
});

test("updateSubscriptionQuantity skips canceled subscriptions and refuses multi-item ones", async () => {
  const canceled = createStripeSubscriptionGateway(stripeClient({
    subscriptions: {
      create: async () => { throw new Error("not used"); },
      retrieve: async () => ({ id: "sub_1", status: "canceled", items: { data: [{ id: "si_1", quantity: 2 }] } }),
      update: async () => { throw new Error("must not update a canceled subscription"); },
    },
  }), "whsec_test");
  assert.deepEqual(
    await canceled.updateSubscriptionQuantity({ subscriptionId: "sub_1", quantity: 5 }),
    { applied: false, reason: "canceled", status: "canceled", quantity: 2 },
  );

  const multi = createStripeSubscriptionGateway(stripeClient({
    subscriptions: {
      create: async () => { throw new Error("not used"); },
      retrieve: async () => ({ id: "sub_1", status: "active", items: { data: [{ id: "si_1", quantity: 1 }, { id: "si_2", quantity: 1 }] } }),
      update: async () => { throw new Error("must not update a multi-item subscription"); },
    },
  }), "whsec_test");
  await assert.rejects(
    () => multi.updateSubscriptionQuantity({ subscriptionId: "sub_1", quantity: 5 }),
    /exactly one managed item/,
  );
});
