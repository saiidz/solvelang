import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApiKeyAuthorizer } from "../src/authorizer.js";

const templateUrl = new URL("../template.yaml", import.meta.url);

async function template() {
  return await readFile(templateUrl, "utf8");
}

test("API Gateway can invoke the API key authorizer through a scoped Lambda permission", async () => {
  const source = await template();
  assert.match(source, /ApiKeyAuthorizerInvokePermission:\s*\n\s*Type: AWS::Lambda::Permission/);
  assert.match(source, /FunctionName: !Ref ApiKeyAuthorizerFunction/);
  assert.match(source, /Principal: apigateway\.amazonaws\.com/);
  assert.match(source, /SourceArn: !Sub arn:\$\{AWS::Partition\}:execute-api:\$\{AWS::Region\}:\$\{AWS::AccountId\}:\$\{ApiAccessHttpApi\}\/authorizers\/\*/);
});

test("authorizer transaction permission is restricted to the two usage tables", async () => {
  const source = await template();
  const authorizer = source.slice(source.indexOf("  ApiKeyAuthorizerFunction:"), source.indexOf("\n  ApiKeyAuthorizerInvokePermission:"));
  assert.match(authorizer, /Action:\s*\n\s*- dynamodb:TransactWriteItems/);
  assert.match(authorizer, /Resource:\s*\n\s*- !GetAtt ApiUsageTable\.Arn\s*\n\s*- !GetAtt ApiUsageIdempotencyTable\.Arn/);
  assert.doesNotMatch(authorizer, /dynamodb:TransactWriteItems[\s\S]*Resource: ['\"]?\*['\"]?/);
});

test("a valid authorizer request consumes exactly one credit", async () => {
  const calls = [];
  const authorizer = createApiKeyAuthorizer({
    enabled: true,
    service: {
      authorize: async () => ({
        accountId: "acct_1",
        keyId: "key_1",
        plan: "developer",
        scopes: ["repository:audit"],
        subscriptionStatus: "active",
      }),
      consumeUsage: async (input) => {
        calls.push(input);
        return { remaining: 999 };
      },
    },
  });

  const result = await authorizer({
    headers: { authorization: "Bearer sl_test_valid" },
    requestContext: { requestId: "request-credit-1" },
  });

  assert.equal(result.isAuthorized, true);
  assert.equal(result.context.usageRemaining, 999);
  assert.deepEqual(calls, [{
    accountId: "acct_1",
    credits: 1,
    units: 1,
    idempotencyKey: `request_${createHash("sha256").update("request-credit-1").digest("hex")}`,
  }]);
});
