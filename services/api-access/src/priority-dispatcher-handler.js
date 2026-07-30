import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { parsePriorityDispatcherEnvironment } from "./priority-config.js";
import { createPriorityDispatcher } from "./priority-dispatcher.js";
import { createDynamoPriorityJobStore } from "./priority-job-store.js";

const environment = parsePriorityDispatcherEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const sqs = new SQSClient({});
const application = createPriorityDispatcher({
  queueGateway: {
    async send({ queueUrl, messageBody, messageGroupId, messageDeduplicationId }) {
      const response = await sqs.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: messageBody,
        MessageGroupId: messageGroupId,
        MessageDeduplicationId: messageDeduplicationId,
      }));
      if (!response.MessageId) throw new Error("SQS did not return a message ID.");
      return { messageId: response.MessageId };
    },
  },
  jobStore: createDynamoPriorityJobStore(documentClient, { jobsTable: environment.priorityJobsTable }),
  queueUrls: environment.queueUrls,
});

export async function handler(event) {
  return application(event);
}
