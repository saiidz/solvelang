import assert from "node:assert/strict";
import test from "node:test";
import { CREDIT_POLICY, calculateCreditCharge, getProcessingPriority } from "../src/credits.js";

test("one credit covers the published token envelope", () => {
  assert.deepEqual(CREDIT_POLICY, {
    inputTokensPerCredit: 5_000,
    outputTokensPerCredit: 1_000,
    maxOutputTokensPerCall: 1_000,
  });
  const charge = calculateCreditCharge({ inputTokens: 5_000, outputTokens: 1_000 });
  assert.equal(charge.baseCredits, 1);
  assert.equal(charge.chargedCredits, 1);
  assert.equal(charge.priority, "standard");
});

test("large workloads are charged by the larger token dimension", () => {
  const charge = calculateCreditCharge({ inputTokens: 50_000, outputTokens: 2_000 });
  assert.equal(charge.inputCredits, 10);
  assert.equal(charge.outputCredits, 2);
  assert.equal(charge.baseCredits, 10);
  assert.equal(charge.chargedCredits, 10);
});

test("paid processing priority multiplies credits and queue weight", () => {
  const expected = { standard: 1, express: 2, priority: 5, critical: 10 };
  for (const [name, multiplier] of Object.entries(expected)) {
    const charge = calculateCreditCharge({ inputTokens: 5_001, outputTokens: 100, priority: name });
    assert.equal(charge.baseCredits, 2);
    assert.equal(charge.priorityMultiplier, multiplier);
    assert.equal(charge.queueWeight, multiplier);
    assert.equal(charge.chargedCredits, 2 * multiplier);
    assert.equal(getProcessingPriority(name).creditMultiplier, multiplier);
  }
});

test("invalid token counts and priorities fail closed", () => {
  assert.throws(() => calculateCreditCharge({ inputTokens: -1 }), /invalid/);
  assert.throws(() => calculateCreditCharge({ outputTokens: 1.2 }), /invalid/);
  assert.throws(() => calculateCreditCharge({ priority: "free-fast" }), /invalid/);
});
