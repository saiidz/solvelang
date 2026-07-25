import assert from "node:assert/strict";
import test from "node:test";
import { parseEntitlementEnvironment } from "../src/config.js";

const valid = {
  ENTITLEMENT_MODE: "test",
  STRIPE_SECRET_KEY: "sk_test_local_only",
  STRIPE_WEBHOOK_SECRET: "whsec_local_only",
  ENTITLEMENT_SIGNING_SECRET: "local-signing-secret-at-least-32-bytes",
  ENTITLEMENTS_TABLE: "entitlements-test",
  SITE_ORIGIN: "https://www.solve-lang.com",
};

test("test-mode environment accepts complete protected configuration", () => {
  assert.deepEqual(parseEntitlementEnvironment(valid), { ...valid, CHECKOUT_ENABLED: "false" });
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
});
