import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

test("deployment workflow is manual, protected, main-only, and test-only", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-test/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /API_ACCESS_MODE: test/);
  assert.match(source, /\[\[ "\$API_ACCESS_MODE" == "test" \]\]/);
  assert.doesNotMatch(source, /api-access-production/);
  assert.doesNotMatch(source, /ApiAccessMode="live"/);
});

test("deployment stages fail closed before customer accounts or billing", async () => {
  const source = await workflow();
  assert.match(source, /foundation/);
  assert.match(source, /customer-accounts/);
  assert.match(source, /subscription-billing/);
  assert.match(source, /CustomerAccountsEnabled="\$CUSTOMER_ACCOUNTS_ENABLED"/);
  assert.match(source, /SubscriptionBillingEnabled="\$SUBSCRIPTION_BILLING_ENABLED"/);
  assert.match(source, /CUSTOMER_AUTH_PEPPER.*API_KEY_PEPPER/s);
  assert.match(source, /CUSTOMER_AUTH_PEPPER.*API_ACCESS_ADMIN_SECRET/s);
});

test("customer and billing deployment verify external prerequisites", async () => {
  const source = await workflow();
  assert.match(source, /aws sesv2 get-email-identity/);
  assert.match(source, /VerifiedForSendingStatus/);
  assert.match(source, /STRIPE_SECRET_KEY.*sk_test_/s);
  assert.match(source, /api\.stripe\.com\/v1\/prices/);
  assert.match(source, /\.recurring\.interval == "month"/);
  assert.match(source, /\.currency == "usd"/);
  assert.match(source, /\.unit_amount == \$amount/);
  assert.match(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET.*whsec_/s);
});

test("deployment verifies the CloudFormation output and exact feature flags", async () => {
  const source = await workflow();
  assert.match(source, /ApiAccessBaseUrl/);
  assert.match(source, /curl --fail --silent --show-error "\$api_base\/health"/);
  assert.match(source, /\.enabled == true/);
  assert.match(source, /\.customerAccountsEnabled == \$customer/);
  assert.match(source, /\.subscriptionBillingEnabled == \$billing/);
});