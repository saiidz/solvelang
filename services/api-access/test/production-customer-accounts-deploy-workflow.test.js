import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-customer-accounts.yml", import.meta.url);
const foundationWorkflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-foundation.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

async function foundationWorkflow() {
  return await readFile(foundationWorkflowUrl, "utf8");
}

test("production customer-account deployment is manual, protected, main-only, and doubly confirmed", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /confirm_production_customer_accounts/);
  assert.match(source, /confirm_billing_remains_disabled/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /API_ACCESS_MODE: live/);
  assert.match(source, /API_ACCESS_ENABLED: "true"/);
  assert.match(source, /CUSTOMER_ACCOUNTS_ENABLED: "true"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "false"/);
});

test("all production stack deploy workflows share one concurrency lock", async () => {
  const customerSource = await workflow();
  const foundationSource = await foundationWorkflow();
  const group = /group: api-access-production-stack-deployment/;
  assert.match(customerSource, group);
  assert.match(foundationSource, group);
  assert.match(customerSource, /cancel-in-progress: false/);
  assert.match(foundationSource, /cancel-in-progress: false/);
});

test("production customer-account deployment never injects billing credentials", async () => {
  const source = await workflow();
  assert.doesNotMatch(source, /STRIPE_SECRET_KEY/);
  assert.doesNotMatch(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.doesNotMatch(source, /StripeSecretKey=/);
  assert.doesNotMatch(source, /StripeSubscriptionWebhookSecret=/);
  assert.match(source, /SubscriptionBillingEnabled="\$SUBSCRIPTION_BILLING_ENABLED"/);
  assert.match(source, /subscriptionBillingEnabled == false/);
  assert.match(source, /subscription_billing_disabled/);
  assert.match(source, /Stripe credentials injected: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});

test("deployment revalidates readiness before assuming deploy role", async () => {
  const source = await workflow();
  assert.match(source, /Assume production preflight role/);
  assert.match(source, /Verify production stack is safe for first-time enablement/);
  assert.match(source, /Verify deployed customer frontend targets exact production API/);
  assert.match(source, /Verify SES sender and production sending access/);
  assert.match(source, /Run API access tests/);
  assert.match(source, /Validate SAM template/);
  assert.match(source, /Build API access stack/);
  assert.match(source, /Assume production deploy role/);
  assert.ok(source.indexOf("Assume production deploy role") > source.indexOf("Verify SES sender and production sending access"));
});

test("first-time enablement refuses an already-enabled stack", async () => {
  const source = await workflow();
  assert.match(source, /\.enabled == false and \.customerAccountsEnabled == false and \.subscriptionBillingEnabled == false/);
  assert.match(source, /Customer-account enablement is first-run only; the stack must begin fully disabled\./);
  assert.doesNotMatch(source, /\(\(\(\.enabled == false\).*or.*\.enabled == true/s);
});

test("deployment verifies enabled state and rollback restores the required disabled starting state", async () => {
  const source = await workflow();
  assert.match(source, /sam deploy/);
  assert.match(source, /enabled == true and \.customerAccountsEnabled == true and \.subscriptionBillingEnabled == false/);
  assert.match(source, /Roll back first-time customer-account enablement if post-deploy verification fails/);
  assert.match(source, /ApiAccessEnabled="false"/);
  assert.match(source, /CustomerAccountsEnabled="false"/);
  assert.match(source, /SubscriptionBillingEnabled="false"/);
  assert.match(source, /enabled == false and \.customerAccountsEnabled == false and \.subscriptionBillingEnabled == false/);
});
