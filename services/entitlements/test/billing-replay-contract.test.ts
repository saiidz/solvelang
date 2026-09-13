import assert from "node:assert/strict";
import test from "node:test";
import type { APIGatewayProxyEventV2 } from "aws-lambda";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  createEntitlementService,
  type ConfirmationOutboxRecord,
  type EntitlementRecord,
  type EntitlementStore,
  type StripeGateway,
} from "../src/service.js";
import type { ContractConfirmation } from "../src/confirmation.js";
import { TERMS_VERSION } from "../src/terms.js";

process.env.CONFIRMATION_DISPATCH_TABLE = "outbox-table";
process.env.DURABLE_CONFIRMATION_PROVIDER = "aws-ses-sqs";
process.env.DURABLE_CONFIRMATION_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/confirmations.fifo";
process.env.DURABLE_CONFIRMATION_SENDER = "receipts@solve-lang.com";
process.env.DURABLE_CONFIRMATION_DELIVERY_TABLE = "delivery-table";

const { createConfirmationOutboxDispatcher } = await import("../src/confirmation-dispatcher.js");
const { createConfirmationWorker } = await import("../src/confirmation-worker.js");

const NOW = Date.parse("2026-09-12T20:00:00.000Z");
const scanId = "a1cf437b-1b4d-4f6f-a2f2-4999ab4033d4";
const paymentIntentId = "pi_replay_contract_001";
const dispatchKey = `contract:${paymentIntentId}:${TERMS_VERSION}`;

function apiEvent(signature: string): APIGatewayProxyEventV2 {
  return {
    version: "2.0",
    routeKey: "POST /webhook",
    rawPath: "/webhook",
    rawQueryString: "",
    headers: { "stripe-signature": signature },
    requestContext: {
      accountId: "test",
      apiId: "test",
      domainName: "test.invalid",
      domainPrefix: "test",
      http: { method: "POST", path: "/webhook", protocol: "HTTP/1.1", sourceIp: "127.0.0.1", userAgent: "node-test" },
      requestId: "request-test",
      routeKey: "POST /webhook",
      stage: "$default",
      time: "12/Sep/2026:20:00:00 +0000",
      timeEpoch: NOW,
    },
    isBase64Encoded: false,
    body: JSON.stringify({ opaque: "stripe-fixture" }),
  };
}

class ReplayStore implements EntitlementStore {
  readonly records = new Map<string, EntitlementRecord>();
  readonly dispatches = new Map<string, ConfirmationOutboxRecord>();
  commits = 0;

  async putIfAbsent(record: EntitlementRecord): Promise<"created" | "duplicate"> {
    if (this.records.has(record.scanId)) return "duplicate";
    this.records.set(record.scanId, record);
    return "created";
  }

  async updateRefundStatus(): Promise<"updated" | "duplicate_or_missing"> {
    return "duplicate_or_missing";
  }

  async get(id: string): Promise<EntitlementRecord | undefined> {
    return this.records.get(id);
  }

  async commitPaidEntitlementAndOutbox(
    record: EntitlementRecord,
    outbox: ConfirmationOutboxRecord,
  ): Promise<"created" | "existing"> {
    if (this.dispatches.has(outbox.dispatchKey)) return "existing";
    this.records.set(record.scanId, record);
    this.dispatches.set(outbox.dispatchKey, outbox);
    this.commits += 1;
    return "created";
  }

  async getConfirmationOutbox(key: string): Promise<ConfirmationOutboxRecord | undefined> {
    return this.dispatches.get(key);
  }

  async markConfirmationOutboxDispatched(key: string): Promise<void> {
    const current = this.dispatches.get(key);
    if (current) this.dispatches.set(key, { ...current, state: "dispatched" });
  }

  async consumeWithdrawalRateLimit(): Promise<boolean> {
    return true;
  }
}

class DeliveryLedger {
  readonly records = new Map<string, Record<string, unknown>>();

  async send(command: GetCommand | PutCommand | UpdateCommand): Promise<{ Item?: Record<string, unknown> }> {
    if (command instanceof GetCommand) {
      return { Item: this.records.get(String(command.input.Key?.deliveryKey)) };
    }
    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      const key = String(item.deliveryKey);
      if (this.records.has(key)) {
        const error = new Error("conditional");
        error.name = "ConditionalCheckFailedException";
        throw error;
      }
      this.records.set(key, { ...item });
      return {};
    }
    const key = String(command.input.Key?.deliveryKey);
    const existing = this.records.get(key);
    if (!existing) throw new Error("missing delivery ledger record");
    if (command.input.UpdateExpression?.includes("#state = :sent")) {
      this.records.set(key, {
        ...existing,
        state: "sent",
        sentAt: command.input.ExpressionAttributeValues?.[":sentAt"],
      });
      return {};
    }
    this.records.set(key, {
      ...existing,
      leaseOwner: command.input.ExpressionAttributeValues?.[":leaseOwner"],
      leaseExpiresAt: command.input.ExpressionAttributeValues?.[":leaseExpiresAt"],
    });
    return {};
  }
}

test("signed webhook replay plus ambiguous outbox handoff still yields one normal-path customer delivery", async () => {
  const store = new ReplayStore();
  const stripe: StripeGateway = {
    payments: {
      async create() { throw new Error("checkout is outside this replay proof"); },
      async updateMetadata() { throw new Error("checkout is outside this replay proof"); },
      async retrieve() { throw new Error("refund retrieval is outside this replay proof"); },
    },
    webhooks: {
      constructEvent(_rawBody, signature) {
        assert.match(signature, /^valid-/);
        return {
          id: signature === "valid-second-event" ? "evt_replay_second" : "evt_replay_first",
          type: "payment_intent.succeeded",
          paymentIntent: {
            id: paymentIntentId,
            receiptEmail: "buyer@example.test",
            paymentStatus: "paid",
            refundStatus: "none",
            metadata: {
              scanId,
              product: "workflow-preflight-v1",
              termsVersion: TERMS_VERSION,
              termsAcceptedAt: "2026-09-12T19:59:59.000Z",
              immediatePerformanceRequested: "true",
              withdrawalAcknowledged: "true",
            },
          },
        };
      },
    },
  };
  const service = createEntitlementService({
    config: {
      siteOrigin: "https://www.solve-lang.com",
      stripeWebhookSecret: "whsec_fixture",
      entitlementSigningSecret: "fixture-signing-secret-at-least-32-bytes",
      mode: "test",
      checkoutEnabled: false,
      durableConfirmationEnabled: true,
    },
    stripe,
    store,
    turnstile: { async verify() { throw new Error("not used"); } },
    durableConfirmation: {
      async queueContractConfirmation() { assert.fail("webhook must not deliver customer email directly"); },
      async queueWithdrawalConfirmation() { assert.fail("not a withdrawal"); },
    },
    now: () => NOW,
    logger: { info() {}, error() {} },
  });

  for (const signature of ["valid-first-event", "valid-first-event", "valid-second-event"]) {
    const response = await service(apiEvent(signature));
    assert.equal(response.statusCode, 200);
  }
  assert.equal(store.commits, 1, "webhook replay and duplicate event IDs must converge on one atomic outbox commit");
  assert.equal(store.dispatches.size, 1);
  assert.equal(store.dispatches.get(dispatchKey)?.state, "pending");

  const queued: ContractConfirmation[] = [];
  let failFirstDispatchStateUpdate = true;
  const dispatch = createConfirmationOutboxDispatcher({
    provider: "aws-ses-sqs",
    tableName: "outbox-table",
    queueUrl: process.env.DURABLE_CONFIRMATION_QUEUE_URL!,
    client: {
      async send(command) {
        if (command instanceof GetCommand) return { Item: store.dispatches.get(dispatchKey) as unknown as Record<string, unknown> };
        if (command instanceof UpdateCommand) {
          if (failFirstDispatchStateUpdate) {
            failFirstDispatchStateUpdate = false;
            throw new Error("ambiguous state update after durable queue acceptance");
          }
          const current = store.dispatches.get(dispatchKey);
          if (current) store.dispatches.set(dispatchKey, { ...current, state: "dispatched" });
        }
        return {};
      },
    },
    queue: {
      async queueContractConfirmation(payload) { queued.push(payload); },
      async queueWithdrawalConfirmation() { assert.fail("not a withdrawal"); },
    },
  });

  await assert.rejects(() => dispatch([dispatchKey]), /ambiguous state update/);
  assert.equal(store.dispatches.get(dispatchKey)?.state, "pending", "ambiguous queue acknowledgement must remain replayable");
  await dispatch([dispatchKey]);
  assert.equal(store.dispatches.get(dispatchKey)?.state, "dispatched");
  assert.equal(queued.length, 2, "the outbox intentionally retries an ambiguous durable-queue handoff");
  assert.equal(queued[0].idempotencyKey, queued[1].idempotencyKey);

  const ledger = new DeliveryLedger();
  const sent: string[] = [];
  const worker = createConfirmationWorker({
    sender: "receipts@solve-lang.com",
    deliveryTable: "delivery-table",
    deliveries: ledger,
    ses: { async send() { sent.push("sent"); return {}; } },
    now: () => NOW,
    newLeaseOwner: () => "lease-owner",
  });

  await worker({ kind: "contract", payload: queued[0] });
  await worker({ kind: "contract", payload: queued[1] });

  assert.equal(sent.length, 1, "duplicate queue deliveries with a recorded successful send must not send a second customer notice");
  assert.equal(ledger.records.get(queued[0].idempotencyKey)?.state, "sent");
});
