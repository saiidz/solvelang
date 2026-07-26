import assert from "node:assert/strict";
import test from "node:test";
import { parsePendingPaidScan, rotatePendingPaidScan } from "./pendingPaidScan";
import { recoverPaidScan } from "./paidRecovery";

const scanA = "6c8e4b95-1e66-4dc3-9b67-af15f0742875";
const scanB = "6494ef6d-c1c6-4a70-a2b4-ae1af835b682";
const pending = { scanId: scanA, fileName: "workflow.json", report: { workflowName: "Private workflow" } };

test("Start over rotates only the pending scan identity and preserves report recovery data", () => {
  const next = rotatePendingPaidScan(JSON.stringify(pending), scanA, scanB);
  assert.deepEqual(parsePendingPaidScan(next ?? null), { ...pending, scanId: scanB });
  assert.equal(rotatePendingPaidScan(JSON.stringify(pending), "wrong-scan", scanB), undefined);
  assert.equal(rotatePendingPaidScan("not-json", scanA, scanB), undefined);
});

test("the rotated pending scan restores the original report after payment recovery", async () => {
  const stored = rotatePendingPaidScan(JSON.stringify(pending), scanA, scanB);
  const result = await recoverPaidScan({
    apiBase: "https://entitlements.example.test",
    search: `?scan_id=${scanB}&payment_intent=pi_test_paid&redirect_status=succeeded`,
    stored: stored ?? null,
    verify: async (_url, init) => {
      assert.equal(init.body, JSON.stringify({ scanId: scanB, sessionId: "pi_test_paid" }));
      return { ok: true, json: async () => ({ token: "signed-entitlement" }) };
    },
    replaceUrl: () => undefined,
    clearPending: () => undefined,
  });
  assert.deepEqual(result?.pending, { ...pending, scanId: scanB });
});
