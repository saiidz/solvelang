import assert from "node:assert/strict";
import test from "node:test";
import {
  CI_DIGEST_PATH,
  formatDigestWindow,
  formatMinutes,
  latestDigestPerRepo,
  parseCiDigests,
} from "./ci-digest";

// A miniature of the real service payload (same keys, same shapes)
// as served by GET /customer/runner-minutes/ci-digest — one full
// digest and one thin-window digest for a second repository.
const FULL_DIGEST = {
  id: "digest-1",
  kind: "weekly-ci-digest",
  tenantId: "acct_test",
  repo: "saiidz/example",
  windowStart: "2026-11-17T12:00:00.000Z",
  windowEnd: "2026-11-24T12:00:00.000Z",
  generatedAt: "2026-11-24T12:00:00.000Z",
  insufficientData: false,
  note: null,
  totals: {
    recordsInWindow: 7,
    jobsServed: 6,
    concludedJobs: 6,
    successes: 4,
    failures: 1,
    cancellations: 1,
    successRatePercent: 66.7,
    totalBilledSeconds: 1695,
    totalMinutes: 28.25,
    wastedSeconds: 540,
    wastedMinutes: 9,
  },
  slowestRuns: [{ runId: 200, jobs: 3, minutes: 20.5, billedSeconds: 1230, failures: 0, firstAt: "2026-11-20T00:00:00.000Z" }],
  slowestJobs: [{ jobId: 4, runId: 200, minutes: 15, billedSeconds: 900, outcome: "success", lane: "spot", at: "2026-11-20T00:00:00.000Z" }],
  mixedOutcomeRuns: [{ runId: 100, jobs: 3, successes: 2, failures: 1, minutes: 7, firstAt: "2026-11-20T00:00:00.000Z" }],
};

const THIN_DIGEST = {
  ...FULL_DIGEST,
  id: "digest-2",
  repo: "saiidz/thin",
  insufficientData: true,
  note: "Not enough recorded data yet: this digest rests on 1 job(s) with a recorded outcome in the window; at least 5 are needed before rankings are shown.",
  totals: { ...FULL_DIGEST.totals, concludedJobs: 1, successes: 1, failures: 0, cancellations: 0, successRatePercent: 100 },
  slowestRuns: [],
  slowestJobs: [],
  mixedOutcomeRuns: [],
};

test("the digest read path is the runners service ci-digest route", () => {
  assert.equal(CI_DIGEST_PATH, "/customer/runner-minutes/ci-digest");
});

test("parseCiDigests carries the service figures verbatim", () => {
  const digests = parseCiDigests({ digests: [FULL_DIGEST, THIN_DIGEST] });
  assert.equal(digests.length, 2);
  assert.equal(digests[0].repo, "saiidz/example");
  assert.equal(digests[0].totals.wastedMinutes, 9);
  assert.equal(digests[0].totals.successRatePercent, 66.7);
  assert.equal(digests[0].slowestRuns[0].runId, 200);
  assert.equal(digests[0].slowestJobs[0].outcome, "success");
  assert.equal(digests[0].mixedOutcomeRuns[0].failures, 1);
  assert.equal(digests[1].insufficientData, true);
  assert.match(digests[1].note ?? "", /Not enough recorded data yet/);
});

test("parseCiDigests normalizes anything unrecognized to an empty list", () => {
  assert.deepEqual(parseCiDigests(null), []);
  assert.deepEqual(parseCiDigests({}), []);
  assert.deepEqual(parseCiDigests({ digests: "nope" }), []);
  assert.deepEqual(parseCiDigests({ digests: [{ totals: {} }, 42, null] }), []);
});

test("parseCiDigests defaults missing figures to zero instead of inventing them", () => {
  const digests = parseCiDigests({ digests: [{ repo: "saiidz/bare" }] });
  assert.equal(digests.length, 1);
  assert.equal(digests[0].totals.totalMinutes, 0);
  assert.equal(digests[0].totals.successRatePercent, null);
  assert.equal(digests[0].insufficientData, false);
  assert.deepEqual(digests[0].slowestRuns, []);
});

test("latestDigestPerRepo keeps the first (newest) digest per repository", () => {
  const older = { ...FULL_DIGEST, id: "digest-0", generatedAt: "2026-11-17T12:00:00.000Z" };
  const digests = parseCiDigests({ digests: [FULL_DIGEST, older, THIN_DIGEST] });
  const latest = latestDigestPerRepo(digests);
  assert.equal(latest.length, 2);
  assert.equal(latest[0].id, "digest-1");
  assert.equal(latest[1].repo, "saiidz/thin");
});

test("window and minutes formatting are plain and exact", () => {
  const [digest] = parseCiDigests({ digests: [FULL_DIGEST] });
  assert.equal(formatDigestWindow(digest), "Week of 2026-11-17 to 2026-11-24");
  assert.equal(formatMinutes(9), "9.00 min");
  assert.equal(formatMinutes(0.17), "0.17 min");
});
