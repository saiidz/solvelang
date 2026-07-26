import { CONTRACT_REFUND_POLICY_TEXT, CONTRACT_TERMS_TEXT, TERMS_VERSION } from "./terms.js";

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
  name: string;
  contractReference: string;
  statement: string;
  receivedAt: string;
  supportEmail: "hello@solve-lang.com";
  idempotencyKey: string;
};

export type DurableConfirmationGateway = {
  queueContractConfirmation(input: ContractConfirmation): Promise<void>;
  queueWithdrawalConfirmation(input: WithdrawalConfirmation): Promise<void>;
};

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
