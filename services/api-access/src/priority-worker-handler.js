import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { parsePriorityWorkerEnvironment } from "./priority-config.js";
import { createDynamoPriorityJobStore } from "./priority-job-store.js";
import { createPriorityWorker } from "./priority-worker.js";

const environment = parsePriorityWorkerEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const application = createPriorityWorker({
  laneName: environment.laneName,
  workerId: environment.workerId,
  jobStore: createDynamoPriorityJobStore(documentClient, { jobsTable: environment.priorityJobsTable }),
});

export async function handler(event) {
  return application(event);
}
