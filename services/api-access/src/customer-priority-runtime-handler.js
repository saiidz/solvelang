import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { S3Client } from "@aws-sdk/client-s3";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoAccountAccessReader } from "./account-access-reader.js";
import { createAccountAccessService } from "./account-access.js";
import { createCustomerPriorityHandler } from "./customer-priority-handler.js";
import { createCustomerPriorityService } from "./customer-priority.js";
import { createPriorityCustomerSessionAuth } from "./customer-priority-session-auth.js";
import { createPriorityUsageService } from "./customer-priority-usage.js";
import { createDynamoApiAccessStore } from "./dynamo-store.js";
import { createDynamoPriorityJobStore } from "./priority-job-store.js";
import { createS3PrioritySourceStore } from "./priority-source-store.js";

function required(environment, name, minimum = 1) {
  const value = environment[name];
  if (typeof value !== "string" || value.length < minimum) throw new Error(`${name} is required.`);
  return value;
}

function boolean(environment, name) {
  const value = environment[name] ?? "false";
  if (value !== "true" && value !== "false") throw new Error(`${name} must be true or false.`);
  return value === "true";
}

export function parseCustomerPriorityRuntimeEnvironment(environment = process.env) {
  const priorityApiEnabled = boolean(environment, "PRIORITY_API_ENABLED");
  const queueEnabled = boolean(environment, "PRIORITY_QUEUE_ENABLED");
  const customerPriorityEnabled = boolean(environment, "CUSTOMER_PRIORITY_ENABLED");
  const providerExecutionEnabled = boolean(environment, "PRIORITY_PROVIDER_EXECUTION_ENABLED");
  if (customerPriorityEnabled && (!priorityApiEnabled || !queueEnabled)) {
    throw new Error("Customer priority requires the priority API and queue to be enabled.");
  }
  if (providerExecutionEnabled && !customerPriorityEnabled) {
    throw new Error("Priority provider execution requires customer priority to be enabled.");
  }
  return {
    priorityApiEnabled,
    queueEnabled,
    customerPriorityEnabled,
    providerExecutionEnabled,
    siteOrigin: required(environment, "SITE_ORIGIN"),
    customerAuthPepper: customerPriorityEnabled ? required(environment, "CUSTOMER_AUTH_PEPPER", 32) : undefined,
    accountsTable: customerPriorityEnabled ? required(environment, "API_ACCOUNTS_TABLE") : undefined,
    customerAuthTable: customerPriorityEnabled ? required(environment, "API_CUSTOMER_AUTH_TABLE") : undefined,
    usageTable: customerPriorityEnabled ? required(environment, "API_USAGE_TABLE") : undefined,
    usageIdempotencyTable: customerPriorityEnabled ? required(environment, "API_USAGE_IDEMPOTENCY_TABLE") : undefined,
    priorityJobsTable: customerPriorityEnabled ? required(environment, "PRIORITY_JOBS_TABLE") : undefined,
    prioritySourceBucket: customerPriorityEnabled ? required(environment, "PRIORITY_SOURCE_BUCKET") : undefined,
  };
}

function disabled(siteOrigin) {
  return async function disabledHandler(event) {
    const method = event?.requestContext?.http?.method ?? "GET";
    return {
      statusCode: method === "OPTIONS" ? 204 : 503,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "access-control-allow-origin": siteOrigin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET,POST,OPTIONS",
        "access-control-allow-headers": "content-type,x-solvelang-csrf",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        vary: "Origin",
      },
      body: JSON.stringify(method === "OPTIONS" ? {} : {
        error: "Customer priority processing is not enabled.",
        code: "customer_priority_disabled",
      }),
    };
  };
}

export function createCustomerPriorityRuntime({ environment = process.env, documentClient, s3Client } = {}) {
  const config = parseCustomerPriorityRuntimeEnvironment(environment);
  if (!config.priorityApiEnabled || !config.customerPriorityEnabled) return disabled(config.siteOrigin);

  const dynamo = documentClient ?? DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const s3 = s3Client ?? new S3Client({});
  const accountAccess = createAccountAccessService({
    store: createDynamoAccountAccessReader(dynamo, { tableName: config.customerAuthTable }),
  });
  const customerAuth = createPriorityCustomerSessionAuth({
    documentClient: dynamo,
    tableName: config.customerAuthTable,
    pepper: config.customerAuthPepper,
    accountAccess,
  });
  const usageStore = createDynamoApiAccessStore(dynamo, {
    accountsTable: config.accountsTable,
    keysTable: "unused-by-priority-runtime",
    keysAccountIndex: "AccountIdIndex",
    usageTable: config.usageTable,
    idempotencyTable: config.usageIdempotencyTable,
  });
  const sourceStore = createS3PrioritySourceStore(s3, { bucketName: config.prioritySourceBucket });
  const priority = createCustomerPriorityService({
    accountAccess,
    apiAccessService: createPriorityUsageService({ store: usageStore }),
    jobStore: createDynamoPriorityJobStore(dynamo, { jobsTable: config.priorityJobsTable }),
    sourceStore,
    queueEnabled: config.queueEnabled,
    customerPriorityEnabled: config.customerPriorityEnabled,
    providerExecutionEnabled: config.providerExecutionEnabled,
  });
  return createCustomerPriorityHandler({
    customerAuth,
    priority,
    sourceStore,
    siteOrigin: config.siteOrigin,
    enabled: config.customerPriorityEnabled,
  });
}

let application;

export async function handler(event) {
  application ??= createCustomerPriorityRuntime();
  return application(event);
}
