import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createAccountAccessGuardedSupportProvider,
  createAccountAccessGuardedSupportStore,
  parseSupportAutomationRuntimeEnvironment,
} from "../src/support-automation-runtime-handler.js";

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/support-automation-production-stack.yaml", root);
const workflowUrl = new URL(".github/workflows/deploy-support-automation-production-foundation.yml", root);
const policyUrl = new URL("ops/aws/production-support-automation-deploy-supplemental-policy.json", root);
const apiCiUrl = new URL(".github/workflows/api-access-ci.yml", root);
const accountId = `acct_${"a".repeat(32)}`;
const credentialSecretArn = `arn:aws:secretsmanager:us-east-1:123456789012:secret:solvelang/support-automation/${accountId}/gmail-AbCd`;

test("support runtime defaults off and rejects activation without the foundation", () => {
  const disabled = parseSupportAutomationRuntimeEnvironment({ SITE_ORIGIN: "https://www.solve-lang.com" });
  assert.equal(disabled.enabled, false);
  assert.equal(disabled.activationEnabled, false);
  assert.equal(disabled.runtimeMode, "api");
  assert.throws(() => parseSupportAutomationRuntimeEnvironment({
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_SUPPORT_AUTOMATION_ACTIVATION_ENABLED: "true",
  }), /requires support automation to be enabled/);
});

test("worker runtime does not require or receive the customer-auth pepper", () => {
  const worker = parseSupportAutomationRuntimeEnvironment({
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_SUPPORT_AUTOMATION_ENABLED: "true",
    API_SUPPORT_AUTOMATION_RUNTIME_MODE: "worker",
    API_SUPPORT_AUTOMATION_TABLE: "support-table",
    API_CUSTOMER_AUTH_TABLE: "customer-auth-table",
  });
  assert.equal(worker.runtimeMode, "worker");
  assert.equal(worker.customerAuthPepper, undefined);
  assert.throws(() => parseSupportAutomationRuntimeEnvironment({
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_SUPPORT_AUTOMATION_ENABLED: "true",
    API_SUPPORT_AUTOMATION_RUNTIME_MODE: "api",
    API_SUPPORT_AUTOMATION_TABLE: "support-table",
    API_CUSTOMER_AUTH_TABLE: "customer-auth-table",
  }), /API_CUSTOMER_AUTH_PEPPER is required/);
  assert.throws(() => parseSupportAutomationRuntimeEnvironment({
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_SUPPORT_AUTOMATION_RUNTIME_MODE: "unexpected",
  }), /must be api or worker/);
});

test("restricted customer accounts are removed from worker discovery and paused", async () => {
  const calls = [];
  const store = {
    async listActiveConfigs() { return [{ accountId, revision: 7, automationState: "ACTIVE" }]; },
    async setState(...args) { calls.push(args); return { automationState: "PAUSED", revision: 8 }; },
  };
  const guarded = createAccountAccessGuardedSupportStore(store, { async isActive(value) { assert.equal(value, accountId); return false; } }, {
    now: () => Date.parse("2026-09-13T23:40:00Z"),
    logger: { error() { throw new Error("pause should not fail"); } },
  });
  assert.deepEqual(await guarded.listActiveConfigs(10), []);
  assert.deepEqual(calls, [[accountId, 7, "PAUSED", "2026-09-13T23:40:00.000Z"]]);
});

test("provider calls recheck account access so suspension during a tick fails before external I/O", async () => {
  let providerCalls = 0;
  let active = true;
  const provider = createAccountAccessGuardedSupportProvider({
    async sendReply(input) { providerCalls += 1; return { id: input.messageId ?? "reply" }; },
  }, {
    async isActive(value) { assert.equal(value, accountId); return active; },
  });
  await provider.sendReply({ credentialSecretArn, messageId: "first" });
  assert.equal(providerCalls, 1);
  active = false;
  await assert.rejects(
    () => provider.sendReply({ credentialSecretArn, messageId: "second" }),
    /account access is restricted/,
  );
  assert.equal(providerCalls, 1);
  await assert.rejects(
    () => provider.sendReply({ credentialSecretArn: "arn:aws:secretsmanager:us-east-1:123456789012:secret:wrong/path" }),
    /not tenant scoped/,
  );
  assert.equal(providerCalls, 1);
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

test("support API cannot resolve provider secrets while worker has account-status read and tagged namespace-only secret access", async () => {
  const template = await readFile(templateUrl, "utf8");
  const apiBlock = template.slice(template.indexOf("SupportAutomationApiFunction:"), template.indexOf("SupportAutomationWorkerFunction:"));
  const workerBlock = template.slice(template.indexOf("SupportAutomationWorkerFunction:"), template.indexOf("SupportAutomationIntegration:"));
  assert.match(apiBlock, /API_SUPPORT_AUTOMATION_RUNTIME_MODE: api/);
  assert.match(apiBlock, /API_CUSTOMER_AUTH_PEPPER: !Ref CustomerAuthPepper/);
  assert.doesNotMatch(apiBlock, /secretsmanager:GetSecretValue/);
  assert.match(workerBlock, /API_SUPPORT_AUTOMATION_RUNTIME_MODE: worker/);
  assert.doesNotMatch(workerBlock, /API_CUSTOMER_AUTH_PEPPER/);
  assert.match(workerBlock, /dynamodb:GetItem/);
  assert.match(workerBlock, /Resource: !Sub arn:\$\{AWS::Partition\}:dynamodb:\$\{AWS::Region\}:\$\{AWS::AccountId\}:table\/\$\{CustomerAuthTableName\}/);
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
  const jobEnvironment = workflow.slice(workflow.indexOf("    env:"), workflow.indexOf("    steps:"));
  assert.doesNotMatch(jobEnvironment, /CUSTOMER_AUTH_PEPPER/);
  const enforceStep = workflow.slice(workflow.indexOf("      - name: Enforce default-off support automation boundary"), workflow.indexOf("      - uses: actions\/setup-node@v4"));
  const repositoryTestStep = workflow.slice(workflow.indexOf("      - name: Run repository support automation tests"), workflow.indexOf("      - name: Validate and build default-off foundation"));
  const deployStep = workflow.slice(workflow.indexOf("      - name: Deploy foundation with activation OFF"), workflow.indexOf("      - name: Verify durable foundation exists"));
  assert.match(enforceStep, /CUSTOMER_AUTH_PEPPER: \$\{\{ secrets\.CUSTOMER_AUTH_PEPPER \}\}/);
  assert.doesNotMatch(repositoryTestStep, /CUSTOMER_AUTH_PEPPER/);
  assert.match(deployStep, /CUSTOMER_AUTH_PEPPER: \$\{\{ secrets\.CUSTOMER_AUTH_PEPPER \}\}/);
  const supplemental = JSON.parse(policy);
  assert.equal(supplemental.Statement.length, 4);
  const cloudFormation = supplemental.Statement.find((statement) => statement.Sid === "SupportAutomationCloudFormationStack");
  const events = supplemental.Statement.find((statement) => statement.Sid === "SupportAutomationEventBridgeRules");
  const alarms = supplemental.Statement.find((statement) => statement.Sid === "SupportAutomationCloudWatchAlarms");
  const metricFilters = supplemental.Statement.find((statement) => statement.Sid === "SupportAutomationLogMetricFilters");
  assert.match(cloudFormation.Resource, /stack\/solvelang-api-access-production-support-automation\/\*/);
  assert.ok(cloudFormation.Action.includes("cloudformation:UpdateTerminationProtection"));
  assert.match(events.Resource, /rule\/solvelang-api-access-production-support-automation-\*/);
  assert.match(alarms.Resource, /alarm:solvelang-api-access-production-support-automation-\*/);
  assert.deepEqual(alarms.Action.sort(), ["cloudwatch:DeleteAlarms", "cloudwatch:PutMetricAlarm"].sort());
  assert.match(metricFilters.Resource, /log-group:\/aws\/lambda\/solvelang-api-access-production-support-automation-\*/);
  assert.deepEqual(metricFilters.Action.sort(), ["logs:DeleteMetricFilter", "logs:PutMetricFilter"].sort());
  assert.equal(supplemental.Statement.some((statement) => statement.Resource === "*"), false);
  assert.match(apiCi, /support-automation-production-stack\.yaml/);
  assert.match(apiCi, /production-support-automation-deploy-supplemental-policy\.json/);
});
