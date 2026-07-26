import assert from "node:assert/strict";
import test from "node:test";
import { GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

process.env.DURABLE_CONFIRMATION_SENDER = "receipts@solve-lang.com";
process.env.DURABLE_CONFIRMATION_DELIVERY_TABLE = "delivery-table";

const { confirmationMessage, createConfirmationWorker } = await import("../src/confirmation-worker.js");

const contract = {
  kind: "contract" as const,
  payload: {
    email: "buyer@example.test",
    paymentIntentId: "pi_test_confirmation",
    product: "Workflow Preflight" as const,
    total: "USD $49" as const,
    termsVersion: "2026-07-26-v2" as const,
    termsAcceptedAt: "2026-07-26T00:00:00.000Z",
    immediatePerformanceRequested: true as const,
    withdrawalAcknowledged: true as const,
    deliveryDescription: "Immediate report delivery.",
    supportEmail: "hello@solve-lang.com" as const,
    termsText: "terms" as never,
    refundPolicyText: "refund policy" as never,
    idempotencyKey: "contract-confirmation-pi_test_confirmation-2026-07-26-v2",
  },
};

class MemoryDeliveries {
  readonly records = new Map<string, Record<string, unknown>>();
  failSentUpdate = false;

  async send(command: GetCommand | PutCommand | UpdateCommand): Promise<{ Item?: Record<string, unknown> }> {
    if (command instanceof GetCommand) return { Item: this.records.get(String(command.input.Key?.deliveryKey)) };
    if (command instanceof PutCommand) {
      const item = command.input.Item as Record<string, unknown>;
      const key = String(item.deliveryKey);
      if (this.records.has(key)) {
        const error = new Error("conditional"); error.name = "ConditionalCheckFailedException"; throw error;
      }
      this.records.set(key, { ...item });
      return {};
    }
    const key = String(command.input.Key?.deliveryKey);
    const existing = this.records.get(key);
    if (!existing) throw new Error("missing record");
    if (command.input.UpdateExpression?.includes("#state = :sent")) {
      if (this.failSentUpdate) throw new Error("ambiguous state update");
      this.records.set(key, { ...existing, state: "sent", sentAt: command.input.ExpressionAttributeValues?.[":sentAt"] });
    } else {
      this.records.set(key, {
        ...existing,
        leaseOwner: command.input.ExpressionAttributeValues?.[":leaseOwner"],
        leaseExpiresAt: command.input.ExpressionAttributeValues?.[":leaseExpiresAt"],
      });
    }
    return {};
  }
}

test("strict confirmation schemas reject missing consent fields and arbitrary payload fields", () => {
  assert.equal(confirmationMessage.safeParse({ kind: "contract", payload: { ...contract.payload, immediatePerformanceRequested: undefined } }).success, false);
  assert.equal(confirmationMessage.safeParse({ ...contract, payload: { ...contract.payload, arbitrary: "no" } }).success, false);
  assert.equal(confirmationMessage.safeParse({ kind: "withdrawal", payload: { email: "buyer@example.test", contractReference: "pi_test", supportEmail: "hello@solve-lang.com", idempotencyKey: "x" } }).success, false);
});

test("confirmation delivery leases recover safely and never acknowledge active or ambiguous records", async () => {
  const deliveries = new MemoryDeliveries();
  const sends: string[] = [];
  let clock = Date.parse("2026-07-26T00:00:00.000Z");
  const worker = createConfirmationWorker({
    sender: "receipts@solve-lang.com",
    deliveryTable: "delivery-table",
    deliveries,
    ses: { async send() { sends.push("sent"); return {}; } },
    now: () => clock,
    newLeaseOwner: () => `lease-${clock}`,
  });

  await worker(contract);
  assert.equal(sends.length, 1);
  await worker(contract);
  assert.equal(sends.length, 1, "sent duplicate is acknowledged without another email");

  const key = contract.payload.idempotencyKey;
  deliveries.records.set(key, { deliveryKey: key, state: "in_progress", leaseOwner: "other", leaseExpiresAt: clock + 60_000 });
  await assert.rejects(() => worker(contract), /leased/);
  assert.equal(sends.length, 1, "active lease retries through SQS rather than acknowledging");

  clock += 60_001;
  await worker(contract);
  assert.equal(sends.length, 2, "a stale lease is atomically reclaimed after worker restart");

  deliveries.records.delete(key);
  deliveries.failSentUpdate = true;
  await assert.rejects(() => worker(contract), /ambiguous state update/);
  assert.equal(deliveries.records.get(key)?.state, "in_progress");
  deliveries.failSentUpdate = false;
  clock += 60_001;
  await worker(contract);
  assert.equal(sends.length, 4, "an ambiguous SES success is retried after lease expiry to avoid a lost notice");
});

test("SES failures retain the lease for retry and malformed queue messages fail for SQS retry or DLQ", async () => {
  const deliveries = new MemoryDeliveries();
  const worker = createConfirmationWorker({
    sender: "receipts@solve-lang.com",
    deliveryTable: "delivery-table",
    deliveries,
    ses: { async send() { throw new Error("SES unavailable"); } },
    newLeaseOwner: () => "lease",
  });
  await assert.rejects(() => worker(contract), /SES unavailable/);
  assert.equal(deliveries.records.get(contract.payload.idempotencyKey)?.state, "in_progress");
  assert.equal(confirmationMessage.safeParse({ malformed: true }).success, false);
});
