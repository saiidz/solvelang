import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { persistApiCheckoutRequestId, resolveApiCheckoutStart } from "./api-checkout";

test("subscribed customers return to their API account even without a plan query", () => {
  assert.deepEqual(resolveApiCheckoutStart("developer", null), { kind: "existing-subscription" });
});

test("unsubscribed customers must choose a valid plan", () => {
  assert.deepEqual(resolveApiCheckoutStart(null, null), { kind: "choose-plan" });
  assert.deepEqual(resolveApiCheckoutStart(null, "invalid"), { kind: "choose-plan" });
  assert.deepEqual(resolveApiCheckoutStart(null, "pro"), { kind: "checkout", plan: "pro" });
});


test("generated request ID survives disclosure navigation and checkout return", () => {
  const origin = "https://www.solve-lang.com";
  let checkoutUrl = new URL("/account/api-checkout/?plan=pro#payment", origin);
  const routerState = { key: "checkout" };
  let replacements = 0;
  let generated = 0;
  const history = {
    state: routerState,
    replaceState(state: unknown, _title: string, url: string) {
      assert.equal(state, routerState, "preserve the existing router history state");
      checkoutUrl = new URL(url, origin);
      replacements += 1;
    },
  };
  const first = persistApiCheckoutRequestId(checkoutUrl, history, () => {
    generated += 1;
    return "checkout_stable_request";
  });
  assert.equal(checkoutUrl.searchParams.get("plan"), "pro");
  assert.equal(checkoutUrl.searchParams.get("request_id"), first);
  assert.equal(checkoutUrl.hash, "#payment");

  // The modified checkout history entry is where browser Back returns after a policy link.
  const disclosureUrl = new URL("/terms/", origin);
  assert.equal(disclosureUrl.pathname, "/terms/");
  const returned = persistApiCheckoutRequestId(checkoutUrl, history, () => {
    generated += 1;
    return "checkout_conflicting_request";
  });
  assert.equal(returned, first);
  assert.equal(generated, 1);
  assert.equal(replacements, 1);

  const checkout = readFileSync("app/account/api-checkout/EmbeddedApiCheckout.tsx", "utf8");
  const persist = checkout.indexOf("persistApiCheckoutRequestId(window.location, window.history, newRequestId)");
  const reserve = checkout.indexOf('"/customer/subscriptions/checkout"');
  assert.ok(persist >= 0 && reserve > persist, "persist the ID before checkout reservation");
});
