import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createPublicStatusCollector, refreshPublicStatus } from "./public-status.js";
import { createDynamoPublicStatusStore } from "./public-status-store.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store = createDynamoPublicStatusStore(client, process.env.PUBLIC_STATUS_TABLE);
const collect = createPublicStatusCollector({ siteOrigin: process.env.SITE_ORIGIN, apiHealthUrl: process.env.PUBLIC_API_HEALTH_URL, executionHealthUrl: process.env.PUBLIC_STATUS_EXECUTION_HEALTH_URL || undefined, runnerMinutesHealthUrl: process.env.PUBLIC_STATUS_RUNNER_MINUTES_HEALTH_URL || "https://runners.solve-lang.com/health" });
// The fallback is the canonical production health URL, the same value the
// template parameter declares as its Default: the production stack's stored
// parameter value predates that Default (blank at stack creation) and SAM
// retains stored parameter values on update, so the env arrives empty.
// An explicitly set env always wins.

export async function handler(event) {
  if (event?.source !== "aws.events" || event?.["detail-type"] !== "Scheduled Event") throw new Error("Public status collection requires the scheduled event.");
  return refreshPublicStatus({ store, collect });
}
