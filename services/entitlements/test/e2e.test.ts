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

const scanId = "6c8e4b95-1e66-4dc3-9b67-af15f0742875";
const sessionId = "cs_test_paid_session";
const signingSecret = "entitlement-test-secret-at-least-32-bytes";
const nowMs = Date.parse("2026-07-20T00:00:00.000Z");

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
  writes = 0;

  async putIfAbsent(record: EntitlementRecord): Promise<"created" | "duplicate"> {
    if (this.records.has(record.scanId)) return "duplicate";
    this.records.set(record.scanId, record);
    this.writes += 1;
    return "created";
  }

  async get(scanIdToFind: string): Promise<EntitlementRecord | undefined> {
    return this.records.get(scanIdToFind);
  }
}

function createFixture() {
  const checkoutRequests: Array<{ params: Record<string, unknown>; idempotencyKey: string }> = [];
  const store = new MemoryStore();
  const stripe: StripeGateway = {
    checkout: {
      async create(params, idempotencyKey) {
        checkoutRequests.push({ params, idempotencyKey });
        return { id: sessionId, clientSecret: "cs_test_paid_session_secret_example" };
      },
      async retrieve(id) {
        assert.equal(id, sessionId);
        return { id, paymentStatus: "paid", metadata: { scanId, product: "workflow-preflight-v1" } };
      },
    },
    webhooks: {
      constructEvent(rawBody, signature) {
        if (!signature.startsWith("valid-")) throw new Error(`bad signature ${rawBody.toString("utf8")}`);
        return {
          id: signature === "valid-duplicate-signature" ? "evt_test_duplicate" : "evt_test_paid",
          type: "checkout.session.completed",
          session: { id: sessionId, paymentStatus: "paid", metadata: { scanId, product: "workflow-preflight-v1" } },
        };
      },
    },
  };
  const logs: unknown[][] = [];
  const service = createEntitlementService({
    config: {
      siteOrigin: "https://www.solve-lang.com",
      stripePriceId: "price_test_workflow_preflight",
      stripeWebhookSecret: "whsec_test_only",
      entitlementSigningSecret: signingSecret,
      mode: "test",
    },
    stripe,
    store,
    now: () => nowMs,
    logger: { info: (...values) => logs.push(values), error: (...values) => logs.push(values) },
  });
  return { service, store, checkoutRequests, logs };
}

test("health exposes only a fixed non-sensitive test-mode readiness contract", async () => {
  const { service } = createFixture();
  const result = await service(apiEvent("GET", "/health"));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(responseBody(result), { status: "ok", service: "solvelang-entitlements", mode: "test" });
  assert.equal(result.headers?.["cache-control"], "no-store");
});

test("checkout creation returns an embedded client secret with minimal metadata", async () => {
  const { service, checkoutRequests } = createFixture();
  const result = await service(apiEvent("POST", "/checkout", { scanId }));
  assert.equal(result.statusCode, 200);
  assert.deepEqual(responseBody(result), { clientSecret: "cs_test_paid_session_secret_example" });
  assert.equal(checkoutRequests.length, 1);
  assert.deepEqual(checkoutRequests[0], {
    idempotencyKey: `preflight-${scanId}`,
    params: {
      mode: "payment",
      lineItems: [{ price: "price_test_workflow_preflight", quantity: 1 }],
      returnUrl: `https://www.solve-lang.com/check/?scan_id=${scanId}&session_id={CHECKOUT_SESSION_ID}`,
      metadata: { scanId, product: "workflow-preflight-v1" },
    },
  });
});

test("valid signed webhook records one entitlement and replay or duplicate delivery remains idempotent", async () => {
  const { service, store } = createFixture();
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
  assert.deepEqual(store.records.get(scanId), {
    scanId,
    sessionId,
    paymentStatus: "paid",
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
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: "paid",
        metadata: { scanId, product: "workflow-preflight-v1" },
      },
    },
  });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: webhookSecret, timestamp: 1_753_056_000 });
  const gateway = createStripeGateway(new Stripe("sk_test_local_only"), { receivedAt: () => 1_753_056_000 });

  const event = gateway.webhooks.constructEvent(Buffer.from(payload), signature, webhookSecret);
  assert.deepEqual(event, {
    id: "evt_local_signed",
    type: "checkout.session.completed",
    session: { id: sessionId, paymentStatus: "paid", metadata: { scanId, product: "workflow-preflight-v1" } },
  });
});

test("invalid webhook signatures are rejected without processing", async () => {
  const { service, store } = createFixture();
  const result = await service(apiEvent("POST", "/webhook", { private: "raw payload" }, { "stripe-signature": "invalid" }));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(responseBody(result), { error: "Invalid webhook." });
  assert.equal(store.writes, 0);
});

test("paid checkout recovery issues a verifiable short-lived entitlement", async () => {
  const { service } = createFixture();
  await service(apiEvent("POST", "/webhook", { opaque: "stripe fixture" }, { "stripe-signature": "valid-test-signature" }));
  const result = await service(apiEvent("POST", "/entitlement", { scanId, sessionId }));
  assert.equal(result.statusCode, 200);
  const body = responseBody(result);
  assert.equal(body.expiresAt, "2026-07-20T00:15:00.000Z");
  assert.deepEqual(verifyEntitlement(String(body.token), signingSecret, Math.floor(nowMs / 1000)), {
    version: 1,
    scanId,
    sessionId,
    exp: Math.floor(nowMs / 1000) + 15 * 60,
  });
});

test("unpaid or mismatched checkout cannot receive an entitlement", async () => {
  const fixture = createFixture();
  fixture.store.records.set(scanId, {
    scanId,
    sessionId,
    paymentStatus: "unpaid",
    stripeEventId: "evt_unpaid",
    createdAt: "2026-07-20T00:00:00.000Z",
    expiresAt: Math.floor(nowMs / 1000) + 60,
  });
  const result = await fixture.service(apiEvent("POST", "/entitlement", { scanId, sessionId }));
  assert.equal(result.statusCode, 403);
  assert.deepEqual(responseBody(result), { error: "No matching paid checkout was found." });
});

test("expired, invalid, and tampered entitlement tokens are rejected", () => {
  const claims = { version: 1 as const, scanId, sessionId, exp: 1000 };
  const token = issueEntitlement(claims, signingSecret);
  assert.throws(() => verifyEntitlement(token, signingSecret, 1000), /expired/);
  assert.throws(() => verifyEntitlement(token, "different-secret-at-least-32-bytes"), /signature/);
  assert.throws(() => verifyEntitlement(`${token}x`, signingSecret), /signature/);
});
