import assert from "node:assert/strict";
import test from "node:test";
import { parseEntitlementEnvironment } from "../src/config.js";

const valid = {
  STRIPE_SECRET_KEY: "sk_test_local_only",
  STRIPE_WEBHOOK_SECRET: "whsec_local_only",
  STRIPE_PRICE_ID: "price_test_workflow_preflight",
  ENTITLEMENT_SIGNING_SECRET: "local-signing-secret-at-least-32-bytes",
  ENTITLEMENTS_TABLE: "entitlements-test",
  SITE_ORIGIN: "https://www.solve-lang.com",
};

test("test-mode environment accepts complete protected configuration", () => {
  assert.deepEqual(parseEntitlementEnvironment(valid), valid);
});

test("test-mode environment fails closed for live Stripe keys and incomplete secrets", () => {
  assert.throws(() => parseEntitlementEnvironment({ ...valid, STRIPE_SECRET_KEY: "sk_live_forbidden" }), /STRIPE_SECRET_KEY/);
  assert.throws(() => parseEntitlementEnvironment({ ...valid, ENTITLEMENT_SIGNING_SECRET: "short" }), /ENTITLEMENT_SIGNING_SECRET/);
  assert.throws(() => parseEntitlementEnvironment({ ...valid, STRIPE_WEBHOOK_SECRET: "missing-prefix" }), /STRIPE_WEBHOOK_SECRET/);
});
