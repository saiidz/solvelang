import assert from "node:assert/strict";
import test from "node:test";
import { parseApiAccessEnvironment } from "../src/config.js";

const base = {
  API_ACCESS_ENABLED: "false",
  API_ACCESS_MODE: "test",
  API_KEY_PEPPER: "p".repeat(64),
  API_ACCESS_ADMIN_SECRET: "a".repeat(64),
  SITE_ORIGIN: "https://www.solve-lang.com",
  API_ACCOUNTS_TABLE: "accounts",
  API_KEYS_TABLE: "keys",
  API_USAGE_TABLE: "usage",
  API_USAGE_IDEMPOTENCY_TABLE: "idempotency",
  API_SUBSCRIPTION_EVENTS_TABLE: "events",
};

test("billing remains disabled without requiring Stripe secrets or price IDs", () => {
  const parsed = parseApiAccessEnvironment(base);
  assert.equal(parsed.subscriptionBillingEnabled, false);
  assert.equal(parsed.stripeSecretKey, undefined);
  assert.deepEqual(parsed.priceIds, { developer: undefined, pro: undefined, business: undefined });
});

test("billing requires every signed-webhook and plan-price setting", () => {
  assert.throws(() => parseApiAccessEnvironment({ ...base, API_SUBSCRIPTION_BILLING_ENABLED: "true" }), /STRIPE_SECRET_KEY/);
  const parsed = parseApiAccessEnvironment({
    ...base,
    API_ACCESS_ENABLED: "true",
    API_SUBSCRIPTION_BILLING_ENABLED: "true",
    STRIPE_SECRET_KEY: "sk_test_123",
    STRIPE_SUBSCRIPTION_WEBHOOK_SECRET: "whsec_123",
    STRIPE_API_DEVELOPER_PRICE_ID: "price_dev123",
    STRIPE_API_PRO_PRICE_ID: "price_pro123",
    STRIPE_API_BUSINESS_PRICE_ID: "price_business123",
  });
  assert.equal(parsed.subscriptionBillingEnabled, true);
  assert.equal(parsed.stripeWebhookSecret, "whsec_123");
  assert.deepEqual(parsed.priceIds, {
    developer: "price_dev123",
    pro: "price_pro123",
    business: "price_business123",
  });
});
