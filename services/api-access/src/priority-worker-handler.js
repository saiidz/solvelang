import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoAccountAccessReader } from "./account-access-reader.js";
import { createAccountAccessService } from "./account-access.js";
import { parsePriorityWorkerEnvironment } from "./priority-config.js";
import { createDynamoPriorityJobStore } from "./priority-job-store.js";
import { createHttpsPriorityProviderExecutor } from "./priority-provider-executor.js";
import { createS3PrioritySourceStore } from "./priority-source-store.js";
import { createPriorityWorker } from "./priority-worker.js";

const environment = parsePriorityWorkerEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const accountAccess = environment.customerAuthTable
  ? createAccountAccessService({
      store: createDynamoAccountAccessReader(documentClient, { tableName: environment.customerAuthTable }),
    })
  : undefined;
const executeCustomerJob = environment.providerExecutionEnabled
  ? createHttpsPriorityProviderExecutor({
      sourceStore: createS3PrioritySourceStore(new S3Client({}), { bucket: environment.sourceBucket }),
      providerUrl: environment.providerUrl,
      providerSecret: environment.providerSecret,
    })
  : undefined;
const application = createPriorityWorker({
  laneName: environment.laneName,
  workerId: environment.workerId,
  accountAccess,
  executeCustomerJob,
  jobStore: createDynamoPriorityJobStore(documentClient, { jobsTable: environment.priorityJobsTable }),
});

export async function handler(event, context) {
  return application(event, context);
}
