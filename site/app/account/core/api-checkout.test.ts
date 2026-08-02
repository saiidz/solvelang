import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiCheckoutStart } from "./api-checkout";

test("subscribed customers return to their API account even without a plan query", () => {
  assert.deepEqual(resolveApiCheckoutStart("developer", null), { kind: "existing-subscription" });
});

test("unsubscribed customers must choose a valid plan", () => {
  assert.deepEqual(resolveApiCheckoutStart(null, null), { kind: "choose-plan" });
  assert.deepEqual(resolveApiCheckoutStart(null, "invalid"), { kind: "choose-plan" });
  assert.deepEqual(resolveApiCheckoutStart(null, "pro"), { kind: "checkout", plan: "pro" });
});
