import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { createDynamoAccountAccessReader } from "./account-access-reader.js";
import { createAccountAccessService } from "./account-access.js";
import { createApiKeyAuthorizer } from "./authorizer.js";
import { parseApiKeyAuthorizerEnvironment } from "./config.js";
import { createDynamoApiKeyAuthorizerStore } from "./dynamo-store.js";
import { createApiAccessService } from "./service.js";

const environment = parseApiKeyAuthorizerEnvironment(process.env);
const documentClient = DynamoDBDocumentClient.from(new DynamoDBClient({}));
const store = createDynamoApiKeyAuthorizerStore(documentClient, environment);
const service = createApiAccessService({
  store,
  pepper: environment.pepper,
  mode: environment.mode,
});
const accountAccess = environment.customerAccountsEnabled
  ? createAccountAccessService({
      store: createDynamoAccountAccessReader(documentClient, { tableName: environment.customerAuthTable }),
    })
  : undefined;
const authorizeRequest = createApiKeyAuthorizer({
  service,
  accountAccess,
  enabled: environment.enabled,
  requiredScope: "repository:audit",
});

export async function handler(event) {
  return authorizeRequest(event);
}
