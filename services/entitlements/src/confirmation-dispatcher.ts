import type { DynamoDBStreamHandler } from "aws-lambda";
import { SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import {
  createSqsConfirmationGateway,
  createTestConfirmationSink,
  type DurableConfirmationGateway,
} from "./confirmation.js";
import type { ConfirmationOutboxRecord } from "./service.js";

type DocumentClient = {
  send(command: GetCommand | UpdateCommand): Promise<{ Item?: Record<string, unknown> }>;
};

type Dispatcher = (keys: readonly string[]) => Promise<void>;
type ConfirmationProvider = "disabled" | "test-sink" | "aws-ses-sqs";

export function createConfirmationOutboxDispatcher({
  provider,
  tableName,
  queueUrl,
  client,
  queue,
  testSink = createTestConfirmationSink(),
}: {
  provider: ConfirmationProvider;
  tableName: string;
  queueUrl?: string;
  client: DocumentClient;
  queue?: DurableConfirmationGateway;
  testSink?: DurableConfirmationGateway;
}): Dispatcher {
  let sqsQueue: DurableConfirmationGateway | undefined;
  if (provider === "aws-ses-sqs") {
    if (!queue && !queueUrl) throw new Error("DURABLE_CONFIRMATION_QUEUE_URL is required for aws-ses-sqs.");
    sqsQueue = queue ?? createSqsConfirmationGateway({ queueUrl: queueUrl!, client: new SQSClient({}) });
  }

  return async (keys) => {
    for (const dispatchKey of keys) {
      const result = await client.send(new GetCommand({ TableName: tableName, Key: { dispatchKey }, ConsistentRead: true }));
      const outbox = result.Item as ConfirmationOutboxRecord | undefined;
      if (!outbox || outbox.state === "dispatched") continue;
      if (outbox.state !== "pending") throw new Error("Invalid confirmation outbox state.");
      if (provider === "disabled") {
        throw new Error("Durable confirmation provider is disabled; outbox remains pending.");
      }
      if (provider === "test-sink") {
        await testSink.queueContractConfirmation(outbox.payload);
      } else {
        await sqsQueue!.queueContractConfirmation(outbox.payload);
      }
      try {
        await client.send(new UpdateCommand({
          TableName: tableName,
          Key: { dispatchKey },
          ConditionExpression: "#state = :pending",
          UpdateExpression: "SET #state = :dispatched",
          ExpressionAttributeNames: { "#state": "state" },
          ExpressionAttributeValues: { ":pending": "pending", ":dispatched": "dispatched" },
        }));
      } catch (error) {
        // SQS FIFO deduplicates the retry window and the downstream delivery ledger
        // handles any later redelivery. Do not acknowledge an ambiguous handoff.
        throw error;
      }
    }
  };
}

const tableName = process.env.CONFIRMATION_DISPATCH_TABLE;
if (!tableName) throw new Error("CONFIRMATION_DISPATCH_TABLE is required for the confirmation dispatcher.");
const provider = process.env.DURABLE_CONFIRMATION_PROVIDER;
if (provider !== "disabled" && provider !== "test-sink" && provider !== "aws-ses-sqs") {
  throw new Error("DURABLE_CONFIRMATION_PROVIDER is required for the confirmation dispatcher.");
}
const queueUrl = process.env.DURABLE_CONFIRMATION_QUEUE_URL;
if (provider === "aws-ses-sqs" && !queueUrl) {
  throw new Error("DURABLE_CONFIRMATION_QUEUE_URL is required for aws-ses-sqs.");
}

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const dispatch = createConfirmationOutboxDispatcher({ provider, tableName, queueUrl, client });

export const handler: DynamoDBStreamHandler = async (event) => {
  const keys = event.Records
    .filter((record) => record.eventName === "INSERT" || record.eventName === "MODIFY")
    .map((record) => record.dynamodb?.Keys?.dispatchKey?.S)
    .filter((value): value is string => Boolean(value));
  await dispatch(keys);
};
