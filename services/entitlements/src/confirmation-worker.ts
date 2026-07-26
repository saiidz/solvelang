import type { SQSHandler } from "aws-lambda";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { z } from "zod";
import { CONTRACT_REFUND_POLICY_TEXT, CONTRACT_TERMS_TEXT, TERMS_VERSION } from "./terms.js";

const sender = process.env.DURABLE_CONFIRMATION_SENDER;
if (!sender) throw new Error("DURABLE_CONFIRMATION_SENDER is required for the confirmation worker.");

const confirmation = z.object({
  kind: z.enum(["contract", "withdrawal"]),
  payload: z.object({
    email: z.string().email(),
    paymentIntentId: z.string().startsWith("pi_").optional(),
    product: z.literal("Workflow Preflight").optional(),
    total: z.literal("USD $49").optional(),
    termsVersion: z.literal(TERMS_VERSION).optional(),
    termsAcceptedAt: z.string().datetime().optional(),
    immediatePerformanceRequested: z.literal(true).optional(),
    withdrawalAcknowledged: z.literal(true).optional(),
    deliveryDescription: z.string().optional(),
    supportEmail: z.literal("hello@solve-lang.com"),
    termsText: z.literal(CONTRACT_TERMS_TEXT).optional(),
    refundPolicyText: z.literal(CONTRACT_REFUND_POLICY_TEXT).optional(),
    idempotencyKey: z.string().min(1),
  }).passthrough(),
}).strict();

const ses = new SESv2Client({});

function contractBody(payload: z.infer<typeof confirmation>["payload"]): string {
  if (!payload.paymentIntentId || !payload.product || !payload.total || !payload.termsVersion || !payload.termsAcceptedAt || !payload.deliveryDescription || !payload.termsText || !payload.refundPolicyText) {
    throw new Error("Invalid contract confirmation message.");
  }
  return [
    "SolveLang contract confirmation",
    `Order: ${payload.product}`,
    `Total: ${payload.total}`,
    `Payment reference: ${payload.paymentIntentId}`,
    `Terms version: ${payload.termsVersion}`,
    `Accepted at: ${payload.termsAcceptedAt}`,
    `Immediate performance requested: ${payload.immediatePerformanceRequested === true ? "yes" : "no"}`,
    `Withdrawal acknowledgement: ${payload.withdrawalAcknowledged === true ? "yes" : "no"}`,
    `Delivery: ${payload.deliveryDescription}`,
    `Support: ${payload.supportEmail}`,
    "",
    payload.termsText,
    "",
    payload.refundPolicyText,
  ].join("\n");
}

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    const message = confirmation.parse(JSON.parse(record.body));
    const subject = message.kind === "contract" ? "SolveLang Workflow Preflight contract confirmation" : "SolveLang withdrawal request received";
    const body = message.kind === "contract"
      ? contractBody(message.payload)
      : `We received your withdrawal request. Eligibility will be reviewed under applicable law. Support: ${message.payload.supportEmail}`;
    await ses.send(new SendEmailCommand({
      FromEmailAddress: sender,
      Destination: { ToAddresses: [message.payload.email] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } },
    }));
  }
};
