import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const templateUrl = new URL("../template.yaml", import.meta.url);
const priorityTemplateUrl = new URL("../priority-template.yaml", import.meta.url);
const handlerUrl = new URL("../src/handler.js", import.meta.url);

function section(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0, `missing section ${start}`);
  assert.ok(to > from, `missing section boundary ${end}`);
  return source.slice(from, to);
}

test("main API stack exposes protected account-access routes and gives the authorizer conditional GetItem-only CustomerAuth access", async () => {
  const source = await readFile(templateUrl, "utf8");
  assert.match(source, /CustomerAccountsFeatureEnabled: !Equals \[!Ref CustomerAccountsEnabled, "true"\]/);
  assert.match(source, /AccountAccessStatus:[\s\S]*Path: \/internal\/accounts\/access[\s\S]*Method: GET/);
  assert.match(source, /AccountAccessTransition:[\s\S]*Path: \/internal\/accounts\/access[\s\S]*Method: POST/);

  const authorizer = section(source, "  ApiKeyAuthorizerFunction:", "  ApiKeyAuthorizerInvokePermission:");
  assert.match(authorizer, /API_CUSTOMER_ACCOUNTS_ENABLED: !Ref CustomerAccountsEnabled/);
  assert.match(authorizer, /API_CUSTOMER_AUTH_TABLE: !Ref ApiCustomerAuthTable/);
  assert.match(authorizer, /- !If[\s\S]*- CustomerAccountsFeatureEnabled[\s\S]*- dynamodb:GetItem[\s\S]*Resource: !GetAtt ApiCustomerAuthTable.Arn/);
  assert.doesNotMatch(authorizer, /DynamoDBReadPolicy:[\s\S]{0,120}TableName: !Ref ApiCustomerAuthTable/);
  assert.doesNotMatch(authorizer, /DynamoDBCrudPolicy:[\s\S]{0,120}TableName: !Ref ApiCustomerAuthTable/);
  assert.doesNotMatch(authorizer, /dynamodb:(?:BatchGetItem|Query|Scan|PutItem|UpdateItem|DeleteItem)/);
});

test("priority workers use optional GetItem-only customer account verification", async () => {
  const source = await readFile(priorityTemplateUrl, "utf8");
  assert.match(source, /CustomerAuthTableName:[\s\S]*Default: ""/);
  assert.match(source, /CustomerAccountVerificationConfigured:/);
  assert.equal((source.match(/API_CUSTOMER_AUTH_TABLE: !Ref CustomerAuthTableName/g) ?? []).length, 4);
  assert.equal((source.match(/- dynamodb:GetItem/g) ?? []).length, 4);
  assert.doesNotMatch(source, /dynamodb:(?:PutItem|UpdateItem|DeleteItem)/);
  assert.match(source, /table\/\$\{CustomerAuthTableName\}/);
});

test("signed Stripe lifecycle remains able to reconcile restricted accounts while customer mutations are guarded", async () => {
  const source = await readFile(handlerUrl, "utf8");
  assert.match(source, /const guardedService = accountAccess[\s\S]*createAccessGuardedApiAccessService\(service, accountAccess\)/);
  assert.match(source, /subscriptionCheckout = createEmbeddedSubscriptionCheckoutService\([\s\S]*apiAccessService: guardedService/);
  assert.match(source, /createSubscriptionManagementService\([\s\S]*apiAccessService: guardedService/);
  assert.match(source, /subscriptionLifecycle = createSubscriptionLifecycleService\([\s\S]*apiAccessService: service,/);
});
