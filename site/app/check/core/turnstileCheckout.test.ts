import assert from "node:assert/strict";
import test from "node:test";
import {
  beginCheckout,
  checkoutConfigurationError,
  checkoutCreated,
  checkoutFailed,
  expireTurnstile,
  initialCheckoutGate,
} from "../../checkout/checkoutGate";

const scanId = "6c8e4b95-1e66-4dc3-9b67-af15f0742875";

test("a missing public Turnstile site key shows a safe configuration error before checkout can start", () => {
  assert.equal(
    checkoutConfigurationError({
      apiBase: "https://api.example.test",
      publishableKey: "pk_test_example",
      turnstileSiteKey: "",
      scanId,
    }),
    "Checkout verification is not configured.",
  );
});

test("Turnstile expiry before checkout creation requires a new verification", () => {
  const awaitingVerification = initialCheckoutGate();
  assert.deepEqual(expireTurnstile(awaitingVerification), initialCheckoutGate());
});

test("Turnstile expiry after a client secret mounts preserves the payment form state", () => {
  const paymentReady = checkoutCreated(beginCheckout(initialCheckoutGate(), "turnstile-token"));
  assert.equal(paymentReady.phase, "payment_ready");
  assert.deepEqual(expireTurnstile(paymentReady), paymentReady);
});

test("duplicate Turnstile callbacks cannot start concurrent checkout requests", () => {
  const creatingCheckout = beginCheckout(initialCheckoutGate(), "first-token");
  assert.equal(creatingCheckout.phase, "creating_checkout");
  assert.deepEqual(beginCheckout(creatingCheckout, "second-token"), creatingCheckout);

  const paymentReady = checkoutCreated(creatingCheckout);
  assert.deepEqual(beginCheckout(paymentReady, "third-token"), paymentReady);
});

test("checkout creation failure returns to Turnstile verification for a fresh single-use token", () => {
  assert.deepEqual(checkoutFailed(), initialCheckoutGate());
  assert.equal(beginCheckout(checkoutFailed(), "fresh-token").phase, "creating_checkout");
});
