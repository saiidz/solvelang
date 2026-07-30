import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createPriorityAdminHandler } from "./priority-api.js";
import { parsePriorityAdminEnvironment } from "./priority-config.js";
import { createDynamoPriorityJobStore } from "./priority-job-store.js";
import { createPriorityJobService } from "./priority-jobs.js";

const environment = parsePriorityAdminEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const service = createPriorityJobService({
  store: createDynamoPriorityJobStore(documentClient, { jobsTable: environment.priorityJobsTable }),
  enabled: environment.priorityQueueEnabled,
});
const application = createPriorityAdminHandler({
  service,
  enabled: environment.priorityQueueEnabled,
  adminSecret: environment.adminSecret,
  siteOrigin: environment.siteOrigin,
});

export async function handler(event) {
  return application(event);
}
