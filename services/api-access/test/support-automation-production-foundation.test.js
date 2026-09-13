import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseSupportAutomationRuntimeEnvironment } from "../src/support-automation-runtime-handler.js";

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/support-automation-production-stack.yaml", root);
const workflowUrl = new URL(".github/workflows/deploy-support-automation-production-foundation.yml", root);
const policyUrl = new URL("ops/aws/production-support-automation-deploy-supplemental-policy.json", root);
const apiCiUrl = new URL(".github/workflows/api-access-ci.yml", root);

test("support runtime defaults off and rejects activation without the foundation", () => {
  const disabled = parseSupportAutomationRuntimeEnvironment({ SITE_ORIGIN: "https://www.solve-lang.com" });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.activationEnabled, false);
  assert.throws(() => parseSupportAutomationRuntimeEnvironment({
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_SUPPORT_AUTOMATION_ACTIVATION_ENABLED: "true",
  }), /requires support automation to be enabled/);
});

test("support production stack attaches only bounded customer routes and defaults all processing off", async () => {
  const template = await readFile(templateUrl, "utf8");
  assert.match(template, /SupportAutomationEnabled:/);
  assert.match(template, /SupportAutomationActivationEnabled:/);
  assert.ok((template.match(/Default: "false"/g) ?? []).length >= 2);
  assert.doesNotMatch(template, /AWS::ApiGatewayV2::Api/);
  for (const route of [
    "GET /customer/support-automation",
    "GET /customer/support-automation/history",
    "POST /customer/support-automation/config",
    "POST /customer/support-automation/pause",
    "POST /customer/support-automation/resume",
    "POST /customer/support-automation/revoke",
  ]) assert.ok(template.includes(route), route);
  assert.match(template, /State: !If \[SupportAutomationActivationFeatureEnabled, ENABLED, DISABLED\]/);
  assert.match(template, /MaximumRetryAttempts: 0/);
  assert.match(template, /ReservedConcurrentExecutions: 1/);
});

test("support storage is durable, bounded-retention, indexed and protected", async () => {
  const template = await readFile(templateUrl, "utf8");
  assert.match(template, /DeletionProtectionEnabled: true/);
  assert.match(template, /PointInTimeRecoveryEnabled: true/);
  assert.match(template, /AttributeName: expiresAt[\s\S]*Enabled: true/);
  assert.match(template, /IndexName: AutomationStateIndex/);
  assert.match(template, /DeletionPolicy: Retain/);
  assert.match(template, /RetentionInDays: 30/);
});

test("support API cannot resolve provider secrets while the worker has a tagged namespace-only read grant", async () => {
  const template = await readFile(templateUrl, "utf8");
  const apiBlock = template.slice(template.indexOf("SupportAutomationApiFunction:"), template.indexOf("SupportAutomationWorkerFunction:"));
  const workerBlock = template.slice(template.indexOf("SupportAutomationWorkerFunction:"), template.indexOf("SupportAutomationIntegration:"));
  assert.doesNotMatch(apiBlock, /secretsmanager:GetSecretValue/);
  assert.match(workerBlock, /secretsmanager:GetSecretValue/);
  assert.match(workerBlock, /secret:solvelang\/support-automation\/acct_\*\/\*/);
  assert.match(workerBlock, /secretsmanager:ResourceTag\/Project: SolveLang/);
  assert.match(workerBlock, /secretsmanager:ResourceTag\/Purpose: support-automation/);
  assert.match(workerBlock, /secretsmanager:ResourceTag\/Environment: production/);
  assert.doesNotMatch(template, /ses:Send|stripe|Stripe|kms:Decrypt/);
});

test("protected foundation workflow refuses activation and provider execution and declares only narrow IAM supplements", async () => {
  const [workflow, policy, apiCi] = await Promise.all([
    readFile(workflowUrl, "utf8"),
    readFile(policyUrl, "utf8"),
    readFile(apiCiUrl, "utf8"),
  ]);
  assert.match(workflow, /confirm_support_foundation/);
  assert.match(workflow, /confirm_activation_remains_disabled/);
  assert.match(workflow, /confirm_no_provider_calls/);
  assert.match(workflow, /SupportAutomationEnabled=true/);
  assert.match(workflow, /SupportAutomationActivationEnabled=false/);
  assert.match(workflow, /SubscriptionBillingEnabled/);
  assert.match(workflow, /== false/);
  assert.doesNotMatch(workflow, /GetSecretValue|gmail\.googleapis|api\.linear\.app|oauth2\.googleapis/);
  const supplemental = JSON.parse(policy);
  assert.equal(supplemental.Statement.length, 2);
  const cloudFormation = supplemental.Statement.find((statement) => statement.Sid === "SupportAutomationCloudFormationStack");
  const events = supplemental.Statement.find((statement) => statement.Sid === "SupportAutomationEventBridgeRules");
  assert.match(cloudFormation.Resource, /stack\/solvelang-api-access-production-support-automation\/\*/);
  assert.ok(cloudFormation.Action.includes("cloudformation:UpdateTerminationProtection"));
  assert.match(events.Resource, /rule\/solvelang-api-access-production-support-automation-\*/);
  assert.match(apiCi, /support-automation-production-stack\.yaml/);
  assert.match(apiCi, /production-support-automation-deploy-supplemental-policy\.json/);
});
