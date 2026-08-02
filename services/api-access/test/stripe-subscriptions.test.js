import assert from "node:assert/strict";
import test from "node:test";
import { createStripeSubscriptionGateway } from "../src/stripe-subscriptions.js";

test("creates embedded subscription Checkout with server-owned metadata and request idempotency", async () => {
  const calls = [];
  const stripe = {
    checkout: {
      sessions: {
        create: async (params, options) => {
          calls.push({ params, options });
          return { id: "cs_test_1", client_secret: "cs_test_1_secret_test" };
        },
      },
    },
    webhooks: { constructEvent() {} },
  };
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  const result = await gateway.createCheckoutSession({
    accountId: "acct_1",
    requestId: "request_1",
    email: "dev@example.com",
    plan: "pro",
    priceId: "price_pro123",
    returnUrl: "https://www.solve-lang.com/account/api-keys/",
  });
  assert.equal(result.id, "cs_test_1");
  assert.deepEqual(calls[0], {
    params: {
      mode: "subscription",
      ui_mode: "embedded",
      redirect_on_completion: "if_required",
      client_reference_id: "acct_1",
      customer_email: "dev@example.com",
      line_items: [{ price: "price_pro123", quantity: 1 }],
      return_url: "https://www.solve-lang.com/account/api-keys/",
      metadata: { accountId: "acct_1", plan: "pro", requestId: "request_1" },
      subscription_data: { metadata: { accountId: "acct_1", email: "dev@example.com", plan: "pro" } },
    },
    options: { idempotencyKey: "api-subscription-checkout-request_1" },
  });
});

test("uses an existing Stripe customer instead of accepting a second email source", async () => {
  let params;
  const stripe = {
    checkout: { sessions: { create: async (input) => { params = input; return { id: "cs_test_2", client_secret: "cs_test_2_secret_test" }; } } },
    webhooks: { constructEvent() {} },
  };
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  await gateway.createCheckoutSession({
    accountId: "acct_1",
    requestId: "request_2",
    email: "dev@example.com",
    plan: "developer",
    priceId: "price_dev123",
    customerId: "cus_1",
    returnUrl: "https://www.solve-lang.com/account/api-keys/",
  });
  assert.equal(params.customer, "cus_1");
  assert.equal(params.customer_email, undefined);
});

test("passes raw webhook bytes and signature to Stripe verification", () => {
  const calls = [];
  const stripe = {
    checkout: { sessions: {} },
    webhooks: {
      constructEvent(rawBody, signature, secret) {
        calls.push({ rawBody: rawBody.toString("utf8"), signature, secret });
        return { id: "evt_1" };
      },
    },
  };
  const gateway = createStripeSubscriptionGateway(stripe, "whsec_test");
  assert.deepEqual(gateway.constructWebhookEvent(Buffer.from("raw"), "sig"), { id: "evt_1" });
  assert.deepEqual(calls, [{ rawBody: "raw", signature: "sig", secret: "whsec_test" }]);
});
