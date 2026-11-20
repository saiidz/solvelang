import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_TOKEN_SCOPES,
  MANDATE_PACK_OPTIONS,
  auditOutcomeLine,
  formatCents,
  formatThreshold,
  mandateStatusLine,
  minutesCheckoutFromApproval,
  purchaseStatusLine,
  type AgentMandateView,
} from "./agent-actions";

// Level 3 site pins: the agent-access page's wording and formatting
// helpers, and the mandate pack options pinned to the exact shelf
// (keys and prices as the runners service and the services page
// state them).

test("agent token scopes are exactly the four Level 3 scopes", () => {
  assert.deepEqual(AGENT_TOKEN_SCOPES.map((entry) => entry.scope), [
    "purchase:runner-minutes",
    "purchase:api-plans",
    "mandates:manage",
    "purchases:read",
  ]);
});

test("mandate pack options pin the standard shelf", () => {
  const standard = MANDATE_PACK_OPTIONS.filter((option) => option.pool === "standard");
  assert.deepEqual(standard.map((option) => option.packKey), ["standard-5000", "standard-25000", "standard-100000"]);
  assert.deepEqual(standard.map((option) => option.label), [
    "Standard — 5,000 minutes · $20",
    "Standard — 25,000 minutes · $100",
    "Standard — 100,000 minutes · $400",
  ]);
});

test("mandate pack options pin the high-power ladder exactly as the shelf states it", () => {
  const highPower = MANDATE_PACK_OPTIONS.filter((option) => option.pool === "high-power");
  assert.deepEqual(highPower.map((option) => option.packKey), [
    "high-power-1000", "high-power-2000", "high-power-3000", "high-power-4000", "high-power-5000",
    "high-power-6000", "high-power-7000", "high-power-8000", "high-power-9000", "high-power-10000",
  ]);
  assert.deepEqual(highPower.map((option) => option.label), [
    "High-power — 1,000 minutes · $80",
    "High-power — 2,000 minutes · $140",
    "High-power — 3,000 minutes · $192",
    "High-power — 4,000 minutes · $236",
    "High-power — 5,000 minutes · $275",
    "High-power — 6,000 minutes · $306",
    "High-power — 7,000 minutes · $336",
    "High-power — 8,000 minutes · $360",
    "High-power — 9,000 minutes · $382.50",
    "High-power — 10,000 minutes · $400",
  ]);
});

test("formatting helpers", () => {
  assert.equal(formatCents(2000), "$20.00");
  assert.equal(formatCents(38250), "$382.50");
  assert.equal(formatCents(69900), "$699.00");
  assert.equal(formatThreshold(30 * 60), "30 minutes");
  assert.equal(formatThreshold(60 * 60), "1 hour");
  assert.equal(formatThreshold(120 * 60), "2 hours");
  assert.equal(formatThreshold(90 * 60), "90 minutes");
});

test("mandate status lines are plain words for every state", () => {
  const base: AgentMandateView = {
    id: "m1", status: "draft", pool: "standard", packKey: "standard-5000",
    thresholdSeconds: 3600, perPurchaseCapCents: 2000, monthlyCapCents: 10000,
    coversApiPlans: false, expiresAt: null, agentLabel: null, lastTriggeredAt: null,
    createdAt: "2026-11-19T12:00:00.000Z",
  };
  assert.match(mandateStatusLine(base), /does nothing until you arm it/);
  assert.match(mandateStatusLine({ ...base, status: "armed" }), /within its caps/);
  assert.match(mandateStatusLine({ ...base, status: "paused" }), /will not buy/);
  assert.match(mandateStatusLine({ ...base, status: "revoked" }), /permanently off/);
  assert.match(mandateStatusLine({ ...base, status: "expired" }), /end date has passed/);
});

test("purchase and audit outcome lines are plain words", () => {
  assert.equal(purchaseStatusLine("approval_required"), "Waiting for your approval");
  assert.match(purchaseStatusLine("cap_blocked"), /cap reached/);
  assert.equal(purchaseStatusLine("completed"), "Completed");
  assert.equal(auditOutcomeLine("executed"), "Bought");
  assert.match(auditOutcomeLine("refused_scope"), /lacks the scope/);
  assert.match(auditOutcomeLine("refused_cap"), /cap reached/);
  assert.equal(auditOutcomeLine("mandate_armed"), "Mandate armed by you");
});

test("minutes approval checkout is read from the nested checkout object", () => {
  // The literal runners approve answer: approvePurchase returns
  // { intent, checkout }, and createPackCheckout's checkout carries
  // the client secret and publishable key. The runners QA suite
  // pins this same envelope at the producer side.
  const approved = {
    intent: { id: "intent-1", status: "approved", packKey: "standard-5000", amountCents: 2000 },
    checkout: {
      clientSecret: "pi_123_secret_xyz",
      paymentIntentId: "pi_123",
      publishableKey: "pk_live_abc",
      pack: "standard-5000",
      amountCents: 2000,
      currency: "USD",
    },
  };
  assert.deepEqual(minutesCheckoutFromApproval(approved), {
    clientSecret: "pi_123_secret_xyz",
    publishableKey: "pk_live_abc",
  });
});

test("minutes approval checkout refuses flat or partial shapes", () => {
  // The pre-fix page read clientSecret / publishableKey at the top
  // level of the approve answer, where they never exist - a flat
  // shape must not be treated as a checkout, and neither must a
  // half-built one (the page falls back to a reload instead of
  // presenting a broken payment box).
  assert.equal(minutesCheckoutFromApproval({ clientSecret: "x", publishableKey: "y" }), null);
  assert.equal(minutesCheckoutFromApproval({ intent: { status: "approved" } }), null);
  assert.equal(minutesCheckoutFromApproval({ checkout: { clientSecret: "x" } }), null);
  assert.equal(minutesCheckoutFromApproval({ checkout: { publishableKey: "y" } }), null);
  assert.equal(minutesCheckoutFromApproval({ checkout: { clientSecret: "", publishableKey: "y" } }), null);
  assert.equal(minutesCheckoutFromApproval(null), null);
  assert.equal(minutesCheckoutFromApproval("approved"), null);
});
