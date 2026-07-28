import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createApiKeyAuthorizer } from "./authorizer.js";
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
const authorizeRequest = createApiKeyAuthorizer({
  service,
  enabled: environment.enabled,
  requiredScope: "repository:audit",
});

export async function handler(event) {
  return authorizeRequest(event);
}
