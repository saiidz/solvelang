import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createApiAccessHandler } from "../src/api-handler.js";

const adminSecret = "a".repeat(64);
const opsScriptUrl = new URL("../scripts/configure-production-foundation.sh", import.meta.url);
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
  return logs
    .filter((record) => typeof record === "string")
    .map((record) => JSON.parse(record))
    .filter((record) => record.type === "subscription_webhook_error");
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

test("subscription webhook failures emit one bounded EMF metric without raw webhook or signature data", async () => {
  const logs = [];
  const handler = billingHandler(logs, { failSignature: true });
  const response = await handler(webhookEvent("synthetic-bad-signature", "synthetic-private-webhook-body"));

  assert.equal(response.statusCode, 400);
  assert.equal(JSON.parse(response.body).code, "invalid_webhook_signature");
  const metrics = metricRecords(logs);
  assert.equal(metrics.length, 1);
  assert.equal(metrics[0].Service, "api-access");
  assert.equal(metrics[0].SubscriptionWebhookFailures, 1);
  assert.equal(metrics[0].code, "invalid_webhook_signature");
  assert.deepEqual(metrics[0]._aws.CloudWatchMetrics, [{
    Namespace: "SolveLang/ApiAccess",
    Dimensions: [["Service"]],
    Metrics: [{ Name: "SubscriptionWebhookFailures", Unit: "Count" }],
  }]);
  assert.equal(Number.isSafeInteger(metrics[0]._aws.Timestamp), true);
  assert.equal(JSON.stringify(logs).includes("synthetic-private-webhook-body"), false);
  assert.equal(JSON.stringify(logs).includes("synthetic-bad-signature"), false);
  assert.equal(JSON.stringify(logs).includes("synthetic provider detail"), false);
});

test("subscription lifecycle failures emit the same metric while successful and disabled webhook requests do not", async () => {
  const failedLogs = [];
  const failed = await billingHandler(failedLogs, { failLifecycle: true })(webhookEvent());
  assert.equal(failed.statusCode, 500);
  assert.equal(JSON.parse(failed.body).code, "request_failed");
  assert.deepEqual(metricRecords(failedLogs).map(({ code }) => code), ["request_failed"]);
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

test("production operations baseline alarms on repeated billing webhook failures and routes it to the configured topic", async () => {
  const source = await readFile(opsScriptUrl, "utf8");
  assert.match(source, /subscription-webhook-failures/);
  assert.match(source, /--namespace SolveLang\/ApiAccess/);
  assert.match(source, /--metric-name SubscriptionWebhookFailures/);
  assert.match(source, /--dimensions Name=Service,Value=api-access/);
  assert.match(source, /--period 300/);
  assert.match(source, /--threshold 3/);
  assert.match(source, /--statistic Sum/);
  assert.match(source, /--treat-missing-data notBreaching/);
  assert.match(source, /--alarm-actions "\$ALARM_TOPIC_ARN"/);
  assert.match(source, /authorizer-duration \\\n  subscription-webhook-failures/);
});
