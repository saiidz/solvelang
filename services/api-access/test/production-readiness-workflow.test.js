import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL("../../../.github/workflows/production-readiness-preflight.yml", import.meta.url);

async function workflow() {
  return await readFile(workflowUrl, "utf8");
}

test("production preflight is manual, protected, main-only, and validation-only", async () => {
  const source = await workflow();
  assert.match(source, /workflow_dispatch:/);
  assert.match(source, /environment: api-access-production/);
  assert.match(source, /GITHUB_REF.*refs\/heads\/main/);
  assert.match(source, /confirm_no_deploy/);
  assert.match(source, /API_ACCESS_MODE: live/);
  assert.doesNotMatch(source, /sam deploy/);
  assert.doesNotMatch(source, /cloudformation deploy/);
  assert.doesNotMatch(source, /stripe\.com\/v1\/(payment_intents|charges|checkout\/sessions)/);
});

test("production preflight rejects test resources and validates live Stripe billing configuration", async () => {
  const source = await workflow();
  assert.match(source, /STACK_NAME.*prod/);
  assert.match(source, /STACK_NAME.*test/s);
  assert.match(source, /STRIPE_SECRET_KEY.*sk_live_.*rk_live_/s);
  assert.match(source, /STRIPE_SECRET_KEY.*sk_test_/s);
  assert.match(source, /STRIPE_SECRET_KEY.*rk_test_/s);
  assert.match(source, /STRIPE_SUBSCRIPTION_WEBHOOK_SECRET/);
  assert.match(source, /whsec_/);
  assert.match(source, /\.livemode == true/);
  assert.match(source, /\.type == "recurring"/);
  assert.match(source, /\.currency == "usd"/);
  assert.match(source, /\.recurring\.interval == "month"/);
  assert.match(source, /Webhook secret: validated/);
});

test("production preflight validates the reviewed production billing prerequisites without deploying", async () => {
  const source = await workflow();
  assert.match(source, /sam validate --lint --template template\.yaml/);
  assert.match(source, /sam build --template template\.yaml/);
  assert.match(source, /SubscriptionBillingRequirements:/);
  assert.match(source, /Subscription billing requires a Stripe secret key/);
  assert.match(source, /Subscription billing requires a signed webhook secret/);
  assert.match(source, /! grep -q 'SubscriptionBillingRemainsTestOnly:'/);
  assert.match(source, /! grep -q 'Subscription billing is test-mode only until production review is complete'/);
  assert.match(source, /Deployment performed: \*\*no\*\*/);
  assert.match(source, /Charges performed: \*\*no\*\*/);
});