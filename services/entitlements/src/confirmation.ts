import { CONTRACT_REFUND_POLICY_TEXT, CONTRACT_TERMS_TEXT, TERMS_VERSION } from "./terms.js";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";

export type ContractConfirmation = {
  email: string;
  paymentIntentId: string;
  product: "Workflow Preflight";
  total: "USD $49";
  termsVersion: typeof TERMS_VERSION;
  termsAcceptedAt: string;
  immediatePerformanceRequested: true;
  withdrawalAcknowledged: true;
  deliveryDescription: string;
  supportEmail: "hello@solve-lang.com";
  termsText: typeof CONTRACT_TERMS_TEXT;
  refundPolicyText: typeof CONTRACT_REFUND_POLICY_TEXT;
  idempotencyKey: string;
};

export type WithdrawalConfirmation = {
  email: string;
  contractReference: string;
  receivedAt: string;
  supportEmail: "hello@solve-lang.com";
  idempotencyKey: string;
};

export type DurableConfirmationGateway = {
  queueContractConfirmation(input: ContractConfirmation): Promise<void>;
  queueWithdrawalConfirmation(input: WithdrawalConfirmation): Promise<void>;
};

export type ConfirmationQueueClient = {
  send(command: SendMessageCommand): Promise<unknown>;
};

type QueuedConfirmation = {
  kind: "contract" | "withdrawal";
  payload: ContractConfirmation | WithdrawalConfirmation;
};

export type TestConfirmationSink = DurableConfirmationGateway & {
  readonly safeIdentifiers: readonly string[];
};

export function createTestConfirmationSink(): TestConfirmationSink {
  const identifiers = new Set<string>();
  return {
    get safeIdentifiers() { return [...identifiers]; },
    async queueContractConfirmation(input) { identifiers.add(input.idempotencyKey); },
    async queueWithdrawalConfirmation(input) { identifiers.add(input.idempotencyKey); },
  };
}

/**
 * The FIFO queue is the durable hand-off point. Customer delivery data stays in
 * the encrypted queue until the confirmation worker sends it; it is never
 * logged or stored in the entitlement table.
 */
export function createSqsConfirmationGateway({
  queueUrl,
  client = new SQSClient({}),
}: {
  queueUrl: string;
  client?: ConfirmationQueueClient;
}): DurableConfirmationGateway {
  async function queue(kind: QueuedConfirmation["kind"], payload: ContractConfirmation | WithdrawalConfirmation) {
    await client.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ kind, payload } satisfies QueuedConfirmation),
      MessageGroupId: `${kind}-confirmation`,
      MessageDeduplicationId: payload.idempotencyKey,
    }));
  }

  return {
    queueContractConfirmation(input) { return queue("contract", input); },
    queueWithdrawalConfirmation(input) { return queue("withdrawal", input); },
  };
}

export function createUnavailableDurableConfirmationGateway(): DurableConfirmationGateway {
  return {
    async queueContractConfirmation() {
      throw new Error("durable confirmation provider is unavailable");
    },
    async queueWithdrawalConfirmation() {
      throw new Error("durable confirmation provider is unavailable");
    },
  };
}
