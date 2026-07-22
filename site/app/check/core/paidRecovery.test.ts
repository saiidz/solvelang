import assert from "node:assert/strict";
import test from "node:test";
import { recoverPaidScan, type PendingPaidScan } from "./paidRecovery";

const pending: PendingPaidScan = {
  scanId: "6c8e4b95-1e66-4dc3-9b67-af15f0742875",
  fileName: "private-workflow.json",
  report: { workflowName: "Private workflow" } as PendingPaidScan["report"],
};

test("browser return verifies entitlement server-side and removes payment parameters", async () => {
  const requests: Array<{ url: string; body: string }> = [];
  let replaced = "";
  let removed = false;
  const result = await recoverPaidScan({
    apiBase: "https://entitlements.example.test",
    search: `?scan_id=${pending.scanId}&payment_intent=pi_test_paid&redirect_status=succeeded`,
    stored: JSON.stringify(pending),
    verify: async (url, init) => {
      requests.push({ url, body: String(init.body) });
      return { ok: true, json: async () => ({ token: "signed-entitlement" }) };
    },
    replaceUrl: (url) => { replaced = url; },
    clearPending: () => { removed = true; },
  });

  assert.equal(result?.token, "signed-entitlement");
  assert.equal(result?.pending.scanId, pending.scanId);
  assert.deepEqual(requests, [{
    url: "https://entitlements.example.test/entitlement",
    body: JSON.stringify({ scanId: pending.scanId, sessionId: "pi_test_paid" }),
  }]);
  assert.equal(replaced, "/check/");
  assert.equal(removed, true);
});

test("browser recovery fails closed for mismatched scans and unverifiable payment", async () => {
  await assert.rejects(() => recoverPaidScan({
    apiBase: "https://entitlements.example.test",
    search: "?scan_id=wrong&payment_intent=pi_test_paid&redirect_status=succeeded",
    stored: JSON.stringify(pending),
    verify: async () => ({ ok: true, json: async () => ({ token: "signed-entitlement" }) }),
    replaceUrl: () => assert.fail("must not replace URL"),
    clearPending: () => assert.fail("must not clear recovery state"),
  }), /does not match/);

  await assert.rejects(() => recoverPaidScan({
    apiBase: "https://entitlements.example.test",
    search: `?scan_id=${pending.scanId}&payment_intent=pi_test_unpaid&redirect_status=succeeded`,
    stored: JSON.stringify(pending),
    verify: async () => ({ ok: false, json: async () => ({ error: "No paid payment" }) }),
    replaceUrl: () => assert.fail("must not replace URL"),
    clearPending: () => assert.fail("must not clear recovery state"),
  }), /could not be verified/);
});

test("browser recovery retries bounded webhook propagation before restoring the report", async () => {
  let attempts = 0;
  const delays: number[] = [];
  const retryAttempts: number[] = [];
  const result = await recoverPaidScan({
    apiBase: "https://entitlements.example.test",
    search: `?scan_id=${pending.scanId}&payment_intent=pi_test_paid&redirect_status=succeeded`,
    stored: JSON.stringify(pending),
    verify: async () => {
      attempts += 1;
      return attempts < 3
        ? { ok: false, status: 409, json: async () => ({ code: "payment_pending" }) }
        : { ok: true, status: 200, json: async () => ({ token: "signed-entitlement" }) };
    },
    wait: async (milliseconds) => { delays.push(milliseconds); },
    onRetry: (attempt) => { retryAttempts.push(attempt); },
    replaceUrl: () => undefined,
    clearPending: () => undefined,
  });

  assert.equal(result?.token, "signed-entitlement");
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [500, 1000]);
  assert.deepEqual(retryAttempts, [1, 2]);
});

test("browser recovery reports full refunds and failed payments without retrying", async () => {
  for (const fixture of [
    { status: 403, code: "payment_refunded", message: /fully refunded/ },
    { status: 402, code: "payment_not_succeeded", message: /has not succeeded/ },
  ]) {
    let attempts = 0;
    await assert.rejects(() => recoverPaidScan({
      apiBase: "https://entitlements.example.test",
      search: `?scan_id=${pending.scanId}&payment_intent=pi_test_paid&redirect_status=succeeded`,
      stored: JSON.stringify(pending),
      verify: async () => {
        attempts += 1;
        return { ok: false, status: fixture.status, json: async () => ({ code: fixture.code }) };
      },
      wait: async () => assert.fail("must not retry"),
      replaceUrl: () => undefined,
      clearPending: () => undefined,
    }), fixture.message);
    assert.equal(attempts, 1);
  }
});
