import assert from "node:assert/strict";
import test from "node:test";
import { createSqsConfirmationGateway, createTestConfirmationSink } from "../src/confirmation.js";

const contract = {
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
};

test("test confirmation sink records only the stable safe identifier", async () => {
  const sink = createTestConfirmationSink();
  await sink.queueContractConfirmation(contract);
  await sink.queueContractConfirmation(contract);
  assert.deepEqual(sink.safeIdentifiers, [contract.idempotencyKey]);
  assert.equal(JSON.stringify(sink.safeIdentifiers).includes(contract.email), false);
});

test("SQS confirmation adapter uses FIFO group and stable deduplication identifiers", async () => {
  let command: { input: Record<string, unknown> } | undefined;
  const gateway = createSqsConfirmationGateway({
    queueUrl: "https://sqs.us-east-1.amazonaws.com/123456789012/confirmations.fifo",
    client: { async send(value) { command = value as unknown as { input: Record<string, unknown> }; } },
  });
  await gateway.queueContractConfirmation(contract);
  assert.equal(command?.input.QueueUrl, "https://sqs.us-east-1.amazonaws.com/123456789012/confirmations.fifo");
  assert.equal(command?.input.MessageGroupId, "contract-confirmation");
  assert.equal(command?.input.MessageDeduplicationId, contract.idempotencyKey);
  assert.match(String(command?.input.MessageBody), /"kind":"contract"/);
});
