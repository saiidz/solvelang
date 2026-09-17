import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";

const adminSecret = "a".repeat(64);
const opsScriptUrl = new URL("../scripts/configure-production-foundation.sh", import.meta.url);
const deployPolicyUrl = new URL("../../../ops/aws/production-foundation-deploy-policy.json", import.meta.url);
const service = {};

function webhookEvent(signature = "synthetic-signature", body = "synthetic-webhook-body") {
  return {
    rawPath: "/stripe/subscriptions/webhook",
    headers: { "stripe-signature": signature },
    body,
    requestContext: { http: { method: "POST", sourceIp: "203.0.113.8" } },
  };
}

function metricRecords(logs) {
  return logs.filter((record) => record?.type === "subscription_webhook_error");
}

function billingHandler(logs, { failSignature = false, failLifecycle = false } = {}) {
  return createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    subscriptionBillingEnabled: true,
    subscriptionCheckout: { async createCheckout() { return {}; } },
    stripeGateway: {
      constructWebhookEvent(_rawBody, signature) {
        if (failSignature && signature === "synthetic-bad-signature") throw new Error("synthetic provider detail");
        return { id: "evt_synthetic", type: "customer.subscription.updated", data: { object: {} } };
      },
    },
    subscriptionLifecycle: {
      async processEvent() {
        if (failLifecycle) throw new Error("synthetic lifecycle detail");
        return { handled: true, duplicate: false };
      },
    },
    logger: { error(record) { logs.push(record); } },
  });
}

test("subscription webhook failures emit one bounded marker without raw webhook or signature data", async () => {
  const logs = [];
  const handler = billingHandler(logs, { failSignature: true });
  const response = await handler(webhookEvent("synthetic-bad-signature", "synthetic-private-webhook-body"));

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, "invalid_webhook_signature");
  const metrics = metricRecords(logs);
  assert.deepEqual(metrics, [{ type: "subscription_webhook_error", code: "invalid_webhook_signature" }]);
  assert.equal(JSON.stringify(logs).includes("synthetic-private-webhook-body"), false);
  assert.equal(JSON.stringify(logs).includes("synthetic-bad-signature"), false);
  assert.equal(JSON.stringify(logs).includes("synthetic provider detail"), false);
});

test("subscription lifecycle failures emit the same marker while successful and disabled webhook requests do not", async () => {
  const failedLogs = [];
  const failed = await billingHandler(failedLogs, { failLifecycle: true })(webhookEvent());
  assert.equal(failed.statusCode, 500);
  assert.equal(JSON.parse(failed.body).code, "request_failed");
  assert.deepEqual(metricRecords(failedLogs), [{ type: "subscription_webhook_error", code: "request_failed" }]);
  assert.equal(JSON.stringify(failedLogs).includes("synthetic lifecycle detail"), false);

  const successLogs = [];
  const success = await billingHandler(successLogs)(webhookEvent());
  assert.equal(success.statusCode, 200);
  assert.equal(metricRecords(successLogs).length, 0);

  const disabledLogs = [];
  const disabledHandler = createApiAccessHandler({
    service,
    enabled: true,
    adminSecret,
    siteOrigin: "https://www.solve-lang.com",
    logger: { error(record) { disabledLogs.push(record); } },
  });
  const disabled = await disabledHandler(webhookEvent());
  assert.equal(disabled.statusCode, 503);
  assert.equal(JSON.parse(disabled.body).code, "subscription_billing_disabled");
  assert.equal(metricRecords(disabledLogs).length, 0);
});

test("production operations baseline converts the sanitized marker into a repeated-failure alarm", async () => {
  const source = await readFile(opsScriptUrl, "utf8");
  assert.match(source, /logs put-metric-filter/);
  assert.match(source, /--log-group-name "\$API_LOG_GROUP"/);
  assert.match(source, /--filter-name "\$BILLING_WEBHOOK_FILTER"/);
  assert.match(source, /--filter-pattern '\"subscription_webhook_error\"'/);
  assert.match(source, /metricName=SubscriptionWebhookFailures,metricNamespace=SolveLang\/ApiAccess,metricValue=1,unit=Count/);
  assert.match(source, /logs describe-metric-filters/);
  assert.match(source, /--namespace SolveLang\/ApiAccess/);
  assert.match(source, /--metric-name SubscriptionWebhookFailures/);
  assert.match(source, /--period 300/);
  assert.match(source, /--threshold 3/);
  assert.match(source, /--statistic Sum/);
  assert.match(source, /--treat-missing-data notBreaching/);
  assert.match(source, /--alarm-actions "\$ALARM_TOPIC_ARN"/);
  assert.match(source, /authorizer-duration \\\n  subscription-webhook-failures/);
});

test("production deploy policy scopes billing metric-filter access to SolveLang API log groups", async () => {
  const policy = JSON.parse(await readFile(deployPolicyUrl, "utf8"));
  const statement = policy.Statement.find(({ Sid }) => Sid === "SolveLangProductionApiMetricFilters");
  assert.ok(statement);
  assert.deepEqual(statement.Action.sort(), [
    "logs:DeleteMetricFilter",
    "logs:DescribeMetricFilters",
    "logs:PutMetricFilter",
  ].sort());
  assert.deepEqual(statement.Resource, [
    "arn:aws:logs:*:*:log-group:/aws/lambda/solvelang-api-access-production-*",
    "arn:aws:logs:*:*:log-group:/aws/lambda/solvelang-api-access-prod-*",
  ]);
  assert.equal(statement.Resource.includes("*"), false);
});
