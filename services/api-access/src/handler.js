import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createApiAccessHandler } from "./api-handler.js";
import { parseApiAccessEnvironment } from "./config.js";
import { createDynamoApiAccessStore } from "./dynamo-store.js";
import { createApiAccessService } from "./service.js";

const environment = parseApiAccessEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store = createDynamoApiAccessStore(documentClient, environment);
const service = createApiAccessService({
  store,
  pepper: environment.pepper,
  mode: environment.mode,
});
const application = createApiAccessHandler({
  service,
  enabled: environment.enabled,
  adminSecret: environment.adminSecret,
  siteOrigin: environment.siteOrigin,
});

export async function handler(event) {
  return application(event);
}
