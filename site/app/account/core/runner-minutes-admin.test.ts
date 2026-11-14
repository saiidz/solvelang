import assert from "node:assert/strict";
import test from "node:test";
import {
  adminActionPath,
  formatMinuteCount,
  formatNearestExpiry,
  normalizeAdminAccounts,
  normalizeAdminActionResult,
  parseMinutesInput,
} from "./runner-minutes-admin";

const ROW = {
  tenantId: "acct_1",
  status: "paused",
  balances: {
    standard: { seconds: 294_540, minutes: 4_909 },
    highPower: { seconds: 15_000, minutes: 250 },
    cache: { gbMonths: 5 },
  },
  nearestLotExpiresAt: "2027-11-11T12:00:00.000Z",
};

test("normalizeAdminAccounts maps the proxy list into render rows", () => {
  const out = normalizeAdminAccounts({ configured: true, accounts: [ROW] });
  assert.equal(out.configured, true);
  assert.equal(out.accounts.length, 1);
  assert.equal(out.accounts[0].tenantId, "acct_1");
  assert.equal(out.accounts[0].status, "paused");
  assert.equal(out.accounts[0].standardMinutes, 4_909);
  assert.equal(out.accounts[0].standardSeconds, 294_540);
  assert.equal(out.accounts[0].highPowerMinutes, 250);
  assert.equal(out.accounts[0].cacheGbMonths, 5);
  assert.equal(out.accounts[0].nearestLotExpiresAt, "2027-11-11T12:00:00.000Z");
});

test("normalizeAdminAccounts treats anything not stamped configured as not available", () => {
  assert.deepEqual(normalizeAdminAccounts({ configured: false }), { configured: false, accounts: [] });
  assert.deepEqual(normalizeAdminAccounts(null), { configured: false, accounts: [] });
  assert.deepEqual(normalizeAdminAccounts({ accounts: [ROW] }), { configured: false, accounts: [] });
});

test("normalizeAdminAccounts drops malformed rows and defaults missing numbers to zero", () => {
  const out = normalizeAdminAccounts({
    configured: true,
    accounts: [{ balances: {} }, { tenantId: "acct_2" }, ROW],
  });
  assert.equal(out.accounts.length, 2);
  assert.equal(out.accounts[0].tenantId, "acct_2");
  assert.equal(out.accounts[0].status, "active");
  assert.equal(out.accounts[0].standardMinutes, 0);
  assert.equal(out.accounts[0].nearestLotExpiresAt, null);
});

test("normalizeAdminActionResult reads the fresh row out of a mutation answer", () => {
  const row = normalizeAdminActionResult({ account: ROW, detail: { action: "credit" } });
  assert.equal(row?.tenantId, "acct_1");
  assert.equal(normalizeAdminActionResult({ detail: { action: "credit" } }), null);
  assert.equal(normalizeAdminActionResult(null), null);
});

test("formatMinuteCount uses plain words and thousands separators", () => {
  assert.equal(formatMinuteCount(0), "0 minutes");
  assert.equal(formatMinuteCount(1), "1 minute");
  assert.equal(formatMinuteCount(4_909), "4,909 minutes");
});

test("formatNearestExpiry names the date, or says nothing expires yet", () => {
  assert.equal(formatNearestExpiry(null), "No minutes expire yet");
  assert.equal(formatNearestExpiry("not-a-date"), "No minutes expire yet");
  assert.match(formatNearestExpiry("2027-11-11T12:00:00.000Z"), /^Next expiry Nov 11, 2027$/);
});

test("parseMinutesInput accepts whole positive minutes only", () => {
  assert.equal(parseMinutesInput("250"), 250);
  assert.equal(parseMinutesInput(" 25 "), 25);
  assert.equal(parseMinutesInput("0"), null);
  assert.equal(parseMinutesInput("-5"), null);
  assert.equal(parseMinutesInput("2.5"), null);
  assert.equal(parseMinutesInput(""), null);
  assert.equal(parseMinutesInput("abc"), null);
});

test("adminActionPath targets the proxy route for the tenant and action", () => {
  assert.equal(
    adminActionPath("acct_1", "pause"),
    "/customer/runner-minutes-admin/accounts/acct_1/pause",
  );
  assert.equal(
    adminActionPath("acct x", "credit"),
    "/customer/runner-minutes-admin/accounts/acct%20x/credit",
  );
});
