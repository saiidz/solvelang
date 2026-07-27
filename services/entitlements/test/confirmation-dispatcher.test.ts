import assert from "node:assert/strict";
import test from "node:test";
import { GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { createTestConfirmationSink } from "../src/confirmation.js";

process.env.CONFIRMATION_DISPATCH_TABLE = "outbox-table";
process.env.DURABLE_CONFIRMATION_PROVIDER = "aws-ses-sqs";
process.env.DURABLE_CONFIRMATION_QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/123456789012/confirmations.fifo";

const { createConfirmationOutboxDispatcher } = await import("../src/confirmation-dispatcher.js");

test("outbox dispatch retries queue or update ambiguity without losing the committed confirmation", async () => {
  const dispatchKey = "contract:pi_test_outbox:2026-07-26-v2";
  const record: Record<string, unknown> = {
    dispatchKey,
    state: "pending",
    payload: {
      email: "buyer@example.test",
      paymentIntentId: "pi_test_outbox",
      product: "Workflow Preflight",
      total: "USD $49",
      termsVersion: "2026-07-26-v2",
      termsAcceptedAt: "2026-07-26T00:00:00.000Z",
      immediatePerformanceRequested: true,
      withdrawalAcknowledged: true,
      deliveryDescription: "Immediate report delivery.",
      supportEmail: "hello@solve-lang.com",
      termsText: "terms",
      refundPolicyText: "refund policy",
      idempotencyKey: "contract-confirmation-pi_test_outbox-2026-07-26-v2",
    },
  };
  let queued = 0;
  let failUpdate = true;
  const dispatch = createConfirmationOutboxDispatcher({
    provider: "aws-ses-sqs",
    tableName: "outbox-table",
    queueUrl: process.env.DURABLE_CONFIRMATION_QUEUE_URL!,
    client: {
      async send(command) {
        if (command instanceof GetCommand) return { Item: record };
        if (command instanceof UpdateCommand) {
          if (failUpdate) throw new Error("response lost after SQS accepted");
          record.state = "dispatched";
        }
        return {};
      },
    },
    queue: { async queueContractConfirmation() { queued += 1; }, async queueWithdrawalConfirmation() { assert.fail("not a withdrawal"); } },
  });

  await assert.rejects(() => dispatch([dispatchKey]), /response lost/);
  assert.equal(record.state, "pending");
  failUpdate = false;
  await dispatch([dispatchKey]);
  assert.equal(record.state, "dispatched");
  assert.equal(queued, 2, "the durable outbox replays an ambiguous SQS handoff");
});

test("test-sink dispatches without SQS, SES, or a configured sender and stores only a safe identifier", async () => {
  const dispatchKey = "contract:pi_test_sink:2026-07-26-v2";
  const record: Record<string, unknown> = {
    dispatchKey,
    state: "pending",
    payload: {
      email: "buyer@example.test",
      paymentIntentId: "pi_test_sink",
      idempotencyKey: "contract-confirmation-pi_test_sink-2026-07-26-v2",
    },
  };
  let sqsCalls = 0;
  let sesCalls = 0;
  const sink = createTestConfirmationSink();
  const dispatch = createConfirmationOutboxDispatcher({
    provider: "test-sink",
    tableName: "outbox-table",
    client: {
      async send(command) {
        if (command instanceof GetCommand) return { Item: record };
        if (command instanceof UpdateCommand) record.state = "dispatched";
        return {};
      },
    },
    queue: {
      async queueContractConfirmation() { sqsCalls += 1; sesCalls += 1; },
      async queueWithdrawalConfirmation() { sqsCalls += 1; sesCalls += 1; },
    },
    testSink: sink,
  });

  delete process.env.DURABLE_CONFIRMATION_SENDER;
  await dispatch([dispatchKey]);

  assert.equal(sqsCalls, 0);
  assert.equal(sesCalls, 0);
  assert.equal(record.state, "dispatched");
  assert.deepEqual(sink.safeIdentifiers, ["contract-confirmation-pi_test_sink-2026-07-26-v2"]);
  assert.equal(JSON.stringify(sink.safeIdentifiers).includes("buyer@example.test"), false);
});

test("disabled provider fails closed and leaves the outbox pending without calling SQS", async () => {
  const record: Record<string, unknown> = {
    dispatchKey: "contract:pi_disabled:2026-07-26-v2",
    state: "pending",
    payload: { idempotencyKey: "contract-confirmation-pi_disabled-2026-07-26-v2" },
  };
  let sqsCalls = 0;
  const dispatch = createConfirmationOutboxDispatcher({
    provider: "disabled",
    tableName: "outbox-table",
    client: {
      async send(command) {
        if (command instanceof GetCommand) return { Item: record };
        if (command instanceof UpdateCommand) assert.fail("disabled must not mark the outbox dispatched");
        return {};
      },
    },
    queue: {
      async queueContractConfirmation() { sqsCalls += 1; },
      async queueWithdrawalConfirmation() { sqsCalls += 1; },
    },
  });

  await assert.rejects(() => dispatch([record.dispatchKey as string]), /disabled/);
  assert.equal(sqsCalls, 0);
  assert.equal(record.state, "pending");
});
