import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createMessageAgeMonitoredSupportProvider,
  parseSupportAutomationRuntimeEnvironment,
} from "../src/support-automation-runtime-handler.js";

const root = new URL("../../../", import.meta.url);
const templateUrl = new URL("services/api-access/support-automation-production-stack.yaml", root);
const policyUrl = new URL("ops/aws/production-support-automation-deploy-supplemental-policy.json", root);
const runtimeUrl = new URL("services/api-access/src/support-automation-runtime-handler.js", root);

function enabledEnv(extra = {}) {
  return {
    SITE_ORIGIN: "https://www.solve-lang.com",
    API_SUPPORT_AUTOMATION_ENABLED: "true",
    API_SUPPORT_AUTOMATION_RUNTIME_MODE: "worker",
    API_SUPPORT_AUTOMATION_TABLE: "support-table",
    API_CUSTOMER_AUTH_TABLE: "customer-auth-table",
    ...extra,
  };
}

test("message-age monitor emits only a sanitized threshold marker after provider reads", async () => {
  const warnings = [];
  const calls = [];
  const provider = createMessageAgeMonitoredSupportProvider({
    async getMessage(input) { calls.push(["get", input]); return { id: "opaque-1", receivedAt: "2026-09-13T23:30:00.000Z", subject: "private" }; },
    async readMessage(input) { calls.push(["read", input]); return { id: "opaque-2", receivedAt: "2026-09-13T23:54:00.000Z", subject: "private" }; },
    async sendReply(input) { calls.push(["send", input]); return { id: "sent" }; },
  }, {
    now: () => Date.parse("2026-09-13T23:55:00.000Z"),
    thresholdSeconds: 900,
    logger: { warn(value) { warnings.push(value); } },
  });

  const oldMessage = await provider.getMessage({ opaque: "a" });
  const freshMessage = await provider.readMessage({ opaque: "b" });
  const sent = await provider.sendReply({ opaque: "c" });

  assert.equal(oldMessage.id, "opaque-1");
  assert.equal(freshMessage.id, "opaque-2");
  assert.equal(sent.id, "sent");
  assert.deepEqual(warnings, ["support_automation_message_age_exceeded"]);
  assert.deepEqual(calls.map(([type]) => type), ["get", "read", "send"]);
  assert.equal(warnings.join(" ").includes("opaque-1"), false);
  assert.equal(warnings.join(" ").includes("private"), false);
});

test("message-age monitor ignores invalid and future provider timestamps", async () => {
  const warnings = [];
  let index = 0;
  const messages = [
    { receivedAt: undefined },
    { receivedAt: "not-a-date" },
    { receivedAt: "2026-09-14T00:10:00.000Z" },
  ];
  const provider = createMessageAgeMonitoredSupportProvider({
    async getMessage() { return messages[index++]; },
  }, {
    now: () => Date.parse("2026-09-13T23:55:00.000Z"),
    logger: { warn(value) { warnings.push(value); } },
  });
  await provider.getMessage({});
  await provider.getMessage({});
  await provider.getMessage({});
  assert.deepEqual(warnings, []);
});

test("runtime message-age threshold is bounded and defaults to fifteen minutes", () => {
  assert.equal(parseSupportAutomationRuntimeEnvironment(enabledEnv()).messageAgeThresholdSeconds, 900);
  assert.equal(parseSupportAutomationRuntimeEnvironment(enabledEnv({ API_SUPPORT_AUTOMATION_MAX_MESSAGE_AGE_SECONDS: "1800" })).messageAgeThresholdSeconds, 1800);
  for (const value of ["299", "86401", "1.5", "not-a-number"]) {
    assert.throws(
      () => parseSupportAutomationRuntimeEnvironment(enabledEnv({ API_SUPPORT_AUTOMATION_MAX_MESSAGE_AGE_SECONDS: value })),
      /MAX_MESSAGE_AGE_SECONDS is invalid/,
    );
  }
});

test("support foundation defines catastrophic and handled worker failure, schedule, unknown-outcome and message-age alarms without activating processing", async () => {
  const [template, runtime] = await Promise.all([readFile(templateUrl, "utf8"), readFile(runtimeUrl, "utf8")]);
  assert.match(template, /OperationsAlarmTopicArn:/);
  assert.match(template, /SupportAutomationMaxMessageAgeSeconds:/);
  assert.match(template, /API_SUPPORT_AUTOMATION_MAX_MESSAGE_AGE_SECONDS: !Ref SupportAutomationMaxMessageAgeSeconds/);
  assert.match(template, /Support automation activation requires an explicit operations alarm destination/);
  assert.match(runtime, /WORKER_FAILURE_STATES = new Set\(\["FAILED", "SOURCE_INITIALIZATION_FAILED", "SOURCE_IDENTITY_MISMATCH"\]\)/);
  assert.match(runtime, /support_automation_worker_failure/);
  assert.match(template, /SupportAutomationWorkerFailureMetricFilter:[\s\S]*support_automation_worker_failure/);
  assert.match(template, /SupportAutomationUnknownOutcomeMetricFilter:[\s\S]*support_automation_action_unknown/);
  assert.match(template, /SupportAutomationMessageAgeMetricFilter:[\s\S]*support_automation_message_age_exceeded/);
  assert.match(template, /MetricName: WorkerFailures/);
  assert.match(template, /MetricName: UnknownOutcomes/);
  assert.match(template, /MetricName: MessageAgeBreaches/);
  assert.equal((template.match(/Type: AWS::CloudWatch::Alarm/g) ?? []).length, 5);
  for (const logicalId of [
    "SupportAutomationWorkerErrorsAlarm",
    "SupportAutomationScheduleFailuresAlarm",
    "SupportAutomationHandledWorkerFailureAlarm",
    "SupportAutomationUnknownOutcomeAlarm",
    "SupportAutomationMessageAgeAlarm",
  ]) assert.ok(template.includes(`${logicalId}:`), logicalId);
  assert.ok((template.match(/AlarmActions: !If \[AlertsConfigured/g) ?? []).length >= 5);
  assert.match(template, /State: !If \[SupportAutomationActivationFeatureEnabled, ENABLED, DISABLED\]/);
  assert.match(template, /SupportAutomationActivationEnabled:[\s\S]*Default: "false"/);
  assert.match(template, /SupportAutomationMailSendEnabled:[\s\S]*Default: "false"/);
});

test("monitoring deployment permissions are write-scoped to this support stack's alarms and worker log group", async () => {
  const policy = JSON.parse(await readFile(policyUrl, "utf8"));
  assert.equal(policy.Statement.length, 4);
  assert.equal(policy.Statement.some((statement) => statement.Resource === "*"), false);
  const alarms = policy.Statement.find((statement) => statement.Sid === "SupportAutomationCloudWatchAlarms");
  assert.deepEqual(alarms.Action.sort(), ["cloudwatch:DeleteAlarms", "cloudwatch:PutMetricAlarm"].sort());
  assert.match(alarms.Resource, /^arn:aws:cloudwatch:\*:\*:alarm:solvelang-api-access-production-support-automation-\*$/);
  const filters = policy.Statement.find((statement) => statement.Sid === "SupportAutomationLogMetricFilters");
  assert.deepEqual(filters.Action.sort(), ["logs:DeleteMetricFilter", "logs:PutMetricFilter"].sort());
  assert.match(filters.Resource, /^arn:aws:logs:\*:\*:log-group:\/aws\/lambda\/solvelang-api-access-production-support-automation-\*$/);
  const serialized = JSON.stringify(policy);
  assert.doesNotMatch(serialized, /sns:Publish|iam:|secretsmanager:|ses:|kms:|stripe/i);
});
