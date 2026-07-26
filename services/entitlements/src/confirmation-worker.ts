import type { SQSHandler } from "aws-lambda";
import { SendEmailCommand, SESv2Client } from "@aws-sdk/client-sesv2";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { z } from "zod";
import { CONTRACT_REFUND_POLICY_TEXT, CONTRACT_TERMS_TEXT, TERMS_VERSION } from "./terms.js";

const contractPayload = z.object({
  email: z.string().email(),
  paymentIntentId: z.string().startsWith("pi_"),
  product: z.literal("Workflow Preflight"),
  total: z.literal("USD $49"),
  termsVersion: z.literal(TERMS_VERSION),
  termsAcceptedAt: z.string().datetime(),
  immediatePerformanceRequested: z.literal(true),
  withdrawalAcknowledged: z.literal(true),
  deliveryDescription: z.string().min(1),
  supportEmail: z.literal("hello@solve-lang.com"),
  termsText: z.literal(CONTRACT_TERMS_TEXT),
  refundPolicyText: z.literal(CONTRACT_REFUND_POLICY_TEXT),
  idempotencyKey: z.string().min(1),
}).strict();

const withdrawalPayload = z.object({
  email: z.string().email(),
  contractReference: z.string().startsWith("pi_"),
  receivedAt: z.string().datetime(),
  supportEmail: z.literal("hello@solve-lang.com"),
  idempotencyKey: z.string().min(1),
}).strict();

export const confirmationMessage = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("contract"), payload: contractPayload }).strict(),
  z.object({ kind: z.literal("withdrawal"), payload: withdrawalPayload }).strict(),
]);

type ConfirmationMessage = z.infer<typeof confirmationMessage>;
type DocumentClient = { send(command: GetCommand | PutCommand | UpdateCommand): Promise<{ Item?: Record<string, unknown> }> };
type SesClient = { send(command: SendEmailCommand): Promise<unknown> };
type Clock = () => number;

const LEASE_MS = 60_000;
const DELIVERY_RETENTION_SECONDS = 60 * 60 * 24 * 30;

type Reservation = "reserved" | "sent" | "active";

function contractBody(payload: z.infer<typeof contractPayload>): string {
  return [
    "SolveLang contract confirmation",
    `Order: ${payload.product}`,
    `Total: ${payload.total}`,
    `Payment reference: ${payload.paymentIntentId}`,
    `Terms version: ${payload.termsVersion}`,
    `Accepted at: ${payload.termsAcceptedAt}`,
    "Immediate performance requested: yes",
    "Withdrawal acknowledgement: yes",
    `Delivery: ${payload.deliveryDescription}`,
    `Support: ${payload.supportEmail}`,
    "",
    payload.termsText,
    "",
    payload.refundPolicyText,
  ].join("\n");
}

function withdrawalBody(payload: z.infer<typeof withdrawalPayload>): string {
  return [
    "SolveLang withdrawal request received",
    `Received at: ${payload.receivedAt}`,
    `Payment or contract reference: ${payload.contractReference}`,
    `Support: ${payload.supportEmail}`,
    "Eligibility remains subject to review and applicable law. This acknowledgement is not an automatic refund decision or promise.",
  ].join("\n");
}

export function createConfirmationWorker({
  sender,
  deliveryTable,
  deliveries,
  ses,
  now = Date.now,
  newLeaseOwner = () => crypto.randomUUID(),
}: {
  sender: string;
  deliveryTable: string;
  deliveries: DocumentClient;
  ses: SesClient;
  now?: Clock;
  newLeaseOwner?: () => string;
}) {
  async function reserveDelivery(key: string, leaseOwner: string): Promise<Reservation> {
    const timestamp = now();
    const existing = await deliveries.send(new GetCommand({ TableName: deliveryTable, Key: { deliveryKey: key }, ConsistentRead: true }));
    if (existing.Item?.state === "sent") return "sent";
    if (existing.Item?.state === "in_progress") {
      if (typeof existing.Item.leaseExpiresAt !== "number" || existing.Item.leaseExpiresAt > timestamp) return "active";
      try {
        await deliveries.send(new UpdateCommand({
          TableName: deliveryTable,
          Key: { deliveryKey: key },
          ConditionExpression: "#state = :inProgress AND leaseExpiresAt <= :now",
          UpdateExpression: "SET leaseOwner = :leaseOwner, leaseExpiresAt = :leaseExpiresAt",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":inProgress": "in_progress", ":now": timestamp, ":leaseOwner": leaseOwner, ":leaseExpiresAt": timestamp + LEASE_MS },
        }));
        return "reserved";
      } catch (error) {
        if (error instanceof Error && error.name === "ConditionalCheckFailedException") return "active";
        throw error;
      }
    }
    try {
      await deliveries.send(new PutCommand({
        TableName: deliveryTable,
        Item: {
          deliveryKey: key,
          state: "in_progress",
          leaseOwner,
          leaseExpiresAt: timestamp + LEASE_MS,
          createdAt: new Date(timestamp).toISOString(),
          expiresAt: Math.floor(timestamp / 1000) + DELIVERY_RETENTION_SECONDS,
        },
        ConditionExpression: "attribute_not_exists(deliveryKey)",
      }));
      return "reserved";
    } catch (error) {
      if (error instanceof Error && error.name === "ConditionalCheckFailedException") return "active";
      throw error;
    }
  }

  return async (message: ConfirmationMessage): Promise<void> => {
    const leaseOwner = newLeaseOwner();
    const reservation = await reserveDelivery(message.payload.idempotencyKey, leaseOwner);
    if (reservation === "sent") return;
    if (reservation === "active") throw new Error("Confirmation delivery is leased by another worker.");

    const subject = message.kind === "contract" ? "SolveLang Workflow Preflight contract confirmation" : "SolveLang withdrawal request received";
    const body = message.kind === "contract" ? contractBody(message.payload) : withdrawalBody(message.payload);
    await ses.send(new SendEmailCommand({
      FromEmailAddress: sender,
      Destination: { ToAddresses: [message.payload.email] },
      Content: { Simple: { Subject: { Data: subject }, Body: { Text: { Data: body } } } },
    }));
    // If this update is ambiguous after SES accepts, retain the lease. A later
    // lease recovery favors delivering the legally required notice over silence.
    await deliveries.send(new UpdateCommand({
      TableName: deliveryTable,
      Key: { deliveryKey: message.payload.idempotencyKey },
      ConditionExpression: "#state = :inProgress AND leaseOwner = :leaseOwner",
      UpdateExpression: "SET #state = :sent, sentAt = :sentAt REMOVE leaseOwner, leaseExpiresAt",
      ExpressionAttributeNames: { "#state": "state" },
      ExpressionAttributeValues: { ":inProgress": "in_progress", ":sent": "sent", ":sentAt": new Date(now()).toISOString(), ":leaseOwner": leaseOwner },
    }));
  };
}

const sender = process.env.DURABLE_CONFIRMATION_SENDER;
if (!sender) throw new Error("DURABLE_CONFIRMATION_SENDER is required for the confirmation worker.");
const deliveryTable = process.env.DURABLE_CONFIRMATION_DELIVERY_TABLE;
if (!deliveryTable) throw new Error("DURABLE_CONFIRMATION_DELIVERY_TABLE is required for the confirmation worker.");
const worker = createConfirmationWorker({
  sender,
  deliveryTable,
  deliveries: DynamoDBDocumentClient.from(new DynamoDBClient({})),
  ses: new SESv2Client({}),
});

export const handler: SQSHandler = async (event) => {
  for (const record of event.Records) {
    await worker(confirmationMessage.parse(JSON.parse(record.body)));
  }
};
