import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import Stripe from "stripe";
import {
  createEntitlementService,
  type EntitlementRecord,
  type EntitlementStore,
  type StripeGateway,
} from "../src/service.js";
import { issueEntitlement, verifyEntitlement } from "../src/token.js";
import { createStripeGateway } from "../src/stripe.js";
import { TERMS_VERSION } from "../src/terms.js";

const scanId = "6c8e4b95-1e66-4dc3-9b67-af15f0742875";
const paymentIntentId = "pi_test_paid_payment";
const signingSecret = "entitlement-test-secret-at-least-32-bytes";
const nowMs = Date.parse("2026-07-20T00:00:00.000Z");
const termsVersion = TERMS_VERSION;

function checkoutRequest(overrides: Record<string, unknown> = {}) {
  return {
    scanId,
    turnstileToken: "turnstile-valid-token",
    customerEmail: "buyer@example.test",
    termsAccepted: true,
    immediatePerformanceRequested: true,
    withdrawalAcknowledged: true,
    termsVersion,
    ...overrides,
  };
}

function apiEvent(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: `${method} ${path}`,
    rawPath: path,
    rawQueryString: "",
    headers,
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.invalid",
      domainPrefix: "test",
      http: { method, path, protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "node-test" },
      requestId: "request-test",
      routeKey: `${method} ${path}`,
      stage: "$default",
      time: "20/Jul/2026:00:00:00 +0000",
      timeEpoch: nowMs,
    },
    isBase64Encoded: false,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

function responseBody(response: { body?: string }): Record<string, unknown> {
  return JSON.parse(response.body ?? "{}") as Record<string, unknown>;
}

class MemoryStore implements EntitlementStore {
  records = new Map<string, EntitlementRecord>();
  dispatches = new Map<string, "in_progress" | "queued">();
  throttleAttempts = new Map<string, number>();
  writes = 0;
  refundWrites = 0;

  async putIfAbsent(record: EntitlementRecord): Promise<"created" | "duplicate"> {
    if (this.records.has(record.scanId)) return "duplicate";
    this.records.set(record.scanId, record);
    this.writes += 1;
    return "created";
  }

  async updateRefundStatus(
    scanIdToUpdate: string,
    paymentIntentIdToUpdate: string,
    refundStatus: "partial" | "full",
    eventId: string,
    updatedAt: string,
  ): Promise<"updated" | "duplicate_or_missing"> {
    const record = this.records.get(scanIdToUpdate);
    if (!record || record.sessionId !== paymentIntentIdToUpdate || record.refundEventId === eventId) return "duplicate_or_missing";
    this.records.set(scanIdToUpdate, { ...record, refundStatus, refundEventId: eventId, refundUpdatedAt: updatedAt });
    this.refundWrites += 1;
    return "updated";
  }

  async get(scanIdToFind: string): Promise<EntitlementRecord | undefined> {
    return this.records.get(scanIdToFind);
  }

  async reserveConfirmationDispatch(key: string): Promise<"created" | "in_progress" | "queued"> {
    const existing = this.dispatches.get(key);
    if (existing) return existing;
    this.dispatches.set(key, "in_progress");
    return "created";
  }

  async markConfirmationDispatchQueued(key: string): Promise<void> {
    this.dispatches.set(key, "queued");
  }

  async releaseConfirmationDispatch(key: string): Promise<void> {
    this.dispatches.delete(key);
  }

  async consumeWithdrawalRateLimit(key: string): Promise<boolean> {
    const attempts = this.throttleAttempts.get(key) ?? 0;
    if (attempts >= 5) return false;
    this.throttleAttempts.set(key, attempts + 1);
    return true;
  }
}

function createFixture(payment: {
  paymentStatus: "paid" | "unpaid";
  refundStatus: "none" | "partial" | "full";
  metadata: Record<string, string>;
} = {
  paymentStatus: "paid",
  refundStatus: "none",
  metadata: {
    scanId,
    product: "workflow-preflight-v1",
    termsVersion,
    termsAcceptedAt: "2026-07-20T00:00:00.000Z",
    immediatePerformanceRequested: "true",
    withdrawalAcknowledged: "true",
  },
}, configOverrides: Record<string, unknown> = {}, turnstileResult: boolean | Error = true) {
  const checkoutRequests: Array<{ params: Record<string, unknown>; idempotencyKey: string }> = [];
  const metadataUpdates: Array<{ paymentIntentId: string; metadata: Record<string, unknown>; idempotencyKey: string }> = [];
  const turnstileRequests: Array<{ token: string; remoteIp: string; expectedAction: "checkout" | "withdrawal" }> = [];
  const confirmations: Array<Record<string, unknown>> = [];
  const store = new MemoryStore();
  const stripe: StripeGateway = {
    payments: {
      async create(params, idempotencyKey) {
        checkoutRequests.push({ params, idempotencyKey });
        return {
          id: paymentIntentId,
          clientSecret: "pi_test_paid_payment_secret_test",
          receiptEmail: "buyer@example.test",
          createdAt: Math.floor(nowMs / 1000),
          refundStatus: "none",
        };
      },
      async updateMetadata(id, metadata, idempotencyKey) {
        metadataUpdates.push({ paymentIntentId: id, metadata, idempotencyKey });
      },
      async retrieve(id) {
        assert.equal(id, paymentIntentId);
        return { id, receiptEmail: "buyer@example.test", ...payment };
      },
    },
    webhooks: {
      constructEvent(rawBody, signature) {
        if (!signature.startsWith("valid-")) throw new Error(`bad signature ${rawBody.toString("utf8")}`);
        if (signature === "valid-refund-signature") {
          return { id: "evt_test_refund", type: "charge.refunded", refund: { paymentIntentId } };
        }
        return {
          id: signature === "valid-duplicate-signature" ? "evt_test_duplicate" : "evt_test_paid",
          type: "payment_intent.succeeded",
          paymentIntent: {
            id: paymentIntentId,
            paymentStatus: "paid",
            receiptEmail: "buyer@example.test",
            refundStatus: "none",
            metadata: {
              scanId,
              product: "workflow-preflight-v1",
              termsVersion,
              termsAcceptedAt: "2026-07-20T00:00:00.000Z",
              immediatePerformanceRequested: "true",
              withdrawalAcknowledged: "true",
            },
          },
        };
      },
    },
  };
  const logs: unknown[][] = [];
  const turnstile = {
    async verify({ token, remoteIp, expectedAction }: { token: string; remoteIp: string; expectedAction: "checkout" | "withdrawal" }) {
      turnstileRequests.push({ token, remoteIp, expectedAction });
      if (turnstileResult instanceof Error) throw turnstileResult;
      return turnstileResult;
    },
  };
  const service = createEntitlementService({
    config: {
      siteOrigin: "https://www.solve-lang.com",
      stripeWebhookSecret: "whsec_test_only",
      entitlementSigningSecret: signingSecret,
      mode: "test",
      checkoutEnabled: true,
      durableConfirmationEnabled: true,
      ...configOverrides,
    } as unknown as Parameters<typeof createEntitlementService>[0]["config"],
    stripe,
    store,
    turnstile,
    durableConfirmation: {
      async queueContractConfirmation(input) { confirmations.push(input); },
      async queueWithdrawalConfirmation(input) { confirmations.push(input); },
    },
    now: () => nowMs,
    logger: { info: (...values) => logs.push(values), error: (...values) => logs.push(values) },
  });
  return { service, store, checkoutRequests, metadataUpdates, turnstileRequests, confirmations, logs };
}

test("health exposes only a fixed non-sensitive test-mode readiness contract", async () => {
  const { service } = createFixture();
  const result = await service(apiEvent("GET", "/health"));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(responseBody(result), { status: "ok", service: "solvelang-entitlements", mode: "test" });
  assert.equal(result.headers?.["cache-control"], "no-store");
});

test("test-mode checkout remains operational and records server-derived consent metadata", async () => {
  const { service, checkoutRequests, metadataUpdates, turnstileRequests } = createFixture();
  const result = await service(apiEvent("POST", "/checkout", checkoutRequest()));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(responseBody(result), {
    clientSecret: "pi_test_paid_payment_secret_test",
    paymentId: paymentIntentId,
  });
  assert.equal(checkoutRequests.length, 1);
  assert.deepEqual(turnstileRequests, [{ token: "turnstile-valid-token", remoteIp: "127.0.0.1", expectedAction: "checkout" }]);
  assert.deepEqual(checkoutRequests[0], {
    idempotencyKey: `preflight-${scanId}`,
    params: {
      metadata: {
        scanId,
        product: "workflow-preflight-v1",
        termsVersion,
        immediatePerformanceRequested: "true",
        withdrawalAcknowledged: "true",
      },
      receiptEmail: "buyer@example.test",
    },
  });
  assert.deepEqual(metadataUpdates, [{
    paymentIntentId,
    metadata: { termsAcceptedAt: "2026-07-20T00:00:00.000Z" },
    idempotencyKey: `preflight-${scanId}-consent-${termsVersion}`,
  }]);
});

test("a lost PaymentIntent create response retries with stable parameters and recovers the original client secret", async () => {
  const createRequests: Array<{ params: Record<string, unknown>; idempotencyKey: string }> = [];
  const metadataUpdates: Array<{ paymentIntentId: string; metadata: Record<string, unknown>; idempotencyKey: string }> = [];
  let paymentIntentCreations = 0;
  let clock = nowMs;
  const stablePaymentIntent = {
    id: paymentIntentId,
    clientSecret: "pi_test_paid_payment_secret_test",
    createdAt: Math.floor(nowMs / 1000),
    refundStatus: "none" as const,
  };
  const stripe: StripeGateway = {
    payments: {
      async create(params, idempotencyKey) {
        createRequests.push({ params, idempotencyKey });
        if (createRequests.length === 1) {
          paymentIntentCreations += 1;
          throw new Error("connection dropped after Stripe created the PaymentIntent");
        }
        assert.deepEqual(params, createRequests[0].params);
        assert.equal(idempotencyKey, createRequests[0].idempotencyKey);
        return stablePaymentIntent;
      },
      async updateMetadata(id, metadata, idempotencyKey) {
        metadataUpdates.push({ paymentIntentId: id, metadata, idempotencyKey });
      },
      async retrieve() { return { ...stablePaymentIntent, paymentStatus: "paid", metadata: { scanId, product: "workflow-preflight-v1" } }; },
    },
    webhooks: { constructEvent() { throw new Error("not used"); } },
  };
  const service = createEntitlementService({
    config: {
      siteOrigin: "https://www.solve-lang.com",
      stripeWebhookSecret: "whsec_test_only",
      entitlementSigningSecret: signingSecret,
      mode: "test",
      checkoutEnabled: true,
      durableConfirmationEnabled: true,
    },
    stripe,
    store: new MemoryStore(),
    turnstile: { async verify() { return true; } },
    durableConfirmation: {
      async queueContractConfirmation() {},
      async queueWithdrawalConfirmation() {},
    },
    now: () => clock,
  });

  const first = await service(apiEvent("POST", "/checkout", checkoutRequest()));
  assert.equal(first.statusCode, 502);
  assert.equal(metadataUpdates.length, 0);

  clock += 60_000;
  const retry = await service(apiEvent("POST", "/checkout", checkoutRequest()));
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(responseBody(retry), { clientSecret: stablePaymentIntent.clientSecret, paymentId: paymentIntentId });
  assert.equal(paymentIntentCreations, 1);
  assert.equal(createRequests.length, 2);
  assert.deepEqual(createRequests[1], createRequests[0]);
  assert.deepEqual(metadataUpdates, [{
    paymentIntentId,
    metadata: { termsAcceptedAt: "2026-07-20T00:00:00.000Z" },
    idempotencyKey: `preflight-${scanId}-consent-${termsVersion}`,
  }]);
});

test("a failed consent metadata update withholds the client secret until a stable retry succeeds", async () => {
  const createRequests: Array<{ params: Record<string, unknown>; idempotencyKey: string }> = [];
  const metadataUpdates: Array<{ paymentIntentId: string; metadata: Record<string, unknown>; idempotencyKey: string }> = [];
  let paymentIntentCreations = 0;
  let clock = nowMs;
  const stablePaymentIntent = {
    id: paymentIntentId,
    clientSecret: "pi_test_paid_payment_secret_test",
    createdAt: Math.floor(nowMs / 1000),
    refundStatus: "none" as const,
  };
  const stripe: StripeGateway = {
    payments: {
      async create(params, idempotencyKey) {
        createRequests.push({ params, idempotencyKey });
        if (createRequests.length === 1) paymentIntentCreations += 1;
        return stablePaymentIntent;
      },
      async updateMetadata(id, metadata, idempotencyKey) {
        metadataUpdates.push({ paymentIntentId: id, metadata, idempotencyKey });
        if (metadataUpdates.length === 1) throw new Error("metadata update response lost");
      },
      async retrieve() { return { ...stablePaymentIntent, paymentStatus: "paid", metadata: { scanId, product: "workflow-preflight-v1" } }; },
    },
    webhooks: { constructEvent() { throw new Error("not used"); } },
  };
  const service = createEntitlementService({
    config: {
      siteOrigin: "https://www.solve-lang.com",
      stripeWebhookSecret: "whsec_test_only",
      entitlementSigningSecret: signingSecret,
      mode: "test",
      checkoutEnabled: true,
      durableConfirmationEnabled: true,
    },
    stripe,
    store: new MemoryStore(),
    turnstile: { async verify() { return true; } },
    durableConfirmation: {
      async queueContractConfirmation() {},
      async queueWithdrawalConfirmation() {},
    },
    now: () => clock,
  });

  const first = await service(apiEvent("POST", "/checkout", checkoutRequest()));
  assert.equal(first.statusCode, 502);
  assert.deepEqual(responseBody(first), { error: "Stripe payment is temporarily unavailable." });

  clock += 60_000;
  const retry = await service(apiEvent("POST", "/checkout", checkoutRequest()));
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(responseBody(retry), { clientSecret: stablePaymentIntent.clientSecret, paymentId: paymentIntentId });
  assert.equal(paymentIntentCreations, 1);
  assert.equal(createRequests.length, 2);
  assert.deepEqual(createRequests[1], createRequests[0]);
  assert.equal(metadataUpdates.length, 2);
  assert.deepEqual(metadataUpdates[1], metadataUpdates[0]);
  assert.deepEqual(metadataUpdates[0], {
    paymentIntentId,
    metadata: { termsAcceptedAt: "2026-07-20T00:00:00.000Z" },
    idempotencyKey: `preflight-${scanId}-consent-${termsVersion}`,
  });
});

test("missing, false, and unsupported consent fields fail before Turnstile or Stripe", async () => {
  const requests = [
    { scanId, turnstileToken: "turnstile-valid-token" },
    checkoutRequest({ customerEmail: "not-an-email" }),
    checkoutRequest({ termsAccepted: false }),
    checkoutRequest({ immediatePerformanceRequested: false }),
    checkoutRequest({ withdrawalAcknowledged: false }),
    checkoutRequest({ termsVersion: "unsupported-version" }),
    checkoutRequest({ termsAcceptedAt: "client-supplied-value" }),
  ];

  for (const request of requests) {
    const fixture = createFixture();
    const result = await fixture.service(apiEvent("POST", "/checkout", request));
    assert.equal(result.statusCode, 400);
    assert.deepEqual(responseBody(result), { error: "Invalid request." });
    assert.equal(fixture.turnstileRequests.length, 0);
    assert.equal(fixture.checkoutRequests.length, 0);
  }
});

test("checkout rejects missing and unavailable Turnstile verification before creating a PaymentIntent", async () => {
  const missing = createFixture();
  const missingToken = await missing.service(apiEvent("POST", "/checkout", checkoutRequest({ turnstileToken: undefined })));
  assert.equal(missingToken.statusCode, 400);
  assert.equal(missing.checkoutRequests.length, 0);
  assert.equal(missing.turnstileRequests.length, 0);

  const unavailable = createFixture(undefined, {}, new Error("turnstile unavailable"));
  const unavailableResult = await unavailable.service(apiEvent("POST", "/checkout", checkoutRequest()));
  assert.equal(unavailableResult.statusCode, 503);
  assert.deepEqual(responseBody(unavailableResult), { error: "Verification is temporarily unavailable." });
  assert.equal(unavailable.checkoutRequests.length, 0);
});

test("checkout rejects an unsuccessful Turnstile verification before creating a PaymentIntent", async () => {
  const { service, checkoutRequests, turnstileRequests } = createFixture(undefined, {}, false);
  const result = await service(apiEvent("POST", "/checkout", checkoutRequest({ turnstileToken: "turnstile-invalid-token" })));

  assert.equal(result.statusCode, 403);
  assert.deepEqual(responseBody(result), { error: "Verification could not be completed." });
  assert.deepEqual(turnstileRequests, [{ token: "turnstile-invalid-token", remoteIp: "127.0.0.1", expectedAction: "checkout" }]);
  assert.equal(checkoutRequests.length, 0);
});

test("production bootstrap denies checkout without creating a PaymentIntent or verifying Turnstile", async () => {
  const { service, checkoutRequests, turnstileRequests } = createFixture(undefined, { mode: "production", checkoutEnabled: false });
  const result = await service(apiEvent("POST", "/checkout", { scanId, opaque: "must-not-be-parsed" }));

  assert.equal(result.statusCode, 503);
  assert.deepEqual(responseBody(result), { error: "Checkout is temporarily unavailable." });
  assert.equal(checkoutRequests.length, 0);
  assert.equal(turnstileRequests.length, 0);
});

test("explicitly enabled production checkout creates a PaymentIntent", async () => {
  const { service, checkoutRequests } = createFixture(undefined, { mode: "production", checkoutEnabled: true });
  const result = await service(apiEvent("POST", "/checkout", checkoutRequest()));

  assert.equal(result.statusCode, 200);
  assert.equal(checkoutRequests.length, 1);
});

test("valid signed webhook records one entitlement and persistent confirmation dispatch suppresses late replays", async () => {
  const { service, store, confirmations } = createFixture();
  const event = apiEvent("POST", "/webhook", { opaque: "stripe fixture" }, { "stripe-signature": "valid-test-signature" });
  const duplicate = apiEvent("POST", "/webhook", { opaque: "stripe fixture" }, { "stripe-signature": "valid-duplicate-signature" });

  const first = await service(event);
  const replay = await service(event);
  const duplicateDelivery = await service(duplicate);

  assert.equal(first.statusCode, 200);
  assert.equal(replay.statusCode, 200);
  assert.equal(duplicateDelivery.statusCode, 200);
  assert.deepEqual(responseBody(first), { received: true });
  assert.deepEqual(responseBody(replay), { received: true });
  assert.equal(store.writes, 1);
  assert.equal(confirmations.length, 1);
  assert.equal(store.dispatches.get(`contract:${paymentIntentId}:${termsVersion}`), "queued");
  assert.deepEqual(store.records.get(scanId), {
    scanId,
    sessionId: paymentIntentId,
    paymentStatus: "paid",
    refundStatus: "none",
    stripeEventId: "evt_test_paid",
    createdAt: "2026-07-20T00:00:00.000Z",
    expiresAt: Math.floor(nowMs / 1000) + 60 * 60 * 24 * 30,
  });
});

test("Stripe gateway verifies a deterministic local test signature without network access", () => {
  const webhookSecret = "whsec_local_test_signature";
  const payload = JSON.stringify({
    id: "evt_local_signed",
    object: "event",
    type: "payment_intent.succeeded",
    data: {
      object: {
        id: paymentIntentId,
        object: "payment_intent",
        status: "succeeded",
        metadata: { scanId, product: "workflow-preflight-v1" },
      },
    },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret, timestamp: 1_753_056_000 });
  const gateway = createStripeGateway(new Stripe("sk_test_local_only"), { receivedAt: () => 1_753_056_000 });

  const event = gateway.webhooks.constructEvent(Buffer.from(payload), signature, webhookSecret);
  assert.deepEqual(event, {
    id: "evt_local_signed",
    type: "payment_intent.succeeded",
    paymentIntent: { id: paymentIntentId, paymentStatus: "paid", refundStatus: "none", metadata: { scanId, product: "workflow-preflight-v1" } },
  });
});

test("Stripe gateway verifies a deterministic local refund signature without network access", () => {
  const webhookSecret = "whsec_local_refund_signature";
  const payload = JSON.stringify({
    id: "evt_local_refund",
    object: "event",
    type: "charge.refunded",
    data: {
      object: {
        id: "ch_test_refunded",
        object: "charge",
        payment_intent: paymentIntentId,
        amount: 4900,
        amount_refunded: 4900,
        refunded: true,
      },
    },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret, timestamp: 1_753_056_000 });
  const gateway = createStripeGateway(new Stripe("sk_test_local_only"), { receivedAt: () => 1_753_056_000 });

  assert.deepEqual(gateway.webhooks.constructEvent(Buffer.from(payload), signature, webhookSecret), {
    id: "evt_local_refund",
    type: "charge.refunded",
    refund: { paymentIntentId },
  });
});

test("Stripe gateway creates exactly one $49 card PaymentIntent, records consent metadata, and reads expanded refund state", async () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const client = {
    paymentIntents: {
      async create(...args: unknown[]) {
        calls.push({ method: "create", args });
        return {
          id: paymentIntentId,
          client_secret: "pi_test_paid_payment_secret_test",
          created: Math.floor(nowMs / 1000),
          status: "requires_payment_method",
          amount: 4900,
          latest_charge: null,
          metadata: { scanId, product: "workflow-preflight-v1" },
        };
      },
      async retrieve(...args: unknown[]) {
        calls.push({ method: "retrieve", args });
        return {
          id: paymentIntentId,
          client_secret: null,
          created: Math.floor(nowMs / 1000),
          status: "succeeded",
          amount: 4900,
          latest_charge: { amount_refunded: 1200, refunded: false },
          metadata: { scanId, product: "workflow-preflight-v1" },
        };
      },
      async update(...args: unknown[]) {
        calls.push({ method: "update", args });
        return {};
      },
    },
    webhooks: { constructEvent() { throw new Error("not used"); } },
  } as unknown as Stripe;
  const gateway = createStripeGateway(client);

  await gateway.payments.create({
    metadata: {
      scanId,
      product: "workflow-preflight-v1",
      termsVersion,
      immediatePerformanceRequested: "true",
      withdrawalAcknowledged: "true",
    },
    receiptEmail: "buyer@example.test",
  }, "idempotent-scan");
  await gateway.payments.updateMetadata(
    paymentIntentId,
    { termsAcceptedAt: "2026-07-20T00:00:00.000Z" },
    `preflight-${scanId}-consent-${termsVersion}`,
  );
  const snapshot = await gateway.payments.retrieve(paymentIntentId);

  assert.deepEqual(calls[0], {
    method: "create",
    args: [{
      amount: 4900,
      currency: "usd",
      payment_method_types: ["card"],
      description: "SolveLang Workflow Preflight Report",
      metadata: {
        scanId,
        product: "workflow-preflight-v1",
        termsVersion,
        immediatePerformanceRequested: "true",
        withdrawalAcknowledged: "true",
      },
      receipt_email: "buyer@example.test",
    }, { idempotencyKey: "idempotent-scan" }],
  });
  assert.deepEqual(calls[1], {
    method: "update",
    args: [
      paymentIntentId,
      { metadata: { termsAcceptedAt: "2026-07-20T00:00:00.000Z" } },
      { idempotencyKey: `preflight-${scanId}-consent-${termsVersion}` },
    ],
  });
  assert.deepEqual(calls[2], { method: "retrieve", args: [paymentIntentId, { expand: ["latest_charge"] }] });
  assert.equal(snapshot.refundStatus, "partial");
});

test("invalid webhook signatures are rejected without processing", async () => {
  const { service, store } = createFixture();
  const result = await service(apiEvent("POST", "/webhook", { private: "raw payload" }, { "stripe-signature": "invalid" }));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(responseBody(result), { error: "Invalid webhook." });
  assert.equal(store.writes, 0);
});

test("paid payment recovery issues a verifiable short-lived entitlement", async () => {
  const { service, confirmations } = createFixture();
  await service(apiEvent("POST", "/webhook", { opaque: "stripe fixture" }, { "stripe-signature": "valid-test-signature" }));
  const result = await service(apiEvent("POST", "/entitlement", { scanId, sessionId: paymentIntentId }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(confirmations, [{
    email: "buyer@example.test",
    paymentIntentId,
    product: "Workflow Preflight",
    total: "USD $49",
    termsVersion,
    termsAcceptedAt: "2026-07-20T00:00:00.000Z",
    immediatePerformanceRequested: true,
    withdrawalAcknowledged: true,
    deliveryDescription: "An automated Workflow Preflight report is processed and delivered immediately after successful payment.",
    supportEmail: "hello@solve-lang.com",
    termsText: (await import("../src/terms.js")).CONTRACT_TERMS_TEXT,
    refundPolicyText: (await import("../src/terms.js")).CONTRACT_REFUND_POLICY_TEXT,
    idempotencyKey: `contract-confirmation-${paymentIntentId}-${termsVersion}`,
  }]);
  const body = responseBody(result);
  assert.equal(body.expiresAt, "2026-07-20T00:15:00.000Z");
  assert.deepEqual(verifyEntitlement(String(body.token), signingSecret, Math.floor(nowMs / 1000)), {
    version: 1,
    scanId,
    sessionId: paymentIntentId,
    exp: Math.floor(nowMs / 1000) + 15 * 60,
  });
});

test("report recovery remains unavailable until the signed webhook queues durable confirmation", async () => {
  const fixture = createFixture(undefined, { durableConfirmationEnabled: false });
  await fixture.service(apiEvent("POST", "/webhook", { opaque: "stripe fixture" }, { "stripe-signature": "valid-test-signature" }));
  const result = await fixture.service(apiEvent("POST", "/entitlement", { scanId, sessionId: paymentIntentId }));
  assert.equal(result.statusCode, 409);
  assert.deepEqual(responseBody(result), { code: "payment_pending", error: "Payment succeeded and is awaiting webhook verification." });
  assert.equal(fixture.confirmations.length, 0);
});

test("withdrawal requests require durable confirmation and record only a server timestamp", async () => {
  const { service, confirmations } = createFixture();
  const result = await service(apiEvent("POST", "/withdraw", {
    name: "Buyer Name",
    contractReference: paymentIntentId,
    email: "buyer@example.test",
    statement: "I hereby withdraw from the Workflow Preflight contract.",
    turnstileToken: "withdrawal-turnstile-token",
    requestId: "6494ef6d-c1c6-4a70-a2b4-ae1af835b682",
  }));
  assert.equal(result.statusCode, 202);
  assert.deepEqual(responseBody(result), {
    receivedAt: "2026-07-20T00:00:00.000Z",
    message: "Your withdrawal request was received. Eligibility will be reviewed under applicable law.",
  });
  const { idempotencyKey, ...withdrawalConfirmation } = confirmations[0];
  assert.deepEqual(withdrawalConfirmation, {
    name: "Buyer Name",
    contractReference: paymentIntentId,
    email: "buyer@example.test",
    statement: "I hereby withdraw from the Workflow Preflight contract.",
    receivedAt: "2026-07-20T00:00:00.000Z",
    supportEmail: "hello@solve-lang.com",
  });
  assert.match(String(idempotencyKey), /^withdrawal-[a-f0-9]{64}$/);
  assert.equal(String(idempotencyKey).includes("buyer@example.test"), false);
});

test("withdrawal requires its own Turnstile action and limits repeated submissions", async () => {
  const missing = createFixture();
  const baseRequest = {
    name: "Buyer Name",
    contractReference: paymentIntentId,
    email: "buyer@example.test",
    statement: "I hereby withdraw from the Workflow Preflight contract.",
    requestId: "6494ef6d-c1c6-4a70-a2b4-ae1af835b682",
  };
  assert.equal((await missing.service(apiEvent("POST", "/withdraw", baseRequest))).statusCode, 400);
  assert.equal(missing.confirmations.length, 0);

  const rejected = createFixture(undefined, {}, false);
  const rejectedResult = await rejected.service(apiEvent("POST", "/withdraw", { ...baseRequest, turnstileToken: "rejected" }));
  assert.equal(rejectedResult.statusCode, 403);
  assert.deepEqual(rejected.turnstileRequests, [{ token: "rejected", remoteIp: "127.0.0.1", expectedAction: "withdrawal" }]);
  assert.equal(rejected.confirmations.length, 0);

  const limited = createFixture();
  for (let index = 0; index < 5; index += 1) {
    const result = await limited.service(apiEvent("POST", "/withdraw", {
      ...baseRequest,
      turnstileToken: `token-${index}`,
      requestId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    }));
    assert.equal(result.statusCode, 202);
  }
  const sixth = await limited.service(apiEvent("POST", "/withdraw", {
    ...baseRequest,
    turnstileToken: "token-6",
    requestId: "00000000-0000-4000-8000-000000000006",
  }));
  assert.equal(sixth.statusCode, 429);
  assert.equal(limited.confirmations.length, 5);
});

test("full refunds revoke entitlement renewal while partial refunds remain eligible", async () => {
  const partial = createFixture({
    paymentStatus: "paid",
    refundStatus: "partial",
    metadata: {
      scanId,
      product: "workflow-preflight-v1",
      termsVersion,
      termsAcceptedAt: "2026-07-20T00:00:00.000Z",
      immediatePerformanceRequested: "true",
      withdrawalAcknowledged: "true",
    },
  });
  await partial.service(apiEvent("POST", "/webhook", { opaque: "stripe fixture" }, { "stripe-signature": "valid-test-signature" }));
  const partialResult = await partial.service(apiEvent("POST", "/entitlement", { scanId, sessionId: paymentIntentId }));
  assert.equal(partialResult.statusCode, 200);

  const full = createFixture({
    paymentStatus: "paid",
    refundStatus: "full",
    metadata: {
      scanId,
      product: "workflow-preflight-v1",
      termsVersion,
      termsAcceptedAt: "2026-07-20T00:00:00.000Z",
      immediatePerformanceRequested: "true",
      withdrawalAcknowledged: "true",
    },
  });
  await full.service(apiEvent("POST", "/webhook", { opaque: "stripe fixture" }, { "stripe-signature": "valid-test-signature" }));
  const fullResult = await full.service(apiEvent("POST", "/entitlement", { scanId, sessionId: paymentIntentId }));
  assert.equal(fullResult.statusCode, 403);
  assert.deepEqual(responseBody(fullResult), { code: "payment_refunded", error: "This payment was fully refunded and is no longer eligible." });
});

test("signed refund webhook records verified full refund state idempotently", async () => {
  const fixture = createFixture({
    paymentStatus: "paid",
    refundStatus: "full",
    metadata: { scanId, product: "workflow-preflight-v1" },
  });
  await fixture.service(apiEvent("POST", "/webhook", { opaque: "paid fixture" }, { "stripe-signature": "valid-test-signature" }));
  const refund = apiEvent("POST", "/webhook", { opaque: "refund fixture" }, { "stripe-signature": "valid-refund-signature" });
  assert.equal((await fixture.service(refund)).statusCode, 200);
  assert.equal((await fixture.service(refund)).statusCode, 200);
  assert.equal(fixture.store.refundWrites, 1);
  assert.equal(fixture.store.records.get(scanId)?.refundStatus, "full");
  assert.equal(fixture.store.records.get(scanId)?.refundEventId, "evt_test_refund");
});

test("missing webhook record is retryable but unpaid and mismatched payments fail closed", async () => {
  const missing = createFixture();
  const pending = await missing.service(apiEvent("POST", "/entitlement", { scanId, sessionId: paymentIntentId }));
  assert.equal(pending.statusCode, 409);
  assert.deepEqual(responseBody(pending), { code: "payment_pending", error: "Payment succeeded and is awaiting webhook verification." });

  const unpaid = createFixture({ paymentStatus: "unpaid", refundStatus: "none", metadata: { scanId, product: "workflow-preflight-v1" } });
  const unpaidResult = await unpaid.service(apiEvent("POST", "/entitlement", { scanId, sessionId: paymentIntentId }));
  assert.equal(unpaidResult.statusCode, 402);
  assert.deepEqual(responseBody(unpaidResult), { code: "payment_not_succeeded", error: "Payment has not succeeded." });

  const mismatch = createFixture({ paymentStatus: "paid", refundStatus: "none", metadata: { scanId: "different", product: "workflow-preflight-v1" } });
  const mismatchResult = await mismatch.service(apiEvent("POST", "/entitlement", { scanId, sessionId: paymentIntentId }));
  assert.equal(mismatchResult.statusCode, 403);
});

test("unpaid or mismatched payment cannot receive an entitlement", async () => {
  const fixture = createFixture();
  fixture.store.records.set(scanId, {
    scanId,
    sessionId: paymentIntentId,
    paymentStatus: "unpaid",
    stripeEventId: "evt_unpaid",
    createdAt: "2026-07-20T00:00:00.000Z",
    expiresAt: Math.floor(nowMs / 1000) + 60,
  });
  const result = await fixture.service(apiEvent("POST", "/entitlement", { scanId, sessionId: paymentIntentId }));
  assert.equal(result.statusCode, 403);
  assert.deepEqual(responseBody(result), { code: "payment_ineligible", error: "No matching eligible payment was found." });
});

test("expired, invalid, and tampered entitlement tokens are rejected", () => {
  const claims = { version: 1 as const, scanId, sessionId: paymentIntentId, exp: 1000 };
  const token = issueEntitlement(claims, signingSecret);
  assert.throws(() => verifyEntitlement(token, signingSecret, 1000), /expired/);
  assert.throws(() => verifyEntitlement(token, "different-secret-at-least-32-bytes"), /signature/);
  assert.throws(() => verifyEntitlement(`${token}x`, signingSecret), /signature/);
});
