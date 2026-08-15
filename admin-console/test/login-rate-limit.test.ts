import assert from "node:assert/strict";
import test from "node:test";
import { canAttempt, clearFailures, recordFailure } from "../lib/login-rate-limit";

test("admin login throttling caps repeated failures and resets after the window", () => {
  const source = "203.0.113.9";
  clearFailures(source);
  const now = 1_800_000_000_000;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal(canAttempt(source, now), true);
    recordFailure(source, now);
  }
  assert.equal(canAttempt(source, now), false);
  assert.equal(canAttempt(source, now + 15 * 60 * 1000 + 1), true);
  clearFailures(source);
});
