import assert from "node:assert/strict";
import test from "node:test";

import { createTeamContextBillingService } from "../src/team-context-billing.js";
import { createTeamContextCheckoutService } from "../src/team-context-checkout.js";
import { createDynamoTeamContextStore } from "../src/team-context-store.js";

const silentLogger = { error() {}, warn() {}, info() {} };

function fakeGateway(overrides = {}) {
  const calls = { create: [], quantity: [] };
  const subscriptions = new Map();
  return {
    calls,
    subscriptions,
    async findPromotionCode(code) { return code === "WELCOME" ? "promo_1" : undefined; },
    async createIncompleteSubscription(args) {
      calls.create.push(args);
      subscriptions.set("sub_team_1", { quantity: args.quantity, status: "incomplete" });
      return { subscriptionId: "sub_team_1", customerId: "cus_team_1", clientSecret: "pi_secret_team", paymentRequired: true };
    },
    async updateSubscriptionQuantity({ subscriptionId, quantity }) {
      calls.quantity.push({ subscriptionId, quantity });
      const current = subscriptions.get(subscriptionId);
      if (!current) throw new Error("unknown subscription");
      if (current.status === "canceled") return { applied: false, reason: "canceled", status: "canceled", quantity: current.quantity };
      if (current.quantity === quantity) return { applied: false, reason: "unchanged", status: current.status, quantity };
      current.quantity = quantity;
      return { applied: true, status: current.status, quantity };
    },
    ...overrides,
  };
}

function fakeApiAccessService() {
  const state = { reserved: [], released: [] };
  return {
    state,
    async reserveSubscriptionCheckout(args) { state.reserved.push(args); },
    async releaseSubscriptionCheckout(args) { state.released.push(args); },
  };
}

function fakeStore() {
  const records = new Map();
  return {
    records,
    async recordTeamSubscription(record) { records.set(record.teamId, { ...record }); return record; },
    async getTeamSubscription(teamId) { return records.get(teamId); },
  };
}

function checkoutService(overrides = {}) {
  const gateway = overrides.gateway ?? fakeGateway();
  const apiAccessService = overrides.apiAccessService ?? fakeApiAccessService();
  const store = overrides.store ?? fakeStore();
  const service = createTeamContextCheckoutService({
    gateway,
    apiAccessService,
    teamContextStore: store,
    priceId: "priceId" in overrides ? overrides.priceId : "price_teamseat1",
    enabled: "enabled" in overrides ? overrides.enabled : true,
    logger: silentLogger,
    now: () => 1700000000000,
  });
  return { service, gateway, apiAccessService, store };
}

test("team context checkout creates a per-seat subscription and records the team mapping", async () => {
  const { service, gateway, apiAccessService, store } = checkoutService();
  const result = await service.createTeamContextCheckout({
    accountId: "acct_1",
    requestId: "req_1",
    email: "Owner@Example.com",
    plan: "team-seat-monthly",
    teamId: "team_123",
    quantity: 3,
  });
  assert.deepEqual(result, {
    subscriptionId: "sub_team_1",
    customerId: "cus_team_1",
    paymentRequired: true,
    clientSecret: "pi_secret_team",
  });
  assert.equal(apiAccessService.state.reserved.length, 1);
  assert.equal(apiAccessService.state.released.length, 0);
  const created = gateway.calls.create[0];
  assert.equal(created.priceId, "price_teamseat1");
  assert.equal(created.quantity, 3);
  assert.equal(created.product, "team-context-index");
  assert.deepEqual(created.subscriptionMetadata, { teamId: "team_123" });
  assert.deepEqual(store.records.get("team_123"), {
    teamId: "team_123",
    accountId: "acct_1",
    subscriptionId: "sub_team_1",
    customerId: "cus_team_1",
    seats: 3,
    updatedAt: 1700000000000,
  });
});

test("team context checkout fails closed without a price and releases the reservation on gateway failure", async () => {
  const noPrice = checkoutService({ priceId: undefined });
  await assert.rejects(
    () => noPrice.service.createTeamContextCheckout({
      accountId: "acct_1", requestId: "req_1", email: "owner@example.com",
      plan: "team-seat-monthly", teamId: "team_123", quantity: 1,
    }),
    (error) => error.statusCode === 503 && error.code === "team_context_price_unavailable",
  );
  assert.equal(noPrice.apiAccessService.state.reserved.length, 0);

  const failing = checkoutService({
    gateway: fakeGateway({
      async createIncompleteSubscription() { throw new Error("stripe down"); },
    }),
  });
  await assert.rejects(
    () => failing.service.createTeamContextCheckout({
      accountId: "acct_1", requestId: "req_2", email: "owner@example.com",
      plan: "team-seat-monthly", teamId: "team_123", quantity: 2,
    }),
    /stripe down/,
  );
  assert.equal(failing.apiAccessService.state.reserved.length, 1);
  assert.equal(failing.apiAccessService.state.released.length, 1);

  const disabled = checkoutService({ enabled: false });
  await assert.rejects(
    () => disabled.service.createTeamContextCheckout({
      accountId: "acct_1", requestId: "req_3", email: "owner@example.com",
      plan: "team-seat-monthly", teamId: "team_123", quantity: 1,
    }),
    (error) => error.statusCode === 503 && error.code === "team_context_checkout_disabled",
  );
});

test("the Dynamo team context store round-trips through the prefixed auth key", async () => {
  const sent = [];
  const documentClient = {
    async send(command) {
      sent.push(command);
      if (command.constructor.name === "GetCommand") {
        return { Item: { authKey: "team-context-subscription#team_9", kind: "team-context-subscription", teamId: "team_9", subscriptionId: "sub_9", seats: 2 } };
      }
      return {};
    },
  };
  const store = createDynamoTeamContextStore(documentClient, "auth-table");
  await store.recordTeamSubscription({ teamId: "team_9", accountId: "acct_9", subscriptionId: "sub_9", customerId: "cus_9", seats: 2, updatedAt: 5 });
  const put = sent[0].input;
  assert.equal(put.TableName, "auth-table");
  assert.equal(put.Item.authKey, "team-context-subscription#team_9");
  assert.equal(put.Item.kind, "team-context-subscription");
  const found = await store.getTeamSubscription("team_9");
  assert.equal(found.subscriptionId, "sub_9");
  assert.deepEqual(sent[1].input.Key, { authKey: "team-context-subscription#team_9" });
});

function billingService({ gateway, store, fetchImpl }) {
  return createTeamContextBillingService({
    mcpBaseUrl: "https://mcp.solve-lang.com",
    mcpBillingToken: "billing-token",
    gateway,
    teamContextStore: store,
    fetchImpl,
    logger: silentLogger,
    now: () => 1700000000000,
  });
}

function jsonResponse(status, payload) {
  return { ok: status >= 200 && status < 300, status, json: async () => payload };
}

test("billing reads present the seat price and per-team monthly totals", async () => {
  const requests = [];
  const fetchImpl = async (url, init) => {
    requests.push([url, init]);
    return jsonResponse(200, { teams: [{ id: "team_1", name: "Core", activeSeats: 4 }] });
  };
  const service = billingService({ gateway: fakeGateway(), store: fakeStore(), fetchImpl });
  const result = await service.listOwnerTeams({ email: "Owner@Example.com" });
  assert.equal(result.perSeatAmountCents, 800);
  assert.equal(result.currency, "usd");
  assert.deepEqual(result.teams, [{ id: "team_1", name: "Core", activeSeats: 4, monthlyTotalCents: 3200 }]);
  assert.equal(requests[0][0], "https://mcp.solve-lang.com/billing/teams?ownerEmail=owner%40example.com");
  assert.equal(requests[0][1].headers.authorization, "Bearer billing-token");
});

test("seat sync follows membership: join up, revoke down, re-invite counts once", async () => {
  const gateway = fakeGateway();
  const store = fakeStore();
  const service = billingService({ gateway, store, fetchImpl: async () => jsonResponse(404, {}) });
  // No subscription yet: sync is a normal no-op, never an error.
  assert.deepEqual(await service.syncTeamSeats({ teamId: "team_1", activeSeats: 2 }),
    { synced: false, reason: "no_subscription", teamId: "team_1", activeSeats: 2 });
  assert.equal(gateway.calls.quantity.length, 0);

  // The owner subscribes with 2 active seats (owner + one member).
  await store.recordTeamSubscription({ teamId: "team_1", accountId: "acct_1", subscriptionId: "sub_team_1", customerId: "cus_1", seats: 2, updatedAt: 1 });
  gateway.subscriptions.set("sub_team_1", { quantity: 2, status: "active" });

  // A member accepts an invite: 2 -> 3.
  assert.equal((await service.syncTeamSeats({ teamId: "team_1", activeSeats: 3 })).synced, true);
  // The member is revoked: 3 -> 2.
  assert.equal((await service.syncTeamSeats({ teamId: "team_1", activeSeats: 2 })).synced, true);
  // The same person is re-invited and accepts: the MCP count is 3
  // again (one active record), never 4 - the sync forwards it as-is.
  assert.equal((await service.syncTeamSeats({ teamId: "team_1", activeSeats: 3 })).synced, true);
  assert.deepEqual(gateway.calls.quantity.map((call) => call.quantity), [3, 2, 3]);
  assert.equal(store.records.get("team_1").seats, 3);

  // An unchanged report does not touch Stripe again, and a canceled
  // subscription is left alone.
  assert.deepEqual(await service.syncTeamSeats({ teamId: "team_1", activeSeats: 3 }),
    { synced: false, reason: "unchanged", teamId: "team_1", activeSeats: 3, subscriptionId: "sub_team_1" });
  gateway.subscriptions.get("sub_team_1").status = "canceled";
  assert.deepEqual(await service.syncTeamSeats({ teamId: "team_1", activeSeats: 5 }),
    { synced: false, reason: "canceled", teamId: "team_1", activeSeats: 5, subscriptionId: "sub_team_1" });
});

test("seat sync never drops a subscription below the owner's seat", async () => {
  const gateway = fakeGateway();
  const store = fakeStore();
  const service = billingService({ gateway, store, fetchImpl: async () => jsonResponse(404, {}) });
  await store.recordTeamSubscription({ teamId: "team_1", accountId: "acct_1", subscriptionId: "sub_team_1", customerId: "cus_1", seats: 2, updatedAt: 1 });
  gateway.subscriptions.set("sub_team_1", { quantity: 2, status: "active" });
  const result = await service.syncTeamSeats({ teamId: "team_1", activeSeats: 0 });
  assert.equal(result.activeSeats, 1);
  assert.deepEqual(gateway.calls.quantity.map((call) => call.quantity), [1]);
});
