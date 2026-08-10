import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-foundation.yml", import.meta.url);
const opsScriptUrl = new URL("../scripts/configure-production-foundation.sh", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

async function opsScript() {
  return await readFile(opsScriptUrl, "utf8");
}

test("production foundation deployment is manual, protected, main-only, and inert", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /confirm_production_foundation/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /API_ACCESS_MODE: live/);
  assert.match(source, /API_ACCESS_ENABLED: "false"/);
  assert.match(source, /CUSTOMER_ACCOUNTS_ENABLED: "false"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "false"/);
  assert.match(source, /AWS_DEPLOY_ROLE_ARN/);
  assert.doesNotMatch(source, /secrets\.AWS_ROLE_ARN/);
});

test("production foundation never injects Stripe or webhook credentials", async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /StripeSecretKey=/);
  assert.doesNotMatch(source, /StripeSubscriptionWebhookSecret=/);
  assert.doesNotMatch(source, /stripe\.com\/v1\/(payment_intents|charges|checkout\/sessions|subscriptions)/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});

test("production foundation deploy verifies disabled health state and operations controls", async () => {
  const source = await workflow();
  assert.match(source, /sam deploy/);
  assert.match(source, /ApiAccessEnabled="\$API_ACCESS_ENABLED"/);
  assert.match(source, /CustomerAccountsEnabled="\$CUSTOMER_ACCOUNTS_ENABLED"/);
  assert.match(source, /SubscriptionBillingEnabled="\$SUBSCRIPTION_BILLING_ENABLED"/);
  assert.match(source, /\.enabled == false/);
  assert.match(source, /\.customerAccountsEnabled == false/);
  assert.match(source, /\.subscriptionBillingEnabled == false/);
  assert.match(source, /configure-production-foundation\.sh/);
  assert.match(source, /OPERATIONS_ALARM_TOPIC_ARN/);
});

test("operations baseline enables PITR, retention, and alarm routing", async () => {
  const source = await opsScript();
  assert.match(source, /update-continuous-backups/);
  assert.match(source, /PointInTimeRecoveryEnabled=true/);
  assert.match(source, /retention-in-days 90/);
  assert.match(source, /put-metric-alarm/);
  assert.match(source, /--alarm-actions "\$ALARM_TOPIC_ARN"/);
  assert.match(source, /ApiAccountsTable/);
  assert.match(source, /ApiKeysTable/);
  assert.match(source, /ApiCustomerAuthTable/);
  assert.match(source, /ApiSubscriptionEventsTable/);
});
