import assert from "node:assert/strict";
import test from "node:test";
import { CREDIT_POLICY, calculateCreditCharge } from "../src/credits.js";

test("one credit covers the published token envelope", () => {
  assert.deepEqual(CREDIT_POLICY, {
    inputTokensPerCredit: 5_000,
    outputTokensPerCredit: 1_000,
    maxOutputTokensPerCall: 1_000,
    paidPriorityEnabled: false,
  });
  const charge = calculateCreditCharge({ inputTokens: 5_000, outputTokens: 1_000 });
  assert.equal(charge.chargedCredits, 1);
});

test("large workloads are charged by the larger token dimension", () => {
  const charge = calculateCreditCharge({ inputTokens: 50_000, outputTokens: 1_000 });
  assert.equal(charge.inputCredits, 10);
  assert.equal(charge.outputCredits, 1);
  assert.equal(charge.chargedCredits, 10);
});

test("paid priority fails closed until queue-backed scheduling is enabled", () => {
  for (const priority of ["express", "priority", "critical"]) {
    assert.throws(
      () => calculateCreditCharge({ inputTokens: 5_000, outputTokens: 1_000, priority }),
      /not enabled/,
    );
  }
});

test("invalid token counts and oversized output fail closed", () => {
  assert.throws(() => calculateCreditCharge({ inputTokens: -1 }), /invalid/);
  assert.throws(() => calculateCreditCharge({ outputTokens: 1.2 }), /invalid/);
  assert.throws(() => calculateCreditCharge({ outputTokens: 1_001 }), /invalid/);
});