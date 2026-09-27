import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createPublicStatusCollector, refreshPublicStatus } from "./public-status.js";
import { createDynamoPublicStatusStore } from "./public-status-store.js";

const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store = createDynamoPublicStatusStore(client, process.env.PUBLIC_STATUS_TABLE);
const collect = createPublicStatusCollector({ siteOrigin: process.env.SITE_ORIGIN, apiHealthUrl: process.env.PUBLIC_API_HEALTH_URL });

export async function handler(event) {
  if (event?.source !== "aws.events" || event?.["detail-type"] !== "Scheduled Event") throw new Error("Public status collection requires the scheduled event.");
  return refreshPublicStatus({ store, collect });
}
