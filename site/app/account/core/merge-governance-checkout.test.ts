import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { buildMgovBillingDetails, MGOV_BILLING_COUNTRIES, mgovPlanFor, mgovTotalDollars, parseMgovSeats, resolveMgovSelection } from "./merge-governance-checkout";

test("selection defaults to Regular monthly and honors explicit pack and interval", () => {
  assert.deepEqual(resolveMgovSelection(null, null), { pack: "regular", interval: "monthly", plan: "mgov-regular-monthly" });
  assert.deepEqual(resolveMgovSelection("plus", "annual"), { pack: "plus", interval: "annual", plan: "mgov-plus-annual" });
  assert.deepEqual(resolveMgovSelection("bogus", "weekly"), { pack: "regular", interval: "monthly", plan: "mgov-regular-monthly" });
});

test("plan keys cover every pack and interval combination", () => {
  assert.equal(mgovPlanFor("regular", "monthly"), "mgov-regular-monthly");
  assert.equal(mgovPlanFor("regular", "annual"), "mgov-regular-annual");
  assert.equal(mgovPlanFor("plus", "monthly"), "mgov-plus-monthly");
  assert.equal(mgovPlanFor("plus", "annual"), "mgov-plus-annual");
});

test("seat parsing accepts 1-999 whole seats and rejects everything else", () => {
  assert.equal(parseMgovSeats("1"), 1);
  assert.equal(parseMgovSeats("999"), 999);
  assert.equal(parseMgovSeats(" 12 "), 12);
  assert.equal(parseMgovSeats("0"), null);
  assert.equal(parseMgovSeats("1000"), null);
  assert.equal(parseMgovSeats("2.5"), null);
  assert.equal(parseMgovSeats("-3"), null);
  assert.equal(parseMgovSeats("abc"), null);
  assert.equal(parseMgovSeats(""), null);
});

test("totals multiply the per-seat price by the seat count", () => {
  assert.equal(mgovTotalDollars(20, 5), 100);
  assert.equal(mgovTotalDollars(600, 3), 1800);
});

test("the checkout page proves the session before creating a checkout, and never links out to a hosted payment page", () => {
  const checkout = readFileSync("app/account/merge-governance-checkout/EmbeddedMgovCheckout.tsx", "utf8");
  const accountCheck = checkout.indexOf('"/customer/account"');
  const createCheckout = checkout.indexOf('"/customer/subscriptions/merge-governance/elements-checkout"');
  const persist = checkout.indexOf("persistApiCheckoutRequestId(window.location, window.history, newRequestId)");
  assert.ok(accountCheck >= 0 && createCheckout > accountCheck, "check the signed-in account before creating a checkout");
  assert.ok(persist >= 0 && createCheckout > persist, "persist the request ID before checkout reservation");
  assert.equal(checkout.includes("buy.stripe.com"), false, "SolveLang sells through its own embedded pages only");
});

const emptyBilling = { country: "", line1: "", line2: "", city: "", state: "", postalCode: "", taxId: "" };

test("billing details are empty without a country, so the checkout payload stays unchanged", () => {
  assert.deepEqual(buildMgovBillingDetails(emptyBilling), {});
  assert.deepEqual(buildMgovBillingDetails({ ...emptyBilling, taxId: "RO54564122" }), {});
});

test("billing details carry the country, only the filled optional fields, and the tax ID", () => {
  assert.deepEqual(
    buildMgovBillingDetails({
      country: " ro ",
      line1: " Str. Nerva Traian 27-33 ",
      line2: "",
      city: "Bucharest",
      state: "",
      postalCode: "030167",
      taxId: " RO54564122 ",
    }),
    {
      billingAddress: { country: "RO", line1: "Str. Nerva Traian 27-33", city: "Bucharest", postalCode: "030167" },
      taxId: "RO54564122",
    },
  );
  assert.deepEqual(
    buildMgovBillingDetails({ ...emptyBilling, country: "DE" }),
    { billingAddress: { country: "DE" } },
  );
});

test("the billing country list covers the EU and uses ISO alpha-2 codes", () => {
  assert.ok(MGOV_BILLING_COUNTRIES.length >= 27);
  for (const country of MGOV_BILLING_COUNTRIES) {
    assert.match(country.code, /^[A-Z]{2}$/);
    assert.ok(country.name.length > 0);
  }
  assert.ok(MGOV_BILLING_COUNTRIES.some((country) => country.code === "RO"));
});

test("the checkout component sends billing details and never presents the pre-tax subtotal as the final total", () => {
  const checkout = readFileSync("app/account/merge-governance-checkout/EmbeddedMgovCheckout.tsx", "utf8");
  assert.ok(checkout.includes("buildMgovBillingDetails"), "the checkout request carries the billing details");
  assert.ok(checkout.includes("MGOV_BILLING_COUNTRIES"), "the billing country select is offered");
  assert.ok(checkout.includes("plus tax where applicable"), "totals are labeled as excluding tax");
  assert.equal(checkout.includes("Total due today"), false, "the pre-tax subtotal is never labeled as the total due");
});
