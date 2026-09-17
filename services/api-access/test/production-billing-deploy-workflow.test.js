import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/deploy-api-access-production-billing.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

test("production billing rollout is manual, protected, main-only, and explicitly confirmed", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /actions: read/);
  assert.match(source, /id-token: write/);
  assert.match(source, /contents: read/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /confirm_production_subscription_billing/);
  assert.match(source, /confirm_stripe_account_reviewed/);
  assert.match(source, /confirm_no_canary_charge/);
  assert.match(source, /API_ACCESS_MODE: live/);
  assert.match(source, /API_ACCESS_ENABLED: "true"/);
  assert.match(source, /CUSTOMER_ACCOUNTS_ENABLED: "true"/);
  assert.match(source, /SUBSCRIPTION_BILLING_ENABLED: "true"/);
});

test("production billing rollout validates exact live Stripe identity and published monthly prices without charging", async () => {
  const source = await workflow();
  assert.match(source, /STRIPE_EXPECTED_ACCOUNT_ID/);
  assert.match(source, /STRIPE_SECRET_KEY.*sk_live_.*rk_live_/s);
  assert.match(source, /STRIPE_SECRET_KEY.*sk_test_/s);
  assert.match(source, /STRIPE_SECRET_KEY.*rk_test_/s);
  assert.match(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET.*whsec_/s);
  assert.match(source, /https:\/\/api\.stripe\.com\/v1\/account/);
  assert.match(source, /\.id == \$expected/);
  assert.match(source, /verify_price "\$STRIPE_API_DEVELOPER_PRICE_ID" 4900/);
  assert.match(source, /verify_price "\$STRIPE_API_PRO_PRICE_ID" 19900/);
  assert.match(source, /verify_price "\$STRIPE_API_BUSINESS_PRICE_ID" 69900/);
  assert.match(source, /\.livemode == true/);
  assert.match(source, /\.type == "recurring"/);
  assert.match(source, /\.currency == "usd"/);
  assert.match(source, /\.recurring\.interval == "month"/);
  assert.doesNotMatch(source, /api\.stripe\.com\/v1\/(payment_intents|charges|checkout\/sessions)/);
  assert.doesNotMatch(source, /curl[^\n]*-X POST[^\n]*api\.stripe\.com/);
  assert.doesNotMatch(source, /curl[^\n]*--request POST[^\n]*api\.stripe\.com/);
});

test("production billing rollout verifies the exact live subscription webhook contract", async () => {
  const source = await workflow();
  assert.match(source, /webhook_url="\$API_BASE\/stripe\/subscriptions\/webhook"/);
  assert.match(source, /api\.stripe\.com\/v1\/webhook_endpoints\?limit=100/);
  assert.match(source, /\.url == \$url/);
  assert.match(source, /\.livemode == true/);
  assert.match(source, /\.status == "enabled"/);
  assert.match(source, /customer\.subscription\.created/);
  assert.match(source, /customer\.subscription\.updated/);
  assert.match(source, /customer\.subscription\.deleted/);
  assert.match(source, /\] \| length == 1/);
});

test("production billing rollout preserves unrelated production features and serializes before state capture", async () => {
  const source = await workflow();
  assert.ok(
    source.indexOf("Wait for earlier production deployment requests")
      < source.indexOf("Capture exact production feature state"),
  );
  assert.match(source, /node scripts\/wait-for-production-deployment-turn\.mjs/);
  assert.match(source, /CustomerTotpEnabled/);
  assert.match(source, /CustomerTotpKmsKeyArn/);
  assert.match(source, /AdminCrmEnabled/);
  assert.match(source, /PRESERVED_TOTP_ENABLED/);
  assert.match(source, /PRESERVED_TOTP_KMS/);
  assert.match(source, /PRESERVED_CRM_ENABLED/);
  assert.match(source, /AdminCrmEnabled="\$PRESERVED_CRM_ENABLED"/);
  assert.match(source, /CustomerTotpEnabled="\$PRESERVED_TOTP_ENABLED"/);
  assert.match(source, /CustomerTotpKmsKeyArn="\$PRESERVED_TOTP_KMS"/);
});

test("production billing rollout enables only after candidate validation and verifies the live runtime", async () => {
  const source = await workflow();
  assert.match(source, /SubscriptionBillingRequirements:/);
  assert.match(source, /! grep -q '\^  SubscriptionBillingRemainsTestOnly:'/);
  assert.match(source, /sam validate --lint --template template\.yaml/);
  assert.match(source, /sam build --template template\.yaml/);
  assert.match(source, /SubscriptionBillingEnabled="true"/);
  assert.match(source, /StripeSecretKey="\$STRIPE_SECRET_KEY"/);
  assert.match(source, /StripeSubscriptionWebhookSecret="\$STRIPE_SUBSCRIPTION_WEBHOOK_SECRET"/);
  assert.match(source, /StripeApiDeveloperPriceId="\$STRIPE_API_DEVELOPER_PRICE_ID"/);
  assert.match(source, /StripeApiProPriceId="\$STRIPE_API_PRO_PRICE_ID"/);
  assert.match(source, /StripeApiBusinessPriceId="\$STRIPE_API_BUSINESS_PRICE_ID"/);
  assert.match(source, /subscriptionBillingEnabled == true/);
  assert.match(source, /API_SUBSCRIPTION_BILLING_ENABLED/);
  assert.match(source, /webhook_status.*400/s);
  assert.match(source, /invalid_webhook/);
});

test("production billing rollout arms monitoring and has state-preserving rollback", async () => {
  const source = await workflow();
  assert.match(source, /configure-production-foundation\.sh/);
  assert.match(source, /subscription-webhook-failures/);
  assert.match(source, /ActionsEnabled == true/);
  assert.match(source, /TreatMissingData == "notBreaching"/);
  assert.match(source, /Threshold == 3/);
  assert.match(source, /Period == 300/);
  assert.match(source, /StateValue != "ALARM"/);
  assert.match(source, /rollback-production-customer-accounts\.sh/);
  assert.match(source, /INITIAL_CUSTOMER_TOTP_ENABLED/);
  assert.match(source, /INITIAL_CUSTOMER_TOTP_KMS_KEY_ARN/);
  assert.match(source, /INITIAL_ADMIN_CRM_ENABLED/);
});

test("production billing rollout explicitly records that deployment performs no payment canary", async () => {
  const source = await workflow();
  assert.match(source, /Canary\/customer charge performed by this workflow: \*\*no\*\*/);
  assert.match(source, /separate explicitly authorized payment canary/);
});
