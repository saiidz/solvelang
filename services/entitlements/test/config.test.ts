import assert from "node:assert/strict";
import test from "node:test";
import { parseEntitlementEnvironment } from "../src/config.js";

const valid = {
  ENTITLEMENT_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_local_only",
  STRIPE_WEBHOOK_SECRET: "whsec_local_only",
  TURNSTILE_SECRET_KEY: "turnstile-test-secret",
  ENTITLEMENT_SIGNING_SECRET: "local-signing-secret-at-least-32-bytes",
    ENTITLEMENTS_TABLE: "entitlements-test",
    CONFIRMATION_DISPATCH_TABLE: "confirmation-dispatch-test",
    WITHDRAWAL_THROTTLE_TABLE: "withdrawal-throttle-test",
  SITE_ORIGIN: "https://www.solve-lang.com",
};

test("test-mode environment accepts complete protected configuration", () => {
  assert.deepEqual(parseEntitlementEnvironment(valid), {
    ...valid,
    CHECKOUT_ENABLED: "false",
    DURABLE_CONFIRMATION_PROVIDER: "disabled",
  });
});

test("checkout defaults disabled until explicitly enabled", () => {
  const production = parseEntitlementEnvironment({
    ...valid,
    ENTITLEMENT_MODE: "production",
    STRIPE_SECRET_KEY: "sk_live_local_only",
  }) as Record<string, string>;
  assert.equal(production.CHECKOUT_ENABLED, "false");
  assert.equal((parseEntitlementEnvironment({ ...valid, CHECKOUT_ENABLED: "true" }) as Record<string, string>).CHECKOUT_ENABLED, "true");
  assert.throws(() => parseEntitlementEnvironment({ ...valid, CHECKOUT_ENABLED: "enabled" }), /CHECKOUT_ENABLED/);
});

test("production checkout requires an implemented durable confirmation provider and its configuration", () => {
  const production = {
    ...valid,
    ENTITLEMENT_MODE: "production",
    STRIPE_SECRET_KEY: "sk_live_local_only",
    CHECKOUT_ENABLED: "true",
  };
  assert.throws(() => parseEntitlementEnvironment(production), /DURABLE_CONFIRMATION_PROVIDER/);
  assert.equal(parseEntitlementEnvironment({
    ...production,
    DURABLE_CONFIRMATION_PROVIDER: "aws-ses-sqs",
    DURABLE_CONFIRMATION_QUEUE_URL: "https://sqs.us-east-1.amazonaws.com/123456789012/confirmations.fifo",
    DURABLE_CONFIRMATION_SENDER: "receipts@solve-lang.com",
  }).DURABLE_CONFIRMATION_PROVIDER, "aws-ses-sqs");
});

test("production checkout rejects the test-sink confirmation provider", () => {
  const production = {
    ...valid,
    ENTITLEMENT_MODE: "production",
    STRIPE_SECRET_KEY: "sk_live_local_only",
    CHECKOUT_ENABLED: "true",
  };
  assert.throws(() => parseEntitlementEnvironment({ ...production, DURABLE_CONFIRMATION_PROVIDER: "test-sink" }), /test-sink/);
});

test("test and production environments reject Stripe keys from the wrong mode", () => {
  assert.throws(() => parseEntitlementEnvironment({ ...valid, STRIPE_SECRET_KEY: "sk_live_forbidden" }), /STRIPE_SECRET_KEY/);
  assert.deepEqual(parseEntitlementEnvironment({
    ...valid,
    ENTITLEMENT_MODE: "production",
    STRIPE_SECRET_KEY: "sk_live_local_only",
  }).ENTITLEMENT_MODE, "production");
  assert.throws(() => parseEntitlementEnvironment({
    ...valid,
    ENTITLEMENT_MODE: "production",
  }), /STRIPE_SECRET_KEY/);
});

test("environment fails closed for incomplete secrets", () => {
  assert.throws(() => parseEntitlementEnvironment({ ...valid, ENTITLEMENT_SIGNING_SECRET: "short" }), /ENTITLEMENT_SIGNING_SECRET/);
  assert.throws(() => parseEntitlementEnvironment({ ...valid, STRIPE_WEBHOOK_SECRET: "missing-prefix" }), /STRIPE_WEBHOOK_SECRET/);
  const withoutTurnstileSecretKey = { ...valid } as Record<string, string>;
  delete withoutTurnstileSecretKey.TURNSTILE_SECRET_KEY;
  assert.throws(() => parseEntitlementEnvironment(withoutTurnstileSecretKey), /TURNSTILE_SECRET_KEY/);
});
